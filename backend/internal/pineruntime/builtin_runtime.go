package pineruntime

import (
	"context"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

type indicatorCalculator func(context.Context, runtimeIndicatorContext) (IndicatorResult, error)

type runtimeIndicatorContext struct {
	id          string
	config      map[string]any
	candles     []Candle
	inputValues map[string]InputValue
	styleValues map[string]InputValue
}

// The registry is the only dispatch table for backend-owned built-ins. New
// indicators plug into the same request/result contract by adding a calculator
// here; the browser never receives or executes a formula.
var indicatorCalculatorRegistry = map[string]indicatorCalculator{
	"SMA":      calculateSMA,
	"EMA":      calculateEMA,
	"VWAP":     calculateVWAP,
	"RSI":      calculateRSI,
	"MACD":     calculateMACD,
	"ADR":      calculateADR,
	"SWING_SR": calculateSwingSupportResistance,
}

func ComputeIndicatorRuntime(ctx context.Context, req IndicatorRuntimeRequest) IndicatorRuntimeResponse {
	typeName := strings.ToUpper(strings.TrimSpace(req.IndicatorType))
	id := strings.TrimSpace(req.IndicatorID)
	if id == "" {
		id = "builtin"
	}
	response := IndicatorRuntimeResponse{
		Result:   IndicatorResult{ID: id, Series: []IndicatorSeries{}},
		Errors:   []RuntimeError{},
		Warnings: []RuntimeError{},
	}
	calculator, ok := indicatorCalculatorRegistry[typeName]
	if !ok {
		response.Errors = append(response.Errors, RuntimeError{Message: fmt.Sprintf("unsupported built-in indicator %q", typeName)})
		return response
	}
	candles := normalizeRuntimeCandles(req.Candles)
	if len(candles) > maxCompileCandles {
		candles = candles[len(candles)-maxCompileCandles:]
		response.Warnings = append(response.Warnings, RuntimeError{Message: fmt.Sprintf("indicator input truncated to %d candles", maxCompileCandles)})
	}
	select {
	case <-ctx.Done():
		response.Errors = append(response.Errors, RuntimeError{Message: ctx.Err().Error()})
		return response
	default:
	}
	runtimeContext := runtimeIndicatorContext{
		id:          id,
		config:      req.Config,
		candles:     candles,
		inputValues: runtimeNestedValues(req.Config, "inputValues"),
		styleValues: runtimeNestedValues(req.Config, "styleValues"),
	}
	result, err := calculator(ctx, runtimeContext)
	if err != nil {
		response.Errors = append(response.Errors, RuntimeError{Message: err.Error()})
		return response
	}
	response.Result = result
	return response
}

func normalizeRuntimeCandles(candles []Candle) []Candle {
	byTime := make(map[int64]Candle, len(candles))
	for _, candle := range candles {
		if candle.Time <= 0 || !usable(candle.Open) || !usable(candle.High) || !usable(candle.Low) || !usable(candle.Close) || !usable(candle.Volume) {
			continue
		}
		byTime[candle.Time] = candle
	}
	times := make([]int64, 0, len(byTime))
	for timestamp := range byTime {
		times = append(times, timestamp)
	}
	sort.Slice(times, func(i, j int) bool { return times[i] < times[j] })
	out := make([]Candle, 0, len(times))
	for _, timestamp := range times {
		out = append(out, byTime[timestamp])
	}
	return out
}

func runtimeNumericValue(value any) (float64, bool) {
	var number float64
	switch typed := value.(type) {
	case float64:
		number = typed
	case float32:
		number = float64(typed)
	case int:
		number = float64(typed)
	case int8:
		number = float64(typed)
	case int16:
		number = float64(typed)
	case int32:
		number = float64(typed)
	case int64:
		number = float64(typed)
	case uint:
		number = float64(typed)
	case uint8:
		number = float64(typed)
	case uint16:
		number = float64(typed)
	case uint32:
		number = float64(typed)
	case uint64:
		number = float64(typed)
	case string:
		parsed, ok := parseNumberLiteral(strings.TrimSpace(typed))
		if !ok {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	return number, usable(number)
}

func runtimeNestedValues(config map[string]any, key string) map[string]InputValue {
	out := map[string]InputValue{}
	raw, ok := config[key]
	if !ok || raw == nil {
		return out
	}
	switch values := raw.(type) {
	case map[string]any:
		for field, value := range values {
			out[field] = value
		}
	case map[string]InputValue:
		for field, value := range values {
			out[field] = value
		}
	}
	return out
}

func runtimeNumber(config map[string]any, key string, fallback float64) float64 {
	value, exists := config[key]
	if !exists || value == nil {
		return fallback
	}
	number, ok := runtimeNumericValue(value)
	if !ok {
		return fallback
	}
	return number
}

func runtimeLength(config map[string]any, key string, fallback int) int {
	value := runtimeNumber(config, key, float64(fallback))
	return int(math.Max(1, math.Min(500, math.Round(value))))
}

func runtimeString(config map[string]any, key, fallback string) string {
	value, exists := config[key]
	if !exists || value == nil {
		return fallback
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" {
		return fallback
	}
	return text
}

func runtimeInputString(values map[string]InputValue, key, fallback string) string {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback
	}
	text := strings.ToLower(strings.TrimSpace(fmt.Sprint(value)))
	if text == "" {
		return fallback
	}
	return text
}

func runtimeStyleBool(values map[string]InputValue, key string, fallback bool) bool {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return strings.EqualFold(typed, "true")
	default:
		return fallback
	}
}

func applyRuntimeCommonStyle(series IndicatorSeries, values map[string]InputValue) IndicatorSeries {
	labelsVisible := runtimeStyleBool(values, "__output.labelsOnPriceScale", true)
	statusVisible := runtimeStyleBool(values, "__output.valuesInStatusLine", true)
	if series.LastValueVisible == nil || *series.LastValueVisible {
		series.LastValueVisible = boolPtr(labelsVisible)
	}
	if series.StatusLineVisible == nil || *series.StatusLineVisible {
		series.StatusLineVisible = boolPtr(statusVisible)
	}
	if raw, exists := values["__output.precision"]; exists && raw != nil && fmt.Sprint(raw) != "default" {
		number, valid := runtimeNumericValue(raw)
		precision := int(math.Round(number))
		if valid && precision >= 0 && precision <= 8 {
			series.Precision = &precision
		}
	}
	return series
}

func runtimeStyledSeries(
	runtime runtimeIndicatorContext,
	key string,
	series IndicatorSeries,
	fallbackColor string,
	fallbackWidth int,
	fallbackStyle int,
) (IndicatorSeries, bool) {
	if !styleVisible(runtime.styleValues, key) {
		return IndicatorSeries{}, false
	}
	series.Color = styleColorValue(runtime.styleValues, key, fallbackColor)
	width := styleLineWidthValue(runtime.styleValues, key, fallbackWidth)
	lineStyle := styleLineStyleValue(runtime.styleValues, key, fallbackStyle)
	series.LineWidth = &width
	series.LineStyle = &lineStyle
	return applyRuntimeCommonStyle(series, runtime.styleValues), true
}

func runtimePoints(values []float64, candles []Candle) []LinePoint {
	points := make([]LinePoint, 0, len(values))
	for index, value := range values {
		if index >= len(candles) || !usable(value) {
			continue
		}
		points = append(points, LinePoint{Time: candles[index].Time, Value: value})
	}
	return points
}

func calculateSMA(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	length := runtimeLength(runtime.config, "length", 50)
	values := make([]float64, len(runtime.candles))
	for index, candle := range runtime.candles {
		values[index] = candle.Close
	}
	series, visible := runtimeStyledSeries(runtime, "builtin:primary", IndicatorSeries{
		Key: "sma", Type: "line", Data: runtimePoints(rollingAverage(values, length), runtime.candles),
	}, runtimeString(runtime.config, "color", "#2962ff"), 2, 0)
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	if visible {
		result.Series = append(result.Series, series)
	}
	return result, nil
}

func calculateEMA(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	length := runtimeLength(runtime.config, "length", 21)
	values := make([]float64, len(runtime.candles))
	for index, candle := range runtime.candles {
		values[index] = candle.Close
	}
	series, visible := runtimeStyledSeries(runtime, "builtin:primary", IndicatorSeries{
		Key: "ema", Type: "line", Data: runtimePoints(exponentialAverage(values, length), runtime.candles),
	}, runtimeString(runtime.config, "color", "#ff6d00"), 2, 0)
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	if visible {
		result.Series = append(result.Series, series)
	}
	return result, nil
}

func calculateVWAP(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	values := make([]float64, len(runtime.candles))
	day := ""
	cumulativePriceVolume := float64(0)
	cumulativeVolume := float64(0)
	for index, candle := range runtime.candles {
		key := time.Unix(candle.Time, 0).UTC().Format("2006-01-02")
		if key != day {
			day = key
			cumulativePriceVolume = 0
			cumulativeVolume = 0
		}
		typical := (candle.High + candle.Low + candle.Close) / 3
		cumulativePriceVolume += typical * candle.Volume
		cumulativeVolume += candle.Volume
		if cumulativeVolume == 0 {
			values[index] = candle.Close
		} else {
			values[index] = cumulativePriceVolume / cumulativeVolume
		}
	}
	series, visible := runtimeStyledSeries(runtime, "builtin:primary", IndicatorSeries{
		Key: "vwap", Type: "line", Data: runtimePoints(values, runtime.candles),
	}, runtimeString(runtime.config, "color", "#ab47bc"), 2, 0)
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	if visible {
		result.Series = append(result.Series, series)
	}
	return result, nil
}

func calculateRSI(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	length := runtimeLength(runtime.config, "length", 14)
	values := make([]float64, len(runtime.candles))
	for index, candle := range runtime.candles {
		values[index] = candle.Close
	}
	series, visible := runtimeStyledSeries(runtime, "builtin:primary", IndicatorSeries{
		Key: "rsi", Type: "line", Data: runtimePoints(rsiSeries(values, length), runtime.candles),
	}, runtimeString(runtime.config, "color", "#26a69a"), 2, 0)
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	if visible {
		result.Series = append(result.Series, series)
	}
	return result, nil
}

func emaAll(values []float64, length int) []float64 {
	out := make([]float64, len(values))
	if len(values) == 0 {
		return out
	}
	k := 2 / float64(length+1)
	previous := values[0]
	for index, value := range values {
		if index == 0 {
			previous = value
		} else {
			previous = value*k + previous*(1-k)
		}
		out[index] = previous
	}
	return out
}

func calculateMACD(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	fastLength := runtimeLength(runtime.config, "length", 12)
	signalLength := runtimeLength(runtime.config, "length2", 9)
	slowLength := runtimeLength(runtime.config, "length3", 26)
	closes := make([]float64, len(runtime.candles))
	for index, candle := range runtime.candles {
		closes[index] = candle.Close
	}
	fast := emaAll(closes, fastLength)
	slow := emaAll(closes, slowLength)
	macd := make([]float64, len(closes))
	for index := range macd {
		macd[index] = fast[index] - slow[index]
	}
	signal := emaAll(macd, signalLength)
	histogram := make([]float64, len(macd))
	for index := range histogram {
		histogram[index] = macd[index] - signal[index]
	}
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	if series, visible := runtimeStyledSeries(runtime, "builtin:primary", IndicatorSeries{
		Key: "macd", Type: "line", Data: runtimePoints(macd, runtime.candles),
	}, runtimeString(runtime.config, "color", "#2962ff"), 2, 0); visible {
		result.Series = append(result.Series, series)
	}
	if series, visible := runtimeStyledSeries(runtime, "builtin:secondary", IndicatorSeries{
		Key: "signal", Type: "line", Data: runtimePoints(signal, runtime.candles),
	}, runtimeString(runtime.config, "color2", "#ff9800"), 2, 0); visible {
		result.Series = append(result.Series, series)
	}
	histogramSeries := applyRuntimeCommonStyle(IndicatorSeries{
		Key: "hist", Type: "histogram", Color: "#787b86", Data: runtimePoints(histogram, runtime.candles),
	}, runtime.styleValues)
	result.Series = append(result.Series, histogramSeries)
	return result, nil
}

type runtimeDay struct {
	high float64
	low  float64
}

func calculateADR(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	length := runtimeLength(runtime.config, "length", 14)
	days := []runtimeDay{}
	dayIndex := map[string]int{}
	for _, candle := range runtime.candles {
		key := time.Unix(candle.Time, 0).UTC().Format("2006-01-02")
		index, exists := dayIndex[key]
		if !exists {
			dayIndex[key] = len(days)
			days = append(days, runtimeDay{high: candle.High, low: candle.Low})
			continue
		}
		days[index].high = math.Max(days[index].high, candle.High)
		days[index].low = math.Min(days[index].low, candle.Low)
	}
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	if len(days) < 2 || len(runtime.candles) < 2 {
		return result, nil
	}
	start := len(days) - length - 1
	if start < 0 {
		start = 0
	}
	completed := days[start : len(days)-1]
	if len(completed) == 0 {
		return result, nil
	}
	adr := float64(0)
	for _, day := range completed {
		adr += day.high - day.low
	}
	adr /= float64(len(completed))
	today := days[len(days)-1]
	mid := (today.high + today.low) / 2
	high, low := mid+adr/2, mid-adr/2
	if !usable(high) || high <= 0 {
		return result, nil
	}
	points := func(value float64) []LinePoint {
		return []LinePoint{
			{Time: runtime.candles[0].Time, Value: value},
			{Time: runtime.candles[len(runtime.candles)-1].Time, Value: value},
		}
	}
	if series, visible := runtimeStyledSeries(runtime, "builtin:primary", IndicatorSeries{
		Key: "adr-high", Type: "line", Data: points(high),
	}, runtimeString(runtime.config, "color", "#26a69a"), 2, 0); visible {
		result.Series = append(result.Series, series)
	}
	if series, visible := runtimeStyledSeries(runtime, "builtin:secondary", IndicatorSeries{
		Key: "adr-low", Type: "line", Data: points(low),
	}, runtimeString(runtime.config, "color2", "#ef5350"), 2, 0); visible {
		result.Series = append(result.Series, series)
	}
	return result, nil
}

func runtimeSwingSource(candles []Candle, source string) ([]float64, error) {
	values := make([]float64, len(candles))
	for index, candle := range candles {
		switch source {
		case "open":
			values[index] = candle.Open
		case "high":
			values[index] = candle.High
		case "low":
			values[index] = candle.Low
		case "close":
			values[index] = candle.Close
		case "hl2":
			values[index] = (candle.High + candle.Low) / 2
		case "hlc3":
			values[index] = (candle.High + candle.Low + candle.Close) / 3
		case "ohlc4":
			values[index] = (candle.Open + candle.High + candle.Low + candle.Close) / 4
		case "hlcc4":
			values[index] = (candle.High + candle.Low + candle.Close*2) / 4
		default:
			return nil, fmt.Errorf("unsupported swing source %q", source)
		}
	}
	return values, nil
}

func runtimeSwingSeries(
	runtime runtimeIndicatorContext,
	pivots []runtimePivot,
	keyPrefix string,
	styleKey string,
	fallbackColor string,
) []IndicatorSeries {
	if !styleVisible(runtime.styleValues, styleKey) {
		return []IndicatorSeries{}
	}
	out := make([]IndicatorSeries, 0, len(pivots))
	for index, pivot := range pivots {
		end := len(runtime.candles) - 1
		if index+1 < len(pivots) {
			end = pivots[index+1].index - 1
		}
		if end < pivot.index {
			continue
		}
		points := make([]LinePoint, 0, end-pivot.index+1)
		for candleIndex := pivot.index; candleIndex <= end; candleIndex++ {
			points = append(points, LinePoint{Time: runtime.candles[candleIndex].Time, Value: pivot.value})
		}
		last := index == len(pivots)-1
		series, visible := runtimeStyledSeries(runtime, styleKey, IndicatorSeries{
			Key:                  fmt.Sprintf("%s:%d", keyPrefix, pivot.index),
			Type:                 "line",
			Data:                 points,
			LastValueVisible:     boolPtr(last),
			StatusLineVisible:    boolPtr(last),
			ExtendToVisibleRange: boolPtr(last),
		}, fallbackColor, 2, 1)
		if visible {
			out = append(out, series)
		}
	}
	return out
}

func calculateSwingSupportResistance(_ context.Context, runtime runtimeIndicatorContext) (IndicatorResult, error) {
	highLength := runtimeLength(runtime.config, "length", 25)
	lowLength := runtimeLength(runtime.config, "length2", highLength)
	highSource := runtimeInputString(runtime.inputValues, "highSource", "high")
	lowSource := runtimeInputString(runtime.inputValues, "lowSource", "low")
	highValues, err := runtimeSwingSource(runtime.candles, highSource)
	if err != nil {
		return IndicatorResult{}, err
	}
	lowValues, err := runtimeSwingSource(runtime.candles, lowSource)
	if err != nil {
		return IndicatorResult{}, err
	}
	highPivots := detectRuntimePivots(highValues, highLength, highLength, "high")
	lowPivots := detectRuntimePivots(lowValues, lowLength, lowLength, "low")
	result := IndicatorResult{ID: runtime.id, Series: []IndicatorSeries{}}
	result.Series = append(result.Series, runtimeSwingSeries(
		runtime,
		highPivots,
		"swing-high",
		"builtin:primary",
		runtimeString(runtime.config, "color", "#ef5350"),
	)...)
	result.Series = append(result.Series, runtimeSwingSeries(
		runtime,
		lowPivots,
		"swing-low",
		"builtin:secondary",
		runtimeString(runtime.config, "color2", "#26c6da"),
	)...)
	return result, nil
}
