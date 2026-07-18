package pineruntime

import (
	"context"
	"strings"
	"testing"
)

func TestStatefulLabelPreservesStyleTooltipAndLineBreaks(t *testing.T) {
	source := `//@version=5
indicator("Label metadata", overlay=true)
type marker
    bool active
if bar_index == 1
    label.new(bar_index, high, "A\nB", color=color.new(color.black, 100), style=label.style_label_down, textcolor=color.red, tooltip="tip\nline")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "label-metadata",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1, Volume: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2, Volume: 1},
			{Time: 180, Open: 3, High: 4, Low: 2, Close: 3, Volume: 1},
		},
	})
	if len(result.Errors) != 0 {
		t.Fatalf("compile errors: %+v", result.Errors)
	}
	if len(result.Result.Labels) != 1 {
		t.Fatalf("labels = %+v", result.Result.Labels)
	}
	label := result.Result.Labels[0]
	if label.Style != "label.style_label_down" {
		t.Fatalf("style = %q", label.Style)
	}
	if label.Tooltip != "tip\nline" {
		t.Fatalf("tooltip = %q", label.Tooltip)
	}
	if label.Text != "A\nB" || !strings.Contains(label.Text, "\n") {
		t.Fatalf("multiline text = %q", label.Text)
	}
	if label.BackgroundColor == "" {
		t.Fatal("explicit transparent label background was lost")
	}
}

func TestVectorLabelPreservesStyleAndTooltip(t *testing.T) {
	source := `//@version=5
indicator("Vector label", overlay=true)
smooth = ta.sma(close, 2)
lbl = label.new(bar_index, high, "A\nB", color=color.new(color.black, 100), style=label.style_label_up, textcolor=color.teal, tooltip="tip\nline")
`
	if statefulSourceCandidate(source) {
		t.Fatal("fixture unexpectedly selected the stateful VM")
	}
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "vector-label-metadata",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1, Volume: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2, Volume: 1},
		},
	})
	if len(result.Errors) != 0 {
		t.Fatalf("compile errors: %+v", result.Errors)
	}
	if len(result.Result.Labels) != 2 {
		t.Fatalf("top-level label constructor should execute on every bar: %+v", result.Result.Labels)
	}
	for _, label := range result.Result.Labels {
		if label.Style != "label.style_label_up" || label.Tooltip != "tip\nline" || label.Text != "A\nB" {
			t.Fatalf("label metadata = %+v", label)
		}
	}
	if result.Result.Labels[0].Time == nil || *result.Result.Labels[0].Time != 60 ||
		result.Result.Labels[1].Time == nil || *result.Result.Labels[1].Time != 120 {
		t.Fatalf("label anchors moved away from their creation bars: %+v", result.Result.Labels)
	}
}

func TestVectorSparseLabelConstructorSamplesMetadataAtCreationBar(t *testing.T) {
	source := `//@version=5
indicator("Sparse vector label", overlay=true)
smooth = ta.sma(close, 2)
if close > open
    label.new(bar_index, high, close > open ? "up" : "down", color=close > open ? color.green : color.red)
`
	if statefulSourceCandidate(source) {
		t.Fatal("fixture unexpectedly selected the stateful VM")
	}
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "sparse-vector-label-metadata",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 3, Low: 0, Close: 2},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 1},
			{Time: 180, Open: 3, High: 5, Low: 2, Close: 4},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 2 {
		t.Fatalf("sparse labels = %+v", result)
	}
	for index, label := range result.Result.Labels {
		if label.Text != "up" || label.BackgroundColor != "#4caf50" {
			t.Fatalf("label %d sampled metadata after its creation bar: %+v", index, label)
		}
	}
}

func TestVectorMultilineLabelConstructorIsDiscovered(t *testing.T) {
	source := `//@version=5
indicator("Multiline vector label", overlay=true)
if close > open
    label.new(bar_index, high
      , "up"
      , color=color(na)
      , textcolor=color.green)
`
	if statefulSourceCandidate(source) {
		t.Fatal("fixture unexpectedly selected the stateful VM")
	}
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "multiline-vector-label",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 3, Low: 0, Close: 2},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 1},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 1 {
		t.Fatalf("multiline vector label = %+v", result)
	}
	if result.Result.Labels[0].Text != "up" || result.Result.Labels[0].Color != "#4caf50" {
		t.Fatalf("multiline label metadata = %+v", result.Result.Labels[0])
	}
}

func TestVectorLabelSetterScriptDoesNotRegressToStatefulVM(t *testing.T) {
	source := `//@version=5
indicator("Vector label setters", overlay=true)
strength = ta.rsi(close, 2)
lbl = label.new(bar_index, high, "old")
label.set_text (
  lbl
  , "new")
`
	if statefulSourceCandidate(source) {
		t.Fatal("label setter fixture unexpectedly selected the stateful VM")
	}
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "vector-label-setters",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1, Volume: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2, Volume: 1},
			{Time: 180, Open: 3, High: 4, Low: 2, Close: 3, Volume: 1},
		},
	})
	if len(result.Errors) != 0 {
		t.Fatalf("compile errors: %+v", result.Errors)
	}
	if len(result.Result.Labels) != 3 || result.Result.Labels[0].Text != "new" {
		t.Fatalf("label setter output = %+v", result.Result.Labels)
	}
}

func TestVectorVarLabelConstructorRunsOnce(t *testing.T) {
	source := `//@version=5
indicator("Persistent label", overlay=true)
smooth = ta.sma(close, 2)
var label lbl = label.new(bar_index, high, "once")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "persistent-vector-label",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2},
			{Time: 180, Open: 3, High: 4, Low: 2, Close: 3},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 1 {
		t.Fatalf("persistent vector label result = %+v", result)
	}
}

