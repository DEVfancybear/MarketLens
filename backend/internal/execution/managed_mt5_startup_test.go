package execution

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/marketlens/backend/internal/mt5credentials"
)

type startupCredentialStoreFake struct {
	probeCalls       int
	probeErr         error
	probeHadDeadline bool
}

type startupCapabilityOnlyGateway struct {
	*fakeGateway
	enabled bool
}

func (gateway *startupCapabilityOnlyGateway) EnableMT5Connector() {
	gateway.enabled = true
}

func (gateway *startupCapabilityOnlyGateway) mt5ConnectorIsEnabled() bool {
	return gateway.enabled
}

func (store *startupCredentialStoreFake) Put(context.Context, string, mt5credentials.Credential) error {
	return nil
}

func (store *startupCredentialStoreFake) Get(context.Context, string) (mt5credentials.Credential, error) {
	return mt5credentials.Credential{}, nil
}

func (store *startupCredentialStoreFake) Delete(context.Context, string) error { return nil }

func (store *startupCredentialStoreFake) Probe(ctx context.Context) error {
	store.probeCalls++
	_, store.probeHadDeadline = ctx.Deadline()
	return store.probeErr
}

func TestManagedMT5StartupEnablesOnlyAfterIdentityAndProbeSucceed(t *testing.T) {
	setStartupIdentityKey(t)
	client := newStartupExecutionClient(t)
	store := &startupCredentialStoreFake{}
	handler := newHandlerWithCredentialStoreFactory(
		client,
		startupMiddleware,
		startupMiddleware,
		func() (mt5credentials.Store, error) { return store, nil },
	)

	if store.probeCalls != 1 || !store.probeHadDeadline {
		t.Fatalf("probe calls=%d deadline=%v", store.probeCalls, store.probeHadDeadline)
	}
	if handler.mt5CredentialStore != store || handler.mt5ConnectorGateway == nil || len(handler.mt5IdentityKey) != 32 {
		t.Fatal("credential store was not wired after successful readiness")
	}
	if !client.mt5ConnectorEnabled {
		t.Fatal("connector capability remained disabled after successful readiness")
	}
}

func TestManagedMT5StartupFailuresKeepCapabilityDisabled(t *testing.T) {
	tests := map[string]struct {
		prepare          func(*testing.T)
		factory          func(*startupCredentialStoreFake, *int) (mt5credentials.Store, error)
		wantFactoryCalls int
		wantProbeCalls   int
	}{
		"identity missing": {
			prepare: func(t *testing.T) { t.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", "") },
			factory: validStartupStoreFactory,
		},
		"identity unreadable": {
			prepare: func(t *testing.T) {
				t.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", filepath.Join(t.TempDir(), "missing"))
			},
			factory: validStartupStoreFactory,
		},
		"factory unavailable": {
			prepare: setStartupIdentityKey,
			factory: func(_ *startupCredentialStoreFake, calls *int) (mt5credentials.Store, error) {
				*calls++
				return nil, errors.New("native detail")
			},
			wantFactoryCalls: 1,
		},
		"factory returns nil": {
			prepare: setStartupIdentityKey,
			factory: func(_ *startupCredentialStoreFake, calls *int) (mt5credentials.Store, error) {
				*calls++
				return nil, nil
			},
			wantFactoryCalls: 1,
		},
		"probe unavailable": {
			prepare:          setStartupIdentityKey,
			factory:          validStartupStoreFactory,
			wantFactoryCalls: 1,
			wantProbeCalls:   1,
		},
	}
	for name, test := range tests {
		t.Run(name, func(t *testing.T) {
			test.prepare(t)
			client := newStartupExecutionClient(t)
			store := &startupCredentialStoreFake{}
			if name == "probe unavailable" {
				store.probeErr = errors.New("native detail")
			}
			factoryCalls := 0
			handler := newHandlerWithCredentialStoreFactory(
				client,
				startupMiddleware,
				startupMiddleware,
				func() (mt5credentials.Store, error) { return test.factory(store, &factoryCalls) },
			)
			if factoryCalls != test.wantFactoryCalls || store.probeCalls != test.wantProbeCalls {
				t.Fatalf("factory calls=%d probe calls=%d", factoryCalls, store.probeCalls)
			}
			if client.mt5ConnectorEnabled || handler.mt5CredentialStore != nil || handler.mt5ConnectorGateway != nil {
				t.Fatal("failed readiness advertised or wired managed MT5")
			}
		})
	}
}

func TestRequiredManagedMT5StartupPanicsWithSanitizedError(t *testing.T) {
	setStartupIdentityKey(t)
	client := newStartupExecutionClient(t)
	client.EnableMT5Connector()
	defer func() {
		value := recover()
		message, ok := value.(string)
		if !ok || message != "required MT5 credential store unavailable" || strings.Contains(message, "native detail") {
			t.Fatalf("unsafe required-store panic=%v", value)
		}
	}()
	newHandlerWithCredentialStoreFactory(
		client,
		startupMiddleware,
		startupMiddleware,
		func() (mt5credentials.Store, error) { return nil, errors.New("native detail") },
	)
}

func TestManagedMT5StartupRejectsGatewayWithoutConnectorContract(t *testing.T) {
	setStartupIdentityKey(t)
	gateway := &startupCapabilityOnlyGateway{fakeGateway: &fakeGateway{}}
	store := &startupCredentialStoreFake{}
	handler := newHandlerWithCredentialStoreFactory(
		gateway,
		startupMiddleware,
		startupMiddleware,
		func() (mt5credentials.Store, error) { return store, nil },
	)
	if store.probeCalls != 1 || gateway.enabled || handler.mt5ConnectorGateway != nil || handler.mt5CredentialStore != nil {
		t.Fatal("gateway without managed connector contract was enabled")
	}
}

func validStartupStoreFactory(store *startupCredentialStoreFake, calls *int) (mt5credentials.Store, error) {
	*calls++
	return store, nil
}

func setStartupIdentityKey(t *testing.T) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "identity-key")
	if err := os.WriteFile(path, []byte("managed-mt5-startup-identity-key-32-bytes"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("EXECUTION_MT5_IDENTITY_HMAC_KEY_FILE", path)
}

func newStartupExecutionClient(t *testing.T) *Client {
	t.Helper()
	client, err := NewClient("http://127.0.0.1:8788", strings.Repeat("a", 32))
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func startupMiddleware(c fiber.Ctx) error { return c.Next() }
