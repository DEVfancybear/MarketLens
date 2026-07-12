import type { DrawingDataSample } from "@/types";

export interface VolumeProfileBin {
  low: number;
  high: number;
  upVolume: number;
  downVolume: number;
  volume: number;
}

export function anchoredVwap(samples: readonly DrawingDataSample[]) {
  let cumulativeVolume = 0;
  let cumulativeValue = 0;
  return samples.map((sample) => {
    const volume = Math.max(0, sample.volume);
    cumulativeVolume += volume;
    cumulativeValue += ((sample.high + sample.low + sample.close) / 3) * volume;
    return { time: sample.time, value: cumulativeVolume ? cumulativeValue / cumulativeVolume : sample.close };
  });
}

export function regressionChannel(samples: readonly DrawingDataSample[]) {
  if (samples.length === 0) return { slope: 0, intercept: 0, deviation: 0, correlation: 0, values: [] as number[] };
  const n = samples.length;
  const meanX = (n - 1) / 2;
  const meanY = samples.reduce((sum, sample) => sum + sample.close, 0) / n;
  let covariance = 0, varianceX = 0, varianceY = 0;
  for (let index = 0; index < n; index++) {
    const dx = index - meanX, dy = samples[index].close - meanY;
    covariance += dx * dy; varianceX += dx * dx; varianceY += dy * dy;
  }
  const slope = varianceX ? covariance / varianceX : 0;
  const intercept = meanY - slope * meanX;
  const values = samples.map((_, index) => intercept + slope * index);
  const deviation = Math.sqrt(samples.reduce((sum, sample, index) => sum + (sample.close - values[index]) ** 2, 0) / n);
  const correlation = varianceX && varianceY ? covariance / Math.sqrt(varianceX * varianceY) : 0;
  return { slope, intercept, deviation, correlation, values };
}

export function volumeProfile(samples: readonly DrawingDataSample[], requestedBins = 24): VolumeProfileBin[] {
  if (samples.length === 0) return [];
  const low = Math.min(...samples.map((sample) => sample.low));
  const high = Math.max(...samples.map((sample) => sample.high));
  const count = Math.max(1, Math.min(100, Math.floor(requestedBins)));
  const step = Math.max((high - low) / count, Number.EPSILON);
  const bins = Array.from({ length: count }, (_, index) => ({ low: low + index * step, high: low + (index + 1) * step, upVolume: 0, downVolume: 0, volume: 0 }));
  for (const sample of samples) {
    const typical = (sample.high + sample.low + sample.close) / 3;
    const index = Math.min(count - 1, Math.max(0, Math.floor((typical - low) / step)));
    const volume = Math.max(0, sample.volume);
    bins[index].volume += volume;
    if (sample.close >= sample.open) bins[index].upVolume += volume;
    else bins[index].downVolume += volume;
  }
  return bins;
}
