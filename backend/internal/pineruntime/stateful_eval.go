package pineruntime

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

const statefulMaxLoopIterations = 10000

var (
	errStatefulBreak    = errors.New("break")
	errStatefulContinue = errors.New("continue")
)

func (vm *statefulVM) executeBlock(statements []statefulStmt, scope *statefulScope) (statefulValue, error) {
	last := statefulNA()
	for _, raw := range statements {
		var err error
		switch statement := raw.(type) {
		case *statefulAssignStmt:
			last, err = vm.executeAssignment(statement, scope)
		case *statefulExprStmt:
			last, err = vm.evaluate(statement.expression, scope)
		case *statefulIfStmt:
			last, err = vm.executeIf(statement, scope)
		case *statefulForStmt:
			last, err = vm.executeFor(statement, scope)
		case *statefulWhileStmt:
			last, err = vm.executeWhile(statement, scope)
		case *statefulControlStmt:
			if statement.kind == "break" {
				err = errStatefulBreak
			} else {
				err = errStatefulContinue
			}
		case *statefulNoopStmt:
			continue
		default:
			err = fmt.Errorf("unsupported statement at line %d", raw.lineNumber())
		}
		if err != nil {
			return statefulNA(), fmt.Errorf("line %d: %w", raw.lineNumber(), err)
		}
	}
	return last, nil
}

func (vm *statefulVM) executeAssignment(statement *statefulAssignStmt, scope *statefulScope) (statefulValue, error) {
	if len(statement.targets) == 0 {
		return statefulNA(), fmt.Errorf("assignment has no target")
	}
	targetScope := scope
	if statement.persistent && scope.varScope != nil {
		targetScope = scope.varScope
		if cell, ok := targetScope.local(statement.targets[0]); ok && cell.initialized {
			return cell.value, nil
		}
	}
	previousTarget := vm.assigningName
	vm.assigningName = statement.targets[0]
	value, err := vm.evaluate(statement.expression, scope)
	vm.assigningName = previousTarget
	if err != nil {
		return statefulNA(), err
	}
	if len(statement.targets) > 1 {
		if value.kind != statefulValueTuple {
			return statefulNA(), fmt.Errorf("tuple assignment expects %d values", len(statement.targets))
		}
		for index, name := range statement.targets {
			assigned := statefulNA()
			if index < len(value.tuple) {
				assigned = cloneStatefulValue(value.tuple[index])
			}
			cell := scope.ensure(name)
			cell.value, cell.initialized = assigned, true
		}
		return value, nil
	}
	name := statement.targets[0]
	cell := targetScope.ensure(name)
	if statement.op == ":=" || strings.HasSuffix(statement.op, "=") && statement.op != "=" {
		if existing, ok := scope.lookup(name); ok {
			cell = existing
		}
	}
	switch statement.op {
	case "+=", "-=", "*=", "/=", "%=":
		value, err = statefulBinary(strings.TrimSuffix(statement.op, "="), cell.value, value)
		if err != nil {
			return statefulNA(), err
		}
	}
	cell.value, cell.initialized = cloneStatefulValue(value), true
	return value, nil
}

func (vm *statefulVM) executeIf(statement *statefulIfStmt, scope *statefulScope) (statefulValue, error) {
	for _, branch := range statement.branches {
		condition, err := vm.evaluate(branch.condition, scope)
		if err != nil {
			return statefulNA(), err
		}
		truthy, err := vm.booleanValue(condition)
		if err != nil {
			return statefulNA(), err
		}
		if truthy {
			return vm.executeBlock(branch.body, scope)
		}
	}
	if statement.other != nil {
		return vm.executeBlock(statement.other, scope)
	}
	return statefulNA(), nil
}

func (vm *statefulVM) executeFor(statement *statefulForStmt, scope *statefulScope) (statefulValue, error) {
	last := statefulNA()
	iterations := 0
	loopCell := scope.ensure(statement.variable)
	if statement.in != nil {
		iterable, err := vm.evaluate(statement.in, scope)
		if err != nil {
			return statefulNA(), err
		}
		values := []statefulValue{}
		if iterable.kind == statefulValueArray && iterable.array != nil {
			values = append(values, iterable.array.values...)
		} else if iterable.kind == statefulValueTuple {
			values = append(values, iterable.tuple...)
		} else {
			return statefulNA(), fmt.Errorf("foreach expects an array")
		}
		for _, value := range values {
			iterations++
			if iterations > statefulMaxLoopIterations {
				return statefulNA(), fmt.Errorf("loop iteration limit exceeded")
			}
			loopCell.value, loopCell.initialized = cloneStatefulValue(value), true
			last, err = vm.executeBlock(statement.body, scope)
			if errors.Is(err, errStatefulBreak) {
				return last, nil
			}
			if errors.Is(err, errStatefulContinue) {
				continue
			}
			if err != nil {
				return statefulNA(), err
			}
		}
		return last, nil
	}
	fromValue, err := vm.evaluate(statement.from, scope)
	if err != nil {
		return statefulNA(), err
	}
	from := int(math.Round(statefulNumeric(fromValue)))
	stepSize := 1
	if statement.step != nil {
		stepValue, err := vm.evaluate(statement.step, scope)
		if err != nil {
			return statefulNA(), err
		}
		stepSize = int(math.Round(statefulNumeric(stepValue)))
		if stepSize <= 0 {
			return statefulNA(), fmt.Errorf("for loop step must be greater than zero")
		}
	}
	// Pine re-evaluates the `to` expression on each iteration.  This matters
	// when the loop body removes array elements.
	for current := from; ; {
		toValue, err := vm.evaluate(statement.to, scope)
		if err != nil {
			return statefulNA(), err
		}
		to := int(math.Round(statefulNumeric(toValue)))
		step := stepSize
		if from > to {
			step = -stepSize
		}
		if (step > 0 && current > to) || (step < 0 && current < to) {
			break
		}
		iterations++
		if iterations > statefulMaxLoopIterations {
			return statefulNA(), fmt.Errorf("loop iteration limit exceeded")
		}
		loopCell.value, loopCell.initialized = statefulNumber(float64(current)), true
		last, err = vm.executeBlock(statement.body, scope)
		if errors.Is(err, errStatefulBreak) {
			break
		}
		if !errors.Is(err, errStatefulContinue) && err != nil {
			return statefulNA(), err
		}
		current += step
	}
	return last, nil
}

func (vm *statefulVM) executeWhile(statement *statefulWhileStmt, scope *statefulScope) (statefulValue, error) {
	last := statefulNA()
	for iterations := 0; ; iterations++ {
		if iterations >= statefulMaxLoopIterations {
			return statefulNA(), fmt.Errorf("loop iteration limit exceeded")
		}
		condition, err := vm.evaluate(statement.condition, scope)
		if err != nil {
			return statefulNA(), err
		}
		truthy, err := vm.booleanValue(condition)
		if err != nil {
			return statefulNA(), err
		}
		if !truthy {
			return last, nil
		}
		last, err = vm.executeBlock(statement.body, scope)
		if errors.Is(err, errStatefulBreak) {
			return last, nil
		}
		if errors.Is(err, errStatefulContinue) {
			continue
		}
		if err != nil {
			return statefulNA(), err
		}
	}
}

func (vm *statefulVM) evaluate(expression statefulExpr, scope *statefulScope) (statefulValue, error) {
	switch value := expression.(type) {
	case *statefulLiteralExpr:
		return cloneStatefulValue(value.value), nil
	case *statefulIdentifierExpr:
		return vm.resolveIdentifier(value.name, scope)
	case *statefulUnaryExpr:
		operand, err := vm.evaluate(value.value, scope)
		if err != nil {
			return statefulNA(), err
		}
		if value.operator == "not" {
			truthy, err := vm.booleanValue(operand)
			if err != nil {
				return statefulNA(), err
			}
			return statefulBool(!truthy), nil
		}
		number := statefulNumeric(operand)
		if !statefulUsable(number) {
			return statefulNA(), nil
		}
		if value.operator == "+" {
			return statefulNumber(number), nil
		}
		return statefulNumber(-number), nil
	case *statefulBinaryExpr:
		left, err := vm.evaluate(value.left, scope)
		if err != nil {
			return statefulNA(), err
		}
		if value.operator == "and" || value.operator == "or" {
			leftTruthy, err := vm.booleanValue(left)
			if err != nil {
				return statefulNA(), err
			}
			// Pine v6 evaluates logical operators lazily. Earlier versions
			// evaluate both operands even when the left side decides the result.
			if vm.version >= 6 {
				if value.operator == "and" && !leftTruthy {
					return statefulBool(false), nil
				}
				if value.operator == "or" && leftTruthy {
					return statefulBool(true), nil
				}
			}
			right, err := vm.evaluate(value.right, scope)
			if err != nil {
				return statefulNA(), err
			}
			rightTruthy, err := vm.booleanValue(right)
			if err != nil {
				return statefulNA(), err
			}
			if value.operator == "and" {
				return statefulBool(leftTruthy && rightTruthy), nil
			}
			return statefulBool(leftTruthy || rightTruthy), nil
		}
		right, err := vm.evaluate(value.right, scope)
		if err != nil {
			return statefulNA(), err
		}
		return statefulBinary(value.operator, left, right)
	case *statefulTernaryExpr:
		condition, err := vm.evaluate(value.condition, scope)
		if err != nil {
			return statefulNA(), err
		}
		truthy, err := vm.booleanValue(condition)
		if err != nil {
			return statefulNA(), err
		}
		if truthy {
			return vm.evaluate(value.whenTrue, scope)
		}
		return vm.evaluate(value.whenFalse, scope)
	case *statefulFieldExpr:
		return vm.evaluateField(value, scope)
	case *statefulIndexExpr:
		return vm.evaluateIndex(value, scope)
	case *statefulTupleExpr:
		out := make([]statefulValue, len(value.values))
		for index, item := range value.values {
			evaluated, err := vm.evaluate(item, scope)
			if err != nil {
				return statefulNA(), err
			}
			out[index] = cloneStatefulValue(evaluated)
		}
		return statefulValue{kind: statefulValueTuple, tuple: out}, nil
	case *statefulCallExpr:
		return vm.evaluateCall(value, scope)
	default:
		return statefulNA(), fmt.Errorf("unsupported expression")
	}
}

func (vm *statefulVM) booleanValue(value statefulValue) (bool, error) {
	if vm.version >= 6 && value.kind != statefulValueBool {
		return false, fmt.Errorf("Pine v6 condition expects bool, got %s", statefulKindName(value.kind))
	}
	return statefulTruthy(value), nil
}

func statefulKindName(kind statefulValueKind) string {
	switch kind {
	case statefulValueNA:
		return "na"
	case statefulValueNumber:
		return "number"
	case statefulValueBool:
		return "bool"
	case statefulValueString:
		return "string"
	case statefulValueColor:
		return "color"
	case statefulValueTuple:
		return "tuple"
	case statefulValueRecord:
		return "UDT"
	case statefulValueArray:
		return "array"
	case statefulValueMap:
		return "map"
	case statefulValueMatrix:
		return "matrix"
	case statefulValueObject:
		return "drawing"
	case statefulValuePlot:
		return "plot"
	default:
		return "unknown"
	}
}

func statefulBinary(operator string, left, right statefulValue) (statefulValue, error) {
	if operator == "and" {
		return statefulBool(statefulTruthy(left) && statefulTruthy(right)), nil
	}
	if operator == "or" {
		return statefulBool(statefulTruthy(left) || statefulTruthy(right)), nil
	}
	if operator == "==" || operator == "!=" {
		equal := statefulEqual(left, right)
		if operator == "!=" {
			equal = !equal
		}
		return statefulBool(equal), nil
	}
	if (left.kind == statefulValueString || left.kind == statefulValueColor || right.kind == statefulValueString || right.kind == statefulValueColor) && operator == "+" {
		return statefulString(statefulValueText(left, "") + statefulValueText(right, "")), nil
	}
	a, b := statefulNumeric(left), statefulNumeric(right)
	if !statefulUsable(a) || !statefulUsable(b) {
		if operator == ">" || operator == ">=" || operator == "<" || operator == "<=" {
			return statefulBool(false), nil
		}
		return statefulNA(), nil
	}
	switch operator {
	case "+":
		return statefulNumber(a + b), nil
	case "-":
		return statefulNumber(a - b), nil
	case "*":
		return statefulNumber(a * b), nil
	case "/":
		if b == 0 {
			return statefulNA(), nil
		}
		return statefulNumber(a / b), nil
	case "%":
		if b == 0 {
			return statefulNA(), nil
		}
		return statefulNumber(math.Mod(a, b)), nil
	case ">":
		return statefulBool(a > b), nil
	case ">=":
		return statefulBool(a >= b), nil
	case "<":
		return statefulBool(a < b), nil
	case "<=":
		return statefulBool(a <= b), nil
	default:
		return statefulNA(), fmt.Errorf("unsupported operator %q", operator)
	}
}

