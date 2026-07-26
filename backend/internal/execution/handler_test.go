package execution

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/smc-trading-terminal/backend/internal/auth"
)

type fakeGateway struct {
	accountsOwner     string
	layoutOwner       string
	layoutUpdate      AccountLayoutUpdate
	layoutUpdateCalls int
	pairingOwner      string
	pairingTTL        int
	pairingCalls      int
	disconnectOwner   string
	disconnectAccount string
	removeOwner       string
	removeAccount     string
	orderOwner        string
	stateOwner        string
	stateAccount      string
	commandOwner      string
	commandCalls      int
	instrumentOwner   string
	instrumentAccount string
	mappingOwner      string
	mappingRequest    SymbolMappingRequest
	err               error
}

func (f *fakeGateway) AccountState(
	_ context.Context,
	ownerID string,
	accountID string,
) (json.RawMessage, error) {
	f.stateOwner = ownerID
	f.stateAccount = accountID
	return json.RawMessage(`{"accountId":"mt5_account","positions":[],"pendingOrders":[]}`), f.err
}

func (f *fakeGateway) QueueCommand(
	_ context.Context,
	ownerID string,
	_ CommandRequest,
) (json.RawMessage, error) {
	f.commandOwner = ownerID
	f.commandCalls++
	return json.RawMessage(`{"ok":true}`), f.err
}

func (f *fakeGateway) AccountInstruments(
	_ context.Context,
	ownerID string,
	accountID string,
) (json.RawMessage, error) {
	f.instrumentOwner = ownerID
	f.instrumentAccount = accountID
	return json.RawMessage(`{"accountId":"mt5_account","instruments":[],"mappings":[]}`), f.err
}

func (f *fakeGateway) UpsertSymbolMapping(
	_ context.Context,
	ownerID string,
	request SymbolMappingRequest,
) (json.RawMessage, error) {
	f.mappingOwner = ownerID
	f.mappingRequest = request
	return json.RawMessage(`{"canonicalSymbol":"EURUSD","venueSymbol":"EURUSDm","mappingSource":"user"}`), f.err
}

func (f *fakeGateway) RouteOrder(
	_ context.Context,
	ownerID string,
	_ OrderRequest,
) (json.RawMessage, error) {
	f.orderOwner = ownerID
	return json.RawMessage(`{"commandId":"command-1","targets":[]}`), f.err
}

func (f *fakeGateway) ListAccounts(_ context.Context, ownerID string) ([]Account, error) {
	f.accountsOwner = ownerID
	return []Account{{ID: "mt5_account", VenueKind: "metatrader5"}}, f.err
}

func (f *fakeGateway) AccountLayout(_ context.Context, ownerID string) (AccountLayout, error) {
	f.layoutOwner = ownerID
	return AccountLayout{ItemIDs: []string{"simulator:local", "mt5_account"}, Revision: 2}, f.err
}

func (f *fakeGateway) UpdateAccountLayout(
	_ context.Context,
	ownerID string,
	request AccountLayoutUpdate,
) (AccountLayout, error) {
	f.layoutOwner = ownerID
	f.layoutUpdate = request
	f.layoutUpdateCalls++
	return AccountLayout{ItemIDs: request.ItemIDs, Revision: request.ExpectedRevision + 1}, f.err
}

func (f *fakeGateway) IssuePairingToken(
	_ context.Context,
	ownerID string,
	expiresInSeconds int,
) (PairingToken, error) {
	f.pairingCalls++
	f.pairingOwner = ownerID
	f.pairingTTL = expiresInSeconds
	return PairingToken{Token: "secret", ExpiresAtMS: 123}, f.err
}

func (f *fakeGateway) DisconnectAccount(
	_ context.Context,
	ownerID string,
	accountID string,
) error {
	f.disconnectOwner = ownerID
	f.disconnectAccount = accountID
	return f.err
}

func (f *fakeGateway) RemoveAccount(
	_ context.Context,
	ownerID string,
	accountID string,
) error {
	f.removeOwner = ownerID
	f.removeAccount = accountID
	return f.err
}

func testApp(gateway Gateway) *fiber.App {
	app := fiber.New()
	requireAuth := func(c fiber.Ctx) error {
		c.Locals(auth.LocalUserID, "11111111-1111-4111-8111-111111111111")
		return c.Next()
	}
	NewHandler(gateway, requireAuth).Register(app.Group("/api/v1"))
	return app
}

func TestListAccountsAlwaysUsesAuthenticatedOwner(t *testing.T) {
	gateway := &fakeGateway{}
	response, err := testApp(gateway).Test(
		httptest.NewRequest(http.MethodGet, "/api/v1/execution/accounts?ownerId=attacker", nil),
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if gateway.accountsOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("gateway owner = %q", gateway.accountsOwner)
	}
}

