package drawings

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type fakeDrawingStore struct {
	drawings      map[string][]Drawing
	templates     map[string][]DrawingTemplate
	toolFavorites map[string]DrawingToolFavorites
	seq           int

	lastUser   string
	lastSymbol string
}

func newFakeDrawingStore() *fakeDrawingStore {
	return &fakeDrawingStore{
		drawings:      map[string][]Drawing{},
		templates:     map[string][]DrawingTemplate{},
		toolFavorites: map[string]DrawingToolFavorites{},
	}
}

func (f *fakeDrawingStore) List(_ context.Context, userID, symbol string) ([]Drawing, error) {
	f.lastUser = userID
	f.lastSymbol = symbol
	out := []Drawing{}
	for _, d := range f.drawings[userID] {
		if d.Symbol == strings.ToUpper(strings.TrimSpace(symbol)) {
			out = append(out, d)
		}
	}
	return out, nil
}

func (f *fakeDrawingStore) Create(_ context.Context, userID string, input DrawingWrite) (Drawing, error) {
	f.lastUser = userID
	return f.upsert(userID, input), nil
}

func (f *fakeDrawingStore) Replace(_ context.Context, userID, id string, input DrawingWrite) (Drawing, error) {
	f.lastUser = userID
	for i := range f.drawings[userID] {
		if f.drawings[userID][i].ID == id {
			f.drawings[userID][i].Symbol = strings.ToUpper(input.Symbol)
			f.drawings[userID][i].ToolType = input.ToolType
			f.drawings[userID][i].Payload = input.Payload
			f.drawings[userID][i].Locked = input.Locked
			f.drawings[userID][i].Hidden = input.Hidden
			f.drawings[userID][i].ClientID = input.ClientID
			return f.drawings[userID][i], nil
		}
	}
	return Drawing{}, ErrNotFound
}

func (f *fakeDrawingStore) Patch(_ context.Context, userID, id string, patch DrawingPatch) (Drawing, error) {
	f.lastUser = userID
	for i := range f.drawings[userID] {
		if f.drawings[userID][i].ID != id {
			continue
		}
		if patch.Symbol != nil {
			f.drawings[userID][i].Symbol = strings.ToUpper(strings.TrimSpace(*patch.Symbol))
		}
		if patch.ToolType != nil {
			f.drawings[userID][i].ToolType = strings.TrimSpace(*patch.ToolType)
		}
		if patch.Payload != nil {
			f.drawings[userID][i].Payload = *patch.Payload
		}
		if patch.Locked != nil {
			f.drawings[userID][i].Locked = *patch.Locked
		}
		if patch.Hidden != nil {
			f.drawings[userID][i].Hidden = *patch.Hidden
		}
		if patch.ClientID != nil {
			f.drawings[userID][i].ClientID = strings.TrimSpace(*patch.ClientID)
		}
		return f.drawings[userID][i], nil
	}
	return Drawing{}, ErrNotFound
}

