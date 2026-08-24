//go:build windows && !mt5credentials_unsupported_test

package mt5credentials

import (
	"context"
	"errors"
	"strings"
	"testing"
)

var (
	errFakeNotFound     = errNativeNotFound
	errFakeNoLogon      = errNativeUnavailable
	errFakeAccessDenied = errNativeUnavailable
)

type fakeCredentialAPI struct {
	records           map[string]credentialRecord
	writes            int
	reads             int
	deletes           int
	enumerates        int
	writeErr          error
	readErr           error
	deleteErr         error
	enumerateErr      error
	readErrors        []error
	deleteErrors      []error
	readMutator       func(int, credentialRecord) credentialRecord
	enumerateHook     func()
	retainDelete      bool
	retainWriteBuffer bool
	observedWrite     credentialRecord
}

func newFakeCredentialAPI() *fakeCredentialAPI {
	return &fakeCredentialAPI{records: make(map[string]credentialRecord)}
}

func (api *fakeCredentialAPI) Write(record credentialRecord) error {
	api.writes++
	api.observedWrite = cloneCredentialRecord(record, !api.retainWriteBuffer)
	if api.writeErr != nil {
		return api.writeErr
	}
	api.records[record.TargetName] = cloneCredentialRecord(record, true)
	return nil
}

func (api *fakeCredentialAPI) Read(target string, credentialType uint32) (credentialRecord, error) {
	api.reads++
	if api.readErr != nil {
		return credentialRecord{}, api.readErr
	}
	if index := api.reads - 1; index < len(api.readErrors) && api.readErrors[index] != nil {
		return credentialRecord{}, api.readErrors[index]
	}
	record, ok := api.records[target]
	if !ok || credentialType != credentialTypeGeneric {
		return credentialRecord{}, errFakeNotFound
	}
	record = cloneCredentialRecord(record, true)
	if api.readMutator != nil {
		record = api.readMutator(api.reads, record)
	}
	return record, nil
}

func (api *fakeCredentialAPI) Delete(target string, credentialType uint32) error {
	api.deletes++
	if api.deleteErr != nil {
		return api.deleteErr
	}
	if index := api.deletes - 1; index < len(api.deleteErrors) && api.deleteErrors[index] != nil {
		return api.deleteErrors[index]
	}
	if _, ok := api.records[target]; !ok || credentialType != credentialTypeGeneric {
		return errFakeNotFound
	}
	if !api.retainDelete {
		delete(api.records, target)
	}
	return nil
}

func (api *fakeCredentialAPI) Enumerate(filter string) ([]credentialTarget, error) {
	api.enumerates++
	if api.enumerateHook != nil {
		api.enumerateHook()
	}
	if api.enumerateErr != nil {
		return nil, api.enumerateErr
	}
	prefix := strings.TrimSuffix(filter, "*")
	targets := make([]credentialTarget, 0)
	for target, record := range api.records {
		if strings.HasPrefix(target, prefix) {
			targets = append(targets, credentialTarget{TargetName: target, Type: record.Type})
		}
	}
	return targets, nil
}

func cloneCredentialRecord(record credentialRecord, copyBlob bool) credentialRecord {
	cloned := record
	if copyBlob {
		cloned.Blob = append([]byte(nil), record.Blob...)
	}
	return cloned
}

func TestWindowsCredentialStoreRoundTripsAndKeepsMetadataOpaque(t *testing.T) {
	api := newFakeCredentialAPI()
	store := newWindowsStore(api)
	ref := "mt5-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	want := Credential{Login: "12345678", Password: "distinctive-private-value", Server: "Distinctive-Broker-Demo"}
	if err := store.Put(context.Background(), ref, want); err != nil {
		t.Fatal(err)
	}
	if api.writes != 1 {
		t.Fatalf("writes=%d", api.writes)
	}
	record := api.observedWrite
	if record.TargetName != credentialTargetPrefix+ref || record.Type != credentialTypeGeneric || record.Persist != credentialPersistLocalMachine {
		t.Fatalf("unsafe credential metadata: %#v", record)
	}
	metadata := record.TargetName + record.UserName + record.Comment
	for _, secret := range []string{want.Login, want.Password, want.Server} {
		if strings.Contains(metadata, secret) {
			t.Fatalf("credential metadata exposed private value")
		}
	}
	got, err := store.Get(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { got.Password = "" }()
	if got != want {
		t.Fatalf("credential mismatch: %#v", got)
	}
	if err := store.Delete(context.Background(), ref); err != nil {
		t.Fatal(err)
	}
	if err := store.Delete(context.Background(), ref); err != nil {
		t.Fatalf("idempotent delete failed: %v", err)
	}
	if _, err := store.Get(context.Background(), ref); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted credential read error=%v", err)
	}
}

