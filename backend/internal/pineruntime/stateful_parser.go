package pineruntime

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

// The stateful parser intentionally lives beside the vector evaluator.  Pine
// scripts which only calculate series continue through the vector path; this
// parser supplies an AST for the smaller class of scripts whose meaning
// depends on ordered, per-bar mutation (arrays, UDTs and drawing handles).

type statefulProgram struct {
	types         map[string]*statefulType
	functions     map[string]*statefulFunction
	methods       map[string]*statefulFunction
	statements    []statefulStmt
	usesState     bool
	maxBoxes      int
	maxLines      int
	maxLabels     int
	parseWarnings []RuntimeError
}

type statefulType struct {
	name   string
	fields []statefulField
}

type statefulField struct {
	name       string
	defaultExp statefulExpr
	line       int
}

type statefulFunction struct {
	name       string
	parameters []string
	body       []statefulStmt
	inline     statefulExpr
	receiver   string
	line       int
}

type statefulStmt interface {
	statefulStatement()
	lineNumber() int
}

type statefulAssignStmt struct {
	line       int
	targets    []string
	op         string
	expression statefulExpr
	persistent bool
}

func (*statefulAssignStmt) statefulStatement() {}
func (s *statefulAssignStmt) lineNumber() int  { return s.line }

type statefulExprStmt struct {
	line       int
	expression statefulExpr
}

func (*statefulExprStmt) statefulStatement() {}
func (s *statefulExprStmt) lineNumber() int  { return s.line }

type statefulIfBranch struct {
	condition statefulExpr
	body      []statefulStmt
}

type statefulIfStmt struct {
	line     int
	branches []statefulIfBranch
	other    []statefulStmt
}

func (*statefulIfStmt) statefulStatement() {}
func (s *statefulIfStmt) lineNumber() int  { return s.line }

type statefulForStmt struct {
	line     int
	variable string
	from     statefulExpr
	to       statefulExpr
	in       statefulExpr
	body     []statefulStmt
}

func (*statefulForStmt) statefulStatement() {}
func (s *statefulForStmt) lineNumber() int  { return s.line }

type statefulNoopStmt struct{ line int }

func (*statefulNoopStmt) statefulStatement() {}
func (s *statefulNoopStmt) lineNumber() int  { return s.line }

type statefulLogicalLine struct {
	line   int
	indent int
	text   string
}

func parseStatefulProgram(source string) (*statefulProgram, error) {
	program := &statefulProgram{
		types:     map[string]*statefulType{},
		functions: map[string]*statefulFunction{},
		methods:   map[string]*statefulFunction{},
		maxBoxes:  500,
		maxLines:  500,
		maxLabels: 500,
	}
	lines, err := statefulLogicalSourceLines(source)
	if err != nil {
		return nil, err
	}
	parser := &statefulSourceParser{program: program, lines: lines}
	statements, err := parser.parseBlock(0, -1)
	if err != nil {
		return nil, err
	}
	program.statements = statements
	return program, nil
}

type statefulSourceParser struct {
	program *statefulProgram
	lines   []statefulLogicalLine
}

func (p *statefulSourceParser) parseBlock(start int, parentIndent int) ([]statefulStmt, error) {
	statements := []statefulStmt{}
	for index := start; index < len(p.lines); {
		line := p.lines[index]
		if line.indent <= parentIndent {
			break
		}
		text := strings.TrimSpace(line.text)
		if text == "" {
			index++
			continue
		}
		if strings.HasPrefix(text, "type ") {
			next, err := p.parseType(index)
			if err != nil {
				return nil, err
			}
			index = next
			continue
		}
		if fn, ok, err := p.parseFunction(index); ok || err != nil {
			if err != nil {
				return nil, err
			}
			if fn.receiver != "" {
				p.program.methods[fn.name] = fn
			} else {
				p.program.functions[fn.name] = fn
			}
			index = p.functionEnd(index)
			continue
		}
		if strings.HasPrefix(text, "indicator(") || strings.HasPrefix(text, "study(") || strings.HasPrefix(text, "strategy(") {
			p.readObjectLimits(text)
			index++
			continue
		}
		if strings.HasPrefix(text, "if ") || text == "if" || strings.HasPrefix(text, "if(") {
			stmt, next, err := p.parseIf(index)
			if err != nil {
				return nil, err
			}
			statements = append(statements, stmt)
			index = next
			continue
		}
		if strings.HasPrefix(text, "for ") {
			stmt, next, err := p.parseFor(index)
			if err != nil {
				return nil, err
			}
			statements = append(statements, stmt)
			index = next
			continue
		}
		if strings.HasPrefix(text, "else") {
			break
		}
		parsed, err := p.parseSimple(line)
		if err != nil {
			return nil, err
		}
		statements = append(statements, parsed...)
		index++
	}
	return statements, nil
}

