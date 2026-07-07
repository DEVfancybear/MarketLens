package mt5stream

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type fakeSymbolSource struct {
	snapshot Snapshot
	ticks    TickSnapshot
	history  HistorySnapshot
}

func (f fakeSymbolSource) Snapshot() Snapshot {
	return f.snapshot
}

func (f fakeSymbolSource) Ticks(_ []string) TickSnapshot {
	return f.ticks
}

func (f fakeSymbolSource) History(_ context.Context, _ string, _ string, _ int, _ int64) HistorySnapshot {
	return f.history
}

func TestSymbolsEndpointReturnsCatalogSnapshot(t *testing.T) {
	app := fiber.New()
	NewHandler(fakeSymbolSource{
		snapshot: Snapshot{
			Connected:     true,
			BridgeURL:     "ws://localhost:8765",
			Source:        "mt5",
			Count:         1,
			StreamSymbols: []string{"EURUSD"},
			Symbols: []Symbol{
				{Name: "EURUSD", Path: "Forex\\Majors", Visible: true, Digits: 5},
			},
		},
	}).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mt5/symbols", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	var body Snapshot
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if !body.Connected || body.Count != 1 || len(body.Symbols) != 1 {
		t.Fatalf("unexpected snapshot: %+v", body)
	}
	if body.Symbols[0].Name != "EURUSD" {
		t.Fatalf("symbol name = %q", body.Symbols[0].Name)
	}
}

func TestHistoryEndpointReturnsCandles(t *testing.T) {
	app := fiber.New()
	NewHandler(fakeSymbolSource{
		history: HistorySnapshot{
			Connected: true,
			BridgeURL: "ws://localhost:8765",
			Source:    "mt5",
			Symbol:    "EURUSD",
			Timeframe: "15m",
			Candles: []Candle{
				{Time: 1800000000, Open: 1.1, High: 1.2, Low: 1.0, Close: 1.15, Volume: 10},
			},
		},
	}).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mt5/history?symbol=EURUSD&timeframe=15m&limit=10", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	var body HistorySnapshot
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if !body.Connected || len(body.Candles) != 1 || body.Candles[0].Close != 1.15 {
		t.Fatalf("unexpected history snapshot: %+v", body)
	}
}

func TestTicksEndpointReturnsLatestTicks(t *testing.T) {
	app := fiber.New()
	NewHandler(fakeSymbolSource{
		ticks: TickSnapshot{
			Connected: true,
			BridgeURL: "ws://localhost:8765",
			Source:    "mt5",
			Ticks: []Tick{
				{Symbol: "EURUSD", Bid: 1.12345, Ask: 1.12355, Timestamp: 1800000000},
			},
		},
	}).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mt5/ticks?symbols=EURUSD", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}

	var body TickSnapshot
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if !body.Connected || len(body.Ticks) != 1 {
		t.Fatalf("unexpected tick snapshot: %+v", body)
	}
	if body.Ticks[0].Symbol != "EURUSD" || body.Ticks[0].Bid == 0 || body.Ticks[0].Ask == 0 {
		t.Fatalf("unexpected tick: %+v", body.Ticks[0])
	}
}

func TestSymbolsEndpointReturnsEmptyCatalogWhenSourceMissing(t *testing.T) {
	app := fiber.New()
	NewHandler(nil).Register(app.Group("/api/v1"))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/mt5/symbols", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}

	var body Snapshot
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if body.Connected || len(body.Symbols) != 0 || body.LastError == "" {
		t.Fatalf("unexpected empty snapshot: %+v", body)
	}
}
