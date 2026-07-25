package pineruntime

import (
	"fmt"
	"math"
	"strings"
	"time"
)

type pineKind int

const (
	kindNumber pineKind = iota
	kindSeries
	kindColor
	kindColorSeries
	kindString
	kindBool
)

type pineValue struct {
	kind    pineKind
	number  float64
	series  []float64
	color   string
	colors  []string
	text    string
	boolean bool
}

type evalContext struct {
	candles        []Candle
	variables      map[string]pineValue
	functions      map[string]pineFunction
	inputOverrides map[string]InputValue
	assignments    []pineAssignment
	symbol         pineSymbolInfo
}

type pineSymbolInfo struct {
	tickerID string
	kind     string
	mintick  float64
	timezone string
}

type pineAssignment struct {
	name       string
	expression string
}

type pineFunction struct {
	params     []string
	expression string
}

type callArg struct {
	name  string
	value pineValue
}

func numberValue(value float64) pineValue    { return pineValue{kind: kindNumber, number: value} }
func boolValue(value bool) pineValue         { return pineValue{kind: kindBool, boolean: value} }
func stringValue(value string) pineValue     { return pineValue{kind: kindString, text: value} }
func colorValue(value string) pineValue      { return pineValue{kind: kindColor, color: value} }
func seriesValue(values []float64) pineValue { return pineValue{kind: kindSeries, series: values} }
func colorSeriesValue(values []string) pineValue {
	return pineValue{kind: kindColorSeries, colors: values}
}

func naNumber() pineValue { return numberValue(math.NaN()) }