func (p *statefulSourceParser) parseType(index int) (int, error) {
	line := p.lines[index]
	name := strings.TrimSpace(strings.TrimPrefix(line.text, "type "))
	if !statefulIdentifierPattern.MatchString(name) {
		return index + 1, fmt.Errorf("line %d: invalid type declaration", line.line)
	}
	typeDef := &statefulType{name: name}
	index++
	for index < len(p.lines) && p.lines[index].indent > line.indent {
		fieldLine := p.lines[index]
		parts := strings.Fields(fieldLine.text)
		if len(parts) < 2 {
			return index, fmt.Errorf("line %d: invalid field declaration", fieldLine.line)
		}
		fieldText := strings.TrimSpace(strings.TrimPrefix(fieldLine.text, parts[0]))
		name, defaultText := fieldText, ""
		if equals := statefulTopLevelAssignment(fieldText); equals >= 0 {
			name = strings.TrimSpace(fieldText[:equals])
			defaultText = strings.TrimSpace(fieldText[equals+1:])
		}
		field := statefulField{name: name, line: fieldLine.line}
		if defaultText != "" {
			expression, err := parseStatefulExpression(defaultText)
			if err != nil {
				return index, fmt.Errorf("line %d: %w", fieldLine.line, err)
			}
			field.defaultExp = expression
		}
		typeDef.fields = append(typeDef.fields, field)
		index++
	}
	p.program.types[name] = typeDef
	p.program.usesState = true
	return index, nil
}

var statefulFunctionPattern = regexp.MustCompile(`^(method\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*=>\s*(.*)$`)
var statefulIdentifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func (p *statefulSourceParser) parseFunction(index int) (*statefulFunction, bool, error) {
	line := p.lines[index]
	match := statefulFunctionPattern.FindStringSubmatch(line.text)
	if len(match) == 0 {
		return nil, false, nil
	}
	fn := &statefulFunction{name: match[2], line: line.line}
	parameterParts := splitTopLevel(match[3])
	for parameterIndex, raw := range parameterParts {
		words := strings.Fields(strings.TrimSpace(raw))
		if len(words) == 0 {
			continue
		}
		name := strings.TrimSpace(words[len(words)-1])
		if equals := strings.Index(name, "="); equals >= 0 {
			name = name[:equals]
		}
		fn.parameters = append(fn.parameters, name)
		if match[1] != "" && parameterIndex == 0 {
			fn.receiver = name
		}
	}
	if inline := strings.TrimSpace(match[4]); inline != "" {
		expression, err := parseStatefulExpression(inline)
		if err != nil {
			return nil, true, fmt.Errorf("line %d: %w", line.line, err)
		}
		fn.inline = expression
		return fn, true, nil
	}
	body, err := p.parseBlock(index+1, line.indent)
	if err != nil {
		return nil, true, err
	}
	if len(body) == 0 {
		return nil, true, fmt.Errorf("line %d: function body is empty", line.line)
	}
	fn.body = body
	return fn, true, nil
}

func (p *statefulSourceParser) functionEnd(index int) int {
	line := p.lines[index]
	index++
	for index < len(p.lines) && p.lines[index].indent > line.indent {
		index++
	}
	return index
}

