import type {
  Candle,
  IndicatorLineStyle,
  IndicatorLineWidth,
  IndicatorResult,
  IndicatorSeries,
  LinePoint,
} from "@/types";

export const DEFAULT_PINE_SOURCE = `// This Pine Script code is subject to the terms of the Mozilla Public License 2.0
// By Custom

//@version=6
indicator("My script", overlay=true)
plot(close, title="Close", color=color.blue)`;

const DEFAULT_COLORS = [
  "#2962ff",
  "#ff6d00",
  "#26a69a",
  "#ab47bc",
  "#00bcd4",
  "#ef5350",
];
const FLAT_LINE_RIGHT_EXTENSION_BARS = 250;
const OBJECT_RIGHT_EXTENSION_BARS = 12;

const NAMED_COLORS: Record<string, string> = {
  "color.blue": "#2196f3",
  "color.orange": "#ff9800",
  "color.green": "#4caf50",
  "color.red": "#f44336",
  "color.purple": "#9c27b0",
  "color.aqua": "#00bcd4",
  "color.lime": "#00e676",
  "color.fuchsia": "#e040fb",
  "color.maroon": "#880e4f",
  "color.navy": "#311b92",
  "color.olive": "#808000",
  "color.teal": "#00897b",
  "color.yellow": "#fdd835",
  "color.white": "#ffffff",
  "color.black": "#000000",
  "color.gray": "#787b86",
  "color.grey": "#787b86",
  "color.silver": "#b2b5be",
  blue: "#2196f3",
  orange: "#ff9800",
  green: "#4caf50",
  red: "#f44336",
  purple: "#9c27b0",
  aqua: "#00bcd4",
  lime: "#00e676",
  fuchsia: "#e040fb",
  maroon: "#880e4f",
  navy: "#311b92",
  olive: "#808000",
  teal: "#00897b",
  yellow: "#fdd835",
  white: "#ffffff",
  black: "#000000",
  gray: "#787b86",
  grey: "#787b86",
  silver: "#b2b5be",
};

export interface PineScriptMeta {
  name: string;
  overlay: boolean;
}

export interface PineCompilation {
  meta: PineScriptMeta;
  result: IndicatorResult;
  errors: string[];
}

type SeriesData = (number | null)[];
type ColorSeriesData = (string | null)[];

type PineValue =
  | { kind: "number"; value: number }
  | { kind: "series"; values: SeriesData }
  | { kind: "color"; value: string }
  | { kind: "colorSeries"; values: ColorSeriesData }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean };

interface PineCallArg {
  name?: string;
  value: PineValue;
}

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "string"; value: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "bracket"; value: "[" | "]" }
  | { kind: "comma"; value: "," }
  | { kind: "equals"; value: "=" }
  | { kind: "comparison"; value: ">" | ">=" | "<" | "<=" | "==" | "!=" }
  | { kind: "question"; value: "?" }
  | { kind: "colon"; value: ":" }
  | { kind: "eof" };

interface EvalContext {
  candles: Candle[];
  variables: Map<string, PineValue>;
  functions: Map<string, { params: string[]; expression: string }>;
}

function stripLineComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if ((ch === '"' || ch === "'") && line[i - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
    }
    if (!quote && ch === "/" && line[i + 1] === "/") {
      return line.slice(0, i);
    }
  }
  return line;
}

function normalizedSource(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map(stripLineComment)
    .join("\n");
}

function isIdentChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9_.]/.test(ch);
}

function findCallBodies(source: string, name: string): string[] {
  const bodies: string[] = [];
  let index = 0;

  while (index < source.length) {
    const found = source.indexOf(`${name}(`, index);
    if (found === -1) break;

    const before = source[found - 1];
    if (isIdentChar(before)) {
      index = found + name.length;
      continue;
    }

    let depth = 0;
    let quote: string | null = null;
    let start = -1;
    for (let i = found + name.length; i < source.length; i++) {
      const ch = source[i];
      if ((ch === '"' || ch === "'") && source[i - 1] !== "\\") {
        quote = quote === ch ? null : quote ?? ch;
      }
      if (quote) continue;
      if (ch === "(") {
        if (depth === 0) start = i + 1;
        depth += 1;
      } else if (ch === ")") {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          bodies.push(source.slice(start, i));
          index = i + 1;
          break;
        }
      }
    }
    if (depth !== 0) break;
  }

  return bodies;
}

function splitTopLevel(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if ((ch === '"' || ch === "'") && input[i - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
    }
    if (quote) continue;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (ch === "," && depth === 0) {
      out.push(input.slice(start, i).trim());
      start = i + 1;
    }
  }

  const last = input.slice(start).trim();
  if (last) out.push(last);
  return out;
}

function topLevelEquals(input: string): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if ((ch === '"' || ch === "'") && input[i - 1] !== "\\") {
      quote = quote === ch ? null : quote ?? ch;
    }
    if (quote) continue;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (
      ch === "=" &&
      depth === 0 &&
      !/[<>=!]/.test(input[i - 1] ?? "") &&
      input[i + 1] !== "="
    ) {
      return i;
    }
  }
  return -1;
}

function parseCallArguments(body: string): {
  positional: string[];
  named: Record<string, string>;
} {
  const positional: string[] = [];
  const named: Record<string, string> = {};

  for (const part of splitTopLevel(body)) {
    const eq = topLevelEquals(part);
    if (eq > 0) {
      named[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
    } else {
      positional.push(part.trim());
    }
  }

  return { positional, named };
}

function unquote(input: string | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed[trimmed.length - 1] === quote) {
    return trimmed.slice(1, -1).replaceAll(`\\${quote}`, quote);
  }
  return null;
}

function parseBool(input: string | undefined): boolean | null {
  if (!input) return null;
  const v = input.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}

function clampTransparency(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function withTransparency(color: string, transparency: number): string {
  const alpha = 1 - clampTransparency(transparency) / 100;
  const hex = color.trim();
  const match = hex.match(/^#([0-9a-f]{6})$/i);
  if (!match) return color;
  const raw = match[1];
  const r = Number.parseInt(raw.slice(0, 2), 16);
  const g = Number.parseInt(raw.slice(2, 4), 16);
  const b = Number.parseInt(raw.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}

function parseNumberLiteral(input: string | undefined): number | null {
  if (!input) return null;
  const value = Number(input.trim());
  return Number.isFinite(value) ? value : null;
}

function applyTransparencyToColors(
  color: string,
  colors: ColorSeriesData | undefined,
  transparency: number | null,
): { color: string; colors?: ColorSeriesData } {
  if (transparency == null) return { color, colors };
  return {
    color: withTransparency(color, transparency),
    colors: colors?.map((item) => item == null ? null : withTransparency(item, transparency)),
  };
}

function lineStyle(expression: string | undefined): IndicatorLineStyle {
  const key = expression?.trim().replace(/^plot\.style_/, "").toLowerCase();
  if (key === "dotted") return 1;
  if (key === "dashed") return 2;
  if (key === "large_dashed") return 3;
  if (key === "sparse_dotted") return 4;
  return 0;
}

function lineWidth(expression: string | undefined, fallback: IndicatorLineWidth): IndicatorLineWidth {
  const value = parseNumberLiteral(expression);
  if (value == null) return fallback;
  return Math.max(1, Math.min(4, Math.round(value))) as IndicatorLineWidth;
}

export function extractPineScriptMeta(source: string): PineScriptMeta {
  const cleaned = normalizedSource(source);
  const indicatorBody =
    findCallBodies(cleaned, "indicator")[0] ?? findCallBodies(cleaned, "study")[0];
  if (!indicatorBody) return { name: "Untitled script", overlay: true };

  const args = parseCallArguments(indicatorBody);
  const name =
    unquote(args.named.title) ??
    unquote(args.positional[0]) ??
    "Untitled script";
  const overlay = parseBool(args.named.overlay) ?? false;
  return { name, overlay };
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      const start = i;
      i += 1;
      while (/[0-9.]/.test(input[i] ?? "")) i += 1;
      tokens.push({ kind: "number", value: Number(input.slice(start, i)) });
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      const start = i;
      i += 1;
      while (/[A-Za-z0-9_.]/.test(input[i] ?? "")) i += 1;
      tokens.push({ kind: "identifier", value: input.slice(start, i) });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i += 1;
      let value = "";
      while (i < input.length) {
        if (input[i] === quote && input[i - 1] !== "\\") break;
        value += input[i];
        i += 1;
      }
      i += 1;
      tokens.push({ kind: "string", value });
      continue;
    }
    if (ch === "+" || ch === "-" || ch === "*" || ch === "/") {
      tokens.push({ kind: "operator", value: ch });
      i += 1;
      continue;
    }
    if (
      (ch === ">" || ch === "<" || ch === "=" || ch === "!") &&
      input[i + 1] === "="
    ) {
      tokens.push({
        kind: "comparison",
        value: `${ch}=` as Extract<Token, { kind: "comparison" }>["value"],
      });
      i += 2;
      continue;
    }
    if (ch === ">" || ch === "<") {
      tokens.push({ kind: "comparison", value: ch });
      i += 1;
      continue;
    }
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
      i += 1;
      continue;
    }
    if (ch === "[" || ch === "]") {
      tokens.push({ kind: "bracket", value: ch });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ kind: "comma", value: "," });
      i += 1;
      continue;
    }
    if (ch === "=") {
      tokens.push({ kind: "equals", value: "=" });
      i += 1;
      continue;
    }
    if (ch === "?") {
      tokens.push({ kind: "question", value: "?" });
      i += 1;
      continue;
    }
    if (ch === ":") {
      tokens.push({ kind: "colon", value: ":" });
      i += 1;
      continue;
    }
    throw new Error(`Unsupported token "${ch}"`);
  }

  tokens.push({ kind: "eof" });
  return tokens;
}

class ExpressionParser {
  private readonly tokens: Token[];
  private index = 0;

  constructor(
    input: string,
    private readonly context: EvalContext,
  ) {
    this.tokens = tokenize(input);
  }

