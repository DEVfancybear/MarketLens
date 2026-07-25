package pineruntime

import (
	"embed"
	"fmt"
	"strings"
)

// Built-ins are catalog entries, not alternate calculators. Their Pine source
// is compiled by the same Compile pipeline used for saved/public user scripts.
// The catalog only maps the legacy chart configuration fields to Pine inputs
// and plot style identifiers.

//go:embed sources/*.pine
var builtInPineFS embed.FS

type builtInPineDefinition struct {
	path             string
	description      string
	shortcut         string
	configInputs     map[string]string
	inputAliases     map[string]string
	styleAliases     map[string]string
	styleColorInputs map[string]string
	styleFieldInputs map[string]map[string]string
	styleDefaults    map[string]string
	hiddenInputs     map[string]bool
	styles           []StyleDefinition
}

var builtInPineOrder = []string{
	"SMA", "EMA", "VWAP", "VSA", "RSI", "MACD", "ADR", "FVG",
}

func objectStyle(key, title, target, color string, width, lineStyle int) StyleDefinition {
	definition := StyleDefinition{
		Key: key, Title: title, Target: target, Group: "Style",
		DefaultVisible: true, DefaultColor: color, SupportsColor: true,
	}
	if width > 0 {
		definition.DefaultLineWidth = intPtr(width)
		definition.SupportsLineWidth = true
	}
	if lineStyle >= 0 {
		definition.DefaultLineStyle = intPtr(lineStyle)
		definition.SupportsLineStyle = true
	}
	return definition
}

var builtInPineCatalog = map[string]builtInPineDefinition{
	"SMA": {
		path:          "sources/sma.pine",
		description:   "Simple moving average",
		shortcut:      "primary",
		configInputs:  map[string]string{"length": "length", "lineColor": "color"},
		inputAliases:  map[string]string{"length": "length"},
		styleAliases:  map[string]string{"builtin:primary": "plot:1"},
		styleDefaults: map[string]string{"plot:1": "lineColor"},
		hiddenInputs:  map[string]bool{"lineColor": true},
	},
	"EMA": {
		path:          "sources/ema.pine",
		description:   "Exponential moving average",
		configInputs:  map[string]string{"length": "length", "lineColor": "color"},
		inputAliases:  map[string]string{"length": "length"},
		styleAliases:  map[string]string{"builtin:primary": "plot:1"},
		styleDefaults: map[string]string{"plot:1": "lineColor"},
		hiddenInputs:  map[string]bool{"lineColor": true},
	},
	"VWAP": {
		path:          "sources/vwap.pine",
		description:   "Session anchored volume-weighted average price",
		configInputs:  map[string]string{"lineColor": "color"},
		styleAliases:  map[string]string{"builtin:primary": "plot:1"},
		styleDefaults: map[string]string{"plot:1": "lineColor"},
		hiddenInputs:  map[string]bool{"lineColor": true},
	},
	"VSA": {
		path:         "sources/vsa.pine",
		description:  "Wyckoff volume classification with per-bar volume palette",
		configInputs: map[string]string{"lengthVolumeMA": "length"},
		inputAliases: map[string]string{"length": "lengthVolumeMA"},
		styleAliases: map[string]string{"builtin:primary": "plot:1", "builtin:secondary": "plot:2"},
	},
	"RSI": {
		path:          "sources/rsi.pine",
		description:   "Better RSI oscillator with reference bands, overbought/oversold emphasis, and cycler state",
		configInputs:  map[string]string{"myPeriod": "length", "lineColor": "color"},
		inputAliases:  map[string]string{"length": "myPeriod"},
		styleAliases:  map[string]string{"builtin:primary": "plot:1"},
		styleDefaults: map[string]string{"plot:1": "lineColor"},
		hiddenInputs:  map[string]bool{"lineColor": true},
	},
	"MACD": {
		path:        "sources/macd.pine",
		description: "Trend and momentum oscillator",
		configInputs: map[string]string{
			"fastLength": "length", "slowLength": "length3", "signalLength": "length2",
			"macdColor": "color", "signalColor": "color2",
		},
		inputAliases: map[string]string{
			"length": "fastLength", "length3": "slowLength", "length2": "signalLength",
		},
		styleAliases:  map[string]string{"builtin:primary": "plot:1", "builtin:secondary": "plot:2"},
		styleDefaults: map[string]string{"plot:1": "macdColor", "plot:2": "signalColor"},
		hiddenInputs:  map[string]bool{"macdColor": true, "signalColor": true},
	},
	"ADR": {
		path:        "sources/adr.pine",
		description: "ADR 50 support/resistance levels, zones, labels, distances, and dashboard",
		configInputs: map[string]string{
			"adrPeriod": "length", "colHigh": "color", "colLow": "color2",
		},
		inputAliases: map[string]string{"length": "adrPeriod"},
		styleColorInputs: map[string]string{
			"builtin:adr-high": "colHigh",
			"builtin:adr-low":  "colLow",
		},
		styleFieldInputs: map[string]map[string]string{
			"builtin:adr-high": {"lineWidth": "lineWidth"},
			"builtin:adr-low":  {"lineWidth": "lineWidth"},
		},
		hiddenInputs: map[string]bool{"colHigh": true, "colLow": true, "lineWidth": true},
		styles: []StyleDefinition{
			objectStyle("builtin:adr-high", "ADR H50", "line", "#f44336", 2, 0),
			objectStyle("builtin:adr-low", "ADR L50", "line", "#4caf50", 2, 0),
		},
	},
	"FVG": {
		path:        "sources/fvg_luxalgo.pine",
		description: "Threshold, mitigation, dynamic fair-value-gap zones, and dashboard",
		configInputs: map[string]string{
			"bullCss": "color", "bearCss": "color2",
		},
		inputAliases: map[string]string{"timeframe": "tf"},
		styleColorInputs: map[string]string{
			"builtin:fvg-bull": "bullCss",
			"builtin:fvg-bear": "bearCss",
		},
		hiddenInputs: map[string]bool{"bullCss": true, "bearCss": true},
		styles: []StyleDefinition{
			objectStyle("builtin:fvg-bull", "Bullish FVG", "box", "#089981", 0, -1),
			objectStyle("builtin:fvg-bear", "Bearish FVG", "box", "#f23645", 0, -1),
		},
	},
}

