package alerts

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/smc-trading-terminal/backend/internal/auth"
)

type fakeStore struct {
	alerts   map[string][]Alert
	events   map[string][]Event
	tokens   map[string]PushToken
	seq      int
	lastUser string
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		alerts: map[string][]Alert{},
		events: map[string][]Event{},
		tokens: map[string]PushToken{},
	}
}

func (f *fakeStore) List(_ context.Context, userID, status string) ([]Alert, error) {
	f.lastUser = userID
	out := []Alert{}
	for _, item := range f.alerts[userID] {
		if status == "" || item.Status == status {
			out = append(out, item)
		}
	}
	return out, nil
}

func (f *fakeStore) Create(_ context.Context, userID string, input CreateInput) (Alert, error) {
	f.lastUser = userID
	normalized, err := normalizeCreate(input)
	if err != nil {
		return Alert{}, err
	}
	for i := range f.alerts[userID] {
		if normalized.ClientID != "" && f.alerts[userID][i].ClientID == normalized.ClientID {
			return f.alerts[userID][i], nil
		}
	}
	f.seq++
	now := time.Unix(int64(f.seq), 0).UTC()
	item := Alert{
		ID:        fmt.Sprintf("server-%d", f.seq),
		ClientID:  normalized.ClientID,
		Symbol:    normalized.Symbol,
		Condition: normalized.Condition,
		Price:     normalized.Price,
		Note:      normalized.Note,
		Status:    "active",
		Enabled:   *normalized.Enabled,
		Locked:    normalized.Locked,
		Recurring: normalized.Recurring,
		Channels:  *normalized.Channels,
		Source:    normalized.Source,
		CreatedAt: now,
		UpdatedAt: now,
	}
	f.alerts[userID] = append([]Alert{item}, f.alerts[userID]...)
	return item, nil
}

func (f *fakeStore) Patch(_ context.Context, userID, ref string, input PatchInput) (Alert, error) {
	f.lastUser = userID
	normalized, err := normalizePatch(input)
	if err != nil {
		return Alert{}, err
	}
	for i := range f.alerts[userID] {
		item := &f.alerts[userID][i]
		if item.ID != ref && item.ClientID != ref {
			continue
		}
		if normalized.Price != nil {
			item.Price = *normalized.Price
		}
		if normalized.Enabled != nil {
			item.Enabled = *normalized.Enabled
		}
		if normalized.Status != nil {
			item.Status = *normalized.Status
			item.TriggerPrice = nil
			item.TriggeredAt = nil
		}
		return *item, nil
	}
	return Alert{}, ErrNotFound
}

func (f *fakeStore) Delete(_ context.Context, userID, ref string) error {
	f.lastUser = userID
	for i, item := range f.alerts[userID] {
		if item.ID == ref || item.ClientID == ref {
			f.alerts[userID] = append(f.alerts[userID][:i], f.alerts[userID][i+1:]...)
			return nil
		}
	}
	return ErrNotFound
}

func (f *fakeStore) Trigger(_ context.Context, userID, ref string, triggerPrice float64) (Alert, Event, error) {
	f.lastUser = userID
	if !validPrice(triggerPrice) {
		return Alert{}, Event{}, ErrBadRequest
	}
	for i := range f.alerts[userID] {
		item := &f.alerts[userID][i]
		if item.ID != ref && item.ClientID != ref {
			continue
		}
		now := time.Unix(int64(len(f.events[userID])+100), 0).UTC()
		item.TriggerPrice = &triggerPrice
		item.TriggeredAt = &now
		if !item.Recurring {
			item.Status = "triggered"
		}
		f.seq++
		event := Event{
			ID:           fmt.Sprintf("event-%d", f.seq),
			AlertID:      externalRef(*item),
			Symbol:       item.Symbol,
			Condition:    item.Condition,
			TargetPrice:  item.Price,
			TriggerPrice: triggerPrice,
			TriggeredAt:  now,
		}
		f.events[userID] = append([]Event{event}, f.events[userID]...)
		return *item, event, nil
	}
	return Alert{}, Event{}, ErrNotFound
}

func (f *fakeStore) ListEvents(_ context.Context, userID, ref string, _ int) ([]Event, error) {
	f.lastUser = userID
	out := []Event{}
	for _, event := range f.events[userID] {
		if event.AlertID == ref {
			out = append(out, event)
		}
	}
	return out, nil
}

func (f *fakeStore) ListHistory(_ context.Context, userID string, _ int) ([]Event, error) {
	f.lastUser = userID
	return append([]Event{}, f.events[userID]...), nil
}

func (f *fakeStore) ClearHistory(_ context.Context, userID string) error {
	f.lastUser = userID
	f.events[userID] = []Event{}
	return nil
}

func (f *fakeStore) Snapshot(ctx context.Context, userID string) (Snapshot, error) {
	items, _ := f.List(ctx, userID, "")
	snapshot := Snapshot{Alerts: []Alert{}, TriggeredAlerts: []Alert{}, History: f.events[userID]}
	for _, item := range items {
		if item.Status == "triggered" {
			snapshot.TriggeredAlerts = append(snapshot.TriggeredAlerts, item)
		} else {
			snapshot.Alerts = append(snapshot.Alerts, item)
		}
	}
	return snapshot, nil
}

