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
    name.startsWith("format.")
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
  switch (name) {
    case "input":
    case "input.int":
    case "input.float":
    case "input.source":
    case "input.bool":
      return namedCallArg(args, "defval") ?? callArg(args, 0) ?? { kind: "number", value: 0 };
    case "color": {
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
    case "nz":
      return nz(callArg(args, 0), callArg(args, 1), context.candles.length);
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

function changeSeries(values: SeriesData, length: number): SeriesData {
  return values.map((value, index) => {
    const previous = values[index - length];
    return isUsableNumber(value) && isUsableNumber(previous) ? value - previous : null;
  });
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
  return [
    { time: first.time, value },
    { time: last.time, value },
  ];
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
  return text.match(/^(?:(?:float|int|bool|color|string)\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(:=|=)\s*(.+)$/);
}

function isDeclarationExpression(expression: string): boolean {
  return /^(plot|hline|fill|alertcondition)\s*\(/.test(expression.trim());
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

function readAssignments(cleaned: string, context: EvalContext, errors: string[]) {
  const lines = sourceLines(cleaned);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].text;
    if (!line) continue;
    if (/^\/\/?@version/.test(line)) continue;
    if (/^(indicator|study|strategy|plot|hline|fill|alertcondition)\s*\(/.test(line)) continue;

    const match = assignmentMatch(line);
    if (!match) continue;
    if (isDeclarationExpression(match[3])) continue;

    let expression = match[3].trim();
    try {
      if (/^if\b/.test(expression)) {
        const parsed = parsePineIfExpression(lines, index, lines[index].indent, expression);
        expression = parsed.expression;
        index = parsed.endIndex - 1;
      }
      context.variables.set(
        match[1],
        evaluateRecursiveAssignment(match[1], expression, context) ??
          evaluateSelfReferentialAssignment(match[1], expression, context) ??
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
  const context: EvalContext = { candles, variables: new Map() };

  readAssignments(cleaned, context, errors);

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

  const series = [...fillSeries, ...hlineSeries, ...plotSeries];

  if (series.length === 0 && errors.length === 0) {
    errors.push("No plot() calls found");
  }

  return {
    meta,
    result: { id: indicatorId, series },
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
