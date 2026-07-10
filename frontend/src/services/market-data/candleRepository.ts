import type { MarketCandle } from "@/types";
import {
  normalizeMarketCandle,
  normalizeMarketCandleSeries,
} from "./candleSeries";

export const DEFAULT_CANDLE_CHUNK_SIZE = 256;

export interface CandleRepository {
  readonly chunks: readonly (readonly MarketCandle[])[];
  readonly chunkStarts: readonly number[];
  readonly length: number;
  readonly revision: number;
  readonly firstTime: number | null;
  readonly lastTime: number | null;
  readonly lastAccess: number;
}

export interface CandleRepositoryBudget {
  maxRepositories: number;
  maxCandles: number;
}

const flatCache = new WeakMap<CandleRepository, MarketCandle[]>();

function candlesEqual(a: MarketCandle, b: MarketCandle) {
  return a.time === b.time && a.open === b.open && a.high === b.high &&
    a.low === b.low && a.close === b.close && a.volume === b.volume &&
    a.closed === b.closed;
}

function freezeChunk(chunk: readonly MarketCandle[]) {
  return Object.freeze([...chunk]) as readonly MarketCandle[];
}

function repositoryFromChunks(
  chunks: readonly (readonly MarketCandle[])[],
  revision: number,
  lastAccess: number,
): CandleRepository {
  const nonEmpty = chunks.filter((chunk) => chunk.length > 0);
  const chunkStarts: number[] = [];
  let length = 0;
  for (const chunk of nonEmpty) {
    chunkStarts.push(length);
    length += chunk.length;
  }
  return Object.freeze({
    chunks: Object.freeze([...nonEmpty]),
    chunkStarts: Object.freeze(chunkStarts),
    length,
    revision,
    firstTime: nonEmpty[0]?.[0]?.time ?? null,
    lastTime: nonEmpty.at(-1)?.at(-1)?.time ?? null,
    lastAccess,
  });
}

function chunksFromSorted(
  candles: readonly MarketCandle[],
  chunkSize = DEFAULT_CANDLE_CHUNK_SIZE,
) {
  const chunks: (readonly MarketCandle[])[] = [];
  for (let index = 0; index < candles.length; index += chunkSize) {
    chunks.push(freezeChunk(candles.slice(index, index + chunkSize)));
  }
  return chunks;
}

function trimChunks(
  chunks: readonly (readonly MarketCandle[])[],
  length: number,
  maxCandles?: number,
) {
  if (!maxCandles || length <= maxCandles) return chunks;
  let remaining = length - maxCandles;
  let index = 0;
  while (index < chunks.length && remaining >= chunks[index].length) {
    remaining -= chunks[index].length;
    index += 1;
  }
  const trimmed = [...chunks.slice(index)];
  if (remaining > 0 && trimmed.length > 0) {
    trimmed[0] = freezeChunk(trimmed[0].slice(remaining));
  }
  return trimmed;
}

export function createCandleRepository(
  candles: readonly MarketCandle[] = [],
  maxCandles?: number,
  lastAccess = Date.now(),
): CandleRepository {
  const normalized = normalizeMarketCandleSeries(candles, maxCandles);
  return repositoryFromChunks(chunksFromSorted(normalized), 1, lastAccess);
}

export function materializeCandleRepository(repository: CandleRepository): MarketCandle[] {
  const cached = flatCache.get(repository);
  if (cached) return cached;
  const flat = repository.chunks.flatMap((chunk) => chunk);
  flatCache.set(repository, flat);
  return flat;
}

