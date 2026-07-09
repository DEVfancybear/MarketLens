package pineruntime

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"unicode"
)

type tokenKind int

const (
	tokenNumber tokenKind = iota
	tokenIdentifier
	tokenString
	tokenOperator
	tokenParen
	tokenBracket
	tokenComma
	tokenEquals
	tokenComparison
	tokenQuestion
	tokenColon
	tokenEOF
)

type token struct {
	kind  tokenKind
	text  string
	value float64
}

func tokenize(input string) ([]token, error) {
	tokens := []token{}
	for i := 0; i < len(input); {
		ch := input[i]
		if unicode.IsSpace(rune(ch)) {
			i++
			continue
		}
		if (ch >= '0' && ch <= '9') || ch == '.' {
			start := i
			i++
			for i < len(input) && ((input[i] >= '0' && input[i] <= '9') || input[i] == '.') {
				i++
			}
			value, ok := parseNumberLiteral(input[start:i])
			if !ok {
				return nil, fmt.Errorf("invalid number %q", input[start:i])
			}
			tokens = append(tokens, token{kind: tokenNumber, value: value, text: input[start:i]})
			continue
		}
		if unicode.IsLetter(rune(ch)) || ch == '_' {
			start := i
			i++
			for i < len(input) && (unicode.IsLetter(rune(input[i])) || unicode.IsDigit(rune(input[i])) || input[i] == '_' || input[i] == '.') {
				i++
			}
			tokens = append(tokens, token{kind: tokenIdentifier, text: input[start:i]})
			continue
		}
		if ch == '"' || ch == '\'' {
			quote := ch
			start := i
			i++
			escaped := false
			for i < len(input) {
				if escaped {
					escaped = false
					i++
					continue
				}
				if input[i] == '\\' {
					escaped = true
					i++
					continue
				}
				if input[i] == quote {
					i++
					break
				}
				i++
			}
			value, ok := unquote(input[start:i])
			if !ok {
				return nil, fmt.Errorf("unterminated string")
			}
			tokens = append(tokens, token{kind: tokenString, text: value})
			continue
		}
		if strings.ContainsRune("+-*/", rune(ch)) {
			tokens = append(tokens, token{kind: tokenOperator, text: string(ch)})
			i++
			continue
		}
		if strings.ContainsRune("<>=!", rune(ch)) && i+1 < len(input) && input[i+1] == '=' {
			tokens = append(tokens, token{kind: tokenComparison, text: input[i : i+2]})
			i += 2
			continue
		}
		if ch == '>' || ch == '<' {
			tokens = append(tokens, token{kind: tokenComparison, text: string(ch)})
			i++
			continue
		}
		switch ch {
		case '(':
			tokens = append(tokens, token{kind: tokenParen, text: "("})
		case ')':
			tokens = append(tokens, token{kind: tokenParen, text: ")"})
		case '[':
			tokens = append(tokens, token{kind: tokenBracket, text: "["})
		case ']':
			tokens = append(tokens, token{kind: tokenBracket, text: "]"})
		case ',':
			tokens = append(tokens, token{kind: tokenComma, text: ","})
		case '=':
			tokens = append(tokens, token{kind: tokenEquals, text: "="})
		case '?':
			tokens = append(tokens, token{kind: tokenQuestion, text: "?"})
		case ':':
			tokens = append(tokens, token{kind: tokenColon, text: ":"})
		default:
			return nil, fmt.Errorf("unsupported token %q", ch)
		}
		i++
	}
	tokens = append(tokens, token{kind: tokenEOF})
	return tokens, nil
}

type expressionParser struct {
	tokens  []token
	index   int
	context *evalContext
}

func evaluateExpression(expression string, context *evalContext) (pineValue, error) {
	if value, handled, err := evaluateRequestSecurityExpression(expression, context); handled {
		return value, err
	}
	tokens, err := tokenize(expression)
	if err != nil {
		return pineValue{}, err
	}
	parser := &expressionParser{tokens: tokens, context: context}
	value, err := parser.parse()
	if err != nil {
		return pineValue{}, err
	}
	if parser.peek().kind != tokenEOF {
		return pineValue{}, fmt.Errorf("unexpected expression tail")
	}
	return value, nil
}

func (p *expressionParser) peek() token {
	return p.tokens[p.index]
}

