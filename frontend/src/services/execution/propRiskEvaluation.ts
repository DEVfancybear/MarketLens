import type { PropRiskEvaluation } from "@/types/execution";

export interface PropRiskEvaluationWire
  extends Omit<
    PropRiskEvaluation,
    | "dailyLossLimit"
    | "dailyLossUsed"
    | "dailyLossRemaining"
    | "maxLossLimit"
    | "maxLossUsed"
    | "maxLossRemaining"
    | "maxLossReferenceBalance"
    | "dailyLossResult"
    | "maxLossResult"
    | "dailyProfitTarget"
    | "dailyProfitRemaining"
    | "profitTarget"
    | "profitTargetResult"
    | "profitTargetRemaining"
    | "positiveDaysProfit"
    | "bestDayProfit"
    | "balance"
    | "equity"
  > {
  dailyLossLimit: string;
  dailyLossUsed: string;
  dailyLossRemaining: string;
  maxLossLimit: string;
  maxLossUsed: string;
  maxLossRemaining: string;
  maxLossReferenceBalance: string;
  dailyLossResult: string;
  maxLossResult: string;
  dailyProfitTarget?: string | null;
  dailyProfitRemaining?: string | null;
  profitTarget?: string | null;
  profitTargetResult?: string | null;
  profitTargetRemaining?: string | null;
  positiveDaysProfit?: string | null;
  bestDayProfit?: string | null;
  balance: string;
  equity: string;
}

export function normalizePropRiskEvaluation(
  value: PropRiskEvaluationWire,
): PropRiskEvaluation {
  return {
    ...value,
    dailyLossLimit: propRiskDecimal(value.dailyLossLimit, "dailyLossLimit"),
    dailyLossUsed: propRiskDecimal(value.dailyLossUsed, "dailyLossUsed"),
    dailyLossRemaining: propRiskDecimal(
      value.dailyLossRemaining,
      "dailyLossRemaining",
    ),
    maxLossLimit: propRiskDecimal(value.maxLossLimit, "maxLossLimit"),
    maxLossUsed: propRiskDecimal(value.maxLossUsed, "maxLossUsed"),
    maxLossRemaining: propRiskDecimal(
      value.maxLossRemaining,
      "maxLossRemaining",
    ),
    maxLossReferenceBalance: propRiskDecimal(
      value.maxLossReferenceBalance,
      "maxLossReferenceBalance",
    ),
    dailyLossResult: propRiskDecimal(value.dailyLossResult, "dailyLossResult"),
    maxLossResult: propRiskDecimal(value.maxLossResult, "maxLossResult"),
    dailyProfitTarget: optionalPropRiskDecimal(
      value.dailyProfitTarget,
      "dailyProfitTarget",
    ),
    dailyProfitRemaining: optionalPropRiskDecimal(
      value.dailyProfitRemaining,
      "dailyProfitRemaining",
    ),
    profitTarget: optionalPropRiskDecimal(value.profitTarget, "profitTarget"),
    profitTargetResult: optionalPropRiskDecimal(
      value.profitTargetResult,
      "profitTargetResult",
    ),
    profitTargetRemaining: optionalPropRiskDecimal(
      value.profitTargetRemaining,
      "profitTargetRemaining",
    ),
    positiveDaysProfit: optionalPropRiskDecimal(
      value.positiveDaysProfit,
      "positiveDaysProfit",
    ),
    bestDayProfit: optionalPropRiskDecimal(
      value.bestDayProfit,
      "bestDayProfit",
    ),
    balance: propRiskDecimal(value.balance, "balance"),
    equity: propRiskDecimal(value.equity, "equity"),
  };
}

function optionalPropRiskDecimal(
  value: string | null | undefined,
  field: string,
): number | null | undefined {
  return value == null ? value : propRiskDecimal(value, field);
}

export function propRiskDecimal(value: string, field: string): number {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Prop risk decimal ${field} is invalid`);
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    throw new Error(`Prop risk decimal ${field} is invalid`);
  }
  return normalized;
}

export interface PropRiskHeadroomPresentation {
  exceeded: boolean;
  displayValue: number;
  ratio: number;
}

export function presentPropRiskHeadroom(
  headroom: number,
  limit: number,
): PropRiskHeadroomPresentation {
  if (!Number.isFinite(headroom) || !Number.isFinite(limit)) {
    throw new Error("Prop risk headroom is invalid");
  }
  const exceeded = headroom < 0;
  const available = Math.max(0, headroom);
  return {
    exceeded,
    displayValue: exceeded ? Math.abs(headroom) : available,
    ratio: limit > 0 ? Math.max(0, Math.min(1, available / limit)) : 0,
  };
}
