//go:build windows && !mt5credentials_unsupported_test

package mt5credentials

import (
	"bytes"
	"errors"
	"syscall"
	"testing"

	"golang.org/x/sys/windows"
)

func isolateNativeCredentialCalls(t *testing.T) {
	t.Helper()
	write := credentialWriteCall
	read := credentialReadCall
	deleteCall := credentialDeleteCall
	enumerate := credentialEnumCall
	free := credentialFreeCall
	t.Cleanup(func() {
		credentialWriteCall = write
		credentialReadCall = read
		credentialDeleteCall = deleteCall
		credentialEnumCall = enumerate
		credentialFreeCall = free
	})
	credentialFreeCall = func(uintptr) {}
}

func TestNativeCredentialWriteValidatesInputsAndMapsErrors(t *testing.T) {
	isolateNativeCredentialCalls(t)
	api := nativeCredentialAPI{}
	valid := credentialRecord{
		TargetName: "MarketLens:MT5:test-native-write",
		Blob:       []byte{1},
		Type:       credentialTypeGeneric,
		Persist:    credentialPersistLocalMachine,
	}
	for name, record := range map[string]credentialRecord{
		"target NUL":   {TargetName: "bad\x00target", Blob: []byte{1}},
		"username NUL": {TargetName: valid.TargetName, UserName: "bad\x00user", Blob: []byte{1}},
		"comment NUL":  {TargetName: valid.TargetName, Comment: "bad\x00comment", Blob: []byte{1}},
		"empty blob":   {TargetName: valid.TargetName},
		"large blob":   {TargetName: valid.TargetName, Blob: make([]byte, maxCredentialBlobBytes+1)},
	} {
		t.Run(name, func(t *testing.T) {
			if err := api.Write(record); !errors.Is(err, errNativeUnavailable) {
				t.Fatalf("native write error=%v", err)
			}
		})
	}

	credentialWriteCall = func(*nativeCredential) (uintptr, error) {
		return 0, syscall.Errno(windows.ERROR_ACCESS_DENIED)
	}
	if err := api.Write(valid); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("native call error=%v", err)
	}

	called := false
	credentialWriteCall = func(credential *nativeCredential) (uintptr, error) {
		called = true
		if utf16PointerString(credential.TargetName) != valid.TargetName ||
			utf16PointerString(credential.UserName) != "metadata-user" ||
			utf16PointerString(credential.Comment) != "metadata-comment" ||
			credential.CredentialBlobSize != 1 {
			t.Fatal("native write structure drifted")
		}
		return 1, nil
	}
	valid.UserName = "metadata-user"
	valid.Comment = "metadata-comment"
	if err := api.Write(valid); err != nil || !called {
		t.Fatalf("native write success err=%v called=%v", err, called)
	}
}

func TestNativeCredentialReadValidatesNativeResults(t *testing.T) {
	isolateNativeCredentialCalls(t)
	api := nativeCredentialAPI{}
	if _, err := api.Read("bad\x00target", credentialTypeGeneric); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("invalid target error=%v", err)
	}

	credentialReadCall = func(*uint16, uint32, **nativeCredential) (uintptr, error) {
		return 0, syscall.Errno(windows.ERROR_ACCESS_DENIED)
	}
	if _, err := api.Read("missing", credentialTypeGeneric); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("native read call error=%v", err)
	}

	setResult := func(credential *nativeCredential) {
		credentialReadCall = func(_ *uint16, _ uint32, output **nativeCredential) (uintptr, error) {
			*output = credential
			return 1, nil
		}
	}
	setResult(nil)
	if _, err := api.Read("nil-result", credentialTypeGeneric); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("nil native credential error=%v", err)
	}

	for name, credential := range map[string]*nativeCredential{
		"empty blob": {CredentialBlobSize: 0},
		"large blob": {CredentialBlobSize: maxCredentialBlobBytes + 1, CredentialBlob: new(byte)},
		"nil blob":   {CredentialBlobSize: 1},
	} {
		t.Run(name, func(t *testing.T) {
			setResult(credential)
			if _, err := api.Read("invalid-result", credentialTypeGeneric); !errors.Is(err, errNativeUnavailable) {
				t.Fatalf("invalid native result error=%v", err)
			}
		})
	}

	target, _ := windows.UTF16PtrFromString("native-read-target")
	username, _ := windows.UTF16PtrFromString("native-user")
	comment, _ := windows.UTF16PtrFromString("native-comment")
	blob := []byte{1, 2, 3}
	setResult(&nativeCredential{
		Type:               credentialTypeGeneric,
		TargetName:         target,
		UserName:           username,
		Comment:            comment,
		CredentialBlobSize: uint32(len(blob)),
		CredentialBlob:     &blob[0],
		Persist:            credentialPersistLocalMachine,
	})
	record, err := api.Read("native-read-target", credentialTypeGeneric)
	if err != nil || record.TargetName != "native-read-target" || record.UserName != "native-user" ||
		record.Comment != "native-comment" || !bytes.Equal(record.Blob, []byte{1, 2, 3}) {
		t.Fatalf("native read record=%#v err=%v", record, err)
	}
	if !bytes.Equal(blob, []byte{0, 0, 0}) {
		t.Fatalf("native output buffer was not cleared: %v", blob)
	}
}

