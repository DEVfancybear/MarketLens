package pineruntime

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"
)

const objectRightExtensionBars = 12

type pineObjectCall struct {
	line       sourceLine
	variable   string
	args       callArguments
	condition  string
	persistent bool
}

// compileObjectRuntime turns Pine's mutable drawing handles into immutable
// series/labels/dashboard output. This is intentionally source-structure aware:
// constructors and setters carry geometry, style, and enclosing `if` conditions
// that would be lost if they were treated like numeric functions.
func compileObjectRuntime(cleaned string, candles []Candle, indicatorID string, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) *IndicatorResult {
	if !regexp.MustCompile(`(?:line|box|label|table)\.(?:new|set_|cell)\s*\(`).MatchString(cleaned) {
		return nil
	}
	lines := sourceLines(cleaned)
	result := IndicatorResult{ID: indicatorID, Series: []IndicatorSeries{}}

	properties := ExtractMeta(cleaned).Properties
	boxes := compileBoxObjects(lines, candles, context, styles, errors)
	linesOutput := compileLineObjects(lines, candles, context, styles, errors)
	labels := compileLabelObjects(lines, candles, context, styles, errors)
	result.Series = append(result.Series, tailSeries(boxes, declarationObjectLimit(properties, "max_boxes_count"))...)
	result.Series = append(result.Series, tailSeries(linesOutput, declarationObjectLimit(properties, "max_lines_count"))...)
	result.Labels = append(result.Labels, tailLabels(labels, declarationObjectLimit(properties, "max_labels_count"))...)
	if dashboard := compileTableDashboard(lines, context, errors); dashboard != nil {
		result.Dashboard = dashboard
	}

	if len(result.Series) == 0 && len(result.Labels) == 0 && result.Dashboard == nil {
		return nil
	}
	return &result
}

func declarationObjectLimit(properties map[string]any, key string) int {
	const pineDefault = 50
	switch value := properties[key].(type) {
	case int:
		if value > 0 {
			return value
		}
	case float64:
		if value > 0 {
			return int(value)
		}
	}
	return pineDefault
}

func tailSeries(values []IndicatorSeries, limit int) []IndicatorSeries {
	ordered := append([]IndicatorSeries(nil), values...)
	sort.SliceStable(ordered, func(left, right int) bool {
		if ordered[left].objectCreationIndex != ordered[right].objectCreationIndex {
			return ordered[left].objectCreationIndex < ordered[right].objectCreationIndex
		}
		return ordered[left].objectSourceLine < ordered[right].objectSourceLine
	})
	if limit <= 0 || len(ordered) <= limit {
		return ordered
	}
	return ordered[len(ordered)-limit:]
}

func tailLabels(values []IndicatorOverlayLabel, limit int) []IndicatorOverlayLabel {
	ordered := append([]IndicatorOverlayLabel(nil), values...)
	sort.SliceStable(ordered, func(left, right int) bool {
		if ordered[left].objectCreationIndex != ordered[right].objectCreationIndex {
			return ordered[left].objectCreationIndex < ordered[right].objectCreationIndex
		}
		return ordered[left].objectSourceLine < ordered[right].objectSourceLine
	})
	if limit <= 0 || len(ordered) <= limit {
		return ordered
	}
	return ordered[len(ordered)-limit:]
}

func objectAssignmentRegex(apiName string) *regexp.Regexp {
	escaped := strings.ReplaceAll(apiName, ".", `\.`)
	return regexp.MustCompile(`^(?:(?:(?:var|varip|const|simple|series)\s+)*(?:line|label|box|table)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*` + escaped + `\s*\(`)
}