func statefulEqual(left, right statefulValue) bool {
	if left.kind == statefulValueNA || right.kind == statefulValueNA {
		return false
	}
	if left.kind == statefulValueString || left.kind == statefulValueColor || right.kind == statefulValueString || right.kind == statefulValueColor {
		return statefulValueText(left, "") == statefulValueText(right, "")
	}
	if left.kind == statefulValueObject || right.kind == statefulValueObject {
		return left.object == right.object
	}
	if left.kind == statefulValueArray || right.kind == statefulValueArray {
		return left.array == right.array
	}
	if left.kind == statefulValueMap || right.kind == statefulValueMap {
		return left.mapData == right.mapData
	}
	if left.kind == statefulValueMatrix || right.kind == statefulValueMatrix {
		return left.matrix == right.matrix
	}
	if left.kind == statefulValueBool && right.kind == statefulValueBool {
		return left.boolean == right.boolean
	}
	a, b := statefulNumeric(left), statefulNumeric(right)
	return statefulUsable(a) && statefulUsable(b) && a == b
}

func (vm *statefulVM) resolveIdentifier(name string, scope *statefulScope) (statefulValue, error) {
	if cell, ok := scope.lookup(name); ok && cell.initialized {
		return cloneStatefulValue(cell.value), nil
	}
	if color, ok := namedColors[name]; ok {
		return statefulColor(color), nil
	}
	if vm.bar < 0 || vm.bar >= len(vm.candles) {
		return statefulNA(), nil
	}
	candle := vm.candles[vm.bar]
	switch name {
	case "open":
		return statefulNumber(candle.Open), nil
	case "high":
		return statefulNumber(candle.High), nil
	case "low":
		return statefulNumber(candle.Low), nil
	case "close":
		return statefulNumber(candle.Close), nil
	case "volume":
		return statefulNumber(candle.Volume), nil
	case "time":
		return statefulNumber(float64(candle.Time)), nil
	case "bar_index":
		return statefulNumber(float64(vm.bar)), nil
	case "true":
		return statefulBool(true), nil
	case "false":
		return statefulBool(false), nil
	case "na":
		return statefulNA(), nil
	case "barstate":
		return statefulString("barstate"), nil
	case "syminfo", "xloc", "position", "size", "format", "line", "box", "label", "table", "array", "map", "matrix", "color", "math", "str", "ta", "request", "plot", "shape", "location", "extend":
		return statefulString(name), nil
	default:
		return statefulNA(), fmt.Errorf("unknown identifier %q", name)
	}
}

func (vm *statefulVM) evaluateField(expression *statefulFieldExpr, scope *statefulScope) (statefulValue, error) {
	if identifier, ok := expression.receiver.(*statefulIdentifierExpr); ok {
		qualified := identifier.name + "." + expression.name
		if color, exists := namedColors[qualified]; exists {
			return statefulColor(color), nil
		}
		switch qualified {
		case "barstate.isfirst":
			return statefulBool(vm.bar == 0), nil
		case "barstate.islast":
			return statefulBool(vm.bar == len(vm.candles)-1), nil
		case "barstate.isconfirmed", "barstate.ishistory":
			return statefulBool(true), nil
		case "barstate.isrealtime":
			return statefulBool(false), nil
		case "syminfo.tickerid":
			return statefulString(strings.TrimSpace(vm.request.Symbol)), nil
		case "syminfo.type":
			if kind := strings.TrimSpace(vm.request.SymbolType); kind != "" {
				return statefulString(kind), nil
			}
			return statefulString("forex"), nil
		case "syminfo.mintick":
			if vm.request.Mintick > 0 {
				return statefulNumber(vm.request.Mintick), nil
			}
			return statefulNumber(inferMintick(vm.candles)), nil
		case "syminfo.timezone":
			if timezone := strings.TrimSpace(vm.request.Timezone); timezone != "" {
				return statefulString(timezone), nil
			}
			return statefulString("UTC"), nil
		}
		if identifier.name == "xloc" || identifier.name == "position" || identifier.name == "size" || identifier.name == "format" || identifier.name == "line" || identifier.name == "box" || identifier.name == "label" || identifier.name == "plot" || identifier.name == "shape" || identifier.name == "location" || identifier.name == "extend" {
			return statefulString(qualified), nil
		}
	}
	receiver, err := vm.evaluate(expression.receiver, scope)
	if err != nil {
		return statefulNA(), err
	}
	if receiver.kind == statefulValueRecord && receiver.record != nil {
		if field, ok := receiver.record.fields[expression.name]; ok {
			return cloneStatefulValue(field), nil
		}
		return statefulNA(), fmt.Errorf("type %s has no field %s", receiver.record.typeName, expression.name)
	}
	if receiver.kind == statefulValueString {
		return statefulString(receiver.text + "." + expression.name), nil
	}
	return statefulNA(), fmt.Errorf("cannot access field %s", expression.name)
}

func (vm *statefulVM) evaluateIndex(expression *statefulIndexExpr, scope *statefulScope) (statefulValue, error) {
	indexValue, err := vm.evaluate(expression.index, scope)
	if err != nil {
		return statefulNA(), err
	}
	offset := int(math.Max(0, math.Round(statefulNumeric(indexValue))))
	if identifier, ok := expression.receiver.(*statefulIdentifierExpr); ok {
		name := identifier.name
		if cell, exists := scope.lookup(name); exists {
			if offset == 0 {
				return cloneStatefulValue(cell.value), nil
			}
			at := len(cell.history) - offset
			if at >= 0 && at < len(cell.history) {
				return cloneStatefulValue(cell.history[at]), nil
			}
			return statefulNA(), nil
		}
		at := vm.bar - offset
		if at < 0 || at >= len(vm.candles) {
			return statefulNA(), nil
		}
		candle := vm.candles[at]
		switch name {
		case "open":
			return statefulNumber(candle.Open), nil
		case "high":
			return statefulNumber(candle.High), nil
		case "low":
			return statefulNumber(candle.Low), nil
		case "close":
			return statefulNumber(candle.Close), nil
		case "volume":
			return statefulNumber(candle.Volume), nil
		case "time":
			return statefulNumber(float64(candle.Time)), nil
		}
	}
	receiver, err := vm.evaluate(expression.receiver, scope)
	if err != nil {
		return statefulNA(), err
	}
	if receiver.kind == statefulValueArray && receiver.array != nil && offset < len(receiver.array.values) {
		return cloneStatefulValue(receiver.array.values[offset]), nil
	}
	return statefulNA(), nil
}

