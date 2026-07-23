package watchlists

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

// fakeStore is an in-memory Store keyed by user id.
type fakeStore struct {
	byUser   map[string][]Watchlist
	activeID map[string]string
	seq      int
}

func newFakeStore() *fakeStore {
	return &fakeStore{byUser: map[string][]Watchlist{}, activeID: map[string]string{}}
}

func (f *fakeStore) find(userID, id string) (int, bool) {
	for i, w := range f.byUser[userID] {
		if w.ID == id {
			return i, true
		}
	}
	return 0, false
}

func (f *fakeStore) List(_ context.Context, userID string) ([]Watchlist, error) {
	out := f.byUser[userID]
	if out == nil {
		out = []Watchlist{}
	}
	for i := range out {
		out[i].Active = f.activeID[userID] == out[i].ID || (f.activeID[userID] == "" && i == 0)
	}
	return out, nil
}

func (f *fakeStore) Create(_ context.Context, userID, name string) (Watchlist, error) {
	if strings.TrimSpace(name) == "" {
		return Watchlist{}, ErrBadRequest
	}
	f.seq++
	w := Watchlist{
		ID:       "wl-" + itoa(f.seq),
		Name:     name,
		Position: len(f.byUser[userID]),
		Symbols:  []string{},
		Sections: []WatchlistSection{},
		SortKey:  "symbol",
		SortDir:  "asc",
	}
	f.byUser[userID] = append(f.byUser[userID], w)
	if f.activeID[userID] == "" {
		f.activeID[userID] = w.ID
		w.Active = true
	}
	return w, nil
}

func (f *fakeStore) Update(_ context.Context, userID, id string, name *string, position *int, shared *bool, sortKey *string, sortDir *string) (Watchlist, error) {
	i, ok := f.find(userID, id)
	if !ok {
		return Watchlist{}, ErrNotFound
	}
	if name != nil {
		f.byUser[userID][i].Name = *name
	}
	if position != nil {
		f.byUser[userID][i].Position = *position
	}
	if shared != nil {
		f.byUser[userID][i].Shared = *shared
	}
	if sortKey != nil {
		f.byUser[userID][i].SortKey = *sortKey
	}
	if sortDir != nil {
		f.byUser[userID][i].SortDir = *sortDir
	}
	return f.byUser[userID][i], nil
}

func (f *fakeStore) Delete(_ context.Context, userID, id string) error {
	i, ok := f.find(userID, id)
	if !ok {
		return ErrNotFound
	}
	f.byUser[userID] = append(f.byUser[userID][:i], f.byUser[userID][i+1:]...)
	if f.activeID[userID] == id {
		if len(f.byUser[userID]) > 0 {
			f.activeID[userID] = f.byUser[userID][0].ID
		} else {
			delete(f.activeID, userID)
		}
	}
	return nil
}

func (f *fakeStore) SetActive(_ context.Context, userID, id string) (Watchlist, error) {
	i, ok := f.find(userID, id)
	if !ok {
		return Watchlist{}, ErrNotFound
	}
	f.activeID[userID] = id
	f.byUser[userID][i].Active = true
	return f.byUser[userID][i], nil
}

func (f *fakeStore) ReplaceLayout(_ context.Context, userID, id string, layout WatchlistLayout) (Watchlist, error) {
	i, ok := f.find(userID, id)
	if !ok {
		return Watchlist{}, ErrNotFound
	}
	symbols := normalizeSymbols(layout.Symbols)
	sections := normalizeSections(layout.Sections, len(symbols))
	for j := range sections {
		sections[j].ID = "sec-" + itoa(j+1)
	}
	f.byUser[userID][i].Symbols = symbols
	f.byUser[userID][i].Sections = sections
	return f.byUser[userID][i], nil
}

func (f *fakeStore) AddSymbol(_ context.Context, userID, id, symbol string) (Watchlist, error) {
	if strings.TrimSpace(symbol) == "" {
		return Watchlist{}, ErrBadRequest
	}
	i, ok := f.find(userID, id)
	if !ok {
		return Watchlist{}, ErrNotFound
	}
	for _, s := range f.byUser[userID][i].Symbols {
		if s == symbol {
			return f.byUser[userID][i], nil // idempotent
		}
	}
	f.byUser[userID][i].Symbols = append(f.byUser[userID][i].Symbols, symbol)
	return f.byUser[userID][i], nil
}

func (f *fakeStore) RemoveSymbol(_ context.Context, userID, id, symbol string) (Watchlist, error) {
	i, ok := f.find(userID, id)
	if !ok {
		return Watchlist{}, ErrNotFound
	}
	kept := f.byUser[userID][i].Symbols[:0]
	for _, s := range f.byUser[userID][i].Symbols {
		if s != symbol {
			kept = append(kept, s)
		}
	}
	f.byUser[userID][i].Symbols = kept
	return f.byUser[userID][i], nil
}

func itoa(n int) string { return string(rune('0' + n)) }

func newTestApp(store Store, asUser string) *fiber.App {
	app := fiber.New()
	mw := func(c fiber.Ctx) error {
		c.Locals(auth.LocalUserID, asUser)
		return c.Next()
	}
	NewHandler(store, mw).Register(app.Group("/api/v1"))
	return app
}

