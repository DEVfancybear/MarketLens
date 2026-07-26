package pineruntime

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"strings"
)

const outputPrecisionStyleKey = "__output.precision"

func normalizedIndicatorValueFormat(value any) string {
	raw, ok := value.(string)
	if !ok {
		return ""
	}
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "format.volume", "volume":
		return "volume"
	case "format.percent", "percent":
		return "percent"
	case "format.price", "price":
		return "price"
	default:
		// format.inherit and absent/unknown future values intentionally leave
		// the chart renderer's normal output format untouched.
		return ""
	}
}

func indicatorOutputPrecision(meta ScriptMeta, styles map[string]InputValue) *int {
	value := meta.Properties["precision"]
	if override, ok := styles[outputPrecisionStyleKey]; ok {
		if text, isString := override.(string); !isString || !strings.EqualFold(strings.TrimSpace(text), "default") {
			value = override
		}
	}
	number, ok := runtimeNumericValue(value)
	if !ok {
		return nil
	}
	precision := int(math.Max(0, math.Min(8, math.Round(number))))
	return &precision
}

func applyIndicatorOutputPresentation(result *IndicatorResult, meta ScriptMeta, styles map[string]InputValue) {
	valueFormat := normalizedIndicatorValueFormat(meta.Properties["format"])
	precision := indicatorOutputPrecision(meta, styles)
	if valueFormat == "" && precision == nil {
		return
	}
	for index := range result.Series {
		result.Series[index].ValueFormat = valueFormat
		if precision != nil {
			seriesPrecision := *precision
			result.Series[index].Precision = &seriesPrecision
		}
	}
}

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
	if meta.Version > 6 {
		feature := fmt.Sprintf("Pine version %d (only versions through v6 are supported)", meta.Version)
		resp.UnsupportedFeatures = append(resp.UnsupportedFeatures, feature)
		resp.Errors = append(resp.Errors, RuntimeError{Message: "unsupported Pine version: " + feature})
		return resp
	}
	if meta.Version == 0 {
		resp.Warnings = append(resp.Warnings, RuntimeError{Message: "Pine version is not declared; using the v5-compatible historical subset"})
	} else if meta.Version < 5 {
		resp.Warnings = append(resp.Warnings, RuntimeError{Message: fmt.Sprintf("legacy Pine v%d syntax is accepted through the compatibility subset; v5/v6 semantics are preferred", meta.Version)})
	} else if meta.Version == 6 {
		resp.Warnings = append(resp.Warnings, RuntimeError{Message: "Pine v6 runs in documented closed-bar compatibility mode; realtime rollback and varip semantics remain unsupported"})
	}
	if blocked := blockingUnsupportedFeatures(req.SourceCode); len(blocked) > 0 {
		resp.Errors = append(resp.Errors, RuntimeError{Message: "unsupported Pine features: " + strings.Join(blocked, ", ")})
		return resp
	}
	if blocked := unsupportedDeclarationExecutionProperties(meta); len(blocked) > 0 {
		resp.Errors = append(resp.Errors, RuntimeError{Message: "unsupported Pine declaration execution properties: " + strings.Join(blocked, ", ")})
		return resp
	}
	if err := validateReplayCutoff(req.ReplayCutoff); err != nil {
		resp.Errors = append(resp.Errors, RuntimeError{Message: err.Error()})
		return resp
	}
	req.Candles = normalizeRuntimeCandles(req.Candles)
	if req.ReplayCutoff != nil {
		// Replay is a fresh historical execution, not a full-history execution
		// followed by a visual crop. Truncate before the VM/vector evaluator sees
		// the input so pivots, request.security(), and mutable objects cannot
		// observe a future bar.
		req.Candles = candlesThroughReplayCutoff(req.Candles, *req.ReplayCutoff)
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
	if result, handled, errors := compileStatefulPine(ctx, req, id); handled {
		resp.Result = result
		resp.Result.ID = id
		resp.Errors = append(resp.Errors, errors...)
		applyIndicatorOutputPresentation(&resp.Result, meta, req.StyleOverrides)
		if req.ReplayCutoff != nil {
			resp.Result = clampIndicatorResultToReplay(resp.Result, *req.ReplayCutoff)
		}
		return resp
	}
	cleaned := normalizeSource(req.SourceCode)
	evalCtx := &evalContext{
		candles:        req.Candles,
		variables:      map[string]pineValue{},
		functions:      map[string]pineFunction{},
		inputOverrides: req.InputOverrides,
		symbol: pineSymbolInfo{
			tickerID: strings.TrimSpace(req.Symbol),
			kind:     strings.TrimSpace(req.SymbolType),
			mintick:  req.Mintick,
			timezone: strings.TrimSpace(req.Timezone),
		},
	}
	readAssignments(cleaned, evalCtx, &resp.Errors)

	// Assignments establish the immutable evaluation context. The three output
	// branches below are independent and can be evaluated concurrently while
	// preserving their historical fill/hline, plot, object result ordering.
	type compileOutput struct {
		series    []IndicatorSeries
		labels    []IndicatorOverlayLabel
		dashboard *IndicatorDashboard
		errors    []RuntimeError
	}
	jobs := []orderedJob[compileOutput]{
		func(context.Context) (compileOutput, error) {
			output := compileOutput{errors: []RuntimeError{}}
			hlines := readHlines(cleaned, evalCtx, req.StyleOverrides, &output.errors)
			output.series = append(output.series, readFills(cleaned, evalCtx, hlines, req.Candles, req.StyleOverrides, &output.errors)...)
			for _, line := range hlines {
				if !line.visible {
					continue
				}
				extendToVisibleRange := true
				output.series = append(output.series, IndicatorSeries{
					Key: line.title, Color: line.color, Data: flatLinePoints(line.value, req.Candles), Type: "line",
					LineWidth: &line.lineWidth, LineStyle: &line.lineStyle, ExtendToVisibleRange: &extendToVisibleRange,
				})
			}
			return output, nil
		},
		func(context.Context) (compileOutput, error) {
			output := compileOutput{errors: []RuntimeError{}}
			output.series = readPlots(cleaned, evalCtx, req.Candles, req.StyleOverrides, &output.errors)
			return output, nil
		},
		func(context.Context) (compileOutput, error) {
			output := compileOutput{errors: []RuntimeError{}}
			objectResult := compileObjectRuntime(cleaned, req.Candles, id, evalCtx, req.StyleOverrides, &output.errors)
			if objectResult != nil {
				output.series = objectResult.Series
				output.labels = objectResult.Labels
				output.dashboard = objectResult.Dashboard
			}
			return output, nil
		},
	}
	outputs, err := runOrderedJobs(ctx, jobs, len(jobs))
	if err != nil {
		resp.Errors = append(resp.Errors, RuntimeError{Message: err.Error()})
		return resp
	}
	for _, output := range outputs {
		resp.Result.Series = append(resp.Result.Series, output.series...)
		resp.Result.Labels = append(resp.Result.Labels, output.labels...)
		if output.dashboard != nil {
			resp.Result.Dashboard = output.dashboard
		}
		resp.Errors = append(resp.Errors, output.errors...)
	}
	if len(resp.Result.Series) == 0 && len(resp.Result.Labels) == 0 && resp.Result.Dashboard == nil && len(resp.Errors) == 0 {
		resp.Errors = append(resp.Errors, RuntimeError{Message: "No supported plot(), hline(), fill(), or drawing object output found"})
	}
	applyIndicatorOutputPresentation(&resp.Result, meta, req.StyleOverrides)
	if req.ReplayCutoff != nil {
		resp.Result = clampIndicatorResultToReplay(resp.Result, *req.ReplayCutoff)
	}
	return resp
}

