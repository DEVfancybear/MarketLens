package pinescripts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

	"github.com/marketlens/backend/internal/auth"
)

type fakeScriptStore struct {
	items       map[string][]Script
	publicItems []PublicScript
	seq         int
	lastUser    string
}

func newFakeScriptStore() *fakeScriptStore {
	return &fakeScriptStore{items: map[string][]Script{}}
}

func (f *fakeScriptStore) List(_ context.Context, userID string) ([]Script, error) {
	f.lastUser = userID
	rows := f.items[userID]
	if rows == nil {
		return []Script{}, nil
	}
	out := make([]Script, len(rows))
	for i, row := range rows {
		row.SourceCode = ""
		out[i] = row
	}
	return out, nil
}

func (f *fakeScriptStore) Get(_ context.Context, userID, ref string) (Script, error) {
	f.lastUser = userID
	for _, item := range f.items[userID] {
		if item.ID == ref || item.ClientID == ref {
			return item, nil
		}
	}
	return Script{}, ErrNotFound
}

func (f *fakeScriptStore) Save(_ context.Context, userID string, input ScriptWrite) (Script, error) {
	f.lastUser = userID
	for i := range f.items[userID] {
		if input.ClientID != "" && f.items[userID][i].ClientID == input.ClientID {
			f.items[userID][i].Name = *input.Name
			f.items[userID][i].SourceCode = *input.SourceCode
			f.items[userID][i].Favorite = boolOrDefault(input.Favorite)
			return f.items[userID][i], nil
		}
	}
	f.seq++
	item := Script{
		ID:         "pine-srv-" + itoa(f.seq),
		Name:       *input.Name,
		SourceCode: *input.SourceCode,
		Favorite:   boolOrDefault(input.Favorite),
		Meta:       json.RawMessage(`{}`),
		ClientID:   input.ClientID,
		CreatedAt:  time.Unix(int64(f.seq), 0).UTC(),
		UpdatedAt:  time.Unix(int64(f.seq), 0).UTC(),
	}
	f.items[userID] = append(f.items[userID], item)
	return item, nil
}

func (f *fakeScriptStore) Replace(_ context.Context, userID, ref string, input ScriptWrite) (Script, error) {
	f.lastUser = userID
	for i := range f.items[userID] {
		if f.items[userID][i].ID == ref || f.items[userID][i].ClientID == ref {
			if input.Name != nil {
				f.items[userID][i].Name = *input.Name
			}
			if input.SourceCode != nil {
				f.items[userID][i].SourceCode = *input.SourceCode
			}
			if input.Favorite != nil {
				f.items[userID][i].Favorite = *input.Favorite
			}
			return f.items[userID][i], nil
		}
	}
	return Script{}, ErrNotFound
}

