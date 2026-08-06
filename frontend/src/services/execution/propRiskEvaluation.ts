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
    | "dailyProfitTarget"
    | "dailyProfitRemaining"
    | "balance"
    | "equity"
  > {
  dailyLossLimit: string;
  dailyLossUsed: string;
  dailyLossRemaining: string;
  maxLossLimit: string;
  maxLossUsed: string;
  maxLossRemaining: string;
  dailyProfitTarget?: string | null;
  dailyProfitRemaining?: string | null;
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
    dailyProfitTarget:
      value.dailyProfitTarget == null
        ? value.dailyProfitTarget
        : propRiskDecimal(value.dailyProfitTarget, "dailyProfitTarget"),
    dailyProfitRemaining:
      value.dailyProfitRemaining == null
        ? value.dailyProfitRemaining
        : propRiskDecimal(value.dailyProfitRemaining, "dailyProfitRemaining"),
    balance: propRiskDecimal(value.balance, "balance"),
    equity: propRiskDecimal(value.equity, "equity"),
  };
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