func (p *expressionParser) next() token {
	tok := p.tokens[p.index]
	p.index++
	return tok
}

func (p *expressionParser) parse() (pineValue, error) {
	return p.parseTernary()
}

func (p *expressionParser) parseTernary() (pineValue, error) {
	condition, err := p.parseLogical()
	if err != nil || p.peek().kind != tokenQuestion {
		return condition, err
	}
	p.next()
	whenTrue, err := p.parseTernary()
	if err != nil {
		return pineValue{}, err
	}
	if p.next().kind != tokenColon {
		return pineValue{}, fmt.Errorf("expected ':' in conditional expression")
	}
	whenFalse, err := p.parseTernary()
	if err != nil {
		return pineValue{}, err
	}
	return chooseValue(condition, whenTrue, whenFalse, len(p.context.candles)), nil
}

func (p *expressionParser) parseLogical() (pineValue, error) {
	left, err := p.parseComparison()
	if err != nil {
		return pineValue{}, err
	}
	for p.peek().kind == tokenIdentifier && (strings.EqualFold(p.peek().text, "and") || strings.EqualFold(p.peek().text, "or")) {
		op := strings.ToLower(p.next().text)
		right, err := p.parseComparison()
		if err != nil {
			return pineValue{}, err
		}
		left = logicalValues(left, right, op, len(p.context.candles))
	}
	return left, nil
}

func (p *expressionParser) parseComparison() (pineValue, error) {
	left, err := p.parseAdditive()
	if err != nil {
		return pineValue{}, err
	}
	for p.peek().kind == tokenComparison {
		op := p.next().text
		right, err := p.parseAdditive()
		if err != nil {
			return pineValue{}, err
		}
		left = compareValues(left, right, op, len(p.context.candles))
	}
	return left, nil
}

func (p *expressionParser) parseAdditive() (pineValue, error) {
	left, err := p.parseMultiplicative()
	if err != nil {
		return pineValue{}, err
	}
	for p.peek().kind == tokenOperator && (p.peek().text == "+" || p.peek().text == "-") {
		op := p.next().text
		right, err := p.parseMultiplicative()
		if err != nil {
			return pineValue{}, err
		}
		left = combineValues(left, right, op, len(p.context.candles))
	}
	return left, nil
}

func (p *expressionParser) parseMultiplicative() (pineValue, error) {
	left, err := p.parseUnary()
	if err != nil {
		return pineValue{}, err
	}
	for p.peek().kind == tokenOperator && (p.peek().text == "*" || p.peek().text == "/") {
		op := p.next().text
		right, err := p.parseUnary()
		if err != nil {
			return pineValue{}, err
		}
		left = combineValues(left, right, op, len(p.context.candles))
	}
	return left, nil
}

func (p *expressionParser) parseUnary() (pineValue, error) {
	if p.peek().kind == tokenIdentifier && strings.EqualFold(p.peek().text, "not") {
		p.next()
		value, err := p.parseUnary()
		if err != nil {
			return pineValue{}, err
		}
		return logicalNotValue(value, len(p.context.candles)), nil
	}
	if p.peek().kind == tokenOperator && p.peek().text == "-" {
		p.next()
		value, err := p.parseUnary()
		if err != nil {
			return pineValue{}, err
		}
		return negateValue(value, len(p.context.candles)), nil
	}
	return p.parsePrimary()
}

func (p *expressionParser) parsePrimary() (pineValue, error) {
	tok := p.next()
	switch tok.kind {
	case tokenNumber:
		return numberValue(tok.value), nil
	case tokenString:
		return stringValue(tok.text), nil
	case tokenIdentifier:
		if p.peek().kind == tokenParen && p.peek().text == "(" {
			p.next()
			args := []callArg{}
			if !(p.peek().kind == tokenParen && p.peek().text == ")") {
				for {
					name := ""
					if p.peek().kind == tokenIdentifier && p.tokens[p.index+1].kind == tokenEquals {
						name = p.next().text
						p.next()
					}
					value, err := p.parseTernary()
					if err != nil {
						return pineValue{}, err
					}
					args = append(args, callArg{name: name, value: value})
					if p.peek().kind == tokenComma {
						p.next()
						continue
					}
					break
				}
			}
			if p.next().text != ")" {
				return pineValue{}, fmt.Errorf("unclosed call %s()", tok.text)
			}
			value, err := evaluateCall(tok.text, args, p.context)
			if err != nil {
				return pineValue{}, err
			}
			return p.parsePostfix(value)
		}
		value, err := resolveIdentifier(tok.text, p.context)
		if err != nil {
			return pineValue{}, err
		}
		return p.parsePostfix(value)
	case tokenParen:
		if tok.text == "(" {
			value, err := p.parseTernary()
			if err != nil {
				return pineValue{}, err
			}
			if p.next().text != ")" {
				return pineValue{}, fmt.Errorf("unclosed parenthesized expression")
			}
			return value, nil
		}
	}
	return pineValue{}, fmt.Errorf("expected expression")
}

