package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v3"

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
		ID:              fmt.Sprintf("server-%d", f.seq),
		ClientID:        normalized.ClientID,
		Symbol:          normalized.Symbol,
		Condition:       normalized.Condition,
		Price:           normalized.Price,
		Note:            normalized.Note,
		Status:          "active",
		Enabled:         *normalized.Enabled,
		Locked:          normalized.Locked,
		Recurring:       normalized.Recurring,
		Channels:        *normalized.Channels,
		Source:          normalized.Source,
		TechnicalTarget: normalized.TechnicalTarget,
		ArmingRevision:  1,
		CreatedAt:       now,
		UpdatedAt:       now,
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
			if item.Price != *normalized.Price {
				item.ArmingRevision++
			}
			item.Price = *normalized.Price
		}
		if normalized.Enabled != nil {
			item.Enabled = *normalized.Enabled
		}
		if normalized.TechnicalTarget != nil {
			item.ArmingRevision++
			item.TechnicalTarget = normalized.TechnicalTarget
		}
		if normalized.Status != nil {
			if *normalized.Status == "active" && item.Status != "active" {
				item.ArmingRevision++
			}
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

func (f *fakeStore) Trigger(_ context.Context, userID, ref string, input TriggerInput) (Alert, Event, error) {
	f.lastUser = userID
	normalized, err := normalizeTriggerInput(input)
	if err != nil {
		return Alert{}, Event{}, ErrBadRequest
	}
	for i := range f.alerts[userID] {
		item := &f.alerts[userID][i]
		if item.ID != ref && item.ClientID != ref {
			continue
		}
		if normalized.ArmingRevision != item.ArmingRevision {
			return Alert{}, Event{}, ErrBadRequest
		}
		target := item.TechnicalTarget
		if target == nil {
			target = fixedTechnicalTarget(item.Price)
		}
		evaluated := evaluateTechnicalAlert(item.Condition, target, normalized.Previous, *normalized.Current)
		if !evaluated.Active || !evaluated.Triggered ||
			(normalized.TriggerPrice != nil && !nearlyEqual(*normalized.TriggerPrice, normalized.Current.Price)) ||
			(normalized.TargetPrice != nil && !nearlyEqual(*normalized.TargetPrice, evaluated.TargetPrice)) {
			return Alert{}, Event{}, ErrBadRequest
		}
		now := evidenceTimestamp(normalized.Current.Timestamp)
		for _, existing := range f.events[userID] {
			if existing.AlertID == externalRef(*item) &&
				existing.ArmingRevision == normalized.ArmingRevision &&
				existing.TriggeredAt.Equal(now) {
				if !nearlyEqual(existing.TriggerPrice, normalized.Current.Price) ||
					!nearlyEqual(existing.TargetPrice, evaluated.TargetPrice) {
					return Alert{}, Event{}, ErrBadRequest
				}
				return Alert{}, existing, ErrAlreadyTriggered
			}
		}
		if !item.Enabled || item.Status != "active" {
			return Alert{}, Event{}, ErrBadRequest
		}
		item.TriggerPrice = &normalized.Current.Price
		item.TriggeredAt = &now
		if !item.Recurring {
			item.Status = "triggered"
		}
		f.seq++
		event := Event{
			ID:             fmt.Sprintf("event-%d", f.seq),
			AlertID:        externalRef(*item),
			Symbol:         item.Symbol,
			Condition:      item.Condition,
			TargetPrice:    evaluated.TargetPrice,
			TriggerPrice:   normalized.Current.Price,
			TriggeredAt:    now,
			ArmingRevision: normalized.ArmingRevision,
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
	snapshot := Snapshot{Alerts: []Alert{}, TriggeredAlerts: []Alert{}, ExpiredAlerts: []Alert{}, History: f.events[userID]}
	for _, item := range items {
		if item.Status == "triggered" {
			snapshot.TriggeredAlerts = append(snapshot.TriggeredAlerts, item)
		} else if item.Status == "expired" {
			snapshot.ExpiredAlerts = append(snapshot.ExpiredAlerts, item)
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

	resp = doRequest(t, app, http.MethodPatch, "/api/v1/alerts/alert-1", `{"enabled":true,"price":1.13}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("patch status = %d, want 200", resp.StatusCode)
	}

	resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/alert-1/trigger", `{
		"triggerPrice":1.131,"targetPrice":1.13,"armingRevision":2,
		"previous":{"price":1.129,"timestamp":1750000000},
		"current":{"price":1.131,"timestamp":1750000001}
	}`)
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
	resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/alert-1/trigger", `{
		"triggerPrice":1.131,"targetPrice":1.13,"armingRevision":2,
		"previous":{"price":1.129,"timestamp":1750000000},
		"current":{"price":1.131,"timestamp":1750000001}
	}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("idempotent authenticated trigger status = %d, want 200", resp.StatusCode)
	}
	var retryBody struct {
		AlreadyTriggered bool `json:"alreadyTriggered"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&retryBody); err != nil || !retryBody.AlreadyTriggered {
		t.Fatalf("authenticated trigger retry was not acknowledged: body=%+v err=%v", retryBody, err)
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

func TestDynamicTechnicalTargetRoundTripAndTriggerPrice(t *testing.T) {
	store := newFakeStore()
	app := newTestApp(store)
	resp := doRequest(t, app, http.MethodPost, "/api/v1/alerts", `{
		"clientId":"dynamic-1","symbol":"EURUSD","condition":"crossUp","price":1.125,
		"technicalTarget":{
			"version":1,"kind":"dynamic-line",
			"a":{"time":1750000000,"price":1.12},
			"b":{"time":1750003600,"price":1.13},
			"domain":"ray","interpolation":"linear"
		}
	}`)
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("create dynamic alert status = %d, want 201", resp.StatusCode)
	}
	var created Alert
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode dynamic alert: %v", err)
	}
	if created.TechnicalTarget == nil || created.TechnicalTarget.Kind != "dynamic-line" ||
		created.TechnicalTarget.Domain != "ray" {
		t.Fatalf("technical target did not round trip: %+v", created.TechnicalTarget)
	}

	resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/dynamic-1/trigger", `{"triggerPrice":1.141,"armingRevision":1}`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("dynamic trigger without evidence status = %d, want 400", resp.StatusCode)
	}
	for name, body := range map[string]string{
		"forged target": `{
			"targetPrice":9,"armingRevision":1,
			"previous":{"price":1.139,"timestamp":1750007100},
			"current":{"price":1.141,"timestamp":1750007200}
		}`,
		"forged trigger": `{
			"triggerPrice":9,"armingRevision":1,
			"previous":{"price":1.139,"timestamp":1750007100},
			"current":{"price":1.141,"timestamp":1750007200}
		}`,
		"non triggering evidence": `{
			"armingRevision":1,
			"previous":{"price":1.141,"timestamp":1750007100},
			"current":{"price":1.141,"timestamp":1750007200}
		}`,
		"stale revision": `{
			"armingRevision":2,
			"previous":{"price":1.139,"timestamp":1750007100},
			"current":{"price":1.141,"timestamp":1750007200}
		}`,
	} {
		resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/dynamic-1/trigger", body)
		if resp.StatusCode != fiber.StatusBadRequest {
			t.Fatalf("%s status = %d, want 400", name, resp.StatusCode)
		}
	}

	resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/dynamic-1/trigger", `{
		"triggerPrice":1.141,"targetPrice":1.14,"armingRevision":1,
		"previous":{"price":1.139,"timestamp":1750007100},
		"current":{"price":1.141,"timestamp":1750007200}
	}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("dynamic trigger status = %d, want 200", resp.StatusCode)
	}
	var result struct {
		Alert Alert `json:"alert"`
		Event Event `json:"event"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode dynamic trigger: %v", err)
	}
	if !nearlyEqual(result.Event.TargetPrice, 1.14) || result.Event.TriggerPrice != 1.141 ||
		result.Alert.TechnicalTarget == nil {
		t.Fatalf("dynamic trigger did not preserve evaluated target: %+v", result)
	}
	if !result.Event.TriggeredAt.Equal(time.Unix(1_750_007_200, 0).UTC()) {
		t.Fatalf("event trigger time = %v, want current evidence timestamp", result.Event.TriggeredAt)
	}
}

func TestExpiredAlertListAndRearmRevision(t *testing.T) {
	app := newTestApp(newFakeStore())
	resp := doRequest(t, app, http.MethodPost, "/api/v1/alerts", `{
		"clientId":"expires-1","symbol":"EURUSD","condition":"above","price":1.2
	}`)
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("create status = %d, want 201", resp.StatusCode)
	}
	resp = doRequest(t, app, http.MethodPatch, "/api/v1/alerts/expires-1", `{"status":"expired"}`)
	var expired Alert
	if resp.StatusCode != fiber.StatusOK || json.NewDecoder(resp.Body).Decode(&expired) != nil {
		t.Fatalf("expire status = %d", resp.StatusCode)
	}
	if expired.Status != "expired" || expired.ArmingRevision != 1 {
		t.Fatalf("expired alert = %+v", expired)
	}
	resp = doRequest(t, app, http.MethodGet, "/api/v1/alerts?status=expired", "")
	var rows []Alert
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil || len(rows) != 1 {
		t.Fatalf("expired rows = %+v, err=%v", rows, err)
	}
	resp = doRequest(t, app, http.MethodPatch, "/api/v1/alerts/expires-1", `{"status":"active"}`)
	var active Alert
	if resp.StatusCode != fiber.StatusOK || json.NewDecoder(resp.Body).Decode(&active) != nil {
		t.Fatalf("rearm status = %d", resp.StatusCode)
	}
	if active.Status != "active" || active.ArmingRevision != 2 {
		t.Fatalf("rearmed alert = %+v", active)
	}
}

func TestAlertRouteRejectsInvalidTechnicalTarget(t *testing.T) {
	app := newTestApp(newFakeStore())
	resp := doRequest(t, app, http.MethodPost, "/api/v1/alerts", `{
		"symbol":"EURUSD","condition":"crossUp","price":1.125,
		"technicalTarget":{
			"version":1,"kind":"dynamic-line",
			"a":{"time":1750000000,"price":1.12},
			"b":{"time":1750000000,"price":1.13},
			"domain":"segment","interpolation":"linear"
		}
	}`)
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid technical target status = %d, want 400", resp.StatusCode)
	}
}

func TestDynamicChannelPatchAndTrigger(t *testing.T) {
	app := newTestApp(newFakeStore())
	resp := doRequest(t, app, http.MethodPost, "/api/v1/alerts", `{
		"clientId":"channel-1","symbol":"EURUSD","condition":"crossUp","price":1.15,
		"technicalTarget":{
			"version":1,"kind":"dynamic-channel","operator":"inside",
			"boundaryA":{"version":1,"kind":"dynamic-line","a":{"time":1750000000,"price":1.10},"b":{"time":1750003600,"price":1.11},"domain":"ray","interpolation":"linear"},
			"boundaryB":{"version":1,"kind":"dynamic-line","a":{"time":1750000000,"price":1.20},"b":{"time":1750003600,"price":1.21},"domain":"ray","interpolation":"linear"}
		}
	}`)
	if resp.StatusCode != fiber.StatusCreated {
		t.Fatalf("create channel alert status = %d, want 201", resp.StatusCode)
	}

	resp = doRequest(t, app, http.MethodPatch, "/api/v1/alerts/channel-1", `{
		"technicalTarget":{
			"version":1,"kind":"dynamic-channel","operator":"outside",
			"boundaryA":{"version":1,"kind":"dynamic-line","a":{"time":1750000000,"price":1.10},"b":{"time":1750003600,"price":1.11},"domain":"ray","interpolation":"linear"},
			"boundaryB":{"version":1,"kind":"dynamic-line","a":{"time":1750000000,"price":1.20},"b":{"time":1750003600,"price":1.21},"domain":"ray","interpolation":"linear"}
		}
	}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("patch channel alert status = %d, want 200", resp.StatusCode)
	}
	var patched Alert
	if err := json.NewDecoder(resp.Body).Decode(&patched); err != nil {
		t.Fatalf("decode patched channel alert: %v", err)
	}
	if patched.TechnicalTarget == nil || patched.TechnicalTarget.Operator != "outside" {
		t.Fatalf("technical target patch did not round trip: %+v", patched.TechnicalTarget)
	}

	// `outside` is evaluated from channel state by the caller. Its trigger can
	// legitimately be below the representative boundary despite crossUp being
	// retained as the legacy alert condition.
	resp = doRequest(t, app, http.MethodPost, "/api/v1/alerts/channel-1/trigger", `{
		"triggerPrice":1.09,"targetPrice":1.11,"armingRevision":2,
		"current":{"price":1.09,"timestamp":1750003600}
	}`)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("trigger channel alert status = %d, want 200", resp.StatusCode)
	}
}

func TestWorkerTriggerPersistsLifecycleBeforeDeliveryAndRetriesIdempotently(t *testing.T) {
	store := newFakeStore()
	created, err := store.Create(context.Background(), "user-1", CreateInput{
		ClientID:  "worker-alert-1",
		Symbol:    "BTCUSD",
		Condition: "below",
		Price:     64_000,
	})
	if err != nil {
		t.Fatalf("seed alert: %v", err)
	}

	verifyToken := func(token string) (string, error) {
		switch token {
		case "token-user-1":
			return "user-1", nil
		case "token-user-2":
			return "user-2", nil
		default:
			return "", errors.New("invalid delivery token")
		}
	}
	app := fiber.New()
	NewHandler(store, fakeRequireAuth).
		WithWorkerTrigger("worker-secret", verifyToken).
		Register(app.Group("/api/v1"))

	body := fmt.Sprintf(`{
		"deliveryToken":"token-user-1","alertId":"%s",
		"triggerPrice":63965.72,"targetPrice":64000,
		"current":{"price":63965.72,"timestamp":1752836830.125},
		"armingRevision":%d
	}`, created.ClientID, created.ArmingRevision)

	resp := doWorkerRequest(t, app, "wrong-secret", body)
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("wrong worker secret status = %d, want 401", resp.StatusCode)
	}
	resp = doWorkerRequest(t, app, "worker-secret", strings.Replace(body, "token-user-1", "invalid-token", 1))
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("invalid delivery token status = %d, want 401", resp.StatusCode)
	}
	resp = doWorkerRequest(t, app, "worker-secret", strings.Replace(body, "token-user-1", "token-user-2", 1))
	if resp.StatusCode != fiber.StatusNotFound {
		t.Fatalf("cross-user trigger status = %d, want 404", resp.StatusCode)
	}
	if len(store.events["user-1"]) != 0 || store.alerts["user-1"][0].Status != "active" {
		t.Fatalf("unauthorized attempts mutated alert state")
	}

	resp = doWorkerRequest(t, app, "worker-secret", body)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("worker trigger status = %d, want 200", resp.StatusCode)
	}
	if store.alerts["user-1"][0].Status != "triggered" || len(store.events["user-1"]) != 1 {
		t.Fatalf("worker trigger did not atomically persist lifecycle and history")
	}

	resp = doWorkerRequest(t, app, "worker-secret", body)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("idempotent retry status = %d, want 200", resp.StatusCode)
	}
	var retry struct {
		OK               bool `json:"ok"`
		AlreadyTriggered bool `json:"alreadyTriggered"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&retry); err != nil {
		t.Fatalf("decode retry response: %v", err)
	}
	if !retry.OK || !retry.AlreadyTriggered || len(store.events["user-1"]) != 1 {
		t.Fatalf("retry was not idempotent: response=%+v events=%d", retry, len(store.events["user-1"]))
	}

	// Reopening the browser hydrates from this snapshot. A one-time alert that
	// the closed-browser worker already triggered must not return to the active
	// collection (and therefore must not recreate its chart alert line).
	snapshot, err := store.Snapshot(context.Background(), "user-1")
	if err != nil {
		t.Fatalf("snapshot after worker trigger: %v", err)
	}
	if len(snapshot.Alerts) != 0 || len(snapshot.TriggeredAlerts) != 1 || len(snapshot.History) != 1 {
		t.Fatalf(
			"reopen snapshot = active:%d triggered:%d history:%d, want 0/1/1",
			len(snapshot.Alerts),
			len(snapshot.TriggeredAlerts),
			len(snapshot.History),
		)
	}
	if snapshot.TriggeredAlerts[0].ClientID != created.ClientID ||
		snapshot.History[0].AlertID != created.ClientID {
		t.Fatalf("snapshot did not retain the triggered alert identity: %+v", snapshot)
	}
}

func TestWorkerTriggerAcceptsDynamicTrendlineCrossEvidence(t *testing.T) {
	store := newFakeStore()
	created, err := store.Create(context.Background(), "user-1", CreateInput{
		ClientID:  "worker-trendline-1",
		Symbol:    "EURUSD",
		Condition: "crossUp",
		Price:     1.125,
		TechnicalTarget: &TechnicalAlertTarget{
			Version:       1,
			Kind:          "dynamic-line",
			A:             &TechnicalAlertPoint{Time: 1_750_000_000, Price: 1.12},
			B:             &TechnicalAlertPoint{Time: 1_750_003_600, Price: 1.13},
			Domain:        "ray",
			Interpolation: "linear",
		},
	})
	if err != nil {
		t.Fatalf("seed dynamic trendline alert: %v", err)
	}

	app := fiber.New()
	NewHandler(store, fakeRequireAuth).
		WithWorkerTrigger("worker-secret", func(token string) (string, error) {
			if token != "token-user-1" {
				return "", errors.New("invalid delivery token")
			}
			return "user-1", nil
		}).
		Register(app.Group("/api/v1"))

	body := fmt.Sprintf(`{
		"deliveryToken":"token-user-1","alertId":"%s",
		"triggerPrice":1.141,"targetPrice":1.14,
		"previous":{"price":1.139,"timestamp":1750007100},
		"current":{"price":1.141,"timestamp":1750007200},
		"armingRevision":%d
	}`, created.ClientID, created.ArmingRevision)
	resp := doWorkerRequest(t, app, "worker-secret", body)
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("dynamic worker trigger status = %d, want 200", resp.StatusCode)
	}
	var result struct {
		OK               bool  `json:"ok"`
		AlreadyTriggered bool  `json:"alreadyTriggered"`
		Alert            Alert `json:"alert"`
		Event            Event `json:"event"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		t.Fatalf("decode dynamic worker trigger: %v", err)
	}
	if !result.OK || result.AlreadyTriggered || result.Alert.Status != "triggered" {
		t.Fatalf("unexpected dynamic worker trigger response: %+v", result)
	}
	if result.Alert.TechnicalTarget == nil || result.Alert.TechnicalTarget.Kind != "dynamic-line" ||
		!nearlyEqual(result.Event.TargetPrice, 1.14) ||
		!nearlyEqual(result.Event.TriggerPrice, 1.141) ||
		result.Event.ArmingRevision != created.ArmingRevision {
		t.Fatalf("worker did not persist verified trendline evidence: %+v", result)
	}
	if !result.Event.TriggeredAt.Equal(time.Unix(1_750_007_200, 0).UTC()) {
		t.Fatalf("dynamic worker event time = %v, want evidence time", result.Event.TriggeredAt)
	}
}

func TestWorkerTriggerFailsClosedWithoutServerSecret(t *testing.T) {
	app := fiber.New()
	NewHandler(newFakeStore(), fakeRequireAuth).
		WithWorkerTrigger("", func(string) (string, error) { return "user-1", nil }).
		Register(app.Group("/api/v1"))

	resp := doWorkerRequest(t, app, "", `{"deliveryToken":"token","alertId":"alert-1"}`)
	if resp.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("blank worker configuration status = %d, want 401", resp.StatusCode)
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

func doWorkerRequest(t *testing.T, app *fiber.App, workerSecret, body string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v1/alerts/worker-trigger",
		strings.NewReader(body),
	)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-push-worker-secret", workerSecret)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("POST worker trigger: %v", err)
	}
	return resp
}

func fakeRequireAuth(c fiber.Ctx) error {
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
