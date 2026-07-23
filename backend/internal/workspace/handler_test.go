package workspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v3"

	alertspkg "github.com/smc-trading-terminal/backend/internal/alerts"
	"github.com/smc-trading-terminal/backend/internal/auth"
	"github.com/smc-trading-terminal/backend/internal/drawings"
	"github.com/smc-trading-terminal/backend/internal/indicators"
	"github.com/smc-trading-terminal/backend/internal/layouts"
	"github.com/smc-trading-terminal/backend/internal/pinescripts"
	"github.com/smc-trading-terminal/backend/internal/settings"
	"github.com/smc-trading-terminal/backend/internal/watchlists"
)

type fakeSettingsReader struct {
	doc      settings.Document
	lastUser string
}

func (f *fakeSettingsReader) Get(_ context.Context, userID string) (settings.Document, error) {
	f.lastUser = userID
	return f.doc, nil
}

type fakeWatchlistLister struct{}

func (f *fakeWatchlistLister) List(_ context.Context, _ string) ([]watchlists.Watchlist, error) {
	return []watchlists.Watchlist{}, nil
}

type fakeDrawingTemplateLister struct {
	templates []drawings.DrawingTemplate
	lastUser  string
}

func (f *fakeDrawingTemplateLister) ListTemplates(_ context.Context, userID string) ([]drawings.DrawingTemplate, error) {
	f.lastUser = userID
	return f.templates, nil
}

type fakeIndicatorLister struct {
	items    []indicators.IndicatorPreset
	lastUser string
}

func (f *fakeIndicatorLister) List(_ context.Context, userID string) ([]indicators.IndicatorPreset, error) {
	f.lastUser = userID
	return f.items, nil
}

type fakePineScriptLister struct {
	items    []pinescripts.Script
	lastUser string
}

type fakeAlertSnapshotReader struct {
	snapshot alertspkg.Snapshot
	lastUser string
}

type fakeLayoutLister struct {
	items []layouts.Layout
}

func (f *fakeLayoutLister) List(_ context.Context, _ string) ([]layouts.Layout, error) {
	return f.items, nil
}

func (f *fakeAlertSnapshotReader) Snapshot(_ context.Context, userID string) (alertspkg.Snapshot, error) {
	f.lastUser = userID
	return f.snapshot, nil
}

func (f *fakePineScriptLister) List(_ context.Context, userID string) ([]pinescripts.Script, error) {
	f.lastUser = userID
	return f.items, nil
}