func builtInPineSource(indicatorType string) (string, bool, error) {
	definition, ok := builtInPineCatalog[strings.ToUpper(strings.TrimSpace(indicatorType))]
	if !ok {
		return "", false, nil
	}
	source, err := builtInPineFS.ReadFile(definition.path)
	if err != nil {
		return "", true, fmt.Errorf("load built-in Pine source %q: %w", definition.path, err)
	}
	return string(source), true, nil
}

func indicatorDefinition(request IndicatorDefinitionRequest) (IndicatorDefinition, error) {
	source := strings.TrimSpace(request.SourceCode)
	typeName := strings.TrimSpace(request.IndicatorType)
	if source == "" {
		return builtInIndicatorDefinition(typeName)
	}
	if len(source) > maxSourceBytes {
		return IndicatorDefinition{}, fmt.Errorf("Pine source exceeds %d bytes", maxSourceBytes)
	}
	if typeName == "" {
		typeName = "CUSTOM"
	}
	meta := ExtractMeta(source)
	return IndicatorDefinition{
		Type:                   typeName,
		Name:                   meta.Name,
		ShortTitle:             meta.ShortTitle,
		Description:            "User Pine script",
		Overlay:                meta.Overlay,
		Timeframe:              meta.Timeframe,
		Version:                meta.Version,
		Properties:             meta.Properties,
		Inputs:                 ExtractInputs(source),
		Styles:                 ExtractStyles(source),
		RequiresHistoryContext: pineSourceNeedsHistoryContext(source),
		SourceAvailable:        true,
	}, nil
}

