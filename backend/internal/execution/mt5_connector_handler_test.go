package execution

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/marketlens/backend/internal/auth"
	"github.com/marketlens/backend/internal/mt5vault"
)

type connectorGatewayFake struct {
	fakeGateway
	reserved       MT5ConnectorReserveRequest
	reserveResult  MT5ConnectorAccount
	activated      MT5ConnectorActivateRequest
	activateResult MT5ConnectorAccount
	aborted        MT5ConnectorAbortRequest
	current        MT5ConnectorAccount
	getOwner       string
	readOwner      string
	historyOwner   string
	prepared       MT5ConnectorAccount
	finalized      struct {
		ownerID, accountID, secretRef, pendingSecretRef string
		revision                                        uint64
	}
	grant MT5CredentialGrantConsumeRequest
	err   error
}

func (f *connectorGatewayFake) MT5ConnectorReadState(_ context.Context, ownerID, _ string) (json.RawMessage, error) {
	f.readOwner = ownerID
	return json.RawMessage(`{"account":{"currency":"USD","balance":"100.00"},"positions":[],"pendingOrders":[],"instruments":[],"freshness":{"account":"fresh","positions":"fresh","pendingOrders":"fresh","instruments":"fresh"}}`), f.err
}

func (f *connectorGatewayFake) MT5ConnectorHistory(_ context.Context, ownerID, _ string, _, _ int64, _ int, _ string) (json.RawMessage, error) {
	f.historyOwner = ownerID
	return json.RawMessage(`{"orders":[],"deals":[],"coverage":"complete","nextCursor":""}`), f.err
}

func (f *connectorGatewayFake) ReserveMT5ConnectorAccount(_ context.Context, request MT5ConnectorReserveRequest) (MT5ConnectorAccount, error) {
	f.reserved = request
	if f.reserveResult.AccountID != "" {
		return f.reserveResult, f.err
	}
	return MT5ConnectorAccount{AccountID: request.AccountID, ConnectionRevision: 1, Created: true}, f.err
}
func (f *connectorGatewayFake) ActivateMT5ConnectorAccount(_ context.Context, request MT5ConnectorActivateRequest) (MT5ConnectorAccount, error) {
	f.activated = request
	if f.activateResult.AccountID != "" {
		return f.activateResult, f.err
	}
	return MT5ConnectorAccount{AccountID: request.AccountID, ConnectionStatus: "queued", ConnectionRevision: 2}, f.err
}
func (f *connectorGatewayFake) AbortMT5ConnectorAccount(_ context.Context, request MT5ConnectorAbortRequest) error {
	f.aborted = request
	return nil
}

func (f *connectorGatewayFake) MT5ConnectorAccount(_ context.Context, ownerID, accountID string) (MT5ConnectorAccount, error) {
	f.getOwner = ownerID
	if f.current.AccountID != "" {
		return f.current, f.err
	}
	return MT5ConnectorAccount{AccountID: accountID, ConnectionRevision: 2, Label: "Demo", Persistence: "managed"}, f.err
}
func (f *connectorGatewayFake) ReconnectMT5ConnectorAccount(_ context.Context, _, accountID string, revision uint64) (MT5ConnectorAccount, error) {
	return MT5ConnectorAccount{AccountID: accountID, ConnectionStatus: "reconnecting", ConnectionRevision: revision + 1}, f.err
}
func (f *connectorGatewayFake) DisconnectMT5ConnectorAccount(_ context.Context, _, accountID string, revision uint64) (MT5ConnectorAccount, error) {
	return MT5ConnectorAccount{AccountID: accountID, ConnectionStatus: "disconnected", ConnectionRevision: revision + 1}, f.err
}
func (f *connectorGatewayFake) PrepareDeleteMT5ConnectorAccount(_ context.Context, _, accountID string, revision uint64) (MT5ConnectorAccount, error) {
	if f.prepared.AccountID != "" {
		return f.prepared, f.err
	}
	return MT5ConnectorAccount{AccountID: accountID, ConnectionRevision: revision + 1, Ready: true}, f.err
}
func (f *connectorGatewayFake) FinalizeDeleteMT5ConnectorAccount(_ context.Context, ownerID, accountID, secretRef, pendingSecretRef string, revision uint64) error {
	f.finalized.ownerID = ownerID
	f.finalized.accountID = accountID
	f.finalized.secretRef = secretRef
	f.finalized.pendingSecretRef = pendingSecretRef
	f.finalized.revision = revision
	return f.err
}
func (f *connectorGatewayFake) ConsumeMT5CredentialGrant(_ context.Context, request MT5CredentialGrantConsumeRequest) (MT5CredentialGrant, error) {
	f.grant = request
	return MT5CredentialGrant{SecretRef: "mt5-0123456789abcdef0123456789abcdef", Persistence: "session"}, f.err
}