func (p *statefulSourceParser) parseIf(index int) (*statefulIfStmt, int, error) {
	first := p.lines[index]
	stmt := &statefulIfStmt{line: first.line}
	for {
		line := p.lines[index]
		text := strings.TrimSpace(line.text)
		conditionText := ""
		switch {
		case strings.HasPrefix(text, "else if "):
			conditionText = strings.TrimSpace(strings.TrimPrefix(text, "else if"))
		case strings.HasPrefix(text, "if"):
			conditionText = strings.TrimSpace(strings.TrimPrefix(text, "if"))
		default:
			return nil, index, fmt.Errorf("line %d: invalid if branch", line.line)
		}
		condition, err := parseStatefulExpression(conditionText)
		if err != nil {
			return nil, index, fmt.Errorf("line %d: %w", line.line, err)
		}
		body, err := p.parseBlock(index+1, line.indent)
		if err != nil {
			return nil, index, err
		}
		stmt.branches = append(stmt.branches, statefulIfBranch{condition: condition, body: body})
		index = statefulBlockEnd(p.lines, index+1, line.indent)
		if index >= len(p.lines) || p.lines[index].indent != first.indent {
			break
		}
		next := strings.TrimSpace(p.lines[index].text)
		if strings.HasPrefix(next, "else if ") {
			continue
		}
		if next == "else" {
			other, err := p.parseBlock(index+1, p.lines[index].indent)
			if err != nil {
				return nil, index, err
			}
			stmt.other = other
			index = statefulBlockEnd(p.lines, index+1, p.lines[index].indent)
		}
		break
	}
	return stmt, index, nil
}

func (p *statefulSourceParser) parseFor(index int) (*statefulForStmt, int, error) {
	line := p.lines[index]
	header := strings.TrimSpace(strings.TrimPrefix(line.text, "for"))
	stmt := &statefulForStmt{line: line.line}
	if inAt := strings.Index(header, " in "); inAt >= 0 {
		stmt.variable = strings.TrimSpace(header[:inAt])
		expression, err := parseStatefulExpression(strings.TrimSpace(header[inAt+4:]))
		if err != nil {
			return nil, index, fmt.Errorf("line %d: %w", line.line, err)
		}
		stmt.in = expression
		p.program.usesState = true
	} else {
		equals := statefulTopLevelAssignment(header)
		if equals < 0 {
			return nil, index, fmt.Errorf("line %d: invalid for loop", line.line)
		}
		stmt.variable = strings.TrimSpace(header[:equals])
		rangeText := strings.TrimSpace(header[equals+1:])
		toAt := statefulTopLevelWord(rangeText, "to")
		if toAt < 0 {
			return nil, index, fmt.Errorf("line %d: for range missing to", line.line)
		}
		var err error
		stmt.from, err = parseStatefulExpression(strings.TrimSpace(rangeText[:toAt]))
		if err != nil {
			return nil, index, fmt.Errorf("line %d: %w", line.line, err)
		}
		stmt.to, err = parseStatefulExpression(strings.TrimSpace(rangeText[toAt+2:]))
		if err != nil {
			return nil, index, fmt.Errorf("line %d: %w", line.line, err)
		}
	}
	body, err := p.parseBlock(index+1, line.indent)
	if err != nil {
		return nil, index, err
	}
	stmt.body = body
	return stmt, statefulBlockEnd(p.lines, index+1, line.indent), nil
}

func (p *statefulSourceParser) parseSimple(line statefulLogicalLine) ([]statefulStmt, error) {
	text := strings.TrimSpace(line.text)
	if strings.HasPrefix(text, "alertcondition(") {
		return []statefulStmt{&statefulNoopStmt{line: line.line}}, nil
	}
	parts := []string{text}
	if strings.HasPrefix(text, "var ") && len(splitTopLevel(text)) > 1 {
		parts = splitTopLevel(text)
	}
	out := []statefulStmt{}
	for _, part := range parts {
		if assignment, ok, err := parseStatefulAssignment(part, line.line); ok || err != nil {
			if err != nil {
				return nil, err
			}
			out = append(out, assignment)
			if len(assignment.targets) > 1 || statefulExpressionContainsState(assignment.expression) {
				p.program.usesState = true
			}
			continue
		}
		expression, err := parseStatefulExpression(part)
		if err != nil {
			return nil, fmt.Errorf("line %d: %w", line.line, err)
		}
		out = append(out, &statefulExprStmt{line: line.line, expression: expression})
		if statefulExpressionContainsState(expression) {
			p.program.usesState = true
		}
	}
	return out, nil
}