func (f *fakeDrawingStore) Delete(_ context.Context, userID, id string) error {
	f.lastUser = userID
	for i, d := range f.drawings[userID] {
		if d.ID == id {
			f.drawings[userID] = append(f.drawings[userID][:i], f.drawings[userID][i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func (f *fakeDrawingStore) Batch(_ context.Context, userID string, req BatchRequest) (BatchResponse, error) {
	f.lastUser = userID
	resp := BatchResponse{Upserted: []Drawing{}}
	for _, item := range req.Deletes {
		deleted := false
		kept := f.drawings[userID][:0]
		for _, d := range f.drawings[userID] {
			matchID := item.ID != "" && d.ID == item.ID
			matchClient := item.ClientID != "" && d.ClientID == item.ClientID
			if !deleted && (matchID || matchClient) {
				deleted = true
				resp.Deleted++
				continue
			}
			kept = append(kept, d)
		}
		f.drawings[userID] = kept
	}
	for _, input := range req.Upserts {
		resp.Upserted = append(resp.Upserted, f.upsert(userID, input))
	}
	return resp, nil
}

func (f *fakeDrawingStore) ListTemplates(_ context.Context, userID string) ([]DrawingTemplate, error) {
	f.lastUser = userID
	if f.templates[userID] == nil {
		return []DrawingTemplate{}, nil
	}
	return f.templates[userID], nil
}

func (f *fakeDrawingStore) SaveTemplate(_ context.Context, userID string, input DrawingTemplateWrite) (DrawingTemplate, error) {
	f.lastUser = userID
	for i := range f.templates[userID] {
		if f.templates[userID][i].Name == input.Name && f.templates[userID][i].Family == input.Family {
			f.templates[userID][i].Style = input.Style
			return f.templates[userID][i], nil
		}
	}
	f.seq++
	tpl := DrawingTemplate{
		ID:        "tpl-" + itoa(f.seq),
		Name:      input.Name,
		Family:    input.Family,
		Style:     input.Style,
		CreatedAt: time.Unix(int64(f.seq), 0).UTC(),
		UpdatedAt: time.Unix(int64(f.seq), 0).UTC(),
	}
	f.templates[userID] = append(f.templates[userID], tpl)
	return tpl, nil
}

func (f *fakeDrawingStore) UpdateTemplate(_ context.Context, userID, id string, input DrawingTemplateWrite) (DrawingTemplate, error) {
	f.lastUser = userID
	for i := range f.templates[userID] {
		if f.templates[userID][i].ID == id {
			f.templates[userID][i].Name = input.Name
			f.templates[userID][i].Family = input.Family
			f.templates[userID][i].Style = input.Style
			return f.templates[userID][i], nil
		}
	}
	return DrawingTemplate{}, ErrNotFound
}

func (f *fakeDrawingStore) DeleteTemplate(_ context.Context, userID, id string) error {
	f.lastUser = userID
	for i, tpl := range f.templates[userID] {
		if tpl.ID == id {
			f.templates[userID] = append(f.templates[userID][:i], f.templates[userID][i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func (f *fakeDrawingStore) GetToolFavorites(_ context.Context, userID string) (DrawingToolFavorites, error) {
	f.lastUser = userID
	if favs, ok := f.toolFavorites[userID]; ok {
		return favs, nil
	}
	return DrawingToolFavorites{Tools: []string{}}, nil
}

func (f *fakeDrawingStore) ReplaceToolFavorites(_ context.Context, userID string, input DrawingToolFavoritesWrite) (DrawingToolFavorites, error) {
	f.lastUser = userID
	f.seq++
	favs := DrawingToolFavorites{
		Tools:     normalizeToolFavorites(input.Tools),
		UpdatedAt: time.Unix(int64(f.seq), 0).UTC(),
	}
	f.toolFavorites[userID] = favs
	return favs, nil
}

func (f *fakeDrawingStore) upsert(userID string, input DrawingWrite) Drawing {
	for i := range f.drawings[userID] {
		if input.ClientID != "" && f.drawings[userID][i].ClientID == input.ClientID {
			f.drawings[userID][i].Symbol = strings.ToUpper(input.Symbol)
			f.drawings[userID][i].ToolType = input.ToolType
			f.drawings[userID][i].Payload = input.Payload
			f.drawings[userID][i].Locked = input.Locked
			f.drawings[userID][i].Hidden = input.Hidden
			return f.drawings[userID][i]
		}
	}
	f.seq++
	d := Drawing{
		ID:        "dw-srv-" + itoa(f.seq),
		Symbol:    strings.ToUpper(input.Symbol),
		ToolType:  input.ToolType,
		Payload:   input.Payload,
		Locked:    input.Locked,
		Hidden:    input.Hidden,
		ClientID:  input.ClientID,
		CreatedAt: time.Unix(int64(f.seq), 0).UTC(),
		UpdatedAt: time.Unix(int64(f.seq), 0).UTC(),
	}
	f.drawings[userID] = append(f.drawings[userID], d)
	return d
}

func TestDrawingBatchSyncDedupesByClientID(t *testing.T) {
	store := newFakeDrawingStore()
	app := newDrawingTestApp(store, "user-1")

	body := `{"upserts":[{"symbol":"eurusd","toolType":"trendline","clientId":"dw-1","payload":{"id":"dw-1","tool":"trendline","points":[{"time":1,"price":1.1},{"time":2,"price":1.2}]},"locked":false,"hidden":false}],"deletes":[]}`
	resp, text := doDrawing(t, app, http.MethodPost, "/api/v1/drawings/batch", body)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("batch create status=%d body=%s", resp.StatusCode, text)
	}

	body = `{"upserts":[{"symbol":"EURUSD","toolType":"trendline","clientId":"dw-1","payload":{"id":"dw-1","tool":"trendline","points":[{"time":1,"price":1.1},{"time":3,"price":1.3}]},"locked":true,"hidden":false}],"deletes":[]}`
	resp, text = doDrawing(t, app, http.MethodPost, "/api/v1/drawings/batch", body)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("batch update status=%d body=%s", resp.StatusCode, text)
	}
	if got := len(store.drawings["user-1"]); got != 1 {
		t.Fatalf("clientId retry should not duplicate drawings, got %d rows", got)
	}
	if !store.drawings["user-1"][0].Locked {
		t.Fatal("second upsert should update existing drawing flags")
	}

	resp, text = doDrawing(t, app, http.MethodGet, "/api/v1/drawings?symbol=EURUSD", "")
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("list status=%d body=%s", resp.StatusCode, text)
	}
	if store.lastUser != "user-1" || store.lastSymbol != "EURUSD" {
		t.Fatalf("list should pass auth user and symbol, got user=%q symbol=%q", store.lastUser, store.lastSymbol)
	}
	var rows []Drawing
	if err := json.Unmarshal([]byte(text), &rows); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(rows) != 1 || rows[0].ClientID != "dw-1" {
		t.Fatalf("unexpected list rows: %+v", rows)
	}

	resp, text = doDrawing(t, app, http.MethodPost, "/api/v1/drawings/batch", `{"upserts":[],"deletes":[{"clientId":"dw-1","symbol":"EURUSD"}]}`)
	if resp.StatusCode != fiber.StatusOK || !strings.Contains(text, `"deleted":1`) {
		t.Fatalf("batch delete status=%d body=%s", resp.StatusCode, text)
	}
	if got := len(store.drawings["user-1"]); got != 0 {
		t.Fatalf("delete by clientId should remove row, got %d", got)
	}
}

func TestDrawingTemplateCRUDRoutes(t *testing.T) {
	store := newFakeDrawingStore()
	app := newDrawingTestApp(store, "user-1")

	resp, text := doDrawing(t, app, http.MethodPost, "/api/v1/drawing-templates", `{"name":"Blue line","family":"line","style":{"color":"#2962ff","lineWidth":2}}`)
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("create template status=%d body=%s", resp.StatusCode, text)
	}
	var created DrawingTemplate
	if err := json.Unmarshal([]byte(text), &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	if created.ID == "" || created.Name != "Blue line" || created.Family != "line" {
		t.Fatalf("unexpected created template: %+v", created)
	}

	resp, text = doDrawing(t, app, http.MethodGet, "/api/v1/drawing-templates", "")
	if resp.StatusCode != fiber.StatusOK || !strings.Contains(text, "Blue line") {
		t.Fatalf("list templates status=%d body=%s", resp.StatusCode, text)
	}

	resp, text = doDrawing(t, app, http.MethodPut, "/api/v1/drawing-templates/"+created.ID, `{"name":"Red line","family":"line","style":{"color":"#f23645"}}`)
	if resp.StatusCode != fiber.StatusOK || !strings.Contains(text, "Red line") {
		t.Fatalf("update template status=%d body=%s", resp.StatusCode, text)
	}

	resp, text = doDrawing(t, app, http.MethodDelete, "/api/v1/drawing-templates/"+created.ID, "")
	if resp.StatusCode != fiber.StatusOK || !strings.Contains(text, `"ok":true`) {
		t.Fatalf("delete template status=%d body=%s", resp.StatusCode, text)
	}
}

func TestDrawingToolFavoritesRoutes(t *testing.T) {
	store := newFakeDrawingStore()
	app := newDrawingTestApp(store, "user-1")

	resp, text := doDrawing(t, app, http.MethodGet, "/api/v1/drawing-tool-favorites", "")
	if resp.StatusCode != fiber.StatusOK || !strings.Contains(text, `"tools":[]`) {
		t.Fatalf("empty favorites status=%d body=%s", resp.StatusCode, text)
	}

	resp, text = doDrawing(t, app, http.MethodPut, "/api/v1/drawing-tool-favorites", `{"tools":["trendline","long","trendline",""]}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("put favorites status=%d body=%s", resp.StatusCode, text)
	}
	var favs DrawingToolFavorites
	if err := json.Unmarshal([]byte(text), &favs); err != nil {
		t.Fatalf("decode favorites: %v", err)
	}
	if got := strings.Join(favs.Tools, ","); got != "trendline,long" {
		t.Fatalf("favorites should preserve order and dedupe, got %q", got)
	}
	if store.lastUser != "user-1" {
		t.Fatalf("favorites should use auth user, got %q", store.lastUser)
	}

	resp, text = doDrawing(t, app, http.MethodGet, "/api/v1/drawing-tool-favorites", "")
	if resp.StatusCode != fiber.StatusOK || !strings.Contains(text, `"tools":["trendline","long"]`) {
		t.Fatalf("get favorites status=%d body=%s", resp.StatusCode, text)
	}
}

func TestDrawingHandlerErrorMapping(t *testing.T) {
	app := newDrawingTestApp(newFakeDrawingStore(), "user-1")

	resp, _ := doDrawing(t, app, http.MethodPost, "/api/v1/drawings/batch", `{bad json`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid json status=%d, want 400", resp.StatusCode)
	}

	resp, _ = doDrawing(t, app, http.MethodDelete, "/api/v1/drawings/missing", "")
	if resp.StatusCode != fiber.StatusNotFound {
		t.Fatalf("delete missing status=%d, want 404", resp.StatusCode)
	}
}

func newDrawingTestApp(store Store, asUser string) *fiber.App {
	app := fiber.New()
	mw := func(c *fiber.Ctx) error {
		c.Locals(auth.LocalUserID, asUser)
		c.Locals(auth.LocalSessionID, "session-1")
		return c.Next()
	}
	NewHandler(store, mw).Register(app.Group("/api/v1"))
	return app
}

func doDrawing(t *testing.T, app *fiber.App, method, path, body string) (*http.Response, string) {
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

func itoa(n int) string { return string(rune('0' + n)) }
