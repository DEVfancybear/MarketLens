package pineruntime

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strings"
)

func Compile(ctx context.Context, req CompileRequest) CompileResponse {
	meta := ExtractMeta(req.SourceCode)
	id := req.ScriptID
	if id == "" {
		id = "custom"
	}
	resp := CompileResponse{
		Meta: meta,
		Result: IndicatorResult{
			ID:     id,
			Series: []IndicatorSeries{},
		},
		Errors:              []RuntimeError{},
		Warnings:            []RuntimeError{},
		UnsupportedFeatures: unsupportedFeatures(req.SourceCode),
	}
	if len(req.SourceCode) > maxSourceBytes {
		resp.Errors = append(resp.Errors, RuntimeError{Message: "source is too large"})
		return resp
	}
	if len(req.Candles) > maxCompileCandles {
		req.Candles = req.Candles[len(req.Candles)-maxCompileCandles:]
		resp.Warnings = append(resp.Warnings, RuntimeError{Message: fmt.Sprintf("compile input truncated to %d candles", maxCompileCandles)})
	}
	select {
	case <-ctx.Done():
		resp.Errors = append(resp.Errors, RuntimeError{Message: ctx.Err().Error()})
		return resp
	default:
	}

	cleaned := normalizeSource(req.SourceCode)
	context := &evalContext{
		candles:        req.Candles,
		variables:      map[string]pineValue{},
		functions:      map[string]pineFunction{},
		inputOverrides: req.InputOverrides,
	}
	readAssignments(cleaned, context, &resp.Errors)
	hlines := readHlines(cleaned, context, req.StyleOverrides, &resp.Errors)
	resp.Result.Series = append(resp.Result.Series, readFills(cleaned, context, hlines, req.Candles, req.StyleOverrides, &resp.Errors)...)
	for _, line := range hlines {
		if !line.visible {
			continue
		}
		resp.Result.Series = append(resp.Result.Series, IndicatorSeries{
			Key:       line.title,
			Color:     line.color,
			Data:      flatLinePoints(line.value, req.Candles),
			Type:      "line",
			LineWidth: &line.lineWidth,
			LineStyle: &line.lineStyle,
		})
	}
	resp.Result.Series = append(resp.Result.Series, readPlots(cleaned, context, req.Candles, req.StyleOverrides, &resp.Errors)...)
	if objectResult := compileObjectRuntime(cleaned, req.Candles, id, context, req.StyleOverrides, &resp.Errors); objectResult != nil {
		resp.Result.Series = append(resp.Result.Series, objectResult.Series...)
		resp.Result.Labels = append(resp.Result.Labels, objectResult.Labels...)
		resp.Result.Dashboard = objectResult.Dashboard
	}
	if len(resp.Result.Series) == 0 && len(resp.Result.Labels) == 0 && resp.Result.Dashboard == nil && len(resp.Errors) == 0 {
		resp.Errors = append(resp.Errors, RuntimeError{Message: "No supported plot(), hline(), fill(), or drawing object output found"})
	}
	return resp
}

func unsupportedFeatures(source string) []string {
	return []string{}
}

func readAssignments(cleaned string, context *evalContext, errors *[]RuntimeError) {
	lines := sourceLines(cleaned)
	for index := 0; index < len(lines); index++ {
		line := lines[index]
		text := line.text
		if text == "" ||
			strings.HasPrefix(text, "//@version") ||
			regexp.MustCompile(`^(indicator|study|strategy|plot|hline|fill|alertcondition)\s*\(`).MatchString(text) {
			continue
		}
		if match := functionDefinitionMatch(text); len(match) > 0 {
			context.functions[match[1]] = pineFunction{
				params:     functionParameterNames(match[2]),
				expression: strings.TrimSpace(match[3]),
			}
			continue
		}
		compound := compoundAssignmentMatch(text)
		match := compound
		if len(match) == 0 {
			match = assignmentMatch(text)
		}
		if len(match) == 0 {
			continue
		}
		name := match[1]
		expression := strings.TrimSpace(match[3])
		if len(compound) > 0 {
			expression = fmt.Sprintf("%s %s (%s)", name, compound[2], strings.TrimSpace(compound[3]))
		}
		if isDeclarationExpression(expression) {
			continue
		}
		if strings.HasPrefix(expression, "if ") || expression == "if" {
			parsed, end, err := parsePineIfExpression(lines, index, line.indent, expression)
			if err != nil {
				*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
				continue
			}
			expression = parsed
			index = end - 1
		}
		value, err := evaluateInputExpression(expression, context, name)
		if err != nil {
			*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
			continue
		}
		if value.kind == 0 && len(expression) > 0 && !isNumberZeroValue(value) {
			// no-op; see fallback below
		}
		if value.kind == 0 && value.number == 0 && !isInputExpression(expression) {
			if recursive, ok := evaluateRecursiveAssignment(name, expression, context); ok {
				value = recursive
			} else if self, ok := evaluateSelfReferentialAssignment(name, expression, context); ok {
				value = self
			} else {
				value, err = evaluateExpression(expression, context)
				if err != nil {
					*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
					continue
				}
			}
		}
		context.variables[name] = value
	}
}