func TestWindowsCredentialStoreClearsWriteBufferAndRejectsBeforeWinAPI(t *testing.T) {
	api := newFakeCredentialAPI()
	api.retainWriteBuffer = true
	store := newWindowsStore(api)
	ref := "mt5-0123456789abcdef0123456789abcdef"
	credential := Credential{Login: "12345678", Password: "clear-me", Server: "Broker-Demo"}
	if err := store.Put(context.Background(), ref, credential); err != nil {
		t.Fatal(err)
	}
	for _, value := range api.observedWrite.Blob {
		if value != 0 {
			t.Fatal("credential write buffer was not cleared")
		}
	}

	writes := api.writes
	if err := store.Put(context.Background(), "unsafe", credential); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid reference error=%v", err)
	}
	if err := store.Put(context.Background(), ref, Credential{Login: "x", Password: "p", Server: "s"}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("invalid credential error=%v", err)
	}
	if api.writes != writes {
		t.Fatal("invalid input reached Win32 API")
	}
}

func TestWindowsCredentialStoreFailsClosedForContextAndNativeErrors(t *testing.T) {
	ref := "mt5-0123456789abcdef0123456789abcdef"
	credential := Credential{Login: "12345678", Password: "private-value", Server: "Broker-Demo"}

	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	api := newFakeCredentialAPI()
	store := newWindowsStore(api)
	if err := store.Put(cancelled, ref, credential); !errors.Is(err, context.Canceled) || api.writes != 0 {
		t.Fatalf("cancelled write err=%v calls=%d", err, api.writes)
	}

	for _, nativeErr := range []error{errFakeNoLogon, errFakeAccessDenied} {
		api := newFakeCredentialAPI()
		api.writeErr = nativeErr
		store := newWindowsStore(api)
		if err := store.Put(context.Background(), ref, credential); !errors.Is(err, ErrUnavailable) || strings.Contains(err.Error(), ref) || strings.Contains(err.Error(), credential.Password) {
			t.Fatalf("unsafe native error mapping: %v", err)
		}

		api = newFakeCredentialAPI()
		api.readErr = nativeErr
		store = newWindowsStore(api)
		if _, err := store.Get(context.Background(), ref); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("unsafe native read error mapping: %v", err)
		}

		api = newFakeCredentialAPI()
		api.deleteErr = nativeErr
		store = newWindowsStore(api)
		if err := store.Delete(context.Background(), ref); !errors.Is(err, ErrUnavailable) {
			t.Fatalf("unsafe native delete error mapping: %v", err)
		}
	}

	api = newFakeCredentialAPI()
	api.writeErr = errFakeNotFound
	if err := newWindowsStore(api).Put(context.Background(), ref, credential); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("native not-found write was not fail-closed: %v", err)
	}
}

func TestWindowsCredentialStoreValidatesGetAndDeleteBeforeWinAPI(t *testing.T) {
	ref := "mt5-0123456789abcdef0123456789abcdef"
	api := newFakeCredentialAPI()
	store := newWindowsStore(api)
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()

	if _, err := store.Get(cancelled, ref); !errors.Is(err, context.Canceled) || api.reads != 0 {
		t.Fatalf("cancelled read err=%v calls=%d", err, api.reads)
	}
	if _, err := store.Get(context.Background(), "unsafe"); !errors.Is(err, ErrInvalid) || api.reads != 0 {
		t.Fatalf("invalid read err=%v calls=%d", err, api.reads)
	}
	if err := store.Delete(cancelled, ref); !errors.Is(err, context.Canceled) || api.deletes != 0 {
		t.Fatalf("cancelled delete err=%v calls=%d", err, api.deletes)
	}
	if err := store.Delete(context.Background(), "unsafe"); !errors.Is(err, ErrInvalid) || api.deletes != 0 {
		t.Fatalf("invalid delete err=%v calls=%d", err, api.deletes)
	}
}

