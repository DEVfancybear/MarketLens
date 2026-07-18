package pineruntime

import (
	"math"
	"testing"
)

func TestVectorSecurityLookaheadOffDoesNotBroadcastFutureBucketValues(t *testing.T) {
	day := int64(1767225600) // 2026-01-01 00:00:00 UTC
	candles := []Candle{
		{Time: day + 3600, Open: 5, High: 10, Low: 1, Close: 6},
		{Time: day + 7200, Open: 6, High: 20, Low: 2, Close: 7},
		{Time: day + 10800, Open: 7, High: 15, Low: 3, Close: 8},
		{Time: day + 86400 + 3600, Open: 8, High: 25, Low: 4, Close: 9},
		{Time: day + 86400 + 7200, Open: 9, High: 30, Low: 5, Close: 10},
	}
	context := &evalContext{
		candles:   candles,
		variables: map[string]pineValue{},
		functions: map[string]pineFunction{},
	}
	value, handled, err := evaluateRequestSecurityExpression(
		`request.security(symbol=syminfo.tickerid, timeframe="D", expression=high, lookahead=barmerge.lookahead_off)`,
		context,
	)
	if err != nil || !handled {
		t.Fatalf("security evaluation: handled=%v err=%v", handled, err)
	}
	got := toSeries(value, len(candles))
	if !math.IsNaN(got[0]) || !math.IsNaN(got[1]) {
		t.Fatalf("early first-day bars observed a future daily high: %+v", got)
	}
	if got[2] != 20 || got[3] != 20 || got[4] != 30 {
		t.Fatalf("causal daily mapping = %+v, want [na na 20 20 30]", got)
	}
}

func TestVectorSecuritySupportsFixedHigherTimeframes(t *testing.T) {
	candles := []Candle{
		{Time: 3600, High: 10},
		{Time: 7200, High: 15},
		{Time: 10800, High: 20},
		{Time: 14400, High: 25},
		{Time: 18000, High: 30},
	}
	context := &evalContext{candles: candles, variables: map[string]pineValue{}, functions: map[string]pineFunction{}}
	value, handled, err := evaluateRequestSecurityExpression(
		`request.security(syminfo.tickerid, "120", high)`,
		context,
	)
	if err != nil || !handled {
		t.Fatalf("two-hour security evaluation: handled=%v err=%v", handled, err)
	}
	got := toSeries(value, len(candles))
	want := []float64{10, 10, 20, 20, 30}
	for index := range want {
		if got[index] != want[index] {
			t.Fatalf("two-hour mapping = %+v, want %+v", got, want)
		}
	}
}

func TestRequestSecurityInvalidAndLowerTimeframesFailClosed(t *testing.T) {
	context := &evalContext{
		candles:   []Candle{{Time: 3600, Close: 1}, {Time: 7200, Close: 2}},
		variables: map[string]pineValue{},
		functions: map[string]pineFunction{},
	}
	for _, expression := range []string{
		`request.security(syminfo.tickerid, "30", close)`,
		`request.security(syminfo.tickerid, "nonsense", close)`,
	} {
		if _, handled, err := evaluateRequestSecurityExpression(expression, context); !handled || err == nil {
			t.Fatalf("unsafe timeframe did not fail closed: expression=%s handled=%v err=%v", expression, handled, err)
		}
	}
}

func TestStatefulSecurityMappingMatchesCausalBucketBoundary(t *testing.T) {
	day := int64(1767225600)
	original := []Candle{
		{Time: day + 3600},
		{Time: day + 7200},
		{Time: day + 10800},
		{Time: day + 86400 + 3600},
		{Time: day + 86400 + 7200},
	}
	target := []Candle{{Time: day}, {Time: day + 86400}}
	values := []statefulValue{statefulNumber(20), statefulNumber(30)}
	mapped := mapStatefulSecurityValues(original, target, values, 86400)
	wants := []float64{math.NaN(), math.NaN(), 20, 20, 30}
	for index, want := range wants {
		if math.IsNaN(want) {
			if mapped[index].kind != statefulValueNA {
				t.Fatalf("mapped[%d] = %#v, want na", index, mapped[index])
			}
			continue
		}
		if mapped[index].kind != statefulValueNumber || mapped[index].number != want {
			t.Fatalf("mapped[%d] = %#v, want %v", index, mapped[index], want)
		}
	}
}