  parse(): PineValue {
    const value = this.parseTernary();
    if (this.peek().kind !== "eof") {
      throw new Error("Unexpected expression tail");
    }
    return value;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private parseTernary(): PineValue {
    const condition = this.parseLogical();
    if (this.peek().kind !== "question") return condition;
    this.next();
    const whenTrue = this.parseTernary();
    const colon = this.next();
    if (colon.kind !== "colon") {
      throw new Error("Expected ':' in conditional expression");
    }
    const whenFalse = this.parseTernary();
    return chooseValue(
      condition,
      whenTrue,
      whenFalse,
      this.context.candles.length,
    );
  }

  private parseLogical(): PineValue {
    let left = this.parseComparison();
    while (
      this.peek().kind === "identifier" &&
      ((this.peek() as Extract<Token, { kind: "identifier" }>).value.toLowerCase() === "and" ||
        (this.peek() as Extract<Token, { kind: "identifier" }>).value.toLowerCase() === "or")
    ) {
      const op = (this.next() as Extract<Token, { kind: "identifier" }>).value.toLowerCase() as "and" | "or";
      const right = this.parseComparison();
      left = logicalValues(left, right, op, this.context.candles.length);
    }
    return left;
  }

  private parseComparison(): PineValue {
    let left = this.parseAdditive();
    while (this.peek().kind === "comparison") {
      const op = this.next() as Extract<Token, { kind: "comparison" }>;
      const right = this.parseAdditive();
      left = compareValues(left, right, op.value, this.context.candles.length);
    }
    return left;
  }

  private parseAdditive(): PineValue {
    let left = this.parseMultiplicative();
    while (true) {
      const token = this.peek();
      if (
        token.kind !== "operator" ||
        (token.value !== "+" && token.value !== "-")
      ) {
        break;
      }
      const op = this.next() as Extract<Token, { kind: "operator" }>;
      const right = this.parseMultiplicative();
      left = combineValues(left, right, op.value, this.context.candles.length);
    }
    return left;
  }

  private parseMultiplicative(): PineValue {
    let left = this.parseUnary();
    while (true) {
      const token = this.peek();
      if (
        token.kind !== "operator" ||
        (token.value !== "*" && token.value !== "/")
      ) {
        break;
      }
      const op = this.next() as Extract<Token, { kind: "operator" }>;
      const right = this.parseUnary();
      left = combineValues(left, right, op.value, this.context.candles.length);
    }
    return left;
  }

  private parseUnary(): PineValue {
    const token = this.peek();
    if (
      token.kind === "identifier" &&
      token.value.toLowerCase() === "not"
    ) {
      this.next();
      return logicalNotValue(this.parseUnary(), this.context.candles.length);
    }
    if (token.kind === "operator" && token.value === "-") {
      this.next();
      return negateValue(this.parseUnary(), this.context.candles.length);
    }
    return this.parsePrimary();
  }

  private parsePrimary(): PineValue {
    const token = this.next();
    if (token.kind === "number") return { kind: "number", value: token.value };
    if (token.kind === "string") return { kind: "string", value: token.value };
    if (token.kind === "identifier") {
      const next = this.peek();
      if (next.kind === "paren" && next.value === "(") {
        this.next();
        const args: PineCallArg[] = [];
        const maybeClose = this.peek();
        if (!(maybeClose.kind === "paren" && maybeClose.value === ")")) {
          while (true) {
            let argName: string | undefined;
            if (
              this.peek().kind === "identifier" &&
              this.tokens[this.index + 1]?.kind === "equals"
            ) {
              argName = (this.next() as Extract<Token, { kind: "identifier" }>).value;
              this.next();
            }
            args.push({ name: argName, value: this.parseTernary() });
            if (this.peek().kind === "comma") {
              this.next();
              continue;
            }
            break;
          }
        }
        const close = this.next();
        if (close.kind !== "paren" || close.value !== ")") {
          throw new Error(`Unclosed call ${token.value}()`);
        }
        return evaluateCall(token.value, args, this.context);
      }
      return this.parsePostfix(resolveIdentifier(token.value, this.context));
    }
    if (token.kind === "paren" && token.value === "(") {
      const value = this.parseTernary();
      const close = this.next();
      if (close.kind !== "paren" || close.value !== ")") {
        throw new Error("Unclosed parenthesized expression");
      }
      return value;
    }
    throw new Error("Expected expression");
  }

  private parsePostfix(value: PineValue): PineValue {
    let current = value;
    while (true) {
      const token = this.peek();
      if (token.kind !== "bracket" || token.value !== "[") break;
      this.next();
      const offset = this.next();
      if (offset.kind !== "number") {
        throw new Error("History reference expects a numeric offset");
      }
      const close = this.next();
      if (close.kind !== "bracket" || close.value !== "]") {
        throw new Error("Unclosed history reference");
      }
      current = shiftValue(current, Math.max(0, Math.round(offset.value)), this.context.candles.length);
    }
    return current;
  }
}

function isUsableNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isColorValue(value: PineValue): value is Extract<PineValue, { kind: "color" | "colorSeries" }> {
  return value.kind === "color" || value.kind === "colorSeries";
}

function numberValue(value: PineValue): number {
  if (value.kind !== "number" || !Number.isFinite(value.value)) {
    throw new Error("Expected numeric length/value");
  }
  return value.value;
}

function getAt(value: PineValue, index: number, length: number): number | null {
  if (value.kind === "number") return value.value;
  if (value.kind === "series") return value.values[index] ?? null;
  if (value.kind === "bool") return value.value ? 1 : 0;
  return index < length ? null : null;
}

function colorAt(value: PineValue, index: number): string | null {
  if (value.kind === "color") return value.value;
  if (value.kind === "colorSeries") return value.values[index] ?? null;
  return null;
}

function stringValue(value: PineValue, index: number, length: number): string {
  if (value.kind === "string") return value.value;
  if (value.kind === "color") return value.value;
  if (value.kind === "bool") return value.value ? "true" : "false";
  const numeric = getAt(value, index, length);
  return isUsableNumber(numeric) ? String(numeric) : "";
}

function toSeries(value: PineValue, length: number): SeriesData {
  if (value.kind === "series") return value.values;
  if (value.kind === "number") return Array.from({ length }, () => value.value);
  if (value.kind === "bool") return Array.from({ length }, () => (value.value ? 1 : 0));
  return Array.from({ length }, () => null);
}

function toColorSeries(value: PineValue, length: number): ColorSeriesData {
  if (value.kind === "colorSeries") return value.values;
  if (value.kind === "color") return Array.from({ length }, () => value.value);
  return Array.from({ length }, () => null);
}

function truthyAt(value: PineValue, index: number, length: number): boolean {
  if (value.kind === "bool") return value.value;
  if (value.kind === "number") return Number.isFinite(value.value) && value.value !== 0;
  if (value.kind === "series") {
    const point = value.values[index];
    return isUsableNumber(point) && point !== 0;
  }
  return colorAt(value, index) != null && index < length;
}

function valueVaries(value: PineValue): boolean {
  return value.kind === "series" || value.kind === "colorSeries";
}

function chooseValue(
  condition: PineValue,
  whenTrue: PineValue,
  whenFalse: PineValue,
  length: number,
): PineValue {
  if (!valueVaries(condition)) {
    return truthyAt(condition, 0, length) ? whenTrue : whenFalse;
  }

  if (isColorValue(whenTrue) || isColorValue(whenFalse)) {
    return {
      kind: "colorSeries",
      values: Array.from({ length }, (_, index) =>
        truthyAt(condition, index, length)
          ? colorAt(whenTrue, index)
          : colorAt(whenFalse, index),
      ),
    };
  }

  return {
    kind: "series",
    values: Array.from({ length }, (_, index) =>
      truthyAt(condition, index, length)
        ? getAt(whenTrue, index, length)
        : getAt(whenFalse, index, length),
    ),
  };
}

function compareValues(
  left: PineValue,
  right: PineValue,
  op: Extract<Token, { kind: "comparison" }>["value"],
  length: number,
): PineValue {
  if (
    (left.kind === "string" || right.kind === "string") &&
    (op === "==" || op === "!=")
  ) {
    const equal = stringValue(left, length - 1, length) === stringValue(right, length - 1, length);
    return { kind: "bool", value: op === "==" ? equal : !equal };
  }

  const compare = (a: number, b: number) => {
    switch (op) {
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      case "==": return a === b;
      case "!=": return a !== b;
    }
  };

  if (left.kind === "number" && right.kind === "number") {
    return { kind: "bool", value: compare(left.value, right.value) };
  }

  return {
    kind: "series",
    values: Array.from({ length }, (_, index) => {
      const a = getAt(left, index, length);
      const b = getAt(right, index, length);
      return isUsableNumber(a) && isUsableNumber(b) && compare(a, b) ? 1 : 0;
    }),
  };
}

function logicalValues(
  left: PineValue,
  right: PineValue,
  op: "and" | "or",
  length: number,
): PineValue {
  if (!valueVaries(left) && !valueVaries(right)) {
    return {
      kind: "bool",
      value:
        op === "and"
          ? truthyAt(left, 0, length) && truthyAt(right, 0, length)
          : truthyAt(left, 0, length) || truthyAt(right, 0, length),
    };
  }

  return {
    kind: "series",
    values: Array.from({ length }, (_, index) => {
      const ok =
        op === "and"
          ? truthyAt(left, index, length) && truthyAt(right, index, length)
          : truthyAt(left, index, length) || truthyAt(right, index, length);
      return ok ? 1 : 0;
    }),
  };
}

function logicalNotValue(value: PineValue, length: number): PineValue {
  if (!valueVaries(value)) {
    return { kind: "bool", value: !truthyAt(value, 0, length) };
  }

  return {
    kind: "series",
    values: Array.from({ length }, (_, index) => truthyAt(value, index, length) ? 0 : 1),
  };
}

function shiftValue(value: PineValue, offset: number, length: number): PineValue {
  if (isColorValue(value)) {
    const colors = toColorSeries(value, length);
    return {
      kind: "colorSeries",
      values: colors.map((_, index) => colors[index - offset] ?? null),
    };
  }

  const values = toSeries(value, length);
  return {
    kind: "series",
    values: values.map((_, index) => values[index - offset] ?? null),
  };
}

function combineValues(
  left: PineValue,
  right: PineValue,
  op: "+" | "-" | "*" | "/",
  length: number,
): PineValue {
  if (op === "+" && (left.kind === "string" || right.kind === "string")) {
    return {
      kind: "string",
      value: `${stringValue(left, length - 1, length)}${stringValue(right, length - 1, length)}`,
    };
  }

  if (left.kind === "number" && right.kind === "number") {
    return { kind: "number", value: applyOperator(left.value, right.value, op) };
  }
  const values: SeriesData = [];
  for (let i = 0; i < length; i++) {
    const a = getAt(left, i, length);
    const b = getAt(right, i, length);
    values.push(isUsableNumber(a) && isUsableNumber(b) ? applyOperator(a, b, op) : null);
  }
  return { kind: "series", values };
}

function applyOperator(a: number, b: number, op: "+" | "-" | "*" | "/"): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  return b === 0 ? Number.NaN : a / b;
}

