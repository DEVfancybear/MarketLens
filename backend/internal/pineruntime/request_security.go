package pineruntime

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// evaluateRequestSecurityExpression handles request.security() before the normal
// expression parser evaluates call arguments. Pine's third argument is not an
// already-computed value; it is source code that must run in the requested
// timeframe context, then be mapped back onto the chart's candle timeline.
func evaluateRequestSecurityExpression(expression string, context *evalContext) (pineValue, bool, error) {
	trimmed := strings.TrimSpace(expression)
	bodies := findCallBodies(trimmed, "request.security")
	if len(bodies) == 0 || trimmed != "request.security("+bodies[0]+")" {
		return pineValue{}, false, nil
	}
	args := parseCallArguments(bodies[0])
	timeframeExpression := rawArg(args, "timeframe", 1)
	requestedExpression := rawArg(args, "expression", 2)
	if rawArg(args, "symbol", 0) == "" || timeframeExpression == "" || requestedExpression == "" {
		return pineValue{}, true, fmt.Errorf("request.security() expects symbol, timeframe, and expression")
	}
	timeframeArg := strings.TrimSpace(timeframeExpression)
	requestedTimeframe, ok := unquote(timeframeArg)
	if !ok {
		requestedTimeframe = timeframeArg
	}
	higherTimeframeCandles, originalToBucket, err := aggregateCandlesForTimeframe(context.candles, requestedTimeframe)
	if err != nil {
		return pineValue{}, true, err
	}
	if len(higherTimeframeCandles) == 0 {
		return seriesValue(fillNaN(len(context.candles))), true, nil
	}

	securityContext := &evalContext{
		candles:        higherTimeframeCandles,
		variables:      map[string]pineValue{},
		functions:      context.functions,
		inputOverrides: context.inputOverrides,
	}
	assignedNames := make(map[string]struct{}, len(context.assignments))
	for _, assignment := range context.assignments {
		assignedNames[assignment.name] = struct{}{}
	}
	for key, value := range context.variables {
		if _, assigned := assignedNames[key]; !assigned && value.kind != kindSeries && value.kind != kindColorSeries {
			securityContext.variables[key] = value
		}
	}
	for _, assignment := range context.assignments {
		value, err := evaluateAssignmentValue(assignment.name, assignment.expression, securityContext)
		if err != nil {
			return pineValue{}, true, fmt.Errorf("request.security dependency %s: %w", assignment.name, err)
		}
		securityContext.variables[assignment.name] = value
		securityContext.assignments = append(securityContext.assignments, assignment)
	}
	requestedValue, err := evaluateExpression(requestedExpression, securityContext)
	if err != nil {
		return pineValue{}, true, err
	}
	if fallback, ok, err := evaluateSecurityWarmupExpression(requestedExpression, securityContext); err != nil {
		return pineValue{}, true, err
	} else if ok {
		requestedValue = fillMissingSecurityValue(requestedValue, fallback, len(higherTimeframeCandles))
	}
	return expandSecurityValue(requestedValue, originalToBucket, len(context.candles), len(higherTimeframeCandles)), true, nil
}

// evaluateSecurityWarmupExpression covers the common Pine pattern used by ADR
// scripts:
//
//	request.security(..., "D", ta.sma(high - low, length)[1])
//
// TradingView usually has enough daily history loaded before the visible chart
// starts, so the shifted SMA is already warmed up. Our runtime compiles against
// the candles sent by the frontend. On small chart windows, that daily context
// can be shorter than the SMA length and the strict SMA would stay `na`, which
// hides every downstream object. For this specific higher-timeframe bootstrap we
// compute the same lagged average with the completed daily buckets available in
// the request, then use it only to fill missing strict-SMA values.
func evaluateSecurityWarmupExpression(expression string, context *evalContext) (pineValue, bool, error) {
	baseExpression, offset, ok := trailingHistoryReference(expression)
	if !ok || offset != 1 {
		return pineValue{}, false, nil
	}
	body, ok := exactCallBody(baseExpression, "ta.sma")
	if !ok {
		body, ok = exactCallBody(baseExpression, "sma")
	}
	if !ok {
		return pineValue{}, false, nil
	}

	args := parseCallArguments(body)
	sourceExpression := rawArg(args, "source", 0)
	lengthExpression := rawArg(args, "length", 1)
	if sourceExpression == "" || lengthExpression == "" {
		return pineValue{}, false, nil
	}

	sourceValue, err := evaluateExpression(sourceExpression, context)
	if err != nil {
		return pineValue{}, true, err
	}
	lengthValue, err := evaluateExpression(lengthExpression, context)
	if err != nil {
		return pineValue{}, true, err
	}

	values := toSeries(sourceValue, len(context.candles))
	length := period(lengthValue)
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
		start := i - length
		if start < 0 {
			start = 0
		}
		if start >= i {
			continue
		}
		sum := float64(0)
		count := 0
		for j := start; j < i; j++ {
			if usable(values[j]) {
				sum += values[j]
				count++
			}
		}
		if count > 0 {
			out[i] = sum / float64(count)
		}
	}
	return seriesValue(out), true, nil
}