func usable(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func getAt(value pineValue, index int, length int) float64 {
	switch value.kind {
	case kindNumber:
		return value.number
	case kindSeries:
		if index >= 0 && index < len(value.series) {
			return value.series[index]
		}
	case kindBool:
		if value.boolean {
			return 1
		}
		return 0
	}
	return math.NaN()
}

func colorAt(value pineValue, index int) string {
	switch value.kind {
	case kindColor:
		return value.color
	case kindColorSeries:
		if index >= 0 && index < len(value.colors) {
			return value.colors[index]
		}
	}
	return ""
}

func toSeries(value pineValue, length int) []float64 {
	switch value.kind {
	case kindSeries:
		return value.series
	case kindNumber:
		out := make([]float64, length)
		for i := range out {
			out[i] = value.number
		}
		return out
	case kindBool:
		out := make([]float64, length)
		fill := float64(0)
		if value.boolean {
			fill = 1
		}
		for i := range out {
			out[i] = fill
		}
		return out
	default:
		out := make([]float64, length)
		for i := range out {
			out[i] = math.NaN()
		}
		return out
	}
}

func toColorSeries(value pineValue, length int) []string {
	switch value.kind {
	case kindColorSeries:
		return value.colors
	case kindColor:
		out := make([]string, length)
		for i := range out {
			out[i] = value.color
		}
		return out
	default:
		return make([]string, length)
	}
}

func truthyAt(value pineValue, index int, length int) bool {
	switch value.kind {
	case kindBool:
		return value.boolean
	case kindNumber:
		return usable(value.number) && value.number != 0
	case kindSeries:
		point := getAt(value, index, length)
		return usable(point) && point != 0
	case kindColor, kindColorSeries:
		return colorAt(value, index) != ""
	}
	return false
}

func valueVaries(value pineValue) bool {
	return value.kind == kindSeries || value.kind == kindColorSeries
}

func stringAt(value pineValue, index int, length int) string {
	switch value.kind {
	case kindString:
		return value.text
	case kindColor:
		return value.color
	case kindBool:
		if value.boolean {
			return "true"
		}
		return "false"
	default:
		point := getAt(value, index, length)
		if usable(point) {
			return fmt.Sprintf("%g", point)
		}
		return ""
	}
}

func chooseValue(condition, whenTrue, whenFalse pineValue, length int) pineValue {
	// Object metadata is evaluated in a one-bar scalar context. A built-in such
	// as `close` is still represented as a one-element series there, but its
	// ternary result is scalar and may legitimately be a string.
	if length <= 1 {
		if truthyAt(condition, 0, length) {
			return whenTrue
		}
		return whenFalse
	}
	if !valueVaries(condition) {
		if truthyAt(condition, 0, length) {
			return whenTrue
		}
		return whenFalse
	}
	if whenTrue.kind == kindColor || whenTrue.kind == kindColorSeries || whenFalse.kind == kindColor || whenFalse.kind == kindColorSeries {
		out := make([]string, length)
		for i := range out {
			if truthyAt(condition, i, length) {
				out[i] = colorAt(whenTrue, i)
			} else {
				out[i] = colorAt(whenFalse, i)
			}
		}
		return colorSeriesValue(out)
	}
	out := make([]float64, length)
	for i := range out {
		if truthyAt(condition, i, length) {
			out[i] = getAt(whenTrue, i, length)
		} else {
			out[i] = getAt(whenFalse, i, length)
		}
	}
	return seriesValue(out)
}

func shiftValue(value pineValue, offset int, length int) pineValue {
	if value.kind == kindColor || value.kind == kindColorSeries {
		colors := toColorSeries(value, length)
		out := make([]string, length)
		for i := range out {
			j := i - offset
			if j >= 0 && j < len(colors) {
				out[i] = colors[j]
			}
		}
		return colorSeriesValue(out)
	}
	values := toSeries(value, length)
	out := make([]float64, length)
	for i := range out {
		j := i - offset
		if j >= 0 && j < len(values) {
			out[i] = values[j]
		} else {
			out[i] = math.NaN()
		}
	}
	return seriesValue(out)
}

func combineValues(left, right pineValue, op string, length int) pineValue {
	if op == "+" && (left.kind == kindString || right.kind == kindString) {
		return stringValue(stringAt(left, length-1, length) + stringAt(right, length-1, length))
	}
	if left.kind == kindNumber && right.kind == kindNumber {
		return numberValue(applyOperator(left.number, right.number, op))
	}
	out := make([]float64, length)
	for i := range out {
		a, b := getAt(left, i, length), getAt(right, i, length)
		if usable(a) && usable(b) {
			out[i] = applyOperator(a, b, op)
		} else {
			out[i] = math.NaN()
		}
	}
	return seriesValue(out)
}

func applyOperator(a, b float64, op string) float64 {
	switch op {
	case "+":
		return a + b
	case "-":
		return a - b
	case "*":
		return a * b
	case "/":
		if b == 0 {
			return math.NaN()
		}
		return a / b
	default:
		return math.NaN()
	}
}

func compareValues(left, right pineValue, op string, length int) pineValue {
	compare := func(a, b float64) bool {
		switch op {
		case ">":
			return a > b
		case ">=":
			return a >= b
		case "<":
			return a < b
		case "<=":
			return a <= b
		case "==":
			return a == b
		case "!=":
			return a != b
		default:
			return false
		}
	}
	if (left.kind == kindString || right.kind == kindString) && (op == "==" || op == "!=") {
		equal := stringAt(left, length-1, length) == stringAt(right, length-1, length)
		if op == "!=" {
			equal = !equal
		}
		return boolValue(equal)
	}
	if left.kind == kindNumber && right.kind == kindNumber {
		return boolValue(compare(left.number, right.number))
	}
	out := make([]float64, length)
	for i := range out {
		a, b := getAt(left, i, length), getAt(right, i, length)
		if usable(a) && usable(b) && compare(a, b) {
			out[i] = 1
		} else {
			out[i] = 0
		}
	}
	return seriesValue(out)
}

func logicalValues(left, right pineValue, op string, length int) pineValue {
	if !valueVaries(left) && !valueVaries(right) {
		if op == "and" {
			return boolValue(truthyAt(left, 0, length) && truthyAt(right, 0, length))
		}
		return boolValue(truthyAt(left, 0, length) || truthyAt(right, 0, length))
	}
	out := make([]float64, length)
	for i := range out {
		ok := false
		if op == "and" {
			ok = truthyAt(left, i, length) && truthyAt(right, i, length)
		} else {
			ok = truthyAt(left, i, length) || truthyAt(right, i, length)
		}
		if ok {
			out[i] = 1
		}
	}
	return seriesValue(out)
}

func logicalNotValue(value pineValue, length int) pineValue {
	if !valueVaries(value) {
		return boolValue(!truthyAt(value, 0, length))
	}
	out := make([]float64, length)
	for i := range out {
		if !truthyAt(value, i, length) {
			out[i] = 1
		}
	}
	return seriesValue(out)
}

func negateValue(value pineValue, length int) pineValue {
	if value.kind == kindNumber {
		return numberValue(-value.number)
	}
	values := toSeries(value, length)
	out := make([]float64, length)
	for i, point := range values {
		if usable(point) {
			out[i] = -point
		} else {
			out[i] = math.NaN()
		}
	}
	return seriesValue(out)
}

func sourceSeries(candles []Candle, field string) pineValue {
	values := make([]float64, len(candles))
	for i, candle := range candles {
		switch field {
		case "open":
			values[i] = candle.Open
		case "high":
			values[i] = candle.High
		case "low":
			values[i] = candle.Low
		case "close":
			values[i] = candle.Close
		case "volume":
			values[i] = candle.Volume
		case "time":
			values[i] = float64(candle.Time)
		}
	}
	return seriesValue(values)
}

func pairAverage(candles []Candle, fields ...string) pineValue {
	values := make([]float64, len(candles))
	for i, candle := range candles {
		sum := float64(0)
		for _, field := range fields {
			switch field {
			case "open":
				sum += candle.Open
			case "high":
				sum += candle.High
			case "low":
				sum += candle.Low
			case "close":
				sum += candle.Close
			}
		}
		values[i] = sum / float64(len(fields))
	}
	return seriesValue(values)
}

func inferTimeframePeriod(candles []Candle) string {
	if len(candles) < 2 {
		return ""
	}
	step := candles[len(candles)-1].Time - candles[len(candles)-2].Time
	switch {
	case step <= 60:
		return "1"
	case step < 3600:
		return fmt.Sprint(step / 60)
	case step < 86400:
		return fmt.Sprintf("%dH", step/3600)
	default:
		return "D"
	}
}

func formatPineDate(seconds float64, timezone string) string {
	if !usable(seconds) {
		return ""
	}
	location := time.UTC
	if strings.TrimSpace(timezone) != "" {
		if loaded, err := time.LoadLocation(strings.TrimSpace(timezone)); err == nil {
			location = loaded
		}
	}
	return time.Unix(int64(seconds), 0).In(location).Format("2006-01-02")
}
