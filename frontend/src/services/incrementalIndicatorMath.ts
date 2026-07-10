import type { Candle } from "@/types";

export interface RsiState {
  avgGain: number[];
  avgLoss: number[];
}

export interface MacdState {
  fast: number[];
  slow: number[];
  signal: number[];
}

export function buildEmaState(candles: readonly Candle[], length: number) {
  const values: number[] = [];
  const k = 2 / (length + 1);
  for (let index = 0; index < candles.length; index += 1) {
    values[index] = index === 0
      ? candles[index].close
      : candles[index].close * k + values[index - 1] * (1 - k);
  }
  return values;
}

export function buildRsiState(candles: readonly Candle[], length: number): RsiState {
  const avgGain = Array<number>(candles.length).fill(Number.NaN);
  const avgLoss = Array<number>(candles.length).fill(Number.NaN);
  if (candles.length <= length) return { avgGain, avgLoss };
  let gain = 0;
  let loss = 0;
  for (let index = 1; index <= length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    if (change >= 0) gain += change;
    else loss -= change;
  }
  avgGain[length] = gain / length;
  avgLoss[length] = loss / length;
  for (let index = length + 1; index < candles.length; index += 1) {
    const change = candles[index].close - candles[index - 1].close;
    avgGain[index] = (avgGain[index - 1] * (length - 1) + Math.max(change, 0)) / length;
    avgLoss[index] = (avgLoss[index - 1] * (length - 1) + Math.max(-change, 0)) / length;
  }
  return { avgGain, avgLoss };
}

export function buildMacdState(
  candles: readonly Candle[],
  fastLength: number,
  slowLength: number,
  signalLength: number,
): MacdState {
  const fast: number[] = [];
  const slow: number[] = [];
  const signal: number[] = [];
  const fastK = 2 / (fastLength + 1);
  const slowK = 2 / (slowLength + 1);
  const signalK = 2 / (signalLength + 1);
  for (let index = 0; index < candles.length; index += 1) {
    const close = candles[index].close;
    fast[index] = index === 0 ? close : close * fastK + fast[index - 1] * (1 - fastK);
    slow[index] = index === 0 ? close : close * slowK + slow[index - 1] * (1 - slowK);
    const macd = fast[index] - slow[index];
    signal[index] = index === 0 ? macd : macd * signalK + signal[index - 1] * (1 - signalK);
  }
  return { fast, slow, signal };
}

export function latestSma(candles: readonly Candle[], length: number) {
  if (candles.length < length) return null;
  let sum = 0;
  for (let index = candles.length - length; index < candles.length; index += 1) {
    sum += candles[index].close;
  }
  return sum / length;
}

export function rsiValue(avgGain: number, avgLoss: number) {
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function currentSessionVwap(candles: readonly Candle[]) {
  const last = candles.at(-1);
  if (!last) return null;
  const day = Math.floor(last.time / 86_400);
  let pv = 0;
  let volume = 0;
  for (let index = candles.length - 1; index >= 0; index -= 1) {
    const candle = candles[index];
    if (Math.floor(candle.time / 86_400) !== day) break;
    pv += ((candle.high + candle.low + candle.close) / 3) * candle.volume;
    volume += candle.volume;
  }
  return volume ? pv / volume : last.close;
}
