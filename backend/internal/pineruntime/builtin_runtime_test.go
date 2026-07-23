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

	"github.com/gofiber/fiber/v3"
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
	for _, indicatorType := range builtInPineOrder {
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

func TestEveryCurrentBuiltInCompilesFromPineSourceDefaults(t *testing.T) {
	candles := sampleIntradayCandles(18)
	for _, indicatorType := range builtInPineOrder {
		t.Run(indicatorType, func(t *testing.T) {
			input := candles
			if indicatorType == "FVG" {
				input = fvgFixtureCandles()
			}
			response := computeBuiltInForTest(t, indicatorType, input, map[string]any{})
			if len(response.Result.Series) == 0 {
				t.Fatalf("%s source defaults produced no chart series: %+v", indicatorType, response.Result)
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

func TestIndicatorRuntimeReplayCutoffHidesFutureFVGAndClipsActiveZone(t *testing.T) {
	candles := fvgFixtureCandles()
	cutoff := int64(120)
	request := IndicatorRuntimeRequest{
		IndicatorType: "FVG",
		IndicatorID:   "replay-fvg",
		Timeframe:     "1m",
		Config:        runtimeConfig("replay-fvg", "FVG"),
		Candles:       candles,
		ReplayCutoff:  &cutoff,
	}
	request.Config["inputValues"] = map[string]any{"thresholdPer": 0, "auto": false, "extend": 20, "timeframe": ""}
	response := ComputeIndicatorRuntime(context.Background(), request)
	if len(response.Errors) != 0 {
		t.Fatalf("future FVG runtime errors: %+v", response.Errors)
	}
	if len(response.Result.Series) != 0 {
		t.Fatalf("FVG formed after replay cutoff must be hidden: %+v", response.Result.Series)
	}

	cutoff = 180
	response = ComputeIndicatorRuntime(context.Background(), request)
	if len(response.Errors) != 0 || len(response.Result.Series) != 1 {
		t.Fatalf("active FVG response = %+v errors=%+v", response.Result, response.Errors)
	}
	zone := response.Result.Series[0]
	if len(zone.Data) < 2 || zone.Data[len(zone.Data)-1].Time != cutoff {
		t.Fatalf("active FVG right edge was not clamped: %+v", zone.Data)
	}
	for _, point := range zone.Data {
		if point.Time > cutoff {
			t.Fatalf("clipped FVG contains future point: %+v", zone.Data)
		}
	}
	if zone.ExtendToVisibleRange == nil || *zone.ExtendToVisibleRange {
		t.Fatalf("replay FVG must not extend through the visible viewport: %+v", zone.ExtendToVisibleRange)
	}
}

func TestIndicatorRuntimeReplayCutoffAppliesToSavedSource(t *testing.T) {
	source, found, err := builtInPineSource("FVG")
	if err != nil || !found {
		t.Fatalf("load FVG source: found=%v err=%v", found, err)
	}
	candles := fvgFixtureCandles()
	cutoff := int64(180)
	config := runtimeConfig("saved-replay-fvg", "saved:FVG")
	config["inputValues"] = map[string]any{"thresholdPer": 0, "auto": false, "extend": 20, "timeframe": ""}
	response := ComputeIndicatorRuntime(context.Background(), IndicatorRuntimeRequest{
		IndicatorType: "saved:FVG",
		IndicatorID:   "saved-replay-fvg",
		SourceCode:    source,
		Timeframe:     "1m",
		Config:        config,
		Candles:       candles,
		ReplayCutoff:  &cutoff,
	})
	if len(response.Errors) != 0 || len(response.Result.Series) != 1 {
		t.Fatalf("saved source replay response = %+v errors=%+v", response.Result, response.Errors)
	}
	for _, point := range response.Result.Series[0].Data {
		if point.Time > cutoff {
			t.Fatalf("saved source emitted future point: %+v", response.Result.Series[0].Data)
		}
	}
}

func TestIndicatorRuntimeReplayCutoffRejectsInvalidBoundary(t *testing.T) {
	for _, cutoff := range []int64{0, maxReplayCutoff + 1} {
		response := ComputeIndicatorRuntime(context.Background(), IndicatorRuntimeRequest{
			IndicatorType: "SMA",
			Candles:       sampleCandles(4),
			ReplayCutoff:  &cutoff,
		})
		if len(response.Errors) != 1 || !strings.Contains(response.Errors[0].Message, "replayCutoff") {
			t.Fatalf("invalid replay cutoff %d response = %+v", cutoff, response)
		}
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

func TestSavedUserSourceUsesIndicatorRuntimeComputePath(t *testing.T) {
	source := `//@version=5
indicator("Saved EMA", overlay=true)
period = input.int(3, "Period")
plot(ta.ema(close, period), "saved-ema", color=#00ff00)`
	response := ComputeIndicatorRuntime(context.Background(), IndicatorRuntimeRequest{
		IndicatorType: "saved:user-1",
		IndicatorID:   "chart-instance",
		SourceCode:    source,
		Config:        map[string]any{"inputValues": map[string]any{"period": 2}},
		Candles:       sampleCandles(8),
	})
	if len(response.Errors) != 0 || response.Result.ID != "chart-instance" || len(response.Result.Series) != 1 {
		t.Fatalf("common user runtime response = %+v", response)
	}
	if response.Result.Series[0].Key != "saved-ema" {
		t.Fatalf("series = %+v", response.Result.Series[0])
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

func TestIndicatorRuntimeHTTPReplayCutoffFiltersFutureCandles(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))
	candles := sampleCandles(4)
	cutoff := candles[1].Time
	body, err := json.Marshal(IndicatorRuntimeRequest{
		IndicatorType: "saved:close",
		IndicatorID:   "saved-close-replay",
		SourceCode: `//@version=5
indicator("Saved close", overlay=true)
plot(close, "close")`,
		Candles:      candles,
		ReplayCutoff: &cutoff,
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
	if len(decoded.Errors) != 0 || len(decoded.Result.Series) != 1 {
		t.Fatalf("response = %+v", decoded)
	}
	data := decoded.Result.Series[0].Data
	if len(data) != 2 || data[len(data)-1].Time != cutoff {
		t.Fatalf("HTTP runtime did not stop at replay cutoff: %+v", data)
	}
	for _, point := range data {
		if point.Time > cutoff {
			t.Fatalf("HTTP runtime leaked future candle: %+v", data)
		}
	}
}

func TestIndicatorRuntimeCatalogAndDefinitionHTTPContracts(t *testing.T) {
	app := fiber.New()
	NewHandler().Register(app.Group("/api/v1"))

	catalogRequest := httptest.NewRequest(http.MethodGet, "/api/v1/indicator-runtime/catalog", nil)
	catalogResponse, err := app.Test(catalogRequest)
	if err != nil {
		t.Fatal(err)
	}
	if catalogResponse.StatusCode != fiber.StatusOK {
		t.Fatalf("catalog status = %d", catalogResponse.StatusCode)
	}
	var catalog IndicatorCatalogResponse
	if err := json.NewDecoder(catalogResponse.Body).Decode(&catalog); err != nil {
		t.Fatal(err)
	}
	if len(catalog.Indicators) != len(builtInPineOrder) || catalog.Indicators[0].Type != builtInPineOrder[0] {
		t.Fatalf("catalog = %+v", catalog)
	}

	body, err := json.Marshal(IndicatorDefinitionRequest{
		IndicatorType: "CUSTOM",
		SourceCode: `//@version=5
indicator("HTTP user", overlay=false)
plot(close, "close")`,
	})
	if err != nil {
		t.Fatal(err)
	}
	definitionRequest := httptest.NewRequest(http.MethodPost, "/api/v1/indicator-runtime/definition", bytes.NewReader(body))
	definitionRequest.Header.Set("Content-Type", "application/json")
	definitionResponse, err := app.Test(definitionRequest)
	if err != nil {
		t.Fatal(err)
	}
	var decoded IndicatorDefinitionResponse
	if err := json.NewDecoder(definitionResponse.Body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	if definitionResponse.StatusCode != fiber.StatusOK || decoded.Definition.Name != "HTTP user" || decoded.Definition.Overlay {
		t.Fatalf("definition status=%d body=%+v", definitionResponse.StatusCode, decoded)
	}
}