func (p *expressionParser) parsePostfix(value pineValue) (pineValue, error) {
	current := value
	for p.peek().kind == tokenBracket && p.peek().text == "[" {
		p.next()
		offset := p.next()
		if offset.kind != tokenNumber {
			return pineValue{}, fmt.Errorf("history reference expects a numeric offset")
		}
		if p.next().text != "]" {
			return pineValue{}, fmt.Errorf("unclosed history reference")
		}
		current = shiftValue(current, int(math.Max(0, math.Round(offset.value))), len(p.context.candles))
	}
	return current, nil
}

func resolveIdentifier(name string, context *evalContext) (pineValue, error) {
	if stored, ok := context.variables[name]; ok {
		return stored, nil
	}
	if color, ok := namedColors[name]; ok {
		return colorValue(color), nil
	}
	if strings.HasPrefix(name, "input.") ||
		strings.HasPrefix(name, "plot.style_") ||
		strings.HasPrefix(name, "format.") ||
		strings.HasPrefix(name, "line.style_") ||
		strings.HasPrefix(name, "label.style_") ||
		strings.HasPrefix(name, "position.") ||
		strings.HasPrefix(name, "size.") ||
		strings.HasPrefix(name, "text.align_") ||
		strings.HasPrefix(name, "barmerge.") ||
		strings.HasPrefix(name, "xloc.") ||
		strings.HasPrefix(name, "yloc.") ||
		strings.HasPrefix(name, "extend.") {
		return stringValue(name), nil
	}
	switch name {
	case "integer", "float", "bool", "source", "string", "line", "linebr", "columns", "histogram", "solid", "dashed", "dotted":
		return stringValue(name), nil
	case "open", "high", "low", "close", "volume", "time":
		return sourceSeries(context.candles, name), nil
	case "bar_index":
		values := make([]float64, len(context.candles))
		for i := range values {
			values[i] = float64(i)
		}
		return seriesValue(values), nil
	case "last_bar_index":
		return numberValue(math.Max(0, float64(len(context.candles)-1))), nil
	case "last_bar_time":
		if len(context.candles) == 0 {
			return naNumber(), nil
		}
		return numberValue(float64(context.candles[len(context.candles)-1].Time)), nil
	case "barstate.islast":
		values := make([]float64, len(context.candles))
		if len(values) > 0 {
			values[len(values)-1] = 1
		}
		return seriesValue(values), nil
	case "barstate.isfirst":
		values := make([]float64, len(context.candles))
		if len(values) > 0 {
			values[0] = 1
		}
		return seriesValue(values), nil
	case "barstate.isconfirmed", "barstate.ishistory":
		values := make([]float64, len(context.candles))
		for i := range values {
			values[i] = 1
		}
		return seriesValue(values), nil
	case "barstate.isrealtime":
		return boolValue(false), nil
	case "timeframe.period":
		return stringValue(inferTimeframePeriod(context.candles)), nil
	case "syminfo.mintick":
		return numberValue(inferMintick(context.candles)), nil
	case "syminfo.timezone":
		return stringValue("UTC"), nil
	case "syminfo.type":
		return stringValue("forex"), nil
	case "syminfo.tickerid":
		return stringValue(""), nil
	case "hl2":
		return pairAverage(context.candles, "high", "low"), nil
	case "hlc3":
		return pairAverage(context.candles, "high", "low", "close"), nil
	case "ohlc4":
		return pairAverage(context.candles, "open", "high", "low", "close"), nil
	case "true":
		return boolValue(true), nil
	case "false":
		return boolValue(false), nil
	case "na":
		return naNumber(), nil
	default:
		return pineValue{}, fmt.Errorf("unknown identifier %q", name)
	}
}