type connectorVaultFake struct {
	credential mt5vault.Credential
	putRef     string
	deleted    []string
	putErr     error
}

func (f *connectorVaultFake) Put(_ context.Context, ref string, credential mt5vault.Credential) error {
	f.putRef, f.credential = ref, credential
	return f.putErr
}
func (f *connectorVaultFake) Get(context.Context, string) (mt5vault.Credential, error) {
	return f.credential, nil
}
func (f *connectorVaultFake) Delete(_ context.Context, ref string) error {
	f.deleted = append(f.deleted, ref)
	return nil
}

func connectorTestApp(gateway *connectorGatewayFake, vault *connectorVaultFake) *fiber.App {
	app := fiber.New()
	requireAuth := func(c fiber.Ctx) error {
		c.Locals(auth.LocalUserID, "11111111-1111-4111-8111-111111111111")
		return c.Next()
	}
	NewHandler(gateway, requireAuth, func(c fiber.Ctx) error { return c.Next() }).
		WithMT5ConnectorVault(vault).
		Register(app.Group("/api/v1"))
	return app
}

func TestManagedMT5ConnectKeepsPasswordOutOfGatewayAndPublicResponse(t *testing.T) {
	gateway, vault := &connectorGatewayFake{}, &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	body := `{"platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Primary demo","persistence":"managed"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/mt5/accounts", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusAccepted || strings.Contains(string(responseBody), "private-value") || strings.Contains(string(responseBody), vault.putRef) {
		t.Fatalf("status=%d body=%s", response.StatusCode, responseBody)
	}
	if gateway.reserved.OwnerID != "11111111-1111-4111-8111-111111111111" || gateway.reserved.MaskedLoginSuffix != "5678" {
		t.Fatalf("unsafe owner projection: %#v", gateway.reserved)
	}
	if gateway.activated.SecretRef != vault.putRef || gateway.activated.Server != "Broker-Demo" || vault.credential.Password != "private-value" {
		t.Fatal("vault write was not completed before activation")
	}
}

func TestManagedMT5ConnectCompensatesFailedVaultWriteWithoutLeakingError(t *testing.T) {
	gateway := &connectorGatewayFake{}
	vault := &connectorVaultFake{putErr: errors.New("vault detail must stay private")}
	app := connectorTestApp(gateway, vault)
	body := `{"platform":"mt5","login":"12345678","password":"never-log-me","server":"Broker-Demo","label":"Demo","persistence":"managed"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/mt5/accounts", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusServiceUnavailable || gateway.aborted.AccountID == "" {
		t.Fatalf("status=%d abort=%#v", response.StatusCode, gateway.aborted)
	}
	if strings.Contains(string(responseBody), "never-log-me") || strings.Contains(string(responseBody), "vault detail") {
		t.Fatalf("error leaked secret detail: %s", responseBody)
	}
}