func (vm *statefulVM) evaluateCall(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	name := statefulExpressionName(call.callee)
	if name == "request.security" {
		return vm.evaluateSecurity(call, scope)
	}
	if dot := strings.LastIndex(name, "."); dot > 0 && name[dot+1:] == "new" {
		if typeDef, ok := vm.program.types[name[:dot]]; ok {
			return vm.constructRecord(typeDef, call, scope)
		}
	}
	if field, ok := call.callee.(*statefulFieldExpr); ok {
		// Namespace calls (math.min, color.new, type.new, etc.) retain
		// their qualified name.  Calls on a runtime value use method
		// dispatch and never inspect the source formula.
		if identifier, direct := field.receiver.(*statefulIdentifierExpr); !direct || !statefulNamespace(identifier.name) {
			receiver, err := vm.evaluate(field.receiver, scope)
			if err != nil {
				return statefulNA(), err
			}
			return vm.evaluateMethod(call, field.name, receiver, scope)
		}
	}
	if function, ok := vm.program.functions[name]; ok {
		return vm.callFunction(function, call, scope, nil)
	}
	for _, namespace := range []string{"array.", "map.", "matrix."} {
		if strings.HasPrefix(name, namespace) &&
			name != namespace+"new" && name != "array.from" &&
			!strings.HasPrefix(name, "array.new_") {
			receiver, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			methodCall := *call
			methodCall.arguments = append([]statefulCallArgument(nil), call.arguments[1:]...)
			return vm.evaluateMethod(&methodCall, strings.TrimPrefix(name, namespace), receiver, scope)
		}
	}
	switch name {
	case "input", "input.int", "input.float", "input.bool", "input.color", "input.string", "input.timeframe", "input.source", "input.symbol", "input.session", "input.text_area":
		return vm.evaluateInput(name, call, scope)
	case "array.new", "array.new_float", "array.new_int", "array.new_bool", "array.new_string", "array.new_color", "array.new_line", "array.new_box", "array.new_label":
		return vm.constructArray(call, scope)
	case "array.from":
		return vm.constructArrayFrom(call, scope)
	case "map.new":
		return vm.constructMap(call), nil
	case "matrix.new":
		return vm.constructMatrix(call, scope)
	case "math.min", "min":
		return vm.numericReduce(call, scope, math.Min)
	case "math.max", "max":
		return vm.numericReduce(call, scope, math.Max)
	case "math.abs", "abs":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		return statefulNumber(math.Abs(statefulNumeric(value))), nil
	case "math.exp", "exp":
		return vm.numericUnary(call, scope, math.Exp)
	case "math.sin", "sin":
		return vm.numericUnary(call, scope, math.Sin)
	case "math.cos", "cos":
		return vm.numericUnary(call, scope, math.Cos)
	case "math.tan", "tan":
		return vm.numericUnary(call, scope, math.Tan)
	case "math.asin":
		return vm.numericUnary(call, scope, math.Asin)
	case "math.acos":
		return vm.numericUnary(call, scope, math.Acos)
	case "math.atan":
		return vm.numericUnary(call, scope, math.Atan)
	case "math.sqrt", "sqrt":
		return vm.numericUnary(call, scope, math.Sqrt)
	case "math.log":
		return vm.numericUnary(call, scope, math.Log)
	case "math.log10":
		return vm.numericUnary(call, scope, math.Log10)
	case "math.round", "round":
		return vm.numericUnary(call, scope, math.Round)
	case "math.floor", "floor":
		return vm.numericUnary(call, scope, math.Floor)
	case "math.ceil":
		return vm.numericUnary(call, scope, math.Ceil)
	case "math.sign":
		return vm.numericUnary(call, scope, func(value float64) float64 {
			switch {
			case value > 0:
				return 1
			case value < 0:
				return -1
			default:
				return 0
			}
		})
	case "math.pow":
		return vm.numericBinary(call, scope, math.Pow)
	case "math.avg":
		return vm.numericAverage(call, scope)
	case "int":
		return vm.numericUnary(call, scope, math.Trunc)
	case "float":
		return vm.numericUnary(call, scope, func(value float64) float64 { return value })
	case "bool":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		return statefulBool(statefulTruthy(value)), nil
	case "string":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		return statefulString(statefulValueText(value, "")), nil
	case "ta.sma", "sma", "ta.ema", "ema", "ta.rma", "rma", "ta.wma", "wma", "ta.vwma", "vwma":
		return vm.evaluateMovingAverage(name, call, scope)
	case "ta.change", "change", "ta.mom", "mom",
		"ta.highest", "highest", "ta.lowest", "lowest",
		"ta.highestbars", "highestbars", "ta.lowestbars", "lowestbars",
		"ta.barssince", "barssince", "ta.cross", "cross",
		"ta.crossover", "crossover", "ta.crossunder", "crossunder",
		"ta.rising", "rising", "ta.falling", "falling",
		"ta.dev", "dev", "ta.stdev", "stdev", "ta.variance", "variance",
		"ta.range", "range", "ta.roc", "roc", "ta.rsi", "rsi",
		"ta.atr", "atr", "ta.tr", "tr", "ta.hma", "hma",
		"ta.bb", "bb", "ta.bbw", "bbw", "ta.macd", "macd":
		return vm.evaluateTAFunction(name, call, scope)
	case "math.sum":
		return vm.evaluateRollingSum(call, scope)
	case "ta.valuewhen", "valuewhen":
		return vm.evaluateValueWhen(call, scope)
	case "ta.cum", "cum":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		point := statefulNumeric(value)
		if statefulUsable(point) {
			vm.cumulativeCalls[statefulCallSite{call: call, scope: scope}] += point
		}
		return statefulNumber(vm.cumulativeCalls[statefulCallSite{call: call, scope: scope}]), nil
	case "ta.pivothigh", "pivothigh":
		return vm.evaluatePivot(call, scope, "high")
	case "ta.pivotlow", "pivotlow":
		return vm.evaluatePivot(call, scope, "low")
	case "color.new":
		return vm.colorNew(call, scope)
	case "color":
		// Pine permits an explicit color cast, including color(na).  The
		// latter must remain `na` so drawing constructors can distinguish an
		// omitted/transparent color from a literal fallback.
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		if value.kind == statefulValueNA || value.kind == statefulValueNumber && !statefulUsable(value.number) {
			return statefulNA(), nil
		}
		if color := statefulColorText(value); color != "" {
			return statefulColor(color), nil
		}
		return statefulColor(statefulValueText(value, "")), nil
	case "color.r", "color.g", "color.b":
		return vm.colorComponent(name, call, scope)
	case "color.rgb":
		return vm.colorRGB(call, scope)
	case "str.tostring":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		format := ""
		if len(call.arguments) > 1 {
			formatValue, err := vm.evaluate(call.arguments[1].expression, scope)
			if err != nil {
				return statefulNA(), err
			}
			format = statefulValueText(formatValue, "")
		}
		return statefulString(statefulValueText(value, format)), nil
	case "str.length", "str.lower", "str.upper", "str.trim",
		"str.contains", "str.startswith", "str.endswith",
		"str.replace_all", "str.substring", "str.pos", "str.repeat", "str.format":
		return vm.evaluateStringFunction(name, call, scope)
	case "na":
		if len(call.arguments) == 0 {
			return statefulBool(true), nil
		}
		value, err := vm.evaluate(call.arguments[0].expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		return statefulBool(value.kind == statefulValueNA || value.kind == statefulValueNumber && !statefulUsable(value.number)), nil
	case "nz":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		if value.kind != statefulValueNA && !(value.kind == statefulValueNumber && !statefulUsable(value.number)) {
			return value, nil
		}
		if len(call.arguments) > 1 {
			return vm.evaluate(call.arguments[1].expression, scope)
		}
		return statefulNumber(0), nil
	case "box.new":
		return vm.constructBox(call, scope)
	case "line.new":
		return vm.constructLine(call, scope)
	case "line.get_x2":
		return vm.lineCoordinate(call, scope, "x2")
	case "line.set_x2":
		return vm.setLineCoordinate(call, scope, "x2")
	case "label.new":
		return vm.constructLabel(call, scope)
	case "table.new":
		return vm.constructTable(call, scope)
	case "plot":
		return vm.evaluatePlot(call, scope)
	case "plotshape", "plotchar", "plotarrow":
		return vm.evaluatePlotMarker(name, call, scope)
	case "fill":
		return vm.evaluateFill(call, scope)
	case "alertcondition":
		return statefulNA(), nil
	default:
		return statefulNA(), fmt.Errorf("unsupported call %s()", name)
	}
}

func statefulNamespace(name string) bool {
	switch name {
	case "input", "array", "map", "matrix", "math", "ta", "color", "str", "request", "box", "line", "label", "table", "plot", "shape", "location", "extend":
		return true
	default:
		return false
	}
}

func (vm *statefulVM) evaluateMethod(call *statefulCallExpr, name string, receiver statefulValue, scope *statefulScope) (statefulValue, error) {
	if receiver.kind == statefulValueArray && receiver.array != nil {
		array := receiver.array
		switch name {
		case "size":
			return statefulNumber(float64(len(array.values))), nil
		case "get":
			index, err := vm.methodIndex(call, scope)
			if err != nil {
				return statefulNA(), err
			}
			if index < 0 || index >= len(array.values) {
				return statefulNA(), fmt.Errorf("array index %d out of bounds", index)
			}
			return cloneStatefulValue(array.values[index]), nil
		case "set":
			index, err := vm.methodIndex(call, scope)
			if err != nil {
				return statefulNA(), err
			}
			if index < 0 || index >= len(array.values) {
				return statefulNA(), fmt.Errorf("array index %d out of bounds", index)
			}
			value, err := vm.callArgument(call, scope, "", 1)
			if err != nil {
				return statefulNA(), err
			}
			array.values[index] = cloneStatefulValue(value)
			return statefulNA(), nil
		case "first":
			if len(array.values) == 0 {
				return statefulNA(), fmt.Errorf("array is empty")
			}
			return cloneStatefulValue(array.values[0]), nil
		case "last":
			if len(array.values) == 0 {
				return statefulNA(), fmt.Errorf("array is empty")
			}
			return cloneStatefulValue(array.values[len(array.values)-1]), nil
		case "pop":
			if len(array.values) == 0 {
				return statefulNA(), fmt.Errorf("array is empty")
			}
			last := array.values[len(array.values)-1]
			array.values = array.values[:len(array.values)-1]
			return last, nil
		case "shift":
			if len(array.values) == 0 {
				return statefulNA(), fmt.Errorf("array is empty")
			}
			first := array.values[0]
			array.values = array.values[1:]
			return first, nil
		case "remove":
			index, err := vm.methodIndex(call, scope)
			if err != nil {
				return statefulNA(), err
			}
			if index < 0 || index >= len(array.values) {
				return statefulNA(), fmt.Errorf("array index %d out of bounds", index)
			}
			removed := array.values[index]
			array.values = append(array.values[:index], array.values[index+1:]...)
			return removed, nil
		case "unshift":
			value, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			array.values = append([]statefulValue{cloneStatefulValue(value)}, array.values...)
			return statefulNA(), nil
		case "insert":
			index, err := vm.methodIndex(call, scope)
			if err != nil {
				return statefulNA(), err
			}
			if index < 0 || index > len(array.values) {
				return statefulNA(), fmt.Errorf("array index %d out of bounds", index)
			}
			value, err := vm.callArgument(call, scope, "", 1)
			if err != nil {
				return statefulNA(), err
			}
			array.values = append(array.values, statefulNA())
			copy(array.values[index+1:], array.values[index:])
			array.values[index] = cloneStatefulValue(value)
			return statefulNA(), nil
		case "push":
			value, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			array.values = append(array.values, cloneStatefulValue(value))
			return statefulNA(), nil
		case "clear":
			array.values = nil
			return statefulNA(), nil
		case "includes":
			value, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			return statefulBool(statefulArrayIndex(array, value, false) >= 0), nil
		case "indexof":
			value, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			return statefulNumber(float64(statefulArrayIndex(array, value, false))), nil
		case "lastindexof":
			value, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			return statefulNumber(float64(statefulArrayIndex(array, value, true))), nil
		case "copy":
			values := make([]statefulValue, len(array.values))
			for index := range array.values {
				values[index] = cloneStatefulValue(array.values[index])
			}
			return statefulValue{kind: statefulValueArray, array: &statefulArray{elementType: array.elementType, values: values}}, nil
		case "reverse":
			for left, right := 0, len(array.values)-1; left < right; left, right = left+1, right-1 {
				array.values[left], array.values[right] = array.values[right], array.values[left]
			}
			return statefulNA(), nil
		case "concat":
			other, err := vm.callArgument(call, scope, "", 0)
			if err != nil {
				return statefulNA(), err
			}
			if other.kind != statefulValueArray || other.array == nil {
				return statefulNA(), fmt.Errorf("array.concat() expects an array")
			}
			for _, value := range other.array.values {
				array.values = append(array.values, cloneStatefulValue(value))
			}
			return statefulValue{kind: statefulValueArray, array: array}, nil
		case "sum", "avg", "min", "max":
			return statefulArrayAggregate(array, name)
		}
	}
	if receiver.kind == statefulValueMap && receiver.mapData != nil {
		return vm.evaluateMapMethod(call, name, receiver.mapData, scope)
	}
	if receiver.kind == statefulValueMatrix && receiver.matrix != nil {
		return vm.evaluateMatrixMethod(call, name, receiver.matrix, scope)
	}
	if receiver.kind == statefulValueObject && receiver.object != nil {
		object := receiver.object
		switch name {
		case "delete":
			object.deleted = true
			return statefulNA(), nil
		case "cell":
			if object.kind != statefulTableObject {
				return statefulNA(), fmt.Errorf("cell() receiver is not a table")
			}
			return vm.evaluateTableCell(object, call, scope)
		}
	}
	if function, ok := vm.program.methods[name]; ok {
		return vm.callFunction(function, call, scope, &receiver)
	}
	return statefulNA(), fmt.Errorf("unsupported method %s()", name)
}

func (vm *statefulVM) methodIndex(call *statefulCallExpr, scope *statefulScope) (int, error) {
	value, err := vm.callArgument(call, scope, "", 0)
	if err != nil {
		return 0, err
	}
	point := statefulNumeric(value)
	if !statefulUsable(point) {
		return 0, fmt.Errorf("array index is na")
	}
	return int(math.Round(point)), nil
}

func (vm *statefulVM) callFunction(function *statefulFunction, call *statefulCallExpr, caller *statefulScope, receiver *statefulValue) (statefulValue, error) {
	site := statefulCallSite{call: call, scope: caller}
	persistent := vm.functionState[site]
	if persistent == nil {
		persistent = newStatefulScope(vm.global)
		vm.functionState[site] = persistent
	}
	local := persistent
	vm.functionLastBar[site] = vm.bar
	argumentIndex := 0
	for index, parameter := range function.parameters {
		var value statefulValue
		if receiver != nil && index == 0 {
			value = cloneStatefulValue(*receiver)
		} else if argumentIndex < len(call.arguments) {
			evaluated, err := vm.evaluate(call.arguments[argumentIndex].expression, caller)
			if err != nil {
				return statefulNA(), err
			}
			value = evaluated
			argumentIndex++
		} else {
			value = statefulNA()
		}
		cell := local.ensure(parameter)
		cell.value, cell.initialized = cloneStatefulValue(value), true
	}
	if function.inline != nil {
		return vm.evaluate(function.inline, local)
	}
	return vm.executeBlock(function.body, local)
}

func (vm *statefulVM) constructRecord(typeDef *statefulType, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	record := &statefulRecord{typeName: typeDef.name, fields: map[string]statefulValue{}}
	fieldIndexes := make(map[string]int, len(typeDef.fields))
	for index, field := range typeDef.fields {
		fieldIndexes[field.name] = index
	}
	values := make([]statefulValue, len(typeDef.fields))
	assigned := make([]bool, len(typeDef.fields))
	nextPositional := 0
	namedSeen := false
	for _, argument := range call.arguments {
		fieldIndex := -1
		if argument.name == "" {
			if namedSeen {
				return statefulNA(), fmt.Errorf("%s.new() positional argument cannot follow a named argument", typeDef.name)
			}
			if nextPositional >= len(typeDef.fields) {
				return statefulNA(), fmt.Errorf("%s.new() received too many arguments", typeDef.name)
			}
			fieldIndex = nextPositional
			nextPositional++
		} else {
			namedSeen = true
			var exists bool
			fieldIndex, exists = fieldIndexes[argument.name]
			if !exists {
				return statefulNA(), fmt.Errorf("%s.new() has no field %q", typeDef.name, argument.name)
			}
		}
		if assigned[fieldIndex] {
			return statefulNA(), fmt.Errorf("%s.new() field %q was assigned more than once", typeDef.name, typeDef.fields[fieldIndex].name)
		}
		evaluated, err := vm.evaluate(argument.expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		values[fieldIndex], assigned[fieldIndex] = evaluated, true
	}
	for index, field := range typeDef.fields {
		value := values[index]
		if !assigned[index] {
			value = statefulNA()
			if field.defaultExp != nil {
				evaluated, err := vm.evaluate(field.defaultExp, scope)
				if err != nil {
					return statefulNA(), err
				}
				value = evaluated
			}
		}
		record.fields[field.name] = cloneStatefulValue(value)
	}
	return statefulValue{kind: statefulValueRecord, record: record}, nil
}

func (vm *statefulVM) constructArray(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	size := 0
	if len(call.arguments) > 0 {
		value, err := vm.evaluate(call.arguments[0].expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		size = int(math.Max(0, math.Round(statefulNumeric(value))))
	}
	initial := statefulNA()
	if len(call.arguments) > 1 {
		value, err := vm.evaluate(call.arguments[1].expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		initial = value
	}
	values := make([]statefulValue, size)
	for index := range values {
		values[index] = cloneStatefulValue(initial)
	}
	return statefulValue{kind: statefulValueArray, array: &statefulArray{elementType: call.generic, values: values}}, nil
}

func (vm *statefulVM) constructArrayFrom(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	values := make([]statefulValue, 0, len(call.arguments))
	for _, argument := range call.arguments {
		value, err := vm.evaluate(argument.expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		values = append(values, cloneStatefulValue(value))
	}
	return statefulValue{kind: statefulValueArray, array: &statefulArray{values: values}}, nil
}

func (vm *statefulVM) constructMap(call *statefulCallExpr) statefulValue {
	types := strings.SplitN(call.generic, ",", 2)
	keyType, valueType := "", ""
	if len(types) > 0 {
		keyType = types[0]
	}
	if len(types) > 1 {
		valueType = types[1]
	}
	return statefulValue{
		kind: statefulValueMap,
		mapData: &statefulMap{
			keyType:   keyType,
			valueType: valueType,
		},
	}
}

func (vm *statefulVM) constructMatrix(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	rowValue, err := vm.callArgument(call, scope, "rows", 0)
	if err != nil {
		return statefulNA(), err
	}
	columnValue, err := vm.callArgument(call, scope, "columns", 1)
	if err != nil {
		return statefulNA(), err
	}
	rows := int(math.Max(0, math.Round(statefulNumeric(rowValue))))
	columns := int(math.Max(0, math.Round(statefulNumeric(columnValue))))
	initial := statefulNA()
	if len(call.arguments) > 2 {
		initial, err = vm.callArgument(call, scope, "initial_value", 2)
		if err != nil {
			return statefulNA(), err
		}
	}
	values := make([][]statefulValue, rows)
	for row := range values {
		values[row] = make([]statefulValue, columns)
		for column := range values[row] {
			values[row][column] = cloneStatefulValue(initial)
		}
	}
	return statefulValue{
		kind:   statefulValueMatrix,
		matrix: &statefulMatrix{elementType: call.generic, rows: values},
	}, nil
}

func statefulArrayIndex(array *statefulArray, target statefulValue, reverse bool) int {
	if reverse {
		for index := len(array.values) - 1; index >= 0; index-- {
			if statefulEqual(array.values[index], target) {
				return index
			}
		}
		return -1
	}
	for index, value := range array.values {
		if statefulEqual(value, target) {
			return index
		}
	}
	return -1
}

func statefulArrayAggregate(array *statefulArray, operation string) (statefulValue, error) {
	if len(array.values) == 0 {
		return statefulNA(), nil
	}
	result := 0.0
	count := 0
	for _, value := range array.values {
		number := statefulNumeric(value)
		if !statefulUsable(number) {
			continue
		}
		if count == 0 || operation == "min" && number < result || operation == "max" && number > result {
			result = number
		} else if operation == "sum" || operation == "avg" {
			result += number
		}
		count++
	}
	if count == 0 {
		return statefulNA(), nil
	}
	if operation == "avg" {
		result /= float64(count)
	}
	return statefulNumber(result), nil
}

func statefulMapIndex(data *statefulMap, key statefulValue) int {
	for index, entry := range data.entries {
		if statefulEqual(entry.key, key) {
			return index
		}
	}
	return -1
}

func (vm *statefulVM) evaluateMapMethod(call *statefulCallExpr, name string, data *statefulMap, scope *statefulScope) (statefulValue, error) {
	switch name {
	case "size":
		return statefulNumber(float64(len(data.entries))), nil
	case "clear":
		data.entries = nil
		return statefulNA(), nil
	case "copy":
		copied := &statefulMap{keyType: data.keyType, valueType: data.valueType}
		for _, entry := range data.entries {
			copied.entries = append(copied.entries, statefulMapEntry{
				key: cloneStatefulValue(entry.key), value: cloneStatefulValue(entry.value),
			})
		}
		return statefulValue{kind: statefulValueMap, mapData: copied}, nil
	case "keys", "values":
		values := make([]statefulValue, 0, len(data.entries))
		for _, entry := range data.entries {
			if name == "keys" {
				values = append(values, cloneStatefulValue(entry.key))
			} else {
				values = append(values, cloneStatefulValue(entry.value))
			}
		}
		return statefulValue{kind: statefulValueArray, array: &statefulArray{values: values}}, nil
	}
	key, err := vm.callArgument(call, scope, "key", 0)
	if err != nil {
		return statefulNA(), err
	}
	index := statefulMapIndex(data, key)
	switch name {
	case "contains":
		return statefulBool(index >= 0), nil
	case "get":
		if index < 0 {
			return statefulNA(), nil
		}
		return cloneStatefulValue(data.entries[index].value), nil
	case "remove":
		if index < 0 {
			return statefulNA(), nil
		}
		removed := data.entries[index].value
		data.entries = append(data.entries[:index], data.entries[index+1:]...)
		return removed, nil
	case "put":
		value, err := vm.callArgument(call, scope, "value", 1)
		if err != nil {
			return statefulNA(), err
		}
		if index >= 0 {
			data.entries[index].value = cloneStatefulValue(value)
		} else {
			data.entries = append(data.entries, statefulMapEntry{
				key: cloneStatefulValue(key), value: cloneStatefulValue(value),
			})
		}
		return statefulNA(), nil
	default:
		return statefulNA(), fmt.Errorf("unsupported map method %s()", name)
	}
}

func statefulMatrixDimensions(matrix *statefulMatrix) (int, int) {
	rows := len(matrix.rows)
	if rows == 0 {
		return 0, 0
	}
	return rows, len(matrix.rows[0])
}

func (vm *statefulVM) evaluateMatrixMethod(call *statefulCallExpr, name string, matrix *statefulMatrix, scope *statefulScope) (statefulValue, error) {
	rows, columns := statefulMatrixDimensions(matrix)
	switch name {
	case "rows":
		return statefulNumber(float64(rows)), nil
	case "columns":
		return statefulNumber(float64(columns)), nil
	case "copy":
		copied := &statefulMatrix{elementType: matrix.elementType, rows: make([][]statefulValue, rows)}
		for row := range matrix.rows {
			copied.rows[row] = make([]statefulValue, len(matrix.rows[row]))
			for column := range matrix.rows[row] {
				copied.rows[row][column] = cloneStatefulValue(matrix.rows[row][column])
			}
		}
		return statefulValue{kind: statefulValueMatrix, matrix: copied}, nil
	case "transpose":
		transposed := &statefulMatrix{elementType: matrix.elementType, rows: make([][]statefulValue, columns)}
		for column := 0; column < columns; column++ {
			transposed.rows[column] = make([]statefulValue, rows)
			for row := 0; row < rows; row++ {
				transposed.rows[column][row] = cloneStatefulValue(matrix.rows[row][column])
			}
		}
		return statefulValue{kind: statefulValueMatrix, matrix: transposed}, nil
	case "fill":
		value, err := vm.callArgument(call, scope, "value", 0)
		if err != nil {
			return statefulNA(), err
		}
		for row := range matrix.rows {
			for column := range matrix.rows[row] {
				matrix.rows[row][column] = cloneStatefulValue(value)
			}
		}
		return statefulNA(), nil
	}
	rowValue, err := vm.callArgument(call, scope, "row", 0)
	if err != nil {
		return statefulNA(), err
	}
	columnValue, err := vm.callArgument(call, scope, "column", 1)
	if err != nil {
		return statefulNA(), err
	}
	row := int(math.Round(statefulNumeric(rowValue)))
	column := int(math.Round(statefulNumeric(columnValue)))
	if row < 0 || row >= rows || column < 0 || column >= columns {
		return statefulNA(), fmt.Errorf("matrix index [%d,%d] out of bounds", row, column)
	}
	switch name {
	case "get":
		return cloneStatefulValue(matrix.rows[row][column]), nil
	case "set":
		value, err := vm.callArgument(call, scope, "value", 2)
		if err != nil {
			return statefulNA(), err
		}
		matrix.rows[row][column] = cloneStatefulValue(value)
		return statefulNA(), nil
	default:
		return statefulNA(), fmt.Errorf("unsupported matrix method %s()", name)
	}
}

func (vm *statefulVM) evaluateInput(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	if override, ok := vm.request.InputOverrides[vm.assigningName]; ok {
		switch name {
		case "input":
			defaultValue, err := vm.callArgument(call, scope, "defval", 0)
			if err != nil {
				return statefulNA(), err
			}
			return statefulInputOverride(override, defaultValue), nil
		case "input.bool":
			return statefulInputOverride(override, statefulBool(false)), nil
		case "input.int", "input.float":
			return statefulNumber(inputValueAsFloat(override)), nil
		case "input.color":
			return statefulColor(fmt.Sprint(override)), nil
		case "input.source":
			if vm.bar < 0 || vm.bar >= len(vm.candles) {
				return statefulNA(), nil
			}
			candle := vm.candles[vm.bar]
			switch strings.ToLower(strings.TrimSpace(fmt.Sprint(override))) {
			case "open":
				return statefulNumber(candle.Open), nil
			case "high":
				return statefulNumber(candle.High), nil
			case "low":
				return statefulNumber(candle.Low), nil
			case "close":
				return statefulNumber(candle.Close), nil
			case "hl2":
				return statefulNumber((candle.High + candle.Low) / 2), nil
			case "hlc3":
				return statefulNumber((candle.High + candle.Low + candle.Close) / 3), nil
			case "ohlc4":
				return statefulNumber((candle.Open + candle.High + candle.Low + candle.Close) / 4), nil
			case "hlcc4":
				return statefulNumber((candle.High + candle.Low + candle.Close*2) / 4), nil
			default:
				return statefulNA(), fmt.Errorf("unsupported input.source override %q", override)
			}
		default:
			return statefulString(fmt.Sprint(override)), nil
		}
	}
	return vm.callArgument(call, scope, "defval", 0)
}

// input() is type-inferred in Pine: its return type is the type of defval.
// Preserve that contract for overrides instead of inferring from JSON text
// formatting (where false would otherwise become the truthy string "false").
func statefulInputOverride(raw InputValue, declared statefulValue) statefulValue {
	switch declared.kind {
	case statefulValueBool:
		if value, ok := raw.(bool); ok {
			return statefulBool(value)
		}
		parsed, err := strconv.ParseBool(strings.TrimSpace(fmt.Sprint(raw)))
		return statefulBool(err == nil && parsed)
	case statefulValueNumber:
		return statefulNumber(inputValueAsFloat(raw))
	case statefulValueColor:
		return statefulColor(fmt.Sprint(raw))
	case statefulValueString:
		return statefulString(fmt.Sprint(raw))
	default:
		switch value := raw.(type) {
		case bool:
			return statefulBool(value)
		case string:
			return statefulString(value)
		default:
			if number, ok := runtimeNumericValue(raw); ok {
				return statefulNumber(number)
			}
			return statefulString(fmt.Sprint(raw))
		}
	}
}

func (vm *statefulVM) numericReduce(call *statefulCallExpr, scope *statefulScope, reducer func(float64, float64) float64) (statefulValue, error) {
	if len(call.arguments) == 0 {
		return statefulNA(), nil
	}
	result, err := vm.evaluate(call.arguments[0].expression, scope)
	if err != nil {
		return statefulNA(), err
	}
	point := statefulNumeric(result)
	if !statefulUsable(point) {
		return statefulNA(), nil
	}
	for _, argument := range call.arguments[1:] {
		value, err := vm.evaluate(argument.expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		other := statefulNumeric(value)
		if !statefulUsable(other) {
			return statefulNA(), nil
		}
		point = reducer(point, other)
	}
	return statefulNumber(point), nil
}

func (vm *statefulVM) numericUnary(call *statefulCallExpr, scope *statefulScope, operation func(float64) float64) (statefulValue, error) {
	value, err := vm.callArgument(call, scope, "", 0)
	if err != nil {
		return statefulNA(), err
	}
	point := statefulNumeric(value)
	if !statefulUsable(point) {
		return statefulNA(), nil
	}
	return statefulNumber(operation(point)), nil
}

func (vm *statefulVM) numericBinary(call *statefulCallExpr, scope *statefulScope, operation func(float64, float64) float64) (statefulValue, error) {
	left, err := vm.callArgument(call, scope, "", 0)
	if err != nil {
		return statefulNA(), err
	}
	right, err := vm.callArgument(call, scope, "", 1)
	if err != nil {
		return statefulNA(), err
	}
	a, b := statefulNumeric(left), statefulNumeric(right)
	if !statefulUsable(a) || !statefulUsable(b) {
		return statefulNA(), nil
	}
	return statefulNumber(operation(a, b)), nil
}

func (vm *statefulVM) numericAverage(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	if len(call.arguments) == 0 {
		return statefulNA(), nil
	}
	total := 0.0
	for _, argument := range call.arguments {
		value, err := vm.evaluate(argument.expression, scope)
		if err != nil {
			return statefulNA(), err
		}
		number := statefulNumeric(value)
		if !statefulUsable(number) {
			return statefulNA(), nil
		}
		total += number
	}
	return statefulNumber(total / float64(len(call.arguments))), nil
}

func (vm *statefulVM) evaluateStringFunction(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	sourceValue, err := vm.callArgument(call, scope, "source", 0)
	if err != nil {
		return statefulNA(), err
	}
	source := statefulValueText(sourceValue, "")
	switch name {
	case "str.length":
		return statefulNumber(float64(len([]rune(source)))), nil
	case "str.lower":
		return statefulString(strings.ToLower(source)), nil
	case "str.upper":
		return statefulString(strings.ToUpper(source)), nil
	case "str.trim":
		return statefulString(strings.TrimSpace(source)), nil
	case "str.format":
		formatted := source
		for index := 1; index < len(call.arguments); index++ {
			value, err := vm.evaluate(call.arguments[index].expression, scope)
			if err != nil {
				return statefulNA(), err
			}
			formatted = strings.ReplaceAll(formatted,
				fmt.Sprintf("{%d}", index-1), statefulValueText(value, ""))
		}
		return statefulString(formatted), nil
	}
	targetValue, err := vm.callArgument(call, scope, "str", 1)
	if err != nil {
		return statefulNA(), err
	}
	target := statefulValueText(targetValue, "")
	switch name {
	case "str.contains":
		return statefulBool(strings.Contains(source, target)), nil
	case "str.startswith":
		return statefulBool(strings.HasPrefix(source, target)), nil
	case "str.endswith":
		return statefulBool(strings.HasSuffix(source, target)), nil
	case "str.pos":
		return statefulNumber(float64(strings.Index(source, target))), nil
	case "str.repeat":
		count := int(math.Max(0, math.Round(statefulNumeric(targetValue))))
		return statefulString(strings.Repeat(source, count)), nil
	case "str.replace_all":
		replacementValue, err := vm.callArgument(call, scope, "replacement", 2)
		if err != nil {
			return statefulNA(), err
		}
		return statefulString(strings.ReplaceAll(source, target, statefulValueText(replacementValue, ""))), nil
	case "str.substring":
		runes := []rune(source)
		begin := int(math.Round(statefulNumeric(targetValue)))
		end := len(runes)
		if len(call.arguments) > 2 {
			endValue, err := vm.callArgument(call, scope, "end_pos", 2)
			if err != nil {
				return statefulNA(), err
			}
			end = int(math.Round(statefulNumeric(endValue)))
		}
		if begin < 0 || begin > end || end > len(runes) {
			return statefulNA(), fmt.Errorf("substring indexes [%d,%d] out of bounds", begin, end)
		}
		return statefulString(string(runes[begin:end])), nil
	default:
		return statefulNA(), fmt.Errorf("unsupported string function %s()", name)
	}
}

func (vm *statefulVM) evaluateMovingAverage(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	source, err := vm.callArgument(call, scope, "source", 0)
	if err != nil {
		return statefulNA(), err
	}
	lengthValue, err := vm.callArgument(call, scope, "length", 1)
	if err != nil {
		return statefulNA(), err
	}
	length := int(math.Max(1, math.Round(statefulNumeric(lengthValue))))
	site := statefulCallSite{call: call, scope: scope}
	state := vm.numericCalls[site]
	if state == nil {
		state = &statefulNumericCall{lastBar: -1}
		vm.numericCalls[site] = state
	}
	for state.lastBar+1 < vm.bar {
		state.values = append(state.values, math.NaN())
		state.volumes = append(state.volumes, math.NaN())
		state.lastBar++
	}
	point := statefulNumeric(source)
	volume := math.NaN()
	if vm.bar >= 0 && vm.bar < len(vm.candles) {
		volume = vm.candles[vm.bar].Volume
	}
	if state.lastBar == vm.bar {
		state.values[vm.bar] = point
		state.volumes[vm.bar] = volume
	} else {
		state.values = append(state.values, point)
		state.volumes = append(state.volumes, volume)
		state.lastBar = vm.bar
	}
	var values []float64
	switch name {
	case "ta.sma", "sma":
		values = rollingAverage(state.values, length)
	case "ta.ema", "ema":
		values = exponentialAverage(state.values, length)
	case "ta.rma", "rma":
		values = runningMovingAverage(state.values, length)
	case "ta.wma", "wma":
		values = weightedMovingAverage(state.values, length)
	case "ta.vwma", "vwma":
		values = volumeWeightedMovingAverage(state.values, state.volumes, length)
	default:
		return statefulNA(), fmt.Errorf("unsupported moving average %s()", name)
	}
	if vm.bar < 0 || vm.bar >= len(values) || !statefulUsable(values[vm.bar]) {
		return statefulNA(), nil
	}
	return statefulNumber(values[vm.bar]), nil
}

func (vm *statefulVM) evaluateValueWhen(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	condition, err := vm.callArgument(call, scope, "condition", 0)
	if err != nil {
		return statefulNA(), err
	}
	truthy, err := vm.booleanValue(condition)
	if err != nil {
		return statefulNA(), err
	}
	source, err := vm.callArgument(call, scope, "source", 1)
	if err != nil {
		return statefulNA(), err
	}
	occurrenceValue, err := vm.callArgument(call, scope, "occurrence", 2)
	if err != nil {
		return statefulNA(), err
	}
	occurrence := int(math.Max(0, math.Round(statefulNumeric(occurrenceValue))))
	site := statefulCallSite{call: call, scope: scope}
	state := vm.valueWhenCalls[site]
	if state == nil {
		state = &statefulValueWhenCall{lastBar: -1}
		vm.valueWhenCalls[site] = state
	}
	if state.lastBar != vm.bar {
		if truthy {
			state.values = append(state.values, cloneStatefulValue(source))
		}
		state.lastBar = vm.bar
	}
	index := len(state.values) - 1 - occurrence
	if index < 0 || index >= len(state.values) {
		return statefulNA(), nil
	}
	return cloneStatefulValue(state.values[index]), nil
}

func (vm *statefulVM) recordHistoryCall(call *statefulCallExpr, scope *statefulScope, values ...statefulValue) *statefulHistoryCall {
	site := statefulCallSite{call: call, scope: scope}
	state := vm.historyCalls[site]
	if state == nil {
		state = &statefulHistoryCall{lastBar: -1}
		vm.historyCalls[site] = state
	}
	for len(state.arguments) < len(values) {
		history := make([]statefulValue, state.lastBar+1)
		for index := range history {
			history[index] = statefulNA()
		}
		state.arguments = append(state.arguments, history)
	}
	for state.lastBar+1 < vm.bar {
		for index := range state.arguments {
			state.arguments[index] = append(state.arguments[index], statefulNA())
		}
		state.lastBar++
	}
	if state.lastBar == vm.bar {
		for index, value := range values {
			state.arguments[index][vm.bar] = cloneStatefulValue(value)
		}
		return state
	}
	for index := range state.arguments {
		value := statefulNA()
		if index < len(values) {
			value = cloneStatefulValue(values[index])
		}
		state.arguments[index] = append(state.arguments[index], value)
	}
	state.lastBar = vm.bar
	return state
}

func statefulHistoryAt(state *statefulHistoryCall, argument, bar int) statefulValue {
	if state == nil || argument < 0 || argument >= len(state.arguments) ||
		bar < 0 || bar >= len(state.arguments[argument]) {
		return statefulNA()
	}
	return cloneStatefulValue(state.arguments[argument][bar])
}

func statefulWindowNumbers(state *statefulHistoryCall, argument, end, length int) []float64 {
	if length <= 0 {
		return nil
	}
	start := end - length + 1
	if start < 0 {
		start = 0
	}
	values := []float64{}
	for bar := start; bar <= end; bar++ {
		number := statefulNumeric(statefulHistoryAt(state, argument, bar))
		if statefulUsable(number) {
			values = append(values, number)
		}
	}
	return values
}

func statefulMeanAndDeviation(values []float64) (float64, float64, bool) {
	if len(values) == 0 {
		return math.NaN(), math.NaN(), false
	}
	mean := 0.0
	for _, value := range values {
		mean += value
	}
	mean /= float64(len(values))
	variance := 0.0
	for _, value := range values {
		delta := value - mean
		variance += delta * delta
	}
	variance /= float64(len(values))
	return mean, math.Sqrt(variance), true
}

func (vm *statefulVM) callLength(call *statefulCallExpr, scope *statefulScope, name string, index, fallback int) (int, error) {
	value, err := vm.callArgument(call, scope, name, index)
	if err != nil {
		return 0, err
	}
	number := statefulNumeric(value)
	if !statefulUsable(number) {
		return fallback, nil
	}
	length := int(math.Round(number))
	if length <= 0 {
		return 0, fmt.Errorf("length must be greater than zero")
	}
	return length, nil
}

func (vm *statefulVM) evaluateRollingSum(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	source, err := vm.callArgument(call, scope, "source", 0)
	if err != nil {
		return statefulNA(), err
	}
	length, err := vm.callLength(call, scope, "length", 1, 1)
	if err != nil {
		return statefulNA(), err
	}
	state := vm.recordHistoryCall(call, scope, source)
	values := statefulWindowNumbers(state, 0, vm.bar, length)
	if len(values) < length {
		return statefulNA(), nil
	}
	sum := 0.0
	for _, value := range values {
		sum += value
	}
	return statefulNumber(sum), nil
}

func (vm *statefulVM) evaluateTAFunction(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	name = strings.TrimPrefix(name, "ta.")
	switch name {
	case "atr", "tr":
		return vm.evaluateTrueRangeFunction(name, call, scope)
	}

	sourceIndex, lengthIndex := 0, 1
	sourceName, lengthName := "source", "length"
	var source statefulValue
	var err error
	if (name == "highest" || name == "highestbars" || name == "lowest" || name == "lowestbars") && len(call.arguments) == 1 {
		if name == "highest" || name == "highestbars" {
			source, err = vm.resolveIdentifier("high", scope)
		} else {
			source, err = vm.resolveIdentifier("low", scope)
		}
		sourceIndex, lengthIndex = -1, 0
	} else {
		source, err = vm.callArgument(call, scope, sourceName, sourceIndex)
	}
	if err != nil {
		return statefulNA(), err
	}

	switch name {
	case "cross", "crossover", "crossunder":
		second, err := vm.callArgument(call, scope, "source2", 1)
		if err != nil {
			return statefulNA(), err
		}
		state := vm.recordHistoryCall(call, scope, source, second)
		currentA := statefulNumeric(statefulHistoryAt(state, 0, vm.bar))
		currentB := statefulNumeric(statefulHistoryAt(state, 1, vm.bar))
		previousA := statefulNumeric(statefulHistoryAt(state, 0, vm.bar-1))
		previousB := statefulNumeric(statefulHistoryAt(state, 1, vm.bar-1))
		if !statefulUsable(currentA) || !statefulUsable(currentB) ||
			!statefulUsable(previousA) || !statefulUsable(previousB) {
			return statefulBool(false), nil
		}
		over := currentA > currentB && previousA <= previousB
		under := currentA < currentB && previousA >= previousB
		if name == "crossover" {
			return statefulBool(over), nil
		}
		if name == "crossunder" {
			return statefulBool(under), nil
		}
		return statefulBool(over || under), nil
	case "barssince":
		state := vm.recordHistoryCall(call, scope, source)
		for bar := vm.bar; bar >= 0; bar-- {
			value := statefulHistoryAt(state, 0, bar)
			if value.kind == statefulValueBool && value.boolean {
				return statefulNumber(float64(vm.bar - bar)), nil
			}
		}
		return statefulNA(), nil
	case "macd":
		fastLength, err := vm.callLength(call, scope, "fastlen", 1, 12)
		if err != nil {
			return statefulNA(), err
		}
		slowLength, err := vm.callLength(call, scope, "slowlen", 2, 26)
		if err != nil {
			return statefulNA(), err
		}
		signalLength, err := vm.callLength(call, scope, "siglen", 3, 9)
		if err != nil {
			return statefulNA(), err
		}
		state := vm.recordHistoryCall(call, scope, source)
		values := statefulHistoryNumbers(state, 0)
		fast := exponentialAverage(values, fastLength)
		slow := exponentialAverage(values, slowLength)
		line := make([]float64, len(values))
		for index := range line {
			line[index] = math.NaN()
			if statefulUsable(fast[index]) && statefulUsable(slow[index]) {
				line[index] = fast[index] - slow[index]
			}
		}
		signal := exponentialAverage(line, signalLength)
		if vm.bar >= len(line) || !statefulUsable(line[vm.bar]) || !statefulUsable(signal[vm.bar]) {
			return statefulValue{kind: statefulValueTuple, tuple: []statefulValue{statefulNA(), statefulNA(), statefulNA()}}, nil
		}
		return statefulValue{kind: statefulValueTuple, tuple: []statefulValue{
			statefulNumber(line[vm.bar]),
			statefulNumber(signal[vm.bar]),
			statefulNumber(line[vm.bar] - signal[vm.bar]),
		}}, nil
	}

	length, err := vm.callLength(call, scope, lengthName, lengthIndex, 1)
	if err != nil {
		return statefulNA(), err
	}
	state := vm.recordHistoryCall(call, scope, source)
	current := statefulNumeric(statefulHistoryAt(state, 0, vm.bar))
	previous := statefulNumeric(statefulHistoryAt(state, 0, vm.bar-length))

	switch name {
	case "change":
		currentValue := statefulHistoryAt(state, 0, vm.bar)
		previousValue := statefulHistoryAt(state, 0, vm.bar-length)
		if currentValue.kind == statefulValueBool && previousValue.kind == statefulValueBool {
			return statefulBool(currentValue.boolean != previousValue.boolean), nil
		}
		if !statefulUsable(current) || !statefulUsable(previous) {
			return statefulNA(), nil
		}
		return statefulNumber(current - previous), nil
	case "mom":
		if !statefulUsable(current) || !statefulUsable(previous) {
			return statefulNA(), nil
		}
		return statefulNumber(current - previous), nil
	case "roc":
		if !statefulUsable(current) || !statefulUsable(previous) || previous == 0 {
			return statefulNA(), nil
		}
		return statefulNumber(100 * (current - previous) / previous), nil
	case "highest", "lowest", "highestbars", "lowestbars":
		best := math.NaN()
		bestOffset := -1
		for offset := 0; offset < length; offset++ {
			value := statefulNumeric(statefulHistoryAt(state, 0, vm.bar-offset))
			if !statefulUsable(value) {
				continue
			}
			if !statefulUsable(best) ||
				(strings.HasPrefix(name, "highest") && value > best) ||
				(strings.HasPrefix(name, "lowest") && value < best) {
				best, bestOffset = value, offset
			}
		}
		if bestOffset < 0 {
			return statefulNA(), nil
		}
		if strings.HasSuffix(name, "bars") {
			return statefulNumber(float64(-bestOffset)), nil
		}
		return statefulNumber(best), nil
	case "rising", "falling":
		if !statefulUsable(current) {
			return statefulBool(false), nil
		}
		for offset := 1; offset <= length; offset++ {
			value := statefulNumeric(statefulHistoryAt(state, 0, vm.bar-offset))
			if !statefulUsable(value) {
				continue
			}
			if name == "rising" && current <= value || name == "falling" && current >= value {
				return statefulBool(false), nil
			}
		}
		return statefulBool(vm.bar > 0), nil
	case "dev", "stdev", "variance", "range", "bb", "bbw":
		values := statefulWindowNumbers(state, 0, vm.bar, length)
		if len(values) < length {
			if name == "bb" {
				return statefulValue{kind: statefulValueTuple, tuple: []statefulValue{
					statefulNA(), statefulNA(), statefulNA(),
				}}, nil
			}
			return statefulNA(), nil
		}
		mean, deviation, ok := statefulMeanAndDeviation(values)
		if !ok {
			return statefulNA(), nil
		}
		switch name {
		case "dev":
			total := 0.0
			for _, value := range values {
				total += math.Abs(value - mean)
			}
			return statefulNumber(total / float64(len(values))), nil
		case "stdev":
			return statefulNumber(deviation), nil
		case "variance":
			return statefulNumber(deviation * deviation), nil
		case "range":
			minimum, maximum := values[0], values[0]
			for _, value := range values[1:] {
				minimum = math.Min(minimum, value)
				maximum = math.Max(maximum, value)
			}
			return statefulNumber(maximum - minimum), nil
		case "bb", "bbw":
			multiplier, err := vm.callArgument(call, scope, "mult", 2)
			if err != nil {
				return statefulNA(), err
			}
			mult := statefulNumeric(multiplier)
			upper, lower := mean+mult*deviation, mean-mult*deviation
			if name == "bbw" {
				if mean == 0 {
					return statefulNA(), nil
				}
				return statefulNumber((upper - lower) / mean), nil
			}
			return statefulValue{kind: statefulValueTuple, tuple: []statefulValue{
				statefulNumber(mean), statefulNumber(upper), statefulNumber(lower),
			}}, nil
		}
	case "rsi":
		values := statefulHistoryNumbers(state, 0)
		gains := make([]float64, len(values))
		losses := make([]float64, len(values))
		for index := range values {
			gains[index], losses[index] = math.NaN(), math.NaN()
			if index > 0 && statefulUsable(values[index]) && statefulUsable(values[index-1]) {
				delta := values[index] - values[index-1]
				gains[index] = math.Max(delta, 0)
				losses[index] = math.Max(-delta, 0)
			}
		}
		averageGain := runningMovingAverage(gains, length)
		averageLoss := runningMovingAverage(losses, length)
		if vm.bar >= len(averageGain) || !statefulUsable(averageGain[vm.bar]) || !statefulUsable(averageLoss[vm.bar]) {
			return statefulNA(), nil
		}
		if averageLoss[vm.bar] == 0 {
			return statefulNumber(100), nil
		}
		return statefulNumber(100 - 100/(1+averageGain[vm.bar]/averageLoss[vm.bar])), nil
	case "hma":
		values := statefulHistoryNumbers(state, 0)
		half := int(math.Max(1, math.Round(float64(length)/2)))
		root := int(math.Max(1, math.Round(math.Sqrt(float64(length)))))
		fullWMA := weightedMovingAverage(values, length)
		halfWMA := weightedMovingAverage(values, half)
		combined := make([]float64, len(values))
		for index := range values {
			combined[index] = math.NaN()
			if statefulUsable(fullWMA[index]) && statefulUsable(halfWMA[index]) {
				combined[index] = 2*halfWMA[index] - fullWMA[index]
			}
		}
		hull := weightedMovingAverage(combined, root)
		if vm.bar >= len(hull) || !statefulUsable(hull[vm.bar]) {
			return statefulNA(), nil
		}
		return statefulNumber(hull[vm.bar]), nil
	}
	return statefulNA(), fmt.Errorf("unsupported TA function ta.%s()", name)
}

func statefulHistoryNumbers(state *statefulHistoryCall, argument int) []float64 {
	if state == nil || argument < 0 || argument >= len(state.arguments) {
		return nil
	}
	values := make([]float64, len(state.arguments[argument]))
	for index, value := range state.arguments[argument] {
		values[index] = statefulNumeric(value)
	}
	return values
}

func (vm *statefulVM) evaluateTrueRangeFunction(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	trueRanges := make([]float64, vm.bar+1)
	for index := range trueRanges {
		candle := vm.candles[index]
		if index == 0 {
			trueRanges[index] = candle.High - candle.Low
			continue
		}
		previousClose := vm.candles[index-1].Close
		trueRanges[index] = math.Max(candle.High-candle.Low,
			math.Max(math.Abs(candle.High-previousClose), math.Abs(candle.Low-previousClose)))
	}
	if name == "tr" {
		return statefulNumber(trueRanges[vm.bar]), nil
	}
	length, err := vm.callLength(call, scope, "length", 0, 14)
	if err != nil {
		return statefulNA(), err
	}
	average := runningMovingAverage(trueRanges, length)
	if vm.bar >= len(average) || !statefulUsable(average[vm.bar]) {
		return statefulNA(), nil
	}
	return statefulNumber(average[vm.bar]), nil
}

func (vm *statefulVM) evaluatePivot(call *statefulCallExpr, scope *statefulScope, kind string) (statefulValue, error) {
	positional := 0
	hasNamedSource := false
	for _, argument := range call.arguments {
		if argument.name == "" {
			positional++
		} else if argument.name == "source" {
			hasNamedSource = true
		}
	}
	source := statefulExpr(&statefulIdentifierExpr{name: kind})
	leftIndex, rightIndex := 0, 1
	if positional >= 3 || hasNamedSource {
		source = vm.rawArgument(call, "source", 0)
		leftIndex, rightIndex = 1, 2
	}
	if source == nil {
		return statefulNA(), fmt.Errorf("ta.pivot%s() is missing its source", kind)
	}
	leftValue, err := vm.callArgument(call, scope, "leftbars", leftIndex)
	if err != nil {
		return statefulNA(), err
	}
	rightValue, err := vm.callArgument(call, scope, "rightbars", rightIndex)
	if err != nil {
		return statefulNA(), err
	}
	left := int(math.Max(1, math.Round(statefulNumeric(leftValue))))
	right := int(math.Max(1, math.Round(statefulNumeric(rightValue))))
	if vm.bar < left+right {
		return statefulNA(), nil
	}
	center, err := vm.numericExpressionAtOffset(source, scope, right)
	if err != nil || !statefulUsable(center) {
		return statefulNA(), err
	}
	for offset := right + 1; offset <= right+left; offset++ {
		neighbor, err := vm.numericExpressionAtOffset(source, scope, offset)
		if err != nil {
			return statefulNA(), err
		}
		if !statefulUsable(neighbor) || (kind == "high" && neighbor >= center) || (kind == "low" && neighbor <= center) {
			return statefulNA(), nil
		}
	}
	for offset := right - 1; offset >= 0; offset-- {
		neighbor, err := vm.numericExpressionAtOffset(source, scope, offset)
		if err != nil {
			return statefulNA(), err
		}
		if !statefulUsable(neighbor) || (kind == "high" && neighbor >= center) || (kind == "low" && neighbor <= center) {
			return statefulNA(), nil
		}
	}
	return statefulNumber(center), nil
}

func (vm *statefulVM) numericExpressionAtOffset(expression statefulExpr, scope *statefulScope, offset int) (float64, error) {
	identifier, ok := expression.(*statefulIdentifierExpr)
	if !ok {
		if offset != 0 {
			return math.NaN(), nil
		}
		value, err := vm.evaluate(expression, scope)
		return statefulNumeric(value), err
	}
	if cell, exists := scope.lookup(identifier.name); exists {
		if offset == 0 {
			return statefulNumeric(cell.value), nil
		}
		at := len(cell.history) - offset
		if at >= 0 && at < len(cell.history) {
			return statefulNumeric(cell.history[at]), nil
		}
		return math.NaN(), nil
	}
	at := vm.bar - offset
	if at < 0 || at >= len(vm.candles) {
		return math.NaN(), nil
	}
	candle := vm.candles[at]
	switch identifier.name {
	case "open":
		return candle.Open, nil
	case "high":
		return candle.High, nil
	case "low":
		return candle.Low, nil
	case "close":
		return candle.Close, nil
	case "volume":
		return candle.Volume, nil
	default:
		return math.NaN(), nil
	}
}

func (vm *statefulVM) callArgument(call *statefulCallExpr, scope *statefulScope, name string, index int) (statefulValue, error) {
	if name != "" {
		for _, argument := range call.arguments {
			if argument.name == name {
				return vm.evaluate(argument.expression, scope)
			}
		}
	}
	positional := 0
	for _, argument := range call.arguments {
		if argument.name != "" {
			continue
		}
		if positional == index {
			return vm.evaluate(argument.expression, scope)
		}
		positional++
	}
	return statefulNA(), nil
}

func (vm *statefulVM) rawArgument(call *statefulCallExpr, name string, index int) statefulExpr {
	if name != "" {
		for _, argument := range call.arguments {
			if argument.name == name {
				return argument.expression
			}
		}
	}
	positional := 0
	for _, argument := range call.arguments {
		if argument.name != "" {
			continue
		}
		if positional == index {
			return argument.expression
		}
		positional++
	}
	return nil
}

func (vm *statefulVM) colorNew(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	base, err := vm.callArgument(call, scope, "color", 0)
	if err != nil {
		return statefulNA(), err
	}
	transparency, err := vm.callArgument(call, scope, "transp", 1)
	if err != nil {
		return statefulNA(), err
	}
	color := statefulColorText(base)
	point := statefulNumeric(transparency)
	if color == "" {
		return statefulNA(), nil
	}
	if !statefulUsable(point) {
		return statefulColor(color), nil
	}
	return statefulColor(withTransparency(color, point)), nil
}

func (vm *statefulVM) colorComponent(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	value, err := vm.callArgument(call, scope, "", 0)
	if err != nil {
		return statefulNA(), err
	}
	r, g, b := statefulRGBComponents(statefulColorText(value))
	switch name {
	case "color.r":
		return statefulNumber(float64(r)), nil
	case "color.g":
		return statefulNumber(float64(g)), nil
	default:
		return statefulNumber(float64(b)), nil
	}
}

func (vm *statefulVM) colorRGB(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	components := [3]int{}
	for index := 0; index < 3; index++ {
		value, err := vm.callArgument(call, scope, "", index)
		if err != nil {
			return statefulNA(), err
		}
		components[index] = int(math.Max(0, math.Min(255, math.Round(statefulNumeric(value)))))
	}
	color := fmt.Sprintf("#%02x%02x%02x", components[0], components[1], components[2])
	if len(call.arguments) > 3 {
		transparency, err := vm.callArgument(call, scope, "transp", 3)
		if err != nil {
			return statefulNA(), err
		}
		if point := statefulNumeric(transparency); statefulUsable(point) {
			color = withTransparency(color, point)
		}
	}
	return statefulColor(color), nil
}

func statefulRGBComponents(color string) (int, int, int) {
	color = strings.TrimSpace(color)
	if len(color) >= 7 && color[0] == '#' {
		return hexPair(color[1:3]), hexPair(color[3:5]), hexPair(color[5:7])
	}
	var r, g, b int
	if _, err := fmt.Sscanf(color, "rgba(%d, %d, %d", &r, &g, &b); err == nil {
		return r, g, b
	}
	if _, err := fmt.Sscanf(color, "rgb(%d, %d, %d", &r, &g, &b); err == nil {
		return r, g, b
	}
	return 0, 0, 0
}

func (vm *statefulVM) constructBox(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	object := vm.newObject(statefulBoxObject)
	var err error
	if object.x1, err = vm.numberArgument(call, scope, "left", 0); err != nil {
		return statefulNA(), err
	}
	if object.y1, err = vm.numberArgument(call, scope, "top", 1); err != nil {
		return statefulNA(), err
	}
	if object.x2, err = vm.numberArgument(call, scope, "right", 2); err != nil {
		return statefulNA(), err
	}
	if object.y2, err = vm.numberArgument(call, scope, "bottom", 3); err != nil {
		return statefulNA(), err
	}
	object.xloc = vm.textArgument(call, scope, "xloc", 8, "xloc.bar_index")
	object.background = vm.colorArgument(call, scope, "bgcolor", 9, defaultColors[0])
	object.color = vm.colorArgument(call, scope, "border_color", 4, "")
	vm.retainObject(object, vm.program.maxBoxes)
	return statefulValue{kind: statefulValueObject, object: object}, nil
}

func (vm *statefulVM) constructLine(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	object := vm.newObject(statefulLineObject)
	var err error
	if object.x1, err = vm.numberArgument(call, scope, "x1", 0); err != nil {
		return statefulNA(), err
	}
	if object.y1, err = vm.numberArgument(call, scope, "y1", 1); err != nil {
		return statefulNA(), err
	}
	if object.x2, err = vm.numberArgument(call, scope, "x2", 2); err != nil {
		return statefulNA(), err
	}
	if object.y2, err = vm.numberArgument(call, scope, "y2", 3); err != nil {
		return statefulNA(), err
	}
	object.xloc = vm.textArgument(call, scope, "xloc", 4, "xloc.bar_index")
	object.color = vm.colorArgument(call, scope, "color", 6, defaultColors[0])
	object.style = vm.textArgument(call, scope, "style", 7, "line.style_solid")
	width := vm.numberArgumentOr(call, scope, "width", 8, 1)
	object.width = int(math.Max(1, math.Round(width)))
	vm.retainObject(object, vm.program.maxLines)
	return statefulValue{kind: statefulValueObject, object: object}, nil
}

func (vm *statefulVM) lineCoordinate(call *statefulCallExpr, scope *statefulScope, coordinate string) (statefulValue, error) {
	value, err := vm.callArgument(call, scope, "id", 0)
	if err != nil {
		return statefulNA(), err
	}
	if value.kind != statefulValueObject || value.object == nil || value.object.kind != statefulLineObject || value.object.deleted {
		return statefulNA(), nil
	}
	switch coordinate {
	case "x2":
		return statefulNumber(value.object.x2), nil
	default:
		return statefulNA(), fmt.Errorf("unsupported line coordinate %s", coordinate)
	}
}

func (vm *statefulVM) setLineCoordinate(call *statefulCallExpr, scope *statefulScope, coordinate string) (statefulValue, error) {
	value, err := vm.callArgument(call, scope, "id", 0)
	if err != nil {
		return statefulNA(), err
	}
	if value.kind != statefulValueObject || value.object == nil || value.object.kind != statefulLineObject || value.object.deleted {
		return statefulNA(), nil
	}
	coordinateValue, err := vm.callArgument(call, scope, coordinate, 1)
	if err != nil {
		return statefulNA(), err
	}
	point := statefulNumeric(coordinateValue)
	if !statefulUsable(point) {
		return statefulNA(), nil
	}
	switch coordinate {
	case "x2":
		value.object.x2 = point
	default:
		return statefulNA(), fmt.Errorf("unsupported line coordinate %s", coordinate)
	}
	return statefulNA(), nil
}

func (vm *statefulVM) constructLabel(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	object := vm.newObject(statefulLabelObject)
	var err error
	if object.x1, err = vm.numberArgument(call, scope, "x", 0); err != nil {
		return statefulNA(), err
	}
	if object.y1, err = vm.numberArgument(call, scope, "y", 1); err != nil {
		return statefulNA(), err
	}
	object.text = vm.textArgument(call, scope, "text", 2, "")
	object.xloc = vm.textArgument(call, scope, "xloc", 3, "xloc.bar_index")
	object.background = vm.colorArgument(call, scope, "color", 5, resolveColor("color.blue", defaultColors[0]))
	object.style = vm.textArgument(call, scope, "style", 6, "label.style_label_down")
	object.color = vm.colorArgument(call, scope, "textcolor", 7, "#ffffff")
	object.tooltip = vm.textArgument(call, scope, "tooltip", 10, "")
	vm.retainObject(object, vm.program.maxLabels)
	return statefulValue{kind: statefulValueObject, object: object}, nil
}

func (vm *statefulVM) constructTable(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	object := vm.newObject(statefulTableObject)
	object.position = vm.textArgument(call, scope, "position", 0, "position.top_right")
	object.table = map[int]map[int]statefulTableCell{}
	vm.objects = append(vm.objects, object)
	return statefulValue{kind: statefulValueObject, object: object}, nil
}

func (vm *statefulVM) newObject(kind statefulObjectKind) *statefulObject {
	vm.nextObjectID++
	return &statefulObject{id: vm.nextObjectID, kind: kind, createdBar: vm.bar, width: 1}
}

func (vm *statefulVM) retainObject(object *statefulObject, limit int) {
	if vm.outputSuppressed {
		return
	}
	vm.objects = append(vm.objects, object)
	if limit <= 0 {
		return
	}
	count := 0
	for index := len(vm.objects) - 1; index >= 0; index-- {
		candidate := vm.objects[index]
		if candidate.kind != object.kind || candidate.deleted {
			continue
		}
		count++
		if count > limit {
			candidate.deleted = true
		}
	}
}

func (vm *statefulVM) numberArgument(call *statefulCallExpr, scope *statefulScope, name string, index int) (float64, error) {
	value, err := vm.callArgument(call, scope, name, index)
	if err != nil {
		return math.NaN(), err
	}
	return statefulNumeric(value), nil
}

func (vm *statefulVM) numberArgumentOr(call *statefulCallExpr, scope *statefulScope, name string, index int, fallback float64) float64 {
	value, err := vm.numberArgument(call, scope, name, index)
	if err != nil || !statefulUsable(value) {
		return fallback
	}
	return value
}

func (vm *statefulVM) textArgument(call *statefulCallExpr, scope *statefulScope, name string, index int, fallback string) string {
	value, err := vm.callArgument(call, scope, name, index)
	if err != nil {
		return fallback
	}
	text := statefulValueText(value, "")
	if text == "" || text == "NaN" {
		return fallback
	}
	return text
}

func (vm *statefulVM) colorArgument(call *statefulCallExpr, scope *statefulScope, name string, index int, fallback string) string {
	expression := vm.rawArgument(call, name, index)
	if expression == nil {
		return fallback
	}
	value, err := vm.evaluate(expression, scope)
	if err != nil {
		return fallback
	}
	if value.kind == statefulValueNA || value.kind == statefulValueNumber && !statefulUsable(value.number) {
		// Preserve an explicitly supplied color(na) as transparent. Returning the
		// fallback here would make it indistinguishable from an omitted argument
		// and gives labels/boxes an opaque default background.
		return "transparent"
	}
	if color := statefulColorText(value); color != "" {
		return color
	}
	return fallback
}

func (vm *statefulVM) evaluateTableCell(object *statefulObject, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	column := int(math.Round(vm.numberArgumentOr(call, scope, "column", 0, -1)))
	row := int(math.Round(vm.numberArgumentOr(call, scope, "row", 1, -1)))
	if column < 0 || row < 0 {
		return statefulNA(), fmt.Errorf("table cell coordinates must be non-negative")
	}
	text := vm.textArgument(call, scope, "text", 2, "")
	textColor := vm.colorArgument(call, scope, "text_color", 5, "#ffffff")
	textSize := vm.textArgument(call, scope, "text_size", 8, "")
	if object.table == nil {
		object.table = map[int]map[int]statefulTableCell{}
	}
	if object.table[row] == nil {
		object.table[row] = map[int]statefulTableCell{}
	}
	object.table[row][column] = statefulTableCell{text: text, textColor: textColor, textSize: textSize}
	if textSize != "" {
		object.textSize = textSize
	}
	return statefulNA(), nil
}

func (vm *statefulVM) evaluatePlot(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	site := statefulCallSite{call: call, scope: scope}
	plot := vm.plotCalls[site]
	if plot == nil {
		vm.nextPlotID++
		name := vm.textArgument(call, scope, "title", 1, vm.assigningName)
		style := vm.textArgument(call, scope, "style", 4, "plot.style_line")
		width := int(math.Max(1, math.Round(vm.numberArgumentOr(call, scope, "linewidth", 3, 1))))
		offset := int(math.Round(vm.numberArgumentOr(call, scope, "offset", 7, 0)))
		plot = &statefulPlot{
			id: vm.nextPlotID, name: name, style: style, width: width,
			offset: offset, lastBar: -1, declared: true,
		}
		vm.plotCalls[site] = plot
		if !vm.outputSuppressed {
			vm.plots = append(vm.plots, plot)
		}
	}
	value, err := vm.callArgument(call, scope, "series", 0)
	if err != nil {
		return statefulNA(), err
	}
	color := vm.colorArgument(call, scope, "color", 2, defaultColors[0])
	for plot.lastBar+1 < vm.bar {
		plot.values = append(plot.values, math.NaN())
		plot.colors = append(plot.colors, "")
		plot.lastBar++
	}
	point := statefulNumeric(value)
	if plot.lastBar == vm.bar {
		plot.values[vm.bar], plot.colors[vm.bar] = point, color
	} else {
		plot.values = append(plot.values, point)
		plot.colors = append(plot.colors, color)
		plot.lastBar = vm.bar
	}
	return statefulValue{kind: statefulValuePlot, plot: plot}, nil
}

func (vm *statefulVM) evaluatePlotMarker(name string, call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	series, err := vm.callArgument(call, scope, "series", 0)
	if err != nil {
		return statefulNA(), err
	}
	marker := ""
	location := vm.textArgument(call, scope, "location", 3, "location.abovebar")
	y := vm.candles[vm.bar].High
	if location == "location.belowbar" {
		y = vm.candles[vm.bar].Low
	}
	if name == "plotarrow" {
		value := statefulNumeric(series)
		if !statefulUsable(value) || value == 0 {
			return statefulNA(), nil
		}
		if value > 0 {
			marker, location, y = "▲", "location.belowbar", vm.candles[vm.bar].Low
		} else {
			marker, location, y = "▼", "location.abovebar", vm.candles[vm.bar].High
		}
	} else {
		visible, err := vm.booleanValue(series)
		if err != nil {
			return statefulNA(), err
		}
		if !visible {
			return statefulNA(), nil
		}
		if name == "plotchar" {
			marker = vm.textArgument(call, scope, "char", 2, "•")
		} else {
			style := vm.textArgument(call, scope, "style", 2, "shape.xcross")
			marker = statefulShapeText(style)
			if text := vm.textArgument(call, scope, "text", 6, ""); text != "" {
				marker = text
			}
		}
		if location == "location.absolute" {
			y = statefulNumeric(series)
		}
	}
	object := vm.newObject(statefulLabelObject)
	object.x1 = float64(vm.bar) + vm.numberArgumentOr(call, scope, "offset", 5, 0)
	object.y1 = y
	object.xloc = "xloc.bar_index"
	object.text = marker
	object.style = "label.style_none"
	object.color = vm.colorArgument(call, scope, "textcolor", 7,
		vm.colorArgument(call, scope, "color", 4, defaultColors[0]))
	object.background = "transparent"
	object.position = location
	object.textSize = vm.textArgument(call, scope, "size", 9, "size.auto")
	vm.retainObject(object, vm.program.maxLabels)
	return statefulValue{kind: statefulValueObject, object: object}, nil
}

func statefulShapeText(style string) string {
	switch style {
	case "shape.triangleup":
		return "▲"
	case "shape.triangledown":
		return "▼"
	case "shape.arrowup":
		return "↑"
	case "shape.arrowdown":
		return "↓"
	case "shape.circle":
		return "●"
	case "shape.square":
		return "■"
	case "shape.diamond":
		return "◆"
	case "shape.cross":
		return "+"
	case "shape.labelup", "shape.labeldown":
		return ""
	default:
		return "×"
	}
}

func (vm *statefulVM) evaluateFill(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	first, err := vm.callArgument(call, scope, "plot1", 0)
	if err != nil {
		return statefulNA(), err
	}
	second, err := vm.callArgument(call, scope, "plot2", 1)
	if err != nil {
		return statefulNA(), err
	}
	if first.kind != statefulValuePlot || second.kind != statefulValuePlot {
		return statefulNA(), fmt.Errorf("fill() expects plot handles")
	}
	site := statefulCallSite{call: call, scope: scope}
	fill := vm.fillCalls[site]
	if fill == nil {
		vm.nextFillID++
		fill = &statefulFill{id: vm.nextFillID, first: first.plot, second: second.plot, lastBar: -1}
		vm.fillCalls[site] = fill
		if !vm.outputSuppressed {
			vm.fills = append(vm.fills, fill)
		}
	}
	color := vm.colorArgument(call, scope, "color", 2, "")
	for fill.lastBar+1 < vm.bar {
		fill.colors = append(fill.colors, "")
		fill.lastBar++
	}
	if fill.lastBar == vm.bar {
		fill.colors[vm.bar] = color
	} else {
		fill.colors = append(fill.colors, color)
		fill.lastBar = vm.bar
	}
	return statefulNA(), nil
}

func (vm *statefulVM) evaluateSecurity(call *statefulCallExpr, scope *statefulScope) (statefulValue, error) {
	site := statefulCallSite{call: call, scope: scope}
	if cached, ok := vm.securityCalls[site]; ok {
		if vm.bar >= 0 && vm.bar < len(cached.values) {
			return cloneStatefulValue(cached.values[vm.bar]), nil
		}
		return statefulNA(), nil
	}
	timeframeExpression := vm.rawArgument(call, "timeframe", 1)
	requestedExpression := vm.rawArgument(call, "expression", 2)
	if vm.rawArgument(call, "symbol", 0) == nil || timeframeExpression == nil || requestedExpression == nil {
		return statefulNA(), fmt.Errorf("request.security() expects symbol, timeframe, and expression")
	}
	timeframeValue, err := vm.evaluate(timeframeExpression, scope)
	if err != nil {
		return statefulNA(), err
	}
	timeframe := statefulValueText(timeframeValue, "")
	chartSeconds := statefulCandleInterval(vm.candles)
	targetSeconds, valid := timeframeSeconds(timeframe)
	if !valid {
		return statefulNA(), fmt.Errorf("unsupported request.security() timeframe %q", timeframe)
	}
	if targetSeconds > 0 && targetSeconds < chartSeconds {
		return statefulNA(), fmt.Errorf("lower-timeframe request.security() is unsupported")
	}
	if targetSeconds == chartSeconds {
		targetSeconds = 0
	}
	targetCandles := vm.candles
	if targetSeconds > 0 {
		targetCandles, err = aggregateRuntimeCandles(vm.candles, targetSeconds)
		if err != nil {
			return statefulNA(), err
		}
	}
	childRequest := vm.request
	childRequest.Candles = targetCandles
	child := newStatefulVM(vm.ctx, vm.program, childRequest, targetCandles)
	child.outputSuppressed = true
	// request.security has an independent execution context. Re-run the global
	// statements that precede this call on every target bar so intermediate
	// dependencies (for example `src = close * 2`) use target-timeframe OHLCV.
	// Copying the parent scalar cell would freeze it at the chart bar and also
	// leak parent `var` state into the child context.
	prefix := statefulStatementsBeforeCall(vm.program.statements, call)
	targetValues := make([]statefulValue, len(targetCandles))
	for index := range targetCandles {
		select {
		case <-vm.ctx.Done():
			return statefulNA(), vm.ctx.Err()
		default:
		}
		child.bar = index
		if _, err := child.executeBlock(prefix, child.global); err != nil {
			return statefulNA(), fmt.Errorf("request.security dependency: %w", err)
		}
		value, err := child.evaluate(requestedExpression, child.global)
		if err != nil {
			return statefulNA(), fmt.Errorf("request.security expression: %w", err)
		}
		targetValues[index] = cloneStatefulValue(value)
		child.commitBar()
	}
	mapped := targetValues
	if targetSeconds > 0 {
		mapped = mapStatefulSecurityValues(vm.candles, targetCandles, targetValues, targetSeconds)
	}
	vm.securityCalls[site] = statefulSecurityResult{values: mapped}
	if vm.bar >= 0 && vm.bar < len(mapped) {
		return cloneStatefulValue(mapped[vm.bar]), nil
	}
	return statefulNA(), nil
}

func statefulStatementsBeforeCall(statements []statefulStmt, target *statefulCallExpr) []statefulStmt {
	for index, statement := range statements {
		if statefulStatementContainsCall(statement, target) {
			return statements[:index]
		}
	}
	return statements
}

func statefulStatementContainsCall(statement statefulStmt, target *statefulCallExpr) bool {
	switch value := statement.(type) {
	case *statefulAssignStmt:
		return statefulExpressionContainsCall(value.expression, target)
	case *statefulExprStmt:
		return statefulExpressionContainsCall(value.expression, target)
	case *statefulIfStmt:
		for _, branch := range value.branches {
			if statefulExpressionContainsCall(branch.condition, target) {
				return true
			}
			for _, child := range branch.body {
				if statefulStatementContainsCall(child, target) {
					return true
				}
			}
		}
		for _, child := range value.other {
			if statefulStatementContainsCall(child, target) {
				return true
			}
		}
	case *statefulForStmt:
		if statefulExpressionContainsCall(value.from, target) ||
			statefulExpressionContainsCall(value.to, target) ||
			statefulExpressionContainsCall(value.in, target) {
			return true
		}
		for _, child := range value.body {
			if statefulStatementContainsCall(child, target) {
				return true
			}
		}
	}
	return false
}

func statefulExpressionContainsCall(expression statefulExpr, target *statefulCallExpr) bool {
	if expression == nil {
		return false
	}
	switch value := expression.(type) {
	case *statefulCallExpr:
		if value == target || statefulExpressionContainsCall(value.callee, target) {
			return true
		}
		for _, argument := range value.arguments {
			if statefulExpressionContainsCall(argument.expression, target) {
				return true
			}
		}
	case *statefulUnaryExpr:
		return statefulExpressionContainsCall(value.value, target)
	case *statefulBinaryExpr:
		return statefulExpressionContainsCall(value.left, target) || statefulExpressionContainsCall(value.right, target)
	case *statefulTernaryExpr:
		return statefulExpressionContainsCall(value.condition, target) ||
			statefulExpressionContainsCall(value.whenTrue, target) ||
			statefulExpressionContainsCall(value.whenFalse, target)
	case *statefulFieldExpr:
		return statefulExpressionContainsCall(value.receiver, target)
	case *statefulIndexExpr:
		return statefulExpressionContainsCall(value.receiver, target) || statefulExpressionContainsCall(value.index, target)
	case *statefulTupleExpr:
		for _, item := range value.values {
			if statefulExpressionContainsCall(item, target) {
				return true
			}
		}
	}
	return false
}

func mapStatefulSecurityValues(original, target []Candle, values []statefulValue, seconds int64) []statefulValue {
	out := make([]statefulValue, len(original))
	byBucket := make(map[int64]int, len(target))
	for index, candle := range target {
		byBucket[candle.Time] = index
	}
	placeholder := statefulNA()
	if len(values) > 0 && values[0].kind == statefulValueTuple {
		items := make([]statefulValue, len(values[0].tuple))
		for index := range items {
			items[index] = statefulNA()
		}
		placeholder = statefulValue{kind: statefulValueTuple, tuple: items}
	}
	for index, candle := range original {
		bucket := candle.Time - candle.Time%seconds
		targetIndex, ok := byBucket[bucket]
		if !ok {
			out[index] = cloneStatefulValue(placeholder)
			continue
		}
		isFinalSubbar := index == len(original)-1 || original[index+1].Time-original[index+1].Time%seconds != bucket
		visibleIndex := targetIndex
		if !isFinalSubbar {
			visibleIndex--
		}
		if visibleIndex < 0 || visibleIndex >= len(values) {
			out[index] = cloneStatefulValue(placeholder)
		} else {
			out[index] = cloneStatefulValue(values[visibleIndex])
		}
	}
	return out
}

func statefulCandleInterval(candles []Candle) int64 {
	if len(candles) < 2 {
		return 60
	}
	best := int64(math.MaxInt64)
	for index := 1; index < len(candles); index++ {
		step := candles[index].Time - candles[index-1].Time
		if step > 0 && step < best {
			best = step
		}
	}
	if best == int64(math.MaxInt64) {
		return 60
	}
	return best
}
