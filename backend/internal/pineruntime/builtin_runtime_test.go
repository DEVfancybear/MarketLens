package pineruntime

import (
	"bytes"
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
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
	if len(candles) != 2 || candles[0].Time != 2 || candles[1].Time != 3 || candles[1].Close != 4 {
		t.Fatalf("normalized candles = %+v", candles)
	}
}

func TestRuntimePivotsRejectEqualPlateaus(t *testing.T) {
	if pivots := detectRuntimePivots([]float64{1, 3, 3, 1}, 1, 1, "high"); len(pivots) != 0 {
		t.Fatalf("equal high plateau must not be a pivot: %+v", pivots)
	}
	if pivots := detectRuntimePivots([]float64{3, 1, 1, 3}, 1, 1, "low"); len(pivots) != 0 {
		t.Fatalf("equal low plateau must not be a pivot: %+v", pivots)
	}
}

func runtimeConfig(id, indicatorType string) map[string]any {
	return map[string]any{
		"id": id, "type": indicatorType,
		"length": 3, "length2": 2, "length3": 5,
		"color": "#2962ff", "color2": "#ff9800",
		"inputValues": map[string]any{"highSource": "high", "lowSource": "low"},
	}
}

func fvgFixtureCandles() []Candle {
	return []Candle{
		{Time: 60, Open: 10, High: 11, Low: 9, Close: 10, Volume: 1},
		{Time: 120, Open: 11, High: 12, Low: 10, Close: 11.5, Volume: 1},
		{Time: 180, Open: 13, High: 14, Low: 12, Close: 13, Volume: 1},
		{Time: 240, Open: 13, High: 15, Low: 12.5, Close: 14, Volume: 1},
	}
}

func computeBuiltInForTest(t *testing.T, indicatorType string, candles []Candle, config map[string]any) IndicatorRuntimeResponse {
	t.Helper()
	response := ComputeIndicatorRuntime(context.Background(), IndicatorRuntimeRequest{
		IndicatorType: indicatorType,
		IndicatorID:   "runtime-" + indicatorType,
		Timeframe:     "1m",
		Config:        config,
		Candles:       candles,
	})
	if len(response.Errors) > 0 {
		t.Fatalf("%s runtime errors: %+v", indicatorType, response.Errors)
	}
	return response
}

func TestEveryCurrentBuiltInIsPineSourceCompiledByCommonRuntime(t *testing.T) {
	candles := sampleIntradayCandles(18)
	for _, indicatorType := range []string{"SMA", "EMA", "VWAP", "RSI", "MACD", "ADR", "SWING_SR", "FVG"} {
		t.Run(indicatorType, func(t *testing.T) {
			input := candles
			config := runtimeConfig("runtime-"+indicatorType, indicatorType)
			if indicatorType == "FVG" {
				input = fvgFixtureCandles()
				config["inputValues"] = map[string]any{"timeframe": ""}
			}
			response := computeBuiltInForTest(t, indicatorType, input, config)
			if response.Result.ID != "runtime-"+indicatorType || len(response.Result.Series) == 0 {
				t.Fatalf("%s result = %+v", indicatorType, response.Result)
			}
			source, ok, err := builtInPineSource(indicatorType)
			if err != nil || !ok || !strings.Contains(source, "indicator(") {
				t.Fatalf("%s is not source-backed: ok=%v err=%v", indicatorType, ok, err)
			}
		})
	}
}

func TestFVGSourceUsesMiddleCloseThresholdAndSourceGeometry(t *testing.T) {
	candles := fvgFixtureCandles()[:3]
	config := runtimeConfig("fvg", "FVG")
	config["color"] = "#089981"
	config["color2"] = "#f23645"
	config["inputValues"] = map[string]any{"thresholdPer": 0, "auto": false, "extend": 20, "timeframe": ""}
	response := computeBuiltInForTest(t, "FVG", candles, config)
	if len(response.Result.Series) != 1 {
		t.Fatalf("fixed FVG series = %+v", response.Result.Series)
	}
	zone := response.Result.Series[0]
	if zone.Type != "baselineFill" || zone.BaseValue == nil || *zone.BaseValue != 11 || len(zone.Data) != 2 {
		t.Fatalf("bull FVG geometry = %+v", zone)
	}
	if zone.Data[0].Value != 12 || zone.Data[0].Time != 60 || zone.Data[1].Time <= 240 {
		t.Fatalf("bull FVG anchors = %+v", zone.Data)
	}

	rejected := runtimeConfig("fvg-threshold", "FVG")
	rejected["inputValues"] = map[string]any{"thresholdPer": 20, "timeframe": ""}
	if got := computeBuiltInForTest(t, "FVG", candles, rejected); len(got.Result.Series) != 0 {
		t.Fatalf("20%% threshold should reject fixture gap: %+v", got.Result.Series)
	}
	candles = fvgFixtureCandles()[:3]
	candles[1].Close = candles[0].High
	if got := computeBuiltInForTest(t, "FVG", candles, runtimeConfig("fvg-close", "FVG")); len(got.Result.Series) != 0 {
		t.Fatalf("middle close at high[2] should reject fixture gap: %+v", got.Result.Series)
	}
}

