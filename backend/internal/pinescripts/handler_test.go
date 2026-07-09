package pinescripts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type fakeScriptStore struct {
	items    map[string][]Script
	seq      int
	lastUser string
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

func fakeRequireAuth(c *fiber.Ctx) error {
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
