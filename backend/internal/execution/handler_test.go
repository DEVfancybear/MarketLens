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
	pairingOwner      string
	pairingTTL        int
	pairingCalls      int
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