func (f *fakeScriptStore) Delete(_ context.Context, userID, ref string) error {
	f.lastUser = userID
	for i, item := range f.items[userID] {
		if item.ID == ref || item.ClientID == ref {
			f.items[userID] = append(f.items[userID][:i], f.items[userID][i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func (f *fakeScriptStore) ListPublic(_ context.Context, query string) ([]PublicScript, error) {
	query = strings.ToLower(strings.TrimSpace(query))
	out := []PublicScript{}
	for _, item := range f.publicItems {
		if query == "" ||
			strings.Contains(strings.ToLower(item.Name), query) ||
			strings.Contains(strings.ToLower(item.Author), query) {
			out = append(out, item)
		}
	}
	return out, nil
}

func (f *fakeScriptStore) GetPublic(_ context.Context, ref string) (PublicScript, error) {
	for _, item := range f.publicItems {
		if item.ID == ref || item.ScriptID == ref {
			return item, nil
		}
	}
	return PublicScript{}, ErrNotFound
}

func (f *fakeScriptStore) Publish(_ context.Context, userID, ref string, input PublishRequest) (PublicScript, error) {
	f.lastUser = userID
	script, err := f.Get(context.Background(), userID, ref)
	if err != nil {
		return PublicScript{}, err
	}
	name := script.Name
	if input.Name != nil && strings.TrimSpace(*input.Name) != "" {
		name = strings.TrimSpace(*input.Name)
	}
	for i := range f.publicItems {
		if f.publicItems[i].ScriptID == script.ID {
			f.publicItems[i].Name = name
			f.publicItems[i].SourceCode = script.SourceCode
			return f.publicItems[i], nil
		}
	}
	item := PublicScript{
		ID:         "pub-" + script.ID,
		ScriptID:   script.ID,
		Name:       name,
		SourceCode: script.SourceCode,
		AuthorID:   userID,
		Author:     "Tester",
		Boosts:     0,
		Meta:       json.RawMessage(`{}`),
		CreatedAt:  script.CreatedAt,
		UpdatedAt:  script.UpdatedAt,
	}
	f.publicItems = append(f.publicItems, item)
	return item, nil
}

func TestPineScriptHandlerSaveListGetPatchDelete(t *testing.T) {
	store := newFakeScriptStore()
	app := fiber.New()
	NewHandler(store, fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/pine-scripts",
		strings.NewReader(`{"name":"Better RSI","sourceCode":"indicator(\"Better RSI\")","favorite":true,"clientId":"pine-1"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("save script: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("save status = %d, want 201", resp.StatusCode)
	}

	resp, err = app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/pine-scripts", nil))
	if err != nil {
		t.Fatalf("list scripts: %v", err)
	}
	var list []Script
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0].SourceCode != "" || list[0].ClientID != "pine-1" {
		t.Fatalf("list should return metadata only, got %+v", list)
	}

	resp, err = app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/pine-scripts/pine-1", nil))
	if err != nil {
		t.Fatalf("get script: %v", err)
	}
	var full Script
	if err := json.NewDecoder(resp.Body).Decode(&full); err != nil {
		t.Fatalf("decode full: %v", err)
	}
	if !strings.Contains(full.SourceCode, "Better RSI") {
		t.Fatalf("get should return source, got %+v", full)
	}

	req = httptest.NewRequest(
		http.MethodPut,
		"/api/v1/pine-scripts/pine-1",
		strings.NewReader(`{"favorite":false}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("patch script: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("patch status = %d, want 200", resp.StatusCode)
	}

	resp, err = app.Test(httptest.NewRequest(http.MethodDelete, "/api/v1/pine-scripts/pine-1", nil))
	if err != nil {
		t.Fatalf("delete script: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("delete status = %d, want 200", resp.StatusCode)
	}
}

func TestPineScriptHandlerRejectsBadJSON(t *testing.T) {
	app := fiber.New()
	NewHandler(newFakeScriptStore(), fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/pine-scripts", strings.NewReader(`{"name":`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("save bad script: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func TestPineScriptHandlerPublishesPublicStoreWithoutAuthForRead(t *testing.T) {
	store := newFakeScriptStore()
	app := fiber.New()
	NewHandler(store, fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/pine-scripts",
		strings.NewReader(`{"name":"VSA Volume","sourceCode":"indicator(\"VSA Volume\")","clientId":"pine-vsa"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("save script: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("save status = %d, want 201", resp.StatusCode)
	}

	req = httptest.NewRequest(
		http.MethodPost,
		"/api/v1/pine-scripts/pine-vsa/publish",
		strings.NewReader(`{"name":"VSA Public"}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(req)
	if err != nil {
		t.Fatalf("publish script: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("publish status = %d, want 201", resp.StatusCode)
	}

	publicApp := fiber.New()
	NewHandler(store, nil).Register(publicApp.Group("/api/v1"))
	resp, err = publicApp.Test(httptest.NewRequest(http.MethodGet, "/api/v1/indicator-store?query=vsa", nil))
	if err != nil {
		t.Fatalf("list public store: %v", err)
	}
	var list []PublicScript
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		t.Fatalf("decode public list: %v", err)
	}
	if len(list) != 1 || list[0].Name != "VSA Public" || !strings.Contains(list[0].SourceCode, "VSA") {
		t.Fatalf("public store row mismatch: %+v", list)
	}

	resp, err = publicApp.Test(httptest.NewRequest(http.MethodGet, "/api/v1/indicator-store/pub-pine-srv-1", nil))
	if err != nil {
		t.Fatalf("get public store row: %v", err)
	}
	var one PublicScript
	if err := json.NewDecoder(resp.Body).Decode(&one); err != nil {
		t.Fatalf("decode public get: %v", err)
	}
	if one.ScriptID != "pine-srv-1" || one.Author == "" {
		t.Fatalf("public get row mismatch: %+v", one)
	}
}

func TestPineScriptHandlerPublishMissingScriptReturns404(t *testing.T) {
	app := fiber.New()
	NewHandler(newFakeScriptStore(), fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodPost, "/api/v1/pine-scripts/missing/publish", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("publish missing script: %v", err)
	}
	if resp.StatusCode != fiber.StatusNotFound {
		t.Fatalf("publish missing status = %d, want 404", resp.StatusCode)
	}
}

func fakeRequireAuth(c fiber.Ctx) error {
	c.Locals(auth.LocalUserID, "user-1")
	c.Locals(auth.LocalSessionID, "session-1")
	return c.Next()
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	return string(buf[pos:])
}