func TestWindowsCredentialStoreRejectsTamperedRecords(t *testing.T) {
	ref := "mt5-0123456789abcdef0123456789abcdef"
	target := credentialTargetPrefix + ref
	credential := Credential{Login: "12345678", Password: "private-value", Server: "Broker-Demo"}
	blob, err := encodeCredential(credential)
	if err != nil {
		t.Fatal(err)
	}
	defer clear(blob)
	baseline := credentialRecord{
		TargetName: target,
		Blob:       blob,
		Type:       credentialTypeGeneric,
		Persist:    credentialPersistLocalMachine,
	}
	tests := map[string]func(*credentialRecord){
		"target":   func(record *credentialRecord) { record.TargetName += "-sibling" },
		"type":     func(record *credentialRecord) { record.Type = 0 },
		"persist":  func(record *credentialRecord) { record.Persist = 0 },
		"username": func(record *credentialRecord) { record.UserName = "metadata" },
		"comment":  func(record *credentialRecord) { record.Comment = "metadata" },
		"blob": func(record *credentialRecord) {
			record.Blob = []byte{2, 0, 0, 0, 0, 0, 0}
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			api := newFakeCredentialAPI()
			record := cloneCredentialRecord(baseline, true)
			mutate(&record)
			api.records[target] = record
			loaded, err := newWindowsStore(api).Get(context.Background(), ref)
			loaded.Password = ""
			if !errors.Is(err, ErrInvalid) {
				t.Fatalf("tampered record error=%v", err)
			}
		})
	}
}

func TestWindowsCredentialStoreProbeUsesOnlySyntheticCredentialAndCleansIt(t *testing.T) {
	api := newFakeCredentialAPI()
	store := newWindowsStore(api)
	if err := store.Probe(context.Background()); err != nil {
		t.Fatal(err)
	}
	if api.writes != 1 || api.reads != 2 || api.deletes != 1 || api.enumerates != 1 || len(api.records) != 0 {
		t.Fatalf("probe lifecycle writes=%d reads=%d deletes=%d enumerates=%d records=%d", api.writes, api.reads, api.deletes, api.enumerates, len(api.records))
	}
	if !strings.HasPrefix(api.observedWrite.TargetName, credentialTestTargetPrefix) {
		t.Fatalf("probe target=%q", api.observedWrite.TargetName)
	}
}