func unsupportedFeatures(source string) []string {
	features := []string{}
	cleaned := normalizeSource(source)
	checks := []struct {
		name    string
		pattern string
	}{
		{name: "strategies and broker orders", pattern: `(?m)\b(strategy\s*\(|strategy\.)`},
		{name: "libraries and imports", pattern: `(?m)^\s*(library|import|export)\b`},
		{name: "maps, matrices, and polylines", pattern: `\b(map\.|matrix\.|polyline\.)`},
		{name: "legacy collection constructors", pattern: `\b(array\.new_(float|int|bool|string|line|box|label)|array\.from)\s*\(`},
		{name: "while loops", pattern: `(?m)^\s*while\b`},
		{name: "lower-timeframe array requests", pattern: `\brequest\.security_lower_tf\s*\(`},
		{name: "request.security lookahead_on", pattern: `\bbarmerge\.lookahead_on\b`},
		{name: "request.security gaps_on", pattern: `\bbarmerge\.gaps_on\b`},
		{name: "unsupported visual calls", pattern: `\b(plotshape|plotchar|plotcandle|plotbar|barcolor|bgcolor)\s*\(`},
		{name: "realtime varip semantics", pattern: `\bvarip\b`},
		{name: "realtime rollback semantics", pattern: `\bbarstate\.isrealtime\b`},
		{name: "alert event delivery", pattern: `\b(alert|alertcondition)\s*\(`},
	}
	for _, check := range checks {
		if regexp.MustCompile(check.pattern).MatchString(cleaned) {
			features = append(features, check.name)
		}
	}
	if unsupportedRequestSecuritySymbol(cleaned) {
		features = append(features, "multi-symbol data requests")
	}
	return features
}

