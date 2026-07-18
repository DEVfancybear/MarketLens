package pineruntime

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

var namedColors = map[string]string{
	"color.blue":    "#2196f3",
	"color.orange":  "#ff9800",
	"color.green":   "#4caf50",
	"color.red":     "#f44336",
	"color.purple":  "#9c27b0",
	"color.aqua":    "#00bcd4",
	"color.lime":    "#00e676",
	"color.fuchsia": "#e040fb",
	"color.maroon":  "#880e4f",
	"color.navy":    "#311b92",
	"color.olive":   "#808000",
	"color.teal":    "#00897b",
	"color.yellow":  "#fdd835",
	"color.white":   "#ffffff",
	"color.black":   "#000000",
	"color.gray":    "#787b86",
	"color.grey":    "#787b86",
	"color.silver":  "#b2b5be",
	"blue":          "#2196f3",
	"orange":        "#ff9800",
	"green":         "#4caf50",
	"red":           "#f44336",
	"purple":        "#9c27b0",
	"aqua":          "#00bcd4",
	"lime":          "#00e676",
	"fuchsia":       "#e040fb",
	"maroon":        "#880e4f",
	"navy":          "#311b92",
	"olive":         "#808000",
	"teal":          "#00897b",
	"yellow":        "#fdd835",
	"white":         "#ffffff",
	"black":         "#000000",
	"gray":          "#787b86",
	"grey":          "#787b86",
	"silver":        "#b2b5be",
}

var defaultColors = []string{
	"#2962ff",
	"#ff6d00",
	"#26a69a",
	"#ab47bc",
	"#00bcd4",
	"#ef5350",
}

// Declaration arguments are positional in Pine's public signatures even
// though most published scripts use named arguments after shorttitle. Keeping
// the canonical order here makes metadata extraction independent of formatting
// style and lets future consumers inspect the exact script-wide properties.
var indicatorDeclarationProperties = []string{
	"title",
	"shorttitle",
	"overlay",
	"format",
	"precision",
	"scale",
	"max_bars_back",
	"timeframe",
	"timeframe_gaps",
	"explicit_plot_zorder",
	"max_lines_count",
	"max_labels_count",
	"max_boxes_count",
	"calc_bars_count",
	"max_polylines_count",
	"dynamic_requests",
	"behind_chart",
}

// study() is retained for legacy source compatibility. Pine renamed its final
// pair of dataset arguments when indicator() replaced it.
var studyDeclarationProperties = []string{
	"title",
	"shorttitle",
	"overlay",
	"format",
	"precision",
	"scale",
	"max_bars_back",
	"resolution",
	"resolution_gaps",
}

func ExtractMeta(source string) ScriptMeta {
	cleaned := normalizeSource(source)
	version := pineSourceVersion(source)
	body := ""
	declarationProperties := indicatorDeclarationProperties
	if bodies := findCallBodies(cleaned, "indicator"); len(bodies) > 0 {
		body = bodies[0]
	} else if bodies := findCallBodies(cleaned, "study"); len(bodies) > 0 {
		body = bodies[0]
		declarationProperties = studyDeclarationProperties
	}
	if body == "" {
		return ScriptMeta{Name: "Untitled script", Overlay: true, Version: version}
	}
	args := parseCallArguments(body)
	properties := extractDeclarationProperties(args, declarationProperties)
	name := "Untitled script"
	if value, ok := properties["title"].(string); ok {
		name = value
	}
	shortTitle := ""
	if value, ok := properties["shorttitle"].(string); ok {
		shortTitle = strings.TrimSpace(value)
	}
	overlay := false
	if value, ok := properties["overlay"].(bool); ok {
		overlay = value
	}
	timeframe := ""
	if value, ok := properties["timeframe"].(string); ok {
		timeframe = value
	} else if value, ok := properties["resolution"].(string); ok {
		timeframe = value
	}
	if len(properties) == 0 {
		properties = nil
	}
	return ScriptMeta{Name: name, ShortTitle: shortTitle, Overlay: overlay, Timeframe: timeframe, Version: version, Properties: properties}
}