func objectCreationCalls(lines []sourceLine, apiName string) []pineObjectCall {
	out := []pineObjectCall{}
	re := objectAssignmentRegex(apiName)
	bareCall := regexp.MustCompile(`^` + regexp.QuoteMeta(apiName) + `\s*\(`)
	logicalLines := coalesceObjectCallLines(lines, apiName)
	for index, line := range logicalLines {
		match := re.FindStringSubmatch(line.text)
		bodies := findCallBodies(line.text, apiName)
		if len(bodies) == 0 {
			continue
		}
		variable := ""
		if len(match) > 0 {
			variable = match[1]
		} else if bareCall.MatchString(strings.TrimSpace(line.text)) {
			// Pine permits bare drawing constructors. Give them a stable synthetic
			// handle so the common style/segment machinery still applies.
			variable = fmt.Sprintf("%s_%d", strings.ReplaceAll(apiName, ".", "_"), index+1)
		} else {
			continue
		}
		out = append(out, pineObjectCall{
			line:       line,
			variable:   variable,
			args:       parseCallArguments(bodies[0]),
			condition:  enclosingIfCondition(logicalLines, index),
			persistent: regexp.MustCompile(`^(?:var|varip)\b`).MatchString(strings.TrimSpace(line.text)),
		})
	}
	return out
}

// coalesceObjectCallLines keeps the vector object scanner source-line based,
// while accepting Pine's valid multiline constructor formatting. Consumed
// continuation lines remain as empty placeholders so physical line indexes and
// enclosing block indentation stay stable for condition analysis.
func coalesceObjectCallLines(lines []sourceLine, apiName string) []sourceLine {
	logical := append([]sourceLine(nil), lines...)
	callPattern := regexp.MustCompile(regexp.QuoteMeta(apiName) + `\s*\(`)
	for index := 0; index < len(logical); index++ {
		if !callPattern.MatchString(logical[index].text) || statefulDelimiterBalance(logical[index].text) <= 0 {
			continue
		}
		combined := logical[index].text
		end := index
		for end+1 < len(logical) && statefulDelimiterBalance(combined) > 0 {
			end++
			if strings.TrimSpace(logical[end].text) == "" {
				continue
			}
			combined += " " + strings.TrimSpace(logical[end].text)
		}
		if statefulDelimiterBalance(combined) != 0 {
			continue
		}
		logical[index].text = combined
		for consumed := index + 1; consumed <= end; consumed++ {
			logical[consumed].text = ""
		}
		index = end
	}
	return logical
}

func enclosingIfCondition(lines []sourceLine, index int) string {
	conditions := []string{}
	currentIndex := index
	currentIndent := lines[index].indent
	for {
		found := false
		for cursor := currentIndex - 1; cursor >= 0; cursor-- {
			candidate := lines[cursor]
			if candidate.text == "" || candidate.indent >= currentIndent {
				continue
			}
			condition := branchPredicate(lines, cursor)
			if condition != "" {
				conditions = append(conditions, condition)
				currentIndex = cursor
				currentIndent = candidate.indent
				found = true
				break
			}
			// The first non-conditional statement at column zero proves there is
			// no enclosing ancestor block beyond this point.
			if candidate.indent == 0 {
				break
			}
		}
		if !found {
			break
		}
	}
	if len(conditions) == 0 {
		return ""
	}
	parts := make([]string, 0, len(conditions))
	for index := len(conditions) - 1; index >= 0; index-- {
		parts = append(parts, "("+conditions[index]+")")
	}
	return strings.Join(parts, " and ")
}

func branchPredicate(lines []sourceLine, index int) string {
	candidate := lines[index]
	if strings.HasPrefix(candidate.text, "else") {
		branch := strings.TrimSpace(strings.TrimPrefix(candidate.text, "else"))
		parents := precedingBranchConditions(lines, index, candidate.indent)
		if strings.HasPrefix(branch, "if ") || strings.HasPrefix(branch, "if(") {
			conditions := append([]string{}, parents...)
			conditions = append(conditions, branchCondition(branch))
			return conjunctionWithNegatedParents(conditions)
		}
		if len(parents) > 0 {
			parts := make([]string, 0, len(parents))
			for _, parent := range parents {
				parts = append(parts, fmt.Sprintf("not (%s)", parent))
			}
			return strings.Join(parts, " and ")
		}
		return ""
	}
	if strings.HasPrefix(candidate.text, "if ") || candidate.text == "if" || strings.HasPrefix(candidate.text, "if(") {
		return branchCondition(candidate.text)
	}
	return ""
}