func isNumberZeroValue(value pineValue) bool {
	return value.kind == kindNumber && value.number == 0
}

func isDeclarationExpression(expression string) bool {
	return regexp.MustCompile(`^(plot|hline|fill|alertcondition|line\.new|box\.new|label\.new|table\.new|line\.set_|box\.set_|label\.set_|table\.cell)\s*\(`).MatchString(strings.TrimSpace(expression))
}

func isInputExpression(expression string) bool {
	return inputCallName(expression) != ""
}

func parsePineIfExpression(lines []sourceLine, startIndex int, indent int, firstText string) (string, int, error) {
	condition := strings.TrimSpace(strings.TrimPrefix(firstText, "if"))
	whenTrue, trueEnd, err := parsePineIfBranch(lines, startIndex+1, indent)
	if err != nil {
		return "", startIndex + 1, err
	}
	elseLine := sourceLine{}
	if trueEnd < len(lines) {
		elseLine = lines[trueEnd]
	}
	if elseLine.indent != indent || elseLine.text != "else" {
		return "", trueEnd, fmt.Errorf("Pine if-expression missing else branch")
	}
	whenFalse, falseEnd, err := parsePineIfBranch(lines, trueEnd+1, indent)
	if err != nil {
		return "", trueEnd + 1, err
	}
	return fmt.Sprintf("(%s) ? (%s) : (%s)", condition, whenTrue, whenFalse), falseEnd, nil
}

func parsePineIfBranch(lines []sourceLine, startIndex int, parentIndent int) (string, int, error) {
	index := startIndex
	for index < len(lines) && lines[index].text == "" {
		index++
	}
	if index >= len(lines) || lines[index].indent <= parentIndent {
		return "", index, fmt.Errorf("Pine if-expression branch is empty")
	}
	branchIndent := lines[index].indent
	locals := map[string]string{}
	expression := "na"
	for index < len(lines) {
		line := lines[index]
		if line.text == "" {
			index++
			continue
		}
		if line.indent < branchIndent {
			break
		}
		if line.indent == parentIndent && line.text == "else" {
			break
		}
		if line.indent > branchIndent {
			index++
			continue
		}
		if match := assignmentMatch(line.text); len(match) > 0 {
			value := strings.TrimSpace(match[3])
			if strings.HasPrefix(value, "if ") || value == "if" {
				parsed, end, err := parsePineIfExpression(lines, index, line.indent, value)
				if err != nil {
					return "", end, err
				}
				value = parsed
				index = end
			} else {
				index++
			}
			locals[match[1]] = value
			expression = value
			continue
		}
		if strings.HasPrefix(line.text, "if ") || line.text == "if" {
			parsed, end, err := parsePineIfExpression(lines, index, line.indent, line.text)
			if err != nil {
				return "", end, err
			}
			expression = parsed
			index = end
			continue
		}
		if value, ok := locals[line.text]; ok {
			expression = value
		} else {
			expression = line.text
		}
		index++
	}
	return expression, index, nil
}

func evaluateInputExpression(expression string, context *evalContext, variableName string) (pineValue, error) {
	trimmed := strings.TrimSpace(expression)
	callName := inputCallName(trimmed)
	if callName == "" {
		return pineValue{}, nil
	}
	bodies := findCallBodies(trimmed, callName)
	if len(bodies) == 0 || trimmed != callName+"("+bodies[0]+")" {
		return pineValue{}, nil
	}
	args := parseCallArguments(bodies[0])
	defaultExpression := args.named["defval"]
	if defaultExpression == "" && len(args.positional) > 0 {
		defaultExpression = args.positional[0]
	}
	if variableName != "" {
		if definition, ok := parseInputDefinition(variableName, trimmed); ok {
			if override, exists := context.inputOverrides[variableName]; exists {
				return inputOverrideValue(override, definition, context, defaultExpression)
			}
		}
	}
	if defaultExpression == "" {
		return numberValue(0), nil
	}
	return evaluateExpression(defaultExpression, context)
}

