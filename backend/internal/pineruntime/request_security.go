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
	if len(args.positional) < 3 {
		return pineValue{}, true, fmt.Errorf("request.security() expects symbol, timeframe, and expression")
	}
	timeframeArg := strings.TrimSpace(args.positional[1])
	requestedTimeframe, ok := unquote(timeframeArg)
	if !ok {
		requestedTimeframe = timeframeArg
	}
	dailyCandles, originalToBucket, ok := aggregateCandlesForTimeframe(context.candles, requestedTimeframe)
	if !ok || len(dailyCandles) == 0 {
		return seriesValue(fillNaN(len(context.candles))), true, nil
	}

	securityContext := &evalContext{
		candles:        dailyCandles,
		variables:      map[string]pineValue{},
		functions:      context.functions,
		inputOverrides: context.inputOverrides,
	}
	for key, value := range context.variables {
		if value.kind != kindSeries && value.kind != kindColorSeries {
			securityContext.variables[key] = value
		}
	}
	requestedValue, err := evaluateExpression(args.positional[2], securityContext)
	if err != nil {
		return pineValue{}, true, err
	}
	return expandSecurityValue(requestedValue, originalToBucket, len(context.candles), len(dailyCandles)), true, nil
}

func aggregateCandlesForTimeframe(candles []Candle, timeframeName string) ([]Candle, []int, bool) {
	if len(candles) == 0 {
		return nil, nil, false
	}
	normalized := strings.ToUpper(strings.TrimSpace(timeframeName))
	if normalized == "" {
		return candles, sequenceBuckets(len(candles)), true
	}
	if normalized != "D" && normalized != "1D" {
		return nil, nil, false
	}

	buckets := []Candle{}
	originalToBucket := make([]int, len(candles))
	currentBucket := -1
	currentStart := int64(math.MinInt64)
	for index, candle := range candles {
		start := dayStart(candle.Time)
		if currentBucket < 0 || start != currentStart {
			currentStart = start
			currentBucket = len(buckets)
			buckets = append(buckets, Candle{
				Time:   start,
				Open:   candle.Open,
				High:   candle.High,
				Low:    candle.Low,
				Close:  candle.Close,
				Volume: candle.Volume,
			})
		} else {
			bucket := &buckets[currentBucket]
			if candle.High > bucket.High {
				bucket.High = candle.High
			}
			if candle.Low < bucket.Low {
				bucket.Low = candle.Low
			}
			bucket.Close = candle.Close
			bucket.Volume += candle.Volume
		}
		originalToBucket[index] = currentBucket
	}
	return buckets, originalToBucket, true
}

func expandSecurityValue(value pineValue, originalToBucket []int, originalLength int, bucketLength int) pineValue {
	if value.kind == kindColor || value.kind == kindColorSeries {
		colors := toColorSeries(value, bucketLength)
		out := make([]string, originalLength)
		for i, bucket := range originalToBucket {
			if bucket >= 0 && bucket < len(colors) {
				out[i] = colors[bucket]
			}
		}
		return colorSeriesValue(out)
	}
	values := toSeries(value, bucketLength)
	out := make([]float64, originalLength)
	for i, bucket := range originalToBucket {
		if bucket >= 0 && bucket < len(values) {
			out[i] = values[bucket]
		} else {
			out[i] = math.NaN()
		}
	}
	return seriesValue(out)
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