func TestRequestSecurityLookaheadOnFailsClosed(t *testing.T) {
	for name, mergeArgs := range map[string]string{
		"named lookahead":      `lookahead=barmerge.lookahead_on`,
		"positional lookahead": `barmerge.gaps_off, barmerge.lookahead_on`,
		"unsupported gaps":     `gaps=barmerge.gaps_on`,
	} {
		t.Run(name, func(t *testing.T) {
			source := `//@version=5
indicator("Unsafe merge")
plot(request.security(syminfo.tickerid, "D", high, ` + mergeArgs + `))`
			response := Compile(t.Context(), CompileRequest{SourceCode: source, Candles: []Candle{{Time: 60, High: 1}}})
			if len(response.Errors) == 0 {
				t.Fatalf("unsafe bar merge compiled without a replay-safety diagnostic: %s", source)
			}
		})
	}
}

func TestRequestSecurityDynamicOrOtherSymbolFailsClosed(t *testing.T) {
	for name, source := range map[string]string{
		"literal symbol": `//@version=5
indicator("Other symbol")
plot(request.security("NASDAQ:AAPL", "D", close))`,
		"dynamic symbol": `//@version=5
indicator("Dynamic symbol")
symbol = input.symbol("NASDAQ:AAPL")
plot(request.security(symbol, "D", close))`,
		"fully named literal symbol": `//@version=5
indicator("Named other symbol")
plot(request.security(symbol="NASDAQ:AAPL", timeframe="D", expression=close))`,
	} {
		t.Run(name, func(t *testing.T) {
			response := Compile(t.Context(), CompileRequest{SourceCode: source, Candles: []Candle{{Time: 60, Close: 1}}})
			if len(response.Errors) == 0 {
				t.Fatalf("unsupported symbol context compiled: %+v", response)
			}
		})
	}
}

func TestStatefulSecurityAcceptsNamedRequiredArguments(t *testing.T) {
	source := `//@version=5
indicator("Named security")
type Holder
    float value
src = close * 2
secured = request.security(symbol=syminfo.tickerid, timeframe="120", expression=src)
plot(secured)
`
	response := Compile(t.Context(), CompileRequest{
		SourceCode: source,
		Candles: []Candle{
			{Time: 3600, Open: 1, High: 2, Low: 0, Close: 1},
			{Time: 7200, Open: 2, High: 3, Low: 1, Close: 2},
			{Time: 10800, Open: 3, High: 4, Low: 2, Close: 3},
		},
	})
	if len(response.Errors) != 0 || len(response.Result.Series) != 1 {
		t.Fatalf("named stateful request.security() = %+v", response)
	}
	points := response.Result.Series[0].Data
	want := []float64{2, 2, 6}
	if len(points) != len(want) {
		t.Fatalf("named stateful security points = %+v", points)
	}
	for index := range want {
		if points[index].Value != want[index] {
			t.Fatalf("stateful HTF dependency values = %+v, want %+v", points, want)
		}
	}
}

func TestVectorSecurityReevaluatesIntermediateSeriesInChildContext(t *testing.T) {
	source := `//@version=5
indicator("Vector dependency")
src = close * 2
secured = request.security(syminfo.tickerid, "120", src)
plot(secured)
`
	response := Compile(t.Context(), CompileRequest{
		SourceCode: source,
		Candles: []Candle{
			{Time: 3600, Close: 1},
			{Time: 7200, Close: 2},
			{Time: 10800, Close: 3},
		},
	})
	if len(response.Errors) != 0 || len(response.Result.Series) != 1 {
		t.Fatalf("vector request.security dependency = %+v", response)
	}
	points := response.Result.Series[0].Data
	want := []float64{2, 2, 6}
	if len(points) != len(want) {
		t.Fatalf("vector security points = %+v", points)
	}
	for index := range want {
		if points[index].Value != want[index] {
			t.Fatalf("vector HTF dependency values = %+v, want %+v", points, want)
		}
	}
}
