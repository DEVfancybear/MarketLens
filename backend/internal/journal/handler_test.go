package journal

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"
	"github.com/marketlens/backend/internal/auth"
	objectstorage "github.com/marketlens/backend/internal/storage"
)

type handlerStore struct {
	filter ListFilter
	shot   Screenshot
}

func (s *handlerStore) List(_ context.Context, _ string, filter ListFilter) ([]Entry, error) {
	s.filter = filter
	return []Entry{}, nil
}
func (s *handlerStore) Get(context.Context, string, string) (Entry, error) { return Entry{}, nil }
func (s *handlerStore) Create(context.Context, string, CreateInput) (Entry, error) {
	return Entry{ID: "entry-1"}, nil
}
func (s *handlerStore) Update(context.Context, string, string, UpdateInput) (Entry, error) {
	return Entry{ID: "entry-1"}, nil
}
func (s *handlerStore) Delete(context.Context, string, string) error { return nil }
func (s *handlerStore) CreateScreenshot(_ context.Context, _ string, in ScreenshotInput) (Screenshot, error) {
	s.shot = Screenshot{ID: "shot-1", JournalEntryID: in.JournalEntryID, Phase: in.Phase, StorageKey: in.StorageKey, ContentType: in.ContentType, CreatedAt: time.Now().UTC()}
	return s.shot, nil
}
func (s *handlerStore) GetScreenshot(context.Context, string, string) (Screenshot, error) {
	return s.shot, nil
}
func (s *handlerStore) DeleteScreenshot(context.Context, string, string) error { return nil }

type handlerSigner struct{ putKey, getKey string }

func (s *handlerSigner) PresignPut(key string, _ time.Duration) (string, error) {
	s.putKey = key
	return "https://storage.test/upload", nil
}
func (s *handlerSigner) PresignGet(key string, _ time.Duration) (string, error) {
	s.getKey = key
	return "https://storage.test/view", nil
}

func journalTestApp(store Store, signer objectstorage.Signer) *fiber.App {
	app := fiber.New()
	requireAuth := func(c fiber.Ctx) error {
		c.Locals(auth.LocalUserID, "11111111-1111-4111-8111-111111111111")
		return c.Next()
	}
	NewHandler(store, signer, requireAuth).Register(app.Group("/api/v1"))
	return app
}

func doRequest(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req, fiber.TestConfig{Timeout: 0})
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

func TestHandlerListParsesFiltersAndPagination(t *testing.T) {
	store := &handlerStore{}
	resp := doRequest(t, journalTestApp(store, &handlerSigner{}), http.MethodGet,
		"/api/v1/journal?symbol=EURUSD&tag=A&limit=25&before=2026-07-11T01%3A00%3A00Z", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status=%d", resp.StatusCode)
	}
	if store.filter.Symbol != "EURUSD" || store.filter.Tag != "A" || store.filter.Limit != 25 || store.filter.Before == nil {
		t.Fatalf("unexpected filter: %+v", store.filter)
	}
}

func TestHandlerScreenshotPresignRegisterAndView(t *testing.T) {
	store, signer := &handlerStore{}, &handlerSigner{}
	app := journalTestApp(store, signer)
	resp := doRequest(t, app, http.MethodPost, "/api/v1/screenshots/upload-url", `{"contentType":"image/png"}`)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d body=%s", resp.StatusCode, body)
	}
	var upload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&upload); err != nil {
		t.Fatal(err)
	}
	key, _ := upload["storageKey"].(string)
	if !strings.HasPrefix(key, "users/11111111-1111-4111-8111-111111111111/journal/") || signer.putKey != key {
		t.Fatalf("unexpected scoped key: response=%q signer=%q", key, signer.putKey)
	}

	registerBody := `{"journalEntryId":"entry-client-1","phase":"before","storageKey":"` + key + `","contentType":"image/png"}`
	resp = doRequest(t, app, http.MethodPost, "/api/v1/screenshots", registerBody)
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || store.shot.StorageKey != key {
		t.Fatalf("register status=%d shot=%+v", resp.StatusCode, store.shot)
	}

	resp = doRequest(t, app, http.MethodGet, "/api/v1/screenshots/shot-1", "")
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || signer.getKey != key {
		t.Fatalf("view status=%d key=%q", resp.StatusCode, signer.getKey)
	}
	var view map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&view); err != nil {
		t.Fatal(err)
	}
	if view["url"] != "https://storage.test/view" {
		t.Fatalf("unexpected view response: %v", view)
	}
}

func TestHandlerRejectsBadPaginationAndUnavailableStorage(t *testing.T) {
	store := &handlerStore{}
	app := journalTestApp(store, nil)
	resp := doRequest(t, app, http.MethodGet, "/api/v1/journal?limit=nope", "")
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("bad limit status=%d", resp.StatusCode)
	}
	resp = doRequest(t, app, http.MethodPost, "/api/v1/screenshots/upload-url", `{"contentType":"image/png"}`)
	resp.Body.Close()
	if resp.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("storage status=%d", resp.StatusCode)
	}
}