function negateValue(value: PineValue, length: number): PineValue {
  if (value.kind === "number") return { kind: "number", value: -value.value };
  if (value.kind === "series") {
    return {
      kind: "series",
      values: value.values.map((v) => (isUsableNumber(v) ? -v : null)),
    };
  }
  return { kind: "series", values: Array.from({ length }, () => null) };
}

function sourceSeries(candles: Candle[], key: keyof Candle): PineValue {
  return { kind: "series", values: candles.map((c) => c[key] as number) };
}

function resolveIdentifier(name: string, context: EvalContext): PineValue {
  const stored = context.variables.get(name);
  if (stored) return stored;
  if (NAMED_COLORS[name]) return { kind: "color", value: NAMED_COLORS[name] };
  if (
    name.startsWith("input.") ||
    name.startsWith("plot.style_") ||
    name.startsWith("format.") ||
    name.startsWith("line.style_") ||
    name.startsWith("label.style_") ||
    name.startsWith("position.") ||
    name.startsWith("size.") ||
    name.startsWith("text.align_") ||
    name.startsWith("barmerge.") ||
    name.startsWith("xloc.") ||
    name.startsWith("yloc.") ||
    name.startsWith("extend.")
  ) {
    return { kind: "string", value: name };
  }
  if (
    [
      "integer",
      "float",
      "bool",
      "source",
      "string",
      "line",
      "linebr",
      "columns",
      "histogram",
      "solid",
      "dashed",
      "dotted",
    ].includes(name)
  ) {
    return { kind: "string", value: name };
  }

  switch (name) {
    case "open":
      return sourceSeries(context.candles, "open");
    case "high":
      return sourceSeries(context.candles, "high");
    case "low":
      return sourceSeries(context.candles, "low");
    case "close":
      return sourceSeries(context.candles, "close");
    case "volume":
      return sourceSeries(context.candles, "volume");
    case "time":
      return sourceSeries(context.candles, "time");
    case "bar_index":
      return { kind: "series", values: context.candles.map((_, index) => index) };
    case "last_bar_index":
      return { kind: "number", value: Math.max(0, context.candles.length - 1) };
    case "last_bar_time":
      return { kind: "number", value: context.candles.at(-1)?.time ?? Number.NaN };
    case "barstate.isfirst":
      return {
        kind: "series",
        values: context.candles.map((_, index) => index === 0 ? 1 : 0),
      };
    case "barstate.islast":
      return {
        kind: "series",
        values: context.candles.map((_, index) =>
          index === context.candles.length - 1 ? 1 : 0,
        ),
      };
    case "barstate.ishistory":
    case "barstate.isconfirmed":
      return { kind: "series", values: context.candles.map(() => 1) };
    case "barstate.isrealtime":
      return { kind: "series", values: context.candles.map(() => 0) };
    case "timeframe.period":
      return { kind: "string", value: inferTimeframePeriod(context.candles) };
    case "syminfo.tickerid":
      return { kind: "string", value: "" };
    case "syminfo.type":
      return { kind: "string", value: "crypto" };
    case "syminfo.mintick":
      return { kind: "number", value: inferMintick(context.candles) };
    case "syminfo.timezone":
      return { kind: "string", value: "UTC" };
    case "hl2":
      return pairAverage(context.candles, ["high", "low"]);
    case "hlc3":
      return pairAverage(context.candles, ["high", "low", "close"]);
    case "ohlc4":
      return pairAverage(context.candles, ["open", "high", "low", "close"]);
    case "true":
      return { kind: "bool", value: true };
    case "false":
      return { kind: "bool", value: false };
    case "na":
      return { kind: "number", value: Number.NaN };
    default:
      throw new Error(`Unknown identifier "${name}"`);
  }
}

function pairAverage(candles: Candle[], keys: (keyof Candle)[]): PineValue {
  return {
    kind: "series",
    values: candles.map((c) => keys.reduce((sum, key) => sum + (c[key] as number), 0) / keys.length),
  };
}

function callArg(args: PineCallArg[], index: number): PineValue | undefined {
  return args[index]?.value;
}

function namedCallArg(args: PineCallArg[], name: string): PineValue | undefined {
  return args.find((arg) => arg.name === name)?.value;
}

function callArgByNameOrIndex(
  args: PineCallArg[],
  name: string,
  index: number,
): PineValue | undefined {
  return namedCallArg(args, name) ?? callArg(args, index);
}

function callArgOrNa(args: PineCallArg[], name: string, index: number): PineValue {
  return callArgByNameOrIndex(args, name, index) ?? { kind: "number", value: Number.NaN };
}

function evaluateCall(name: string, args: PineCallArg[], context: EvalContext): PineValue {
  const customFunction = context.functions.get(name);
  if (customFunction) {
    const functionContext: EvalContext = {
      candles: context.candles,
      variables: new Map(context.variables),
      functions: context.functions,
    };
    customFunction.params.forEach((param, index) => {
      functionContext.variables.set(
        param,
        callArg(args, index) ?? { kind: "number", value: Number.NaN },
      );
    });
    return evaluateExpression(customFunction.expression, functionContext);
  }

  switch (name) {
    case "input":
    case "input.int":
    case "input.float":
    case "input.source":
    case "input.bool":
    case "input.color":
      return namedCallArg(args, "defval") ?? callArg(args, 0) ?? { kind: "number", value: 0 };
    case "color":
    case "color.new": {
      const base = callArg(args, 0);
      const transparency = callArgByNameOrIndex(args, "transp", 1);
      if (!base || !isColorValue(base)) {
        return { kind: "color", value: DEFAULT_COLORS[0] };
      }
      const transp = transparency ? numberValue(transparency) : null;
      if (base.kind === "colorSeries") {
        return {
          kind: "colorSeries",
          values: base.values.map((item) =>
            item == null || transp == null ? item : withTransparency(item, transp),
          ),
        };
      }
      return {
        kind: "color",
        value: transp == null ? base.value : withTransparency(base.value, transp),
      };
    }
    case "na":
      return naValue(callArg(args, 0), context.candles.length);
    case "nz":
      return nz(callArg(args, 0), callArg(args, 1), context.candles.length);
    case "time": {
      const timeframe = callArg(args, 0);
      if (timeframe?.kind === "string") {
        return timeframeOpenTimeSeries(context.candles, timeframe.value);
      }
      return sourceSeries(context.candles, "time");
    }
    case "timeframe.change": {
      const timeframe = callArg(args, 0);
      return timeframeChangeSeries(
        context.candles,
        timeframe?.kind === "string" ? timeframe.value : inferTimeframePeriod(context.candles),
      );
    }
    case "str.tostring":
      return {
        kind: "string",
        value: formatPineTextValue(
          callArg(args, 0),
          callArg(args, 1),
          context.candles.length - 1,
          context,
        ),
      };
    case "str.format_time":
      return {
        kind: "string",
        value: formatPineDate(
          getAt(callArg(args, 0) ?? { kind: "number", value: Number.NaN }, context.candles.length - 1, context.candles.length),
        ),
      };
    case "math.abs":
    case "abs":
      return mapValue(callArg(args, 0), context.candles.length, Math.abs);
    case "math.max":
    case "max":
      return reduceMath(args.map((arg) => arg.value), context.candles.length, Math.max);
    case "math.min":
    case "min":
      return reduceMath(args.map((arg) => arg.value), context.candles.length, Math.min);
    case "ta.sma":
    case "sma":
      return {
        kind: "series",
        values: rollingAverage(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
        ),
      };
    case "ta.ema":
    case "ema":
      return {
        kind: "series",
        values: exponentialAverage(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
        ),
      };
    case "ta.rma":
    case "rma":
      return {
        kind: "series",
        values: runningMovingAverage(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
        ),
      };
    case "ta.rsi":
    case "rsi":
      return {
        kind: "series",
        values: rsiSeries(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
        ),
      };
    case "ta.vwap":
    case "vwap":
      return { kind: "series", values: vwapSeries(context.candles) };
    case "ta.highest":
    case "highest":
      return {
        kind: "series",
        values: rollingExtreme(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
          "high",
        ),
      };
    case "ta.stdev":
    case "stdev":
      return {
        kind: "series",
        values: rollingStandardDeviation(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
        ),
      };
    case "ta.barssince":
    case "barssince":
      return barssinceSeries(callArgOrNa(args, "condition", 0), context.candles.length);
    case "ta.valuewhen":
    case "valuewhen":
      return valuewhenSeries(
        callArgOrNa(args, "condition", 0),
        callArgOrNa(args, "source", 1),
        occurrence(callArgByNameOrIndex(args, "occurrence", 2)),
        context.candles.length,
      );
    case "ta.rising":
    case "rising":
      return trendSeries(
        toSeries(callArgOrNa(args, "source", 0), context.candles.length),
        period(callArgByNameOrIndex(args, "length", 1)),
        "rising",
      );
    case "ta.falling":
    case "falling":
      return trendSeries(
        toSeries(callArgOrNa(args, "source", 0), context.candles.length),
        period(callArgByNameOrIndex(args, "length", 1)),
        "falling",
      );
    case "ta.lowest":
    case "lowest":
      return {
        kind: "series",
        values: rollingExtreme(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          period(callArgByNameOrIndex(args, "length", 1)),
          "low",
        ),
      };
    case "ta.change": {
      const length = callArgByNameOrIndex(args, "length", 1);
      return {
        kind: "series",
        values: changeSeries(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          length ? period(length) : 1,
        ),
      };
    }
    case "change": {
      const length = callArgByNameOrIndex(args, "length", 1);
      return {
        kind: "series",
        values: changeSeries(
          toSeries(callArgOrNa(args, "source", 0), context.candles.length),
          length ? period(length) : 1,
        ),
      };
    }
    case "ta.crossover":
    case "crossover":
      return crossSeries(
        toSeries(callArgOrNa(args, "source1", 0), context.candles.length),
        toSeries(callArgOrNa(args, "source2", 1), context.candles.length),
        "over",
      );
    case "ta.crossunder":
    case "crossunder":
      return crossSeries(
        toSeries(callArgOrNa(args, "source1", 0), context.candles.length),
        toSeries(callArgOrNa(args, "source2", 1), context.candles.length),
        "under",
      );
    case "ta.atr":
    case "atr":
      return {
        kind: "series",
        values: atrSeries(context.candles, period(callArgByNameOrIndex(args, "length", 0))),
      };
    default:
      throw new Error(`Unsupported function "${name}()"`);
  }
}

function period(value: PineValue | undefined): number {
  if (!value) return 1;
  return Math.max(1, Math.round(numberValue(value)));
}

function occurrence(value: PineValue | undefined): number {
  if (!value) return 0;
  return Math.max(0, Math.round(numberValue(value)));
}

