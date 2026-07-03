import type { Candle, IndicatorResult, LinePoint } from "@/types";

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
  "color.blue": "#2962ff",
  "color.orange": "#ff9800",
  "color.green": "#26a69a",
  "color.red": "#ef5350",
  "color.purple": "#ab47bc",
  "color.aqua": "#00bcd4",
  "color.yellow": "#fdd835",
  "color.white": "#ffffff",
  "color.black": "#000000",
  "color.gray": "#787b86",
  "color.grey": "#787b86",
  blue: "#2962ff",
  orange: "#ff9800",
  green: "#26a69a",
  red: "#ef5350",
  purple: "#ab47bc",
  aqua: "#00bcd4",
  yellow: "#fdd835",
  white: "#ffffff",
  black: "#000000",
  gray: "#787b86",
  grey: "#787b86",
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

type PineValue =
  | { kind: "number"; value: number }
  | { kind: "series"; values: SeriesData }
  | { kind: "string"; value: string }
  | { kind: "bool"; value: boolean };

type Token =
  | { kind: "number"; value: number }
  | { kind: "identifier"; value: string }
  | { kind: "string"; value: string }
  | { kind: "operator"; value: "+" | "-" | "*" | "/" }
  | { kind: "paren"; value: "(" | ")" }
  | { kind: "comma"; value: "," }
  | { kind: "equals"; value: "=" }
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
    else if (ch === "=" && depth === 0) return i;
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
    if (ch === "(" || ch === ")") {
      tokens.push({ kind: "paren", value: ch });
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
    const value = this.parseAdditive();
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
        const args: PineValue[] = [];
        const maybeClose = this.peek();
        if (!(maybeClose.kind === "paren" && maybeClose.value === ")")) {
          while (true) {
            if (
              this.peek().kind === "identifier" &&
              this.tokens[this.index + 1]?.kind === "equals"
            ) {
              this.next();
              this.next();
            }
            args.push(this.parseAdditive());
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
      return resolveIdentifier(token.value, this.context);
    }
    if (token.kind === "paren" && token.value === "(") {
      const value = this.parseAdditive();
      const close = this.next();
      if (close.kind !== "paren" || close.value !== ")") {
        throw new Error("Unclosed parenthesized expression");
      }
      return value;
    }
    throw new Error("Expected expression");
  }
}

function isUsableNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

function toSeries(value: PineValue, length: number): SeriesData {
  if (value.kind === "series") return value.values;
  if (value.kind === "number") return Array.from({ length }, () => value.value);
  if (value.kind === "bool") return Array.from({ length }, () => (value.value ? 1 : 0));
  return Array.from({ length }, () => null);
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

function evaluateCall(name: string, args: PineValue[], context: EvalContext): PineValue {
  switch (name) {
    case "input":
    case "input.int":
    case "input.float":
    case "input.source":
    case "input.bool":
      return args[0] ?? { kind: "number", value: 0 };
    case "nz":
      return nz(args[0], args[1], context.candles.length);
    case "math.abs":
      return mapValue(args[0], context.candles.length, Math.abs);
    case "math.max":
      return reduceMath(args, context.candles.length, Math.max);
    case "math.min":
      return reduceMath(args, context.candles.length, Math.min);
    case "ta.sma":
      return { kind: "series", values: rollingAverage(toSeries(args[0], context.candles.length), period(args[1])) };
    case "ta.ema":
      return { kind: "series", values: exponentialAverage(toSeries(args[0], context.candles.length), period(args[1])) };
    case "ta.rma":
      return { kind: "series", values: runningMovingAverage(toSeries(args[0], context.candles.length), period(args[1])) };
    case "ta.rsi":
      return { kind: "series", values: rsiSeries(toSeries(args[0], context.candles.length), period(args[1])) };
    case "ta.vwap":
      return { kind: "series", values: vwapSeries(context.candles) };
    case "ta.highest":
      return { kind: "series", values: rollingExtreme(toSeries(args[0], context.candles.length), period(args[1]), "high") };
    case "ta.lowest":
      return { kind: "series", values: rollingExtreme(toSeries(args[0], context.candles.length), period(args[1]), "low") };
    case "ta.change":
      return { kind: "series", values: changeSeries(toSeries(args[0], context.candles.length), args[1] ? period(args[1]) : 1) };
    case "ta.atr":
      return { kind: "series", values: atrSeries(context.candles, period(args[0])) };
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

function seriesToLinePoints(values: SeriesData, candles: Candle[]): LinePoint[] {
  const data: LinePoint[] = [];
  values.forEach((value, index) => {
    if (isUsableNumber(value) && candles[index]) {
      data.push({ time: candles[index].time, value });
    }
  });
  return data;
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

function readAssignments(cleaned: string, context: EvalContext, errors: string[]) {
  const lines = cleaned.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim().replace(/;$/, "");
    if (!line) continue;
    if (/^\/\/?@version/.test(line)) continue;
    if (/^(indicator|study|strategy|plot|hline|alertcondition)\s*\(/.test(line)) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:?=\s*(.+)$/);
    if (!match) continue;
    try {
      context.variables.set(match[1], evaluateExpression(match[2], context));
    } catch (error) {
      errors.push(`Line ${index + 1}: ${(error as Error).message}`);
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

  const series = findCallBodies(cleaned, "plot").map((body, index) => {
    const args = parseCallArguments(body);
    const expression = args.positional[0];
    if (!expression) {
      errors.push(`plot() #${index + 1}: missing series expression`);
      return null;
    }

    try {
      const value = evaluateExpression(expression, context);
      const title =
        unquote(args.named.title) ??
        unquote(args.positional[1]) ??
        `plot_${index + 1}`;
      const color = resolveColor(args.named.color ?? args.positional[2], DEFAULT_COLORS[index % DEFAULT_COLORS.length]);
      return {
        key: title,
        color,
        data: seriesToLinePoints(toSeries(value, candles.length), candles),
      };
    } catch (error) {
      errors.push(`plot() #${index + 1}: ${(error as Error).message}`);
      return null;
    }
  }).filter((item): item is { key: string; color: string; data: LinePoint[] } => item != null);

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
