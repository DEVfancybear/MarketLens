package pineruntime

import (
	"context"
	"math"
	"strings"
	"testing"
)

func TestPineV6LoopsAndCollectionsConformance(t *testing.T) {
	source := `//@version=6
indicator("Pine v6 loops and collections")
var array<float> values = array.from(1.0, 2.0, 3.0)
var map<string, float> totals = map.new<string, float>()
var matrix<float> weights = matrix.new<float>(2, 2, 0.0)
if barstate.isfirst
    totals.put("x", 5.0)
    weights.set(1, 1, 7.0)
i = 0
sum = 0.0
while i < values.size()
    if i == 1
        i += 1
        continue
    sum += values.get(i)
    if sum > 3
        break
    i += 1
for j = 0 to 4 by 2
    sum += j % 3
plot(sum + totals.get("x") + weights.get(1, 1), "Value")`

	response := Compile(context.Background(), CompileRequest{
		SourceCode: source,
		Candles: []Candle{
			{Time: 100, Close: 1},
			{Time: 200, Close: 2},
		},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("Pine v6 conformance compile errors: %+v", response.Errors)
	}
	if len(response.UnsupportedFeatures) != 0 {
		t.Fatalf("Pine v6 conformance unsupported features: %+v", response.UnsupportedFeatures)
	}
	if len(response.Result.Series) != 1 || len(response.Result.Series[0].Data) != 2 {
		t.Fatalf("Pine v6 conformance series: %+v", response.Result.Series)
	}
	for _, point := range response.Result.Series[0].Data {
		if math.Abs(point.Value-19) > 1e-9 {
			t.Fatalf("Pine v6 conformance value = %.12f, want 19", point.Value)
		}
	}
}

func TestPineV6CollectionNamespaceCallsAndCopies(t *testing.T) {
	source := `//@version=6
indicator("Pine v6 collection namespaces")
var values = array.new_float(0)
if barstate.isfirst
    array.push(values, 2.0)
    array.unshift(values, 1.0)
copied = array.copy(values)
array.push(copied, 3.0)
var lookup = map.new<string, float>()
map.put(lookup, "sum", array.sum(copied))
var grid = matrix.new<float>(1, 2, 4.0)
transposed = matrix.transpose(grid)
plot(map.get(lookup, "sum") + matrix.get(transposed, 1, 0), "Value")`

	response := Compile(context.Background(), CompileRequest{
		SourceCode: source,
		Candles:    []Candle{{Time: 100, Close: 1}},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("Pine v6 namespace compile errors: %+v", response.Errors)
	}
	if len(response.Result.Series) != 1 || len(response.Result.Series[0].Data) != 1 {
		t.Fatalf("Pine v6 namespace series: %+v", response.Result.Series)
	}
	if got := response.Result.Series[0].Data[0].Value; math.Abs(got-10) > 1e-9 {
		t.Fatalf("Pine v6 namespace value = %.12f, want 10", got)
	}
}

func TestPineV6TechnicalAnalysisHistoryConformance(t *testing.T) {
	source := `//@version=6
indicator("Pine v6 TA conformance")
[basis, upper, lower] = ta.bb(close, 5, 2.0)
[macdLine, signalLine, histogram] = ta.macd(close, 3, 6, 2)
plot(ta.change(close, 2), "Change")
plot(ta.highest(close, 5), "Highest")
plot(ta.lowest(close, 5), "Lowest")
plot(ta.range(close, 5), "Range")
plot(ta.roc(close, 5), "ROC")
plot(ta.barssince(close == 17), "BarsSince")
plot(ta.rsi(close, 5), "RSI")
plot(ta.atr(3), "ATR")
plot(ta.hma(close, 6), "HMA")
plot(basis, "BB Basis")
plot(upper, "BB Upper")
plot(lower, "BB Lower")
plot(macdLine, "MACD")
plot(signalLine, "Signal")
plot(histogram, "Histogram")`

	candles := make([]Candle, 20)
	for index := range candles {
		closeValue := float64(index + 1)
		candles[index] = Candle{
			Time:   int64(100 + index*60),
			Open:   closeValue,
			High:   closeValue + 1,
			Low:    closeValue - 1,
			Close:  closeValue,
			Volume: 100,
		}
	}
	response := Compile(context.Background(), CompileRequest{
		SourceCode: source,
		Candles:    candles,
	})
	if len(response.Errors) != 0 {
		t.Fatalf("Pine v6 TA compile errors: %+v", response.Errors)
	}
	last := map[string]float64{}
	for _, series := range response.Result.Series {
		if len(series.Data) != 0 {
			key := series.Key
			if separator := strings.LastIndex(key, ":"); separator >= 0 {
				key = key[separator+1:]
			}
			last[key] = series.Data[len(series.Data)-1].Value
		}
	}
	wants := map[string]float64{
		"Change":    2,
		"Highest":   20,
		"Lowest":    16,
		"Range":     4,
		"ROC":       100 * 5.0 / 15.0,
		"BarsSince": 3,
		"RSI":       100,
		"ATR":       2,
		"BB Basis":  18,
		"BB Upper":  18 + 2*math.Sqrt(2),
		"BB Lower":  18 - 2*math.Sqrt(2),
	}
	for key, want := range wants {
		got, ok := last[key]
		if !ok || math.Abs(got-want) > 1e-8 {
			t.Fatalf("Pine v6 TA %s = %.12f (present=%v), want %.12f; series=%+v", key, got, ok, want, response.Result.Series)
		}
	}
	for _, key := range []string{"HMA", "MACD", "Signal", "Histogram"} {
		if got, ok := last[key]; !ok || math.IsNaN(got) || math.IsInf(got, 0) {
			t.Fatalf("Pine v6 TA %s missing/invalid: %+v", key, response.Result.Series)
		}
	}
}

func TestPineV6MathStringAndMarkerConformance(t *testing.T) {
	source := `//@version=6
indicator("Pine v6 math string markers", overlay = true)
value = math.pow(2.0, 3.0) + math.avg(2.0, 4.0) + str.length(str.upper("ab"))
plot(value, "Value")
plotshape(close > open, "Shape", shape.triangleup, location.belowbar, color.green, text = "BUY", textcolor = color.white)
plotchar(close > open, "Character", "!", location.abovebar, color.yellow)`

	response := Compile(context.Background(), CompileRequest{
		SourceCode: source,
		Candles: []Candle{
			{Time: 100, Open: 1, High: 3, Low: 0, Close: 2},
			{Time: 200, Open: 2, High: 3, Low: 1, Close: 1},
		},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("Pine v6 math/string/marker compile errors: %+v", response.Errors)
	}
	if len(response.Result.Series) != 1 || len(response.Result.Series[0].Data) != 2 {
		t.Fatalf("Pine v6 math/string series: %+v", response.Result.Series)
	}
	for _, point := range response.Result.Series[0].Data {
		if math.Abs(point.Value-13) > 1e-9 {
			t.Fatalf("Pine v6 math/string value = %.12f, want 13", point.Value)
		}
	}
	texts := map[string]bool{}
	for _, label := range response.Result.Labels {
		texts[label.Text] = true
	}
	if !texts["BUY"] || !texts["!"] {
		t.Fatalf("Pine v6 marker labels: %+v", response.Result.Labels)
	}
}