func parseStatefulAssignment(text string, line int) (*statefulAssignStmt, bool, error) {
	trimmed := strings.TrimSpace(text)
	operatorAt, operator := statefulAssignmentOperator(trimmed)
	if operatorAt < 0 {
		return nil, false, nil
	}
	left := strings.TrimSpace(trimmed[:operatorAt])
	right := strings.TrimSpace(trimmed[operatorAt+len(operator):])
	if right == "" {
		return nil, true, fmt.Errorf("line %d: assignment has no expression", line)
	}
	stmt := &statefulAssignStmt{line: line, op: operator}
	if strings.HasPrefix(left, "[") && strings.HasSuffix(left, "]") {
		for _, name := range splitTopLevel(strings.TrimSpace(left[1 : len(left)-1])) {
			name = strings.TrimSpace(name)
			if !statefulIdentifierPattern.MatchString(name) {
				return nil, true, fmt.Errorf("line %d: invalid tuple target %q", line, name)
			}
			stmt.targets = append(stmt.targets, name)
		}
	} else {
		words := strings.Fields(left)
		if len(words) == 0 {
			return nil, true, fmt.Errorf("line %d: assignment has no target", line)
		}
		stmt.persistent = words[0] == "var" || words[0] == "varip"
		name := words[len(words)-1]
		if !statefulIdentifierPattern.MatchString(name) {
			return nil, true, fmt.Errorf("line %d: invalid assignment target %q", line, name)
		}
		stmt.targets = []string{name}
	}
	expression, err := parseStatefulExpression(right)
	if err != nil {
		return nil, true, fmt.Errorf("line %d: %w", line, err)
	}
	stmt.expression = expression
	return stmt, true, nil
}

func (p *statefulSourceParser) readObjectLimits(text string) {
	bodies := findCallBodies(text, "indicator")
	if len(bodies) == 0 {
		bodies = findCallBodies(text, "study")
	}
	if len(bodies) == 0 {
		return
	}
	args := parseCallArguments(bodies[0])
	read := func(key string, fallback int) int {
		if raw := args.named[key]; raw != "" {
			if value, ok := parseNumberLiteral(raw); ok && value > 0 {
				return int(value)
			}
		}
		return fallback
	}
	p.program.maxBoxes = read("max_boxes_count", p.program.maxBoxes)
	p.program.maxLines = read("max_lines_count", p.program.maxLines)
	p.program.maxLabels = read("max_labels_count", p.program.maxLabels)
}

func statefulBlockEnd(lines []statefulLogicalLine, index, parentIndent int) int {
	for index < len(lines) && lines[index].indent > parentIndent {
		index++
	}
	return index
}

func statefulLogicalSourceLines(source string) ([]statefulLogicalLine, error) {
	physical := sourceLines(normalizeSource(source))
	out := []statefulLogicalLine{}
	for index := 0; index < len(physical); index++ {
		line := physical[index]
		if strings.TrimSpace(line.text) == "" {
			continue
		}
		text := strings.TrimSpace(line.text)
		balance := statefulDelimiterBalance(text)
		for balance > 0 && index+1 < len(physical) {
			index++
			next := strings.TrimSpace(physical[index].text)
			if next == "" {
				continue
			}
			text += " " + next
			balance += statefulDelimiterBalance(next)
		}
		if balance != 0 {
			return nil, fmt.Errorf("line %d: unbalanced expression", line.number)
		}
		for index+1 < len(physical) {
			next := physical[index+1]
			nextText := strings.TrimSpace(next.text)
			if !strings.HasPrefix(nextText, ":") {
				break
			}
			index++
			text += " " + nextText
		}
		out = append(out, statefulLogicalLine{line: line.number, indent: line.indent, text: text})
	}
	return out, nil
}

func statefulDelimiterBalance(text string) int {
	balance := 0
	var quote rune
	escaped := false
	for _, char := range text {
		if escaped {
			escaped = false
			continue
		}
		if char == '\\' {
			escaped = true
			continue
		}
		if char == '\'' || char == '"' {
			if quote == char {
				quote = 0
			} else if quote == 0 {
				quote = char
			}
			continue
		}
		if quote != 0 {
			continue
		}
		switch char {
		case '(', '[':
			balance++
		case ')', ']':
			balance--
		}
	}
	return balance
}

func statefulTopLevelAssignment(text string) int {
	index, operator := statefulAssignmentOperator(text)
	if operator == "=" {
		return index
	}
	return -1
}