func (f *fakeStore) UpsertPushToken(_ context.Context, userID string, input PushTokenInput) (PushToken, error) {
	f.lastUser = userID
	normalized, err := normalizePushToken(input)
	if err != nil {
		return PushToken{}, err
	}
	now := time.Unix(int64(len(f.tokens)+200), 0).UTC()
	item, ok := f.tokens[normalized.FCMToken]
	if !ok {
		item = PushToken{ID: fmt.Sprintf("token-%d", len(f.tokens)+1), CreatedAt: now}
	}
	item.FCMToken = normalized.FCMToken
	item.Platform = normalized.Platform
	item.Permission = normalized.Permission
	item.LastSeenAt = now
	f.tokens[normalized.FCMToken] = item
	return item, nil
}

func (f *fakeStore) DeletePushToken(_ context.Context, userID, token string) error {
	f.lastUser = userID
	if _, ok := f.tokens[token]; !ok {
		return ErrNotFound
	}
	delete(f.tokens, token)
	return nil
}

func TestAlertRoutesCRUDTriggerAndHistory(t *testing.T) {
	store := newFakeStore()
	app := newTestApp(store)

	resp := doRequest(t, app, http.MethodPost, "/api/v1/alerts", `{
		"clientId":"alert-1","symbol":"EURUSD","condition":"crossUp","price":1.12,
		"recurring":false,"channels":{"sound":true,"push":true}
	}`)
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("create status = %d, want 201", resp.StatusCode)
	}

	resp = doRequest(t, app, http.MethodPatch, "/api/v1/alerts/alert-1", `{"enabled":false,"price":1.13}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("patch status = %d, want 200", resp.StatusCode)
	}

	resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/alert-1/trigger", `{"triggerPrice":1.131}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("trigger status = %d, want 200", resp.StatusCode)
	}
	var triggerBody struct {
		Alert Alert `json:"alert"`
		Event Event `json:"event"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&triggerBody); err != nil {
		t.Fatalf("decode trigger: %v", err)
	}
	if triggerBody.Alert.Status != "triggered" || triggerBody.Event.AlertID != "alert-1" {
		t.Fatalf("unexpected trigger response: %+v", triggerBody)
	}

	resp = doRequest(t, app, http.MethodGet, "/api/v1/alerts/history", "")
	var history []Event
	if err := json.NewDecoder(resp.Body).Decode(&history); err != nil {
		t.Fatalf("decode history: %v", err)
	}
	if len(history) != 1 || history[0].TriggerPrice != 1.131 {
		t.Fatalf("unexpected history: %+v", history)
	}

	resp = doRequest(t, app, http.MethodDelete, "/api/v1/alerts/history", "")
	if resp.StatusCode != fiber.StatusOK || len(store.events["user-1"]) != 0 {
		t.Fatalf("clear history failed: status=%d events=%d", resp.StatusCode, len(store.events["user-1"]))
	}
	if store.lastUser != "user-1" {
		t.Fatalf("routes should use auth user, got %q", store.lastUser)
	}
}

func TestPushTokenRoutesUpsertAndDelete(t *testing.T) {
	store := newFakeStore()
	app := newTestApp(store)

	resp := doRequest(t, app, http.MethodPost, "/api/v1/push/tokens", `{"fcmToken":"abc/123","platform":"web","permission":"granted"}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("register token status = %d, want 200", resp.StatusCode)
	}
	resp = doRequest(t, app, http.MethodPost, "/api/v1/push/tokens", `{"fcmToken":"abc/123","platform":"web","permission":"default"}`)
	if resp.StatusCode != fiber.StatusOK || len(store.tokens) != 1 {
		t.Fatalf("token upsert should not duplicate: status=%d count=%d", resp.StatusCode, len(store.tokens))
	}
	resp = doRequest(t, app, http.MethodDelete, "/api/v1/push/tokens/abc%2F123", "")
	if resp.StatusCode != fiber.StatusOK || len(store.tokens) != 0 {
		t.Fatalf("delete token failed: status=%d count=%d", resp.StatusCode, len(store.tokens))
	}
}

func TestAlertRoutesRejectInvalidInput(t *testing.T) {
	app := newTestApp(newFakeStore())
	resp := doRequest(t, app, http.MethodPost, "/api/v1/alerts", `{"symbol":"EURUSD","condition":"touch","price":0}`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid alert status = %d, want 400", resp.StatusCode)
	}
	resp = doRequest(t, app, http.MethodPost, "/api/v1/push/tokens", `{"fcmToken":"token","permission":"maybe"}`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid token status = %d, want 400", resp.StatusCode)
	}
}

func newTestApp(store Store) *fiber.App {
	app := fiber.New()
	NewHandler(store, fakeRequireAuth).Register(app.Group("/api/v1"))
	return app
}

func doRequest(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func fakeRequireAuth(c *fiber.Ctx) error {
	c.Locals(auth.LocalUserID, "user-1")
	c.Locals(auth.LocalSessionID, "session-1")
	return c.Next()
}

func externalRef(item Alert) string {
	if item.ClientID != "" {
		return item.ClientID
	}
	return item.ID
}
