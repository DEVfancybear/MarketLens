package pineruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestIndicatorRuntimeNormalizesCandlesAndRejectsInvalidNumbers(t *testing.T) {
	candles := normalizeRuntimeCandles([]Candle{
		{Time: 3, Open: 3, High: 4, Low: 2, Close: 3, Volume: 1},
		{Time: 0, Open: 9, High: 9, Low: 9, Close: 9, Volume: 1},
		{Time: 2, Open: 2, High: 3, Low: 1, Close: 2, Volume: 1},
		{Time: 3, Open: 4, High: 5, Low: 3, Close: 4, Volume: 2},
		{Time: 4, Open: math.NaN(), High: 5, Low: 3, Close: 4, Volume: 1},
	})
	if len(candles) != 2 || candles[0].Time != 2 || candles[1].Time != 3 {
		t.Fatalf("candles were not filtered, sorted, and deduplicated: %+v", candles)
	}
	if candles[1].Close != 4 || candles[1].Volume != 2 {
		t.Fatalf("last duplicate should win: %+v", candles[1])
	}
	if got := runtimeLength(map[string]any{"length": "not-a-number"}, "length", 25); got != 25 {
		t.Fatalf("invalid numeric config should use fallback, got %d", got)
	}
}

func TestRuntimePivotsRejectEqualPlateaus(t *testing.T) {
	if got := detectRuntimePivots([]float64{1, 3, 3, 1}, 1, 1, "high"); len(got) != 0 {
		t.Fatalf("equal high plateau should not be a strict pivot: %+v", got)
	}
	if got := detectRuntimePivots([]float64{3, 1, 1, 3}, 1, 1, "low"); len(got) != 0 {
		t.Fatalf("equal low plateau should not be a strict pivot: %+v", got)
	}
}

func runtimeConfig(id, indicatorType string) map[string]any {
	return map[string]any{
		"id":      id,
		"type":    indicatorType,
		"length":  5,
		"length2": 4,
		"length3": 9,
		"color":   "#2962ff",
		"color2":  "#ff9800",
		"inputValues": map[string]any{
			"highSource": "high",
			"lowSource":  "low",
		},
	}
}

func TestIndicatorRuntimeRegistryComputesEveryCurrentBuiltIn(t *testing.T) {
	candles := sampleIntradayCandles(18)
	for _, indicatorType := range []string{"SMA", "EMA", "VWAP", "RSI", "MACD", "ADR", "SWING_SR"} {
		t.Run(indicatorType, func(t *testing.T) {
			response := ComputeIndicatorRuntime(context.Background(), IndicatorRuntimeRequest{
				IndicatorType: indicatorType,
				IndicatorID:   "runtime-" + indicatorType,
				Config:        runtimeConfig("runtime-"+indicatorType, indicatorType),
				Candles:       candles,
			})
			if len(response.Errors) > 0 {
				t.Fatalf("runtime errors: %+v", response.Errors)
			}
			if response.Result.ID != "runtime-"+indicatorType {
				t.Fatalf("result id = %q", response.Result.ID)
			}
			if len(response.Result.Series) == 0 {
				t.Fatalf("%s returned no series", indicatorType)
			}
		})
	}
}

func TestIndicatorRuntimeSwingProducesConfirmedHorizontalSegments(t *testing.T) {
	highs := []float64{1, 2, 5, 3, 2, 4, 6, 3, 2}
	lows := []float64{0, -1, -3, -1, 0, -2, -1, -1, 0}
	candles := make([]Candle, len(highs))
	for index := range candles {
		candles[index] = Candle{
			Time:   int64(index + 1),
			Open:   (highs[index] + lows[index]) / 2,
			High:   highs[index],
			Low:    lows[index],
			Close:  (highs[index] + lows[index]) / 2,
			Volume: 1,
		}
	}
	config := runtimeConfig("swing", "SWING_SR")
	config["length"] = 2
	config["length2"] = 2
	config["color"] = "#ef5350"
	config["color2"] = "#26c6da"
	response := ComputeIndicatorRuntime(context.Background(), IndicatorRuntimeRequest{
		IndicatorType: "SWING_SR",
		IndicatorID:   "swing",
		Config:        config,
		Candles:       candles,
	})
	if len(response.Errors) > 0 {
		t.Fatalf("runtime errors: %+v", response.Errors)
	}
	if len(response.Result.Series) != 4 {
		t.Fatalf("expected two high and two low segments, got %+v", response.Result.Series)
	}
	firstHigh := response.Result.Series[0]
	activeHigh := response.Result.Series[1]
	if firstHigh.Key != "swing-high:2" || len(firstHigh.Data) != 4 {
		t.Fatalf("unexpected first high segment: %+v", firstHigh)
	}
	for _, point := range firstHigh.Data {
		if point.Value != 5 {
			t.Fatalf("first high segment is not horizontal: %+v", firstHigh.Data)
		}
	}
	if firstHigh.LastValueVisible == nil || *firstHigh.LastValueVisible {
		t.Fatalf("historical segment should not show a price label: %+v", firstHigh)
	}
	if activeHigh.Key != "swing-high:6" || activeHigh.LastValueVisible == nil || !*activeHigh.LastValueVisible {
		t.Fatalf("active segment should show a price label: %+v", activeHigh)
	}
	if activeHigh.LineStyle == nil || *activeHigh.LineStyle != 1 {
		t.Fatalf("swing lines should default to dotted: %+v", activeHigh)
	}
	if activeHigh.ExtendToVisibleRange == nil || !*activeHigh.ExtendToVisibleRange {
		t.Fatalf("active swing level should extend through the chart right offset: %+v", activeHigh)
	}
}

func TestIndicatorRuntimeHTTPContract(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))
	body, err := json.Marshal(IndicatorRuntimeRequest{
		IndicatorType: "SMA",
		IndicatorID:   "sma-http",
		Config:        runtimeConfig("sma-http", "SMA"),
		Candles:       sampleCandles(30),
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/indicator-runtime/compute", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatalf("compute route: %v", err)
	}
	if resp.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	var decoded IndicatorRuntimeResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if len(decoded.Errors) > 0 || decoded.Result.ID != "sma-http" || len(decoded.Result.Series) != 1 {
		t.Fatalf("unexpected response: %+v", decoded)
	}
}
