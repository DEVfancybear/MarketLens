/** Performance analytics types. */

export interface AnalyticsSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number;
  profitFactor: number;
  avgRR: number;
  avgWin: number;
  avgLoss: number;
  expectancy: number;
  netPnl: number;
  grossProfit: number;
  grossLoss: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  largestWin: number;
  largestLoss: number;
  longestWinStreak: number;
  longestLossStreak: number;
}

export interface EquityPoint {
  time: number;
  equity: number;
  /** Drawdown from running peak (negative or zero). */
  drawdown: number;
}

export interface MonthlyStat {
  /** "2026-06" */
  month: string;
  pnl: number;
  trades: number;
  winRate: number;
}

export interface DistributionBucket {
  label: string;
  count: number;
  pnl: number;
}