func unsupportedRequestSecuritySymbol(source string) bool {
	for _, body := range findCallBodies(source, "request.security") {
		args := parseCallArguments(body)
		symbol := strings.TrimSpace(rawArg(args, "symbol", 0))
		switch symbol {
		case "", "syminfo.tickerid", "syminfo.main_tickerid":
			// Empty/current-symbol identifiers are the only data contexts this
			// runtime can evaluate without a second market-data stream.
		default:
			return true
		}
	}
	return false
}

func blockingUnsupportedFeatures(source string) []string {
	blocked := []string{}
	for _, feature := range unsupportedFeatures(source) {
		switch feature {
		case "alert event delivery", "realtime rollback semantics":
			// These do not affect historical chart primitives. Report them in
			// UnsupportedFeatures while still compiling the closed-bar output.
			continue
		default:
			blocked = append(blocked, feature)
		}
	}
	return blocked
}

func unsupportedDeclarationExecutionProperties(meta ScriptMeta) []string {
	properties := meta.Properties
	if len(properties) == 0 {
		return nil
	}
	blocked := []string{}
	// A non-empty declaration timeframe changes the dataset on which the whole
	// script executes. Compile() only owns the candles supplied by its caller,
	// so pretending to apply this property would produce valid-looking but
	// semantically different output.
	if meta.Timeframe != "" {
		blocked = append(blocked, "timeframe/resolution")
	}
	for _, key := range []string{"timeframe_gaps", "resolution_gaps", "calc_bars_count", "dynamic_requests"} {
		if _, ok := properties[key]; ok {
			blocked = append(blocked, key)
		}
	}
	return blocked
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
			expression := strings.TrimSpace(match[3])
			if expression == "" {
				parsed, end, err := parsePineFunctionBody(lines, index, line.indent)
				if err != nil {
					*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
					continue
				}
				expression = parsed
				index = end - 1
			}
			context.functions[match[1]] = pineFunction{
				params:     functionParameterNames(match[2]),
				expression: expression,
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
		if isPineIfExpressionStart(expression) {
			parsed, end, err := parsePineIfExpression(lines, index, line.indent, expression)
			if err != nil {
				*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
				continue
			}
			expression = parsed
			index = end - 1
		}
		value, err := evaluateAssignmentValue(name, expression, context)
		if err != nil {
			*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
			continue
		}
		context.variables[name] = value
		context.assignments = append(context.assignments, pineAssignment{name: name, expression: expression})
	}
}