func evaluateCall(name string, args []callArg, context *evalContext) (pineValue, error) {
	if fn, ok := context.functions[name]; ok {
		fnContext := &evalContext{
			candles:        context.candles,
			variables:      map[string]pineValue{},
			functions:      context.functions,
			inputOverrides: context.inputOverrides,
		}
		for key, value := range context.variables {
			fnContext.variables[key] = value
		}
		for i, param := range fn.params {
			if i < len(args) {
				fnContext.variables[param] = args[i].value
			} else {
				fnContext.variables[param] = naNumber()
			}
		}
		return evaluateExpression(fn.expression, fnContext)
	}

	arg := func(index int) (pineValue, bool) {
		if index >= 0 && index < len(args) {
			return args[index].value, true
		}
		return pineValue{}, false
	}
	named := func(key string) (pineValue, bool) {
		for _, item := range args {
			if item.name == key {
				return item.value, true
			}
		}
		return pineValue{}, false
	}
	byNameOrIndex := func(key string, index int) pineValue {
		if value, ok := named(key); ok {
			return value
		}
		if value, ok := arg(index); ok {
			return value
		}
		return naNumber()
	}

	switch name {
	case "time":
		tf := ""
		if len(args) > 0 && args[0].value.kind == kindString {
			tf = args[0].value.text
		}
		if tf == "" {
			return sourceSeries(context.candles, "time"), nil
		}
		return seriesValue(timeframeOpenTimeSeries(context.candles, tf)), nil
	case "input", "input.int", "input.float", "input.source", "input.bool", "input.color", "input.string", "input.text_area", "input.timeframe", "input.symbol", "input.session":
		if value, ok := named("defval"); ok {
			return value, nil
		}
		if value, ok := arg(0); ok {
			return value, nil
		}
		return numberValue(0), nil
	case "color", "color.new":
		base, ok := arg(0)
		if !ok || (base.kind != kindColor && base.kind != kindColorSeries) {
			return colorValue(defaultColors[0]), nil
		}
		transp := byNameOrIndex("transp", 1)
		t := getAt(transp, 0, len(context.candles))
		if base.kind == kindColorSeries {
			values := make([]string, len(base.colors))
			for i, color := range base.colors {
				if color != "" && usable(t) {
					values[i] = withTransparency(color, t)
				} else {
					values[i] = color
				}
			}
			return colorSeriesValue(values), nil
		}
		if usable(t) {
			return colorValue(withTransparency(base.color, t)), nil
		}
		return base, nil
	case "na":
		if len(args) == 0 {
			return boolValue(true), nil
		}
		return naValue(args[0].value, len(context.candles)), nil
	case "nz":
		var fallback pineValue
		if len(args) > 1 {
			fallback = args[1].value
		} else {
			fallback = numberValue(0)
		}
		if len(args) == 0 {
			return fallback, nil
		}
		return nzValue(args[0].value, fallback, len(context.candles)), nil
	case "str.tostring":
		if len(args) == 0 {
			return stringValue(""), nil
		}
		format := pineValue{}
		if len(args) > 1 {
			format = args[1].value
		}
		return stringValue(formatPineTextValue(args[0].value, format, len(context.candles)-1, context)), nil
	case "str.format_time":
		if len(args) == 0 {
			return stringValue(""), nil
		}
		return stringValue(formatPineDate(getAt(args[0].value, len(context.candles)-1, len(context.candles)))), nil
	case "math.abs", "abs":
		return mapNumeric(byNameOrIndex("", 0), len(context.candles), math.Abs), nil
	case "math.max", "max":
		values := make([]pineValue, len(args))
		for i, item := range args {
			values[i] = item.value
		}
		return reduceNumeric(values, len(context.candles), math.Max), nil
	case "math.min", "min":
		values := make([]pineValue, len(args))
		for i, item := range args {
			values[i] = item.value
		}
		return reduceNumeric(values, len(context.candles), math.Min), nil
	case "ta.sma", "sma":
		return seriesValue(rollingAverage(toSeries(byNameOrIndex("source", 0), len(context.candles)), period(byNameOrIndex("length", 1)))), nil
	case "ta.ema", "ema":
		return seriesValue(exponentialAverage(toSeries(byNameOrIndex("source", 0), len(context.candles)), period(byNameOrIndex("length", 1)))), nil
	case "ta.rma", "rma":
		return seriesValue(runningMovingAverage(toSeries(byNameOrIndex("source", 0), len(context.candles)), period(byNameOrIndex("length", 1)))), nil
	case "ta.rsi", "rsi":
		return seriesValue(rsiSeries(toSeries(byNameOrIndex("source", 0), len(context.candles)), period(byNameOrIndex("length", 1)))), nil
	case "ta.change", "change":
		length := 1
		if len(args) > 1 {
			length = period(byNameOrIndex("length", 1))
		}
		return seriesValue(changeSeries(toSeries(byNameOrIndex("source", 0), len(context.candles)), length)), nil
	case "ta.crossover", "crossover":
		return seriesValue(crossSeries(toSeries(byNameOrIndex("source1", 0), len(context.candles)), toSeries(byNameOrIndex("source2", 1), len(context.candles)), "over")), nil
	case "ta.crossunder", "crossunder":
		return seriesValue(crossSeries(toSeries(byNameOrIndex("source1", 0), len(context.candles)), toSeries(byNameOrIndex("source2", 1), len(context.candles)), "under")), nil
	}
	return pineValue{}, fmt.Errorf("unsupported function %q", name+"()")
}