function findChunkIndex(repository: CandleRepository, time: number) {
  let low = 0;
  let high = repository.chunks.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const last = repository.chunks[mid].at(-1)?.time ?? Infinity;
    if (last < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

function lowerBound(chunk: readonly MarketCandle[], time: number) {
  let low = 0;
  let high = chunk.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (chunk[mid].time < time) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function findCandleIndexByTime(repository: CandleRepository, time: number) {
  const chunkIndex = findChunkIndex(repository, time);
  const chunk = repository.chunks[chunkIndex];
  if (!chunk) return -1;
  const itemIndex = lowerBound(chunk, time);
  return chunk[itemIndex]?.time === time
    ? repository.chunkStarts[chunkIndex] + itemIndex
    : -1;
}

export function candleAtRepositoryIndex(
  repository: CandleRepository,
  index: number,
): MarketCandle | undefined {
  if (index < 0 || index >= repository.length) return undefined;
  let low = 0;
  let high = repository.chunkStarts.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (repository.chunkStarts[mid] <= index) low = mid + 1;
    else high = mid;
  }
  const chunkIndex = low - 1;
  return repository.chunks[chunkIndex]?.[index - repository.chunkStarts[chunkIndex]];
}

export function upsertCandleRepository(
  repository: CandleRepository,
  candle: MarketCandle,
  maxCandles?: number,
  lastAccess = Date.now(),
): CandleRepository {
  const normalized = normalizeMarketCandle(candle);
  if (!normalized) return repository;
  if (repository.length === 0) {
    return repositoryFromChunks([freezeChunk([normalized])], repository.revision + 1, lastAccess);
  }

  const chunkIndex = findChunkIndex(repository, normalized.time);
  const chunks = [...repository.chunks];
  if (chunkIndex >= chunks.length) {
    const tailIndex = chunks.length - 1;
    const tail = chunks[tailIndex];
    if (tail.length < DEFAULT_CANDLE_CHUNK_SIZE) {
      chunks[tailIndex] = freezeChunk([...tail, normalized]);
    } else {
      chunks.push(freezeChunk([normalized]));
    }
  } else {
    const chunk = chunks[chunkIndex];
    const itemIndex = lowerBound(chunk, normalized.time);
    if (chunk[itemIndex]?.time === normalized.time) {
      if (candlesEqual(chunk[itemIndex], normalized)) return repository;
      const nextChunk = [...chunk];
      nextChunk[itemIndex] = normalized;
      chunks[chunkIndex] = freezeChunk(nextChunk);
    } else {
      const inserted = [...chunk.slice(0, itemIndex), normalized, ...chunk.slice(itemIndex)];
      if (inserted.length <= DEFAULT_CANDLE_CHUNK_SIZE) {
        chunks[chunkIndex] = freezeChunk(inserted);
      } else {
        const split = Math.ceil(inserted.length / 2);
        chunks.splice(
          chunkIndex,
          1,
          freezeChunk(inserted.slice(0, split)),
          freezeChunk(inserted.slice(split)),
        );
      }
    }
  }

  const nextLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  return repositoryFromChunks(
    trimChunks(chunks, nextLength, maxCandles),
    repository.revision + 1,
    lastAccess,
  );
}

function reusableChunkAt(
  candidates: Map<number, readonly MarketCandle[]>,
  candles: readonly MarketCandle[],
  index: number,
) {
  const candidate = candidates.get(candles[index]?.time);
  if (!candidate || index + candidate.length > candles.length) return undefined;
  for (let offset = 0; offset < candidate.length; offset += 1) {
    if (candidate[offset] !== candles[index + offset]) return undefined;
  }
  return candidate;
}

function chunkWithReuse(
  repository: CandleRepository,
  candles: readonly MarketCandle[],
) {
  const candidates = new Map(
    repository.chunks.map((chunk) => [chunk[0].time, chunk] as const),
  );
  const chunks: (readonly MarketCandle[])[] = [];
  let index = 0;
  while (index < candles.length) {
    const reusable = reusableChunkAt(candidates, candles, index);
    if (reusable) {
      chunks.push(reusable);
      index += reusable.length;
      continue;
    }
    const start = index;
    index += 1;
    while (
      index < candles.length &&
      index - start < DEFAULT_CANDLE_CHUNK_SIZE &&
      !reusableChunkAt(candidates, candles, index)
    ) {
      index += 1;
    }
    chunks.push(freezeChunk(candles.slice(start, index)));
  }
  return chunks;
}

export function mergeHistoryIntoCandleRepository(
  repository: CandleRepository,
  history: readonly MarketCandle[],
  maxCandles?: number,
  lastAccess = Date.now(),
): CandleRepository {
  const normalizedHistory = normalizeMarketCandleSeries(history);
  if (normalizedHistory.length === 0) return repository;
  if (repository.length === 0) {
    return createCandleRepository(normalizedHistory, maxCandles, lastAccess);
  }

  const current = materializeCandleRepository(repository);
  const historyFirst = normalizedHistory[0].time;
  const historyLast = normalizedHistory.at(-1)!.time;
  const byTime = new Map(normalizedHistory.map((candle) => [candle.time, candle]));
  for (const candle of current) {
    const outside = candle.time < historyFirst || candle.time > historyLast;
    const formingAtTail = candle.closed === false && candle.time >= historyLast;
    if (outside || formingAtTail) byTime.set(candle.time, candle);
  }
  let merged = [...byTime.values()].sort((a, b) => a.time - b.time);
  if (maxCandles && merged.length > maxCandles) {
    merged = merged.slice(merged.length - maxCandles);
  }
  const chunks = chunkWithReuse(repository, merged);
  const unchanged = merged.length === current.length &&
    merged.every((candle, index) => candle === current[index]);
  if (unchanged) return repository;
  return repositoryFromChunks(chunks, repository.revision + 1, lastAccess);
}

export function evictCandleRepositories(
  repositories: Readonly<Record<string, CandleRepository>>,
  protectedKeys: ReadonlySet<string>,
  budget: CandleRepositoryBudget,
) {
  const next = { ...repositories };
  const totals = () => ({
    repositories: Object.keys(next).length,
    candles: Object.values(next).reduce((sum, repository) => sum + repository.length, 0),
  });
  let current = totals();
  const candidates = Object.entries(next)
    .filter(([key]) => !protectedKeys.has(key))
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [key, repository] of candidates) {
    if (
      current.repositories <= budget.maxRepositories &&
      current.candles <= budget.maxCandles
    ) break;
    delete next[key];
    current = {
      repositories: current.repositories - 1,
      candles: current.candles - repository.length,
    };
  }
  return next;
}