func builtInIndicatorDefinition(indicatorType string) (IndicatorDefinition, error) {
	typeName := strings.ToUpper(strings.TrimSpace(indicatorType))
	definition, ok := builtInPineCatalog[typeName]
	if !ok {
		return IndicatorDefinition{}, fmt.Errorf("unsupported indicator %q", strings.TrimSpace(indicatorType))
	}
	source, _, err := builtInPineSource(typeName)
	if err != nil {
		return IndicatorDefinition{}, err
	}
	meta := ExtractMeta(source)
	extractedInputs := ExtractInputs(source)
	inputs := make([]InputDefinition, 0, len(extractedInputs))
	inputDefaults := make(map[string]InputValue, len(extractedInputs))
	for _, input := range extractedInputs {
		inputDefaults[input.Key] = input.DefaultValue
		if !definition.hiddenInputs[input.Key] {
			inputs = append(inputs, input)
		}
	}
	styles := append([]StyleDefinition(nil), definition.styles...)
	if len(styles) == 0 {
		styles = ExtractStyles(source)
	}
	for index := range styles {
		compiledKey := styles[index].Key
		inputKey := definition.styleDefaults[compiledKey]
		if value, exists := inputDefaults[inputKey]; exists {
			styles[index].DefaultColor = strings.TrimSpace(fmt.Sprint(value))
		}
		styles[index].Key = externalBuiltInStyleKey(definition, compiledKey)
	}
	legacyInputs := map[string]string{}
	for inputKey, configKey := range definition.configInputs {
		if !definition.hiddenInputs[inputKey] {
			legacyInputs[inputKey] = configKey
		}
	}
	legacyStyles := map[string]string{}
	for compiledStyle, inputKey := range definition.styleDefaults {
		if configKey := definition.configInputs[inputKey]; configKey != "" {
			legacyStyles[styleFieldKey(externalBuiltInStyleKey(definition, compiledStyle), "color")] = configKey
		}
	}
	for style, inputKey := range definition.styleColorInputs {
		if configKey := definition.configInputs[inputKey]; configKey != "" {
			legacyStyles[styleFieldKey(style, "color")] = configKey
		}
	}
	for style, fields := range definition.styleFieldInputs {
		for field, inputKey := range fields {
			if configKey := definition.configInputs[inputKey]; configKey != "" {
				legacyStyles[styleFieldKey(style, field)] = configKey
			}
		}
	}
	return IndicatorDefinition{
		Type:                   typeName,
		Name:                   meta.Name,
		ShortTitle:             meta.ShortTitle,
		Description:            definition.description,
		Overlay:                meta.Overlay,
		Timeframe:              meta.Timeframe,
		Version:                meta.Version,
		Properties:             meta.Properties,
		Inputs:                 inputs,
		Styles:                 styles,
		LegacyInputBindings:    legacyInputs,
		LegacyStyleBindings:    legacyStyles,
		RequiresHistoryContext: pineSourceNeedsHistoryContext(source),
		Shortcut:               definition.shortcut,
	}, nil
}

func externalBuiltInStyleKey(definition builtInPineDefinition, compiledKey string) string {
	for legacy, compiled := range definition.styleAliases {
		if compiled == compiledKey {
			return legacy
		}
	}
	return compiledKey
}

func builtInIndicatorCatalog() (IndicatorCatalogResponse, error) {
	response := IndicatorCatalogResponse{
		Indicators: make([]IndicatorDefinition, 0, len(builtInPineOrder)),
		Errors:     []RuntimeError{},
	}
	for _, typeName := range builtInPineOrder {
		definition, err := builtInIndicatorDefinition(typeName)
		if err != nil {
			return IndicatorCatalogResponse{}, err
		}
		response.Indicators = append(response.Indicators, definition)
	}
	return response, nil
}

func pineSourceNeedsHistoryContext(source string) bool {
	cleaned := normalizeSource(source)
	if strings.TrimSpace(cleaned) == "" {
		return false
	}
	// Pine's execution model starts at the beginning of the accessible dataset,
	// not at the viewport. Even a source with no obvious ta.* call can depend on
	// earlier bars through `var`, mutable objects, bar_index, a UDF, or a future
	// language feature the detector does not know yet. Prefer a bounded warm-up
	// fetch for every declared script over a false negative that resets state.
	return len(findCallBodies(cleaned, "indicator")) > 0 || len(findCallBodies(cleaned, "study")) > 0
}

