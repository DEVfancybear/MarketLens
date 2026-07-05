/**
 * Performance analytics — derives summary metrics, equity/drawdown curves,
 * monthly breakdown and an R-distribution from closed journal entries.
 */
import type {
  AnalyticsSummary, DistributionBucket, EquityPoint, JournalEntry, MonthlyStat,
} from '@/types';
import { monthKey } from '@/utils/time';

export interface AnalyticsReport {
  summary: AnalyticsSummary;
  equity: EquityPoint[];
  monthly: MonthlyStat[];
  distribution: DistributionBucket[];
}

const EMPTY_SUMMARY: AnalyticsSummary = {
  totalTrades: 0, wins: 0, losses: 0, breakeven: 0, winRate: 0, profitFactor: 0,
  avgRR: 0, avgWin: 0, avgLoss: 0, expectancy: 0, netPnl: 0, grossProfit: 0,
  grossLoss: 0, maxDrawdown: 0, maxDrawdownPct: 0, largestWin: 0, largestLoss: 0,
  longestWinStreak: 0, longestLossStreak: 0,
};

export function computeAnalytics(
  entries: JournalEntry[],
  startingEquity = 10_000,
): AnalyticsReport {
  if (entries.length === 0) {
    return { summary: EMPTY_SUMMARY, equity: [], monthly: [], distribution: emptyDistribution() };
  }

  const trades = [...entries].sort((a, b) => a.exitTime - b.exitTime);

  let wins = 0, losses = 0, breakeven = 0;
  let grossProfit = 0, grossLoss = 0;
  let largestWin = 0, largestLoss = 0;
  let rrSum = 0;
  let winStreak = 0, lossStreak = 0, maxWinStreak = 0, maxLossStreak = 0;

  for (const t of trades) {
    if (t.pnl > 0) {
      wins++; grossProfit += t.pnl; largestWin = Math.max(largestWin, t.pnl);
      winStreak++; lossStreak = 0; maxWinStreak = Math.max(maxWinStreak, winStreak);
    } else if (t.pnl < 0) {
      losses++; grossLoss += -t.pnl; largestLoss = Math.min(largestLoss, t.pnl);
      lossStreak++; winStreak = 0; maxLossStreak = Math.max(maxLossStreak, lossStreak);
    } else {
      breakeven++; winStreak = 0; lossStreak = 0;
    }
    rrSum += t.rr;
  }

  const total = trades.length;
  const netPnl = grossProfit - grossLoss;
  const winRate = (wins / total) * 100;
  const avgWin = wins ? grossProfit / wins : 0;
  const avgLoss = losses ? grossLoss / losses : 0;
  const winFrac = wins / total;
  const lossFrac = losses / total;
  const expectancy = winFrac * avgWin - lossFrac * avgLoss;

  // Equity & drawdown curve.
  const equity: EquityPoint[] = [];
  let running = startingEquity;
  let peak = startingEquity;
  let maxDD = 0;
  let maxDDPct = 0;
  for (const t of trades) {
    running += t.pnl;
    peak = Math.max(peak, running);
    const dd = running - peak;
    if (dd < maxDD) maxDD = dd;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct < maxDDPct) maxDDPct = ddPct;
    equity.push({ time: t.exitTime, equity: running, drawdown: dd });
  }

  const summary: AnalyticsSummary = {
    totalTrades: total, wins, losses, breakeven,
    winRate,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    avgRR: rrSum / total,
    avgWin, avgLoss, expectancy,
    netPnl, grossProfit, grossLoss,
    maxDrawdown: maxDD, maxDrawdownPct: maxDDPct,
    largestWin, largestLoss,
    longestWinStreak: maxWinStreak, longestLossStreak: maxLossStreak,
  };

  return { summary, equity, monthly: monthlyStats(trades), distribution: distribution(trades) };
}

function monthlyStats(trades: JournalEntry[]): MonthlyStat[] {
  const map = new Map<string, { pnl: number; trades: number; wins: number }>();
  for (const t of trades) {
    const k = monthKey(t.exitTime);
    const m = map.get(k) ?? { pnl: 0, trades: 0, wins: 0 };
    m.pnl += t.pnl;
    m.trades++;
    if (t.pnl > 0) m.wins++;
    map.set(k, m);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, m]) => ({ month, pnl: m.pnl, trades: m.trades, winRate: (m.wins / m.trades) * 100 }));
}

const R_BUCKETS: { label: string; test: (r: number) => boolean }[] = [
  { label: '≤ -2R', test: (r) => r <= -2 },
  { label: '-2..-1R', test: (r) => r > -2 && r <= -1 },
  { label: '-1..0R', test: (r) => r > -1 && r < 0 },
  { label: '0..1R', test: (r) => r >= 0 && r < 1 },
  { label: '1..2R', test: (r) => r >= 1 && r < 2 },
  { label: '2..3R', test: (r) => r >= 2 && r < 3 },
  { label: '≥ 3R', test: (r) => r >= 3 },
];

function emptyDistribution(): DistributionBucket[] {
  return R_BUCKETS.map((b) => ({ label: b.label, count: 0, pnl: 0 }));
}

function distribution(trades: JournalEntry[]): DistributionBucket[] {
  const buckets = emptyDistribution();
  for (const t of trades) {
    const idx = R_BUCKETS.findIndex((b) => b.test(t.rr));
    if (idx >= 0) {
      buckets[idx].count++;
      buckets[idx].pnl += t.pnl;
    }
  }
  return buckets;
}