func branchCondition(text string) string {
	condition := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(text, "if"), "("))
	if strings.HasPrefix(text, "if(") && strings.HasSuffix(condition, ")") {
		condition = strings.TrimSuffix(condition, ")")
	}
	return condition
}

func conjunctionWithNegatedParents(conditions []string) string {
	if len(conditions) == 0 {
		return ""
	}
	parts := make([]string, 0, len(conditions))
	for index, condition := range conditions {
		if index == len(conditions)-1 {
			parts = append(parts, "("+condition+")")
		} else {
			parts = append(parts, fmt.Sprintf("not (%s)", condition))
		}
	}
	return strings.Join(parts, " and ")
}

func precedingBranchConditions(lines []sourceLine, index, indent int) []string {
	conditions := []string{}
	for cursor := index - 1; cursor >= 0; cursor-- {
		candidate := lines[cursor]
		if candidate.indent < indent {
			break
		}
		if candidate.indent != indent {
			continue
		}
		if strings.HasPrefix(candidate.text, "if ") || candidate.text == "if" {
			conditions = append(conditions, branchCondition(candidate.text))
			break
		}
		if strings.HasPrefix(candidate.text, "else if ") || strings.HasPrefix(candidate.text, "else if(") {
			conditions = append(conditions, branchCondition(strings.TrimSpace(strings.TrimPrefix(candidate.text, "else"))))
		}
	}
	for left, right := 0, len(conditions)-1; left < right; left, right = left+1, right-1 {
		conditions[left], conditions[right] = conditions[right], conditions[left]
	}
	return conditions
}

func conditionIndices(condition string, context *evalContext, errors *[]RuntimeError, lineNumber int) []int {
	if strings.TrimSpace(condition) == "" {
		return []int{0}
	}
	value, err := evaluateExpression(condition, context)
	if err != nil {
		*errors = append(*errors, RuntimeError{Line: lineNumber, Message: err.Error()})
		return []int{}
	}
	out := []int{}
	for index := range context.candles {
		if truthyAt(value, index, len(context.candles)) {
			out = append(out, index)
		}
	}
	return out
}

func objectCreationIndices(call pineObjectCall, context *evalContext, errors *[]RuntimeError) []int {
	starts := conditionIndices(call.condition, context, errors, call.line.number)
	if strings.TrimSpace(call.condition) == "" && !call.persistent {
		starts = make([]int, len(context.candles))
		for index := range starts {
			starts[index] = index
		}
	}
	if call.persistent && len(starts) > 1 {
		return starts[:1]
	}
	return starts
}

func rawArg(args callArguments, name string, index int) string {
	if value := args.named[name]; value != "" {
		return value
	}
	if index >= 0 && index < len(args.positional) {
		return args.positional[index]
	}
	return ""
}

func objectSetterExpression(lines []sourceLine, apiName string, variable string, method string, argIndex int) string {
	callName := apiName + ".set_" + method
	callPattern := regexp.MustCompile(`^` + regexp.QuoteMeta(callName) + `\s*\(`)
	for _, line := range coalesceObjectCallLines(lines, callName) {
		if !callPattern.MatchString(line.text) {
			continue
		}
		bodies := findCallBodies(line.text, callName)
		if len(bodies) == 0 {
			continue
		}
		args := parseCallArguments(bodies[0])
		if len(args.positional) > 0 && strings.TrimSpace(args.positional[0]) == variable && argIndex < len(args.positional) {
			return args.positional[argIndex]
		}
	}
	return ""
}

func numberExpressionAt(expression string, index int, context *evalContext) float64 {
	if strings.TrimSpace(expression) == "" {
		return math.NaN()
	}
	value, err := evaluateExpression(expression, context)
	if err != nil {
		return math.NaN()
	}
	return getAt(value, index, len(context.candles))
}