func statefulAssignmentOperator(text string) (int, string) {
	depth := 0
	var quote byte
	for index := 0; index < len(text); index++ {
		char := text[index]
		if quote != 0 {
			if char == quote && (index == 0 || text[index-1] != '\\') {
				quote = 0
			}
			continue
		}
		if char == '\'' || char == '"' {
			quote = char
			continue
		}
		switch char {
		case '(', '[':
			depth++
		case ')', ']':
			depth--
		}
		if depth != 0 {
			continue
		}
		if index+1 < len(text) {
			candidate := text[index : index+2]
			if candidate == ":=" || candidate == "+=" || candidate == "-=" || candidate == "*=" || candidate == "/=" {
				return index, candidate
			}
		}
		if char == '=' {
			previous, next := byte(0), byte(0)
			if index > 0 {
				previous = text[index-1]
			}
			if index+1 < len(text) {
				next = text[index+1]
			}
			if previous != '=' && previous != '!' && previous != '<' && previous != '>' && next != '=' {
				return index, "="
			}
		}
	}
	return -1, ""
}

func statefulTopLevelWord(text, word string) int {
	depth := 0
	var quote byte
	for index := 0; index+len(word) <= len(text); index++ {
		char := text[index]
		if quote != 0 {
			if char == quote && (index == 0 || text[index-1] != '\\') {
				quote = 0
			}
			continue
		}
		if char == '\'' || char == '"' {
			quote = char
			continue
		}
		if char == '(' || char == '[' {
			depth++
			continue
		}
		if char == ')' || char == ']' {
			depth--
			continue
		}
		if depth == 0 && strings.HasPrefix(text[index:], word) {
			beforeOK := index == 0 || unicode.IsSpace(rune(text[index-1]))
			after := index + len(word)
			afterOK := after == len(text) || unicode.IsSpace(rune(text[after]))
			if beforeOK && afterOK {
				return index
			}
		}
	}
	return -1
}

// Expression AST and Pratt-style recursive descent parser.

type statefulExpr interface{ statefulExpression() }

type statefulLiteralExpr struct{ value statefulValue }

func (*statefulLiteralExpr) statefulExpression() {}

type statefulIdentifierExpr struct{ name string }

func (*statefulIdentifierExpr) statefulExpression() {}

type statefulUnaryExpr struct {
	operator string
	value    statefulExpr
}

func (*statefulUnaryExpr) statefulExpression() {}

type statefulBinaryExpr struct {
	operator    string
	left, right statefulExpr
}

func (*statefulBinaryExpr) statefulExpression() {}

type statefulTernaryExpr struct{ condition, whenTrue, whenFalse statefulExpr }

func (*statefulTernaryExpr) statefulExpression() {}

type statefulFieldExpr struct {
	receiver statefulExpr
	name     string
}

func (*statefulFieldExpr) statefulExpression() {}

type statefulIndexExpr struct{ receiver, index statefulExpr }

func (*statefulIndexExpr) statefulExpression() {}

type statefulTupleExpr struct{ values []statefulExpr }

func (*statefulTupleExpr) statefulExpression() {}

type statefulCallArgument struct {
	name       string
	expression statefulExpr
}
type statefulCallExpr struct {
	callee    statefulExpr
	generic   string
	arguments []statefulCallArgument
}

func (*statefulCallExpr) statefulExpression() {}

type statefulTokenKind int

const (
	statefulTokenEOF statefulTokenKind = iota
	statefulTokenNumber
	statefulTokenString
	statefulTokenColor
	statefulTokenIdentifier
	statefulTokenOperator
	statefulTokenLeftParen
	statefulTokenRightParen
	statefulTokenLeftBracket
	statefulTokenRightBracket
	statefulTokenComma
	statefulTokenDot
	statefulTokenQuestion
	statefulTokenColon
	statefulTokenEquals
)

type statefulToken struct {
	kind statefulTokenKind
	text string
}

func parseStatefulExpression(text string) (statefulExpr, error) {
	tokens, err := tokenizeStatefulExpression(text)
	if err != nil {
		return nil, err
	}
	parser := &statefulExpressionParser{tokens: tokens}
	expression, err := parser.parseTernary()
	if err != nil {
		return nil, err
	}
	if parser.peek().kind != statefulTokenEOF {
		return nil, fmt.Errorf("unexpected expression tail %q", parser.peek().text)
	}
	return expression, nil
}

