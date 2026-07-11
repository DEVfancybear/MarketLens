package simtrading

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/smc-trading-terminal/backend/internal/auth"
)

type handlerStore struct {
	accountID string
	status    string
	position  PositionWrite
	reset     bool
}

func (s *handlerStore) ListAccounts(context.Context, string) ([]Account, error) {
	return []Account{{ID: "account-1", Name: "Default", StartingEquity: 10_000, Equity: 10_000, Currency: "USD"}}, nil
}
func (s *handlerStore) CreateAccount(_ context.Context, _ string, in AccountWrite) (Account, error) {
	return Account{ID: "account-1", Name: in.Name, StartingEquity: in.StartingEquity, Equity: in.StartingEquity, Currency: in.Currency}, nil
}
func (s *handlerStore) UpdateAccount(_ context.Context, _, id string, in AccountWrite) (Account, error) {
	return Account{ID: id, Name: in.Name, StartingEquity: in.StartingEquity, Equity: in.StartingEquity, Currency: in.Currency}, nil
}
func (s *handlerStore) DeleteAccount(context.Context, string, string) error { return nil }
func (s *handlerStore) ResetAccount(_ context.Context, _, id string) (Account, error) {
	s.reset = true
	return Account{ID: id, Name: "Default", StartingEquity: 10_000, Equity: 10_000, Currency: "USD"}, nil
}
func (s *handlerStore) ListPositions(_ context.Context, _, accountID, status string) ([]Position, error) {
	s.accountID, s.status = accountID, status
	return []Position{}, nil
}
func (s *handlerStore) UpsertPosition(_ context.Context, _, accountID string, in PositionWrite) (Position, error) {
	s.accountID, s.position = accountID, in
	return Position{ID: "server-position-1", ClientID: in.ClientID, Status: in.Status}, nil
}
func (s *handlerStore) Analytics(context.Context, string, string) (Analytics, error) {
	return Analytics{Summary: AnalyticsSummary{TotalTrades: 2, WinRate: 50}}, nil
}

func simTestApp(store Store) *fiber.App {
	app := fiber.New()
	requireAuth := func(c *fiber.Ctx) error {
		c.Locals(auth.LocalUserID, "11111111-1111-4111-8111-111111111111")
		return c.Next()
	}
	NewHandler(store, requireAuth).Register(app.Group("/api/v1"))
	return app
}

func simRequest(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req, -1)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestHandlerPositionUpsertAndStatusFilter(t *testing.T) {
	store := &handlerStore{}
	app := simTestApp(store)
	resp := simRequest(t, app, http.MethodGet, "/api/v1/sim/accounts/account-1/positions?status=open", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || store.accountID != "account-1" || store.status != "open" {
		t.Fatalf("list status=%d account=%q filter=%q", resp.StatusCode, store.accountID, store.status)
	}

	body := `{"clientId":"pos-local-1","symbol":"EURUSD","side":"long","type":"market","status":"open","entry":1.1,"quantity":2,"remaining":2,"riskAmount":100,"realizedPnl":0,"unrealizedPnl":5,"fills":[],"openTime":"2026-07-11T01:00:00Z"}`
	resp = simRequest(t, app, http.MethodPost, "/api/v1/sim/accounts/account-1/orders", body)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || store.position.ClientID != "pos-local-1" || store.position.Status != "open" {
		t.Fatalf("upsert status=%d position=%+v", resp.StatusCode, store.position)
	}
}

func TestHandlerResetCloseAndAnalytics(t *testing.T) {
	store := &handlerStore{}
	app := simTestApp(store)
	resp := simRequest(t, app, http.MethodPost, "/api/v1/sim/accounts/account-1/reset", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !store.reset {
		t.Fatalf("reset status=%d called=%v", resp.StatusCode, store.reset)
	}

	body := `{"accountId":"account-1","clientId":"pos-local-1","symbol":"EURUSD","side":"long","type":"market","entry":1.1,"quantity":2,"remaining":0,"riskAmount":100,"realizedPnl":20,"unrealizedPnl":0,"fills":[],"closeTime":"2026-07-11T02:00:00Z"}`
	resp = simRequest(t, app, http.MethodPost, "/api/v1/sim/positions/server-position-1/close", body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK || store.position.Status != "closed" || store.position.ClientID != "pos-local-1" {
		t.Fatalf("close status=%d position=%+v", resp.StatusCode, store.position)
	}

	resp = simRequest(t, app, http.MethodGet, "/api/v1/sim/accounts/account-1/analytics", "")
	defer resp.Body.Close()
	var report Analytics
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&report) != nil || report.Summary.TotalTrades != 2 {
		t.Fatalf("analytics status=%d report=%+v", resp.StatusCode, report)
	}
}

func TestHandlerRejectsInvalidJSON(t *testing.T) {
	resp := simRequest(t, simTestApp(&handlerStore{}), http.MethodPost, "/api/v1/sim/accounts", "{")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}