func TestAccountLayoutAlwaysUsesAuthenticatedOwner(t *testing.T) {
	gateway := &fakeGateway{}
	response, err := testApp(gateway).Test(
		httptest.NewRequest(http.MethodGet, "/api/v1/execution/account-layout?ownerId=attacker", nil),
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if gateway.layoutOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("gateway owner = %q", gateway.layoutOwner)
	}
}

func TestUpdateAccountLayoutValidatesAndInjectsOwner(t *testing.T) {
	gateway := &fakeGateway{}
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/account-layout",
		strings.NewReader(`{"itemIds":["mt5_account","simulator:local"],"expectedRevision":3}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := testApp(gateway).Test(request)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if gateway.layoutOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("gateway owner = %q", gateway.layoutOwner)
	}
	if gateway.layoutUpdate.ExpectedRevision != 3 ||
		strings.Join(gateway.layoutUpdate.ItemIDs, ",") != "mt5_account,simulator:local" {
		t.Fatalf("unexpected layout update: %#v", gateway.layoutUpdate)
	}
}

func TestUpdateAccountLayoutRejectsDuplicatesAndClientOwner(t *testing.T) {
	for _, body := range []string{
		`{"itemIds":["mt5_account","mt5_account"],"expectedRevision":0}`,
		`{"ownerId":"attacker","itemIds":["mt5_account"],"expectedRevision":0}`,
		`{"itemIds":["simulator:a","simulator:b"],"expectedRevision":0}`,
	} {
		gateway := &fakeGateway{}
		request := httptest.NewRequest(
			http.MethodPost,
			"/api/v1/execution/account-layout",
			strings.NewReader(body),
		)
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
		response, err := testApp(gateway).Test(request)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusBadRequest {
			t.Fatalf("body %s: status = %d, want 400", body, response.StatusCode)
		}
		if gateway.layoutUpdateCalls != 0 {
			t.Fatalf("body %s: gateway must not be called", body)
		}
	}
}

func TestPairingRejectsClientSuppliedOwner(t *testing.T) {
	gateway := &fakeGateway{}
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/pairing-tokens",
		strings.NewReader(`{"ownerId":"attacker","expiresInSeconds":300}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := testApp(gateway).Test(request)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
	if gateway.pairingCalls != 0 {
		t.Fatal("gateway must not be called for a client-supplied owner")
	}
}

func TestPairingUsesAuthenticatedOwnerAndNoStore(t *testing.T) {
	gateway := &fakeGateway{}
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/pairing-tokens",
		strings.NewReader(`{"expiresInSeconds":120}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := testApp(gateway).Test(request)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}
	if gateway.pairingOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("gateway owner = %q", gateway.pairingOwner)
	}
	if gateway.pairingTTL != 120 {
		t.Fatalf("pairing TTL = %d, want 120", gateway.pairingTTL)
	}
	if response.Header.Get(fiber.HeaderCacheControl) != "no-store" {
		t.Fatal("pairing token response must disable caching")
	}
}

func TestAccountManagementAlwaysUsesAuthenticatedOwner(t *testing.T) {
	gateway := &fakeGateway{}
	app := testApp(gateway)
	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: "/api/v1/execution/accounts/mt5_account/disconnect"},
		{method: http.MethodDelete, path: "/api/v1/execution/accounts/mt5_account"},
	} {
		response, err := app.Test(httptest.NewRequest(test.method, test.path, nil))
		if err != nil {
			t.Fatalf("%s %s: %v", test.method, test.path, err)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK {
			t.Fatalf("%s %s status = %d, want 200", test.method, test.path, response.StatusCode)
		}
		if response.Header.Get(fiber.HeaderCacheControl) != "no-store" {
			t.Fatalf("%s %s must disable caching", test.method, test.path)
		}
	}
	const owner = "11111111-1111-4111-8111-111111111111"
	if gateway.disconnectOwner != owner || gateway.disconnectAccount != "mt5_account" {
		t.Fatalf("unexpected disconnect scope: owner=%q account=%q", gateway.disconnectOwner, gateway.disconnectAccount)
	}
	if gateway.removeOwner != owner || gateway.removeAccount != "mt5_account" {
		t.Fatalf("unexpected remove scope: owner=%q account=%q", gateway.removeOwner, gateway.removeAccount)
	}
}

func TestAccountManagementRejectsInvalidIdentifierBeforeGateway(t *testing.T) {
	gateway := &fakeGateway{}
	response, err := testApp(gateway).Test(httptest.NewRequest(
		http.MethodDelete,
		"/api/v1/execution/accounts/not%20safe",
		nil,
	))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.StatusCode)
	}
	if gateway.removeOwner != "" {
		t.Fatal("invalid account id must not reach the gateway")
	}
}

func TestGatewayAuthenticationFailureIsNotExposedToBrowser(t *testing.T) {
	gateway := &fakeGateway{err: &GatewayError{Status: http.StatusUnauthorized}}
	response, err := testApp(gateway).Test(
		httptest.NewRequest(http.MethodGet, "/api/v1/execution/accounts", nil),
	)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if errors.Is(gateway.err, context.Canceled) {
		t.Fatal("unexpected error mutation")
	}
}

func TestOrderOwnerAlwaysComesFromAuthenticatedSession(t *testing.T) {
	gateway := &fakeGateway{}
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/orders",
		strings.NewReader(
			`{"intent":{"commandId":"command-1"},"targets":[{"accountId":"mt5_account"}]}`,
		),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := testApp(gateway).Test(request)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusAccepted {
		t.Fatalf("status = %d, want 202", response.StatusCode)
	}
	if gateway.orderOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("gateway owner = %q", gateway.orderOwner)
	}

	attackerRequest := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/orders",
		strings.NewReader(
			`{"ownerId":"attacker","intent":{},"targets":[]}`,
		),
	)
	attackerRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	attackerResponse, err := testApp(gateway).Test(attackerRequest)
	if err != nil {
		t.Fatalf("attacker request: %v", err)
	}
	defer attackerResponse.Body.Close()
	if attackerResponse.StatusCode != http.StatusBadRequest {
		t.Fatalf("attacker status = %d, want 400", attackerResponse.StatusCode)
	}
}

func TestAccountStateAndCommandAlwaysUseAuthenticatedOwner(t *testing.T) {
	gateway := &fakeGateway{}
	response, err := testApp(gateway).Test(httptest.NewRequest(
		http.MethodGet,
		"/api/v1/execution/account-state?accountId=mt5_account&ownerId=attacker",
		nil,
	))
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("state status=%d err=%v", response.StatusCode, err)
	}
	if gateway.stateOwner != "11111111-1111-4111-8111-111111111111" ||
		gateway.stateAccount != "mt5_account" {
		t.Fatalf("unexpected account state scope: %+v", gateway)
	}

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/commands",
		strings.NewReader(`{"command":{"type":"cancelOrder"}}`),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err = testApp(gateway).Test(request)
	if err != nil || response.StatusCode != http.StatusAccepted {
		t.Fatalf("command status=%d err=%v", response.StatusCode, err)
	}
	if gateway.commandOwner != "11111111-1111-4111-8111-111111111111" {
		t.Fatalf("unexpected command owner=%q", gateway.commandOwner)
	}

	attacker := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/commands",
		strings.NewReader(`{"ownerId":"attacker","command":{}}`),
	)
	attacker.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err = testApp(gateway).Test(attacker)
	if err != nil || response.StatusCode != http.StatusBadRequest {
		t.Fatalf("attacker command status=%d err=%v", response.StatusCode, err)
	}
	if gateway.commandCalls != 1 {
		t.Fatalf("invalid command reached gateway %d times", gateway.commandCalls)
	}
}

func TestSymbolMappingAlwaysUsesAuthenticatedOwner(t *testing.T) {
	gateway := &fakeGateway{}
	response, err := testApp(gateway).Test(httptest.NewRequest(
		http.MethodGet,
		"/api/v1/execution/instruments?accountId=mt5_account&ownerId=attacker",
		nil,
	))
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("instruments status=%d err=%v", response.StatusCode, err)
	}
	if gateway.instrumentOwner != "11111111-1111-4111-8111-111111111111" ||
		gateway.instrumentAccount != "mt5_account" {
		t.Fatalf("unexpected instrument scope: %+v", gateway)
	}

	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/symbol-mappings",
		strings.NewReader(
			`{"accountId":"mt5_account","canonicalSymbol":"EURUSD","venueSymbol":"EURUSDm"}`,
		),
	)
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err = testApp(gateway).Test(request)
	if err != nil || response.StatusCode != http.StatusOK {
		t.Fatalf("mapping status=%d err=%v", response.StatusCode, err)
	}
	if gateway.mappingOwner != "11111111-1111-4111-8111-111111111111" ||
		gateway.mappingRequest.AccountID != "mt5_account" {
		t.Fatalf("unexpected mapping scope: %+v", gateway)
	}

	attacker := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/execution/symbol-mappings",
		strings.NewReader(
			`{"ownerId":"attacker","accountId":"mt5_account","canonicalSymbol":"EURUSD","venueSymbol":"EURUSDm"}`,
		),
	)
	attacker.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err = testApp(gateway).Test(attacker)
	if err != nil || response.StatusCode != http.StatusBadRequest {
		t.Fatalf("attacker mapping status=%d err=%v", response.StatusCode, err)
	}
}
