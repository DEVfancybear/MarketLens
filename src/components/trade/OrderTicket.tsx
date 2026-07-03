"use client";
import { useEffect, useMemo, useState } from "react";
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
  mt5StatusAtom,
  mt5SymbolInfoAtom,
  placeMt5OrderAtom,
} from "@/store/mt5Store";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { computeRisk } from "@/services/tradeEngine";
import { makeClientOrderId, normalizeMt5Side } from "@/services/mt5/protocol";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { on } from "@/utils/bus";
import { cn } from "@/utils/cn";
import type { OrderPrefill, OrderType, Side } from "@/types";
import type { Mt5CloseAllRequest, Mt5OrderRequest, Mt5SymbolInfo } from "@/types/mt5";
import { LiveOrderConfirmDialog } from "./LiveOrderConfirmDialog";

const ORDER_TYPES: OrderType[] = ["market", "limit", "stop"];

/** Order ticket: type, entry/SL/TP, risk%, with live position sizing. */
export function OrderTicket() {
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
  const requireMt5Confirmation = useAtomValue(mt5RequireConfirmationAtom);
  const placeMt5 = useSetAtom(placeMt5OrderAtom);
  const closeAllMt5 = useSetAtom(closeAllMt5Atom);

  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const [type, setType] = useState<OrderType>("market");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [risk, setRisk] = useState("1");
  const [plannedSide, setPlannedSide] = useState<Side | null>(null);
  const [mt5Lot, setMt5Lot] = useState("");
  const [pendingLive, setPendingLive] = useState<
    | { kind: "order"; order: Mt5OrderRequest }
    | { kind: "closeAll"; request: Mt5CloseAllRequest }
    | null
  >(null);

  const num = (s: string) => (s.trim() === "" ? undefined : Number(s));

  const buildOrder = (side: Side) => ({
    symbol,
    side,
    type,
    price: type === "market" ? undefined : num(entry),
    stopLoss: num(sl),
    takeProfit: num(tp),
    riskPct: num(risk) ?? 1,
  });

  const simulatorMetrics = useMemo(
    () => computeRisk(buildOrder("long"), price, equity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, entry, sl, tp, risk, price, equity],
  );
  const activeSymbolInfo = mt5SymbolInfo[symbol];
  const metrics = useMemo(() => {
    if (executionMode !== "mt5" || !activeSymbolInfo) return simulatorMetrics;
    return computeMt5RiskMetrics({
      entry: type === "market" ? price : num(entry),
      stopLoss: num(sl),
      takeProfit: num(tp),
      riskPct: num(risk) ?? 1,
      equity: mt5Account?.equity ?? equity,
      symbolInfo: activeSymbolInfo,
      volumeOverride: num(mt5Lot),
    });
  }, [
    activeSymbolInfo,
    entry,
    equity,
    executionMode,
    mt5Account?.equity,
    price,
    risk,
    simulatorMetrics,
    sl,
    mt5Lot,
    tp,
    type,
  ]);

  const buildMt5Order = (side: Side): Mt5OrderRequest => {
    const info = mt5SymbolInfo[symbol];
    const manualVolume = num(mt5Lot);
    const volume =
      manualVolume != null ? manualVolume : normalizeMt5Volume(metrics.positionSize, info);
    return {
      clientOrderId: makeClientOrderId(),
      chartSymbol: symbol,
      brokerSymbol: info?.brokerSymbol ?? symbol,
      side: normalizeMt5Side(side),
      type,
      volume,
      price: type === "market" ? undefined : num(entry),
      marketPrice: type === "market" ? price : undefined,
      sl: num(sl),
      tp: num(tp),
      comment: "SMC terminal",
    };
  };

  const submit = (side: Side) => {
    if (type !== "market" && !num(entry)) return;
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
    place(buildOrder(side));
  };

  const requestCloseAll = () => {
    if (executionMode === "mt5") {
      const info = mt5SymbolInfo[symbol];
      const request: Mt5CloseAllRequest = {
        clientOrderId: makeClientOrderId("mt5_close_all"),
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
    closeAll();
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
    risk,
    price,
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
    if (prefill.type) setType(prefill.type);
    if (prefill.price != null) setEntry(formatTicketNumber(prefill.price));
    if (prefill.stopLoss != null) setSl(formatTicketNumber(prefill.stopLoss));
    if (prefill.takeProfit != null) setTp(formatTicketNumber(prefill.takeProfit));
    if (prefill.riskPct != null) setRisk(formatPercent(prefill.riskPct));
  };
  const sizeTitle =
    executionMode === "mt5" && activeSymbolInfo
      ? [
          `MT5 max lot: ${activeSymbolInfo.maxLot}`,
          activeSymbolInfo.maxLotReason ? `cap: ${activeSymbolInfo.maxLotReason}` : undefined,
          activeSymbolInfo.brokerMaxLot != null ? `broker max: ${activeSymbolInfo.brokerMaxLot}` : undefined,
          activeSymbolInfo.bridgeMaxLot != null ? `bridge max: ${activeSymbolInfo.bridgeMaxLot}` : undefined,
        ]
          .filter(Boolean)
          .join(" | ")
      : undefined;

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
    <div className="flex w-[252px] shrink-0 flex-col border-r border-terminal-border bg-terminal-panel">
      <div className="flex h-9 items-center justify-between border-b border-terminal-border px-3">
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
            {fmtPrice(price, prec)}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="grid grid-cols-3 rounded-sm border border-terminal-border bg-terminal-bg p-0.5">
          {ORDER_TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setType(t)}
              className={cn(
                "h-7 rounded-sm px-2 text-2xs font-semibold capitalize transition-colors",
                type === t
                  ? "bg-brand text-white"
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
            placeholder={fmtPrice(price, prec)}
          />
        )}
        <div className="grid grid-cols-2 gap-2">
          <TradeInput label="Stop loss" value={sl} onChange={setSl} />
          <TradeInput label="Take profit" value={tp} onChange={setTp} />
        </div>
        <TradeInput label="Risk %" value={risk} onChange={setRisk} />
        {executionMode === "mt5" && (
          <TradeInput
            label="Lot"
            value={mt5Lot}
            onChange={setMt5Lot}
            placeholder="Auto"
          />
        )}

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-terminal-border bg-terminal-border text-2xs">
          <Metric
            label="Size"
            value={metrics.positionSize.toFixed(4)}
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
            value={metrics.riskReward ? metrics.riskReward.toFixed(2) : "-"}
            accent="var(--brand)"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => submit("long")}
            className={cn(
              "h-10 rounded-sm bg-[#089981] text-xs font-semibold text-white hover:bg-[#0aa987]",
              plannedSide === "long" && "ring-2 ring-[#089981]/50 ring-offset-1 ring-offset-terminal-panel",
            )}
          >
            Buy
          </button>
          <button
            onClick={() => submit("short")}
            className={cn(
              "h-10 rounded-sm bg-[#f23645] text-xs font-semibold text-white hover:bg-[#ff4d5b]",
              plannedSide === "short" && "ring-2 ring-[#f23645]/50 ring-offset-1 ring-offset-terminal-panel",
            )}
          >
            Sell
          </button>
        </div>
        <button
          onClick={requestCloseAll}
          className="h-7 rounded-sm border border-terminal-border text-2xs font-medium text-ink-muted hover:bg-terminal-hover hover:text-ink"
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

function computeMt5RiskMetrics({
  entry,
  stopLoss,
  takeProfit,
  riskPct,
  equity,
  symbolInfo,
  volumeOverride,
}: {
  entry?: number;
  stopLoss?: number;
  takeProfit?: number;
  riskPct: number;
  equity: number;
  symbolInfo: Mt5SymbolInfo;
  volumeOverride?: number;
}) {
  const riskMoney = (equity * riskPct) / 100;
  const entryPrice = entry && Number.isFinite(entry) ? entry : 0;
  const stopDistance = stopLoss != null && entryPrice > 0 ? Math.abs(entryPrice - stopLoss) : 0;
  const tickSize = symbolInfo.tickSize && symbolInfo.tickSize > 0 ? symbolInfo.tickSize : symbolInfo.point;
  const tickValue = symbolInfo.tickValue && symbolInfo.tickValue > 0 ? symbolInfo.tickValue : 1;
  const moneyPerLotAtStop = stopDistance > 0 ? (stopDistance / tickSize) * tickValue : 0;
  const rawLots = moneyPerLotAtStop > 0 ? riskMoney / moneyPerLotAtStop : symbolInfo.minLot;
  const positionSize =
    volumeOverride != null && Number.isFinite(volumeOverride) && volumeOverride > 0
      ? volumeOverride
      : normalizeMt5Volume(rawLots, symbolInfo);
  const actualRisk = moneyPerLotAtStop > 0 ? moneyPerLotAtStop * positionSize : riskMoney;
  const rewardDistance = takeProfit != null && entryPrice > 0 ? Math.abs(takeProfit - entryPrice) : 0;
  const rewardAmount = rewardDistance > 0 ? (rewardDistance / tickSize) * tickValue * positionSize : 0;
  return {
    positionSize,
    riskPct,
    riskAmount: actualRisk,
    rewardAmount,
    riskReward: actualRisk > 0 ? rewardAmount / actualRisk : 0,
  };
}

function TradeInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
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
        className="h-8 w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 text-xs text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-brand"
      />
    </label>
  );
}

function normalizeMt5Volume(
  value: number,
  info: { minLot: number; maxLot: number; lotStep: number } | undefined,
) {
  const minLot = info?.minLot ?? 0.01;
  const maxLot = info?.maxLot ?? 1;
  const step = info?.lotStep ?? 0.01;
  if (!Number.isFinite(value) || value <= 0) return 0;
  const bounded = Math.min(Math.max(value, minLot), maxLot);
  if (!Number.isFinite(step) || step <= 0) return Number(bounded.toFixed(8));
  const decimals = String(step).includes(".") ? String(step).split(".")[1].length : 8;
  const rounded = Math.floor((bounded + Number.EPSILON) / step) * step;
  return Number(rounded.toFixed(Math.min(Math.max(decimals, 0), 8)));
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
    <div className="flex min-h-7 items-center justify-between bg-terminal-panel-2 px-2" title={title}>
      <span className="text-ink-faint">{label}</span>
      <span className="tabular font-semibold" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