func do(t *testing.T, app *fiber.App, method, path, body string) (*http.Response, string) {
	t.Helper()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	buf, _ := io.ReadAll(resp.Body)
	return resp, string(buf)
}

func TestWatchlistCRUDFlow(t *testing.T) {
	store := newFakeStore()
	app := newTestApp(store, "user-1")

	// create
	resp, body := do(t, app, http.MethodPost, "/api/v1/watchlists", `{"name":"Crypto"}`)
	if resp.StatusCode != 201 {
		t.Fatalf("create status=%d body=%s", resp.StatusCode, body)
	}
	var created Watchlist
	json.Unmarshal([]byte(body), &created)
	if created.Name != "Crypto" || created.ID == "" {
		t.Fatalf("unexpected created: %s", body)
	}

	// add symbol
	resp, body = do(t, app, http.MethodPost, "/api/v1/watchlists/"+created.ID+"/symbols", `{"symbol":"BTCUSDT"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("addSymbol status=%d body=%s", resp.StatusCode, body)
	}
	var withSym Watchlist
	json.Unmarshal([]byte(body), &withSym)
	if len(withSym.Symbols) != 1 || withSym.Symbols[0] != "BTCUSDT" {
		t.Fatalf("expected [BTCUSDT], got %v", withSym.Symbols)
	}

	// replace full layout
	resp, body = do(t, app, http.MethodPut, "/api/v1/watchlists/"+created.ID+"/layout", `{"symbols":["EURUSD","BTCUSDT"],"sections":[{"title":"SECTION 1","index":1}]}`)
	if resp.StatusCode != 200 {
		t.Fatalf("replaceLayout status=%d body=%s", resp.StatusCode, body)
	}
	var layout Watchlist
	json.Unmarshal([]byte(body), &layout)
	if len(layout.Symbols) != 2 || layout.Symbols[0] != "EURUSD" || len(layout.Sections) != 1 || layout.Sections[0].Index != 1 {
		t.Fatalf("unexpected layout: %+v", layout)
	}

	// set active
	resp, body = do(t, app, http.MethodPut, "/api/v1/watchlists/active", `{"id":"`+created.ID+`"}`)
	if resp.StatusCode != 200 || !strings.Contains(body, `"active":true`) {
		t.Fatalf("setActive status=%d body=%s", resp.StatusCode, body)
	}

	// list
	resp, body = do(t, app, http.MethodGet, "/api/v1/watchlists", "")
	if resp.StatusCode != 200 || !strings.Contains(body, "BTCUSDT") {
		t.Fatalf("list status=%d body=%s", resp.StatusCode, body)
	}

	// rename
	resp, _ = do(t, app, http.MethodPatch, "/api/v1/watchlists/"+created.ID, `{"name":"Majors"}`)
	if resp.StatusCode != 200 {
		t.Fatalf("rename status=%d", resp.StatusCode)
	}

	// persist sort preference
	resp, body = do(t, app, http.MethodPatch, "/api/v1/watchlists/"+created.ID, `{"sortKey":"price","sortDir":"desc"}`)
	if resp.StatusCode != 200 || !strings.Contains(body, `"sortKey":"price"`) || !strings.Contains(body, `"sortDir":"desc"`) {
		t.Fatalf("sort patch status=%d body=%s", resp.StatusCode, body)
	}

	// remove symbol
	resp, body = do(t, app, http.MethodDelete, "/api/v1/watchlists/"+created.ID+"/symbols/BTCUSDT", "")
	if resp.StatusCode != 200 {
		t.Fatalf("removeSymbol status=%d body=%s", resp.StatusCode, body)
	}

	// delete
	resp, _ = do(t, app, http.MethodDelete, "/api/v1/watchlists/"+created.ID, "")
	if resp.StatusCode != 200 {
		t.Fatalf("delete status=%d", resp.StatusCode)
	}
}

func TestWatchlistCrossUserIs404(t *testing.T) {
	store := newFakeStore()
	// user-1 owns a list
	appA := newTestApp(store, "user-1")
	_, body := do(t, appA, http.MethodPost, "/api/v1/watchlists", `{"name":"Mine"}`)
	var w Watchlist
	json.Unmarshal([]byte(body), &w)

	// user-2 cannot touch it
	appB := newTestApp(store, "user-2")
	resp, _ := do(t, appB, http.MethodPatch, "/api/v1/watchlists/"+w.ID, `{"name":"Hijack"}`)
	if resp.StatusCode != 404 {
		t.Fatalf("cross-user patch status=%d, want 404", resp.StatusCode)
	}
	resp, _ = do(t, appB, http.MethodDelete, "/api/v1/watchlists/"+w.ID, "")
	if resp.StatusCode != 404 {
		t.Fatalf("cross-user delete status=%d, want 404", resp.StatusCode)
	}
}

func TestWatchlistCreateRequiresName(t *testing.T) {
	app := newTestApp(newFakeStore(), "user-1")
	resp, _ := do(t, app, http.MethodPost, "/api/v1/watchlists", `{"name":""}`)
	if resp.StatusCode != 400 {
		t.Fatalf("empty name status=%d, want 400", resp.StatusCode)
	}
}
