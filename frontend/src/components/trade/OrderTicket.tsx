"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  priceAtom,
  equityAtom,
  placeOrderAtom,
  closeAllAtom,
  orderPrefillAtom,
} from "@/store/tradeStore";
import {
  closeAllMt5Atom,
  executionModeAtom,
  mt5AccountAtom,
  mt5RequireConfirmationAtom,
  mt5RiskSnapshotAtom,
  mt5StatusAtom,
  mt5SymbolInfoAtom,
  placeMt5OrderAtom,
} from "@/store/mt5Store";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useQuote } from "@/hooks/useQuote";
import { computeRisk } from "@/services/tradeEngine";
import { getDefaultMt5SymbolInfo } from "@/services/mt5/symbolMapping";
import {
  computeMt5PositionRiskMetrics,
  formatPositionVolume,
  normalizePositionVolume,
  type Mt5AccountBasis,
  type Mt5CommissionType,
  type Mt5PositionRiskMetrics,
} from "@/services/positionLotSizing";
import {
  formatTicketRatio,
  formatTicketSize,
  parseTicketNumber,
  ticketLotOverride,
  type TicketLotMode,
} from "./tradeTicketMath";
import {
  makeClientCommandId,
  normalizeOrderSide,
} from "@/services/execution/identifiers";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { on } from "@/utils/bus";
import { cn } from "@/utils/cn";
import type { OrderPrefill, OrderType, Side } from "@/types";
import type { Mt5CloseAllRequest, Mt5OrderRequest } from "@/types/mt5";
import { LiveOrderConfirmDialog } from "./LiveOrderConfirmDialog";
import { useReplayTrading } from "@/store/replayTradingClientStore";
import { useReplayClientProjection } from "@/store/replayClientStore";

const ORDER_TYPES: OrderType[] = ["market", "limit", "stop"];

