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
	"SMA", "EMA", "VWAP", "RSI", "MACD", "ADR", "FVG", "SWING_SR",
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
	"RSI": {
		path:          "sources/rsi.pine",
		description:   "Momentum oscillator",
		configInputs:  map[string]string{"length": "length", "lineColor": "color"},
		inputAliases:  map[string]string{"length": "length"},
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
		description: "Average daily range levels",
		configInputs: map[string]string{
			"length": "length", "highColor": "color", "lowColor": "color2",
		},
		inputAliases:  map[string]string{"length": "length"},
		styleAliases:  map[string]string{"builtin:primary": "plot:1", "builtin:secondary": "plot:2"},
		styleDefaults: map[string]string{"plot:1": "highColor", "plot:2": "lowColor"},
		hiddenInputs:  map[string]bool{"highColor": true, "lowColor": true},
	},
	"SWING_SR": {
		path:        "sources/swing_sr.pine",
		description: "Confirmed pivot support and resistance segments",
		configInputs: map[string]string{
			"highLength": "length", "lowLength": "length2", "highColor": "color", "lowColor": "color2",
		},
		inputAliases: map[string]string{"length": "highLength", "length2": "lowLength"},
		styleFieldInputs: map[string]map[string]string{
			"builtin:primary": {
				"visible": "showHigh", "color": "highColor", "lineWidth": "highWidth", "lineStyle": "highStyleInput",
			},
			"builtin:secondary": {
				"visible": "showLow", "color": "lowColor", "lineWidth": "lowWidth", "lineStyle": "lowStyleInput",
			},
		},
		hiddenInputs: map[string]bool{
			"highColor": true, "lowColor": true, "showHigh": true, "showLow": true,
			"highWidth": true, "lowWidth": true, "highStyleInput": true, "lowStyleInput": true,
		},
		styles: []StyleDefinition{
			objectStyle("builtin:primary", "Swing high", "line", "#ef5350", 2, 1),
			objectStyle("builtin:secondary", "Swing low", "line", "#26c6da", 2, 1),
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
	return strings.Contains(normalizeSource(source), "request.security")
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
			Candles:        request.Candles,
			InputOverrides: runtimeNestedValues(config, "inputValues"),
			StyleOverrides: runtimeNestedValues(config, "styleValues"),
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
		Candles:        request.Candles,
		InputOverrides: inputs,
		StyleOverrides: styles,
	}, nil
}