func indicatorSourceCode(request IndicatorRuntimeRequest) string {
	if source := strings.TrimSpace(request.SourceCode); source != "" {
		return source
	}
	if source, ok := request.Config["sourceCode"].(string); ok {
		return strings.TrimSpace(source)
	}
	return ""
}

func indicatorCompileRequest(request IndicatorRuntimeRequest) (CompileRequest, error) {
	if source := indicatorSourceCode(request); source != "" {
		if len(source) > maxSourceBytes {
			return CompileRequest{}, fmt.Errorf("Pine source exceeds %d bytes", maxSourceBytes)
		}
		config := runtimeConfigForKey(request.Config)
		return CompileRequest{
			ScriptID:       runtimeResultID(request.IndicatorID, "indicator"),
			SourceCode:     source,
			Timeframe:      request.Timeframe,
			Symbol:         request.Symbol,
			SymbolType:     request.SymbolType,
			Mintick:        request.Mintick,
			Timezone:       request.Timezone,
			Candles:        request.Candles,
			InputOverrides: runtimeNestedValues(config, "inputValues"),
			StyleOverrides: runtimeNestedValues(config, "styleValues"),
			ReplayCutoff:   request.ReplayCutoff,
		}, nil
	}
	return builtInCompileRequest(request)
}

func builtInCompileRequest(request IndicatorRuntimeRequest) (CompileRequest, error) {
	typeName := strings.ToUpper(strings.TrimSpace(request.IndicatorType))
	definition, ok := builtInPineCatalog[typeName]
	if !ok {
		return CompileRequest{}, fmt.Errorf("unsupported built-in indicator %q", typeName)
	}
	source, _, err := builtInPineSource(typeName)
	if err != nil {
		return CompileRequest{}, err
	}
	config := runtimeConfigForKey(request.Config)
	inputs := map[string]InputValue{}
	for inputName, configKey := range definition.configInputs {
		if value, exists := config[configKey]; exists && value != nil {
			if typeName == "FVG" && (inputName == "bullCss" || inputName == "bearCss") {
				value = withTransparency(strings.TrimSpace(fmt.Sprint(value)), 70)
			}
			inputs[inputName] = value
		}
	}
	for key, value := range runtimeNestedValues(config, "inputValues") {
		inputName := key
		if alias, exists := definition.inputAliases[key]; exists {
			inputName = alias
		}
		inputs[inputName] = value
	}

	styles := map[string]InputValue{}
	for key, value := range runtimeNestedValues(config, "styleValues") {
		mapped := key
		for legacy, compiled := range definition.styleAliases {
			if key == legacy || strings.HasPrefix(key, legacy+".") {
				mapped = compiled + strings.TrimPrefix(key, legacy)
				break
			}
		}
		styles[mapped] = value
	}
	for style, inputName := range definition.styleColorInputs {
		if value, exists := styles[styleFieldKey(style, "color")]; exists {
			if typeName == "FVG" {
				value = withTransparency(strings.TrimSpace(fmt.Sprint(value)), 70)
			}
			inputs[inputName] = value
		}
		if value, exists := styles[styleFieldKey(style, "visible")]; exists && !runtimeStyleBool(map[string]InputValue{"visible": value}, "visible", true) {
			inputs[inputName] = "rgba(0, 0, 0, 0)"
		}
	}
	for style, fields := range definition.styleFieldInputs {
		for field, inputName := range fields {
			if value, exists := styles[styleFieldKey(style, field)]; exists {
				inputs[inputName] = value
			}
		}
	}

	return CompileRequest{
		ScriptID:       runtimeResultID(request.IndicatorID, "builtin"),
		SourceCode:     source,
		Timeframe:      request.Timeframe,
		Symbol:         request.Symbol,
		SymbolType:     request.SymbolType,
		Mintick:        request.Mintick,
		Timezone:       request.Timezone,
		Candles:        request.Candles,
		InputOverrides: inputs,
		StyleOverrides: styles,
		ReplayCutoff:   request.ReplayCutoff,
	}, nil
}