func inputOverrideValue(raw InputValue, definition InputDefinition, context *evalContext, defaultExpression string) (pineValue, error) {
	switch definition.Kind {
	case "bool":
		switch value := raw.(type) {
		case bool:
			return boolValue(value), nil
		case string:
			return boolValue(value == "true"), nil
		default:
			return boolValue(false), nil
		}
	case "int", "float":
		return numberValue(inputValueAsFloat(raw)), nil
	case "color":
		return colorValue(fmt.Sprint(raw)), nil
	case "source":
		sourceName := fmt.Sprint(raw)
		if sourceName == "" {
			sourceName = fmt.Sprint(definition.DefaultValue)
		}
		value, err := evaluateExpression(sourceName, context)
		if err == nil {
			return value, nil
		}
		if defaultExpression != "" {
			return evaluateExpression(defaultExpression, context)
		}
		return sourceSeries(context.candles, "close"), nil
	default:
		return stringValue(fmt.Sprint(raw)), nil
	}
}

func inputValueAsFloat(raw InputValue) float64 {
	switch value := raw.(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case string:
		if parsed, ok := parseNumberLiteral(value); ok {
			return parsed
		}
	}
	return 0
}

func evaluateRecursiveAssignment(name, expression string, context *evalContext) (pineValue, bool) {
	escaped := regexp.QuoteMeta(name)
	prev := fmt.Sprintf(`nz\(\s*%s\[\s*1\s*\]\s*\)`, escaped)
	re := regexp.MustCompile(`^` + prev + `\s*\+\s*\((.+?)\s*-\s*` + prev + `\)\s*/\s*(.+)$`)
	match := re.FindStringSubmatch(expression)
	if len(match) == 0 {
		return pineValue{}, false
	}
	source, err := evaluateExpression(match[1], context)
	if err != nil {
		return pineValue{}, false
	}
	lengthValue, err := evaluateExpression(match[2], context)
	if err != nil {
		return pineValue{}, false
	}
	length := period(lengthValue)
	values := toSeries(source, len(context.candles))
	out := make([]float64, len(values))
	prevValue := float64(0)
	for i, point := range values {
		if !usable(point) {
			out[i] = math.NaN()
			continue
		}
		prevValue = prevValue + (point-prevValue)/float64(length)
		out[i] = prevValue
	}
	return seriesValue(out), true
}

func evaluateSelfReferentialAssignment(name, expression string, context *evalContext) (pineValue, bool) {
	re := regexp.MustCompile(`\b` + regexp.QuoteMeta(name) + `\s*\[\s*(\d+)\s*\]`)
	matches := re.FindAllStringSubmatch(expression, -1)
	if len(matches) == 0 {
		return pineValue{}, false
	}
	offsets := map[int]bool{}
	scalarExpression := expression
	for _, match := range matches {
		offset := int(inputValueAsFloat(match[1]))
		offsets[offset] = true
		scalarExpression = regexp.MustCompile(`\b`+regexp.QuoteMeta(name)+`\s*\[\s*`+regexp.QuoteMeta(match[1])+`\s*\]`).ReplaceAllString(scalarExpression, fmt.Sprintf("__%s_%d", name, offset))
	}
	out := []float64{}
	for i, candle := range context.candles {
		scalar := &evalContext{
			candles:        []Candle{candle},
			variables:      map[string]pineValue{},
			functions:      context.functions,
			inputOverrides: context.inputOverrides,
		}
		for key, value := range context.variables {
			scalar.variables[key] = scalarValueAt(value, i, len(context.candles))
		}
		scalar.variables[name] = scalarValueAt(seriesValue(out), i, len(context.candles))
		for offset := range offsets {
			value := math.NaN()
			if i-offset >= 0 && i-offset < len(out) {
				value = out[i-offset]
			}
			scalar.variables[fmt.Sprintf("__%s_%d", name, offset)] = numberValue(value)
		}
		evaluated, err := evaluateExpression(scalarExpression, scalar)
		if err != nil {
			out = append(out, math.NaN())
			continue
		}
		point := getAt(evaluated, 0, 1)
		if usable(point) {
			out = append(out, point)
		} else {
			out = append(out, math.NaN())
		}
	}
	return seriesValue(out), true
}