function mapValue(value: PineValue | undefined, length: number, fn: (n: number) => number): PineValue {
  if (!value) return { kind: "number", value: Number.NaN };
  if (value.kind === "number") return { kind: "number", value: fn(value.value) };
  return {
    kind: "series",
    values: toSeries(value, length).map((v) => (isUsableNumber(v) ? fn(v) : null)),
  };
}

function reduceMath(
  values: PineValue[],
  length: number,
  fn: (...numbers: number[]) => number,
): PineValue {
  if (values.every((v) => v.kind === "number")) {
    return { kind: "number", value: fn(...values.map((v) => numberValue(v))) };
  }
  return {
    kind: "series",
    values: Array.from({ length }, (_, index) => {
      const point = values.map((v) => getAt(v, index, length));
      return point.every(isUsableNumber) ? fn(...point) : null;
    }),
  };
}

function naValue(value: PineValue | undefined, length: number): PineValue {
  if (!value) return { kind: "bool", value: true };
  if (value.kind === "number") {
    return { kind: "bool", value: !Number.isFinite(value.value) };
  }
  if (value.kind === "series") {
    return {
      kind: "series",
      values: value.values.map((point) => isUsableNumber(point) ? 0 : 1),
    };
  }
  if (value.kind === "colorSeries") {
    return {
      kind: "series",
      values: value.values.map((point) => point == null ? 1 : 0),
    };
  }
  return { kind: "bool", value: false };
}

function timeframeOpenTimeSeries(candles: Candle[], timeframe: string): PineValue {
  const days = aggregateTimeframeCandles(candles, timeframe);
  const values: SeriesData = Array.from({ length: candles.length }, () => null);
  for (const day of days) {
    for (let index = day.startIndex; index <= day.endIndex; index++) {
      values[index] = day.time;
    }
  }
  return { kind: "series", values };
}

function timeframeChangeSeries(candles: Candle[], timeframe: string): PineValue {
  const openTimes = toSeries(timeframeOpenTimeSeries(candles, timeframe), candles.length);
  return {
    kind: "series",
    values: openTimes.map((value, index) => {
      if (index === 0) return isUsableNumber(value) ? 1 : 0;
      const previous = openTimes[index - 1];
      return isUsableNumber(value) && isUsableNumber(previous) && value !== previous ? 1 : 0;
    }),
  };
}

function formatPineTextValue(
  value: PineValue | undefined,
  format: PineValue | undefined,
  index: number,
  context: EvalContext,
): string {
  if (!value) return "";
  if (value.kind === "string") return value.value;
  if (value.kind === "bool") return value.value ? "true" : "false";
  if (value.kind === "color") return value.value;
  const point = getAt(value, index, context.candles.length);
  if (!isUsableNumber(point)) return "-";
  const formatName = format?.kind === "string" ? format.value : "";
  if (formatName === "format.mintick") {
    return point.toFixed(inferPricePrecision(context.candles));
  }
  if (formatName === "#") return point.toFixed(0);
  if (formatName === "#.#") return point.toFixed(1);
  return Number.isInteger(point) ? String(point) : point.toFixed(2);
}

function formatPineDate(time: number | null): string {
  if (!isUsableNumber(time)) return "";
  return new Date(time * 1000).toISOString().slice(0, 10);
}

function nz(value: PineValue | undefined, replacement: PineValue | undefined, length: number): PineValue {
  const fallback = replacement ? getAt(replacement, 0, length) ?? 0 : 0;
  if (!value) return { kind: "number", value: fallback };
  if (value.kind === "number") return { kind: "number", value: Number.isFinite(value.value) ? value.value : fallback };
  return {
    kind: "series",
    values: toSeries(value, length).map((v, index) => {
      const localFallback = replacement ? getAt(replacement, index, length) : fallback;
      return isUsableNumber(v) ? v : localFallback ?? 0;
    }),
  };
}

function rollingAverage(values: SeriesData, length: number): SeriesData {
  return values.map((_, index) => {
    if (index < length - 1) return null;
    let sum = 0;
    for (let i = index - length + 1; i <= index; i++) {
      const point = values[i];
      if (!isUsableNumber(point)) return null;
      sum += point;
    }
    return sum / length;
  });
}

function exponentialAverage(values: SeriesData, length: number): SeriesData {
  const out: SeriesData = Array.from({ length: values.length }, () => null);
  const k = 2 / (length + 1);
  let prev: number | null = null;
  let seen = 0;

  values.forEach((value, index) => {
    if (!isUsableNumber(value)) return;
    seen += 1;
    prev = prev == null ? value : value * k + prev * (1 - k);
    if (seen >= length) out[index] = prev;
  });

  return out;
}

function runningMovingAverage(values: SeriesData, length: number): SeriesData {
  const out: SeriesData = Array.from({ length: values.length }, () => null);
  let prev: number | null = null;
  let seen = 0;

  values.forEach((value, index) => {
    if (!isUsableNumber(value)) return;
    seen += 1;
    prev = prev == null ? value : (prev * (length - 1) + value) / length;
    if (seen >= length) out[index] = prev;
  });

  return out;
}

function rsiSeries(values: SeriesData, length: number): SeriesData {
  const out: SeriesData = Array.from({ length: values.length }, () => null);
  if (values.length < length + 1) return out;

  let avgGain = 0;
  let avgLoss = 0;
  let seeded = false;

  for (let i = 1; i < values.length; i++) {
    const current = values[i];
    const previous = values[i - 1];
    if (!isUsableNumber(current) || !isUsableNumber(previous)) continue;
    const change = current - previous;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);

    if (!seeded) {
      avgGain += gain;
      avgLoss += loss;
      if (i === length) {
        avgGain /= length;
        avgLoss /= length;
        seeded = true;
      } else {
        continue;
      }
    } else {
      avgGain = (avgGain * (length - 1) + gain) / length;
      avgLoss = (avgLoss * (length - 1) + loss) / length;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  }

  return out;
}

function vwapSeries(candles: Candle[]): SeriesData {
  let currentDay = "";
  let cumulativePV = 0;
  let cumulativeVolume = 0;

  return candles.map((candle) => {
    const day = new Date(candle.time * 1000).toISOString().slice(0, 10);
    if (day !== currentDay) {
      currentDay = day;
      cumulativePV = 0;
      cumulativeVolume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    cumulativePV += typical * candle.volume;
    cumulativeVolume += candle.volume;
    return cumulativeVolume > 0 ? cumulativePV / cumulativeVolume : candle.close;
  });
}

function rollingExtreme(values: SeriesData, length: number, mode: "high" | "low"): SeriesData {
  return values.map((_, index) => {
    if (index < length - 1) return null;
    let result = mode === "high" ? -Infinity : Infinity;
    for (let i = index - length + 1; i <= index; i++) {
      const point = values[i];
      if (!isUsableNumber(point)) return null;
      result = mode === "high" ? Math.max(result, point) : Math.min(result, point);
    }
    return result;
  });
}

function rollingStandardDeviation(values: SeriesData, length: number): SeriesData {
  return values.map((_, index) => {
    if (index < length - 1) return null;
    const window = values.slice(index - length + 1, index + 1);
    if (!window.every(isUsableNumber)) return null;
    const mean = window.reduce((sum, point) => sum + point, 0) / length;
    const variance = window.reduce((sum, point) => sum + (point - mean) ** 2, 0) / length;
    return Math.sqrt(variance);
  });
}

function barssinceSeries(condition: PineValue, length: number): PineValue {
  const values: SeriesData = [];
  let lastTrue: number | null = null;
  for (let index = 0; index < length; index++) {
    if (truthyAt(condition, index, length)) {
      lastTrue = index;
      values.push(0);
      continue;
    }
    values.push(lastTrue == null ? null : index - lastTrue);
  }
  return { kind: "series", values };
}

function valuewhenSeries(
  condition: PineValue,
  source: PineValue,
  occurrenceIndex: number,
  length: number,
): PineValue {
  const values: SeriesData = [];
  const matches: number[] = [];
  for (let index = 0; index < length; index++) {
    if (truthyAt(condition, index, length)) matches.unshift(index);
    const sourceIndex = matches[occurrenceIndex];
    values.push(sourceIndex == null ? null : getAt(source, sourceIndex, length));
  }
  return { kind: "series", values };
}

function trendSeries(values: SeriesData, length: number, mode: "rising" | "falling"): PineValue {
  return {
    kind: "series",
    values: values.map((value, index) => {
      if (!isUsableNumber(value) || index < length) return 0;
      const lookback = values.slice(index - length, index);
      if (!lookback.every(isUsableNumber)) return 0;
      const ok =
        mode === "rising"
          ? lookback.every((point) => value > point)
          : lookback.every((point) => value < point);
      return ok ? 1 : 0;
    }),
  };
}

function changeSeries(values: SeriesData, length: number): SeriesData {
  return values.map((value, index) => {
    const previous = values[index - length];
    return isUsableNumber(value) && isUsableNumber(previous) ? value - previous : null;
  });
}

function crossSeries(
  left: SeriesData,
  right: SeriesData,
  mode: "over" | "under",
): PineValue {
  return {
    kind: "series",
    values: left.map((value, index) => {
      const previousLeft = left[index - 1];
      const previousRight = right[index - 1];
      const currentRight = right[index];
      if (
        !isUsableNumber(value) ||
        !isUsableNumber(currentRight) ||
        !isUsableNumber(previousLeft) ||
        !isUsableNumber(previousRight)
      ) {
        return 0;
      }
      const crossed =
        mode === "over"
          ? previousLeft <= previousRight && value > currentRight
          : previousLeft >= previousRight && value < currentRight;
      return crossed ? 1 : 0;
    }),
  };
}

function atrSeries(candles: Candle[], length: number): SeriesData {
  const trueRange = candles.map((candle, index) => {
    const previous = candles[index - 1];
    if (!previous) return candle.high - candle.low;
    return Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previous.close),
      Math.abs(candle.low - previous.close),
    );
  });
  return runningMovingAverage(trueRange, length);
}

function evaluateExpression(expression: string, context: EvalContext): PineValue {
  return new ExpressionParser(expression.trim(), context).parse();
}

function seriesToLinePoints(
  values: SeriesData,
  candles: Candle[],
  colors?: ColorSeriesData,
): LinePoint[] {
  const data: LinePoint[] = [];
  values.forEach((value, index) => {
    if (isUsableNumber(value) && candles[index]) {
      data.push({ time: candles[index].time, value, color: colors?.[index] ?? undefined });
    }
  });
  return data;
}