func tokenizeStatefulExpression(text string) ([]statefulToken, error) {
	tokens := []statefulToken{}
	for index := 0; index < len(text); {
		char := text[index]
		if unicode.IsSpace(rune(char)) {
			index++
			continue
		}
		if char == '\'' || char == '"' {
			quote := char
			start := index + 1
			index++
			for index < len(text) && (text[index] != quote || text[index-1] == '\\') {
				index++
			}
			if index >= len(text) {
				return nil, fmt.Errorf("unterminated string")
			}
			tokens = append(tokens, statefulToken{kind: statefulTokenString, text: text[start:index]})
			index++
			continue
		}
		if char == '#' {
			start := index
			index++
			for index < len(text) && ((text[index] >= '0' && text[index] <= '9') || (text[index] >= 'a' && text[index] <= 'f') || (text[index] >= 'A' && text[index] <= 'F')) {
				index++
			}
			if index-start != 7 && index-start != 9 {
				return nil, fmt.Errorf("invalid color literal %q", text[start:index])
			}
			tokens = append(tokens, statefulToken{kind: statefulTokenColor, text: text[start:index]})
			continue
		}
		if (char >= '0' && char <= '9') || (char == '.' && index+1 < len(text) && text[index+1] >= '0' && text[index+1] <= '9') {
			start := index
			index++
			for index < len(text) && ((text[index] >= '0' && text[index] <= '9') || text[index] == '.') {
				index++
			}
			tokens = append(tokens, statefulToken{kind: statefulTokenNumber, text: text[start:index]})
			continue
		}
		if unicode.IsLetter(rune(char)) || char == '_' {
			start := index
			index++
			for index < len(text) && (unicode.IsLetter(rune(text[index])) || unicode.IsDigit(rune(text[index])) || text[index] == '_') {
				index++
			}
			tokens = append(tokens, statefulToken{kind: statefulTokenIdentifier, text: text[start:index]})
			continue
		}
		if index+1 < len(text) {
			pair := text[index : index+2]
			if pair == "==" || pair == "!=" || pair == ">=" || pair == "<=" {
				tokens = append(tokens, statefulToken{kind: statefulTokenOperator, text: pair})
				index += 2
				continue
			}
		}
		switch char {
		case '+', '-', '*', '/', '<', '>':
			tokens = append(tokens, statefulToken{kind: statefulTokenOperator, text: string(char)})
		case '(':
			tokens = append(tokens, statefulToken{kind: statefulTokenLeftParen, text: "("})
		case ')':
			tokens = append(tokens, statefulToken{kind: statefulTokenRightParen, text: ")"})
		case '[':
			tokens = append(tokens, statefulToken{kind: statefulTokenLeftBracket, text: "["})
		case ']':
			tokens = append(tokens, statefulToken{kind: statefulTokenRightBracket, text: "]"})
		case ',':
			tokens = append(tokens, statefulToken{kind: statefulTokenComma, text: ","})
		case '.':
			tokens = append(tokens, statefulToken{kind: statefulTokenDot, text: "."})
		case '?':
			tokens = append(tokens, statefulToken{kind: statefulTokenQuestion, text: "?"})
		case ':':
			tokens = append(tokens, statefulToken{kind: statefulTokenColon, text: ":"})
		case '=':
			tokens = append(tokens, statefulToken{kind: statefulTokenEquals, text: "="})
		default:
			return nil, fmt.Errorf("unsupported token %q", char)
		}
		index++
	}
	tokens = append(tokens, statefulToken{kind: statefulTokenEOF})
	return tokens, nil
}

type statefulExpressionParser struct {
	tokens []statefulToken
	index  int
}

func (p *statefulExpressionParser) peek() statefulToken { return p.tokens[p.index] }
func (p *statefulExpressionParser) next() statefulToken {
	token := p.tokens[p.index]
	p.index++
	return token
}