func trailingHistoryReference(expression string) (string, int, bool) {
	trimmed := strings.TrimSpace(expression)
	if !strings.HasSuffix(trimmed, "]") {
		return "", 0, false
	}
	open := strings.LastIndex(trimmed, "[")
	if open < 0 {
		return "", 0, false
	}
	rawOffset := strings.TrimSpace(trimmed[open+1 : len(trimmed)-1])
	offsetValue, ok := parseNumberLiteral(rawOffset)
	if !ok {
		return "", 0, false
	}
	return strings.TrimSpace(trimmed[:open]), int(math.Max(0, math.Round(offsetValue))), true
}

func exactCallBody(expression string, name string) (string, bool) {
	trimmed := strings.TrimSpace(expression)
	bodies := findCallBodies(trimmed, name)
	if len(bodies) == 0 || trimmed != name+"("+bodies[0]+")" {
		return "", false
	}
	return bodies[0], true
}

func fillMissingSecurityValue(primary pineValue, fallback pineValue, length int) pineValue {
	if primary.kind != kindNumber && primary.kind != kindSeries {
		return primary
	}
	values := toSeries(primary, length)
	fallbackValues := toSeries(fallback, length)
	out := make([]float64, length)
	for i := range out {
		point := getAt(seriesValue(values), i, length)
		if !usable(point) && i < len(fallbackValues) {
			point = fallbackValues[i]
		}
		out[i] = point
	}
	return seriesValue(out)
}

func aggregateCandlesForTimeframe(candles []Candle, timeframeName string) ([]Candle, []int, error) {
	if len(candles) == 0 {
		return nil, nil, nil
	}
	seconds, valid := timeframeSeconds(timeframeName)
	if !valid {
		return nil, nil, fmt.Errorf("unsupported request.security() timeframe %q", timeframeName)
	}
	chartSeconds := statefulCandleInterval(candles)
	if seconds == 0 || seconds == chartSeconds {
		return candles, sequenceBuckets(len(candles)), nil
	}
	if seconds < chartSeconds {
		return nil, nil, fmt.Errorf("lower-timeframe request.security() is unsupported")
	}
	buckets, err := aggregateRuntimeCandles(candles, seconds)
	if err != nil {
		return nil, nil, err
	}
	bucketIndex := make(map[int64]int, len(buckets))
	for index, candle := range buckets {
		bucketIndex[candle.Time] = index
	}
	originalToBucket := make([]int, len(candles))
	for index, candle := range candles {
		bucketTime := candle.Time - candle.Time%seconds
		mapped, exists := bucketIndex[bucketTime]
		if !exists {
			return nil, nil, fmt.Errorf("request.security() timeframe mapping failed")
		}
		originalToBucket[index] = mapped
	}
	return buckets, originalToBucket, nil
}

func expandSecurityValue(value pineValue, originalToBucket []int, originalLength int, bucketLength int) pineValue {
	if value.kind == kindColor || value.kind == kindColorSeries {
		colors := toColorSeries(value, bucketLength)
		out := make([]string, originalLength)
		for i, bucket := range originalToBucket {
			visibleBucket := securityVisibleBucket(originalToBucket, i, bucket)
			if visibleBucket >= 0 && visibleBucket < len(colors) {
				out[i] = colors[visibleBucket]
			}
		}
		return colorSeriesValue(out)
	}
	values := toSeries(value, bucketLength)
	out := make([]float64, originalLength)
	for i, bucket := range originalToBucket {
		visibleBucket := securityVisibleBucket(originalToBucket, i, bucket)
		if visibleBucket >= 0 && visibleBucket < len(values) {
			out[i] = values[visibleBucket]
		} else {
			out[i] = math.NaN()
		}
	}
	return seriesValue(out)
}

// securityVisibleBucket implements higher-timeframe lookahead_off mapping with
// gaps_off. Until the final chart bar in a bucket, only the previous completed
// bucket is visible. The last supplied candle is treated as the current chart
// snapshot, so its partially aggregated bucket may be exposed there; it still
// contains no data later than that candle. This prevents an early intraday bar
// from observing the end-of-day high/close assembled from future chart bars.
func securityVisibleBucket(originalToBucket []int, index int, bucket int) int {
	if bucket < 0 {
		return -1
	}
	isFinalSubbar := index == len(originalToBucket)-1 || originalToBucket[index+1] != bucket
	if !isFinalSubbar {
		return bucket - 1
	}
	return bucket
}

func timeframeOpenTimeSeries(candles []Candle, timeframeName string) []float64 {
	out := make([]float64, len(candles))
	normalized := strings.ToUpper(strings.TrimSpace(timeframeName))
	for i, candle := range candles {
		switch normalized {
		case "D", "1D":
			out[i] = float64(dayStart(candle.Time))
		default:
			out[i] = float64(candle.Time)
		}
	}
	return out
}

func sequenceBuckets(length int) []int {
	out := make([]int, length)
	for i := range out {
		out[i] = i
	}
	return out
}

func fillNaN(length int) []float64 {
	out := make([]float64, length)
	for i := range out {
		out[i] = math.NaN()
	}
	return out
}

func dayStart(seconds int64) int64 {
	utc := time.Unix(seconds, 0).UTC()
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC).Unix()
}
