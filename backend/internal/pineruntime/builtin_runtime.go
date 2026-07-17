package pineruntime

import (
	"context"
	"sort"
	"strings"
)

// ComputeIndicatorRuntime keeps the built-in HTTP contract while deliberately
// delegating every catalog entry to Compile. There is no indicatorType formula
// dispatch here: built-ins differ from saved scripts only by where their Pine
// source and default properties come from.
func ComputeIndicatorRuntime(ctx context.Context, req IndicatorRuntimeRequest) IndicatorRuntimeResponse {
	id := runtimeResultID(req.IndicatorID, "builtin")
	response := IndicatorRuntimeResponse{
		Result:   IndicatorResult{ID: id, Series: []IndicatorSeries{}},
		Errors:   []RuntimeError{},
		Warnings: []RuntimeError{},
	}
	compileRequest, err := builtInCompileRequest(req)
	if err != nil {
		response.Errors = append(response.Errors, RuntimeError{Message: err.Error()})
		return response
	}
	compiled := Compile(ctx, compileRequest)
	response.Result = compiled.Result
	response.Result.ID = id
	response.Errors = compiled.Errors
	response.Warnings = compiled.Warnings
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
