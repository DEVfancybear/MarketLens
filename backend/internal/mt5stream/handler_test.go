package mt5stream

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type fakeSymbolSource struct {
	snapshot Snapshot
}

func (f fakeSymbolSource) Snapshot() Snapshot {
	return f.snapshot
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
