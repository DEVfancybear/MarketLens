package pineruntime

import (
	"fmt"
	"math"
	"regexp"
	"strings"
)

const objectRightExtensionBars = 12

type pineObjectCall struct {
	line      sourceLine
	variable  string
	args      callArguments
	condition string
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

	result.Series = append(result.Series, compileBoxObjects(lines, candles, context, styles, errors)...)
	result.Series = append(result.Series, compileLineObjects(lines, candles, context, styles, errors)...)
	result.Labels = append(result.Labels, compileLabelObjects(lines, candles, context, styles, errors)...)
	if dashboard := compileTableDashboard(lines, context, errors); dashboard != nil {
		result.Dashboard = dashboard
	}

	if len(result.Series) == 0 && len(result.Labels) == 0 && result.Dashboard == nil {
		return nil
	}
	return &result
}

func objectAssignmentRegex(apiName string) *regexp.Regexp {
	escaped := strings.ReplaceAll(apiName, ".", `\.`)
	return regexp.MustCompile(`^(?:(?:(?:var|varip|const|simple|series)\s+)*(?:line|label|box|table)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*` + escaped + `\s*\(`)
}

func objectCreationCalls(lines []sourceLine, apiName string) []pineObjectCall {
	out := []pineObjectCall{}
	re := objectAssignmentRegex(apiName)
	for index, line := range lines {
		match := re.FindStringSubmatch(line.text)
		bodies := findCallBodies(line.text, apiName)
		if len(match) == 0 || len(bodies) == 0 {
			continue
		}
		out = append(out, pineObjectCall{
			line:      line,
			variable:  match[1],
			args:      parseCallArguments(bodies[0]),
			condition: enclosingIfCondition(lines, index),
		})
	}
	return out
}

func enclosingIfCondition(lines []sourceLine, index int) string {
	current := lines[index]
	for cursor := index - 1; cursor >= 0; cursor-- {
		candidate := lines[cursor]
		if candidate.text == "" || candidate.indent >= current.indent {
			continue
		}
		if strings.HasPrefix(candidate.text, "if ") || candidate.text == "if" {
			return strings.TrimSpace(strings.TrimPrefix(candidate.text, "if"))
		}
		if candidate.indent == 0 {
			break
		}
	}
	return ""
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
	for _, line := range lines {
		if !strings.HasPrefix(line.text, callName+"(") {
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
	if strings.TrimSpace(expression) == "" {
		return fallback
	}
	value, err := evaluateExpression(expression, context)
	if err == nil {
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
		starts := conditionIndices(call.condition, context, errors, call.line.number)
		leftExpression := firstNonEmpty(objectSetterExpression(lines, "box", call.variable, "left", 1), rawArg(call.args, "left", 0))
		rightExpression := firstNonEmpty(objectSetterExpression(lines, "box", call.variable, "right", 1), rawArg(call.args, "right", 2))
		topExpression := firstNonEmpty(objectSetterExpression(lines, "box", call.variable, "top", 1), rawArg(call.args, "top", 1))
		bottomExpression := firstNonEmpty(objectSetterExpression(lines, "box", call.variable, "bottom", 1), rawArg(call.args, "bottom", 3))
		colorExpression := firstNonEmpty(objectSetterExpression(lines, "box", call.variable, "bgcolor", 1), rawArg(call.args, "bgcolor", 9))
		xloc := enumExpression(rawArg(call.args, "xloc", 8), "xloc.bar_index")
		extendExpression := firstNonEmpty(objectSetterExpression(lines, "box", call.variable, "extend", 1), rawArg(call.args, "extend", 7))
		if leftExpression == "" || rightExpression == "" || topExpression == "" || bottomExpression == "" {
			continue
		}
		for segmentIndex, startIndex := range starts {
			endIndex := objectSegmentEnd(starts, segmentIndex, len(candles))
			extendRight := segmentIndex == len(starts)-1 || enumExpression(extendExpression, "extend.none") == "extend.right"
			rightUsesSetter := objectSetterExpression(lines, "box", call.variable, "right", 1) != ""
			topUsesSetter := objectSetterExpression(lines, "box", call.variable, "top", 1) != ""
			bottomUsesSetter := objectSetterExpression(lines, "box", call.variable, "bottom", 1) != ""
			baseValue := numberExpressionAt(bottomExpression, chooseIndex(bottomUsesSetter, endIndex, startIndex), context)
			if !usable(baseValue) {
				continue
			}
			key := styleKey("box", call.variable)
			if !styleVisible(styles, key) {
				continue
			}
			color := styleColorValue(styles, key, colorExpressionAt(colorExpression, endIndex, context, defaultColors[len(out)%len(defaultColors)]))
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
				leftIndex:       startIndex,
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
				Key:              fmt.Sprintf("%s_%d", call.variable, segmentIndex+1),
				Color:            color,
				Type:             "baselineFill",
				BaseValue:        &baseValue,
				LineVisible:      &lineVisible,
				LastValueVisible: &lastValueVisible,
				Data:             data,
			})
		}
	}
	return out
}