func scalarValueAt(value pineValue, index int, length int) pineValue {
	if value.kind == kindSeries {
		return numberValue(getAt(value, index, length))
	}
	if value.kind == kindColorSeries {
		color := colorAt(value, index)
		if color == "" {
			return naNumber()
		}
		return colorValue(color)
	}
	return value
}

func styleValue(values map[string]InputValue, key string) InputValue {
	if values == nil {
		return nil
	}
	return values[key]
}

func styleVisible(values map[string]InputValue, key string) bool {
	value := styleValue(values, styleFieldKey(key, "visible"))
	if value == nil {
		return true
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		return typed == "true"
	default:
		return true
	}
}

func styleColorValue(values map[string]InputValue, key string, fallback string) string {
	value := styleValue(values, styleFieldKey(key, "color"))
	if text := strings.TrimSpace(fmt.Sprint(value)); value != nil && text != "" {
		return text
	}
	return fallback
}

func styleLineWidthValue(values map[string]InputValue, key string, fallback int) int {
	value := styleValue(values, styleFieldKey(key, "lineWidth"))
	if value == nil {
		return fallback
	}
	return int(math.Max(1, math.Min(4, math.Round(inputValueAsFloat(value)))))
}

func styleLineStyleValue(values map[string]InputValue, key string, fallback int) int {
	value := styleValue(values, styleFieldKey(key, "lineStyle"))
	if value == nil {
		return fallback
	}
	return int(math.Max(0, math.Min(4, math.Round(inputValueAsFloat(value)))))
}

func resolvePlotColor(expression string, context *evalContext, fallback string) (string, []string) {
	if strings.TrimSpace(expression) == "" {
		return fallback, nil
	}
	value, err := evaluateExpression(expression, context)
	if err == nil {
		if value.kind == kindColor {
			return value.color, nil
		}
		if value.kind == kindColorSeries {
			base := fallback
			for _, color := range value.colors {
				if color != "" {
					base = color
					break
				}
			}
			return base, value.colors
		}
	}
	return resolveColor(expression, fallback), nil
}

func readPlots(cleaned string, context *evalContext, candles []Candle, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorSeries {
	out := []IndicatorSeries{}
	for index, body := range findCallBodies(cleaned, "plot") {
		args := parseCallArguments(body)
		if len(args.positional) == 0 {
			*errors = append(*errors, RuntimeError{Message: fmt.Sprintf("plot() #%d: missing series expression", index+1)})
			continue
		}
		value, err := evaluateExpression(args.positional[0], context)
		if err != nil {
			*errors = append(*errors, RuntimeError{Message: fmt.Sprintf("plot() #%d: %s", index+1, err.Error())})
			continue
		}
		title := fmt.Sprintf("plot_%d", index+1)
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
		color, colors := resolvePlotColor(colorExpr, context, defaultColors[index%len(defaultColors)])
		if transp, ok := parseNumberLiteral(args.named["transp"]); ok {
			color = withTransparency(color, transp)
			for i, item := range colors {
				if item != "" {
					colors[i] = withTransparency(item, transp)
				}
			}
		}
		key := styleKey("plot", fmt.Sprint(index+1))
		if !styleVisible(styles, key) {
			continue
		}
		color = styleColorValue(styles, key, color)
		if styleValue(styles, styleFieldKey(key, "color")) != nil {
			colors = nil
		}
		widthExpr := args.named["linewidth"]
		if widthExpr == "" && len(args.positional) > 3 {
			widthExpr = args.positional[3]
		}
		lineWidth := styleLineWidthValue(styles, key, lineWidth(widthExpr, 2))
		lineStyle := styleLineStyleValue(styles, key, lineStyle(args.named["linestyle"]))
		seriesType := plotType(args.named["style"])
		data := seriesToLinePoints(toSeries(value, len(candles)), candles, colors)
		out = append(out, IndicatorSeries{
			Key:       title,
			Color:     color,
			Type:      seriesType,
			LineWidth: &lineWidth,
			LineStyle: &lineStyle,
			Data:      data,
		})
	}
	return out
}

func seriesToLinePoints(values []float64, candles []Candle, colors []string) []LinePoint {
	out := []LinePoint{}
	seen := map[int64]bool{}
	for i, value := range values {
		if i >= len(candles) || !usable(value) {
			continue
		}
		t := candles[i].Time
		if seen[t] {
			continue
		}
		seen[t] = true
		point := LinePoint{Time: t, Value: value}
		if i < len(colors) && colors[i] != "" {
			color := colors[i]
			point.Color = &color
		}
		out = append(out, point)
	}
	return out
}

func flatLinePoints(value float64, candles []Candle) []LinePoint {
	if len(candles) == 0 || !usable(value) {
		return []LinePoint{}
	}
	first := candles[0]
	last := candles[len(candles)-1]
	out := []LinePoint{{Time: first.Time, Value: value}}
	if last.Time != first.Time {
		out = append(out, LinePoint{Time: last.Time, Value: value})
	}
	return out
}

type hlineDef struct {
	id        string
	title     string
	value     float64
	visible   bool
	color     string
	lineWidth int
	lineStyle int
}

func readHlines(cleaned string, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) []hlineDef {
	out := []hlineDef{}
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
		if len(args.positional) == 0 {
			*errors = append(*errors, RuntimeError{Line: line.number, Message: "hline() missing price"})
			continue
		}
		value, err := evaluateExpression(args.positional[0], context)
		if err != nil {
			*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
			continue
		}
		price := getAt(value, len(context.candles)-1, len(context.candles))
		if !usable(price) {
			price = getAt(value, 0, len(context.candles))
		}
		id := hlineVariableName(line.text)
		styleID := id
		if id == "" {
			id = fmt.Sprintf("hline_%d", hlineIndex)
			styleID = fmt.Sprint(hlineIndex)
		}
		title := id
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
		key := styleKey("hline", styleID)
		out = append(out, hlineDef{
			id:        id,
			title:     title,
			value:     price,
			visible:   styleVisible(styles, key),
			color:     styleColorValue(styles, key, resolveColor(colorExpr, defaultColors[len(out)%len(defaultColors)])),
			lineWidth: styleLineWidthValue(styles, key, lineWidth(widthExpr, 1)),
			lineStyle: styleLineStyleValue(styles, key, lineStyle(styleExpr)),
		})
	}
	return out
}