func naValue(value pineValue, length int) pineValue {
	if value.kind == kindNumber {
		return boolValue(!usable(value.number))
	}
	if value.kind == kindSeries {
		out := make([]float64, length)
		for i := range out {
			if !usable(getAt(value, i, length)) {
				out[i] = 1
			}
		}
		return seriesValue(out)
	}
	return boolValue(false)
}

func nzValue(value pineValue, replacement pineValue, length int) pineValue {
	fallback := getAt(replacement, 0, length)
	if !usable(fallback) {
		fallback = 0
	}
	if value.kind == kindNumber {
		if usable(value.number) {
			return value
		}
		return numberValue(fallback)
	}
	out := make([]float64, length)
	for i := range out {
		point := getAt(value, i, length)
		localFallback := getAt(replacement, i, length)
		if !usable(localFallback) {
			localFallback = fallback
		}
		if usable(point) {
			out[i] = point
		} else {
			out[i] = localFallback
		}
	}
	return seriesValue(out)
}

func period(value pineValue) int {
	point := getAt(value, 0, 1)
	if !usable(point) {
		return 1
	}
	return int(math.Max(1, math.Round(point)))
}

func rollingAverage(values []float64, length int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
		if i < length-1 {
			continue
		}
		sum := float64(0)
		ok := true
		for j := i - length + 1; j <= i; j++ {
			if !usable(values[j]) {
				ok = false
				break
			}
			sum += values[j]
		}
		if ok {
			out[i] = sum / float64(length)
		}
	}
	return out
}

func exponentialAverage(values []float64, length int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	k := 2 / float64(length+1)
	prev := math.NaN()
	seen := 0
	for i, value := range values {
		if !usable(value) {
			continue
		}
		seen++
		if usable(prev) {
			prev = value*k + prev*(1-k)
		} else {
			prev = value
		}
		if seen >= length {
			out[i] = prev
		}
	}
	return out
}

func runningMovingAverage(values []float64, length int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	prev := math.NaN()
	seen := 0
	for i, value := range values {
		if !usable(value) {
			continue
		}
		seen++
		if usable(prev) {
			prev = (prev*float64(length-1) + value) / float64(length)
		} else {
			prev = value
		}
		if seen >= length {
			out[i] = prev
		}
	}
	return out
}

func rsiSeries(values []float64, length int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		out[i] = math.NaN()
	}
	if len(values) < length+1 {
		return out
	}
	gain, loss := float64(0), float64(0)
	for i := 1; i <= length; i++ {
		change := values[i] - values[i-1]
		if change >= 0 {
			gain += change
		} else {
			loss -= change
		}
	}
	gain /= float64(length)
	loss /= float64(length)
	push := func(i int) {
		if loss == 0 {
			out[i] = 100
			return
		}
		rs := gain / loss
		out[i] = 100 - 100/(1+rs)
	}
	push(length)
	for i := length + 1; i < len(values); i++ {
		change := values[i] - values[i-1]
		g, l := float64(0), float64(0)
		if change > 0 {
			g = change
		} else {
			l = -change
		}
		gain = (gain*float64(length-1) + g) / float64(length)
		loss = (loss*float64(length-1) + l) / float64(length)
		push(i)
	}
	return out
}