func colorExpressionAt(expression string, index int, context *evalContext, fallback string) string {
	trimmed := strings.TrimSpace(expression)
	if trimmed == "" {
		return fallback
	}
	compact := strings.ReplaceAll(strings.ReplaceAll(trimmed, " ", ""), "\t", "")
	if compact == "na" || compact == "color(na)" {
		return "transparent"
	}
	value, err := evaluateExpression(expression, context)
	if err == nil {
		if value.kind == kindNumber && !usable(value.number) {
			return "transparent"
		}
		if value.kind == kindColorSeries && index >= 0 && index < len(value.colors) && value.colors[index] == "" {
			return "transparent"
		}
		if color := colorAt(value, index); color != "" {
			return color
		}
	}
	return resolveColor(expression, fallback)
}

func textExpressionAt(expression string, index int, context *evalContext) string {
	if strings.TrimSpace(expression) == "" {
		return ""
	}
	scalar := scalarContextAt(context, index)
	value, err := evaluateExpression(expression, scalar)
	if err == nil {
		return stringAt(value, 0, 1)
	}
	if text, ok := unquote(expression); ok {
		return text
	}
	return ""
}

func scalarContextAt(context *evalContext, index int) *evalContext {
	scalar := &evalContext{
		candles:        []Candle{},
		variables:      map[string]pineValue{},
		functions:      context.functions,
		inputOverrides: context.inputOverrides,
	}
	if index >= 0 && index < len(context.candles) {
		scalar.candles = []Candle{context.candles[index]}
	}
	for key, value := range context.variables {
		scalar.variables[key] = scalarValueAt(value, index, len(context.candles))
	}
	return scalar
}

func objectLineWidth(expression string, index int, context *evalContext) int {
	value := numberExpressionAt(expression, index, context)
	if !usable(value) {
		return 2
	}
	return int(math.Max(1, math.Min(4, math.Round(value))))
}

func enumExpression(expression string, fallback string) string {
	if value, ok := unquote(expression); ok {
		return value
	}
	if strings.TrimSpace(expression) != "" {
		return strings.TrimSpace(expression)
	}
	return fallback
}

func barIndexToTime(index float64, candles []Candle) (int64, bool) {
	if len(candles) == 0 || !usable(index) {
		return 0, false
	}
	rounded := int(math.Round(index))
	if rounded >= 0 && rounded < len(candles) {
		return candles[rounded].Time, true
	}
	step := candleStepSeconds(candles)
	if rounded < 0 {
		return candles[0].Time + int64(rounded)*step, true
	}
	return candles[len(candles)-1].Time + int64(rounded-len(candles)+1)*step, true
}

func objectXTime(expression string, evalIndex int, context *evalContext, xloc string) (int64, bool) {
	value := numberExpressionAt(expression, evalIndex, context)
	if !usable(value) {
		return 0, false
	}
	if xloc == "xloc.bar_time" {
		if value > 10_000_000_000 {
			return int64(value / 1000), true
		}
		return int64(value), true
	}
	return barIndexToTime(value, context.candles)
}

func objectLinePointsFromCoords(args struct {
	x1Expression string
	y1Expression string
	x2Expression string
	y2Expression string
	x1Index      int
	y1Index      int
	x2Index      int
	y2Index      int
	extendRight  bool
	xloc         string
	color        string
}, context *evalContext) []LinePoint {
	x1, ok1 := objectXTime(args.x1Expression, args.x1Index, context, args.xloc)
	x2, ok2 := objectXTime(args.x2Expression, args.x2Index, context, args.xloc)
	y1 := numberExpressionAt(args.y1Expression, args.y1Index, context)
	y2 := numberExpressionAt(args.y2Expression, args.y2Index, context)
	if !ok1 || !ok2 || !usable(y1) || !usable(y2) {
		return []LinePoint{}
	}
	out := []LinePoint{{Time: x1, Value: y1}}
	if args.color != "" {
		out[0].Color = &args.color
	}
	if x2 != x1 || y2 != y1 {
		point := LinePoint{Time: x2, Value: y2}
		if args.color != "" {
			point.Color = &args.color
		}
		out = append(out, point)
	}
	if args.extendRight {
		step := candleStepSeconds(context.candles)
		for offset := 1; offset <= objectRightExtensionBars; offset++ {
			point := LinePoint{Time: x2 + int64(offset)*step, Value: y2}
			if args.color != "" {
				point.Color = &args.color
			}
			out = append(out, point)
		}
	}
	return out
}