func extractDeclarationProperties(args callArguments, positionalNames []string) map[string]any {
	properties := map[string]any{}
	for index, raw := range args.positional {
		if index >= len(positionalNames) {
			break
		}
		if value, ok := parseDeclarationProperty(raw); ok {
			properties[positionalNames[index]] = value
		}
	}
	// Pine allows callers to switch to named arguments at any point. A named
	// value is authoritative if malformed source happens to repeat a positional
	// parameter; the Pine compiler itself remains responsible for rejecting the
	// duplicate when full declaration validation is implemented.
	for key, raw := range args.named {
		if value, ok := parseDeclarationProperty(raw); ok {
			properties[key] = value
		}
	}
	return properties
}

var pineVersionPattern = regexp.MustCompile(`(?m)^\s*//@version\s*=\s*(\d+)\b`)
var declarationEnumPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_.]*$`)

func pineSourceVersion(cleaned string) int {
	match := pineVersionPattern.FindStringSubmatch(cleaned)
	if len(match) < 2 {
		// Pine defaults unannotated sources to the legacy language version. The
		// value is metadata only; unsupported legacy syntax still fails closed.
		return 1
	}
	value, ok := parseNumberLiteral(match[1])
	if !ok || value < 1 {
		return 1
	}
	return int(math.Round(value))
}

func parseDeclarationProperty(raw string) (any, bool) {
	trimmed := strings.TrimSpace(raw)
	if value, ok := parseBoolLiteral(trimmed); ok {
		return value, true
	}
	if value, ok := parseNumberLiteral(trimmed); ok {
		if math.Trunc(value) == value {
			return int(value), true
		}
		return value, true
	}
	if value, ok := unquote(trimmed); ok {
		return value, true
	}
	if strings.EqualFold(trimmed, "na") {
		return nil, true
	}
	if trimmed != "" && declarationEnumPattern.MatchString(trimmed) {
		return trimmed, true
	}
	return nil, false
}

func inputCallName(expression string) string {
	trimmed := strings.TrimSpace(expression)
	match := regexp.MustCompile(`^(input(?:\.[A-Za-z_]+)?)\s*\(`).FindStringSubmatch(trimmed)
	if len(match) == 0 {
		return ""
	}
	return match[1]
}

func inferInputKind(callName string, args callArguments, defaultExpression string) string {
	if strings.Contains(callName, ".") {
		switch strings.Split(callName, ".")[1] {
		case "int":
			return "int"
		case "float":
			return "float"
		case "bool":
			return "bool"
		case "color":
			return "color"
		case "source":
			return "source"
		case "timeframe":
			return "timeframe"
		case "string", "symbol", "session", "text_area":
			return "string"
		}
	}
	typeName := strings.TrimSpace(args.named["type"])
	if strings.HasSuffix(typeName, ".integer") || strings.HasSuffix(typeName, ".int") || typeName == "integer" {
		return "int"
	}
	if strings.HasSuffix(typeName, ".float") || typeName == "float" {
		return "float"
	}
	if strings.HasSuffix(typeName, ".bool") || typeName == "bool" {
		return "bool"
	}
	if strings.HasSuffix(typeName, ".color") || typeName == "color" {
		return "color"
	}
	if strings.HasSuffix(typeName, ".source") || typeName == "source" {
		return "source"
	}
	if strings.HasSuffix(typeName, ".string") || typeName == "string" {
		return "string"
	}
	def := strings.TrimSpace(defaultExpression)
	if _, ok := parseBoolLiteral(def); ok {
		return "bool"
	}
	if strings.HasPrefix(def, "color.") || regexp.MustCompile(`^#[0-9a-fA-F]{6}$`).MatchString(def) {
		return "color"
	}
	if _, ok := unquote(def); ok {
		return "string"
	}
	switch strings.ToLower(def) {
	case "open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4", "volume":
		return "source"
	}
	if value, ok := parseNumberLiteral(def); ok {
		if math.Trunc(value) == value {
			return "int"
		}
		return "float"
	}
	return "string"
}

func inputDefaultValue(expression, kind string) InputValue {
	raw := strings.TrimSpace(expression)
	switch kind {
	case "bool":
		if value, ok := parseBoolLiteral(raw); ok {
			return value
		}
		return false
	case "int":
		if value, ok := parseNumberLiteral(raw); ok {
			return int(math.Round(value))
		}
		return 0
	case "float":
		if value, ok := parseNumberLiteral(raw); ok {
			return value
		}
		return float64(0)
	case "color":
		return resolveColor(raw, "#2962ff")
	case "source":
		if value, ok := unquote(raw); ok {
			return value
		}
		if raw == "" {
			return "close"
		}
		return raw
	default:
		if value, ok := unquote(raw); ok {
			return value
		}
		return raw
	}
}

