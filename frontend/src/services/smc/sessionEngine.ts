/**
 * Trading sessions and kill zones (all UTC).
 *
 *   Asian   23:00 – 08:00
 *   London  07:00 – 16:00
 *   New York 13:00 – 21:00
 *
 * Kill zones (high-probability windows):
 *   London Open   07:00 – 10:00
 *   New York Open 12:00 – 15:00
 */
import type { Candle, KillZone, SessionName, SessionRange } from '@/types';
import { dayKey, utcHours } from '@/utils/time';

interface SessionDef {
  name: SessionName;
  start: number; // UTC hour
  end: number;
}

const SESSIONS: SessionDef[] = [
  { name: 'asian', start: 23, end: 8 }, // wraps midnight
  { name: 'london', start: 7, end: 16 },
  { name: 'newyork', start: 13, end: 21 },
];

function inSession(h: number, s: SessionDef): boolean {
  return s.start > s.end ? h >= s.start || h < s.end : h >= s.start && h < s.end;
}

/** Build per-day session ranges (high/low/mid) from the visible candles. */
export function computeSessions(candles: Candle[]): SessionRange[] {
  const map = new Map<string, SessionRange>();

  for (const c of candles) {
    const h = utcHours(c.time);
    // Asian wraps midnight: attribute pre-08:00 bars to the previous day's session.
    for (const s of SESSIONS) {
      if (!inSession(h, s)) continue;
      const day = s.name === 'asian' && h < 8
        ? dayKey(c.time - 86400)
        : dayKey(c.time);
      const key = `${s.name}:${day}`;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          name: s.name,
          day,
          startTime: c.time,
          endTime: c.time,
          high: c.high,
          low: c.low,
          mid: (c.high + c.low) / 2,
        });
      } else {
        existing.endTime = c.time;
        existing.high = Math.max(existing.high, c.high);
        existing.low = Math.min(existing.low, c.low);
        existing.mid = (existing.high + existing.low) / 2;
      }
    }
  }

  return [...map.values()].sort((a, b) => a.startTime - b.startTime);
}

/** Kill-zone windows overlapping the visible candle range. */
export function computeKillZones(candles: Candle[]): KillZone[] {
  if (candles.length === 0) return [];
  const zones: KillZone[] = [];
  const days = new Set(candles.map((c) => dayKey(c.time)));

  for (const day of days) {
    const base = Date.parse(`${day}T00:00:00Z`) / 1000;
    zones.push({ name: 'london-open', startTime: base + 7 * 3600, endTime: base + 10 * 3600 });
    zones.push({ name: 'newyork-open', startTime: base + 12 * 3600, endTime: base + 15 * 3600 });
  }
  const first = candles[0].time;
  const last = candles[candles.length - 1].time;
  return zones
    .filter((z) => z.endTime >= first && z.startTime <= last)
    .sort((a, b) => a.startTime - b.startTime);
}
