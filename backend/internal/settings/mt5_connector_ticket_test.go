package settings

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

type connectorTicketResponse struct {
	OK        bool   `json:"ok"`
	Ticket    string `json:"ticket"`
	ExpiresAt int64  `json:"expiresAt"`
	Account   struct {
		Login  string `json:"login"`
		Server string `json:"server"`
	} `json:"account"`
}

func newConnectorTicketTestApp(t *testing.T, store *fakeIntegrationStore) *fiber.App {
	t.Helper()
	box, err := NewSecretBox("connector-ticket-test")
	if err != nil {
		t.Fatal(err)
	}
	app := fiber.New()
	NewHandler(newFakeSettingsStore(), fakeRequireAuth).
		WithIntegrations(store, box, "worker-secret").
		Register(app.Group("/api/v1"))
	return app
}

func TestMT5ConnectorTicketIsOneUseAndAccountScoped(t *testing.T) {
	verifiedAt := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:      "12345678",
		MT5Server:     "FTMO-Server4",
		MT5Password:   []byte("encrypted-password"),
		MT5VerifiedAt: &verifiedAt,
	}}
	app := newConnectorTicketTestApp(t, store)

	issueResponse, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/mt5/connector-ticket", nil))
	if err != nil || issueResponse.StatusCode != http.StatusOK {
		t.Fatalf("issue status=%d err=%v", issueResponse.StatusCode, err)
	}
	var issued connectorTicketResponse
	if err := json.NewDecoder(issueResponse.Body).Decode(&issued); err != nil {
		t.Fatal(err)
	}
	if !issued.OK || len(issued.Ticket) < 40 || issued.ExpiresAt <= time.Now().UnixMilli() || issued.Account.Login != "12345678" || issued.Account.Server != "FTMO-Server4" {
		t.Fatalf("unexpected ticket response: %+v", issued)
	}

	body := `{"ticket":"` + issued.Ticket + `"}`
	validateRequest := httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/mt5/connector/validate", strings.NewReader(body))
	validateRequest.Header.Set("Content-Type", "application/json")
	validateResponse, err := app.Test(validateRequest)
	if err != nil || validateResponse.StatusCode != http.StatusOK {
		t.Fatalf("validate status=%d err=%v", validateResponse.StatusCode, err)
	}
	var validated connectorTicketResponse
	if err := json.NewDecoder(validateResponse.Body).Decode(&validated); err != nil {
		t.Fatal(err)
	}
	if !validated.OK || validated.Account.Login != issued.Account.Login || validated.Account.Server != issued.Account.Server {
		t.Fatalf("unexpected validate response: %+v", validated)
	}

	replayRequest := httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/mt5/connector/validate", strings.NewReader(body))
	replayRequest.Header.Set("Content-Type", "application/json")
	replayResponse, err := app.Test(replayRequest)
	if err != nil || replayResponse.StatusCode != http.StatusUnauthorized {
		t.Fatalf("replay status=%d err=%v", replayResponse.StatusCode, err)
	}
}

func TestMT5ConnectorTicketRequiresVerifiedAccount(t *testing.T) {
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:    "12345678",
		MT5Server:   "FTMO-Server4",
		MT5Password: []byte("encrypted-password"),
	}}
	app := newConnectorTicketTestApp(t, store)
	response, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/mt5/connector-ticket", nil))
	if err != nil || response.StatusCode != http.StatusConflict {
		t.Fatalf("issue unverified status=%d err=%v", response.StatusCode, err)
	}
}

func TestMT5ConnectorTicketRejectsChangedCredentials(t *testing.T) {
	verifiedAt := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	store := &fakeIntegrationStore{row: IntegrationRecord{
		MT5Login:      "12345678",
		MT5Server:     "FTMO-Server4",
		MT5Password:   []byte("encrypted-password"),
		MT5VerifiedAt: &verifiedAt,
	}}
	app := newConnectorTicketTestApp(t, store)
	issueResponse, _ := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/mt5/connector-ticket", nil))
	var issued connectorTicketResponse
	if err := json.NewDecoder(issueResponse.Body).Decode(&issued); err != nil {
		t.Fatal(err)
	}
	store.row.MT5Server = "FTMO-Server5"

	body := `{"ticket":"` + issued.Ticket + `"}`
	request := httptest.NewRequest(http.MethodPost, "/api/v1/settings/integrations/mt5/connector/validate", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil || response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("changed credential status=%d err=%v", response.StatusCode, err)
	}
}

func TestMT5ConnectorTicketExpires(t *testing.T) {
	verifiedAt := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	now := verifiedAt
	store := newMT5ConnectorTicketStore()
	store.now = func() time.Time { return now }
	store.ttl = time.Second
	record := IntegrationRecord{
		MT5Login:      "12345678",
		MT5Server:     "FTMO-Server4",
		MT5Password:   []byte("encrypted-password"),
		MT5VerifiedAt: &verifiedAt,
	}
	ticket, _, err := store.issue(record, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	now = now.Add(time.Second)
	if _, ok := store.consume(ticket); ok {
		t.Fatal("expired connector ticket was accepted")
	}
}

func TestMT5ConnectorTicketsSupportMultipleBrowserTabs(t *testing.T) {
	verifiedAt := time.Date(2026, 7, 19, 12, 0, 0, 0, time.UTC)
	store := newMT5ConnectorTicketStore()
	record := IntegrationRecord{
		MT5Login:      "12345678",
		MT5Server:     "FTMO-Server4",
		MT5Password:   []byte("encrypted-password"),
		MT5VerifiedAt: &verifiedAt,
	}
	first, _, err := store.issue(record, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	second, _, err := store.issue(record, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := store.consume(first); !ok {
		t.Fatal("issuing a second tab ticket invalidated the first")
	}
	if _, ok := store.consume(second); !ok {
		t.Fatal("second tab ticket was not accepted")
	}
}