func (p *statefulExpressionParser) parseTernary() (statefulExpr, error) {
	condition, err := p.parseLogicalOr()
	if err != nil || p.peek().kind != statefulTokenQuestion {
		return condition, err
	}
	p.next()
	whenTrue, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	if p.next().kind != statefulTokenColon {
		return nil, fmt.Errorf("conditional expression missing ':'")
	}
	whenFalse, err := p.parseTernary()
	if err != nil {
		return nil, err
	}
	return &statefulTernaryExpr{condition: condition, whenTrue: whenTrue, whenFalse: whenFalse}, nil
}

func (p *statefulExpressionParser) parseLogicalOr() (statefulExpr, error) {
	return p.parseBinary(func() (statefulExpr, error) { return p.parseLogicalAnd() }, map[string]bool{"or": true})
}
func (p *statefulExpressionParser) parseLogicalAnd() (statefulExpr, error) {
	return p.parseBinary(func() (statefulExpr, error) { return p.parseComparison() }, map[string]bool{"and": true})
}
func (p *statefulExpressionParser) parseComparison() (statefulExpr, error) {
	return p.parseBinary(func() (statefulExpr, error) { return p.parseAdditive() }, map[string]bool{"==": true, "!=": true, ">": true, ">=": true, "<": true, "<=": true})
}
func (p *statefulExpressionParser) parseAdditive() (statefulExpr, error) {
	return p.parseBinary(func() (statefulExpr, error) { return p.parseMultiplicative() }, map[string]bool{"+": true, "-": true})
}
func (p *statefulExpressionParser) parseMultiplicative() (statefulExpr, error) {
	return p.parseBinary(func() (statefulExpr, error) { return p.parseUnary() }, map[string]bool{"*": true, "/": true})
}

func (p *statefulExpressionParser) parseBinary(next func() (statefulExpr, error), operators map[string]bool) (statefulExpr, error) {
	left, err := next()
	if err != nil {
		return nil, err
	}
	for {
		token := p.peek()
		op := token.text
		if token.kind == statefulTokenIdentifier && (op == "and" || op == "or") {
			// accepted below
		} else if token.kind != statefulTokenOperator {
			break
		}
		if !operators[op] {
			break
		}
		p.next()
		right, err := next()
		if err != nil {
			return nil, err
		}
		left = &statefulBinaryExpr{operator: op, left: left, right: right}
	}
	return left, nil
}

func (p *statefulExpressionParser) parseUnary() (statefulExpr, error) {
	token := p.peek()
	if (token.kind == statefulTokenIdentifier && token.text == "not") || (token.kind == statefulTokenOperator && token.text == "-") {
		p.next()
		value, err := p.parseUnary()
		if err != nil {
			return nil, err
		}
		return &statefulUnaryExpr{operator: token.text, value: value}, nil
	}
	return p.parsePrimary()
}

func (p *statefulExpressionParser) parsePrimary() (statefulExpr, error) {
	token := p.next()
	var expression statefulExpr
	switch token.kind {
	case statefulTokenNumber:
		value, ok := parseNumberLiteral(token.text)
		if !ok {
			return nil, fmt.Errorf("invalid number %q", token.text)
		}
		expression = &statefulLiteralExpr{value: statefulNumber(value)}
	case statefulTokenString:
		expression = &statefulLiteralExpr{value: statefulString(token.text)}
	case statefulTokenColor:
		expression = &statefulLiteralExpr{value: statefulColor(token.text)}
	case statefulTokenIdentifier:
		expression = &statefulIdentifierExpr{name: token.text}
	case statefulTokenLeftParen:
		value, err := p.parseTernary()
		if err != nil {
			return nil, err
		}
		if p.next().kind != statefulTokenRightParen {
			return nil, fmt.Errorf("unclosed parenthesized expression")
		}
		expression = value
	case statefulTokenLeftBracket:
		values := []statefulExpr{}
		if p.peek().kind != statefulTokenRightBracket {
			for {
				value, err := p.parseTernary()
				if err != nil {
					return nil, err
				}
				values = append(values, value)
				if p.peek().kind != statefulTokenComma {
					break
				}
				p.next()
			}
		}
		if p.next().kind != statefulTokenRightBracket {
			return nil, fmt.Errorf("unclosed tuple")
		}
		expression = &statefulTupleExpr{values: values}
	default:
		return nil, fmt.Errorf("expected expression, got %q", token.text)
	}
	return p.parsePostfix(expression)
}