func readFills(cleaned string, context *evalContext, hlines []hlineDef, candles []Candle, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorSeries {
	byID := map[string]hlineDef{}
	for _, line := range hlines {
		byID[line.id] = line
	}
	out := []IndicatorSeries{}
	fillIndex := 0
	for _, line := range sourceLines(cleaned) {
		if !strings.HasPrefix(line.text, "fill(") {
			continue
		}
		bodies := findCallBodies(line.text, "fill")
		if len(bodies) == 0 {
			continue
		}
		fillIndex++
		args := parseCallArguments(bodies[0])
		if len(args.positional) < 2 {
			continue
		}
		first, ok1 := byID[strings.TrimSpace(args.positional[0])]
		second, ok2 := byID[strings.TrimSpace(args.positional[1])]
		if !ok1 || !ok2 {
			*errors = append(*errors, RuntimeError{Line: line.number, Message: "fill() currently supports hline variables only"})
			continue
		}
		low := math.Min(first.value, second.value)
		high := math.Max(first.value, second.value)
		colorExpr := args.named["color"]
		if colorExpr == "" && len(args.positional) > 2 {
			colorExpr = args.positional[2]
		}
		color := resolveColor(colorExpr, "#e040fb")
		transp := args.named["transp"]
		if transp == "" && len(args.positional) > 3 {
			transp = args.positional[3]
		}
		if value, ok := parseNumberLiteral(transp); ok {
			color = withTransparency(color, value)
		}
		key := styleKey("fill", fmt.Sprint(fillIndex))
		if !styleVisible(styles, key) {
			continue
		}
		color = styleColorValue(styles, key, color)
		title := fmt.Sprintf("fill_%d", fillIndex)
		if value, ok := unquote(args.named["title"]); ok {
			title = value
		} else if len(args.positional) > 4 {
			if value, ok := unquote(args.positional[4]); ok {
				title = value
			}
		}
		lineVisible := false
		lastValueVisible := false
		out = append(out, IndicatorSeries{
			Key:              title,
			Color:            color,
			Type:             "baselineFill",
			BaseValue:        &low,
			LineVisible:      &lineVisible,
			LastValueVisible: &lastValueVisible,
			Data:             flatLinePoints(high, candles),
		})
	}
	return out
}