function seriesToLinePointSegments(
  values: SeriesData,
  candles: Candle[],
  colors?: ColorSeriesData,
): LinePoint[][] {
  const segments: LinePoint[][] = [];
  let current: LinePoint[] = [];

  values.forEach((value, index) => {
    if (isUsableNumber(value) && candles[index]) {
      current.push({ time: candles[index].time, value, color: colors?.[index] ?? undefined });
      return;
    }

    if (current.length > 0) {
      segments.push(current);
      current = [];
    }
  });

  if (current.length > 0) segments.push(current);
  return segments;
}

function resolveColor(expression: string | undefined, fallback: string): string {
  if (!expression) return fallback;
  const trimmed = expression.trim();
  const literal = unquote(trimmed);
  if (literal && /^#[0-9a-f]{6}$/i.test(literal)) return literal;
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  if (NAMED_COLORS[trimmed]) return NAMED_COLORS[trimmed];

  const colorNew = findCallBodies(trimmed, "color.new")[0];
  if (colorNew) {
    const args = parseCallArguments(colorNew);
    return resolveColor(args.positional[0], fallback);
  }

  return fallback;
}

function resolvePlotColor(
  expression: string | undefined,
  context: EvalContext,
  fallback: string,
): { color: string; colors?: ColorSeriesData } {
  if (!expression) return { color: fallback };
  try {
    const value = evaluateExpression(expression, context);
    if (value.kind === "color") return { color: value.value };
    if (value.kind === "colorSeries") {
      return { color: fallback, colors: value.values };
    }
  } catch {
    /* Fall back to literal color parsing below. */
  }
  return { color: resolveColor(expression, fallback) };
}

function plotType(style: string | undefined): "line" | "histogram" {
  if (!style) return "line";
  return /plot\.style_(columns|histogram)|style_(columns|histogram)/.test(style)
    ? "histogram"
    : "line";
}

function isLineBreakStyle(style: string | undefined): boolean {
  return /(^|\.|_)linebr$/.test(style?.trim() ?? "");
}

interface HLineDef {
  id: string;
  title: string;
  value: number;
  color: string;
  lineStyle: IndicatorLineStyle;
  lineWidth: IndicatorLineWidth;
}

function flatLinePoints(value: number, candles: Candle[]): LinePoint[] {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first) return [];
  if (!last || last.time === first.time) return [{ time: first.time, value }];
  const points: LinePoint[] = [
    { time: first.time, value },
    { time: last.time, value },
  ];
  const step = candleStepSeconds(candles);
  for (let offset = 1; offset <= FLAT_LINE_RIGHT_EXTENSION_BARS; offset++) {
    points.push({ time: last.time + step * offset, value });
  }
  return points;
}

function candleStepSeconds(candles: Candle[]): number {
  for (let index = candles.length - 1; index > 0; index--) {
    const step = candles[index].time - candles[index - 1].time;
    if (Number.isFinite(step) && step > 0) return step;
  }
  return 60;
}