func evaluateAssignmentValue(name string, expression string, context *evalContext) (pineValue, error) {
	value, err := evaluateInputExpression(expression, context, name)
	if err != nil {
		return pineValue{}, err
	}
	if value.kind == 0 && len(expression) > 0 && !isNumberZeroValue(value) {
		// no-op; see the non-input fallback below
	}
	if value.kind == 0 && value.number == 0 && !isInputExpression(expression) {
		if recursive, ok := evaluateRecursiveAssignment(name, expression, context); ok {
			return recursive, nil
		}
		if self, ok := evaluateSelfReferentialAssignment(name, expression, context); ok {
			return self, nil
		}
		return evaluateExpression(expression, context)
	}
	return value, nil
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
	if elseLine.indent != indent {
		return "", trueEnd, fmt.Errorf("Pine if-expression missing else branch")
	}
	if strings.HasPrefix(elseLine.text, "else if ") || strings.HasPrefix(elseLine.text, "else if(") {
		nested, falseEnd, err := parsePineIfExpression(
			lines,
			trueEnd,
			indent,
			strings.TrimSpace(strings.TrimPrefix(elseLine.text, "else ")),
		)
		if err != nil {
			return "", falseEnd, err
		}
		return fmt.Sprintf("(%s) ? (%s) : (%s)", condition, whenTrue, nested), falseEnd, nil
	}
	if elseLine.text != "else" {
		return "", trueEnd, fmt.Errorf("Pine if-expression missing else branch")
	}
	whenFalse, falseEnd, err := parsePineIfBranch(lines, trueEnd+1, indent)
	if err != nil {
		return "", trueEnd + 1, err
	}
	return fmt.Sprintf("(%s) ? (%s) : (%s)", condition, whenTrue, whenFalse), falseEnd, nil
}

func parsePineFunctionBody(lines []sourceLine, startIndex int, parentIndent int) (string, int, error) {
	index := startIndex + 1
	for index < len(lines) && lines[index].text == "" {
		index++
	}
	if index >= len(lines) || lines[index].indent <= parentIndent {
		return "", index, fmt.Errorf("Pine function body is empty")
	}
	if isPineIfExpressionStart(lines[index].text) {
		return parsePineIfExpression(lines, index, lines[index].indent, lines[index].text)
	}
	if isPineSwitchExpressionStart(lines[index].text) {
		return parsePineSwitchExpression(lines, index, lines[index].indent, lines[index].text)
	}
	return parsePineIfBranch(lines, index, parentIndent)
}

func isPineIfExpressionStart(text string) bool {
	trimmed := strings.TrimSpace(text)
	return trimmed == "if" || strings.HasPrefix(trimmed, "if ") || strings.HasPrefix(trimmed, "if(")
}

func isPineSwitchExpressionStart(text string) bool {
	trimmed := strings.TrimSpace(text)
	return trimmed == "switch" || strings.HasPrefix(trimmed, "switch ")
}

