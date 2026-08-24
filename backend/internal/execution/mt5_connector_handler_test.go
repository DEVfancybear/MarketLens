package execution

import (
	"bytes"
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
	"github.com/marketlens/backend/internal/mt5credentials"
	"github.com/rs/zerolog"
	zerologlog "github.com/rs/zerolog/log"
)

type connectorGatewayFake struct {
	fakeGateway
	reserved         MT5ConnectorReserveRequest
	reserveCalls     []MT5ConnectorReserveRequest
	reserveResult    MT5ConnectorAccount
	activated        MT5ConnectorActivateRequest
	activateResult   MT5ConnectorAccount
	aborted          MT5ConnectorAbortRequest
	current          MT5ConnectorAccount
	disconnectResult MT5ConnectorAccount
	getOwner         string
	readOwner        string
	historyOwner     string
	prepared         MT5ConnectorAccount
	finalized        struct {
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
	if f.disconnectResult.AccountID != "" {
		return f.disconnectResult, f.err
	}
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

type connectorCredentialStoreFake struct {
	credential mt5credentials.Credential
	putRef     string
	deleted    []string
	putErr     error
	getErr     error
	deleteErrs []error
	putCalls   int
}

func (f *connectorCredentialStoreFake) Put(_ context.Context, ref string, credential mt5credentials.Credential) error {
	f.putRef, f.credential = ref, credential
	f.putCalls++
	return f.putErr
}

func TestManagedMT5ConnectRequestIDIsIdempotent(t *testing.T) {
	gateway, credentialStore := &connectorGatewayFake{}, &connectorCredentialStoreFake{}
	app := connectorTestApp(gateway, credentialStore)
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
	if credentialStore.putCalls != 1 {
		t.Fatalf("request retry wrote the credential store %d times", credentialStore.putCalls)
	}
}
func (f *connectorCredentialStoreFake) Get(context.Context, string) (mt5credentials.Credential, error) {
	return f.credential, f.getErr
}
func (f *connectorCredentialStoreFake) Delete(_ context.Context, ref string) error {
	f.deleted = append(f.deleted, ref)
	if index := len(f.deleted) - 1; index < len(f.deleteErrs) {
		return f.deleteErrs[index]
	}
	return nil
}

func connectorTestApp(gateway *connectorGatewayFake, credentialStore *connectorCredentialStoreFake) *fiber.App {
	app := fiber.New()
	requireAuth := func(c fiber.Ctx) error {
		c.Locals(auth.LocalUserID, "11111111-1111-4111-8111-111111111111")
		return c.Next()
	}
	NewHandler(gateway, requireAuth, func(c fiber.Ctx) error { return c.Next() }).
		WithMT5CredentialStore(credentialStore, []byte("test-mt5-identity-secret-at-least-32-bytes")).
		Register(app.Group("/api/v1"))
	return app
}

func TestManagedMT5ConnectKeepsPasswordOutOfGatewayAndPublicResponse(t *testing.T) {
	gateway, credentialStore := &connectorGatewayFake{}, &connectorCredentialStoreFake{}
	app := connectorTestApp(gateway, credentialStore)
	body := `{"requestId":"22222222-2222-4222-8222-222222222222","platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Primary demo","persistence":"managed"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/mt5/accounts", strings.NewReader(body))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	responseBody, _ := io.ReadAll(response.Body)
	if response.StatusCode != http.StatusAccepted || strings.Contains(string(responseBody), "private-value") || strings.Contains(string(responseBody), credentialStore.putRef) {
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
	if gateway.activated.SecretRef != credentialStore.putRef || credentialStore.credential.Password != "private-value" {
		t.Fatal("credential-store write was not completed before activation")
	}
}

func TestManagedMT5ConnectCompensatesFailedCredentialStoreWriteWithoutLeakingError(t *testing.T) {
	gateway := &connectorGatewayFake{}
	credentialStore := &connectorCredentialStoreFake{putErr: errors.New("credential store detail must stay private")}
	app := connectorTestApp(gateway, credentialStore)
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
	if strings.Contains(string(responseBody), "never-log-me") || strings.Contains(string(responseBody), "credential store detail") {
		t.Fatalf("error leaked secret detail: %s", responseBody)
	}
}

func TestManagedMT5ConnectCompensatesFailedActivationAndDeletesOwnedSecret(t *testing.T) {
	gateway := &connectorGatewayFake{activateErr: errors.New("activation failed")}
	credentialStore := &connectorCredentialStoreFake{}
	app := connectorTestApp(gateway, credentialStore)
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
	if gateway.aborted.AccountID == "" || len(credentialStore.deleted) != 1 || credentialStore.deleted[0] != credentialStore.putRef {
		t.Fatalf("reservation was not safely compensated: abort=%#v deleted=%v put=%q", gateway.aborted, credentialStore.deleted, credentialStore.putRef)
	}
}

func TestPrivateCredentialGrantDeletesSessionSecretBeforeResponding(t *testing.T) {
	gateway := &connectorGatewayFake{}
	credentialStore := &connectorCredentialStoreFake{credential: mt5credentials.Credential{Login: "12345678", Password: "one-use", Server: "Broker-Demo"}}
	app := connectorTestApp(gateway, credentialStore)
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
	if len(credentialStore.deleted) != 1 || gateway.grant.WorkerID != "worker-01" || gateway.workerBearer != strings.Repeat("a", 64) {
		t.Fatalf("grant=%#v bearer=%q deleted=%v", gateway.grant, gateway.workerBearer, credentialStore.deleted)
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
	credentialStore := &connectorCredentialStoreFake{}
	app := connectorTestApp(gateway, credentialStore)
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
	if len(credentialStore.deleted) != 0 {
		t.Fatalf("lost reservation owner deleted shared secret: %v", credentialStore.deleted)
	}
}

func TestManagedMT5StatusIsOwnerScopedAndRedactsSecretReferences(t *testing.T) {
	gateway := &connectorGatewayFake{current: MT5ConnectorAccount{
		AccountID: "mt5vm-account", ConnectionStatus: "ready", ConnectionRevision: 4,
		SecretRef: "mt5-11111111111111111111111111111111", PreviousSecretRef: "mt5-22222222222222222222222222222222",
	}}
	app := connectorTestApp(gateway, &connectorCredentialStoreFake{})
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
	app := connectorTestApp(gateway, &connectorCredentialStoreFake{})
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
	app := connectorTestApp(gateway, &connectorCredentialStoreFake{})
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
	credentialStore := &connectorCredentialStoreFake{}
	app := connectorTestApp(gateway, credentialStore)
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
	if credentialStore.putRef == "" || credentialStore.putRef == oldRef || gateway.activated.SecretRef != credentialStore.putRef {
		t.Fatalf("rotation was not activated from the new credential-store reference: put=%q activate=%#v", credentialStore.putRef, gateway.activated)
	}
	if len(credentialStore.deleted) != 1 || credentialStore.deleted[0] != oldRef {
		t.Fatalf("old credential version was not permanently deleted: %v", credentialStore.deleted)
	}
}

func TestManagedMT5CredentialRotationCompensatesStoreAndActivationFailures(t *testing.T) {
	for _, test := range []struct {
		name        string
		putErr      error
		activateErr error
	}{
		{name: "credential store write", putErr: errors.New("credential store write failed")},
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
			credentialStore := &connectorCredentialStoreFake{putErr: test.putErr}
			app := connectorTestApp(gateway, credentialStore)
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
			if gateway.aborted.AccountID == "" || len(credentialStore.deleted) != 1 || credentialStore.deleted[0] != credentialStore.putRef {
				t.Fatalf("rotation was not compensated: abort=%#v deleted=%v put=%q", gateway.aborted, credentialStore.deleted, credentialStore.putRef)
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
	credentialStore := &connectorCredentialStoreFake{}
	app := connectorTestApp(gateway, credentialStore)
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
	if len(credentialStore.deleted) != 2 || credentialStore.deleted[0] != activeRef || credentialStore.deleted[1] != pendingRef {
		t.Fatalf("credential versions were not deleted before finalization: %v", credentialStore.deleted)
	}
	if gateway.finalized.ownerID != "11111111-1111-4111-8111-111111111111" || gateway.finalized.accountID != "mt5vm-account" ||
		gateway.finalized.secretRef != activeRef || gateway.finalized.pendingSecretRef != pendingRef || gateway.finalized.revision != 8 {
		t.Fatalf("unsafe delete finalization: %#v", gateway.finalized)
	}
}

func TestManagedMT5CredentialStoreFailuresBlockUnsafeProgress(t *testing.T) {
	const (
		activeRef  = "mt5-11111111111111111111111111111111"
		pendingRef = "mt5-22222222222222222222222222222222"
	)
	nativeDetail := errors.New("native detail must stay private")
	var logOutput bytes.Buffer
	originalLogger := zerologlog.Logger
	zerologlog.Logger = zerolog.New(&logOutput)
	defer func() { zerologlog.Logger = originalLogger }()

	t.Run("connect write", func(t *testing.T) {
		store := &connectorCredentialStoreFake{putErr: nativeDetail}
		app := connectorTestApp(&connectorGatewayFake{}, store)
		request := httptest.NewRequest(
			http.MethodPost,
			"/api/v1/execution/connectors/mt5/accounts",
			strings.NewReader(`{"requestId":"55555555-5555-4555-8555-555555555555","platform":"mt5","login":"12345678","password":"private-value","server":"Broker-Demo","label":"Demo","persistence":"managed"}`),
		)
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		assertCredentialStoreFailureResponse(t, app, request, "private-value", store.putRef)
	})

	t.Run("old rotation version cleanup", func(t *testing.T) {
		gateway := &connectorGatewayFake{
			current: MT5ConnectorAccount{
				AccountID: "mt5vm-account", Label: "Demo", Persistence: "managed", ConnectionRevision: 4,
			},
			reserveResult: MT5ConnectorAccount{
				AccountID: "mt5vm-account", ConnectionRevision: 5, PreviousSecretRef: activeRef,
			},
		}
		store := &connectorCredentialStoreFake{deleteErrs: []error{nativeDetail}}
		app := connectorTestApp(gateway, store)
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
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		if response.StatusCode != http.StatusAccepted || strings.Contains(string(body), "rotated-value") || strings.Contains(string(body), activeRef) {
			t.Fatalf("rotation cleanup status=%d body=%s", response.StatusCode, body)
		}
		if len(store.deleted) != 1 || store.deleted[0] != activeRef {
			t.Fatalf("old rotation delete attempts=%v", store.deleted)
		}
	})

	t.Run("session disconnect deletion", func(t *testing.T) {
		gateway := &connectorGatewayFake{disconnectResult: MT5ConnectorAccount{
			AccountID: "mt5vm-account", ConnectionStatus: "disconnected", ConnectionRevision: 8,
			Persistence: "session", SecretRef: activeRef,
		}}
		store := &connectorCredentialStoreFake{deleteErrs: []error{nativeDetail}}
		app := connectorTestApp(gateway, store)
		request := httptest.NewRequest(http.MethodPost, "/api/v1/execution/connectors/accounts/mt5vm-account/disconnect", strings.NewReader(`{"expectedRevision":7}`))
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		assertCredentialStoreFailureResponse(t, app, request, activeRef, "")
		if len(store.deleted) != 1 || store.deleted[0] != activeRef {
			t.Fatalf("session delete attempts=%v", store.deleted)
		}
	})

	for _, test := range []struct {
		name         string
		deleteErrors []error
		wantAttempts []string
	}{
		{name: "active version deletion", deleteErrors: []error{nativeDetail}, wantAttempts: []string{activeRef}},
		{name: "pending version deletion", deleteErrors: []error{nil, nativeDetail}, wantAttempts: []string{activeRef, pendingRef}},
	} {
		t.Run(test.name, func(t *testing.T) {
			gateway := &connectorGatewayFake{prepared: MT5ConnectorAccount{
				AccountID: "mt5vm-account", ConnectionRevision: 8, Ready: true,
				SecretRef: activeRef, PreviousSecretRef: pendingRef,
			}}
			store := &connectorCredentialStoreFake{deleteErrs: test.deleteErrors}
			app := connectorTestApp(gateway, store)
			request := httptest.NewRequest(http.MethodDelete, "/api/v1/execution/connectors/accounts/mt5vm-account", strings.NewReader(`{"expectedRevision":7}`))
			request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			assertCredentialStoreFailureResponse(t, app, request, activeRef, pendingRef)
			if strings.Join(store.deleted, "|") != strings.Join(test.wantAttempts, "|") {
				t.Fatalf("delete attempts=%v want=%v", store.deleted, test.wantAttempts)
			}
			if gateway.finalized.accountID != "" {
				t.Fatalf("delete finalized after credential failure: %#v", gateway.finalized)
			}
		})
	}

	grantBody := `{"protocolVersion":1,"workerId":"worker-01","sessionGeneration":2,"accountId":"mt5vm-account","leaseGeneration":3,"commandId":"11111111-1111-4111-8111-111111111111","grantToken":"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"}`
	for _, test := range []struct {
		name        string
		store       *connectorCredentialStoreFake
		wantDeletes int
	}{
		{
			name:  "grant read",
			store: &connectorCredentialStoreFake{credential: mt5credentials.Credential{Password: "private-value"}, getErr: nativeDetail},
		},
		{
			name: "grant session deletion",
			store: &connectorCredentialStoreFake{
				credential: mt5credentials.Credential{Login: "12345678", Password: "private-value", Server: "Broker-Demo"},
				deleteErrs: []error{nativeDetail},
			},
			wantDeletes: 1,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			app := connectorTestApp(&connectorGatewayFake{}, test.store)
			request := httptest.NewRequest(http.MethodPost, "/api/v1/execution-workers/mt5/credential-grants/consume", strings.NewReader(grantBody))
			request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
			request.Header.Set(fiber.HeaderAuthorization, "Bearer "+strings.Repeat("a", 64))
			assertCredentialStoreFailureResponse(t, app, request, "private-value", activeRef)
			if len(test.store.deleted) != test.wantDeletes {
				t.Fatalf("grant delete attempts=%v", test.store.deleted)
			}
		})
	}
	if strings.Contains(logOutput.String(), "native detail must stay private") {
		t.Fatalf("credential-store native detail reached logs: %s", logOutput.String())
	}
}

func assertCredentialStoreFailureResponse(t *testing.T, app *fiber.App, request *http.Request, forbidden ...string) {
	t.Helper()
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("credential-store failure status=%d body=%s", response.StatusCode, body)
	}
	for _, value := range append(forbidden, "native detail must stay private") {
		if value != "" && strings.Contains(string(body), value) {
			t.Fatalf("credential-store failure leaked private value: %s", body)
		}
	}
}
