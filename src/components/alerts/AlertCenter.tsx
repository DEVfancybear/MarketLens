"use client";
/**
 * Alert Center (Phase 2) — responsive slide-over drawer to create and manage
 * price alerts. Full-width on mobile, a 380px panel on desktop. Sections:
 * notification settings, create form, active alerts, recently triggered, history.
 *
 * Pure UI over `alertStore`; the engine (mounted in GlobalRuntime) does the
 * evaluation. Live prices come from `marketDataStore` (read-only).
 */
import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  X,
  Trash2,
  RotateCcw,
  Volume2,
  Monitor,
  MessageSquare,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { alertCenterOpenAtom, setAlertCenterAtom } from "@/store/uiStore";
import { symbolAtom } from "@/store/chartStore";
import { useMarketDataStore } from "@/store/marketDataStore";
import {
  useAlertStore,
  CONDITION_LABEL,
  CONDITION_SYMBOL,
  type AlertCondition,
} from "@/store/alertStore";
import {
  MARKET_SYMBOLS,
  getMarketSymbol,
} from "@/services/market-data/symbols";
import {
  getBrowserPermission,
  requestBrowserPermission,
  type BrowserPermission,
} from "@/services/notifications/browser";
import { subscriptionKey } from "@/types";
import { fmtPrice } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { cn } from "@/utils/cn";

const CONDITIONS: AlertCondition[] = ["above", "below", "crossUp", "crossDown"];

function useLivePrice(symbol: string): number | undefined {
  return useMarketDataStore((s) => {
    const q = s.quotes[symbol]?.last;
    if (q != null && Number.isFinite(q)) return q;
    const series = s.candles[subscriptionKey(symbol, s.selectedTimeframe)];
    return series?.[series.length - 1]?.close;
  });
}

function Toggle({
  on,
  onClick,
  icon,
  label,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded border px-2 py-1 text-2xs font-medium transition-colors",
        on
          ? "border-brand/40 bg-brand/15 text-brand"
          : "border-terminal-border text-ink-muted hover:bg-terminal-hover hover:text-ink",
      )}
      aria-pressed={on}
    >
      {icon}
      {label}
    </button>
  );
}

