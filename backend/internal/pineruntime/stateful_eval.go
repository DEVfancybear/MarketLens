package pineruntime

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

const statefulMaxLoopIterations = 10000

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
	case "+=", "-=", "*=", "/=":
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
		if statefulTruthy(condition) {
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
	// Pine re-evaluates the `to` expression on each iteration.  This matters
	// when the loop body removes array elements.
	for current := from; ; {
		toValue, err := vm.evaluate(statement.to, scope)
		if err != nil {
			return statefulNA(), err
		}
		to := int(math.Round(statefulNumeric(toValue)))
		step := 1
		if from > to {
			step = -1
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
		if err != nil {
			return statefulNA(), err
		}
		current += step
	}
	return last, nil
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
			return statefulBool(!statefulTruthy(operand)), nil
		}
		number := statefulNumeric(operand)
		if !statefulUsable(number) {
			return statefulNA(), nil
		}
		return statefulNumber(-number), nil
	case *statefulBinaryExpr:
		left, err := vm.evaluate(value.left, scope)
		if err != nil {
			return statefulNA(), err
		}
		if value.operator == "and" && !statefulTruthy(left) {
			return statefulBool(false), nil
		}
		if value.operator == "or" && statefulTruthy(left) {
			return statefulBool(true), nil
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
		if statefulTruthy(condition) {
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
	case "syminfo", "xloc", "position", "size", "format", "line", "box", "label", "table", "array", "color", "math", "str", "ta", "request":
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
			return statefulString(""), nil
		}
		if identifier.name == "xloc" || identifier.name == "position" || identifier.name == "size" || identifier.name == "format" || identifier.name == "line" || identifier.name == "box" || identifier.name == "label" {
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
	switch name {
	case "input", "input.int", "input.float", "input.bool", "input.color", "input.string", "input.timeframe", "input.source", "input.symbol", "input.session", "input.text_area":
		return vm.evaluateInput(name, call, scope)
	case "array.new":
		return vm.constructArray(call, scope)
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
	case "ta.cum", "cum":
		value, err := vm.callArgument(call, scope, "", 0)
		if err != nil {
			return statefulNA(), err
		}
		point := statefulNumeric(value)
		if statefulUsable(point) {
			vm.cumulativeCalls[call] += point
		}
		return statefulNumber(vm.cumulativeCalls[call]), nil
	case "ta.pivothigh", "pivothigh":
		return vm.evaluatePivot(call, scope, "high")
	case "ta.pivotlow", "pivotlow":
		return vm.evaluatePivot(call, scope, "low")
	case "color.new":
		return vm.colorNew(call, scope)
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
	case "label.new":
		return vm.constructLabel(call, scope)
	case "table.new":
		return vm.constructTable(call, scope)
	case "plot":
		return vm.evaluatePlot(call, scope)
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
	case "input", "array", "math", "ta", "color", "str", "request", "box", "line", "label", "table":
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
		}
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
	persistent := vm.functionState[function]
	if persistent == nil {
		persistent = newStatefulScope(vm.global)
		vm.functionState[function] = persistent
	}
	local := newStatefulScope(persistent)
	local.varScope = persistent
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
	for index, field := range typeDef.fields {
		value := statefulNA()
		if index < len(call.arguments) {
			evaluated, err := vm.evaluate(call.arguments[index].expression, scope)
			if err != nil {
				return statefulNA(), err
			}
			value = evaluated
		} else if field.defaultExp != nil {
			evaluated, err := vm.evaluate(field.defaultExp, scope)
			if err != nil {
				return statefulNA(), err
			}
			value = evaluated
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
	object.background = vm.colorArgument(call, scope, "color", 5, "")
	object.color = vm.colorArgument(call, scope, "textcolor", 7, "#ffffff")
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
	value, err := vm.callArgument(call, scope, name, index)
	if err != nil {
		return fallback
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
	plot := vm.plotCalls[call]
	if plot == nil {
		vm.nextPlotID++
		plot = &statefulPlot{id: vm.nextPlotID, name: vm.assigningName, lastBar: -1, declared: true}
		vm.plotCalls[call] = plot
		if !vm.outputSuppressed {
			vm.plots = append(vm.plots, plot)
		}
	}
	value, err := vm.callArgument(call, scope, "series", 0)
	if err != nil {
		return statefulNA(), err
	}
	color := vm.colorArgument(call, scope, "color", 1, "")
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
	fill := vm.fillCalls[call]
	if fill == nil {
		vm.nextFillID++
		fill = &statefulFill{id: vm.nextFillID, first: first.plot, second: second.plot, lastBar: -1}
		vm.fillCalls[call] = fill
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
	if cached, ok := vm.securityCalls[call]; ok {
		if vm.bar >= 0 && vm.bar < len(cached.values) {
			return cloneStatefulValue(cached.values[vm.bar]), nil
		}
		return statefulNA(), nil
	}
	if len(call.arguments) < 3 {
		return statefulNA(), fmt.Errorf("request.security() expects symbol, timeframe, and expression")
	}
	timeframeValue, err := vm.evaluate(call.arguments[1].expression, scope)
	if err != nil {
		return statefulNA(), err
	}
	timeframe := statefulValueText(timeframeValue, "")
	chartSeconds := statefulCandleInterval(vm.candles)
	targetSeconds, valid := timeframeSeconds(timeframe)
	if !valid || targetSeconds <= chartSeconds {
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
	// request.security has an independent execution context.  Inputs and other
	// immutable scalar values are copied, while mutable arrays/objects and
	// function-local `var` state begin fresh in the child VM.
	for name, cell := range vm.global.cells {
		if !cell.initialized {
			continue
		}
		switch cell.value.kind {
		case statefulValueNumber, statefulValueBool, statefulValueString, statefulValueColor:
			copyCell := child.global.ensure(name)
			copyCell.value = cloneStatefulValue(cell.value)
			copyCell.initialized = true
		}
	}
	targetValues := make([]statefulValue, len(targetCandles))
	for index := range targetCandles {
		select {
		case <-vm.ctx.Done():
			return statefulNA(), vm.ctx.Err()
		default:
		}
		child.bar = index
		value, err := child.evaluate(call.arguments[2].expression, child.global)
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
	vm.securityCalls[call] = statefulSecurityResult{values: mapped}
	if vm.bar >= 0 && vm.bar < len(mapped) {
		return cloneStatefulValue(mapped[vm.bar]), nil
	}
	return statefulNA(), nil
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
