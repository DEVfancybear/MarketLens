package indicators

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

type fakeIndicatorStore struct {
	items    map[string][]IndicatorPreset
	seq      int
	lastUser string
}

func newFakeIndicatorStore() *fakeIndicatorStore {
	return &fakeIndicatorStore{items: map[string][]IndicatorPreset{}}
}

func (f *fakeIndicatorStore) List(_ context.Context, userID string) ([]IndicatorPreset, error) {
	f.lastUser = userID
	if f.items[userID] == nil {
		return []IndicatorPreset{}, nil
	}
	return f.items[userID], nil
}

func (f *fakeIndicatorStore) Save(_ context.Context, userID string, input IndicatorWrite) (IndicatorPreset, error) {
	f.lastUser = userID
	for i := range f.items[userID] {
		if input.ClientID != "" && f.items[userID][i].ClientID == input.ClientID {
			f.items[userID][i].IndicatorType = strings.ToUpper(input.IndicatorType)
			f.items[userID][i].Config = input.Config
			f.items[userID][i].Visible = visibleOrDefault(input.Visible)
			f.items[userID][i].Position = input.Position
			return f.items[userID][i], nil
		}
	}
	f.seq++
	item := IndicatorPreset{
		ID:            "ind-srv-" + itoa(f.seq),
		IndicatorType: strings.ToUpper(input.IndicatorType),
		Config:        input.Config,
		Visible:       visibleOrDefault(input.Visible),
		Position:      input.Position,
		ClientID:      input.ClientID,
		CreatedAt:     time.Unix(int64(f.seq), 0).UTC(),
		UpdatedAt:     time.Unix(int64(f.seq), 0).UTC(),
	}
	f.items[userID] = append(f.items[userID], item)
	return item, nil
}

func (f *fakeIndicatorStore) Replace(_ context.Context, userID, ref string, input IndicatorWrite) (IndicatorPreset, error) {
	f.lastUser = userID
	for i := range f.items[userID] {
		if f.items[userID][i].ID == ref || f.items[userID][i].ClientID == ref {
			f.items[userID][i].IndicatorType = strings.ToUpper(input.IndicatorType)
			f.items[userID][i].Config = input.Config
			f.items[userID][i].Visible = visibleOrDefault(input.Visible)
			f.items[userID][i].Position = input.Position
			if input.ClientID != "" {
				f.items[userID][i].ClientID = input.ClientID
			}
			return f.items[userID][i], nil
		}
	}
	return IndicatorPreset{}, ErrNotFound
}

func (f *fakeIndicatorStore) Delete(_ context.Context, userID, ref string) error {
	f.lastUser = userID
	for i, item := range f.items[userID] {
		if item.ID == ref || item.ClientID == ref {
			f.items[userID] = append(f.items[userID][:i], f.items[userID][i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func TestIndicatorHandlerSaveListAndDeleteByClientID(t *testing.T) {
	store := newFakeIndicatorStore()
	app := fiber.New()
	NewHandler(store, fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/indicators",
		strings.NewReader(`{"indicatorType":"ema","clientId":"ind-1","position":0,"visible":true,"config":{"id":"ind-1","type":"EMA","length":50}}`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("save indicator: %v", err)
	}
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("save status = %d, want 201", resp.StatusCode)
	}

	resp, err = app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/indicators", nil))
	if err != nil {
		t.Fatalf("list indicators: %v", err)
	}
	var list []IndicatorPreset
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list) != 1 || list[0].ClientID != "ind-1" || list[0].IndicatorType != "EMA" {
		t.Fatalf("unexpected list: %+v", list)
	}

	resp, err = app.Test(httptest.NewRequest(http.MethodDelete, "/api/v1/indicators/ind-1", nil))
	if err != nil {
		t.Fatalf("delete indicator: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("delete status = %d, want 200", resp.StatusCode)
	}
	if len(store.items["user-1"]) != 0 {
		t.Fatalf("indicator should be deleted, got %+v", store.items["user-1"])
	}
}

func TestIndicatorHandlerRejectsBadJSON(t *testing.T) {
	app := fiber.New()
	NewHandler(newFakeIndicatorStore(), fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/indicators",
		strings.NewReader(`{"indicatorType":"EMA","config":`),
	)
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("save bad indicator: %v", err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status = %d, want 400", resp.StatusCode)
	}
}

func visibleOrDefault(value *bool) bool {
	if value == nil {
		return true
	}
	return *value
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
