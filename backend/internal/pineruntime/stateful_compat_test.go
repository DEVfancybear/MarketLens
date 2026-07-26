package pineruntime

import (
	"context"
	_ "embed"
	"strings"
	"testing"
)

// Keep the real user-provided source in the regression fixture.  It exercises
// wrapped string concatenations, a UDT, history references, pivots, ternaries,
// and label drawing in one small script.
//
//go:embed testdata/swing_high_low_luxalgo.pine
var swingHighLowLuxAlgoSource string

func TestSubmittedSwingHighLowPineCompilesWithWrappedExpressions(t *testing.T) {
	highs := []float64{1, 2, 5, 3, 2, 4, 6, 3, 2}
	lows := []float64{0, -1, -3, -1, 0, -2, -1, -1, 0}
	candles := make([]Candle, len(highs))
	for index := range candles {
		mid := (highs[index] + lows[index]) / 2
		candles[index] = Candle{
			Time: int64(100 + index*60), Open: mid, High: highs[index],
			Low: lows[index], Close: mid, Volume: 1,
		}
	}
	response := Compile(context.Background(), CompileRequest{
		ScriptID:   "submitted-swing",
		SourceCode: swingHighLowLuxAlgoSource,
		Candles:    candles,
		InputOverrides: map[string]InputValue{
			"length": 2,
		},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("submitted source compile errors: %+v", response.Errors)
	}
	if len(response.UnsupportedFeatures) != 0 {
		t.Fatalf("submitted source unsupported features: %+v", response.UnsupportedFeatures)
	}
	if response.Meta.Name != "Swing Highs/Lows & Candle Patterns [LuxAlgo]" ||
		response.Meta.ShortTitle != "LuxAlgo - Swing Highs/Lows & Candle Patterns" {
		t.Fatalf("submitted source metadata = %+v", response.Meta)
	}
	if response.Meta.Version != 5 || response.Meta.Properties["max_labels_count"] != 500 {
		t.Fatalf("submitted declaration metadata = %+v", response.Meta)
	}
	if len(response.Result.Labels) != 3 {
		t.Fatalf("submitted source labels = %+v", response.Result.Labels)
	}
	wants := []struct {
		price float64
		time  int64
		text  string
		color string
	}{
		{price: 5, time: 220, text: "LH\nNone", color: "#f44336"},
		{price: -2, time: 400, text: "HL\nNone", color: "#00897b"},
		{price: 6, time: 460, text: "HH\nNone", color: "#f44336"},
	}
	for index, want := range wants {
		got := response.Result.Labels[index]
		if got.Price != want.price || got.Time == nil || *got.Time != want.time ||
			got.Text != want.text || got.Color != want.color || got.BackgroundColor != "transparent" {
			t.Fatalf("label %d = %+v, want %+v", index, got, want)
		}
	}
}

func TestSubmittedSwingHighLowReplayStopsAtConfirmationBar(t *testing.T) {
	highs := []float64{1, 2, 5, 3, 2, 4, 6, 3, 2}
	lows := []float64{0, -1, -3, -1, 0, -2, -1, -1, 0}
	candles := make([]Candle, len(highs))
	for index := range candles {
		mid := (highs[index] + lows[index]) / 2
		candles[index] = Candle{Time: int64(100 + index*60), Open: mid, High: highs[index], Low: lows[index], Close: mid, Volume: 1}
	}
	cutoff := int64(280) // between the pivot bar (220) and its confirmation (340)
	response := Compile(context.Background(), CompileRequest{
		ScriptID:       "submitted-swing-replay",
		SourceCode:     swingHighLowLuxAlgoSource,
		Candles:        candles,
		InputOverrides: map[string]InputValue{"length": 2},
		ReplayCutoff:   &cutoff,
	})
	if len(response.Errors) != 0 {
		t.Fatalf("replay compile errors: %+v", response.Errors)
	}
	if len(response.Result.Labels) != 0 {
		t.Fatalf("pivot was emitted before its right-hand confirmation window: %+v", response.Result.Labels)
	}
}

func TestSubmittedSwingHighLowPreservesPatternFieldsAndTooltip(t *testing.T) {
	candles := []Candle{
		{Time: 100, Open: 6, High: 8, Low: 5, Close: 6.5, Volume: 1},
		{Time: 160, Open: 6, High: 10, Low: 5.5, Close: 7, Volume: 1},
		{Time: 220, Open: 7, High: 8, Low: 6, Close: 6.5, Volume: 1},
	}
	response := Compile(context.Background(), CompileRequest{
		ScriptID:   "submitted-swing-pattern",
		SourceCode: swingHighLowLuxAlgoSource,
		Candles:    candles,
		InputOverrides: map[string]InputValue{
			"length":    1,
			"swinghCss": "#ff00ff",
		},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("submitted source compile errors: %+v", response.Errors)
	}
	if len(response.Result.Labels) != 1 {
		t.Fatalf("submitted source pattern labels = %+v", response.Result.Labels)
	}
	label := response.Result.Labels[0]
	if label.Time == nil || *label.Time != 160 || label.Price != 10 ||
		label.Text != "LH\nShooting Star" || label.Color != "#ff00ff" ||
		label.BackgroundColor != "transparent" || label.Style != "label.style_label_down" {
		t.Fatalf("submitted source pattern label = %+v", label)
	}
	if !strings.Contains(label.Tooltip, "shooting star") || !strings.Contains(label.Tooltip, "formed in an uptrend") {
		t.Fatalf("submitted source pattern tooltip = %q", label.Tooltip)
	}
}

func TestSubmittedSwingHighLowExposesGenericInputSchema(t *testing.T) {
	inputs := ExtractInputs(swingHighLowLuxAlgoSource)
	if len(inputs) != 3 {
		t.Fatalf("submitted source inputs = %+v", inputs)
	}
	if inputs[0].Key != "length" || inputs[0].Kind != "int" || inputs[0].DefaultValue != 21 {
		t.Fatalf("length input = %+v", inputs[0])
	}
	for index, want := range []struct {
		key   string
		title string
		color string
	}{
		{key: "swinghCss", title: "Swing High", color: "#f44336"},
		{key: "swinglCss", title: "Swing Low", color: "#00897b"},
	} {
		got := inputs[index+1]
		if got.Key != want.key || got.Title != want.title || got.Kind != "color" ||
			got.DefaultValue != want.color || got.Group != "Style" {
			t.Fatalf("style input %d = %+v, want %+v", index, got, want)
		}
	}
}

func TestStatefulUDTConstructorSupportsNamedFieldsAndDefaults(t *testing.T) {
	response := Compile(context.Background(), CompileRequest{
		SourceCode: `//@version=5
indicator("Named UDT", overlay=true)
type marker
    string title = "default"
    float price = 1
marker current = marker.new(price = high, title = "named")
if barstate.islast
    label.new(bar_index, current.price, current.title)`,
		Candles: []Candle{{Time: 100, High: 7}},
	})
	if len(response.Errors) != 0 {
		t.Fatalf("named UDT compile errors: %+v", response.Errors)
	}
	if len(response.Result.Labels) != 1 || response.Result.Labels[0].Text != "named" || response.Result.Labels[0].Price != 7 {
		t.Fatalf("named UDT labels = %+v", response.Result.Labels)
	}

	defaultResponse := Compile(context.Background(), CompileRequest{
		SourceCode: `//@version=5
indicator("Default UDT", overlay=true)
type marker
    string title = "default"
    float price = 3
marker current = marker.new(title = "partial")
if barstate.islast
    label.new(bar_index, current.price, current.title)`,
		Candles: []Candle{{Time: 100, High: 7}},
	})
	if len(defaultResponse.Errors) != 0 {
		t.Fatalf("default UDT compile errors: %+v", defaultResponse.Errors)
	}
	if len(defaultResponse.Result.Labels) != 1 ||
		defaultResponse.Result.Labels[0].Text != "partial" ||
		defaultResponse.Result.Labels[0].Price != 3 {
		t.Fatalf("default UDT labels = %+v", defaultResponse.Result.Labels)
	}
}

func TestStatefulUDTConstructorRejectsInvalidFieldArguments(t *testing.T) {
	for name, constructor := range map[string]string{
		"unknown field":          `marker.new(missing = 1)`,
		"duplicate field":        `marker.new("first", title = "second")`,
		"too many arguments":     `marker.new("first", 2, 3)`,
		"positional after named": `marker.new(title = "first", 2)`,
	} {
		t.Run(name, func(t *testing.T) {
			response := Compile(context.Background(), CompileRequest{
				SourceCode: `//@version=5
indicator("Invalid UDT")
type marker
    string title = "default"
    float price = 1
marker current = ` + constructor,
				Candles: []Candle{{Time: 100, High: 7}},
			})
			if len(response.Errors) == 0 {
				t.Fatalf("invalid constructor compiled: %s", constructor)
			}
		})
	}
}

func TestStatefulColorCastNAProducesNA(t *testing.T) {
	expression, err := parseStatefulExpression("color(na)")
	if err != nil {
		t.Fatal(err)
	}
	vm := newStatefulVM(context.Background(), &statefulProgram{}, CompileRequest{}, []Candle{{Time: 1}})
	value, err := vm.evaluate(expression, vm.global)
	if err != nil {
		t.Fatal(err)
	}
	if value.kind != statefulValueNA {
		t.Fatalf("color(na) = %#v, want na", value)
	}
}

func TestExtractMetaReadsPositionalShortTitle(t *testing.T) {
	meta := ExtractMeta(`//@version=5
indicator("Main title", "Short title", overlay=true)
plot(close)`)
	if meta.Name != "Main title" || meta.ShortTitle != "Short title" || !meta.Overlay {
		t.Fatalf("metadata = %+v", meta)
	}
}

func TestExtractMetaPreservesPositionalIndicatorProperties(t *testing.T) {
	meta := ExtractMeta(`//@version=6
indicator("Main", "Short", true, format.percent, 3, scale.left, 250, "1D", false, true, 100, 200, 300, 400, 50, false, false)
plot(close)`)
	if meta.Name != "Main" || meta.ShortTitle != "Short" || !meta.Overlay || meta.Timeframe != "1D" || meta.Version != 6 {
		t.Fatalf("resolved metadata = %+v", meta)
	}
	wants := map[string]any{
		"title":                "Main",
		"shorttitle":           "Short",
		"overlay":              true,
		"format":               "format.percent",
		"precision":            3,
		"scale":                "scale.left",
		"max_bars_back":        250,
		"timeframe":            "1D",
		"timeframe_gaps":       false,
		"explicit_plot_zorder": true,
		"max_lines_count":      100,
		"max_labels_count":     200,
		"max_boxes_count":      300,
		"calc_bars_count":      400,
		"max_polylines_count":  50,
		"dynamic_requests":     false,
		"behind_chart":         false,
	}
	for key, want := range wants {
		if got := meta.Properties[key]; got != want {
			t.Fatalf("property %s = %#v, want %#v (all: %+v)", key, got, want, meta.Properties)
		}
	}
}

func TestExtractMetaMapsLegacyStudyResolution(t *testing.T) {
	meta := ExtractMeta(`//@version=4
study("Legacy", "L", false, format.price, 2, scale.right, 100, "60", false)
plot(close)`)
	if meta.Timeframe != "60" || meta.Properties["resolution"] != "60" || meta.Properties["resolution_gaps"] != false {
		t.Fatalf("legacy metadata = %+v", meta)
	}
}

func TestStatefulObjectLimitsSupportPositionalDeclarationArguments(t *testing.T) {
	program, err := parseStatefulProgram(`//@version=6
indicator("Limits", "L", true, format.inherit, 2, scale.right, 0, "", true, false, 12, 13, 14)
type marker
    bool active
`)
	if err != nil {
		t.Fatal(err)
	}
	if program.maxLines != 12 || program.maxLabels != 13 || program.maxBoxes != 14 {
		t.Fatalf("object limits = lines:%d labels:%d boxes:%d", program.maxLines, program.maxLabels, program.maxBoxes)
	}
	defaults, err := parseStatefulProgram(`indicator("Defaults")
type marker
    bool active`)
	if err != nil {
		t.Fatal(err)
	}
	if defaults.maxLines != 50 || defaults.maxLabels != 50 || defaults.maxBoxes != 50 {
		t.Fatalf("default object limits = lines:%d labels:%d boxes:%d", defaults.maxLines, defaults.maxLabels, defaults.maxBoxes)
	}
}

func TestCompileRejectsUnimplementedDeclarationExecutionProperties(t *testing.T) {
	for name, source := range map[string]string{
		"timeframe":        `indicator("HTF", timeframe="D"); plot(close)`,
		"timeframe gaps":   `indicator("Gaps", timeframe_gaps=false); plot(close)`,
		"calc bars count":  `indicator("Window", calc_bars_count=100); plot(close)`,
		"dynamic requests": `indicator("Requests", dynamic_requests=false); plot(close)`,
	} {
		t.Run(name, func(t *testing.T) {
			response := Compile(context.Background(), CompileRequest{
				SourceCode: source,
				Candles:    []Candle{{Time: 60, Open: 1, High: 2, Low: 0, Close: 1}},
			})
			if len(response.Errors) == 0 {
				t.Fatalf("property compiled without a compatibility diagnostic: %+v", response)
			}
		})
	}
}

func TestCompileReportsPineVersionCompatibilityBoundary(t *testing.T) {
	for name, source := range map[string]string{
		"missing annotation": `indicator("Legacy default")
plot(close)`,
		"legacy version": `//@version=4
study("Legacy")
plot(close)`,
		"v6 subset": `//@version=6
indicator("Current")
plot(close)`,
	} {
		t.Run(name, func(t *testing.T) {
			response := Compile(t.Context(), CompileRequest{
				SourceCode: source,
				Candles:    []Candle{{Time: 60, Close: 1}},
			})
			if len(response.Errors) != 0 || len(response.Warnings) == 0 {
				t.Fatalf("version compatibility response = %+v", response)
			}
		})
	}

	response := Compile(t.Context(), CompileRequest{
		SourceCode: `//@version=7
indicator("Future")
plot(close)`,
		Candles: []Candle{{Time: 60, Close: 1}},
	})
	if len(response.Errors) == 0 || len(response.UnsupportedFeatures) == 0 {
		t.Fatalf("future Pine version compiled silently: %+v", response)
	}
}