interface DailyCandle {
  key: string;
  startIndex: number;
  endIndex: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function timeframeKey(time: number, timeframe: string): string {
  const normalized = timeframe.trim().toUpperCase();
  const date = new Date(time * 1000);
  const match = normalized.match(/^(\d+)?([SMHDW])?$/);
  if (normalized === "M" || /^\d+M$/.test(normalized)) {
    const months = Math.max(1, Number(normalized.replace("M", "")) || 1);
    const monthBucket = Math.floor(date.getUTCMonth() / months) * months;
    return `${date.getUTCFullYear()}-${monthBucket}`;
  }
  if (normalized === "D" || normalized.endsWith("D")) {
    const days = Math.max(1, Number(normalized.replace("D", "")) || 1);
    const bucket = Math.floor(time / (days * 86_400)) * days * 86_400;
    return `D-${bucket}`;
  }
  if (normalized === "W" || normalized.endsWith("W")) {
    const weeks = Math.max(1, Number(normalized.replace("W", "")) || 1);
    const bucket = Math.floor((time + 345_600) / (weeks * 604_800)) * weeks * 604_800;
    return `W-${bucket}`;
  }
  const seconds = timeframeSeconds(normalized) ?? candleStepSeconds([{ time } as Candle]);
  const bucket = Math.floor(time / seconds) * seconds;
  return `${seconds}-${bucket}`;
}

function timeframeSeconds(timeframe: string): number | null {
  const normalized = timeframe.trim().toUpperCase();
  if (/^\d+$/.test(normalized)) return Number(normalized) * 60;
  const match = normalized.match(/^(\d+)?([SMHDW])$/);
  if (!match) return null;
  const value = Math.max(1, Number(match[1]) || 1);
  switch (match[2]) {
    case "S": return value;
    case "H": return value * 3_600;
    case "D": return value * 86_400;
    case "W": return value * 604_800;
    default: return value * 60;
  }
}

function inferTimeframePeriod(candles: Candle[]): string {
  const step = candleStepSeconds(candles);
  if (step % 86_400 === 0) return `${step / 86_400}D`;
  if (step % 3_600 === 0) return String(step / 60);
  if (step % 60 === 0) return String(step / 60);
  return `${step}S`;
}

function aggregateTimeframeCandles(candles: Candle[], timeframe: string): DailyCandle[] {
  const days: DailyCandle[] = [];
  candles.forEach((candle, index) => {
    const key = timeframeKey(candle.time, timeframe);
    const current = days[days.length - 1];
    if (!current || current.key !== key) {
      days.push({
        key,
        startIndex: index,
        endIndex: index,
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
      });
      return;
    }
    current.endIndex = index;
    current.high = Math.max(current.high, candle.high);
    current.low = Math.min(current.low, candle.low);
    current.close = candle.close;
    current.volume += candle.volume;
  });
  return days;
}

function dailyCandlesForEvaluation(days: DailyCandle[]): Candle[] {
  return days.map((day) => ({
    time: day.time,
    open: day.open,
    high: day.high,
    low: day.low,
    close: day.close,
    volume: day.volume,
  }));
}

function expandDailyValueToCandles(
  value: PineValue,
  days: DailyCandle[],
  length: number,
): PineValue {
  if (!valueVaries(value)) return value;
  if (value.kind === "colorSeries") {
    const values: ColorSeriesData = Array.from({ length }, () => null);
    days.forEach((day, dayIndex) => {
      for (let index = day.startIndex; index <= day.endIndex; index++) {
        values[index] = value.values[dayIndex] ?? null;
      }
    });
    return { kind: "colorSeries", values };
  }

  const values: SeriesData = Array.from({ length }, () => null);
  const series = toSeries(value, days.length);
  days.forEach((day, dayIndex) => {
    for (let index = day.startIndex; index <= day.endIndex; index++) {
      values[index] = series[dayIndex] ?? null;
    }
  });
  return { kind: "series", values };
}

function evaluateAvailableHistoryDailySma(
  expression: string,
  dailyContext: EvalContext,
): PineValue | null {
  const match = expression.match(/^ta\.sma\s*\((.+),\s*(.+)\)\s*\[\s*1\s*\]$/);
  if (!match) return null;
  const source = toSeries(evaluateExpression(match[1], dailyContext), dailyContext.candles.length);
  const length = period(evaluateExpression(match[2], dailyContext));
  const values: SeriesData = source.map((_, index) => {
    const window = source
      .slice(Math.max(0, index - length), index)
      .filter(isUsableNumber);
    if (window.length === 0) return null;
    return window.reduce((sum, point) => sum + point, 0) / window.length;
  });
  return { kind: "series", values };
}

function evaluateRequestSecurityExpression(
  expression: string,
  context: EvalContext,
): PineValue | null {
  const trimmed = expression.trim();
  if (!/^request\.security\s*\(/.test(trimmed)) return null;
  const body = findCallBodies(trimmed, "request.security")[0];
  if (!body || trimmed !== `request.security(${body})`) return null;

  const args = parseCallArguments(body);
  const timeframe =
    unquote(args.positional[1]) ??
    (args.positional[1]
      ? stringValue(evaluateExpression(args.positional[1], context), context.candles.length - 1, context.candles.length)
      : null);
  const securityExpression = args.positional[2];
  if (!timeframe || !securityExpression) return null;

  const days = aggregateTimeframeCandles(context.candles, timeframe);
  const dailyContext: EvalContext = {
    candles: dailyCandlesForEvaluation(days),
    variables: new Map(context.variables),
    functions: context.functions,
  };
  const dailyValue =
    evaluateAvailableHistoryDailySma(securityExpression, dailyContext) ??
    evaluateExpression(securityExpression, dailyContext);
  return expandDailyValueToCandles(dailyValue, days, context.candles.length);
}

function evaluateInputExpression(expression: string, context: EvalContext): PineValue | null {
  const trimmed = expression.trim();
  const match = trimmed.match(/^(input(?:\.[A-Za-z_]+)?)\s*\(/);
  if (!match) return null;
  const body = findCallBodies(trimmed, match[1])[0];
  if (!body || trimmed !== `${match[1]}(${body})`) return null;
  const args = parseCallArguments(body);
  const defaultExpression = args.named.defval ?? args.positional[0];
  if (!defaultExpression) return { kind: "number", value: 0 };
  return evaluateExpression(defaultExpression, context);
}

function segmentFlatLinePoints(
  value: number,
  candles: Candle[],
  startIndex: number,
  endIndex: number,
  extendRight: boolean,
): LinePoint[] {
  const first = candles[startIndex];
  const last = candles[endIndex];
  if (!first || !last) return [];
  const points: LinePoint[] = [{ time: first.time, value }];
  if (last.time !== first.time) points.push({ time: last.time, value });
  if (extendRight) {
    const step = candleStepSeconds(candles);
    for (let offset = 1; offset <= OBJECT_RIGHT_EXTENSION_BARS; offset++) {
      points.push({ time: last.time + step * offset, value });
    }
  }
  return points;
}

function inferPricePrecision(candles: Candle[]): number {
  let precision = 0;
  for (const candle of candles.slice(-100)) {
    for (const value of [candle.open, candle.high, candle.low, candle.close]) {
      const [, decimals = ""] = String(value).split(".");
      precision = Math.max(precision, decimals.length);
    }
  }
  return Math.max(0, Math.min(5, precision));
}

function inferMintick(candles: Candle[]): number {
  return 1 / 10 ** inferPricePrecision(candles);
}

interface PineObjectCall {
  line: PineSourceLine;
  variable: string;
  args: ReturnType<typeof parseCallArguments>;
  condition: string | null;
}

function objectAssignmentRegex(apiName: string): RegExp {
  const escaped = apiName.replace(".", "\\.");
  return new RegExp(
    `^(?:(?:(?:var|varip|const|simple|series)\\s+)*(?:line|label|box|table)\\s+)?([A-Za-z_][A-Za-z0-9_]*)\\s*(?::=|=)\\s*${escaped}\\s*\\(`,
  );
}

function objectCreationCalls(lines: PineSourceLine[], apiName: string): PineObjectCall[] {
  const regex = objectAssignmentRegex(apiName);
  return lines.flatMap((line, index) => {
    const match = line.text.match(regex);
    const body = findCallBodies(line.text, apiName)[0];
    if (!match || !body) return [];
    return [{
      line,
      variable: match[1],
      args: parseCallArguments(body),
      condition: enclosingIfCondition(lines, index),
    }];
  });
}

function enclosingIfCondition(lines: PineSourceLine[], index: number): string | null {
  const current = lines[index];
  for (let cursor = index - 1; cursor >= 0; cursor--) {
    const candidate = lines[cursor];
    if (!candidate.text || candidate.indent >= current.indent) continue;
    if (/^if\b/.test(candidate.text)) {
      return candidate.text.replace(/^if\b/, "").trim();
    }
    if (candidate.indent === 0) break;
  }
  return null;
}

function conditionIndices(
  condition: string | null,
  context: EvalContext,
  errors: string[],
  lineNumber: number,
): number[] {
  if (!condition) return [0];
  try {
    const value = evaluateExpression(condition, context);
    return context.candles.flatMap((_, index) =>
      truthyAt(value, index, context.candles.length) ? [index] : [],
    );
  } catch (error) {
    errors.push(`Line ${lineNumber}: ${(error as Error).message}`);
    return [];
  }
}

function rawArg(
  args: ReturnType<typeof parseCallArguments>,
  name: string,
  index: number,
): string | undefined {
  return args.named[name] ?? args.positional[index];
}

function objectSetterExpression(
  lines: PineSourceLine[],
  apiName: string,
  variable: string,
  method: string,
  argIndex: number,
): string | undefined {
  const callName = `${apiName}.set_${method}`;
  for (const line of lines) {
    if (!line.text.startsWith(`${callName}(`)) continue;
    const body = findCallBodies(line.text, callName)[0];
    if (!body) continue;
    const args = parseCallArguments(body);
    if (args.positional[0]?.trim() === variable) {
      return args.positional[argIndex];
    }
  }
  return undefined;
}

function numberExpressionAt(
  expression: string | undefined,
  index: number,
  context: EvalContext,
): number | null {
  if (!expression) return null;
  try {
    const value = evaluateExpression(expression, context);
    return getAt(value, index, context.candles.length);
  } catch {
    return null;
  }
}

function colorExpressionAt(
  expression: string | undefined,
  index: number,
  context: EvalContext,
  fallback: string,
): string {
  if (!expression) return fallback;
  try {
    const value = evaluateExpression(expression, context);
    return colorAt(value, index) ?? fallback;
  } catch {
    return resolveColor(expression, fallback);
  }
}

function textExpressionAt(
  expression: string | undefined,
  index: number,
  context: EvalContext,
): string {
  if (!expression) return "";
  try {
    const scalarContext = scalarContextAt(context, index);
    return stringValue(evaluateExpression(expression, scalarContext), 0, 1);
  } catch {
    return unquote(expression) ?? "";
  }
}

function objectLineWidth(
  expression: string | undefined,
  index: number,
  context: EvalContext,
): IndicatorLineWidth {
  const value = numberExpressionAt(expression, index, context);
  if (!isUsableNumber(value)) return 2;
  return Math.max(1, Math.min(4, Math.round(value))) as IndicatorLineWidth;
}

function enumExpression(expression: string | undefined, fallback: string): string {
  return unquote(expression) ?? expression?.trim() ?? fallback;
}

function barIndexToTime(index: number, candles: Candle[]): number | null {
  const first = candles[0];
  const last = candles.at(-1);
  if (!first || !last) return null;
  const rounded = Math.round(index);
  if (candles[rounded]) return candles[rounded].time;
  const step = candleStepSeconds(candles);
  if (rounded < 0) return first.time + rounded * step;
  return last.time + (rounded - (candles.length - 1)) * step;
}

function objectXTime(
  expression: string | undefined,
  evalIndex: number,
  context: EvalContext,
  xloc: string,
): number | null {
  const value = numberExpressionAt(expression, evalIndex, context);
  if (!isUsableNumber(value)) return null;
  if (xloc === "xloc.bar_time") {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : value;
  }
  return barIndexToTime(value, context.candles);
}

function objectLinePointsFromCoords(
  args: {
    x1Expression: string | undefined;
    y1Expression: string | undefined;
    x2Expression: string | undefined;
    y2Expression: string | undefined;
    x1Index: number;
    y1Index: number;
    x2Index: number;
    y2Index: number;
    extendRight: boolean;
    xloc: string;
    color?: string;
  },
  context: EvalContext,
): LinePoint[] {
  const x1 = objectXTime(args.x1Expression, args.x1Index, context, args.xloc);
  const x2 = objectXTime(args.x2Expression, args.x2Index, context, args.xloc);
  const y1 = numberExpressionAt(args.y1Expression, args.y1Index, context);
  const y2 = numberExpressionAt(args.y2Expression, args.y2Index, context);
  if (!isUsableNumber(x1) || !isUsableNumber(x2) || !isUsableNumber(y1) || !isUsableNumber(y2)) {
    return [];
  }
  const points: LinePoint[] = [{ time: x1, value: y1, color: args.color }];
  if (x2 !== x1 || y2 !== y1) points.push({ time: x2, value: y2, color: args.color });
  if (args.extendRight) {
    const step = candleStepSeconds(context.candles);
    for (let offset = 1; offset <= OBJECT_RIGHT_EXTENSION_BARS; offset++) {
      points.push({ time: x2 + step * offset, value: y2, color: args.color });
    }
  }
  return points;
}

function objectBoxFillPointsFromCoords(
  args: {
    leftExpression: string | undefined;
    topExpression: string | undefined;
    rightExpression: string | undefined;
    leftIndex: number;
    topIndex: number;
    rightIndex: number;
    extendRight: boolean;
    xloc: string;
  },
  context: EvalContext,
): LinePoint[] {
  const left = objectXTime(args.leftExpression, args.leftIndex, context, args.xloc);
  const right = objectXTime(args.rightExpression, args.rightIndex, context, args.xloc);
  const top = numberExpressionAt(args.topExpression, args.topIndex, context);
  if (!isUsableNumber(left) || !isUsableNumber(right) || !isUsableNumber(top)) return [];
  const points: LinePoint[] = [{ time: left, value: top }];
  if (right !== left) points.push({ time: right, value: top });
  if (args.extendRight) {
    const step = candleStepSeconds(context.candles);
    for (let offset = 1; offset <= OBJECT_RIGHT_EXTENSION_BARS; offset++) {
      points.push({ time: right + step * offset, value: top });
    }
  }
  return points;
}

function segmentEndTime(candles: Candle[], endIndex: number, extendRight: boolean): number | undefined {
  const last = candles[endIndex];
  if (!last) return undefined;
  if (!extendRight) return last.time;
  return last.time + candleStepSeconds(candles) * OBJECT_RIGHT_EXTENSION_BARS;
}

function compilePineObjectRuntime(
  cleaned: string,
  candles: Candle[],
  indicatorId: string,
  context: EvalContext,
  errors: string[],
): IndicatorResult | null {
  if (!/(?:line|box|label|table)\.(?:new|set_|cell)\s*\(/.test(cleaned)) return null;
  const lines = sourceLines(cleaned);
  const series: IndicatorSeries[] = [];
  const labels: NonNullable<IndicatorResult["labels"]> = [];
  let dashboard: IndicatorResult["dashboard"];

  for (const call of objectCreationCalls(lines, "box.new")) {
    const starts = conditionIndices(call.condition, context, errors, call.line.number);
    const leftExpression =
      objectSetterExpression(lines, "box", call.variable, "left", 1) ??
      rawArg(call.args, "left", 0);
    const rightExpression =
      objectSetterExpression(lines, "box", call.variable, "right", 1) ??
      rawArg(call.args, "right", 2);
    const topExpression =
      objectSetterExpression(lines, "box", call.variable, "top", 1) ??
      rawArg(call.args, "top", 1);
    const bottomExpression =
      objectSetterExpression(lines, "box", call.variable, "bottom", 1) ??
      rawArg(call.args, "bottom", 3);
    const colorExpression =
      objectSetterExpression(lines, "box", call.variable, "bgcolor", 1) ??
      rawArg(call.args, "bgcolor", 9);
    const xloc = enumExpression(rawArg(call.args, "xloc", 8), "xloc.bar_index");
    const extendExpression =
      objectSetterExpression(lines, "box", call.variable, "extend", 1) ??
      rawArg(call.args, "extend", 7);
    if (!leftExpression || !rightExpression || !topExpression || !bottomExpression) continue;

    starts.forEach((startIndex, segmentIndex) => {
      const endIndex = starts[segmentIndex + 1] ? starts[segmentIndex + 1] - 1 : candles.length - 1;
      const extendRight =
        segmentIndex === starts.length - 1 ||
        enumExpression(extendExpression, "extend.none") === "extend.right";
      const rightUsesSetter = !!objectSetterExpression(lines, "box", call.variable, "right", 1);
      const topUsesSetter = !!objectSetterExpression(lines, "box", call.variable, "top", 1);
      const bottomUsesSetter = !!objectSetterExpression(lines, "box", call.variable, "bottom", 1);
      const baseValue = numberExpressionAt(
        bottomExpression,
        bottomUsesSetter ? endIndex : startIndex,
        context,
      );
      if (!isUsableNumber(baseValue)) return;
      const color = colorExpressionAt(colorExpression, endIndex, context, DEFAULT_COLORS[series.length % DEFAULT_COLORS.length]);
      const data = objectBoxFillPointsFromCoords(
        {
          leftExpression,
          topExpression,
          rightExpression,
          leftIndex: startIndex,
          topIndex: topUsesSetter ? endIndex : startIndex,
          rightIndex: rightUsesSetter ? endIndex : startIndex,
          extendRight,
          xloc,
        },
        context,
      );
      if (data.length === 0) return;
      series.push({
        key: `${call.variable}_${segmentIndex + 1}`,
        color,
        type: "baselineFill",
        baseValue,
        lineVisible: false,
        lastValueVisible: false,
        data,
      });
    });
  }

  for (const call of objectCreationCalls(lines, "line.new")) {
    const starts = conditionIndices(call.condition, context, errors, call.line.number);
    const x1Setter = objectSetterExpression(lines, "line", call.variable, "x1", 1);
    const x2Setter = objectSetterExpression(lines, "line", call.variable, "x2", 1);
    const y1Setter = objectSetterExpression(lines, "line", call.variable, "y1", 1);
    const y2Setter = objectSetterExpression(lines, "line", call.variable, "y2", 1);
    const x1Expression = x1Setter ?? rawArg(call.args, "x1", 0);
    const x2Expression = x2Setter ?? rawArg(call.args, "x2", 2);
    const y1Expression = y1Setter ?? rawArg(call.args, "y1", 1);
    const y2Expression = y2Setter ?? rawArg(call.args, "y2", 3);
    const xloc = enumExpression(rawArg(call.args, "xloc", 4), "xloc.bar_index");
    const extendExpression =
      objectSetterExpression(lines, "line", call.variable, "extend", 1) ??
      rawArg(call.args, "extend", 5);
    if (!x1Expression || !x2Expression || !y1Expression || !y2Expression) continue;

    starts.forEach((startIndex, segmentIndex) => {
      const endIndex = starts[segmentIndex + 1] ? starts[segmentIndex + 1] - 1 : candles.length - 1;
      const extendRight =
        segmentIndex === starts.length - 1 ||
        enumExpression(extendExpression, "extend.none") === "extend.right";
      const colorExpression =
        objectSetterExpression(lines, "line", call.variable, "color", 1) ??
        rawArg(call.args, "color", 6);
      const color = colorExpressionAt(colorExpression, endIndex, context, DEFAULT_COLORS[series.length % DEFAULT_COLORS.length]);
      const data = objectLinePointsFromCoords(
        {
          x1Expression,
          y1Expression,
          x2Expression,
          y2Expression,
          x1Index: x1Setter ? endIndex : startIndex,
          y1Index: y1Setter ? endIndex : startIndex,
          x2Index: x2Setter ? endIndex : startIndex,
          y2Index: y2Setter ? endIndex : startIndex,
          extendRight,
          xloc,
          color,
        },
        context,
      );
      if (data.length === 0) return;
      series.push({
        key: `${call.variable}_${segmentIndex + 1}`,
        color,
        data,
        type: "line",
        lineWidth: objectLineWidth(
          objectSetterExpression(lines, "line", call.variable, "width", 1) ??
            rawArg(call.args, "width", 8),
          endIndex,
          context,
        ),
        lineStyle: lineStyle(rawArg(call.args, "style", 7)),
        lastValueVisible: false,
      });
    });
  }

  for (const call of objectCreationCalls(lines, "label.new")) {
    const starts = conditionIndices(call.condition, context, errors, call.line.number);
    const xyXSetter = objectSetterExpression(lines, "label", call.variable, "xy", 1);
    const xyYSetter = objectSetterExpression(lines, "label", call.variable, "xy", 2);
    const xExpression = xyXSetter ?? rawArg(call.args, "x", 0);
    const yExpression =
      xyYSetter ??
      rawArg(call.args, "y", 1);
    const textExpression =
      objectSetterExpression(lines, "label", call.variable, "text", 1) ??
      rawArg(call.args, "text", 2);
    const colorExpression =
      objectSetterExpression(lines, "label", call.variable, "textcolor", 1) ??
      rawArg(call.args, "textcolor", 7);
    const xloc = enumExpression(rawArg(call.args, "xloc", 3), "xloc.bar_index");
    if (!yExpression) continue;

    starts.forEach((startIndex, segmentIndex) => {
      const endIndex = starts[segmentIndex + 1] ? starts[segmentIndex + 1] - 1 : candles.length - 1;
      const extendRight = segmentIndex === starts.length - 1;
      const labelIndex = xyYSetter ? endIndex : startIndex;
      const price = numberExpressionAt(yExpression, labelIndex, context);
      if (!isUsableNumber(price)) return;
      const text = textExpressionAt(textExpression, endIndex, context);
      if (!text.trim()) return;
      const time =
        objectXTime(xExpression, xyXSetter ? endIndex : startIndex, context, xloc) ??
        segmentEndTime(candles, endIndex, extendRight);
      labels.push({
        key: `${call.variable}_${segmentIndex + 1}`,
        price,
        text,
        color: colorExpressionAt(colorExpression, endIndex, context, DEFAULT_COLORS[labels.length % DEFAULT_COLORS.length]),
        time,
      });
    });
  }

  const tableCall = objectCreationCalls(lines, "table.new")[0];
  if (tableCall) {
    const lastIndex = candles.length - 1;
    const cells = new Map<number, Map<number, { text: string; color?: string }>>();
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (!line.text.startsWith("table.cell(")) continue;
      const condition = enclosingIfCondition(lines, lineIndex);
      if (condition) {
        try {
          if (!truthyAt(evaluateExpression(condition, context), lastIndex, context.candles.length)) {
            continue;
          }
        } catch (error) {
          errors.push(`Line ${line.number}: ${(error as Error).message}`);
          continue;
        }
      }
      const body = findCallBodies(line.text, "table.cell")[0];
      if (!body) continue;
      const args = parseCallArguments(body);
      if (args.positional[0]?.trim() !== tableCall.variable) continue;
      const col = numberExpressionAt(args.positional[1], lastIndex, context);
      const row = numberExpressionAt(args.positional[2], lastIndex, context);
      if (!isUsableNumber(col) || !isUsableNumber(row)) continue;
      const text = textExpressionAt(args.positional[3], lastIndex, context);
      const color = colorExpressionAt(args.named.text_color, lastIndex, context, "#ffffff");
      const rowMap = cells.get(row) ?? new Map<number, { text: string; color?: string }>();
      rowMap.set(col, { text, color });
      cells.set(row, rowMap);
    }
    const title = cells.get(0)?.get(0)?.text ?? "";
    const rows = [...cells.entries()]
      .filter(([row]) => row > 0)
      .sort(([a], [b]) => a - b)
      .flatMap(([_, row]) => {
        const label = row.get(0)?.text ?? "";
        const value = row.get(1)?.text ?? "";
        if (!label && !value) return [];
        return [{ label, value, valueColor: row.get(1)?.color }];
      });
    if (title || rows.length > 0) {
      dashboard = {
        key: `${tableCall.variable}_dashboard`,
        title,
        subtitle: cells.get(0)?.get(1)?.text,
        rows,
      };
    }
  }

  if (series.length === 0 && labels.length === 0 && !dashboard) return null;

  return {
    id: indicatorId,
    series,
    labels,
    dashboard,
  };
}

function hlineVariableName(line: string): string | null {
  return line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*hline\s*\(/)?.[1] ?? null;
}

function readHlines(
  cleaned: string,
  context: EvalContext,
  errors: string[],
): HLineDef[] {
  const out: HLineDef[] = [];
  for (const line of sourceLines(cleaned)) {
    if (!line.text || !/(^|=\s*)hline\s*\(/.test(line.text)) continue;
    const body = findCallBodies(line.text, "hline")[0];
    if (!body) continue;
    const args = parseCallArguments(body);
    const valueExpression = args.positional[0];
    if (!valueExpression) {
      errors.push(`Line ${line.number}: hline() missing price`);
      continue;
    }

    try {
      const id = hlineVariableName(line.text) ?? `hline_${out.length + 1}`;
      const value = numberValue(evaluateExpression(valueExpression, context));
      const plotColor = resolvePlotColor(
        args.named.color ?? args.positional[2],
        context,
        DEFAULT_COLORS[out.length % DEFAULT_COLORS.length],
      );
      out.push({
        id,
        title: unquote(args.named.title) ?? unquote(args.positional[1]) ?? id,
        value,
        color: plotColor.color,
        lineStyle: lineStyle(args.named.linestyle ?? args.positional[3]),
        lineWidth: lineWidth(args.named.linewidth ?? args.positional[4], 1),
      });
    } catch (error) {
      errors.push(`Line ${line.number}: ${(error as Error).message}`);
    }
  }
  return out;
}

function readFills(
  cleaned: string,
  context: EvalContext,
  hlines: HLineDef[],
  candles: Candle[],
  errors: string[],
): IndicatorSeries[] {
  const byId = new Map(hlines.map((line) => [line.id, line]));
  const out: IndicatorSeries[] = [];

  for (const line of sourceLines(cleaned)) {
    if (!/^fill\s*\(/.test(line.text)) continue;
    const body = findCallBodies(line.text, "fill")[0];
    if (!body) continue;
    const args = parseCallArguments(body);
    const first = byId.get(args.positional[0]?.trim());
    const second = byId.get(args.positional[1]?.trim());
    if (!first || !second) {
      errors.push(`Line ${line.number}: fill() currently supports hline variables only`);
      continue;
    }

    const low = Math.min(first.value, second.value);
    const high = Math.max(first.value, second.value);
    const transparency = parseNumberLiteral(args.named.transp ?? args.positional[3]);
    const plotColor = resolvePlotColor(
      args.named.color ?? args.positional[2],
      context,
      "#e040fb",
    );
    const fillColor = applyTransparencyToColors(plotColor.color, undefined, transparency).color;
    out.push({
      key: unquote(args.named.title) ?? unquote(args.positional[4]) ?? `fill_${out.length + 1}`,
      color: fillColor,
      type: "baselineFill",
      baseValue: low,
      lineVisible: false,
      lastValueVisible: false,
      data: flatLinePoints(high, candles),
    });
  }

  return out;
}

function evaluateRecursiveAssignment(
  name: string,
  expression: string,
  context: EvalContext,
): PineValue | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prev = `nz\\(\\s*${escaped}\\[1\\]\\s*\\)`;
  const rmaMatch = expression.match(
    new RegExp(`^${prev}\\s*\\+\\s*\\((.+?)\\s*-\\s*${prev}\\)\\s*/\\s*(.+)$`),
  );
  if (!rmaMatch) return null;

  const source = toSeries(evaluateExpression(rmaMatch[1], context), context.candles.length);
  const length = Math.max(1, numberValue(evaluateExpression(rmaMatch[2], context)));
  const values: SeriesData = [];
  let previous = 0;
  for (const value of source) {
    if (!isUsableNumber(value)) {
      values.push(null);
      continue;
    }
    previous = previous + (value - previous) / length;
    values.push(previous);
  }
  return { kind: "series", values };
}

interface PineSourceLine {
  number: number;
  indent: number;
  text: string;
}

function sourceLines(cleaned: string): PineSourceLine[] {
  return cleaned.split("\n").map((raw, index) => ({
    number: index + 1,
    indent: raw.match(/^[ \t]*/)?.[0].replace(/\t/g, "    ").length ?? 0,
    text: raw.trim().replace(/;$/, ""),
  }));
}

function assignmentMatch(text: string): RegExpMatchArray | null {
  return text.match(/^(?:(?:export\s+)?(?:(?:var|varip|const|simple|series)\s+)*(?:float|int|bool|color|string|line|label|box|table)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(:=|=)\s*(.+)$/);
}

function compoundAssignmentMatch(text: string): RegExpMatchArray | null {
  return text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*([+\-*/])=\s*(.+)$/);
}

function isDeclarationExpression(expression: string): boolean {
  return /^(plot|hline|fill|alertcondition|line\.new|box\.new|label\.new|table\.new|line\.set_|box\.set_|label\.set_|table\.cell)\s*\(/.test(expression.trim());
}

function functionDefinitionMatch(text: string): RegExpMatchArray | null {
  return text.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)\)\s*=>\s*(.+)$/);
}

function functionParameterNames(rawParams: string): string[] {
  return splitTopLevel(rawParams)
    .map((param) => param.trim().replace(/^(?:float|int|bool|color|string|series|simple)\s+/, ""))
    .filter((param) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(param));
}

function parsePineIfExpression(
  lines: PineSourceLine[],
  startIndex: number,
  indent: number,
  firstText: string,
): { expression: string; endIndex: number } {
  const condition = firstText.replace(/^if\b/, "").trim();
  const whenTrue = parsePineIfBranch(lines, startIndex + 1, indent);
  const elseLine = lines[whenTrue.endIndex];
  if (!elseLine || elseLine.indent !== indent || elseLine.text !== "else") {
    throw new Error("Pine if-expression missing else branch");
  }
  const whenFalse = parsePineIfBranch(lines, whenTrue.endIndex + 1, indent);
  return {
    expression: `(${condition}) ? (${whenTrue.expression}) : (${whenFalse.expression})`,
    endIndex: whenFalse.endIndex,
  };
}

function parsePineIfBranch(
  lines: PineSourceLine[],
  startIndex: number,
  parentIndent: number,
): { expression: string; endIndex: number } {
  let index = startIndex;
  while (index < lines.length && !lines[index].text) index += 1;
  const first = lines[index];
  if (!first || first.indent <= parentIndent) {
    throw new Error("Pine if-expression branch is empty");
  }

  const branchIndent = first.indent;
  const locals = new Map<string, string>();
  let expression = "na";

  while (index < lines.length) {
    const line = lines[index];
    if (!line.text) {
      index += 1;
      continue;
    }
    if (line.indent < branchIndent) break;
    if (line.indent === parentIndent && line.text === "else") break;
    if (line.indent > branchIndent) {
      index += 1;
      continue;
    }

    const match = assignmentMatch(line.text);
    if (match) {
      let value = match[3].trim();
      if (/^if\b/.test(value)) {
        const parsed = parsePineIfExpression(lines, index, line.indent, value);
        value = parsed.expression;
        index = parsed.endIndex;
      } else {
        index += 1;
      }
      locals.set(match[1], value);
      expression = value;
      continue;
    }

    if (/^if\b/.test(line.text)) {
      const parsed = parsePineIfExpression(lines, index, line.indent, line.text);
      expression = parsed.expression;
      index = parsed.endIndex;
      continue;
    }

    expression = locals.get(line.text) ?? line.text;
    index += 1;
  }

  return { expression, endIndex: index };
}

function evaluateSelfReferentialAssignment(
  name: string,
  expression: string,
  context: EvalContext,
): PineValue | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const historyRefs = [...expression.matchAll(new RegExp(`\\b${escaped}\\s*\\[\\s*(\\d+)\\s*\\]`, "g"))];
  if (historyRefs.length === 0) {
    return null;
  }

  const offsets = [...new Set(historyRefs.map((match) => Math.max(0, Number(match[1]))))];
  let scalarExpression = expression;
  for (const offset of offsets) {
    scalarExpression = scalarExpression.replace(
      new RegExp(`\\b${escaped}\\s*\\[\\s*${offset}\\s*\\]`, "g"),
      `__${name}_${offset}`,
    );
  }

  const values: SeriesData = [];
  for (let index = 0; index < context.candles.length; index++) {
    const candle = context.candles[index];
    if (!candle) {
      values.push(null);
      continue;
    }
    const recursiveContext: EvalContext = {
      candles: [candle],
      variables: new Map(
        [...context.variables.entries()].map(([key, value]) => [
          key,
          scalarValueAt(value, index, context.candles.length),
        ]),
      ),
      functions: context.functions,
    };
    recursiveContext.variables.set(name, scalarValueAt({ kind: "series", values }, index, context.candles.length));
    for (const offset of offsets) {
      recursiveContext.variables.set(
        `__${name}_${offset}`,
        { kind: "number", value: values[index - offset] ?? Number.NaN },
      );
    }
    const evaluated = evaluateExpression(scalarExpression, recursiveContext);
    const point =
      evaluated.kind === "number"
        ? evaluated.value
        : evaluated.kind === "bool"
          ? evaluated.value ? 1 : 0
          : getAt(evaluated, 0, 1);
    values.push(isUsableNumber(point) ? point : null);
  }
  return { kind: "series", values };
}

function scalarValueAt(value: PineValue, index: number, length: number): PineValue {
  if (value.kind === "series") {
    return { kind: "number", value: getAt(value, index, length) ?? Number.NaN };
  }
  if (value.kind === "colorSeries") {
    const color = colorAt(value, index);
    return color ? { kind: "color", value: color } : { kind: "number", value: Number.NaN };
  }
  return value;
}

function scalarContextAt(context: EvalContext, index: number): EvalContext {
  return {
    candles: context.candles[index] ? [context.candles[index]] : [],
    variables: new Map(
      [...context.variables.entries()].map(([key, value]) => [
        key,
        scalarValueAt(value, index, context.candles.length),
      ]),
    ),
    functions: context.functions,
  };
}

function readAssignments(cleaned: string, context: EvalContext, errors: string[]) {
  const lines = sourceLines(cleaned);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].text;
    if (!line) continue;
    if (/^\/\/?@version/.test(line)) continue;
    if (/^(indicator|study|strategy|plot|hline|fill|alertcondition)\s*\(/.test(line)) continue;

    const functionMatch = functionDefinitionMatch(line);
    if (functionMatch) {
      context.functions.set(functionMatch[1], {
        params: functionParameterNames(functionMatch[2]),
        expression: functionMatch[3].trim(),
      });
      continue;
    }

    const compoundMatch = compoundAssignmentMatch(line);
    const match = compoundMatch ?? assignmentMatch(line);
    if (!match) continue;
    const name = match[1];
    const expressionIndex = compoundMatch ? 3 : 3;
    if (isDeclarationExpression(match[expressionIndex])) continue;

    let expression = compoundMatch
      ? `${name} ${compoundMatch[2]} (${compoundMatch[3].trim()})`
      : match[3].trim();
    try {
      if (/^if\b/.test(expression)) {
        const parsed = parsePineIfExpression(lines, index, lines[index].indent, expression);
        expression = parsed.expression;
        index = parsed.endIndex - 1;
      }
      context.variables.set(
        name,
        evaluateInputExpression(expression, context) ??
        evaluateRecursiveAssignment(name, expression, context) ??
          evaluateSelfReferentialAssignment(name, expression, context) ??
          evaluateRequestSecurityExpression(expression, context) ??
          evaluateExpression(expression, context),
      );
    } catch (error) {
      errors.push(`Line ${lines[index].number}: ${(error as Error).message}`);
    }
  }
}