func TestVectorLabelConstructorHonorsDeclarationLimit(t *testing.T) {
	source := `//@version=5
indicator("Limited labels", overlay=true, max_labels_count=2)
smooth = ta.sma(close, 2)
label.new(bar_index, high, "limited")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "limited-vector-label",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2},
			{Time: 180, Open: 3, High: 4, Low: 2, Close: 3},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 2 {
		t.Fatalf("limited vector label result = %+v", result)
	}
	if result.Result.Labels[0].Time == nil || *result.Result.Labels[0].Time != 120 {
		t.Fatalf("label limit did not retain the newest objects: %+v", result.Result.Labels)
	}
}

func TestVectorObjectLimitUsesGlobalPerBarCreationOrder(t *testing.T) {
	source := `//@version=5
indicator("Interleaved labels", overlay=true, max_labels_count=4)
smooth = ta.sma(close, 2)
label.new(bar_index, high, "A")
label.new(bar_index, low, "B")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "interleaved-vector-labels",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2},
			{Time: 180, Open: 3, High: 4, Low: 2, Close: 3},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 4 {
		t.Fatalf("interleaved vector labels = %+v", result)
	}
	wants := []struct {
		time int64
		text string
	}{{120, "A"}, {120, "B"}, {180, "A"}, {180, "B"}}
	for index, want := range wants {
		label := result.Result.Labels[index]
		if label.Time == nil || *label.Time != want.time || label.Text != want.text {
			t.Fatalf("label %d = %+v, want %+v", index, label, want)
		}
	}
}

func TestVectorTopLevelLineDoesNotGainSyntheticRightExtension(t *testing.T) {
	source := `//@version=5
indicator("Per-bar lines", overlay=true, max_lines_count=10)
smooth = ta.sma(close, 2)
line.new(bar_index, low, bar_index + 1, high)
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "per-bar-vector-lines",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2},
			{Time: 180, Open: 3, High: 4, Low: 2, Close: 3},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Series) != 3 {
		t.Fatalf("per-bar vector lines = %+v", result)
	}
	last := result.Result.Series[len(result.Result.Series)-1]
	if len(last.Data) != 2 || last.Data[len(last.Data)-1].Time != 240 {
		t.Fatalf("latest line received an artificial extension: %+v", last)
	}
}

func TestVectorObjectElseBranchUsesComplementaryCondition(t *testing.T) {
	source := `//@version=5
indicator("Branch labels", overlay=true)
smooth = ta.sma(close, 2)
if close > open
    label.new(bar_index, high, "up")
else
    label.new(bar_index, low, "down")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "branch-vector-labels",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 3, Low: 0, Close: 2},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 1},
			{Time: 180, Open: 3, High: 5, Low: 2, Close: 4},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 3 {
		t.Fatalf("branch labels = %+v", result)
	}
	wants := []string{"up", "down", "up"}
	for index, want := range wants {
		if result.Result.Labels[index].Text != want {
			t.Fatalf("label %d = %+v, want %q", index, result.Result.Labels[index], want)
		}
	}
}

