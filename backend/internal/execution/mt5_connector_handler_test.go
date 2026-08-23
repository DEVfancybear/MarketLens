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
	reserveCalls   []MT5ConnectorReserveRequest
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
	grant        MT5CredentialGrantConsumeRequest
	workerBearer string
	err          error
	activateErr  error
	abortErr     error
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
	f.reserveCalls = append(f.reserveCalls, request)
	if f.reserveResult.AccountID != "" {
		return f.reserveResult, f.err
	}
	return MT5ConnectorAccount{AccountID: request.AccountID, ConnectionRevision: 1, Created: true}, f.err
}
func (f *connectorGatewayFake) ActivateMT5ConnectorAccount(_ context.Context, request MT5ConnectorActivateRequest) (MT5ConnectorAccount, error) {
	f.activated = request
	if f.activateErr != nil {
		return MT5ConnectorAccount{}, f.activateErr
	}
	if f.activateResult.AccountID != "" {
		return f.activateResult, f.err
	}
	return MT5ConnectorAccount{AccountID: request.AccountID, ConnectionStatus: "queued", ConnectionRevision: 2}, f.err
}
func (f *connectorGatewayFake) AbortMT5ConnectorAccount(_ context.Context, request MT5ConnectorAbortRequest) error {
	f.aborted = request
	return f.abortErr
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
func (f *connectorGatewayFake) ConsumeMT5CredentialGrantAuthenticated(_ context.Context, request MT5CredentialGrantConsumeRequest, workerBearer string) (MT5CredentialGrant, error) {
	f.grant = request
	f.workerBearer = workerBearer
	return MT5CredentialGrant{SecretRef: "mt5-0123456789abcdef0123456789abcdef", Persistence: "session"}, f.err
}

type connectorVaultFake struct {
	credential mt5vault.Credential
	putRef     string
	deleted    []string
	putErr     error
	putCalls   int
}

func (f *connectorVaultFake) Put(_ context.Context, ref string, credential mt5vault.Credential) error {
	f.putRef, f.credential = ref, credential
	f.putCalls++
	return f.putErr
}

func TestManagedMT5ConnectRequestIDIsIdempotent(t *testing.T) {
	gateway, vault := &connectorGatewayFake{}, &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	body := `{"requestId":"11111111-1111-4111-8111-111111111111","platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Primary demo","persistence":"managed"}`

	for attempt := 0; attempt < 2; attempt++ {
		if attempt == 1 {
			gateway.reserveResult = MT5ConnectorAccount{
				AccountID: gateway.reserveCalls[0].AccountID, ConnectionStatus: "queued",
				ConnectionRevision: 2, Ready: true,
			}
		}
		request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/mt5/accounts", strings.NewReader(body))
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		response, err := app.Test(request)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusAccepted {
			t.Fatalf("attempt %d status=%d", attempt+1, response.StatusCode)
		}
	}

	if len(gateway.reserveCalls) != 2 || gateway.reserveCalls[0].AccountID != gateway.reserveCalls[1].AccountID {
		t.Fatalf("request retry did not keep one account: %#v", gateway.reserveCalls)
	}
	if vault.putCalls != 1 {
		t.Fatalf("request retry wrote Vault %d times", vault.putCalls)
	}
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
		WithMT5ConnectorVault(vault, []byte("test-mt5-identity-secret-at-least-32-bytes")).
		Register(app.Group("/api/v1"))
	return app
}

func TestManagedMT5ConnectKeepsPasswordOutOfGatewayAndPublicResponse(t *testing.T) {
	gateway, vault := &connectorGatewayFake{}, &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	body := `{"requestId":"22222222-2222-4222-8222-222222222222","platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Primary demo","persistence":"managed"}`
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
	if len(gateway.reserved.IdentityFingerprint) != 64 ||
		strings.Contains(gateway.reserved.IdentityFingerprint, "12345678") ||
		strings.Contains(gateway.reserved.IdentityFingerprint, "Broker-Demo") {
		t.Fatalf("managed identity fingerprint is missing or reversible: %#v", gateway.reserved)
	}
	if gateway.reserved.Server != "" || gateway.activated.Server != "" {
		t.Fatalf("exact server crossed the PostgreSQL DTO boundary: reserve=%q activate=%q", gateway.reserved.Server, gateway.activated.Server)
	}
	if gateway.activated.SecretRef != vault.putRef || vault.credential.Password != "private-value" {
		t.Fatal("vault write was not completed before activation")
	}
}

func TestManagedMT5ConnectCompensatesFailedVaultWriteWithoutLeakingError(t *testing.T) {
	gateway := &connectorGatewayFake{}
	vault := &connectorVaultFake{putErr: errors.New("vault detail must stay private")}
	app := connectorTestApp(gateway, vault)
	body := `{"requestId":"33333333-3333-4333-8333-333333333333","platform":"mt5","login":"12345678","password":"never-log-me","server":"Broker-Demo","label":"Demo","persistence":"managed"}`
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

func TestManagedMT5ConnectCompensatesFailedActivationAndDeletesOwnedSecret(t *testing.T) {
	gateway := &connectorGatewayFake{activateErr: errors.New("activation failed")}
	vault := &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/connectors/mt5/accounts",
		strings.NewReader(`{"requestId":"44444444-4444-4444-8444-444444444444","platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Demo","persistence":"managed"}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode < http.StatusBadRequest {
		t.Fatalf("activation failure status=%d", response.StatusCode)
	}
	if gateway.aborted.AccountID == "" || len(vault.deleted) != 1 || vault.deleted[0] != vault.putRef {
		t.Fatalf("reservation was not safely compensated: abort=%#v deleted=%v put=%q", gateway.aborted, vault.deleted, vault.putRef)
	}
}

func TestPrivateCredentialGrantDeletesSessionSecretBeforeResponding(t *testing.T) {
	gateway := &connectorGatewayFake{}
	vault := &connectorVaultFake{credential: mt5vault.Credential{Login: "12345678", Password: "one-use", Server: "Broker-Demo"}}
	app := connectorTestApp(gateway, vault)
	body := `{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":2,"accountId":"mt5vm-account","leaseGeneration":3,"commandId":"11111111-1111-4111-8111-111111111111","grantToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}`
	unauthenticated := httptest.NewRequest(http.MethodPost, "/api/v1/execution-workers/mt5/credential-grants/consume", strings.NewReader(body))
	unauthenticated.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	unauthenticatedResponse, err := app.Test(unauthenticated)
	if err != nil {
		t.Fatal(err)
	}
	unauthenticatedResponse.Body.Close()
	if unauthenticatedResponse.StatusCode != http.StatusUnauthorized || gateway.grant.WorkerID != "" {
		t.Fatalf("unauthenticated worker status=%d grant=%#v", unauthenticatedResponse.StatusCode, gateway.grant)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution-workers/mt5/credential-grants/consume", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	request.Header.Set(fiber.HeaderAuthorization, "Bearer "+strings.Repeat("a", 64))
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusOK || !strings.Contains(string(responseBody), `"password":"one-use"`) {
		t.Fatalf("status=%d body=%s", response.StatusCode, responseBody)
	}
	if len(vault.deleted) != 1 || gateway.grant.WorkerID != "worker-01" || gateway.workerBearer != strings.Repeat("a", 64) {
		t.Fatalf("grant=%#v bearer=%q deleted=%v", gateway.grant, gateway.workerBearer, vault.deleted)
	}
	if response.Header.Get(fiber.HeaderCacheControl) != "no-store" {
		t.Fatal("credential response is cacheable")
	}
}

func TestManagedMT5ShortLoginMaskIsNeverTheRawLogin(t *testing.T) {
	for _, login := range []string{"1", "12", "123", "1234"} {
		masked := loginSuffix(login)
		if masked == login || masked != "****" {
			t.Fatalf("login %q was projected as %q", login, masked)
		}
	}
	if masked := loginSuffix("12345"); masked != "2345" {
		t.Fatalf("long login suffix = %q", masked)
	}
}

func TestManagedMT5ActivationConflictCannotDeleteAnotherReservationOwnerSecret(t *testing.T) {
	gateway := &connectorGatewayFake{
		reserveResult: MT5ConnectorAccount{
			AccountID: "mt5vm-shared", ConnectionRevision: 7,
			SecretRef: "mt5-0123456789abcdef0123456789abcdef",
		},
		activateErr: errors.New("activation ownership changed"),
		abortErr:    errors.New("reservation ownership changed"),
	}
	vault := &connectorVaultFake{}
	app := connectorTestApp(gateway, vault)
	body := `{"requestId":"99999999-9999-4999-8999-999999999999","platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Demo","persistence":"managed"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/mt5/accounts", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode < 400 {
		t.Fatalf("activation conflict status=%d", response.StatusCode)
	}
	if len(vault.deleted) != 0 {
		t.Fatalf("lost reservation owner deleted shared secret: %v", vault.deleted)
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

func TestManagedMT5CredentialRotationCompensatesVaultAndActivationFailures(t *testing.T) {
	for _, test := range []struct {
		name        string
		putErr      error
		activateErr error
	}{
		{name: "vault write", putErr: errors.New("vault write failed")},
		{name: "activation", activateErr: errors.New("activation failed")},
	} {
		t.Run(test.name, func(t *testing.T) {
			gateway := &connectorGatewayFake{
				current: MT5ConnectorAccount{
					AccountID: "mt5vm-account", Label: "Demo", Persistence: "managed", ConnectionRevision: 4,
				},
				reserveResult: MT5ConnectorAccount{
					AccountID: "mt5vm-account", ConnectionRevision: 5,
				},
				activateErr: test.activateErr,
			}
			vault := &connectorVaultFake{putErr: test.putErr}
			app := connectorTestApp(gateway, vault)
			request := httptest.NewRequest(
				http.MethodPost,
				"/api/v1/execution/connectors/accounts/mt5vm-account/reconnect",
				strings.NewReader(`{"expectedRevision":4,"login":"87654321","password":"rotated-value","server":"Broker-Live"}`),
			)
			request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			response, err := app.Test(request)
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			if response.StatusCode < http.StatusBadRequest {
				t.Fatalf("rotation failure status=%d", response.StatusCode)
			}
			if gateway.aborted.AccountID == "" || len(vault.deleted) != 1 || vault.deleted[0] != vault.putRef {
				t.Fatalf("rotation was not compensated: abort=%#v deleted=%v put=%q", gateway.aborted, vault.deleted, vault.putRef)
			}
		})
	}
}

func TestManagedMT5ValidationRejectsMalformedIdentifiersBearersAndKeys(t *testing.T) {
	for _, requestID := range []string{
		"short",
		"11111111-1111-4111-8111-11111111111z",
	} {
		if validMT5RequestID(requestID) {
			t.Fatalf("malformed request id accepted: %q", requestID)
		}
	}
	for _, bearer := range []string{
		"Basic " + strings.Repeat("a", 64),
		"Bearer short",
		"Bearer " + strings.Repeat("A", 64),
	} {
		if mt5WorkerSessionBearer(bearer) != "" {
			t.Fatalf("malformed worker bearer accepted: %q", bearer)
		}
	}
	if mt5IdentityFingerprint([]byte("short"), "12345678", "Broker-Demo") != "" {
		t.Fatal("short managed identity key was accepted")
	}
	if mt5ServerFingerprint([]byte("short"), "Broker-Demo") != "" {
		t.Fatal("short managed server key was accepted")
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