func TestWindowsCredentialStoreProbeCleansOnlyStaleSyntheticCanaries(t *testing.T) {
	api := newFakeCredentialAPI()
	staleTarget := credentialTestTargetPrefix + "11111111111111111111111111111111"
	managedTarget := credentialTargetPrefix + "mt5-22222222222222222222222222222222"
	blob, err := encodeCredential(Credential{Login: "1", Password: "synthetic-stale", Server: "MarketLens-Probe"})
	if err != nil {
		t.Fatal(err)
	}
	defer clear(blob)
	api.records[staleTarget] = credentialRecord{TargetName: staleTarget, Blob: append([]byte(nil), blob...), Type: credentialTypeGeneric, Persist: credentialPersistLocalMachine}
	api.records[managedTarget] = credentialRecord{TargetName: managedTarget, Blob: append([]byte(nil), blob...), Type: credentialTypeGeneric, Persist: credentialPersistLocalMachine}

	if err := newWindowsStore(api).Probe(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, exists := api.records[staleTarget]; exists {
		t.Fatal("stale synthetic probe credential was not cleaned")
	}
	if _, exists := api.records[managedTarget]; !exists {
		t.Fatal("managed account credential was touched by probe cleanup")
	}
	for target := range api.records {
		if strings.HasPrefix(target, credentialTestTargetPrefix) {
			t.Fatalf("synthetic probe credential remained: %q", target)
		}
	}
}

func TestWindowsCredentialStoreProbeFailsClosedAtEveryNativeStage(t *testing.T) {
	wrongBlob, err := encodeCredential(Credential{Login: "2", Password: "synthetic-probe", Server: "MarketLens-Probe"})
	if err != nil {
		t.Fatal(err)
	}
	defer clear(wrongBlob)

	tests := map[string]func(*fakeCredentialAPI){
		"write": func(api *fakeCredentialAPI) {
			api.writeErr = errNativeUnavailable
		},
		"first read": func(api *fakeCredentialAPI) {
			api.readErrors = []error{errNativeUnavailable}
		},
		"tampered metadata": func(api *fakeCredentialAPI) {
			api.readMutator = func(call int, record credentialRecord) credentialRecord {
				if call == 1 {
					record.Persist = 0
				}
				return record
			}
		},
		"malformed blob": func(api *fakeCredentialAPI) {
			api.readMutator = func(call int, record credentialRecord) credentialRecord {
				if call == 1 {
					clear(record.Blob)
					record.Blob = []byte{2, 0, 0, 0, 0, 0, 0}
				}
				return record
			}
		},
		"wrong credential": func(api *fakeCredentialAPI) {
			api.readMutator = func(call int, record credentialRecord) credentialRecord {
				if call == 1 {
					clear(record.Blob)
					record.Blob = append([]byte(nil), wrongBlob...)
				}
				return record
			}
		},
		"delete": func(api *fakeCredentialAPI) {
			api.deleteErrors = []error{errNativeUnavailable, nil}
		},
		"still present": func(api *fakeCredentialAPI) {
			api.retainDelete = true
		},
		"unexpected absence error": func(api *fakeCredentialAPI) {
			api.readErrors = []error{nil, errNativeUnavailable}
		},
		"deferred cleanup": func(api *fakeCredentialAPI) {
			api.readErrors = []error{errNativeUnavailable}
			api.deleteErrors = []error{errNativeUnavailable}
		},
	}
	for name, configure := range tests {
		t.Run(name, func(t *testing.T) {
			api := newFakeCredentialAPI()
			configure(api)
			if err := newWindowsStore(api).Probe(context.Background()); !errors.Is(err, ErrUnavailable) {
				t.Fatalf("probe error=%v", err)
			}
		})
	}
}

func TestWindowsCredentialStoreProbeFailsClosedBeforeWritingCanary(t *testing.T) {
	tests := map[string]func(*windowsStore){
		"cleanup": func(store *windowsStore) {
			store.api.(*fakeCredentialAPI).enumerateErr = errNativeUnavailable
		},
		"entropy": func(store *windowsStore) {
			store.createSecretRef = func() (string, error) { return "", errors.New("entropy detail") }
		},
		"encoding": func(store *windowsStore) {
			store.createSecretRef = func() (string, error) {
				return "mt5-0123456789abcdef0123456789abcdef", nil
			}
			store.encode = func(Credential) ([]byte, error) { return nil, ErrInvalid }
		},
	}
	for name, configure := range tests {
		t.Run(name, func(t *testing.T) {
			api := newFakeCredentialAPI()
			store := newWindowsStore(api)
			configure(store)
			if err := store.Probe(context.Background()); !errors.Is(err, ErrUnavailable) || api.writes != 0 {
				t.Fatalf("pre-write probe failure err=%v writes=%d", err, api.writes)
			}
		})
	}
}

func TestWindowsCredentialStoreProbeAndCleanupHonorCancellationAndFailClosed(t *testing.T) {
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	api := newFakeCredentialAPI()
	if err := newWindowsStore(api).Probe(cancelled); !errors.Is(err, context.Canceled) || api.enumerates != 0 {
		t.Fatalf("cancelled probe err=%v enumerates=%d", err, api.enumerates)
	}

	validTarget := credentialTestTargetPrefix + "11111111111111111111111111111111"
	tests := map[string]struct {
		configure func(*fakeCredentialAPI, context.CancelFunc)
		want      error
	}{
		"enumeration not found": {
			configure: func(api *fakeCredentialAPI, _ context.CancelFunc) { api.enumerateErr = errNativeNotFound },
		},
		"enumeration unavailable": {
			configure: func(api *fakeCredentialAPI, _ context.CancelFunc) { api.enumerateErr = errNativeUnavailable },
			want:      ErrUnavailable,
		},
		"wrong target type": {
			configure: func(api *fakeCredentialAPI, _ context.CancelFunc) {
				api.records[validTarget] = credentialRecord{TargetName: validTarget, Type: 0}
			},
			want: ErrUnavailable,
		},
		"malformed target": {
			configure: func(api *fakeCredentialAPI, _ context.CancelFunc) {
				target := credentialTestTargetPrefix + "not-a-reference"
				api.records[target] = credentialRecord{TargetName: target, Type: credentialTypeGeneric}
			},
			want: ErrUnavailable,
		},
		"cancel during enumeration": {
			configure: func(api *fakeCredentialAPI, cancel context.CancelFunc) {
				api.records[validTarget] = credentialRecord{TargetName: validTarget, Type: credentialTypeGeneric}
				api.enumerateHook = cancel
			},
			want: context.Canceled,
		},
		"stale target already absent": {
			configure: func(api *fakeCredentialAPI, _ context.CancelFunc) {
				api.records[validTarget] = credentialRecord{TargetName: validTarget, Type: credentialTypeGeneric}
				api.deleteErrors = []error{errNativeNotFound}
			},
		},
		"stale target delete unavailable": {
			configure: func(api *fakeCredentialAPI, _ context.CancelFunc) {
				api.records[validTarget] = credentialRecord{TargetName: validTarget, Type: credentialTypeGeneric}
				api.deleteErrors = []error{errNativeUnavailable}
			},
			want: ErrUnavailable,
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			api := newFakeCredentialAPI()
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			test.configure(api, cancel)
			err := newWindowsStore(api).cleanupSyntheticProbeTargets(ctx)
			if !errors.Is(err, test.want) {
				t.Fatalf("cleanup error=%v want=%v", err, test.want)
			}
		})
	}
}