export function AlertCenter() {
  const open = useAtomValue(alertCenterOpenAtom);
  const setOpen = useSetAtom(setAlertCenterAtom);

  const chartSymbol = useAtomValue(symbolAtom);
  const alerts = useAlertStore((s) => s.alerts);
  const triggered = useAlertStore((s) => s.triggeredAlerts);
  const history = useAlertStore((s) => s.history);
  const settings = useAlertStore((s) => s.settings);
  const createAlert = useAlertStore((s) => s.createAlert);
  const deleteAlert = useAlertStore((s) => s.deleteAlert);
  const resetAlert = useAlertStore((s) => s.resetAlert);
  const clearHistory = useAlertStore((s) => s.clearHistory);
  const clearTriggered = useAlertStore((s) => s.clearTriggered);
  const setSettings = useAlertStore((s) => s.setSettings);

  // ---- create form ----
  const [symbol, setSymbol] = useState(chartSymbol);
  const [condition, setCondition] = useState<AlertCondition>("crossUp");
  const [price, setPrice] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [perm, setPerm] = useState<BrowserPermission>("unsupported");

  const livePrice = useLivePrice(symbol);
  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;

  // Sync the form symbol with the chart's symbol while the drawer is closed.
  useEffect(() => {
    if (!open) setSymbol(chartSymbol);
  }, [chartSymbol, open]);

  // Prefill the price with the live price when the symbol changes / on open.
  useEffect(() => {
    if (livePrice != null) setPrice(livePrice.toFixed(prec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, open]);

  useEffect(() => {
    if (open) setPerm(getBrowserPermission());
  }, [open]);

  const sortedSymbols = useMemo(() => MARKET_SYMBOLS.map((s) => s.id), []);

  const submit = () => {
    const target = Number(price);
    if (!Number.isFinite(target) || target <= 0) return;
    createAlert({ symbol, condition, price: target, recurring });
  };

  const enableBrowser = async () => {
    const next = settings.browser;
    if (!next) {
      const result = await requestBrowserPermission();
      setPerm(result);
      setSettings({ browser: result === "granted" });
    } else {
      setSettings({ browser: false });
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        className="fixed inset-0 z-[90] bg-black/40 sm:bg-transparent"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className="fixed right-0 top-0 z-[91] flex h-full w-full flex-col border-l border-terminal-border bg-terminal-panel shadow-2xl sm:w-[380px]"
        role="dialog"
        aria-label="Alert Center"
      >
        {/* Header */}
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-terminal-border px-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Bell size={15} className="text-choch" />
            Alerts
            {alerts.length > 0 && (
              <span className="rounded-full bg-terminal-hover px-1.5 text-2xs text-ink-muted">
                {alerts.length}
              </span>
            )}
          </div>
          <button
            onClick={() => setOpen(false)}
            className="rounded p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-3">
          {/* Notification settings */}
          <div className="flex flex-wrap gap-1.5">
            <Toggle
              on={settings.toast}
              onClick={() => setSettings({ toast: !settings.toast })}
              icon={<MessageSquare size={12} />}
              label="Toast"
            />
            <Toggle
              on={settings.sound}
              onClick={() => setSettings({ sound: !settings.sound })}
              icon={<Volume2 size={12} />}
              label="Sound"
            />
            <Toggle
              on={settings.browser && perm === "granted"}
              onClick={enableBrowser}
              icon={<Monitor size={12} />}
              label={perm === "unsupported" ? "No browser push" : "Browser"}
            />
          </div>

          {/* Create form */}
          <div className="space-y-2 rounded-md border border-terminal-border bg-terminal-panel-2 p-3">
            <div className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
              New alert
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-ink-faint">Symbol</span>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="h-8 rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-ink outline-none focus:border-brand"
                >
                  {sortedSymbols.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-ink-faint">
                  Target price
                  {livePrice != null
                    ? ` · live ${fmtPrice(livePrice, prec)}`
                    : ""}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="h-8 rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-ink outline-none focus:border-brand"
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-1">
              {CONDITIONS.map((c) => (
                <button
                  key={c}
                  onClick={() => setCondition(c)}
                  className={cn(
                    "flex items-center justify-center gap-1 rounded border px-2 py-1 text-2xs font-medium transition-colors",
                    condition === c
                      ? "border-brand/40 bg-brand/15 text-brand"
                      : "border-terminal-border text-ink-muted hover:bg-terminal-hover hover:text-ink",
                  )}
                >
                  <span>{CONDITION_SYMBOL[c]}</span>
                  {CONDITION_LABEL[c]}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between">
              <Toggle
                on={recurring}
                onClick={() => setRecurring((v) => !v)}
                icon={<RotateCcw size={12} />}
                label={recurring ? "Every time" : "Only once"}
              />
              <button
                onClick={submit}
                className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand/85"
              >
                Create alert
              </button>
            </div>
          </div>

          {/* Active alerts */}
          <Section title={`Active (${alerts.length})`}>
            {alerts.length === 0 && <Empty>No active alerts.</Empty>}
            {alerts.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel-2 px-2.5 py-1.5"
              >
                <span className="font-mono text-xs font-semibold text-ink">
                  {a.symbol}
                </span>
                <span className="text-2xs text-ink-muted">
                  {CONDITION_SYMBOL[a.condition]}{" "}
                  {fmtPrice(
                    a.price,
                    getMarketSymbol(a.symbol)?.pricePrecision ?? 2,
                  )}
                </span>
                {a.recurring && (
                  <span className="rounded bg-terminal-hover px-1 text-[9px] uppercase text-ink-faint">
                    repeat
                  </span>
                )}
                <button
                  onClick={() => deleteAlert(a.id)}
                  className="ml-auto rounded p-1 text-ink-faint hover:bg-terminal-hover hover:text-bear"
                  aria-label="Delete alert"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </Section>

          {/* Triggered */}
          {triggered.length > 0 && (
            <Section
              title={`Triggered (${triggered.length})`}
              onClear={clearTriggered}
            >
              {triggered.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded border border-choch/30 bg-choch/5 px-2.5 py-1.5"
                >
                  <span className="font-mono text-xs font-semibold text-ink">
                    {a.symbol}
                  </span>
                  <span className="text-2xs text-ink-muted">
                    {CONDITION_SYMBOL[a.condition]}{" "}
                    {fmtPrice(
                      a.price,
                      getMarketSymbol(a.symbol)?.pricePrecision ?? 2,
                    )}
                    {a.triggerPrice != null && (
                      <span className="text-choch">
                        {" "}
                        @{" "}
                        {fmtPrice(
                          a.triggerPrice,
                          getMarketSymbol(a.symbol)?.pricePrecision ?? 2,
                        )}
                      </span>
                    )}
                  </span>
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      onClick={() => resetAlert(a.id)}
                      className="rounded p-1 text-ink-faint hover:bg-terminal-hover hover:text-brand"
                      aria-label="Re-arm alert"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      onClick={() => deleteAlert(a.id)}
                      className="rounded p-1 text-ink-faint hover:bg-terminal-hover hover:text-bear"
                      aria-label="Delete alert"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </Section>
          )}

          {/* History */}
          {history.length > 0 && (
            <Section
              title={`History (${history.length})`}
              onClear={clearHistory}
            >
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-2 px-1 py-1 text-2xs"
                >
                  <span className="font-mono font-semibold text-ink">
                    {h.symbol}
                  </span>
                  <span className="text-ink-faint">
                    {CONDITION_SYMBOL[h.condition]}{" "}
                    {fmtPrice(
                      h.targetPrice,
                      getMarketSymbol(h.symbol)?.pricePrecision ?? 2,
                    )}
                  </span>
                  <span className="text-choch">
                    @{" "}
                    {fmtPrice(
                      h.triggerPrice,
                      getMarketSymbol(h.symbol)?.pricePrecision ?? 2,
                    )}
                  </span>
                  <span className="ml-auto text-ink-faint">
                    {fmtDateTime(h.triggerTime)}
                  </span>
                </div>
              ))}
            </Section>
          )}
        </div>
      </aside>
    </>
  );
}

function Section({
  title,
  children,
  onClear,
}: {
  title: string;
  children: React.ReactNode;
  onClear?: () => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
          {title}
        </span>
        {onClear && (
          <button
            onClick={onClear}
            className="text-[10px] text-ink-faint hover:text-bear"
          >
            Clear
          </button>
        )}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded border border-dashed border-terminal-border px-2.5 py-2 text-2xs text-ink-faint">
      {children}
    </div>
  );
}