func TestFVGUserCopyAndCatalogEntryUseSameCompilerResult(t *testing.T) {
	candles := fvgFixtureCandles()[:3]
	config := runtimeConfig("catalog-fvg", "FVG")
	config["color"] = "#089981"
	config["color2"] = "#f23645"
	config["inputValues"] = map[string]any{"timeframe": "", "auto": false, "extend": 20}
	builtInRequest, err := builtInCompileRequest(IndicatorRuntimeRequest{
		IndicatorType: "FVG", IndicatorID: "catalog-fvg", Config: config, Candles: candles, Timeframe: "1m",
	})
	if err != nil {
		t.Fatal(err)
	}
	builtIn := Compile(context.Background(), builtInRequest)
	userRequest := builtInRequest
	userRequest.ScriptID = "another-user-saved-copy"
	userCopy := Compile(context.Background(), userRequest)
	if len(builtIn.Errors) != 0 || len(userCopy.Errors) != 0 {
		t.Fatalf("built-in errors=%+v user errors=%+v", builtIn.Errors, userCopy.Errors)
	}
	if len(builtIn.Result.Series) != len(userCopy.Result.Series) || len(userCopy.Result.Series) != 1 {
		t.Fatalf("built-in=%+v user=%+v", builtIn.Result.Series, userCopy.Result.Series)
	}
	left, right := builtIn.Result.Series[0], userCopy.Result.Series[0]
	if left.Type != right.Type || left.Color != right.Color || *left.BaseValue != *right.BaseValue || len(left.Data) != len(right.Data) {
		t.Fatalf("common compiler diverged: built-in=%+v user=%+v", left, right)
	}
}

func TestFVGDynamicModeAndDashboardComeFromPineObjects(t *testing.T) {
	config := runtimeConfig("fvg-dynamic", "FVG")
	config["inputValues"] = map[string]any{
		"dynamic": true, "showDash": true, "dashLoc": "Bottom Left", "textSize": "Normal", "timeframe": "",
	}
	response := computeBuiltInForTest(t, "FVG", fvgFixtureCandles(), config)
	if len(response.Result.Series) == 0 || response.Result.Series[0].Type != "baselineFill" {
		t.Fatalf("dynamic fills = %+v", response.Result.Series)
	}
	if response.Result.Dashboard == nil || response.Result.Dashboard.Position != "Bottom Left" || response.Result.Dashboard.TextSize != "Normal" {
		t.Fatalf("dashboard = %+v", response.Result.Dashboard)
	}
}

func TestRunOrderedJobsKeepsDeclarationOrder(t *testing.T) {
	jobs := []orderedJob[int]{
		func(context.Context) (int, error) { return 3, nil },
		func(context.Context) (int, error) { return 1, nil },
		func(context.Context) (int, error) { return 2, nil },
	}
	results, err := runOrderedJobs(context.Background(), jobs, 3)
	if err != nil || len(results) != 3 || results[0] != 3 || results[1] != 1 || results[2] != 2 {
		t.Fatalf("ordered results = %+v, err=%v", results, err)
	}
}

func TestTimeframeSecondsDistinguishesMinutesFromMonths(t *testing.T) {
	for _, test := range []struct {
		input string
		want  int64
	}{
		{input: "15", want: 15 * 60},
		{input: "15m", want: 15 * 60},
		{input: "1M", want: 30 * 86400},
		{input: "D", want: 86400},
	} {
		got, ok := timeframeSeconds(test.input)
		if !ok || got != test.want {
			t.Fatalf("timeframeSeconds(%q) = (%d, %v), want %d", test.input, got, ok, test.want)
		}
	}
}

func TestIndicatorRuntimeSwingProducesConfirmedHorizontalSegments(t *testing.T) {
	highs := []float64{1, 2, 5, 3, 2, 4, 6, 3, 2}
	lows := []float64{0, -1, -3, -1, 0, -2, -1, -1, 0}
	candles := make([]Candle, len(highs))
	for index := range candles {
		candles[index] = Candle{Time: int64(index + 1), Open: (highs[index] + lows[index]) / 2, High: highs[index], Low: lows[index], Close: (highs[index] + lows[index]) / 2, Volume: 1}
	}
	config := runtimeConfig("swing", "SWING_SR")
	config["length"], config["length2"] = 2, 2
	config["color"], config["color2"] = "#ef5350", "#26c6da"
	response := computeBuiltInForTest(t, "SWING_SR", candles, config)
	if len(response.Result.Series) != 4 {
		t.Fatalf("expected two high and two low segments, got %+v", response.Result.Series)
	}
	highSegments := []IndicatorSeries{}
	for _, series := range response.Result.Series {
		if series.Color == "#ef5350" {
			highSegments = append(highSegments, series)
		}
	}
	if len(highSegments) != 2 {
		t.Fatalf("high segments = %+v", highSegments)
	}
	for _, series := range highSegments {
		if len(series.Data) != 2 || series.Data[0].Value != series.Data[1].Value || series.LineStyle == nil || *series.LineStyle != 1 {
			t.Fatalf("non-horizontal compiled swing line = %+v", series)
		}
	}
}

func TestIndicatorRuntimeHTTPContract(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))
	body, err := json.Marshal(IndicatorRuntimeRequest{
		IndicatorType: "SMA", IndicatorID: "sma-http", Config: runtimeConfig("sma-http", "SMA"), Candles: sampleCandles(20),
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/v1/indicator-runtime/compute", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var decoded IndicatorRuntimeResponse
	if err := json.NewDecoder(response.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Result.ID != "sma-http" || len(decoded.Result.Series) != 1 || decoded.Result.Series[0].Key != "sma" {
		t.Fatalf("response = %+v", decoded)
	}
}