func TestBootstrapReturnsSettingsAndEmptySlices(t *testing.T) {
	reader := &fakeSettingsReader{doc: settings.Document{
		UI:            json.RawMessage(`{"theme":"dark"}`),
		SMC:           json.RawMessage(`{}`),
		Chart:         json.RawMessage(`{}`),
		Notifications: json.RawMessage(`{}`),
	}}
	templateLister := &fakeDrawingTemplateLister{
		templates: []drawings.DrawingTemplate{{
			ID:     "tpl-1",
			Name:   "Blue line",
			Family: "line",
			Style:  json.RawMessage(`{"color":"#2962ff"}`),
		}},
	}
	indicatorLister := &fakeIndicatorLister{
		items: []indicators.IndicatorPreset{{
			ID:            "ind-srv-1",
			IndicatorType: "EMA",
			Config:        json.RawMessage(`{"id":"ind-1","type":"EMA","length":50}`),
			Visible:       true,
			Position:      0,
			ClientID:      "ind-1",
		}},
	}
	pineScriptLister := &fakePineScriptLister{
		items: []pinescripts.Script{{
			ID:       "pine-srv-1",
			Name:     "Better RSI",
			Favorite: true,
			ClientID: "pine-1",
		}},
	}
	alertReader := &fakeAlertSnapshotReader{snapshot: alertspkg.Snapshot{
		Alerts:          []alertspkg.Alert{{ID: "alert-server-1", ClientID: "alert-1", Symbol: "EURUSD", Status: "active"}},
		TriggeredAlerts: []alertspkg.Alert{},
		ExpiredAlerts:   []alertspkg.Alert{},
		History:         []alertspkg.Event{},
	}}

	app := fiber.New()
	layoutLister := &fakeLayoutLister{items: []layouts.Layout{{ID: "layout-1", Name: "Scalping", State: json.RawMessage(`{"version":1}`)}}}
	NewHandler(reader, &fakeWatchlistLister{}, templateLister, indicatorLister, pineScriptLister, alertReader, layoutLister, fakeRequireAuth).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/sync/bootstrap", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("bootstrap: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("bootstrap status = %d, want 200", resp.StatusCode)
	}
	if reader.lastUser != "user-1" {
		t.Fatalf("handler should pass auth user id, got %q", reader.lastUser)
	}
	if templateLister.lastUser != "user-1" {
		t.Fatalf("template lister should pass auth user id, got %q", templateLister.lastUser)
	}
	if indicatorLister.lastUser != "user-1" {
		t.Fatalf("indicator lister should pass auth user id, got %q", indicatorLister.lastUser)
	}
	if pineScriptLister.lastUser != "user-1" {
		t.Fatalf("pine script lister should pass auth user id, got %q", pineScriptLister.lastUser)
	}
	if alertReader.lastUser != "user-1" {
		t.Fatalf("alert snapshot should pass auth user id, got %q", alertReader.lastUser)
	}

	var body struct {
		Settings         settings.Document            `json:"settings"`
		Watchlists       []any                        `json:"watchlists"`
		DrawingTemplates []drawings.DrawingTemplate   `json:"drawingTemplates"`
		Indicators       []indicators.IndicatorPreset `json:"indicators"`
		PineScripts      []pinescripts.Script         `json:"pineScripts"`
		Alerts           []alertspkg.Alert            `json:"alerts"`
		TriggeredAlerts  []alertspkg.Alert            `json:"triggeredAlerts"`
		ExpiredAlerts    []alertspkg.Alert            `json:"expiredAlerts"`
		History          []alertspkg.Event            `json:"history"`
		Layouts          []layouts.Layout             `json:"layouts"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode bootstrap response: %v", err)
	}
	if body.Watchlists == nil || body.DrawingTemplates == nil || body.Indicators == nil ||
		body.PineScripts == nil || body.Alerts == nil || body.TriggeredAlerts == nil || body.ExpiredAlerts == nil ||
		body.History == nil || body.Layouts == nil {
		t.Fatal("bootstrap arrays must be empty arrays, not null")
	}
	if len(body.DrawingTemplates) != 1 || body.DrawingTemplates[0].Name != "Blue line" {
		t.Fatalf("bootstrap should include drawing templates, got %+v", body.DrawingTemplates)
	}
	if len(body.Indicators) != 1 || body.Indicators[0].ClientID != "ind-1" {
		t.Fatalf("bootstrap should include indicator presets, got %+v", body.Indicators)
	}
	if len(body.PineScripts) != 1 || body.PineScripts[0].ClientID != "pine-1" || body.PineScripts[0].SourceCode != "" {
		t.Fatalf("bootstrap should include pine script metadata only, got %+v", body.PineScripts)
	}
	if len(body.Alerts) != 1 || body.Alerts[0].ClientID != "alert-1" {
		t.Fatalf("bootstrap should include alerts, got %+v", body.Alerts)
	}
	if len(body.Layouts) != 1 || body.Layouts[0].Name != "Scalping" {
		t.Fatalf("bootstrap should include layouts, got %+v", body.Layouts)
	}
	if string(body.Settings.UI) != `{"theme":"dark"}` {
		t.Fatalf("unexpected settings ui: %s", body.Settings.UI)
	}
}

func fakeRequireAuth(c fiber.Ctx) error {
	c.Locals(auth.LocalUserID, "user-1")
	c.Locals(auth.LocalSessionID, "session-1")
	return c.Next()
}
