package pineruntime

import (
	"strings"
	"testing"
)

func TestBuiltInPineCatalogIsCompleteAndHasParseableMetadata(t *testing.T) {
	expected := []string{"SMA", "EMA", "VWAP", "RSI", "MACD", "ADR", "SWING_SR", "FVG"}
	if len(builtInPineCatalog) != len(expected) {
		t.Fatalf("catalog entries = %d, want %d", len(builtInPineCatalog), len(expected))
	}
	for _, indicatorType := range expected {
		source, ok, err := builtInPineSource(indicatorType)
		if err != nil {
			t.Fatalf("%s source: %v", indicatorType, err)
		}
		if !ok || !strings.Contains(source, "indicator(") {
			t.Fatalf("%s is not backed by Pine indicator source", indicatorType)
		}
		if meta := ExtractMeta(source); strings.TrimSpace(meta.Name) == "" {
			t.Fatalf("%s source metadata has no name", indicatorType)
		}
	}
}

func TestBuiltInCompileRequestMapsLegacyConfigToPineInputsAndStyles(t *testing.T) {
	request, err := builtInCompileRequest(IndicatorRuntimeRequest{
		IndicatorType: "MACD",
		IndicatorID:   "  chart-macd  ",
		Timeframe:     "5m",
		Config: map[string]any{
			"length": 8, "length2": 5, "length3": 21,
			"color": "#111111", "color2": "#222222",
			"styleValues": map[string]any{
				"builtin:primary.visible": false,
				"builtin:secondary.color": "#abcdef",
				"__output.precision":      4,
			},
		},
		Candles: sampleCandles(3),
	})
	if err != nil {
		t.Fatal(err)
	}
	if request.ScriptID != "chart-macd" || request.Timeframe != "5m" || len(request.Candles) != 3 {
		t.Fatalf("request identity/context not preserved: %+v", request)
	}
	wants := map[string]InputValue{
		"fastLength": 8, "signalLength": 5, "slowLength": 21,
		"macdColor": "#111111", "signalColor": "#222222",
	}
	for key, want := range wants {
		if got := request.InputOverrides[key]; got != want {
			t.Fatalf("input %s = %#v, want %#v", key, got, want)
		}
	}
	if got := request.StyleOverrides["plot:1.visible"]; got != false {
		t.Fatalf("primary visibility = %#v", got)
	}
	if got := request.StyleOverrides["plot:2.color"]; got != "#abcdef" {
		t.Fatalf("secondary color = %#v", got)
	}
	if got := request.StyleOverrides["__output.precision"]; got != 4 {
		t.Fatalf("common output style = %#v", got)
	}
}

func TestFVGDefinitionUsesGenericPineFeaturesAndPreservesAttribution(t *testing.T) {
	source, ok, err := builtInPineSource("FVG")
	if err != nil || !ok {
		t.Fatalf("FVG source: ok=%v err=%v", ok, err)
	}
	for _, fragment := range []string{
		"CC BY-NC-SA", "© LuxAlgo", "type fvg", "request.security(",
		"array.new<fvg>", "box.new(", "line.new(", "table.new(",
	} {
		if !strings.Contains(source, fragment) {
			t.Fatalf("FVG Pine source missing %q", fragment)
		}
	}
}

func TestSwingObjectStylesMapToPineInputs(t *testing.T) {
	request, err := builtInCompileRequest(IndicatorRuntimeRequest{
		IndicatorType: "SWING_SR",
		Config: map[string]any{
			"styleValues": map[string]any{
				"builtin:primary.visible":   false,
				"builtin:primary.lineWidth": 4,
				"builtin:primary.lineStyle": 2,
				"builtin:primary.color":     "#123456",
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]InputValue{
		"showHigh": false, "highWidth": 4, "highStyleInput": 2, "highColor": "#123456",
	} {
		if got := request.InputOverrides[key]; got != want {
			t.Fatalf("%s = %#v, want %#v", key, got, want)
		}
	}
}