func TestPrivateCredentialGrantDeletesSessionSecretBeforeResponding(t *testing.T) {
	gateway := &connectorGatewayFake{}
	vault := &connectorVaultFake{credential: mt5vault.Credential{Login: "12345678", Password: "one-use", Server: "Broker-Demo"}}
	app := connectorTestApp(gateway, vault)
	body := `{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":2,"accountId":"mt5vm-account","leaseGeneration":3,"commandId":"11111111-1111-4111-8111-111111111111","grantToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution-workers/mt5/credential-grants/consume", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || !strings.Contains(string(responseBody), `"password":"one-use"`) {
		t.Fatalf("status=%d body=%s", response.StatusCode, responseBody)
	}
	if len(vault.deleted) != 1 || gateway.grant.WorkerID != "worker-01" {
		t.Fatalf("grant=%#v deleted=%v", gateway.grant, vault.deleted)
	}
	if response.Header.Get(fiber.HeaderCacheControl) != "no-store" {
		t.Fatal("credential response is cacheable")
	}
}

func TestManagedMT5StatusIsOwnerScopedAndRedactsSecretReferences(t *testing.T) {
	gateway := &connectorGatewayFake{current: MT5ConnectorAccount{
		AccountID: "mt5vm-account", ConnectionStatus: "ready", ConnectionRevision: 4,
		SecretRef: "mt5-11111111111111111111111111111111", PreviousSecretRef: "mt5-22222222222222222222222222222222",
	}}
	app := connectorTestApp(gateway, &connectorVaultFake{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/execution/connectors/accounts/mt5vm-account", nil)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || gateway.getOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("status=%d owner=%q body=%s", response.StatusCode, gateway.getOwner, responseBody)
	}
	if strings.Contains(string(responseBody), "secretRef") || strings.Contains(string(responseBody), "1111111111111111") {
		t.Fatalf("public status leaked an opaque secret reference: %s", responseBody)
	}
}

func TestManagedMT5ReadStateIsOwnerScopedAndContainsNoInternalIdentifiers(t *testing.T) {
	gateway := &connectorGatewayFake{}
	app := connectorTestApp(gateway, &connectorVaultFake{})
	request := httptest.NewRequest(http.MethodGet, "/api/v1/execution/connectors/accounts/mt5vm-account/snapshot", nil)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || gateway.readOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("status=%d owner=%q body=%s", response.StatusCode, gateway.readOwner, body)
	}
	for _, forbidden := range []string{"password", "secretRef", "workerId", "terminalPath", "rawLogin"} {
		if strings.Contains(string(body), forbidden) {
			t.Fatalf("snapshot leaked %s: %s", forbidden, body)
		}
	}
}

func TestManagedMT5HistoryIsOwnerScopedAndRejectsUnboundedQueries(t *testing.T) {
	gateway := &connectorGatewayFake{}
	app := connectorTestApp(gateway, &connectorVaultFake{})
	valid := httptest.NewRequest(http.MethodGet, "/api/v1/execution/connectors/accounts/mt5vm-account/history?fromMs=1760000000000&toMs=1760003600000&limit=100", nil)
	response, err := app.Test(valid)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK || gateway.historyOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("status=%d owner=%q", response.StatusCode, gateway.historyOwner)
	}

	unbounded := httptest.NewRequest(http.MethodGet, "/api/v1/execution/connectors/accounts/mt5vm-account/history?fromMs=1&toMs=1760003600000&limit=100000", nil)
	response, err = app.Test(unbounded)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("unbounded history status=%d", response.StatusCode)
	}
}

func TestManagedMT5CredentialRotationDeletesPreviousVersionAfterActivation(t *testing.T) {
	const oldRef = "mt5-11111111111111111111111111111111"
	gateway := &connectorGatewayFake{
		current: MT5ConnectorAccount{
			AccountID: "mt5vm-account", Label: "Demo", Persistence: "managed", ConnectionRevision: 4,
		},
		reserveResult: MT5ConnectorAccount{
			AccountID: "mt5vm-account", ConnectionRevision: 5, PreviousSecretRef: oldRef,
		},
		activateResult: MT5ConnectorAccount{
			AccountID: "mt5vm-account", ConnectionStatus: "queued", ConnectionRevision: 6,
		},
	}
	vault := &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	body := `{"expectedRevision":4,"login":"87654321","password":"rotated-value","server":"Broker-Live"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/accounts/mt5vm-account/reconnect", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusAccepted || strings.Contains(string(responseBody), "rotated-value") || strings.Contains(string(responseBody), oldRef) {
		t.Fatalf("status=%d body=%s", response.StatusCode, responseBody)
	}
	if vault.putRef == "" || vault.putRef == oldRef || gateway.activated.SecretRef != vault.putRef {
		t.Fatalf("rotation was not activated from the new vault reference: put=%q activate=%#v", vault.putRef, gateway.activated)
	}
	if len(vault.deleted) != 1 || vault.deleted[0] != oldRef {
		t.Fatalf("old credential version was not permanently deleted: %v", vault.deleted)
	}
}

func TestManagedMT5DeleteRemovesEveryCredentialBeforeFinalizing(t *testing.T) {
	const activeRef = "mt5-11111111111111111111111111111111"
	const pendingRef = "mt5-22222222222222222222222222222222"
	gateway := &connectorGatewayFake{prepared: MT5ConnectorAccount{
		AccountID: "mt5vm-account", ConnectionStatus: "disconnected", ConnectionRevision: 8,
		SecretRef: activeRef, PreviousSecretRef: pendingRef, Ready: true,
	}}
	vault := &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	request := httptest.NewRequest(http.MethodDelete, "/api/v1/execution/connectors/accounts/mt5vm-account", strings.NewReader(`{"expectedRevision":7}`))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || strings.Contains(string(responseBody), activeRef) || strings.Contains(string(responseBody), pendingRef) {
		t.Fatalf("status=%d body=%s", response.StatusCode, responseBody)
	}
	if len(vault.deleted) != 2 || vault.deleted[0] != activeRef || vault.deleted[1] != pendingRef {
		t.Fatalf("credential versions were not deleted before finalization: %v", vault.deleted)
	}
	if gateway.finalized.ownerID != "11111111-1111-4111-8111-111111111111" || gateway.finalized.accountID != "mt5vm-account" ||
		gateway.finalized.secretRef != activeRef || gateway.finalized.pendingSecretRef != pendingRef || gateway.finalized.revision != 8 {
		t.Fatalf("unsafe delete finalization: %#v", gateway.finalized)
	}
}
