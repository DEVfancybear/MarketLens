package layouts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v3"
	"github.com/marketlens/backend/internal/auth"
)

type fakeStore struct {
	items []Layout
}

func (f *fakeStore) List(_ context.Context, _ string) ([]Layout, error) {
	return append([]Layout(nil), f.items...), nil
}

func (f *fakeStore) Create(_ context.Context, _ string, input Write) (Layout, error) {
	item := Layout{ID: "layout-1", Name: input.Name, Symbol: input.Symbol, Timeframe: input.Timeframe, State: input.State, IsDefault: input.IsDefault}
	if item.IsDefault {
		for i := range f.items {
			f.items[i].IsDefault = false
		}
	}
	f.items = append(f.items, item)
	return item, nil
}

func (f *fakeStore) Update(_ context.Context, _ string, id string, input Write) (Layout, error) {
	for i := range f.items {
		if f.items[i].ID != id {
			continue
		}
		if input.IsDefault {
			for j := range f.items {
				f.items[j].IsDefault = false
			}
		}
		f.items[i] = Layout{ID: id, Name: input.Name, Symbol: input.Symbol, Timeframe: input.Timeframe, State: input.State, IsDefault: input.IsDefault}
		return f.items[i], nil
	}
	return Layout{}, ErrNotFound
}

func (f *fakeStore) Delete(_ context.Context, _ string, id string) error {
	for i := range f.items {
		if f.items[i].ID == id {
			f.items = append(f.items[:i], f.items[i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func layoutAuth(c fiber.Ctx) error {
	c.Locals(auth.LocalUserID, "user-1")
	return c.Next()
}

func TestLayoutCRUDRoutes(t *testing.T) {
	store := &fakeStore{}
	app := fiber.New()
	NewHandler(store, layoutAuth).Register(app.Group("/api/v1"))

	create := httptest.NewRequest(http.MethodPost, "/api/v1/layouts", strings.NewReader(`{"name":"Scalping","symbol":"EURUSD","timeframe":"15m","state":{"version":1},"isDefault":true}`))
	create.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(create)
	if err != nil || resp.StatusCode != http.StatusCreated {
		t.Fatalf("create status=%d err=%v", resp.StatusCode, err)
	}

	list := httptest.NewRequest(http.MethodGet, "/api/v1/layouts", nil)
	resp, err = app.Test(list)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("list status=%d err=%v", resp.StatusCode, err)
	}
	var items []Layout
	if err := json.NewDecoder(resp.Body).Decode(&items); err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || !items[0].IsDefault || string(items[0].State) != `{"version":1}` {
		t.Fatalf("unexpected layouts: %+v", items)
	}

	update := httptest.NewRequest(http.MethodPut, "/api/v1/layouts/layout-1", strings.NewReader(`{"name":"London","state":{"version":1}}`))
	update.Header.Set("Content-Type", "application/json")
	resp, err = app.Test(update)
	if err != nil || resp.StatusCode != http.StatusOK {
		t.Fatalf("update status=%d err=%v", resp.StatusCode, err)
	}

	remove := httptest.NewRequest(http.MethodDelete, "/api/v1/layouts/layout-1", nil)
	resp, err = app.Test(remove)
	if err != nil || resp.StatusCode != http.StatusOK || len(store.items) != 0 {
		t.Fatalf("delete status=%d count=%d err=%v", resp.StatusCode, len(store.items), err)
	}
}

func TestLayoutBadBody(t *testing.T) {
	app := fiber.New()
	NewHandler(&fakeStore{}, layoutAuth).Register(app.Group("/api/v1"))
	resp, err := app.Test(httptest.NewRequest(http.MethodPost, "/api/v1/layouts", strings.NewReader("{")))
	if err != nil || resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status=%d err=%v", resp.StatusCode, err)
	}
}