func changeSeries(values []float64, length int) []float64 {
	out := make([]float64, len(values))
	for i := range out {
		if i-length >= 0 && usable(values[i]) && usable(values[i-length]) {
			out[i] = values[i] - values[i-length]
		} else {
			out[i] = math.NaN()
		}
	}
	return out
}

func crossSeries(left, right []float64, direction string) []float64 {
	out := make([]float64, len(left))
	for i := 1; i < len(left) && i < len(right); i++ {
		if !usable(left[i]) || !usable(right[i]) || !usable(left[i-1]) || !usable(right[i-1]) {
			continue
		}
		if direction == "over" && left[i-1] <= right[i-1] && left[i] > right[i] {
			out[i] = 1
		}
		if direction == "under" && left[i-1] >= right[i-1] && left[i] < right[i] {
			out[i] = 1
		}
	}
	return out
}

func mapNumeric(value pineValue, length int, fn func(float64) float64) pineValue {
	if value.kind == kindNumber {
		return numberValue(fn(value.number))
	}
	out := make([]float64, length)
	for i := range out {
		point := getAt(value, i, length)
		if usable(point) {
			out[i] = fn(point)
		} else {
			out[i] = math.NaN()
		}
	}
	return seriesValue(out)
}

func reduceNumeric(values []pineValue, length int, fn func(float64, float64) float64) pineValue {
	if len(values) == 0 {
		return naNumber()
	}
	allScalar := true
	for _, value := range values {
		allScalar = allScalar && value.kind == kindNumber
	}
	if allScalar {
		out := values[0].number
		for _, value := range values[1:] {
			out = fn(out, value.number)
		}
		return numberValue(out)
	}
	out := make([]float64, length)
	for i := range out {
		point := getAt(values[0], i, length)
		if !usable(point) {
			out[i] = math.NaN()
			continue
		}
		for _, value := range values[1:] {
			next := getAt(value, i, length)
			if !usable(next) {
				point = math.NaN()
				break
			}
			point = fn(point, next)
		}
		out[i] = point
	}
	return seriesValue(out)
}

func formatPineTextValue(value pineValue, format pineValue, index int, context *evalContext) string {
	if value.kind == kindString {
		return value.text
	}
	point := getAt(value, index, len(context.candles))
	if !usable(point) {
		return "-"
	}
	formatName := ""
	if format.kind == kindString {
		formatName = format.text
	}
	switch formatName {
	case "format.mintick":
		return fmt.Sprintf("%.*f", inferPricePrecision(context.candles), point)
	case "#":
		return fmt.Sprintf("%.0f", point)
	case "#.#":
		return fmt.Sprintf("%.1f", point)
	default:
		if math.Trunc(point) == point {
			return fmt.Sprintf("%.0f", point)
		}
		return fmt.Sprintf("%.2f", point)
	}
}

func inferPricePrecision(candles []Candle) int {
	precision := 0
	start := len(candles) - 100
	if start < 0 {
		start = 0
	}
	for _, candle := range candles[start:] {
		for _, value := range []float64{candle.Open, candle.High, candle.Low, candle.Close} {
			text := fmt.Sprintf("%f", value)
			text = strings.TrimRight(strings.TrimRight(text, "0"), ".")
			if dot := strings.Index(text, "."); dot >= 0 {
				precision = int(math.Max(float64(precision), float64(len(text)-dot-1)))
			}
		}
	}
	if precision > 5 {
		return 5
	}
	return precision
}

func inferMintick(candles []Candle) float64 {
	return 1 / math.Pow10(inferPricePrecision(candles))
}

func functionParameterNames(raw string) []string {
	params := []string{}
	for _, param := range splitTopLevel(raw) {
		cleaned := regexp.MustCompile(`^(?:float|int|bool|color|string|series|simple)\s+`).ReplaceAllString(strings.TrimSpace(param), "")
		if regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`).MatchString(cleaned) {
			params = append(params, cleaned)
		}
	}
	return params
}