func compileLineObjects(lines []sourceLine, candles []Candle, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorSeries {
	out := []IndicatorSeries{}
	for _, call := range objectCreationCalls(lines, "line.new") {
		starts := conditionIndices(call.condition, context, errors, call.line.number)
		x1Setter := objectSetterExpression(lines, "line", call.variable, "x1", 1)
		x2Setter := objectSetterExpression(lines, "line", call.variable, "x2", 1)
		y1Setter := objectSetterExpression(lines, "line", call.variable, "y1", 1)
		y2Setter := objectSetterExpression(lines, "line", call.variable, "y2", 1)
		x1Expression := firstNonEmpty(x1Setter, rawArg(call.args, "x1", 0))
		x2Expression := firstNonEmpty(x2Setter, rawArg(call.args, "x2", 2))
		y1Expression := firstNonEmpty(y1Setter, rawArg(call.args, "y1", 1))
		y2Expression := firstNonEmpty(y2Setter, rawArg(call.args, "y2", 3))
		xloc := enumExpression(rawArg(call.args, "xloc", 4), "xloc.bar_index")
		extendExpression := firstNonEmpty(objectSetterExpression(lines, "line", call.variable, "extend", 1), rawArg(call.args, "extend", 5))
		if x1Expression == "" || x2Expression == "" || y1Expression == "" || y2Expression == "" {
			continue
		}
		for segmentIndex, startIndex := range starts {
			endIndex := objectSegmentEnd(starts, segmentIndex, len(candles))
			extendRight := segmentIndex == len(starts)-1 || enumExpression(extendExpression, "extend.none") == "extend.right"
			colorExpression := firstNonEmpty(objectSetterExpression(lines, "line", call.variable, "color", 1), rawArg(call.args, "color", 6))
			key := styleKey("line", call.variable)
			if !styleVisible(styles, key) {
				continue
			}
			color := styleColorValue(styles, key, colorExpressionAt(colorExpression, endIndex, context, defaultColors[len(out)%len(defaultColors)]))
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
			width := styleLineWidthValue(styles, key, objectLineWidth(firstNonEmpty(objectSetterExpression(lines, "line", call.variable, "width", 1), rawArg(call.args, "width", 8)), endIndex, context))
			lineStyleValue := styleLineStyleValue(styles, key, lineStyle(rawArg(call.args, "style", 7)))
			lastValueVisible := false
			out = append(out, IndicatorSeries{
				Key:              fmt.Sprintf("%s_%d", call.variable, segmentIndex+1),
				Color:            color,
				Type:             "line",
				LineWidth:        &width,
				LineStyle:        &lineStyleValue,
				LastValueVisible: &lastValueVisible,
				Data:             data,
			})
		}
	}
	return out
}

func compileLabelObjects(lines []sourceLine, candles []Candle, context *evalContext, styles map[string]InputValue, errors *[]RuntimeError) []IndicatorOverlayLabel {
	out := []IndicatorOverlayLabel{}
	for _, call := range objectCreationCalls(lines, "label.new") {
		starts := conditionIndices(call.condition, context, errors, call.line.number)
		xSetter := objectSetterExpression(lines, "label", call.variable, "xy", 1)
		ySetter := objectSetterExpression(lines, "label", call.variable, "xy", 2)
		xExpression := firstNonEmpty(xSetter, rawArg(call.args, "x", 0))
		yExpression := firstNonEmpty(ySetter, rawArg(call.args, "y", 1))
		textExpression := firstNonEmpty(objectSetterExpression(lines, "label", call.variable, "text", 1), rawArg(call.args, "text", 2))
		backgroundExpression := firstNonEmpty(objectSetterExpression(lines, "label", call.variable, "color", 1), rawArg(call.args, "color", 5))
		colorExpression := firstNonEmpty(objectSetterExpression(lines, "label", call.variable, "textcolor", 1), rawArg(call.args, "textcolor", 7))
		xloc := enumExpression(rawArg(call.args, "xloc", 3), "xloc.bar_index")
		labelStyle := enumExpression(firstNonEmpty(objectSetterExpression(lines, "label", call.variable, "style", 1), rawArg(call.args, "style", 6)), "label.style_label_left")
		if yExpression == "" {
			continue
		}
		for segmentIndex, startIndex := range starts {
			endIndex := objectSegmentEnd(starts, segmentIndex, len(candles))
			extendRight := segmentIndex == len(starts)-1
			labelIndex := chooseIndex(ySetter != "", endIndex, startIndex)
			price := numberExpressionAt(yExpression, labelIndex, context)
			if !usable(price) {
				continue
			}
			key := styleKey("label", call.variable)
			if !styleVisible(styles, key) {
				continue
			}
			text := textExpressionAt(textExpression, endIndex, context)
			if strings.TrimSpace(text) == "" {
				continue
			}
			anchorTime, hasAnchor := objectXTime(xExpression, chooseIndex(xSetter != "", endIndex, startIndex), context, xloc)
			rightEdgeTime := segmentEndTime(candles, endIndex, extendRight)
			var labelTime *int64
			if labelStyle == "label.style_label_left" && extendRight && rightEdgeTime != nil {
				labelTime = rightEdgeTime
			} else if hasAnchor {
				labelTime = &anchorTime
			} else {
				labelTime = rightEdgeTime
			}
			out = append(out, IndicatorOverlayLabel{
				Key:             fmt.Sprintf("%s_%d", call.variable, segmentIndex+1),
				Price:           price,
				Text:            text,
				Color:           styleColorValue(styles, key, colorExpressionAt(colorExpression, endIndex, context, defaultColors[len(out)%len(defaultColors)])),
				BackgroundColor: colorExpressionAt(backgroundExpression, endIndex, context, "rgba(8, 12, 18, 0.72)"),
				Time:            labelTime,
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
	for index, line := range lines {
		if !strings.HasPrefix(line.text, "table.cell(") {
			continue
		}
		condition := enclosingIfCondition(lines, index)
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
