package pineruntime

import (
	"regexp"
	"strconv"
	"strings"
	"unicode"
)

type callArguments struct {
	positional []string
	named      map[string]string
}

type sourceLine struct {
	number int
	indent int
	text   string
}

func stripLineComment(line string) string {
	var quote rune
	escaped := false
	runes := []rune(line)
	for i, ch := range runes {
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == '"' || ch == '\'' {
			if quote == ch {
				quote = 0
			} else if quote == 0 {
				quote = ch
			}
			continue
		}
		if quote == 0 && ch == '/' && i+1 < len(runes) && runes[i+1] == '/' {
			return string(runes[:i])
		}
	}
	return line
}

func normalizeSource(source string) string {
	source = strings.ReplaceAll(source, "\r\n", "\n")
	source = strings.ReplaceAll(source, "\r", "\n")
	lines := strings.Split(source, "\n")
	for i, line := range lines {
		lines[i] = stripLineComment(line)
	}
	return strings.Join(lines, "\n")
}

func isIdentChar(ch byte) bool {
	return ch == '_' || ch == '.' || unicode.IsLetter(rune(ch)) || unicode.IsDigit(rune(ch))
}

func findCallBodies(source, name string) []string {
	out := []string{}
	index := 0
	needle := name + "("
	for index < len(source) {
		found := strings.Index(source[index:], needle)
		if found < 0 {
			break
		}
		found += index
		if found > 0 && isIdentChar(source[found-1]) {
			index = found + len(name)
			continue
		}
		depth := 0
		start := -1
		var quote byte
		escaped := false
		for i := found + len(name); i < len(source); i++ {
			ch := source[i]
			if escaped {
				escaped = false
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			if ch == '"' || ch == '\'' {
				if quote == ch {
					quote = 0
				} else if quote == 0 {
					quote = ch
				}
				continue
			}
			if quote != 0 {
				continue
			}
			if ch == '(' {
				if depth == 0 {
					start = i + 1
				}
				depth++
			} else if ch == ')' {
				depth--
				if depth == 0 && start >= 0 {
					out = append(out, source[start:i])
					index = i + 1
					break
				}
			}
		}
		if depth != 0 {
			break
		}
	}
	return out
}

func splitTopLevel(input string) []string {
	out := []string{}
	depth := 0
	start := 0
	var quote byte
	escaped := false
	for i := 0; i < len(input); i++ {
		ch := input[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == '"' || ch == '\'' {
			if quote == ch {
				quote = 0
			} else if quote == 0 {
				quote = ch
			}
			continue
		}
		if quote != 0 {
			continue
		}
		switch ch {
		case '(', '[':
			depth++
		case ')', ']':
			depth--
		case ',':
			if depth == 0 {
				if part := strings.TrimSpace(input[start:i]); part != "" {
					out = append(out, part)
				}
				start = i + 1
			}
		}
	}
	if part := strings.TrimSpace(input[start:]); part != "" {
		out = append(out, part)
	}
	return out
}

func topLevelEquals(input string) int {
	depth := 0
	var quote byte
	escaped := false
	for i := 0; i < len(input); i++ {
		ch := input[i]
		if escaped {
			escaped = false
			continue
		}
		if ch == '\\' {
			escaped = true
			continue
		}
		if ch == '"' || ch == '\'' {
			if quote == ch {
				quote = 0
			} else if quote == 0 {
				quote = ch
			}
			continue
		}
		if quote != 0 {
			continue
		}
		if ch == '(' || ch == '[' {
			depth++
		} else if ch == ')' || ch == ']' {
			depth--
		} else if ch == '=' && depth == 0 {
			prev, next := byte(0), byte(0)
			if i > 0 {
				prev = input[i-1]
			}
			if i+1 < len(input) {
				next = input[i+1]
			}
			if !strings.ContainsRune("<>=!", rune(prev)) && next != '=' {
				return i
			}
		}
	}
	return -1
}

func parseCallArguments(body string) callArguments {
	args := callArguments{named: map[string]string{}}
	for _, part := range splitTopLevel(body) {
		if eq := topLevelEquals(part); eq > 0 {
			args.named[strings.TrimSpace(part[:eq])] = strings.TrimSpace(part[eq+1:])
		} else {
			args.positional = append(args.positional, strings.TrimSpace(part))
		}
	}
	return args
}

func unquote(input string) (string, bool) {
	trimmed := strings.TrimSpace(input)
	if len(trimmed) < 2 {
		return "", false
	}
	quote := trimmed[0]
	if (quote != '"' && quote != '\'') || trimmed[len(trimmed)-1] != quote {
		return "", false
	}
	value, err := strconv.Unquote(trimmed)
	if err == nil {
		return value, true
	}
	return trimmed[1 : len(trimmed)-1], true
}

func parseBoolLiteral(input string) (bool, bool) {
	switch strings.ToLower(strings.TrimSpace(input)) {
	case "true":
		return true, true
	case "false":
		return false, true
	default:
		return false, false
	}
}

func parseNumberLiteral(input string) (float64, bool) {
	value, err := strconv.ParseFloat(strings.TrimSpace(input), 64)
	return value, err == nil
}

func sourceLines(cleaned string) []sourceLine {
	rawLines := strings.Split(cleaned, "\n")
	lines := make([]sourceLine, 0, len(rawLines))
	for i, raw := range rawLines {
		indent := 0
		for _, ch := range raw {
			if ch == ' ' {
				indent++
			} else if ch == '\t' {
				indent += 4
			} else {
				break
			}
		}
		lines = append(lines, sourceLine{
			number: i + 1,
			indent: indent,
			text:   strings.TrimSuffix(strings.TrimSpace(raw), ";"),
		})
	}
	return lines
}

var assignmentRe = regexp.MustCompile(`^(?:(?:export\s+)?(?:(?:var|varip|const|simple|series)\s+)*(?:float|int|bool|color|string|line|label|box|table)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(:=|=)\s*(.+)$`)
var compoundAssignmentRe = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)\s*([+\-*/])=\s*(.+)$`)
var functionDefinitionRe = regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*=>\s*(.+)$`)

func assignmentMatch(text string) []string {
	return assignmentRe.FindStringSubmatch(text)
}

func compoundAssignmentMatch(text string) []string {
	return compoundAssignmentRe.FindStringSubmatch(text)
}

func functionDefinitionMatch(text string) []string {
	return functionDefinitionRe.FindStringSubmatch(text)
}