/** Order ticket: type, entry/SL/TP, risk%, with live position sizing. */
export function OrderTicket({
  variant = "desktop",
}: {
  variant?: "desktop" | "mobile" | "workspace";
}) {
  const symbol = useAtomValue(symbolAtom);
  const price = useAtomValue(priceAtom);
  const equity = useAtomValue(equityAtom);
  const orderPrefill = useAtomValue(orderPrefillAtom);
  const place = useSetAtom(placeOrderAtom);
  const closeAll = useSetAtom(closeAllAtom);
  const executionMode = useAtomValue(executionModeAtom);
  const mt5Status = useAtomValue(mt5StatusAtom);
  const mt5SymbolInfo = useAtomValue(mt5SymbolInfoAtom);
  const mt5Account = useAtomValue(mt5AccountAtom);
  const mt5RiskSnapshot = useAtomValue(mt5RiskSnapshotAtom);
  const requireMt5Confirmation = useAtomValue(mt5RequireConfirmationAtom);
  const placeMt5 = useSetAtom(placeMt5OrderAtom);
  const closeAllMt5 = useSetAtom(closeAllMt5Atom);
  const replayTrading = useReplayTrading();
  const isolatedReplay = Boolean(useReplayClientProjection().snapshot);
  const replayMode = replayTrading.active && executionMode === "simulator";
  const replayPreparing = isolatedReplay && !replayMode;
  const simulatorPrice = replayMode ? replayTrading.price : price;
  const simulatorEquity = replayMode
    ? replayTrading.account?.equity ?? equity
    : equity;
  const quote = useQuote(symbol);

  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const [type, setType] = useState<OrderType>("market");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [risk, setRisk] = useState("1");
  const [riskUnit, setRiskUnit] = useState<"%" | "amount">("%");
  const [accountBasis, setAccountBasis] = useState<Mt5AccountBasis>("equity");
  const [commission, setCommission] = useState("");
  const [commissionType, setCommissionType] =
    useState<Mt5CommissionType>("currency");
  const [plannedSide, setPlannedSide] = useState<Side | null>(null);
  const [sourceDrawingId, setSourceDrawingId] = useState<string | null>(null);
  const [mt5Lot, setMt5Lot] = useState("");
  const [mt5LotMode, setMt5LotMode] = useState<TicketLotMode>("auto");
  const [pendingLive, setPendingLive] = useState<
    | { kind: "order"; order: Mt5OrderRequest }
    | { kind: "closeAll"; request: Mt5CloseAllRequest }
    | null
  >(null);

  const buildOrder = (side: Side) => ({
    symbol,
    side,
    type,
    price: type === "market" ? undefined : parseTicketNumber(entry),
    stopLoss: parseTicketNumber(sl),
    takeProfit: parseTicketNumber(tp),
    riskPct: riskUnit === "%" ? parseTicketNumber(risk) ?? 1 : 1,
  });

  const simulatorMetrics = useMemo(
    () => computeRisk(buildOrder("long"), simulatorPrice, simulatorEquity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, entry, sl, tp, risk, simulatorPrice, simulatorEquity],
  );
  const activeSymbolInfo = mt5SymbolInfo[symbol];
  const sizingSymbolInfo = useMemo(
    () => {
      if (activeSymbolInfo) return activeSymbolInfo;
      const fallback = getDefaultMt5SymbolInfo(symbol);
      const marketTickSize = getMarketSymbol(symbol)?.tickSize;
      return marketTickSize ? { ...fallback, tickSize: marketTickSize } : fallback;
    },
    [activeSymbolInfo, symbol],
  );
  const mt5SizingBase = useMemo(
    () => ({
      stopPrice: parseTicketNumber(sl),
      targetPrice: parseTicketNumber(tp),
      riskValue: parseTicketNumber(risk) ?? 1,
      riskUnit,
      accountBasis,
      existingRiskMoney: mt5RiskSnapshot?.openRiskAtStops,
      balance: mt5Account?.balance,
      equity: mt5Account?.equity ?? equity,
      freeMargin: mt5Account?.freeMargin,
      leverage: mt5Account?.leverage,
      accountCurrency: mt5Account?.currency,
      commission: parseTicketNumber(commission),
      commissionType,
      bidPrice: quote?.bid,
      askPrice: quote?.ask,
      symbolInfo: sizingSymbolInfo,
      volumeOverride: ticketLotOverride(mt5LotMode, mt5Lot),
    }),
    [
      accountBasis,
      commission,
      commissionType,
      equity,
      mt5Account?.balance,
      mt5Account?.currency,
      mt5Account?.equity,
      mt5Account?.freeMargin,
      mt5Account?.leverage,
      mt5Lot,
      mt5LotMode,
      mt5RiskSnapshot?.openRiskAtStops,
      quote?.ask,
      quote?.bid,
      risk,
      riskUnit,
      sl,
      sizingSymbolInfo,
      tp,
    ],
  );
  const calculateMt5MetricsForSide = useCallback((side: Side): Mt5PositionRiskMetrics => {
    const marketEntry =
      side === "short" ? quote?.bid ?? price : quote?.ask ?? price;
    return computeMt5PositionRiskMetrics({
      ...mt5SizingBase,
      entryPrice:
        type === "market" ? marketEntry : parseTicketNumber(entry),
      side,
    });
  }, [entry, mt5SizingBase, price, quote?.ask, quote?.bid, type]);
  const metrics = useMemo(() => {
    if (executionMode !== "mt5") return simulatorMetrics;
    return calculateMt5MetricsForSide(plannedSide ?? "long");
  }, [
    executionMode,
    plannedSide,
    simulatorMetrics,
    calculateMt5MetricsForSide,
  ]);

  const buildMt5Order = (side: Side): Mt5OrderRequest => {
    const info = mt5SymbolInfo[symbol] ?? sizingSymbolInfo;
    const sideMetrics = calculateMt5MetricsForSide(side);
    const volume = normalizePositionVolume(sideMetrics.positionSize, info);
    return {
      clientOrderId: makeClientCommandId(),
      chartSymbol: symbol,
      brokerSymbol: info?.brokerSymbol ?? symbol,
      side: normalizeOrderSide(side),
      type,
      volume,
      price: type === "market" ? undefined : parseTicketNumber(entry),
      marketPrice:
        type === "market"
          ? side === "short"
            ? quote?.bid ?? price
            : quote?.ask ?? price
          : undefined,
      sl: parseTicketNumber(sl),
      tp: parseTicketNumber(tp),
      comment: "SMC terminal",
      ...(sourceDrawingId ? { drawingId: sourceDrawingId } : {}),
    };
  };

  const submit = (side: Side) => {
    if (replayPreparing) return;
    if (type !== "market" && !parseTicketNumber(entry)) return;
    if (executionMode === "mt5") {
      const order = buildMt5Order(side);
      if (mt5Status !== "connected" || !mt5SymbolInfo[symbol]) {
        placeMt5(order);
        return;
      }
      if (requireMt5Confirmation) setPendingLive({ kind: "order", order });
      else placeMt5(order);
      return;
    }
    if (replayMode) {
      void replayTrading.place(buildOrder(side), metrics.positionSize);
      return;
    }
    place(buildOrder(side));
  };

  const requestCloseAll = () => {
    if (replayPreparing) return;
    if (executionMode === "mt5") {
      const info = mt5SymbolInfo[symbol];
      const request: Mt5CloseAllRequest = {
        clientOrderId: makeClientCommandId("exec_close_all"),
        chartSymbol: symbol,
        brokerSymbol: info?.brokerSymbol ?? symbol,
      };
      if (mt5Status !== "connected") {
        closeAllMt5(request);
        return;
      }
      if (requireMt5Confirmation) setPendingLive({ kind: "closeAll", request });
      else closeAllMt5(request);
      return;
    }
    if (replayMode) void replayTrading.closeAll();
    else closeAll();
  };

  // Quick-trade hotkeys (B / S / X) use the current ticket settings.
  useEffect(() => {
    const offB = on("trade:buy", () => submit("long"));
    const offS = on("trade:sell", () => submit("short"));
    const offX = on("trade:close", () => requestCloseAll());
    return () => {
      offB();
      offS();
      offX();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    entry,
    sl,
    tp,
    mt5Lot,
    mt5LotMode,
    risk,
    riskUnit,
    accountBasis,
    commission,
    commissionType,
    price,
    quote?.ask,
    quote?.bid,
    executionMode,
    mt5Status,
    mt5SymbolInfo,
    requireMt5Confirmation,
    metrics.positionSize,
    symbol,
  ]);

  const confirmLive = () => {
    if (!pendingLive) return;
    if (pendingLive.kind === "order") placeMt5(pendingLive.order);
    else closeAllMt5(pendingLive.request);
    setPendingLive(null);
  };
  const formatTicketNumber = useMemo(
    () => (value: number) => fmtPrice(value, prec),
    [prec],
  );
  const formatPercent = (value: number) =>
    Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));

  const applyPrefill = (prefill: OrderPrefill) => {
    setPlannedSide(prefill.side ?? null);
    setSourceDrawingId(
      prefill.source === "position-drawing" ? prefill.drawingId ?? null : null,
    );
    if (prefill.type) setType(prefill.type);
    if (prefill.price != null) setEntry(formatTicketNumber(prefill.price));
    if (prefill.stopLoss != null) setSl(formatTicketNumber(prefill.stopLoss));
    if (prefill.takeProfit != null) setTp(formatTicketNumber(prefill.takeProfit));
    if (prefill.riskPct != null) {
      setRiskUnit("%");
      setRisk(formatPercent(prefill.riskPct));
    }
    if (prefill.quantity != null && Number.isFinite(prefill.quantity)) {
      setMt5LotMode("manual");
      setMt5Lot(formatPositionVolume(prefill.quantity, sizingSymbolInfo));
    } else if (prefill.source === "position-drawing") {
      setMt5LotMode("auto");
      setMt5Lot("");
    }
  };
  const sizeTitle =
    executionMode === "mt5"
      ? [
          `MT5 max lot: ${sizingSymbolInfo.maxLot}`,
          sizingSymbolInfo.brokerMaxLot != null ? `broker max: ${sizingSymbolInfo.brokerMaxLot}` : undefined,
          "Risk = stop loss + round-trip commission",
          "Volume is floored to the broker lot step",
        ]
          .filter(Boolean)
          .join(" | ")
      : undefined;
  const sizingWarnings =
    executionMode === "mt5" && "warnings" in metrics
      ? (metrics as Mt5PositionRiskMetrics).warnings
      : [];

  // Pre-fill the ticket from persistent atoms. This path also works when the
  // Trade tab was not mounted yet; the producer can switch to the Trade tab
  // after setting the atom and the newly mounted ticket still receives data.
  useEffect(() => {
    if (orderPrefill) applyPrefill(orderPrefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderPrefill?.version]);

  // Backward-compatible event-bus prefill for older chart/menu callers.
  useEffect(() => {
    const off = on("trade:prefill", (detail) => {
      applyPrefill(detail as OrderPrefill);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={cn(
      "flex shrink-0 flex-col bg-terminal-panel",
      variant === "desktop"
        ? "w-[272px] border-r border-terminal-border"
        : variant === "workspace"
          ? "h-full w-[336px] overflow-y-auto border-l border-terminal-border"
          : "mobile-order-ticket w-full",
    )}>
      <div className="flex h-11 items-center justify-between border-b border-terminal-border bg-terminal-panel-2/60 px-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-ink">{symbol}</span>
          {plannedSide && (
            <span
              className={cn(
                "rounded-sm px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                plannedSide === "long"
                  ? "bg-bull/15 text-bull"
                  : "bg-bear/15 text-bear",
              )}
            >
              {plannedSide}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {executionMode === "mt5" && (
            <span className="rounded-sm bg-bear/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-bear">
              live
            </span>
          )}
          <span className="tabular text-xs text-ink-muted">
            {fmtPrice(simulatorPrice, prec)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-3 rounded-xl border border-terminal-border bg-terminal-bg p-1">
          {ORDER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                "h-8 rounded-lg px-2 text-2xs font-semibold capitalize transition-colors",
                type === t
                  ? "bg-brand text-[var(--accent-contrast)] shadow-sm"
                  : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
              )}
            >
              {t}
            </button>
          ))}
        </div>

        {type !== "market" && (
          <TradeInput
            label="Entry price"
            value={entry}
            onChange={setEntry}
            placeholder={fmtPrice(simulatorPrice, prec)}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <TradeInput label="Stop loss" value={sl} onChange={setSl} />
          <TradeInput label="Take profit" value={tp} onChange={setTp} />
        </div>
        {executionMode === "mt5" ? (
          <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
            <TradeInput
              label={riskUnit === "%" ? "Risk %" : "Risk amount"}
              value={risk}
              onChange={setRisk}
              placeholder={riskUnit === "%" ? "1" : "100"}
            />
            <InlineSelect
              label="Risk basis"
              value={riskUnit}
              onChange={(value) => setRiskUnit(value as "%" | "amount")}
              options={[
                { value: "%", label: "%" },
                { value: "amount", label: "Money" },
              ]}
            />
          </div>
        ) : (
          <TradeInput label="Risk %" value={risk} onChange={setRisk} />
        )}
        {executionMode === "mt5" && (
          <div className="grid grid-cols-2 gap-2">
            <InlineSelect
              label="Account basis"
              value={accountBasis}
              onChange={(value) => setAccountBasis(value as Mt5AccountBasis)}
              options={[
                { value: "equity", label: "Equity" },
                { value: "balance", label: "Balance" },
                { value: "balanceMinusRisk", label: "Balance − risk" },
              ]}
            />
            <TradeInput
              label="Commission / lot"
              value={commission}
              onChange={setCommission}
              placeholder="0"
            />
          </div>
        )}
        {executionMode === "mt5" && (
          <div className="flex items-end justify-end -mt-2">
            <label className="flex items-center gap-1.5 text-[10px] text-ink-faint">
              <span>Commission</span>
              <select
                aria-label="Commission type"
                value={commissionType}
                onChange={(event) =>
                  setCommissionType(event.target.value as Mt5CommissionType)
                }
                className="h-7 rounded-md border border-terminal-border-strong bg-terminal-bg px-1.5 text-[10px] text-ink outline-none focus:border-brand"
              >
                <option value="currency">
                  {mt5Account?.currency ?? "Account currency"}
                </option>
                <option value="percent">Percent</option>
              </select>
            </label>
          </div>
        )}
        {executionMode === "mt5" && (
          <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2">
            <InlineSelect
              label="Lot mode"
              value={mt5LotMode}
              onChange={(value) => {
                const mode = value as TicketLotMode;
                if (mode === "manual" && !mt5Lot) {
                  setMt5Lot(
                    formatPositionVolume(metrics.positionSize, sizingSymbolInfo),
                  );
                }
                setMt5LotMode(mode);
              }}
              options={[
                { value: "auto", label: "Auto" },
                { value: "manual", label: "Manual" },
              ]}
            />
            <TradeInput
              label={mt5LotMode === "auto" ? "Calculated lot" : "Manual lot"}
              value={
                mt5LotMode === "auto"
                  ? formatPositionVolume(metrics.positionSize, sizingSymbolInfo)
                  : mt5Lot
              }
              onChange={setMt5Lot}
              placeholder="0"
              readOnly={mt5LotMode === "auto"}
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-terminal-border bg-terminal-border text-2xs">
          <Metric
            label="Size"
            value={formatTicketSize(metrics.positionSize)}
            title={sizeTitle}
          />
          <Metric
            label="Risk"
            value={fmtMoney(metrics.riskAmount)}
            accent="var(--bear)"
          />
          <Metric
            label="Reward"
            value={fmtMoney(metrics.rewardAmount)}
            accent="var(--bull)"
          />
          <Metric
            label="R:R"
            value={formatTicketRatio(metrics.riskReward)}
            accent="var(--accent)"
          />
        </div>
        {sizingWarnings.length > 0 && (
          <div
            role="status"
            className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[10px] leading-4 text-amber-200"
          >
            {formatSizingWarning(sizingWarnings[0])}
          </div>
        )}
        {executionMode === "mt5" && mt5LotMode === "manual" && (
          <div
            role="status"
            className="rounded-lg border border-brand/25 bg-brand/10 px-2.5 py-2 text-[10px] leading-4 text-ink-muted"
          >
            Manual lot overrides Risk %. The actual money risk is shown above.
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => submit("long")}
            disabled={replayPreparing}
            className={cn(
              "h-11 rounded-xl bg-bull text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-45",
              plannedSide === "long" && "ring-2 ring-bull/45 ring-offset-2 ring-offset-terminal-panel",
            )}
          >
            Buy
          </button>
          <button
            onClick={() => submit("short")}
            disabled={replayPreparing}
            className={cn(
              "h-11 rounded-xl bg-bear text-xs font-bold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-45",
              plannedSide === "short" && "ring-2 ring-bear/45 ring-offset-2 ring-offset-terminal-panel",
            )}
          >
            Sell
          </button>
        </div>
        <button
          onClick={requestCloseAll}
          disabled={replayPreparing}
          className="h-9 rounded-xl border border-terminal-border-strong text-2xs font-semibold text-ink-muted hover:bg-terminal-hover hover:text-ink disabled:opacity-45"
        >
          Close All
        </button>
      </div>
      <LiveOrderConfirmDialog
        payload={pendingLive}
        precision={prec}
        onCancel={() => setPendingLive(null)}
        onConfirm={confirmLive}
      />
    </div>
  );
}

function TradeInput({
  label,
  value,
  onChange,
  placeholder,
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase text-ink-faint">
        {label}
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className="h-9 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint read-only:cursor-default read-only:bg-terminal-panel-2 read-only:text-ink-muted focus:border-brand focus:ring-2 focus:ring-brand/15"
      />
    </label>
  );
}

function InlineSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-medium uppercase text-ink-faint">
        {label}
      </span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-xs text-ink outline-none transition-colors focus:border-brand focus:ring-2 focus:ring-brand/15"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatSizingWarning(code: string): string {
  switch (code) {
    case "STOP_LOSS_REQUIRED":
      return "Add a stop loss to calculate a risk-safe lot size.";
    case "STOP_LOSS_WRONG_SIDE":
      return "Stop loss is on the wrong side of the entry for this direction.";
    case "STOP_LOSS_TOO_CLOSE":
      return "Stop loss is inside the broker minimum stop distance.";
    case "TAKE_PROFIT_WRONG_SIDE":
      return "Take profit is on the wrong side of the entry.";
    case "TAKE_PROFIT_TOO_CLOSE":
      return "Take profit is inside the broker minimum stop distance.";
    case "MIN_VOLUME_INCREASED_RISK":
      return "Broker minimum lot is above the requested risk; actual risk is higher.";
    case "MARGIN_VOLUME_CAPPED":
      return "Lot size is capped by available margin.";
    case "MAX_VOLUME_CAPPED":
      return "Lot size is capped by the broker maximum.";
    case "TICK_VALUE_UNAVAILABLE":
      return "Tick value is unavailable; verify the MT5 symbol specification.";
    case "PERCENT_COMMISSION_NEEDS_CONTRACT_SIZE":
      return "Percent commission needs contract-size metadata from MT5.";
    case "STOP_DISTANCE_UNAVAILABLE":
      return "Enter a valid stop loss and verify the symbol tick value.";
    default:
      return "Review the symbol and risk inputs before sending the order.";
  }
}

function Metric({
  label,
  value,
  accent,
  title,
}: {
  label: string;
  value: string;
  accent?: string;
  title?: string;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between bg-terminal-panel-2 px-2.5" title={title}>
      <span className="text-ink-faint">{label}</span>
      <span className="tabular font-semibold" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