func parseListLiteral(raw string) []InputValue {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "[") || !strings.HasSuffix(trimmed, "]") {
		return nil
	}
	values := []InputValue{}
	for _, part := range splitTopLevel(trimmed[1 : len(trimmed)-1]) {
		if value, ok := unquote(part); ok {
			values = append(values, value)
		} else if value, ok := parseBoolLiteral(part); ok {
			values = append(values, value)
		} else if value, ok := parseNumberLiteral(part); ok {
			values = append(values, value)
		} else if strings.TrimSpace(part) != "" {
			values = append(values, strings.TrimSpace(part))
		}
	}
	return values
}

func sourceInputOptions(defaultValue InputValue) []InputValue {
	defaults := []InputValue{"open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4", "volume"}
	value := fmt.Sprint(defaultValue)
	for _, item := range defaults {
		if item == value {
			return defaults
		}
	}
	return append([]InputValue{value}, defaults...)
}

func parseInputDefinition(key, expression string) (InputDefinition, bool) {
	callName := inputCallName(expression)
	if callName == "" {
		return InputDefinition{}, false
	}
	bodies := findCallBodies(strings.TrimSpace(expression), callName)
	if len(bodies) == 0 || strings.TrimSpace(expression) != callName+"("+bodies[0]+")" {
		return InputDefinition{}, false
	}
	args := parseCallArguments(bodies[0])
	defaultExpression := args.named["defval"]
	if defaultExpression == "" && len(args.positional) > 0 {
		defaultExpression = args.positional[0]
	}
	kind := inferInputKind(callName, args, defaultExpression)
	defaultValue := inputDefaultValue(defaultExpression, kind)
	options := parseListLiteral(args.named["options"])
	if len(options) == 0 && kind == "source" {
		options = sourceInputOptions(defaultValue)
	}
	title := key
	if value, ok := unquote(args.named["title"]); ok {
		title = value
	} else if len(args.positional) > 1 {
		if value, ok := unquote(args.positional[1]); ok {
			title = value
		}
	}
	def := InputDefinition{
		Key:          key,
		Title:        title,
		Kind:         kind,
		DefaultValue: defaultValue,
		Options:      options,
	}
	if value, ok := unquote(args.named["group"]); ok {
		def.Group = value
	}
	if value, ok := unquote(args.named["inline"]); ok {
		def.Inline = value
	}
	if value, ok := unquote(args.named["tooltip"]); ok {
		def.Tooltip = value
	}
	if value, ok := parseNumberLiteral(args.named["minval"]); ok {
		def.Min = &value
	}
	if value, ok := parseNumberLiteral(args.named["maxval"]); ok {
		def.Max = &value
	}
	if value, ok := parseNumberLiteral(args.named["step"]); ok {
		def.Step = &value
	}
	return def, true
}

func ExtractInputs(source string) []InputDefinition {
	cleaned := normalizeSource(source)
	defs := []InputDefinition{}
	seen := map[string]bool{}
	for _, line := range sourceLines(cleaned) {
		match := assignmentMatch(line.text)
		if len(match) == 0 {
			continue
		}
		if def, ok := parseInputDefinition(match[1], strings.TrimSpace(match[3])); ok && !seen[def.Key] {
			seen[def.Key] = true
			defs = append(defs, def)
		}
	}
	return defs
}

func styleKey(target, id string) string {
	return target + ":" + id
}

func styleFieldKey(key, field string) string {
	return key + "." + field
}

func resolveColor(expression, fallback string) string {
	trimmed := strings.TrimSpace(expression)
	if trimmed == "" {
		return fallback
	}
	if strings.HasPrefix(trimmed, "#") && len(trimmed) == 7 {
		return trimmed
	}
	if color, ok := namedColors[trimmed]; ok {
		return color
	}
	if strings.HasPrefix(trimmed, "color.new(") {
		body := ""
		if bodies := findCallBodies(trimmed, "color.new"); len(bodies) > 0 {
			body = bodies[0]
		}
		if body != "" {
			args := parseCallArguments(body)
			base := ""
			if len(args.positional) > 0 {
				base = args.positional[0]
			}
			transp := args.named["transp"]
			if transp == "" && len(args.positional) > 1 {
				transp = args.positional[1]
			}
			color := resolveColor(base, fallback)
			if value, ok := parseNumberLiteral(transp); ok {
				return withTransparency(color, value)
			}
			return color
		}
	}
	return fallback
}

