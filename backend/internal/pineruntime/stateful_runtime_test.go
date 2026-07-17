package pineruntime

import (
	"context"
	"strings"
	"testing"
)

const genericStatefulPineSource = `//@version=5
indicator("Renamed state machine", overlay=true, max_boxes_count=20)
shade = input.color(color.new(#336699, 60), "Shade")

type region
    float ceiling
    float floor
    bool rising
    int born = time

scan() =>
    var latest = region.new(na, na, na, na)
    signal = close > open and bar_index > 0
    if signal
        latest := region.new(high, low, true)
    [signal, latest]

var marker = 0
var records = array.new<region>(0)
var areas = array.new<box>(0)
[signal, candidate] = request.security(syminfo.tickerid, "", scan())

if signal and candidate.born != marker
    areas.unshift(box.new(bar_index-1, candidate.ceiling, bar_index+3, candidate.floor, na, bgcolor=shade))
    records.unshift(candidate)
    marker := candidate.born

if records.size() > 1
    for i = records.size()-1 to 1
        old = areas.remove(i)
        old.delete()
        records.remove(i)
`

func TestStatefulCompilerDispatchesOnLanguageNotIdentity(t *testing.T) {
	candles := []Candle{
		{Time: 60, Open: 10, High: 11, Low: 9, Close: 9.5},
		{Time: 120, Open: 10, High: 12, Low: 9.8, Close: 11.5},
		{Time: 180, Open: 11, High: 13, Low: 10.5, Close: 12.5},
	}
	result, handled, errors := compileStatefulPine(context.Background(), CompileRequest{
		SourceCode: genericStatefulPineSource,
		Candles:    candles,
		Timeframe:  "1m",
	}, "generic-copy")
	if !handled || len(errors) != 0 {
		t.Fatalf("handled=%v errors=%+v", handled, errors)
	}
	if result.ID != "generic-copy" || len(result.Series) != 1 {
		t.Fatalf("result=%+v", result)
	}
	series := result.Series[0]
	if series.Type != "baselineFill" || !strings.Contains(series.Color, "51, 102, 153") {
		t.Fatalf("box series=%+v", series)
	}
}

func TestStatefulCompilerDeclinesOrdinaryVectorScript(t *testing.T) {
	result, handled, errors := compileStatefulPine(context.Background(), CompileRequest{
		SourceCode: `indicator("ordinary"); plot(close)`,
	}, "ordinary")
	if handled || len(errors) != 0 || result.ID != "ordinary" {
		t.Fatalf("result=%+v handled=%v errors=%+v", result, handled, errors)
	}
}

func TestStatefulSecurityUsesIndependentFunctionVarState(t *testing.T) {
	program, err := parseStatefulProgram(genericStatefulPineSource)
	if err != nil {
		t.Fatal(err)
	}
	if !program.usesState || program.types["region"] == nil || program.functions["scan"] == nil {
		t.Fatalf("program=%+v", program)
	}
	// The UDT's timestamp default and function-local `var` are intentionally
	// asserted through the rendered box: the last signal must carry the child
	// security context's current bar time, not a zero/default host value.
	candles := []Candle{
		{Time: 60, Open: 10, High: 11, Low: 9, Close: 9.5},
		{Time: 120, Open: 10, High: 12, Low: 9.8, Close: 11.5},
	}
	result, handled, errors := compileStatefulPine(context.Background(), CompileRequest{SourceCode: genericStatefulPineSource, Candles: candles}, "state")
	if !handled || len(errors) != 0 || len(result.Series) != 1 {
		t.Fatalf("result=%+v handled=%v errors=%+v", result, handled, errors)
	}
}

func TestStatefulTupleSecurityPreservesBullishRecordOnFollowingBar(t *testing.T) {
	source, found, err := builtInPineSource("FVG")
	if err != nil || !found {
		t.Fatalf("load stateful fixture: found=%v err=%v", found, err)
	}
	response := Compile(context.Background(), CompileRequest{
		ScriptID:   "stateful-regression",
		SourceCode: source,
		Timeframe:  "5",
		InputOverrides: map[string]InputValue{
			"thresholdPer": 0.0,
			"auto":         false,
			"dynamic":      false,
			"showDash":     true,
		},
		Candles: []Candle{
			{Time: 1721170800, Open: 99, High: 100, Low: 98, Close: 99},
			{Time: 1721171100, Open: 100, High: 111, Low: 99, Close: 110},
			{Time: 1721171400, Open: 106, High: 109, Low: 105, Close: 108},
			{Time: 1721171700, Open: 108, High: 110, Low: 106, Close: 109},
		},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("compile errors: %+v", response.Errors)
	}
	if response.Result.Dashboard == nil {
		t.Fatal("dashboard was not emitted")
	}
	if len(response.Result.Series) != 1 || response.Result.Series[0].Type != "baselineFill" {
		t.Fatalf("bullish record did not produce an active box: %+v", response.Result.Series)
	}
}

func TestStatefulGenericInputOverridePreservesDefvalType(t *testing.T) {
	tests := []struct {
		name     string
		raw      InputValue
		declared statefulValue
		want     statefulValue
	}{
		{name: "false", raw: false, declared: statefulBool(true), want: statefulBool(false)},
		{name: "true", raw: true, declared: statefulBool(false), want: statefulBool(true)},
		{name: "number", raw: 7, declared: statefulNumber(1), want: statefulNumber(7)},
		{name: "color", raw: "#123456", declared: statefulColor("#ffffff"), want: statefulColor("#123456")},
		{name: "string", raw: "Bottom Left", declared: statefulString("Top Right"), want: statefulString("Bottom Left")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := statefulInputOverride(test.raw, test.declared)
			if !statefulEqual(got, test.want) {
				t.Fatalf("override=%+v want=%+v", got, test.want)
			}
		})
	}
}