func parsePineSwitchExpression(lines []sourceLine, startIndex int, indent int, firstText string) (string, int, error) {
	selector := strings.TrimSpace(strings.TrimPrefix(firstText, "switch"))
	index := startIndex + 1
	for index < len(lines) && lines[index].text == "" {
		index++
	}
	if index >= len(lines) || lines[index].indent <= indent {
		return "", index, fmt.Errorf("Pine switch expression has no cases")
	}
	caseIndent := lines[index].indent
	type switchCase struct {
		condition string
		value     string
		fallback  bool
	}
	cases := []switchCase{}
	for index < len(lines) {
		line := lines[index]
		if line.text == "" {
			index++
			continue
		}
		if line.indent < caseIndent || line.indent <= indent {
			break
		}
		if line.indent > caseIndent {
			index++
			continue
		}
		arrow := strings.Index(line.text, "=>")
		if arrow < 0 {
			break
		}
		condition := strings.TrimSpace(line.text[:arrow])
		value := strings.TrimSpace(line.text[arrow+2:])
		if value == "" {
			value = "na"
		}
		if isPineIfExpressionStart(value) {
			parsed, end, err := parsePineIfExpression(lines, index, line.indent, value)
			if err != nil {
				return "", end, err
			}
			value = parsed
			index = end
		} else if isPineSwitchExpressionStart(value) {
			parsed, end, err := parsePineSwitchExpression(lines, index, line.indent, value)
			if err != nil {
				return "", end, err
			}
			value = parsed
			index = end
		} else {
			index++
		}
		cases = append(cases, switchCase{
			condition: condition,
			value:     value,
			fallback:  condition == "",
		})
	}
	expression := "na"
	for _, item := range cases {
		if item.fallback {
			expression = item.value
		}
	}
	for i := len(cases) - 1; i >= 0; i-- {
		item := cases[i]
		if item.fallback {
			continue
		}
		condition := item.condition
		if selector != "" {
			condition = fmt.Sprintf("%s == %s", selector, item.condition)
		}
		expression = fmt.Sprintf("(%s) ? (%s) : (%s)", condition, item.value, expression)
	}
	return expression, index, nil
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
			if isPineIfExpressionStart(value) {
				parsed, end, err := parsePineIfExpression(lines, index, line.indent, value)
				if err != nil {
					return "", end, err
				}
				value = parsed
				index = end
			} else if isPineSwitchExpressionStart(value) {
				parsed, end, err := parsePineSwitchExpression(lines, index, line.indent, value)
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
		if isPineIfExpressionStart(line.text) {
			parsed, end, err := parsePineIfExpression(lines, index, line.indent, line.text)
			if err != nil {
				return "", end, err
			}
			expression = parsed
			index = end
			continue
		}
		if isPineSwitchExpressionStart(line.text) {
			parsed, end, err := parsePineSwitchExpression(lines, index, line.indent, line.text)
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
			symbol:         context.symbol,
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
			// Plot style normalization may rewrite the returned colors (for
			// example when applying transp). Keep the evaluator's immutable
			// series backing storage isolated from concurrent output branches.
			return base, append([]string(nil), value.colors...)
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
		editable := visualEditable(args)
		// A scalar override cannot faithfully replace a series-color palette.
		// Preserve Pine's per-bar colors even when an older persisted instance
		// still contains the fallback color previously generated by the UI.
		if editable && len(colors) == 0 {
			color = styleColorValue(styles, key, color)
		}
		widthExpr := args.named["linewidth"]
		if widthExpr == "" && len(args.positional) > 3 {
			widthExpr = args.positional[3]
		}
		lineWidth := lineWidth(widthExpr, 2)
		lineStyle := lineStyle(args.named["linestyle"])
		if editable {
			lineWidth = styleLineWidthValue(styles, key, lineWidth)
			lineStyle = styleLineStyleValue(styles, key, lineStyle)
		}
		styleExpr := args.named["style"]
		if styleExpr == "" && len(args.positional) > 4 {
			styleExpr = args.positional[4]
		}
		seriesType := plotType(styleExpr)
		base := IndicatorSeries{
			Key:       title,
			Color:     color,
			Type:      seriesType,
			LineWidth: &lineWidth,
			LineStyle: &lineStyle,
		}
		values := toSeries(value, len(candles))
		if seriesType == "line" && plotLineBreak(styleExpr) {
			out = append(out, lineBreakPlotSeries(base, values, candles, colors)...)
			continue
		}
		base.Data = seriesToLinePoints(values, candles, colors)
		out = append(out, base)
	}
	return out
}

func boolPtr(value bool) *bool { return &value }

func lineBreakPlotSeries(base IndicatorSeries, values []float64, candles []Candle, colors []string) []IndicatorSeries {
	out := []IndicatorSeries{}
	segment := []LinePoint{}
	seen := map[int64]bool{}
	flush := func() {
		if len(segment) < 2 {
			segment = []LinePoint{}
			return
		}
		item := base
		item.Key = fmt.Sprintf("%s:%d", base.Key, len(out)+1)
		item.Data = segment
		item.LastValueVisible = boolPtr(false)
		item.StatusLineVisible = boolPtr(false)
		out = append(out, item)
		segment = []LinePoint{}
	}
	for i, value := range values {
		if i >= len(candles) {
			break
		}
		if !usable(value) {
			flush()
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
		segment = append(segment, point)
	}
	flush()
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
		color, _ := resolvePlotColor(colorExpr, context, defaultColors[len(out)%len(defaultColors)])
		out = append(out, hlineDef{
			id:        id,
			title:     title,
			value:     price,
			visible:   styleVisible(styles, key),
			color:     styleColorValue(styles, key, color),
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
		color, _ := resolvePlotColor(colorExpr, context, "#e040fb")
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
		extendToVisibleRange := true
		out = append(out, IndicatorSeries{
			Key:                  title,
			Color:                color,
			Type:                 "baselineFill",
			BaseValue:            &low,
			LineVisible:          &lineVisible,
			LastValueVisible:     &lastValueVisible,
			ExtendToVisibleRange: &extendToVisibleRange,
			Data:                 flatLinePoints(high, candles),
		})
	}
	return out
}