func withTransparency(color string, transparency float64) string {
	if !strings.HasPrefix(color, "#") || len(color) != 7 {
		return color
	}
	alpha := 1 - math.Max(0, math.Min(100, transparency))/100
	return fmt.Sprintf("rgba(%d, %d, %d, %.3f)", hexPair(color[1:3]), hexPair(color[3:5]), hexPair(color[5:7]), alpha)
}

func hexPair(input string) int {
	value, _ := parseIntBase(input, 16)
	return int(value)
}

func parseIntBase(input string, base int) (int64, error) {
	var out int64
	for _, ch := range input {
		var digit int64
		switch {
		case ch >= '0' && ch <= '9':
			digit = int64(ch - '0')
		case ch >= 'a' && ch <= 'f':
			digit = int64(ch-'a') + 10
		case ch >= 'A' && ch <= 'F':
			digit = int64(ch-'A') + 10
		default:
			return 0, fmt.Errorf("invalid digit")
		}
		if digit >= int64(base) {
			return 0, fmt.Errorf("invalid digit")
		}
		out = out*int64(base) + digit
	}
	return out, nil
}

func lineStyle(expression string) int {
	key := strings.ToLower(strings.TrimSpace(expression))
	for _, prefix := range []string{"plot.style_", "line.style_", "hline.style_"} {
		key = strings.TrimPrefix(key, prefix)
	}
	switch key {
	case "dotted":
		return 1
	case "dashed":
		return 2
	case "large_dashed":
		return 3
	case "sparse_dotted":
		return 4
	default:
		return 0
	}
}

func lineWidth(expression string, fallback int) int {
	value, ok := parseNumberLiteral(expression)
	if !ok {
		return fallback
	}
	return int(math.Max(1, math.Min(4, math.Round(value))))
}

func plotType(expression string) string {
	key := strings.ToLower(strings.TrimSpace(expression))
	if strings.Contains(key, "columns") || strings.Contains(key, "histogram") {
		return "histogram"
	}
	return "line"
}

func plotLineBreak(expression string) bool {
	key := strings.ToLower(strings.TrimSpace(expression))
	return key == "linebr" || strings.Contains(key, ".linebr")
}