func TestVectorChainedElseIfBranchesRemainMutuallyExclusive(t *testing.T) {
	source := `//@version=5
indicator("Chained branch labels", overlay=true)
smooth = ta.sma(close, 2)
if close > open
    label.new(bar_index, high, "up")
else if close < open
    label.new(bar_index, low, "down")
else
    label.new(bar_index, close, "flat")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "chained-branch-vector-labels",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 3, Low: 0, Close: 2},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 1},
			{Time: 180, Open: 2, High: 3, Low: 1, Close: 2},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 3 {
		t.Fatalf("chained branch labels = %+v", result)
	}
	wants := []string{"up", "down", "flat"}
	for index, want := range wants {
		if result.Result.Labels[index].Text != want {
			t.Fatalf("label %d = %+v, want %q", index, result.Result.Labels[index], want)
		}
	}
}

func TestVectorNestedObjectBranchesRequireEveryAncestor(t *testing.T) {
	source := `//@version=5
indicator("Nested branch labels", overlay=true)
smooth = ta.sma(close, 2)
if close > open
    if high > 0
        label.new(bar_index, high, "nested")
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "nested-branch-vector-labels",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 3, Low: 0, Close: 2},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 1},
			{Time: 180, Open: 3, High: 5, Low: 2, Close: 4},
		},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 2 {
		t.Fatalf("nested branch labels = %+v", result)
	}
	if result.Result.Labels[0].Time == nil || result.Result.Labels[1].Time == nil ||
		*result.Result.Labels[0].Time != 60 || *result.Result.Labels[1].Time != 180 {
		t.Fatalf("outer-false bar created a nested object: %+v", result.Result.Labels)
	}
}

func TestStatefulOmittedColorsKeepPineDefaults(t *testing.T) {
	source := `//@version=5
indicator("Object color defaults", overlay=true)
type marker
    bool active
if bar_index == 0
    label.new(bar_index, high, "default")
    line.new(bar_index, low, bar_index + 1, high)
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "object-color-defaults",
		SourceCode: source,
		Candles: []Candle{
			{Time: 60, Open: 1, High: 2, Low: 0, Close: 1, Volume: 1},
			{Time: 120, Open: 2, High: 3, Low: 1, Close: 2, Volume: 1},
		},
	})
	if len(result.Errors) != 0 {
		t.Fatalf("compile errors: %+v", result.Errors)
	}
	if len(result.Result.Labels) != 1 || result.Result.Labels[0].Color != "#ffffff" || result.Result.Labels[0].BackgroundColor != "#2196f3" || result.Result.Labels[0].Style != "label.style_label_down" {
		t.Fatalf("default label colors = %+v", result.Result.Labels)
	}
	if len(result.Result.Series) != 1 || result.Result.Series[0].Color != defaultColors[0] {
		t.Fatalf("default line colors = %+v", result.Result.Series)
	}
}

func TestVectorOmittedLabelAndPlotColorsUsePineDefaults(t *testing.T) {
	source := `//@version=5
indicator("Vector defaults", overlay=true)
label.new(bar_index, high, "default")
plot(close)
`
	result := Compile(context.Background(), CompileRequest{
		ScriptID:   "vector-default-colors",
		SourceCode: source,
		Candles:    []Candle{{Time: 60, Open: 1, High: 2, Low: 0, Close: 1}},
	})
	if len(result.Errors) != 0 || len(result.Result.Labels) != 1 || len(result.Result.Series) != 1 {
		t.Fatalf("vector defaults = %+v", result)
	}
	label := result.Result.Labels[0]
	if label.Color != "#ffffff" || label.BackgroundColor != "#2196f3" || label.Style != "label.style_label_down" {
		t.Fatalf("vector label defaults = %+v", label)
	}
	if result.Result.Series[0].Color != defaultColors[0] {
		t.Fatalf("vector plot default color = %+v", result.Result.Series[0])
	}
}