func TestSyntheticProbeTargetValidationIsExact(t *testing.T) {
	valid := credentialTestTargetPrefix + "0123456789abcdef0123456789abcdef"
	for _, target := range []string{valid, credentialTestTargetPrefix + "ffffffffffffffffffffffffffffffff"} {
		if !validSyntheticProbeTarget(target) {
			t.Fatalf("valid synthetic target rejected: %q", target)
		}
	}
	for _, target := range []string{
		credentialTargetPrefix + "mt5-0123456789abcdef0123456789abcdef",
		credentialTestTargetPrefix + "not-a-reference",
		credentialTestTargetPrefix + "0123456789ABCDEF0123456789ABCDEF",
	} {
		if validSyntheticProbeTarget(target) {
			t.Fatalf("unsafe synthetic target accepted: %q", target)
		}
	}
}

func TestWindowsCredentialStoreDisposableRealLifecycle(t *testing.T) {
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	ref, err := NewSecretRef()
	if err != nil {
		t.Fatal(err)
	}
	credential := Credential{Login: "12345678", Password: "synthetic-test-only", Server: "MarketLens-Test"}
	defer func() {
		credential.Password = ""
		_ = store.Delete(context.Background(), ref)
	}()
	if err := store.Put(context.Background(), ref, credential); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Get(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if loaded != credential {
		loaded.Password = ""
		t.Fatal("real Windows credential did not round-trip")
	}
	loaded.Password = ""
	if err := store.Delete(context.Background(), ref); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get(context.Background(), ref); !errors.Is(err, ErrNotFound) {
		t.Fatalf("real Windows credential remained readable: %v", err)
	}
}

func TestWindowsCredentialStoreDisposableProbeLeavesNoSyntheticTargets(t *testing.T) {
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := store.Probe(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	targets, err := (nativeCredentialAPI{}).Enumerate(credentialTestTargetPrefix + "*")
	if err != nil && !errors.Is(err, errNativeNotFound) {
		t.Fatal(err)
	}
	if len(targets) != 0 {
		t.Fatalf("real Windows probe left %d synthetic target(s)", len(targets))
	}
}
