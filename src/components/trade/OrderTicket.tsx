"use client";
import { useEffect, useMemo, useState } from "react";
import {
  priceAtom,
  equityAtom,
  placeOrderAtom,
  closeAllAtom,
} from "@/store/tradeStore";
import { useAtomValue, useSetAtom } from "jotai";
import { symbolAtom } from "@/store/chartStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { computeRisk } from "@/services/tradeEngine";
import { fmtMoney, fmtPrice } from "@/utils/format";
import { on } from "@/utils/bus";
import { cn } from "@/utils/cn";
import type { OrderPrefill, OrderType, Side } from "@/types";

const ORDER_TYPES: OrderType[] = ["market", "limit", "stop"];

/** Order ticket: type, entry/SL/TP, risk%, with live position sizing. */
export function OrderTicket() {
  const symbol = useAtomValue(symbolAtom);
  const price = useAtomValue(priceAtom);
  const equity = useAtomValue(equityAtom);
  const place = useSetAtom(placeOrderAtom);
  const closeAll = useSetAtom(closeAllAtom);

  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const [type, setType] = useState<OrderType>("market");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [risk, setRisk] = useState("1");

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

  const metrics = useMemo(
    () => computeRisk(buildOrder("long"), price, equity),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, entry, sl, tp, risk, price, equity],
  );

  const submit = (side: Side) => {
    if (type !== "market" && !num(entry)) return;
    place(buildOrder(side));
  };

  // Quick-trade hotkeys (B / S / X) use the current ticket settings.
  useEffect(() => {
    const offB = on("trade:buy", () => submit("long"));
    const offS = on("trade:sell", () => submit("short"));
    const offX = on("trade:close", () => closeAll());
    return () => {
      offB();
      offS();
      offX();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, entry, sl, tp, risk, price]);

  // Pre-fill the ticket from the chart context menu ("Add Order at {price}").
  useEffect(() => {
    const off = on("trade:prefill", (detail) => {
      const p = detail as OrderPrefill;
      if (p.type) setType(p.type);
      if (p.price != null) setEntry(String(p.price));
    });
    return off;
  }, []);

  const Field = ({
    label,
    value,
    onChange,
    placeholder,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-ink-faint">
        {label}
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-ink outline-none focus:border-brand"
      />
    </label>
  );

  return (
    <div className="flex w-[240px] shrink-0 flex-col gap-2 border-r border-terminal-border p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink">{symbol}</span>
        <span className="tabular text-xs text-ink-muted">
          {fmtPrice(price, prec)}
        </span>
      </div>

      {/* Order type */}
      <div className="flex rounded border border-terminal-border p-0.5">
        {ORDER_TYPES.map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={cn(
              "flex-1 rounded px-2 py-1 text-2xs font-medium capitalize transition-colors",
              type === t
                ? "bg-brand/20 text-brand"
                : "text-ink-muted hover:bg-terminal-hover",
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {type !== "market" && (
        <Field
          label="Entry price"
          value={entry}
          onChange={setEntry}
          placeholder={fmtPrice(price, prec)}
        />
      )}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Stop loss" value={sl} onChange={setSl} />
        <Field label="Take profit" value={tp} onChange={setTp} />
      </div>
      <Field label="Risk %" value={risk} onChange={setRisk} />

      {/* Live risk metrics */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded bg-terminal-panel-2 p-2 text-2xs">
        <Metric label="Size" value={metrics.positionSize.toFixed(4)} />
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
          value={metrics.riskReward ? `${metrics.riskReward.toFixed(2)}` : "—"}
          accent="var(--accent)"
        />
      </div>

      {/* Buy / Sell */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => submit("long")}
          className="rounded bg-bull/90 py-1.5 text-xs font-semibold text-white hover:bg-bull"
        >
          Buy (B)
        </button>
        <button
          onClick={() => submit("short")}
          className="rounded bg-bear/90 py-1.5 text-xs font-semibold text-white hover:bg-bear"
        >
          Sell (S)
        </button>
      </div>
      <button
        onClick={closeAll}
        className="rounded border border-terminal-border py-1 text-2xs text-ink-muted hover:bg-terminal-hover hover:text-ink"
      >
        Close All (X)
      </button>
    </div>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-faint">{label}</span>
      <span className="tabular font-semibold" style={{ color: accent }}>
        {value}
      </span>
    </div>
  );
}
