package timenavigation

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
)

func TestResolveOwnsShortcutPolicy(t *testing.T) {
	anchor := time.Date(2026, time.July, 11, 8, 0, 0, 0, time.UTC).Unix()
	tests := []struct {
		id        string
		timeframe string
		wantFrom  int64
	}{
		{"1D", "1m", time.Date(2026, time.July, 10, 8, 0, 0, 0, time.UTC).Unix()},
		{"5D", "5m", time.Date(2026, time.July, 6, 8, 0, 0, 0, time.UTC).Unix()},
		{"1M", "30m", time.Date(2026, time.June, 11, 8, 0, 0, 0, time.UTC).Unix()},
		{"3M", "1H", time.Date(2026, time.April, 11, 8, 0, 0, 0, time.UTC).Unix()},
		{"6M", "2H", time.Date(2026, time.January, 11, 8, 0, 0, 0, time.UTC).Unix()},
		{"YTD", "1D", time.Date(2026, time.January, 1, 0, 0, 0, 0, time.UTC).Unix()},
		{"1Y", "1W", time.Date(2025, time.July, 11, 8, 0, 0, 0, time.UTC).Unix()},
		{"5Y", "1W", time.Date(2021, time.July, 11, 8, 0, 0, 0, time.UTC).Unix()},
	}
	for _, test := range tests {
		t.Run(test.id, func(t *testing.T) {
			got, err := Resolve(test.id, anchor)
			if err != nil {
				t.Fatal(err)
			}
			if got.Timeframe != test.timeframe || got.From == nil || *got.From != test.wantFrom || got.To == nil || *got.To != anchor {
				t.Fatalf("unexpected resolution: %+v", got)
			}
		})
	}

	all, err := Resolve("All", 0)
	if err != nil || all.Mode != "all" || all.Timeframe != "1M" || all.From != nil || all.To != nil {
		t.Fatalf("unexpected All resolution: %+v, %v", all, err)
	}
}

func TestResolveRejectsInvalidInput(t *testing.T) {
	if _, err := Resolve("2D", 100); err == nil {
		t.Fatal("expected unsupported shortcut error")
	}
	if _, err := Resolve("1D", 0); err == nil {
		t.Fatal("expected invalid anchor error")
	}
}

func TestHTTPContract(t *testing.T) {
	app := fiber.New()
	RegisterRoutes(app.Group("/api/v1"))

	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/api/v1/chart/time-navigation/shortcuts", nil))
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var catalog CatalogResponse
	if err := json.NewDecoder(response.Body).Decode(&catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Shortcuts) != 9 || catalog.Shortcuts[0].ID != "1D" || catalog.Shortcuts[8].ID != "All" {
		t.Fatalf("unexpected catalog: %+v", catalog.Shortcuts)
	}
	if catalog.GoTo.Hotkey.Label != "Alt+G" || !catalog.GoTo.Hotkey.AltKey {
		t.Fatalf("unexpected Go-to hotkey: %+v", catalog.GoTo.Hotkey)
	}
	if len(catalog.GoTo.SpecificTimeTimeframes) != 7 || catalog.GoTo.SpecificTimeTimeframes[6] != "2H" {
		t.Fatalf("unexpected specific-time policy: %+v", catalog.GoTo.SpecificTimeTimeframes)
	}

	request := httptest.NewRequest(http.MethodPost, "/api/v1/chart/time-navigation/resolve", strings.NewReader(`{"shortcut":"YTD","anchorTime":1783756800}`))
	request.Header.Set("Content-Type", "application/json")
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var resolution Resolution
	if err := json.NewDecoder(response.Body).Decode(&resolution); err != nil {
		t.Fatal(err)
	}
	if resolution.Shortcut != "YTD" || resolution.From == nil {
		t.Fatalf("unexpected resolution: %+v", resolution)
	}
}
