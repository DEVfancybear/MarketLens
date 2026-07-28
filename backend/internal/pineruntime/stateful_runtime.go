package pineruntime

import (
	"context"
	"fmt"
	"math"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type statefulValueKind int

const (
	statefulValueNA statefulValueKind = iota
	statefulValueNumber
	statefulValueBool
	statefulValueString
	statefulValueColor
	statefulValueTuple
	statefulValueRecord
	statefulValueArray
	statefulValueMap
	statefulValueMatrix
	statefulValueObject
	statefulValuePlot
)

type statefulValue struct {
	kind    statefulValueKind
	number  float64
	boolean bool
	text    string
	tuple   []statefulValue
	record  *statefulRecord
	array   *statefulArray
	mapData *statefulMap
	matrix  *statefulMatrix
	object  *statefulObject
	plot    *statefulPlot
}

type statefulRecord struct {
	typeName string
	fields   map[string]statefulValue
}

type statefulArray struct {
	elementType string
	values      []statefulValue
}

type statefulMapEntry struct {
	key   statefulValue
	value statefulValue
}

type statefulMap struct {
	keyType   string
	valueType string
	entries   []statefulMapEntry
}

type statefulMatrix struct {
	elementType string
	rows        [][]statefulValue
}

type statefulObjectKind string

const (
	statefulBoxObject   statefulObjectKind = "box"
	statefulLineObject  statefulObjectKind = "line"
	statefulLabelObject statefulObjectKind = "label"
	statefulTableObject statefulObjectKind = "table"
)

type statefulObject struct {
	id         int
	kind       statefulObjectKind
	deleted    bool
	createdBar int
	x1         float64
	y1         float64
	x2         float64
	y2         float64
	xloc       string
	color      string
	background string
	style      string
	width      int
	text       string
	tooltip    string
	position   string
	textSize   string
	table      map[int]map[int]statefulTableCell
}

type statefulTableCell struct {
	text      string
	textColor string
	textSize  string
}

type statefulPlot struct {
	id       int
	name     string
	style    string
	width    int
	offset   int
	values   []float64
	colors   []string
	lastBar  int
	declared bool
}

type statefulNumericCall struct {
	values  []float64
	volumes []float64
	lastBar int
}

type statefulValueWhenCall struct {
	values  []statefulValue
	lastBar int
}

type statefulHistoryCall struct {
	arguments [][]statefulValue
	lastBar   int
}

type statefulCallSite struct {
	call  *statefulCallExpr
	scope *statefulScope
}

type statefulFill struct {
	id      int
	first   *statefulPlot
	second  *statefulPlot
	colors  []string
	lastBar int
}

func statefulNA() statefulValue { return statefulValue{kind: statefulValueNA, number: math.NaN()} }
func statefulNumber(value float64) statefulValue {
	return statefulValue{kind: statefulValueNumber, number: value}
}
func statefulBool(value bool) statefulValue {
	return statefulValue{kind: statefulValueBool, boolean: value}
}
func statefulString(value string) statefulValue {
	return statefulValue{kind: statefulValueString, text: value}
}
func statefulColor(value string) statefulValue {
	return statefulValue{kind: statefulValueColor, text: value}
}

func cloneStatefulValue(value statefulValue) statefulValue {
	cloned := value
	switch value.kind {
	case statefulValueTuple:
		cloned.tuple = make([]statefulValue, len(value.tuple))
		for index := range value.tuple {
			cloned.tuple[index] = cloneStatefulValue(value.tuple[index])
		}
	case statefulValueRecord:
		if value.record != nil {
			cloned.record = &statefulRecord{typeName: value.record.typeName, fields: map[string]statefulValue{}}
			for key, field := range value.record.fields {
				cloned.record.fields[key] = cloneStatefulValue(field)
			}
		}
	// Collections and drawing/plot handles are Pine reference types. Their
	// pointer identity must survive assignment and collection insertion.
	case statefulValueArray, statefulValueMap, statefulValueMatrix, statefulValueObject, statefulValuePlot:
	}
	return cloned
}

type statefulCell struct {
	value       statefulValue
	history     []statefulValue
	initialized bool
}

type statefulScope struct {
	parent   *statefulScope
	varScope *statefulScope
	cells    map[string]*statefulCell
}

func newStatefulScope(parent *statefulScope) *statefulScope {
	scope := &statefulScope{parent: parent, cells: map[string]*statefulCell{}}
	scope.varScope = scope
	return scope
}

func (s *statefulScope) lookup(name string) (*statefulCell, bool) {
	for current := s; current != nil; current = current.parent {
		if cell, ok := current.cells[name]; ok {
			return cell, true
		}
	}
	return nil, false
}

func (s *statefulScope) local(name string) (*statefulCell, bool) {
	cell, ok := s.cells[name]
	return cell, ok
}

func (s *statefulScope) ensure(name string) *statefulCell {
	if cell, ok := s.cells[name]; ok {
		return cell
	}
	cell := &statefulCell{value: statefulNA()}
	s.cells[name] = cell
	return cell
}

type statefulSecurityResult struct {
	values []statefulValue
}

type statefulVM struct {
	ctx              context.Context
	program          *statefulProgram
	request          CompileRequest
	candles          []Candle
	global           *statefulScope
	bar              int
	assigningName    string
	objects          []*statefulObject
	plots            []*statefulPlot
	fills            []*statefulFill
	plotCalls        map[statefulCallSite]*statefulPlot
	fillCalls        map[statefulCallSite]*statefulFill
	securityCalls    map[statefulCallSite]statefulSecurityResult
	functionState    map[statefulCallSite]*statefulScope
	functionLastBar  map[statefulCallSite]int
	numericCalls     map[statefulCallSite]*statefulNumericCall
	valueWhenCalls   map[statefulCallSite]*statefulValueWhenCall
	historyCalls     map[statefulCallSite]*statefulHistoryCall
	cumulativeCalls  map[statefulCallSite]float64
	nextObjectID     int
	nextPlotID       int
	nextFillID       int
	version          int
	outputSuppressed bool
}

func newStatefulVM(ctx context.Context, program *statefulProgram, request CompileRequest, candles []Candle) *statefulVM {
	return &statefulVM{
		ctx:             ctx,
		program:         program,
		request:         request,
		candles:         candles,
		global:          newStatefulScope(nil),
		plotCalls:       map[statefulCallSite]*statefulPlot{},
		fillCalls:       map[statefulCallSite]*statefulFill{},
		securityCalls:   map[statefulCallSite]statefulSecurityResult{},
		functionState:   map[statefulCallSite]*statefulScope{},
		functionLastBar: map[statefulCallSite]int{},
		numericCalls:    map[statefulCallSite]*statefulNumericCall{},
		valueWhenCalls:  map[statefulCallSite]*statefulValueWhenCall{},
		historyCalls:    map[statefulCallSite]*statefulHistoryCall{},
		cumulativeCalls: map[statefulCallSite]float64{},
		version:         ExtractMeta(request.SourceCode).Version,
	}
}

// compileStatefulPine compiles the syntax-selected stateful Pine subset.  The
// dispatch signal is deliberately structural: it requires language features
// such as a UDT, reference array, tuple or request.security() result.  Script
// title, author and indicator formula never participate in selection.
func compileStatefulPine(ctx context.Context, request CompileRequest, id string) (IndicatorResult, bool, []RuntimeError) {
	result := IndicatorResult{ID: id, Series: []IndicatorSeries{}}
	if !statefulSourceCandidate(request.SourceCode) {
		return result, false, nil
	}
	program, err := parseStatefulProgram(request.SourceCode)
	if err != nil {
		return result, true, []RuntimeError{{Message: err.Error()}}
	}
	if !program.usesState {
		return result, false, nil
	}
	vm := newStatefulVM(ctx, program, request, request.Candles)
	if err := vm.run(); err != nil {
		return result, true, []RuntimeError{{Message: err.Error()}}
	}
	result = vm.result(id)
	return result, true, program.parseWarnings
}

func statefulSourceCandidate(source string) bool {
	cleaned := normalizeSource(source)
	if regexp.MustCompile(`\b(array\.(new(?:_[A-Za-z]+)?|from)|map\.|matrix\.)`).MatchString(cleaned) {
		return true
	}
	if regexp.MustCompile(`\b(plotshape|plotchar|plotarrow)\s*\(`).MatchString(cleaned) {
		return true
	}
	if regexp.MustCompile(`(?m)^\s*type\s+[A-Za-z_][A-Za-z0-9_]*\s*$`).MatchString(cleaned) {
		return true
	}
	// Tuple assignment and loops require per-bar scopes and cannot be represented
	// by the vector evaluator's single pineValue result.
	return regexp.MustCompile(`(?m)^\s*\[[^\]]+\]\s*=`).MatchString(cleaned) ||
		regexp.MustCompile(`(?m)^\s*(for|while)\s+`).MatchString(cleaned)
}

func (vm *statefulVM) run() error {
	for index := range vm.candles {
		select {
		case <-vm.ctx.Done():
			return vm.ctx.Err()
		default:
		}
		vm.bar = index
		if _, err := vm.executeBlock(vm.program.statements, vm.global); err != nil {
			return err
		}
		vm.commitBar()
	}
	return nil
}

func (vm *statefulVM) commitBar() {
	for _, cell := range vm.global.cells {
		cell.history = append(cell.history, cloneStatefulValue(cell.value))
	}
	for call, scope := range vm.functionState {
		if vm.functionLastBar[call] != vm.bar {
			continue
		}
		for _, cell := range scope.cells {
			cell.history = append(cell.history, cloneStatefulValue(cell.value))
		}
	}
}

func (vm *statefulVM) result(id string) IndicatorResult {
	result := IndicatorResult{ID: id, Series: []IndicatorSeries{}}
	for _, object := range vm.objects {
		if object.deleted {
			continue
		}
		switch object.kind {
		case statefulBoxObject:
			if series, ok := vm.boxSeries(object); ok {
				result.Series = append(result.Series, series)
			}
		case statefulLineObject:
			if series, ok := vm.lineSeries(object); ok {
				result.Series = append(result.Series, series)
			}
		case statefulLabelObject:
			if label, ok := vm.labelResult(object); ok {
				result.Labels = append(result.Labels, label)
			}
		case statefulTableObject:
			if result.Dashboard == nil {
				result.Dashboard = statefulTableDashboard(object)
			}
		}
	}
	for _, plot := range vm.plots {
		if series, ok := vm.plotSeries(plot); ok {
			result.Series = append(result.Series, series)
		}
	}
	for _, fill := range vm.fills {
		result.Series = append(result.Series, vm.fillSeries(fill)...)
	}
	result.Series = statefulLimitSeries(result.Series, vm.program.maxBoxes+vm.program.maxLines+len(vm.plots)*2)
	return result
}

func statefulLimitSeries(series []IndicatorSeries, limit int) []IndicatorSeries {
	if limit <= 0 || len(series) <= limit {
		return series
	}
	return series[len(series)-limit:]
}

func (vm *statefulVM) boxSeries(object *statefulObject) (IndicatorSeries, bool) {
	left, leftOK := vm.objectTime(object.x1, object.xloc)
	right, rightOK := vm.objectTime(object.x2, object.xloc)
	if !leftOK || !rightOK || !statefulUsable(object.y1) || !statefulUsable(object.y2) {
		return IndicatorSeries{}, false
	}
	base := object.y2
	lineVisible, lastVisible, statusVisible := false, false, false
	return IndicatorSeries{
		Key:               fmt.Sprintf("stateful:box:%d", object.id),
		Type:              "baselineFill",
		Color:             object.background,
		BaseValue:         &base,
		Data:              []LinePoint{{Time: left, Value: object.y1}, {Time: right, Value: object.y1}},
		LineVisible:       &lineVisible,
		LastValueVisible:  &lastVisible,
		StatusLineVisible: &statusVisible,
	}, true
}

func (vm *statefulVM) lineSeries(object *statefulObject) (IndicatorSeries, bool) {
	x1, x1OK := vm.objectTime(object.x1, object.xloc)
	x2, x2OK := vm.objectTime(object.x2, object.xloc)
	if !x1OK || !x2OK || !statefulUsable(object.y1) || !statefulUsable(object.y2) {
		return IndicatorSeries{}, false
	}
	width := object.width
	if width <= 0 {
		width = 1
	}
	style := lineStyle(object.style)
	extendsRight := x2 > vm.candles[len(vm.candles)-1].Time
	lastVisible, statusVisible := extendsRight, extendsRight
	return IndicatorSeries{
		Key:                  fmt.Sprintf("stateful:line:%d", object.id),
		Type:                 "line",
		Color:                object.color,
		Data:                 []LinePoint{{Time: x1, Value: object.y1}, {Time: x2, Value: object.y2}},
		LineWidth:            &width,
		LineStyle:            &style,
		LastValueVisible:     &lastVisible,
		StatusLineVisible:    &statusVisible,
		ExtendToVisibleRange: &extendsRight,
	}, true
}

func (vm *statefulVM) labelResult(object *statefulObject) (IndicatorOverlayLabel, bool) {
	if !statefulUsable(object.y1) || strings.TrimSpace(object.text) == "" {
		return IndicatorOverlayLabel{}, false
	}
	timeValue, ok := vm.objectTime(object.x1, object.xloc)
	var timePointer *int64
	if ok {
		timePointer = &timeValue
	}
	return IndicatorOverlayLabel{
		Key:             fmt.Sprintf("stateful:label:%d", object.id),
		Price:           object.y1,
		Text:            object.text,
		Color:           object.color,
		BackgroundColor: object.background,
		Style:           object.style,
		Tooltip:         object.tooltip,
		Time:            timePointer,
	}, true
}

func (vm *statefulVM) objectTime(value float64, xloc string) (int64, bool) {
	if !statefulUsable(value) || len(vm.candles) == 0 {
		return 0, false
	}
	if xloc == "xloc.bar_time" {
		if value > 10_000_000_000 {
			value /= 1000
		}
		return int64(math.Round(value)), true
	}
	index := int(math.Round(value))
	step := candleStepSeconds(vm.candles)
	if index < 0 {
		return vm.candles[0].Time + int64(index)*step, true
	}
	if index >= len(vm.candles) {
		return vm.candles[len(vm.candles)-1].Time + int64(index-len(vm.candles)+1)*step, true
	}
	return vm.candles[index].Time, true
}

func (vm *statefulVM) plotSeries(plot *statefulPlot) (IndicatorSeries, bool) {
	data := make([]LinePoint, 0, len(plot.values))
	color := ""
	for index, value := range plot.values {
		if index < len(plot.colors) && plot.colors[index] != "" && plot.colors[index] != "transparent" {
			color = plot.colors[index]
		}
		target := index + plot.offset
		if target >= 0 && target < len(vm.candles) && statefulUsable(value) {
			point := LinePoint{Time: vm.candles[target].Time, Value: value}
			if index < len(plot.colors) && plot.colors[index] != "" {
				pointColor := plot.colors[index]
				point.Color = &pointColor
			}
			data = append(data, point)
		}
	}
	if len(data) == 0 || color == "" {
		return IndicatorSeries{}, false
	}
	width := plot.width
	if width <= 0 {
		width = 1
	}
	return IndicatorSeries{
		Key:       fmt.Sprintf("stateful:plot:%d:%s", plot.id, plot.name),
		Type:      plotType(plot.style),
		Color:     color,
		Data:      data,
		LineWidth: &width,
	}, true
}

func (vm *statefulVM) fillSeries(fill *statefulFill) []IndicatorSeries {
	if fill.first == nil || fill.second == nil {
		return nil
	}
	length := len(vm.candles)
	if len(fill.first.values) < length {
		length = len(fill.first.values)
	}
	if len(fill.second.values) < length {
		length = len(fill.second.values)
	}
	result := []IndicatorSeries{}
	start := -1
	base := math.NaN()
	color := ""
	flush := func(end int) {
		if start < 0 || end < start || !statefulUsable(base) {
			start = -1
			return
		}
		data := make([]LinePoint, 0, end-start+1)
		fillBelow := false
		for index := start; index <= end; index++ {
			value := fill.first.values[index]
			if !statefulUsable(value) {
				continue
			}
			if value < base {
				fillBelow = true
			}
			data = append(data, LinePoint{Time: vm.candles[index].Time, Value: value})
		}
		if len(data) > 0 && color != "" {
			lineVisible, lastVisible, statusVisible := false, false, false
			baseCopy := base
			result = append(result, IndicatorSeries{
				Key:               fmt.Sprintf("stateful:fill:%d:%d", fill.id, len(result)+1),
				Type:              "baselineFill",
				Color:             color,
				BaseValue:         &baseCopy,
				FillBelowBase:     &fillBelow,
				Data:              data,
				LineVisible:       &lineVisible,
				LastValueVisible:  &lastVisible,
				StatusLineVisible: &statusVisible,
			})
		}
		start = -1
	}
	for index := 0; index < length; index++ {
		first, second := fill.first.values[index], fill.second.values[index]
		pointColor := color
		if index < len(fill.colors) && fill.colors[index] != "" {
			pointColor = fill.colors[index]
		}
		valid := statefulUsable(first) && statefulUsable(second) && pointColor != ""
		if !valid {
			flush(index - 1)
			base = math.NaN()
			color = ""
			continue
		}
		if start < 0 {
			start, base, color = index, second, pointColor
			continue
		}
		if math.Abs(second-base) > 1e-12 || pointColor != color {
			flush(index - 1)
			start, base, color = index, second, pointColor
		}
	}
	flush(length - 1)
	return result
}

func statefulTableDashboard(object *statefulObject) *IndicatorDashboard {
	if object == nil || object.deleted || len(object.table) == 0 {
		return nil
	}
	columns := map[int]string{}
	if header := object.table[0]; header != nil {
		for column, cell := range header {
			if column > 0 {
				columns[column] = cell.text
			}
		}
	}
	rows := []IndicatorDashboardRow{}
	rowNumbers := make([]int, 0, len(object.table))
	for row := range object.table {
		if row > 0 {
			rowNumbers = append(rowNumbers, row)
		}
	}
	sort.Ints(rowNumbers)
	for _, row := range rowNumbers {
		cells := object.table[row]
		label := cells[0].text
		columnNumbers := make([]int, 0, len(cells))
		for column := range cells {
			if column > 0 {
				columnNumbers = append(columnNumbers, column)
			}
		}
		sort.Ints(columnNumbers)
		for _, column := range columnNumbers {
			cell := cells[column]
			rowLabel := strings.TrimSpace(strings.TrimSpace(columns[column]) + " " + strings.TrimSpace(label))
			if rowLabel == "" && cell.text == "" {
				continue
			}
			rows = append(rows, IndicatorDashboardRow{Label: rowLabel, Value: cell.text, ValueColor: cell.textColor})
		}
	}
	if len(rows) == 0 {
		return nil
	}
	return &IndicatorDashboard{
		Key:      fmt.Sprintf("stateful:table:%d", object.id),
		Title:    "Dashboard",
		Position: statefulDisplayEnum(object.position),
		TextSize: statefulDisplayEnum(object.textSize),
		Rows:     rows,
	}
}

func statefulDisplayEnum(value string) string {
	value = strings.TrimSpace(value)
	if dot := strings.LastIndex(value, "."); dot >= 0 {
		value = value[dot+1:]
	}
	parts := strings.Fields(strings.ReplaceAll(value, "_", " "))
	for index := range parts {
		parts[index] = strings.ToUpper(parts[index][:1]) + strings.ToLower(parts[index][1:])
	}
	return strings.Join(parts, " ")
}

func statefulUsable(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

func statefulTruthy(value statefulValue) bool {
	switch value.kind {
	case statefulValueBool:
		return value.boolean
	case statefulValueNumber:
		return statefulUsable(value.number) && value.number != 0
	case statefulValueString, statefulValueColor:
		return value.text != ""
	case statefulValueTuple:
		return len(value.tuple) > 0
	case statefulValueRecord:
		return value.record != nil
	case statefulValueArray:
		return value.array != nil
	case statefulValueObject:
		return value.object != nil && !value.object.deleted
	case statefulValuePlot:
		return value.plot != nil
	default:
		return false
	}
}

func statefulNumeric(value statefulValue) float64 {
	switch value.kind {
	case statefulValueNumber:
		return value.number
	case statefulValueBool:
		if value.boolean {
			return 1
		}
		return 0
	default:
		return math.NaN()
	}
}

func statefulValueText(value statefulValue, format string) string {
	switch value.kind {
	case statefulValueString, statefulValueColor:
		return value.text
	case statefulValueBool:
		return strconv.FormatBool(value.boolean)
	case statefulValueNumber:
		if !statefulUsable(value.number) {
			return "NaN"
		}
		if format == "format.percent" {
			return strconv.FormatFloat(value.number, 'f', 1, 64) + "%"
		}
		return strconv.FormatFloat(value.number, 'f', -1, 64)
	default:
		return ""
	}
}

func statefulColorText(value statefulValue) string {
	if value.kind == statefulValueColor || value.kind == statefulValueString {
		return value.text
	}
	return ""
}
