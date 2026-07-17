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
	configInputs     map[string]string
	inputAliases     map[string]string
	styleAliases     map[string]string
	styleColorInputs map[string]string
	styleFieldInputs map[string]map[string]string
}

var builtInPineCatalog = map[string]builtInPineDefinition{
	"SMA": {
		path:         "sources/sma.pine",
		configInputs: map[string]string{"length": "length", "lineColor": "color"},
		styleAliases: map[string]string{"builtin:primary": "plot:1"},
	},
	"EMA": {
		path:         "sources/ema.pine",
		configInputs: map[string]string{"length": "length", "lineColor": "color"},
		styleAliases: map[string]string{"builtin:primary": "plot:1"},
	},
	"VWAP": {
		path:         "sources/vwap.pine",
		configInputs: map[string]string{"lineColor": "color"},
		styleAliases: map[string]string{"builtin:primary": "plot:1"},
	},
	"RSI": {
		path:         "sources/rsi.pine",
		configInputs: map[string]string{"length": "length", "lineColor": "color"},
		styleAliases: map[string]string{"builtin:primary": "plot:1"},
	},
	"MACD": {
		path: "sources/macd.pine",
		configInputs: map[string]string{
			"fastLength": "length", "slowLength": "length3", "signalLength": "length2",
			"macdColor": "color", "signalColor": "color2",
		},
		styleAliases: map[string]string{"builtin:primary": "plot:1", "builtin:secondary": "plot:2"},
	},
	"ADR": {
		path: "sources/adr.pine",
		configInputs: map[string]string{
			"length": "length", "highColor": "color", "lowColor": "color2",
		},
		styleAliases: map[string]string{"builtin:primary": "plot:1", "builtin:secondary": "plot:2"},
	},
	"SWING_SR": {
		path: "sources/swing_sr.pine",
		configInputs: map[string]string{
			"highLength": "length", "lowLength": "length2", "highColor": "color", "lowColor": "color2",
		},
		styleFieldInputs: map[string]map[string]string{
			"builtin:primary": {
				"visible": "showHigh", "color": "highColor", "lineWidth": "highWidth", "lineStyle": "highStyleInput",
			},
			"builtin:secondary": {
				"visible": "showLow", "color": "lowColor", "lineWidth": "lowWidth", "lineStyle": "lowStyleInput",
			},
		},
	},
	"FVG": {
		path: "sources/fvg_luxalgo.pine",
		configInputs: map[string]string{
			"bullCss": "color", "bearCss": "color2",
		},
		inputAliases: map[string]string{"timeframe": "tf"},
		styleColorInputs: map[string]string{
			"builtin:fvg-bull": "bullCss",
			"builtin:fvg-bear": "bearCss",
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