func TestNativeCredentialDeleteValidatesAndMapsErrors(t *testing.T) {
	isolateNativeCredentialCalls(t)
	api := nativeCredentialAPI{}
	if err := api.Delete("bad\x00target", credentialTypeGeneric); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("invalid target error=%v", err)
	}
	credentialDeleteCall = func(*uint16, uint32) (uintptr, error) {
		return 0, syscall.Errno(windows.ERROR_ACCESS_DENIED)
	}
	if err := api.Delete("denied", credentialTypeGeneric); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("native delete error=%v", err)
	}
	credentialDeleteCall = func(*uint16, uint32) (uintptr, error) { return 1, nil }
	if err := api.Delete("deleted", credentialTypeGeneric); err != nil {
		t.Fatalf("native delete success error=%v", err)
	}
}

func TestNativeCredentialEnumerateValidatesEveryResultShape(t *testing.T) {
	isolateNativeCredentialCalls(t)
	api := nativeCredentialAPI{}
	if _, err := api.Enumerate("bad\x00filter"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("invalid filter error=%v", err)
	}
	credentialEnumCall = func(*uint16, *uint32, ***nativeCredential) (uintptr, error) {
		return 0, syscall.Errno(windows.ERROR_ACCESS_DENIED)
	}
	if _, err := api.Enumerate("denied*"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("native enumerate error=%v", err)
	}

	setResult := func(count uint32, credentials **nativeCredential) {
		credentialEnumCall = func(_ *uint16, outputCount *uint32, outputCredentials ***nativeCredential) (uintptr, error) {
			*outputCount = count
			*outputCredentials = credentials
			return 1, nil
		}
	}
	setResult(0, nil)
	if _, err := api.Enumerate("empty*"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("empty enumerate result error=%v", err)
	}
	placeholder := []*nativeCredential{{}}
	setResult(1025, &placeholder[0])
	if _, err := api.Enumerate("large*"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("large enumerate result error=%v", err)
	}
	setResult(1, nil)
	if _, err := api.Enumerate("nil-array*"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("nil enumerate array error=%v", err)
	}
	nilEntry := []*nativeCredential{nil}
	setResult(1, &nilEntry[0])
	if _, err := api.Enumerate("nil-entry*"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("nil enumerate entry error=%v", err)
	}
	emptyTarget := []*nativeCredential{{Type: credentialTypeGeneric}}
	setResult(1, &emptyTarget[0])
	if _, err := api.Enumerate("empty-target*"); !errors.Is(err, errNativeUnavailable) {
		t.Fatalf("empty enumerate target error=%v", err)
	}

	firstName, _ := windows.UTF16PtrFromString("MarketLens:MT5:test:first")
	secondName, _ := windows.UTF16PtrFromString("MarketLens:MT5:test:second")
	entries := []*nativeCredential{
		{TargetName: firstName, Type: credentialTypeGeneric},
		{TargetName: secondName, Type: credentialTypeGeneric},
	}
	setResult(uint32(len(entries)), &entries[0])
	targets, err := api.Enumerate("MarketLens:MT5:test:*")
	if err != nil || len(targets) != 2 || targets[0].TargetName != "MarketLens:MT5:test:first" ||
		targets[1].TargetName != "MarketLens:MT5:test:second" {
		t.Fatalf("native enumerate targets=%#v err=%v", targets, err)
	}
}

func TestClassifyNativeErrorIsSanitized(t *testing.T) {
	if !errors.Is(classifyNativeError(syscall.Errno(windows.ERROR_NOT_FOUND)), errNativeNotFound) {
		t.Fatal("native not-found was not classified")
	}
	for _, err := range []error{syscall.Errno(windows.ERROR_ACCESS_DENIED), errors.New("detail")} {
		if !errors.Is(classifyNativeError(err), errNativeUnavailable) {
			t.Fatalf("native error was not sanitized: %v", err)
		}
	}
}
