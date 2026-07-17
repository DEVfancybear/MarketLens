package pineruntime

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"sync"
)

// orderedJob is the common unit used by compiler branches that can evaluate
// independent branches concurrently. Results always retain declaration order,
// which keeps chart series keys and snapshots deterministic.
type orderedJob[T any] func(context.Context) (T, error)

func runOrderedJobs[T any](ctx context.Context, jobs []orderedJob[T], parallelism int) ([]T, error) {
	results := make([]T, len(jobs))
	if len(jobs) == 0 {
		return results, nil
	}
	if parallelism < 1 || parallelism > len(jobs) {
		parallelism = len(jobs)
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	indices := make(chan int)
	var workers sync.WaitGroup
	var firstErr error
	var errOnce sync.Once
	for worker := 0; worker < parallelism; worker++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for index := range indices {
				value, err := runOrderedJob(ctx, jobs[index])
				if err != nil {
					errOnce.Do(func() {
						firstErr = err
						cancel()
					})
					continue
				}
				results[index] = value
			}
		}()
	}
dispatch:
	for index := range jobs {
		select {
		case indices <- index:
		case <-ctx.Done():
			break dispatch
		}
	}
	close(indices)
	workers.Wait()
	if firstErr != nil {
		return nil, firstErr
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return results, nil
}

func runOrderedJob[T any](ctx context.Context, job orderedJob[T]) (value T, err error) {
	defer func() {
		if recovered := recover(); recovered != nil {
			err = fmt.Errorf("ordered runtime job panicked: %v", recovered)
		}
	}()
	return job(ctx)
}

func runtimeInputBool(values map[string]InputValue, key string, fallback bool) bool {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		parsed, err := strconv.ParseBool(strings.TrimSpace(typed))
		if err == nil {
			return parsed
		}
	}
	return fallback
}

func runtimeInputInt(values map[string]InputValue, key string, fallback, minimum, maximum int) int {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback
	}
	number, ok := runtimeNumericValue(value)
	if !ok {
		return fallback
	}
	result := int(number)
	if result < minimum {
		return minimum
	}
	if maximum > 0 && result > maximum {
		return maximum
	}
	return result
}

func runtimeInputFloat(values map[string]InputValue, key string, fallback, minimum, maximum float64) float64 {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback
	}
	number, ok := runtimeNumericValue(value)
	if !ok {
		return fallback
	}
	if number < minimum {
		return minimum
	}
	if maximum > minimum && number > maximum {
		return maximum
	}
	return number
}

func runtimeInputText(values map[string]InputValue, key, fallback string) string {
	value, exists := values[key]
	if !exists || value == nil {
		return fallback
	}
	text := strings.TrimSpace(fmt.Sprint(value))
	if text == "" || text == "<nil>" {
		return fallback
	}
	return text
}

func timeframeSeconds(value string) (int64, bool) {
	raw := strings.TrimSpace(value)
	if raw == "" || strings.EqualFold(raw, "chart") {
		return 0, true
	}

	// Chart timeframes use a lowercase "m" for minutes while Pine uses an
	// uppercase "M" for calendar months. Preserve suffix case so "1m" cannot
	// be silently promoted to "1M". A number without a suffix is Pine's
	// minute notation.
	unit := byte(0)
	amountText := raw
	last := raw[len(raw)-1]
	if last < '0' || last > '9' {
		unit = last
		amountText = strings.TrimSpace(raw[:len(raw)-1])
	}
	if amountText == "" && unit != 0 {
		amountText = "1"
	}
	amount, err := strconv.ParseInt(amountText, 10, 64)
	if err != nil || amount <= 0 {
		return 0, false
	}

	var multiplier int64
	switch unit {
	case 0, 'm':
		multiplier = 60
	case 'S', 's':
		multiplier = 1
	case 'H', 'h':
		multiplier = 3600
	case 'D', 'd':
		multiplier = 86400
	case 'W', 'w':
		multiplier = 604800
	case 'M':
		multiplier = 2592000
	default:
		return 0, false
	}
	if amount > (1<<63-1)/multiplier {
		return 0, false
	}
	return amount * multiplier, true
}

func aggregateRuntimeCandles(candles []Candle, seconds int64) ([]Candle, error) {
	if seconds <= 0 || len(candles) == 0 {
		return candles, nil
	}
	out := make([]Candle, 0, len(candles))
	for _, candle := range candles {
		bucket := candle.Time - candle.Time%seconds
		if len(out) == 0 || out[len(out)-1].Time != bucket {
			candle.Time = bucket
			out = append(out, candle)
			continue
		}
		current := &out[len(out)-1]
		if candle.High > current.High {
			current.High = candle.High
		}
		if candle.Low < current.Low {
			current.Low = candle.Low
		}
		current.Close = candle.Close
		current.Volume += candle.Volume
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("timeframe aggregation produced no candles")
	}
	return out, nil
}