func objectBoxFillPointsFromCoords(args struct {
	leftExpression  string
	topExpression   string
	rightExpression string
	leftIndex       int
	topIndex        int
	rightIndex      int
	extendRight     bool
	xloc            string
}, context *evalContext) []LinePoint {
	left, okLeft := objectXTime(args.leftExpression, args.leftIndex, context, args.xloc)
	right, okRight := objectXTime(args.rightExpression, args.rightIndex, context, args.xloc)
	top := numberExpressionAt(args.topExpression, args.topIndex, context)
	if !okLeft || !okRight || !usable(top) {
		return []LinePoint{}
	}
	out := []LinePoint{{Time: left, Value: top}}
	if right != left {
		out = append(out, LinePoint{Time: right, Value: top})
	}
	if args.extendRight {
		step := candleStepSeconds(context.candles)
		for offset := 1; offset <= objectRightExtensionBars; offset++ {
			out = append(out, LinePoint{Time: right + int64(offset)*step, Value: top})
		}
	}
	return out
}

func segmentEndTime(candles []Candle, endIndex int, extendRight bool) *int64 {
	if endIndex < 0 || endIndex >= len(candles) {
		return nil
	}
	value := candles[endIndex].Time
	if extendRight {
		value += candleStepSeconds(candles) * objectRightExtensionBars
	}
	return &value
}

func candleStepSeconds(candles []Candle) int64 {
	if len(candles) < 2 {
		return 60
	}
	step := candles[len(candles)-1].Time - candles[len(candles)-2].Time
	if step <= 0 {
		return 60
	}
	return step
}