func (p *statefulExpressionParser) parsePostfix(expression statefulExpr) (statefulExpr, error) {
	for {
		switch p.peek().kind {
		case statefulTokenDot:
			p.next()
			name := p.next()
			if name.kind != statefulTokenIdentifier {
				return nil, fmt.Errorf("field name expected")
			}
			expression = &statefulFieldExpr{receiver: expression, name: name.text}
		case statefulTokenLeftBracket:
			p.next()
			index, err := p.parseTernary()
			if err != nil {
				return nil, err
			}
			if p.next().kind != statefulTokenRightBracket {
				return nil, fmt.Errorf("unclosed index")
			}
			expression = &statefulIndexExpr{receiver: expression, index: index}
		case statefulTokenOperator:
			if p.peek().text != "<" || p.index+3 >= len(p.tokens) ||
				p.tokens[p.index+1].kind != statefulTokenIdentifier ||
				p.tokens[p.index+2].text != ">" ||
				p.tokens[p.index+3].kind != statefulTokenLeftParen {
				return expression, nil
			}
			// Pine's array.new<T>() generic annotation.  Comparisons are
			// consumed at the comparison-precedence level, so '<' here can
			// only follow a callable expression.
			p.next()
			generic := p.next()
			if generic.kind != statefulTokenIdentifier || p.next().text != ">" {
				return nil, fmt.Errorf("invalid generic call")
			}
			if p.peek().kind != statefulTokenLeftParen {
				return nil, fmt.Errorf("generic annotation must precede a call")
			}
			call, err := p.parseCall(expression)
			if err != nil {
				return nil, err
			}
			call.generic = generic.text
			expression = call
		case statefulTokenLeftParen:
			call, err := p.parseCall(expression)
			if err != nil {
				return nil, err
			}
			expression = call
		default:
			return expression, nil
		}
	}
}

func (p *statefulExpressionParser) parseCall(callee statefulExpr) (*statefulCallExpr, error) {
	p.next()
	call := &statefulCallExpr{callee: callee}
	if p.peek().kind != statefulTokenRightParen {
		for {
			argument := statefulCallArgument{}
			if p.peek().kind == statefulTokenIdentifier && p.index+1 < len(p.tokens) && p.tokens[p.index+1].kind == statefulTokenEquals {
				argument.name = p.next().text
				p.next()
			}
			expression, err := p.parseTernary()
			if err != nil {
				return nil, err
			}
			argument.expression = expression
			call.arguments = append(call.arguments, argument)
			if p.peek().kind != statefulTokenComma {
				break
			}
			p.next()
		}
	}
	if p.next().kind != statefulTokenRightParen {
		return nil, fmt.Errorf("unclosed function call")
	}
	return call, nil
}

func statefulExpressionContainsState(expression statefulExpr) bool {
	switch value := expression.(type) {
	case *statefulCallExpr:
		name := statefulExpressionName(value.callee)
		if strings.HasPrefix(name, "array.new") || name == "request.security" || name == "box.new" || name == "line.new" || name == "label.new" || name == "table.new" {
			return true
		}
		for _, argument := range value.arguments {
			if statefulExpressionContainsState(argument.expression) {
				return true
			}
		}
	case *statefulFieldExpr:
		return statefulExpressionContainsState(value.receiver)
	case *statefulIndexExpr:
		return statefulExpressionContainsState(value.receiver) || statefulExpressionContainsState(value.index)
	case *statefulUnaryExpr:
		return statefulExpressionContainsState(value.value)
	case *statefulBinaryExpr:
		return statefulExpressionContainsState(value.left) || statefulExpressionContainsState(value.right)
	case *statefulTernaryExpr:
		return statefulExpressionContainsState(value.condition) || statefulExpressionContainsState(value.whenTrue) || statefulExpressionContainsState(value.whenFalse)
	case *statefulTupleExpr:
		return true
	}
	return false
}

func statefulExpressionName(expression statefulExpr) string {
	switch value := expression.(type) {
	case *statefulIdentifierExpr:
		return value.name
	case *statefulFieldExpr:
		prefix := statefulExpressionName(value.receiver)
		if prefix == "" {
			return value.name
		}
		return prefix + "." + value.name
	default:
		return ""
	}
}
