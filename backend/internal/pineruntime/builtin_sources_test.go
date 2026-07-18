package pineruntime

import (
	"strings"
	"testing"
)

func TestBuiltInPineCatalogIsCompleteAndHasParseableMetadata(t *testing.T) {
	if len(builtInPineCatalog) != len(builtInPineOrder) {
		t.Fatalf("catalog entries = %d, order entries = %d", len(builtInPineCatalog), len(builtInPineOrder))
	}
	seen := map[string]bool{}
	for _, indicatorType := range builtInPineOrder {
		if seen[indicatorType] {
			t.Fatalf("duplicate catalog order entry %q", indicatorType)
		}
		seen[indicatorType] = true
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

func TestIndicatorCatalogOwnsDynamicFrontendDefinition(t *testing.T) {
	catalog, err := builtInIndicatorCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.Indicators) != len(builtInPineOrder) {
		t.Fatalf("catalog definitions = %d, want %d", len(catalog.Indicators), len(builtInPineOrder))
	}
	for index, definition := range catalog.Indicators {
		if definition.Type != builtInPineOrder[index] || definition.Name == "" || definition.Description == "" {
			t.Fatalf("definition %d = %+v", index, definition)
		}
		if definition.Type == "ADR" && !definition.RequiresHistoryContext {
			t.Fatalf("ADR must request backend-declared history context: %+v", definition)
		}
		for _, input := range definition.Inputs {
			if input.Key == "lineColor" || input.Key == "bullCss" || input.Key == "showHigh" {
				t.Fatalf("style-owned input leaked into generic Inputs UI: %s/%s", definition.Type, input.Key)
			}
		}
	}
	if catalog.Indicators[0].Shortcut != "primary" {
		t.Fatalf("catalog shortcut = %q", catalog.Indicators[0].Shortcut)
	}
	byType := map[string]IndicatorDefinition{}
	for _, definition := range catalog.Indicators {
		byType[definition.Type] = definition
	}
	macd := byType["MACD"]
	if macd.LegacyInputBindings["fastLength"] != "length" || macd.LegacyInputBindings["slowLength"] != "length3" {
		t.Fatalf("MACD legacy input bindings = %+v", macd.LegacyInputBindings)
	}
	fvg := byType["FVG"]
	if fvg.LegacyStyleBindings["builtin:fvg-bull.color"] != "color" || fvg.LegacyStyleBindings["builtin:fvg-bear.color"] != "color2" {
		t.Fatalf("FVG legacy style bindings = %+v", fvg.LegacyStyleBindings)
	}
}

func TestUserSourceAndBuiltInResolveToSameDefinitionShape(t *testing.T) {
	source := `//@version=5
indicator("User MA", overlay=true)
period = input.int(7, "Period")
plot(ta.sma(close, period), "Average", color=#123456)`
	user, err := indicatorDefinition(IndicatorDefinitionRequest{IndicatorType: "saved:42", SourceCode: source})
	if err != nil {
		t.Fatal(err)
	}
	builtIn, err := indicatorDefinition(IndicatorDefinitionRequest{IndicatorType: "SMA"})
	if err != nil {
		t.Fatal(err)
	}
	if user.Type != "saved:42" || !user.SourceAvailable || user.Name != "User MA" || len(user.Inputs) != 1 || len(user.Styles) != 1 {
		t.Fatalf("user definition = %+v", user)
	}
	if builtIn.Type != "SMA" || builtIn.SourceAvailable || len(builtIn.Inputs) != 1 || len(builtIn.Styles) != 1 {
		t.Fatalf("built-in definition = %+v", builtIn)
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

func TestBuiltInCompileRequestAcceptsDefinitionNativeInputKeys(t *testing.T) {
	request, err := builtInCompileRequest(IndicatorRuntimeRequest{
		IndicatorType: "MACD",
		Config: map[string]any{"inputValues": map[string]any{
			"fastLength": 6, "slowLength": 18, "signalLength": 4,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]InputValue{"fastLength": 6, "slowLength": 18, "signalLength": 4} {
		if got := request.InputOverrides[key]; got != want {
			t.Fatalf("%s = %#v, want %#v", key, got, want)
		}
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

func TestLegacySwingTypeIsNoLongerCataloged(t *testing.T) {
	if _, err := builtInIndicatorDefinition("SWING_SR"); err == nil {
		t.Fatal("legacy SWING_SR unexpectedly remains in the active catalog")
	}
	if _, err := builtInCompileRequest(IndicatorRuntimeRequest{IndicatorType: "SWING_SR"}); err == nil {
		t.Fatal("legacy SWING_SR unexpectedly remains executable")
	}
}

func TestEveryDeclaredPineSourceRequestsHistoryContext(t *testing.T) {
	for _, source := range []string{
		`indicator("RSI"); plot(ta.rsi(close, 14))`,
		`indicator("Cross"); plot(ta.crossover(close, open) ? 1 : 0)`,
		`indicator("Positional history", "PH", false, format.inherit, 2, scale.right, 250); plot(close)`,
		`indicator("Stateful"); var int count = 0; count += close > open ? 1 : 0; plot(count)`,
		`indicator("Pointwise"); plot(math.abs(close))`,
	} {
		if !pineSourceNeedsHistoryContext(source) {
			t.Fatalf("history-sensitive source was not detected: %s", source)
		}
	}
	if pineSourceNeedsHistoryContext("") {
		t.Fatal("empty source unexpectedly requires history context")
	}
}