func compileBoxObjects(lines []sourceLine, candles []Candle, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorSeries {
	out := []IndicatorSeries{}
	for _, call := range objectCreationCalls(lines, "box.new") {
		starts := objectCreationIndices(call, context, errors)
		leftSetter := objectSetterExpression(lines, "box", call.variable, "left", 1)
		rightSetter := objectSetterExpression(lines, "box", call.variable, "right", 1)
		topSetter := objectSetterExpression(lines, "box", call.variable, "top", 1)
		bottomSetter := objectSetterExpression(lines, "box", call.variable, "bottom", 1)
		colorSetter := objectSetterExpression(lines, "box", call.variable, "bgcolor", 1)
		leftExpression := firstNonEmpty(leftSetter, rawArg(call.args, "left", 0))
		rightExpression := firstNonEmpty(rightSetter, rawArg(call.args, "right", 2))
		topExpression := firstNonEmpty(topSetter, rawArg(call.args, "top", 1))
		bottomExpression := firstNonEmpty(bottomSetter, rawArg(call.args, "bottom", 3))
		colorExpression := firstNonEmpty(colorSetter, rawArg(call.args, "bgcolor", 9))
		xloc := enumExpression(rawArg(call.args, "xloc", 8), "xloc.bar_index")
		extendSetter := objectSetterExpression(lines, "box", call.variable, "extend", 1)
		extendExpression := firstNonEmpty(extendSetter, rawArg(call.args, "extend", 7))
		if leftExpression == "" || rightExpression == "" || topExpression == "" || bottomExpression == "" {
			continue
		}
		for segmentIndex, startIndex := range starts {
			endIndex := objectSegmentEnd(starts, segmentIndex, len(candles))
			extendRight := enumExpression(extendExpression, "extend.none") == "extend.right"
			rightUsesSetter := rightSetter != ""
			topUsesSetter := topSetter != ""
			bottomUsesSetter := bottomSetter != ""
			baseValue := numberExpressionAt(bottomExpression, chooseIndex(bottomUsesSetter, endIndex, startIndex), context)
			if !usable(baseValue) {
				continue
			}
			key := styleKey("box", call.variable)
			if !styleVisible(styles, key) {
				continue
			}
			colorIndex := chooseIndex(colorSetter != "", endIndex, startIndex)
			color := styleColorValue(styles, key, colorExpressionAt(colorExpression, colorIndex, context, defaultColors[len(out)%len(defaultColors)]))
			data := objectBoxFillPointsFromCoords(struct {
				leftExpression  string
				topExpression   string
				rightExpression string
				leftIndex       int
				topIndex        int
				rightIndex      int
				extendRight     bool
				xloc            string
			}{
				leftExpression:  leftExpression,
				topExpression:   topExpression,
				rightExpression: rightExpression,
				leftIndex:       chooseIndex(leftSetter != "", endIndex, startIndex),
				topIndex:        chooseIndex(topUsesSetter, endIndex, startIndex),
				rightIndex:      chooseIndex(rightUsesSetter, endIndex, startIndex),
				extendRight:     extendRight,
				xloc:            xloc,
			}, context)
			if len(data) == 0 {
				continue
			}
			lineVisible := false
			lastValueVisible := false
			out = append(out, IndicatorSeries{
				Key:                 fmt.Sprintf("%s_%d", call.variable, segmentIndex+1),
				Color:               color,
				Type:                "baselineFill",
				BaseValue:           &baseValue,
				LineVisible:         &lineVisible,
				LastValueVisible:    &lastValueVisible,
				Data:                data,
				objectCreationIndex: startIndex,
				objectSourceLine:    call.line.number,
			})
		}
	}
	return out
}

func compileLineObjects(lines []sourceLine, candles []Candle, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorSeries {
	out := []IndicatorSeries{}
	for _, call := range objectCreationCalls(lines, "line.new") {
		starts := objectCreationIndices(call, context, errors)
		x1Setter := objectSetterExpression(lines, "line", call.variable, "x1", 1)
		x2Setter := objectSetterExpression(lines, "line", call.variable, "x2", 1)
		y1Setter := objectSetterExpression(lines, "line", call.variable, "y1", 1)
		y2Setter := objectSetterExpression(lines, "line", call.variable, "y2", 1)
		x1Expression := firstNonEmpty(x1Setter, rawArg(call.args, "x1", 0))
		x2Expression := firstNonEmpty(x2Setter, rawArg(call.args, "x2", 2))
		y1Expression := firstNonEmpty(y1Setter, rawArg(call.args, "y1", 1))
		y2Expression := firstNonEmpty(y2Setter, rawArg(call.args, "y2", 3))
		xloc := enumExpression(rawArg(call.args, "xloc", 4), "xloc.bar_index")
		extendSetter := objectSetterExpression(lines, "line", call.variable, "extend", 1)
		extendExpression := firstNonEmpty(extendSetter, rawArg(call.args, "extend", 5))
		if x1Expression == "" || x2Expression == "" || y1Expression == "" || y2Expression == "" {
			continue
		}
		for segmentIndex, startIndex := range starts {
			endIndex := objectSegmentEnd(starts, segmentIndex, len(candles))
			extendRight := enumExpression(extendExpression, "extend.none") == "extend.right"
			colorSetter := objectSetterExpression(lines, "line", call.variable, "color", 1)
			colorExpression := firstNonEmpty(colorSetter, rawArg(call.args, "color", 6))
			key := styleKey("line", call.variable)
			if !styleVisible(styles, key) {
				continue
			}
			color := styleColorValue(styles, key, colorExpressionAt(colorExpression, chooseIndex(colorSetter != "", endIndex, startIndex), context, defaultColors[len(out)%len(defaultColors)]))
			data := objectLinePointsFromCoords(struct {
				x1Expression string
				y1Expression string
				x2Expression string
				y2Expression string
				x1Index      int
				y1Index      int
				x2Index      int
				y2Index      int
				extendRight  bool
				xloc         string
				color        string
			}{
				x1Expression: x1Expression,
				y1Expression: y1Expression,
				x2Expression: x2Expression,
				y2Expression: y2Expression,
				x1Index:      chooseIndex(x1Setter != "", endIndex, startIndex),
				y1Index:      chooseIndex(y1Setter != "", endIndex, startIndex),
				x2Index:      chooseIndex(x2Setter != "", endIndex, startIndex),
				y2Index:      chooseIndex(y2Setter != "", endIndex, startIndex),
				extendRight:  extendRight,
				xloc:         xloc,
				color:        color,
			}, context)
			if len(data) == 0 {
				continue
			}
			widthSetter := objectSetterExpression(lines, "line", call.variable, "width", 1)
			width := styleLineWidthValue(styles, key, objectLineWidth(firstNonEmpty(widthSetter, rawArg(call.args, "width", 8)), chooseIndex(widthSetter != "", endIndex, startIndex), context))
			lineStyleValue := styleLineStyleValue(styles, key, lineStyle(rawArg(call.args, "style", 7)))
			lastValueVisible := false
			out = append(out, IndicatorSeries{
				Key:                 fmt.Sprintf("%s_%d", call.variable, segmentIndex+1),
				Color:               color,
				Type:                "line",
				LineWidth:           &width,
				LineStyle:           &lineStyleValue,
				LastValueVisible:    &lastValueVisible,
				Data:                data,
				objectCreationIndex: startIndex,
				objectSourceLine:    call.line.number,
			})
		}
	}
	return out
}

func compileLabelObjects(lines []sourceLine, candles []Candle, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorOverlayLabel {
	out := []IndicatorOverlayLabel{}
	for _, call := range objectCreationCalls(lines, "label.new") {
		starts := objectCreationIndices(call, context, errors)
		xSetter := objectSetterExpression(lines, "label", call.variable, "xy", 1)
		ySetter := objectSetterExpression(lines, "label", call.variable, "xy", 2)
		textSetter := objectSetterExpression(lines, "label", call.variable, "text", 1)
		backgroundSetter := objectSetterExpression(lines, "label", call.variable, "color", 1)
		colorSetter := objectSetterExpression(lines, "label", call.variable, "textcolor", 1)
		tooltipSetter := objectSetterExpression(lines, "label", call.variable, "tooltip", 1)
		styleSetter := objectSetterExpression(lines, "label", call.variable, "style", 1)
		xExpression := firstNonEmpty(xSetter, rawArg(call.args, "x", 0))
		yExpression := firstNonEmpty(ySetter, rawArg(call.args, "y", 1))
		textExpression := firstNonEmpty(textSetter, rawArg(call.args, "text", 2))
		backgroundExpression := firstNonEmpty(backgroundSetter, rawArg(call.args, "color", 5))
		colorExpression := firstNonEmpty(colorSetter, rawArg(call.args, "textcolor", 7))
		tooltipExpression := firstNonEmpty(tooltipSetter, rawArg(call.args, "tooltip", 10))
		xloc := enumExpression(rawArg(call.args, "xloc", 3), "xloc.bar_index")
		labelStyle := enumExpression(firstNonEmpty(styleSetter, rawArg(call.args, "style", 6)), "label.style_label_down")
		if yExpression == "" {
			continue
		}
		for segmentIndex, startIndex := range starts {
			endIndex := objectSegmentEnd(starts, segmentIndex, len(candles))
			labelIndex := chooseIndex(ySetter != "", endIndex, startIndex)
			price := numberExpressionAt(yExpression, labelIndex, context)
			if !usable(price) {
				continue
			}
			key := styleKey("label", call.variable)
			if !styleVisible(styles, key) {
				continue
			}
			textIndex := chooseIndex(textSetter != "", endIndex, startIndex)
			backgroundIndex := chooseIndex(backgroundSetter != "", endIndex, startIndex)
			colorIndex := chooseIndex(colorSetter != "", endIndex, startIndex)
			tooltipIndex := chooseIndex(tooltipSetter != "", endIndex, startIndex)
			text := textExpressionAt(textExpression, textIndex, context)
			if strings.TrimSpace(text) == "" {
				continue
			}
			anchorTime, hasAnchor := objectXTime(xExpression, chooseIndex(xSetter != "", endIndex, startIndex), context, xloc)
			rightEdgeTime := segmentEndTime(candles, endIndex, false)
			var labelTime *int64
			if hasAnchor {
				labelTime = &anchorTime
			} else {
				labelTime = rightEdgeTime
			}
			out = append(out, IndicatorOverlayLabel{
				Key:                 fmt.Sprintf("%s_%d", call.variable, segmentIndex+1),
				Price:               price,
				Text:                text,
				Color:               styleColorValue(styles, key, colorExpressionAt(colorExpression, colorIndex, context, "#ffffff")),
				BackgroundColor:     colorExpressionAt(backgroundExpression, backgroundIndex, context, resolveColor("color.blue", defaultColors[0])),
				Style:               labelStyle,
				Tooltip:             textExpressionAt(tooltipExpression, tooltipIndex, context),
				Time:                labelTime,
				objectCreationIndex: startIndex,
				objectSourceLine:    call.line.number,
			})
		}
	}
	return out
}

func compileTableDashboard(lines []sourceLine, context *evalContext, errors *[]RuntimeError) *IndicatorDashboard {
	calls := objectCreationCalls(lines, "table.new")
	if len(calls) == 0 || len(context.candles) == 0 {
		return nil
	}
	tableCall := calls[0]
	lastIndex := len(context.candles) - 1
	type cell struct {
		text  string
		color string
	}
	cells := map[int]map[int]cell{}
	logicalLines := coalesceObjectCallLines(lines, "table.cell")
	tableCellPattern := regexp.MustCompile(`^table\.cell\s*\(`)
	for index, line := range logicalLines {
		if !tableCellPattern.MatchString(line.text) {
			continue
		}
		condition := enclosingIfCondition(logicalLines, index)
		if condition != "" {
			value, err := evaluateExpression(condition, context)
			if err != nil {
				*errors = append(*errors, RuntimeError{Line: line.number, Message: err.Error()})
				continue
			}
			if !truthyAt(value, lastIndex, len(context.candles)) {
				continue
			}
		}
		bodies := findCallBodies(line.text, "table.cell")
		if len(bodies) == 0 {
			continue
		}
		args := parseCallArguments(bodies[0])
		if len(args.positional) < 4 || strings.TrimSpace(args.positional[0]) != tableCall.variable {
			continue
		}
		col := int(math.Round(numberExpressionAt(args.positional[1], lastIndex, context)))
		row := int(math.Round(numberExpressionAt(args.positional[2], lastIndex, context)))
		if col < 0 || row < 0 {
			continue
		}
		rowMap := cells[row]
		if rowMap == nil {
			rowMap = map[int]cell{}
			cells[row] = rowMap
		}
		rowMap[col] = cell{
			text:  textExpressionAt(args.positional[3], lastIndex, context),
			color: colorExpressionAt(args.named["text_color"], lastIndex, context, "#ffffff"),
		}
	}
	title := cells[0][0].text
	rows := []IndicatorDashboardRow{}
	for row := 1; row < 64; row++ {
		rowMap := cells[row]
		if rowMap == nil {
			continue
		}
		label := rowMap[0].text
		value := rowMap[1].text
		if label == "" && value == "" {
			continue
		}
		rows = append(rows, IndicatorDashboardRow{Label: label, Value: value, ValueColor: rowMap[1].color})
	}
	if title == "" && len(rows) == 0 {
		return nil
	}
	return &IndicatorDashboard{
		Key:      tableCall.variable + "_dashboard",
		Title:    title,
		Subtitle: cells[0][1].text,
		Rows:     rows,
	}
}

func objectSegmentEnd(starts []int, segmentIndex int, candleCount int) int {
	if segmentIndex+1 < len(starts) {
		return max(0, starts[segmentIndex+1]-1)
	}
	return max(0, candleCount-1)
}

func chooseIndex(condition bool, whenTrue int, whenFalse int) int {
	if condition {
		return whenTrue
	}
	return whenFalse
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