func hlineVariableName(line string) string {
	match := regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*hline\s*\(`).FindStringSubmatch(line)
	if len(match) == 0 {
		return ""
	}
	return match[1]
}

func intPtr(value int) *int { return &value }

func ExtractStyles(source string) []StyleDefinition {
	cleaned := normalizeSource(source)
	defs := []StyleDefinition{}
	for index, body := range findCallBodies(cleaned, "plot") {
		args := parseCallArguments(body)
		title := fmt.Sprintf("Plot %d", index+1)
		if value, ok := unquote(args.named["title"]); ok {
			title = value
		} else if len(args.positional) > 1 {
			if value, ok := unquote(args.positional[1]); ok {
				title = value
			}
		}
		colorExpr := args.named["color"]
		if colorExpr == "" && len(args.positional) > 2 {
			colorExpr = args.positional[2]
		}
		widthExpr := args.named["linewidth"]
		if widthExpr == "" && len(args.positional) > 3 {
			widthExpr = args.positional[3]
		}
		pt := plotType(args.named["style"])
		defs = append(defs, StyleDefinition{
			Key:               styleKey("plot", fmt.Sprint(index+1)),
			Title:             title,
			Target:            "plot",
			Group:             "Plots",
			DefaultVisible:    true,
			DefaultColor:      resolveColor(colorExpr, defaultColors[index%len(defaultColors)]),
			DefaultLineWidth:  intPtr(lineWidth(widthExpr, 2)),
			DefaultLineStyle:  intPtr(lineStyle(args.named["linestyle"])),
			SupportsColor:     true,
			SupportsLineWidth: pt != "histogram",
			SupportsLineStyle: pt != "histogram",
		})
	}

	hlineIndex := 0
	for _, line := range sourceLines(cleaned) {
		if !strings.Contains(line.text, "hline(") {
			continue
		}
		bodies := findCallBodies(line.text, "hline")
		if len(bodies) == 0 {
			continue
		}
		hlineIndex++
		args := parseCallArguments(bodies[0])
		id := hlineVariableName(line.text)
		if id == "" {
			id = fmt.Sprint(hlineIndex)
		}
		title := fmt.Sprintf("HLine %d", hlineIndex)
		if value, ok := unquote(args.named["title"]); ok {
			title = value
		} else if len(args.positional) > 1 {
			if value, ok := unquote(args.positional[1]); ok {
				title = value
			}
		}
		colorExpr := args.named["color"]
		if colorExpr == "" && len(args.positional) > 2 {
			colorExpr = args.positional[2]
		}
		styleExpr := args.named["linestyle"]
		if styleExpr == "" && len(args.positional) > 3 {
			styleExpr = args.positional[3]
		}
		widthExpr := args.named["linewidth"]
		if widthExpr == "" && len(args.positional) > 4 {
			widthExpr = args.positional[4]
		}
		defs = append(defs, StyleDefinition{
			Key:               styleKey("hline", id),
			Title:             title,
			Target:            "hline",
			Group:             "Horizontal Lines",
			DefaultVisible:    true,
			DefaultColor:      resolveColor(colorExpr, defaultColors[(len(defs)+hlineIndex)%len(defaultColors)]),
			DefaultLineWidth:  intPtr(lineWidth(widthExpr, 1)),
			DefaultLineStyle:  intPtr(lineStyle(styleExpr)),
			SupportsColor:     true,
			SupportsLineWidth: true,
			SupportsLineStyle: true,
		})
	}

	for index, body := range findCallBodies(cleaned, "fill") {
		args := parseCallArguments(body)
		title := fmt.Sprintf("Fill %d", index+1)
		if value, ok := unquote(args.named["title"]); ok {
			title = value
		} else if len(args.positional) > 4 {
			if value, ok := unquote(args.positional[4]); ok {
				title = value
			}
		}
		colorExpr := args.named["color"]
		if colorExpr == "" && len(args.positional) > 2 {
			colorExpr = args.positional[2]
		}
		defs = append(defs, StyleDefinition{
			Key:               styleKey("fill", fmt.Sprint(index+1)),
			Title:             title,
			Target:            "fill",
			Group:             "Fills",
			DefaultVisible:    true,
			DefaultColor:      resolveColor(colorExpr, "#e040fb"),
			SupportsColor:     true,
			SupportsLineWidth: false,
			SupportsLineStyle: false,
		})
	}

	lines := sourceLines(cleaned)
	for index, call := range objectCreationCalls(lines, "line.new") {
		colorExpr := rawArg(call.args, "color", 6)
		widthExpr := rawArg(call.args, "width", 8)
		defs = append(defs, StyleDefinition{
			Key:               styleKey("line", call.variable),
			Title:             call.variable,
			Target:            "line",
			Group:             "Drawing Objects",
			DefaultVisible:    true,
			DefaultColor:      resolveColor(colorExpr, defaultColors[(len(defs)+index)%len(defaultColors)]),
			DefaultLineWidth:  intPtr(lineWidth(widthExpr, 2)),
			DefaultLineStyle:  intPtr(lineStyle(rawArg(call.args, "style", 7))),
			SupportsColor:     true,
			SupportsLineWidth: true,
			SupportsLineStyle: true,
		})
	}
	for _, call := range objectCreationCalls(lines, "box.new") {
		defs = append(defs, StyleDefinition{
			Key:               styleKey("box", call.variable),
			Title:             call.variable,
			Target:            "box",
			Group:             "Drawing Objects",
			DefaultVisible:    true,
			DefaultColor:      resolveColor(rawArg(call.args, "bgcolor", 9), resolveColor("color.blue", defaultColors[0])),
			SupportsColor:     true,
			SupportsLineWidth: false,
			SupportsLineStyle: false,
		})
	}
	for _, call := range objectCreationCalls(lines, "label.new") {
		defs = append(defs, StyleDefinition{
			Key:               styleKey("label", call.variable),
			Title:             call.variable,
			Target:            "label",
			Group:             "Drawing Objects",
			DefaultVisible:    true,
			DefaultColor:      resolveColor(rawArg(call.args, "textcolor", 7), "#ffffff"),
			SupportsColor:     true,
			SupportsLineWidth: false,
			SupportsLineStyle: false,
		})
	}
	return defs
}
