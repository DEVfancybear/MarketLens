package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/settings"
)

type fakeSettingsReader struct {
	doc      settings.Document
	lastUser string
}

func (f *fakeSettingsReader) Get(_ context.Context, userID string) (settings.Document, error) {
	f.lastUser = userID
	return f.doc, nil
}

func TestBootstrapReturnsSettingsAndEmptySlices(t *testing.T) {
	reader := &fakeSettingsReader{doc: settings.Document{
		UI:            json.RawMessage(`{"theme":"dark"}`),
		SMC:           json.RawMessage(`{}`),
		Chart:         json.RawMessage(`{}`),
		Notifications: json.RawMessage(`{}`),
	}}

	app := fiber.New()
	NewHandler(reader, fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/bootstrap", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("bootstrap status = %d, want 200", resp.StatusCode)
	}
	if reader.lastUser != "user-1" {
		t.Fatalf("handler should pass auth user id, got %q", reader.lastUser)
	}

	var body struct {
		Settings         settings.Document `json:"settings"`
		Watchlists       []any             `json:"watchlists"`
		DrawingTemplates []any             `json:"drawingTemplates"`
		Indicators       []any             `json:"indicators"`
		PineScripts      []any             `json:"pineScripts"`
		Alerts           []any             `json:"alerts"`
		Layouts          []any             `json:"layouts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode bootstrap response: %v", err)
	}
	if body.Watchlists == nil || body.DrawingTemplates == nil || body.Indicators == nil ||
		body.PineScripts == nil || body.Alerts == nil || body.Layouts == nil {
		t.Fatal("bootstrap arrays must be empty arrays, not null")
	}
	if string(body.Settings.UI) != `{"theme":"dark"}` {
		t.Fatalf("unexpected settings ui: %s", body.Settings.UI)
	}
}

func fakeRequireAuth(c *fiber.Ctx) error {
	c.Locals(auth.LocalUserID, "user-1")
	c.Locals(auth.LocalSessionID, "session-1")
	return c.Next()
}