export function compilePineScript(
  sourceCode: string,
  candles: Candle[],
  indicatorId = "custom",
): PineCompilation {
  const cleaned = normalizedSource(sourceCode);
  const meta = extractPineScriptMeta(cleaned);
  const errors: string[] = [];
  const context: EvalContext = { candles, variables: new Map(), functions: new Map() };

  readAssignments(cleaned, context, errors);
  const objectResult = compilePineObjectRuntime(cleaned, candles, indicatorId, context, errors);

  const hlines = readHlines(cleaned, context, errors);
  const fillSeries = readFills(cleaned, context, hlines, candles, errors);
  const hlineSeries: IndicatorSeries[] = hlines.map((line) => ({
    key: line.title,
    color: line.color,
    data: flatLinePoints(line.value, candles),
    type: "line",
    lineWidth: line.lineWidth,
    lineStyle: line.lineStyle,
  }));

  const plotSeries = findCallBodies(cleaned, "plot").flatMap<IndicatorSeries>((body, index) => {
    const args = parseCallArguments(body);
    const expression = args.positional[0];
    if (!expression) {
      errors.push(`plot() #${index + 1}: missing series expression`);
      return [];
    }

    try {
      const value = evaluateExpression(expression, context);
      const title =
        unquote(args.named.title) ??
        unquote(args.positional[1]) ??
        `plot_${index + 1}`;
      const plotColor = resolvePlotColor(
        args.named.color ?? args.positional[2],
        context,
        DEFAULT_COLORS[index % DEFAULT_COLORS.length],
      );
      const transparentPlotColor = applyTransparencyToColors(
        plotColor.color,
        plotColor.colors,
        parseNumberLiteral(args.named.transp),
      );
      const type = plotType(args.named.style);
      const values = toSeries(value, candles.length);
      const baseSeries = {
        key: title,
        color: transparentPlotColor.color,
        type,
        lineWidth: lineWidth(args.named.linewidth ?? args.positional[3], 2),
        lineStyle: lineStyle(args.named.linestyle),
      } satisfies Omit<IndicatorSeries, "data">;

      if (type === "line" && isLineBreakStyle(args.named.style)) {
        return seriesToLinePointSegments(values, candles, transparentPlotColor.colors).map(
          (data, segmentIndex) => ({
            ...baseSeries,
            key: segmentIndex === 0 ? title : `${title}_${segmentIndex + 1}`,
            data,
          }),
        );
      }

      return [{
        ...baseSeries,
        data: seriesToLinePoints(values, candles, transparentPlotColor.colors),
      }];
    } catch (error) {
      errors.push(`plot() #${index + 1}: ${(error as Error).message}`);
      return [];
    }
  });

  const series = [
    ...(objectResult?.series ?? []),
    ...fillSeries,
    ...hlineSeries,
    ...plotSeries,
  ];

  if (
    series.length === 0 &&
    !(objectResult?.labels?.length) &&
    !objectResult?.dashboard &&
    errors.length === 0
  ) {
    errors.push("No plot() calls found");
  }

  return {
    meta,
    result: {
      id: indicatorId,
      series,
      labels: objectResult?.labels,
      dashboard: objectResult?.dashboard,
    },
    errors,
  };
}

export function computeCustomIndicator(
  cfg: { id: string; sourceCode?: string },
  candles: Candle[],
): IndicatorResult {
  if (!cfg.sourceCode?.trim()) return { id: cfg.id, series: [] };
  return compilePineScript(cfg.sourceCode, candles, cfg.id).result;
}
