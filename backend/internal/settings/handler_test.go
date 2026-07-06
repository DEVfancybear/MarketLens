package settings

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

type fakeSettingsStore struct {
	doc      Document
	lastUser string
}

func newFakeSettingsStore() *fakeSettingsStore {
	return &fakeSettingsStore{doc: EmptyDocument()}
}

func (f *fakeSettingsStore) Get(_ context.Context, userID string) (Document, error) {
	f.lastUser = userID
	return f.doc, nil
}

func (f *fakeSettingsStore) Replace(_ context.Context, userID string, doc Document) (Document, error) {
	f.lastUser = userID
	f.doc = NormalizeDocument(doc)
	return f.doc, nil
}

func (f *fakeSettingsStore) Patch(_ context.Context, userID string, patch Patch) (Document, error) {
	f.lastUser = userID
	next, err := ApplyPatch(f.doc, patch)
	if err != nil {
		return Document{}, err
	}
	f.doc = next
	return f.doc, nil
}

func TestSettingsHandlerGetPutPatch(t *testing.T) {
	store := newFakeSettingsStore()
	app := newSettingsTestApp(store)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/settings", strings.NewReader(`{
		"ui":{"theme":"dark","panels":{"bottom":true,"height":280}},
		"chart":{"favoriteTimeframes":["1m","5m"]}
	}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("put status = %d, want 200", resp.StatusCode)
	}
	if store.lastUser != "user-1" {
		t.Fatalf("handler should pass auth user id, got %q", store.lastUser)
	}

	req = httptest.NewRequest(http.MethodPatch, "/api/v1/settings", strings.NewReader(`{
		"ui":{"panels":{"height":180}},
		"notifications":{"sound":true}
	}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("patch: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("patch status = %d, want 200", resp.StatusCode)
	}

	var body Document
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode patch response: %v", err)
	}
	ui := object(t, body.UI)
	panels := ui["panels"].(map[string]any)
	if panels["bottom"] != true || panels["height"] != float64(180) {
		t.Fatalf("patch should deep-merge panels, got %#v", panels)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/v1/settings", nil)
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("get status = %d, want 200", resp.StatusCode)
	}
}

func TestSettingsHandlerRejectsUnknownSection(t *testing.T) {
	app := newSettingsTestApp(newFakeSettingsStore())

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/settings", strings.NewReader(`{"bad":{}}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("patch unknown: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("unknown section status = %d, want 400", resp.StatusCode)
	}
}

func newSettingsTestApp(store Store) *fiber.App {
	app := fiber.New()
	NewHandler(store, fakeRequireAuth).Register(app.Group("/api/v1"))
	return app
}

func fakeRequireAuth(c *fiber.Ctx) error {
	c.Locals(auth.LocalUserID, "user-1")
	c.Locals(auth.LocalSessionID, "session-1")
	return c.Next()
}
