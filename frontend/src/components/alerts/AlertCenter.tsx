"use client";
/**
 * Alert Center (Phase 2) — responsive slide-over drawer to create and manage
 * price alerts. Full-width on mobile, a 380px panel on desktop. Sections:
 * notification settings, create form, active alerts, recently triggered, history.
 *
 * Pure UI over `alertStore`; the engine (mounted in GlobalRuntime) does the
 * evaluation. Live prices come from `marketDataStore` (read-only).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  X,
  Trash2,
  RotateCcw,
  Volume2,
  Monitor,
  MessageSquare,
  Smartphone,
  Send,
  Hash,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { alertCenterOpenAtom, setAlertCenterAtom } from "@/store/uiStore";
import { symbolAtom } from "@/store/chartStore";
import { getMarketDataState, useMarketDataStore } from "@/store/marketDataStore";
import { useReplayClientProjection } from "@/store/replayClientStore";
import {
  useAlertStore,
  CONDITION_LABEL,
  CONDITION_SYMBOL,
  type Alert,
  type AlertCondition,
} from "@/store/alertStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { symbolAliasCandidates } from "@/services/market-data/symbolAliases";
import { resolveObservedSymbol } from "@/services/alertSymbols";
import { useMarketSymbols } from "@/store/marketSymbolStore";
import {
  getBrowserPermission,
  NOTIFICATION_PERMISSION_BLOCKED_MESSAGE,
  requestBrowserPermission,
  type BrowserPermission,
} from "@/services/notifications/browser";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import {
  getExternalNotificationCapabilities,
  type ExternalNotificationCapabilities,
} from "@/services/notifications/external";
import { subscriptionKey } from "@/types";
import { fmtPrice } from "@/utils/format";
import { fmtDateTime } from "@/utils/time";
import { cn } from "@/utils/cn";
import { targetAt } from "@/services/dynamicAlertTargets";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import { usePlatformDialog } from "@/components/ui/PlatformDialog";
import { useI18n } from "@/hooks/useI18n";

const CONDITIONS: AlertCondition[] = ["above", "below", "crossUp", "crossDown"];

function alertTargetText(alert: Alert): string {
  const target = alert.technicalTarget;
  const precision = getMarketSymbol(alert.symbol)?.pricePrecision ?? 2;
  if (!target || target.kind === "fixed-price") {
    return `${CONDITION_SYMBOL[alert.condition]} ${fmtPrice(alert.price, precision)}`;
  }
  const timestamp = getMarketDataState().quotes[alert.symbol]?.timestamp ?? Date.now();
  const projected = targetAt(target, timestamp);
  if (!projected.active) {
    return target.kind === "dynamic-line" ? "Dynamic line · inactive" : "Channel · inactive";
  }
  if (target.kind === "dynamic-line") {
    return `${CONDITION_SYMBOL[alert.condition]} Dynamic line · ${fmtPrice(projected.lower, precision)}`;
  }
  return `Channel · ${fmtPrice(projected.lower, precision)}–${fmtPrice(projected.upper, precision)}`;
}

function useLivePrice(symbol: string): number | undefined {
  return useMarketDataStore((s) => {
    const observed = resolveObservedSymbol(symbol, Object.keys(s.quotes));
    const quote = observed ? s.quotes[observed]?.last : undefined;
    if (quote != null && Number.isFinite(quote) && quote > 0) return quote;

    const candidateKeys = Object.keys(s.candles)
      .filter((key) => key.endsWith(`:${s.selectedTimeframe}`))
      .map((key) => key.slice(0, -(`:${s.selectedTimeframe}`).length));
    const candleSymbol = resolveObservedSymbol(symbol, candidateKeys);
    if (candleSymbol) {
      const series =
        s.candles[subscriptionKey(candleSymbol, s.selectedTimeframe)];
      const close = series?.[series.length - 1]?.close;
      if (close != null && Number.isFinite(close) && close > 0) return close;
    }
    return undefined;
  });
}

function Toggle({
  on,
  onClick,
  icon,
  label,
  disabled = false,
}: {
  on: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded border px-2 py-1 text-2xs font-medium transition-colors",
        disabled
          ? "cursor-not-allowed border-terminal-border text-ink-faint opacity-60"
          : on
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
  const replayActive = Boolean(useReplayClientProjection().snapshot);

  const chartSymbol = useAtomValue(symbolAtom);
  const alerts = useAlertStore((s) => s.alerts);
  const triggered = useAlertStore((s) => s.triggeredAlerts);
  const expired = useAlertStore((s) => s.expiredAlerts);
  const history = useAlertStore((s) => s.history);
  const settings = useAlertStore((s) => s.settings);
  const createAlert = useAlertStore((s) => s.createAlert);
  const updateAlert = useAlertStore((s) => s.updateAlert);
  const deleteAlert = useAlertStore((s) => s.deleteAlert);
  const clearAlerts = useAlertStore((s) => s.clear);
  const resetAlert = useAlertStore((s) => s.resetAlert);
  const clearHistory = useAlertStore((s) => s.clearHistory);
  const clearTriggered = useAlertStore((s) => s.clearTriggered);
  const clearExpired = useAlertStore((s) => s.clearExpired);
  const setSettings = useAlertStore((s) => s.setSettings);
  const push = usePushNotifications();
  const { refresh: refreshPush } = push;
  const marketSymbols = useMarketSymbols();
  const { requestConfirm, dialog } = usePlatformDialog();
  const { t } = useI18n();

  // ---- create form ----
  const [symbol, setSymbol] = useState(chartSymbol);
  const [condition, setCondition] = useState<AlertCondition>("crossUp");
  const [price, setPrice] = useState("");
  const priceEditedRef = useRef(false);
  const priceSymbolRef = useRef<string | null>(null);
  const [recurring, setRecurring] = useState(false);
  const [perm, setPerm] = useState<BrowserPermission>("unsupported");
  const [externalCaps, setExternalCaps] =
    useState<ExternalNotificationCapabilities | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);

  const livePrice = useLivePrice(symbol);
  const prec =
    symbolAliasCandidates(symbol)
      .map((candidate) => getMarketSymbol(candidate)?.pricePrecision)
      .find((value): value is number => value !== undefined) ?? 2;

  // Sync the form symbol with the chart's symbol while the drawer is closed.
  useEffect(() => {
    if (!open) setSymbol(chartSymbol);
  }, [chartSymbol, open]);

  // Reset on each symbol/open context, then accept a delayed first quote until
  // the user edits the target manually.
  useEffect(() => {
    if (!open) {
      priceSymbolRef.current = null;
      return;
    }
    const normalizedSymbol = symbol.trim().toUpperCase();
    if (priceSymbolRef.current !== normalizedSymbol) {
      priceSymbolRef.current = normalizedSymbol;
      priceEditedRef.current = false;
      setPrice(livePrice == null ? "" : livePrice.toFixed(prec));
      return;
    }
    if (!priceEditedRef.current && livePrice != null) {
      setPrice(livePrice.toFixed(prec));
    }
  }, [livePrice, open, prec, symbol]);

  useEffect(() => {
    if (open) setPerm(getBrowserPermission());
  }, [open]);

  useEffect(() => {
    if (open) void refreshPush();
  }, [open, refreshPush]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getExternalNotificationCapabilities()
      .then((caps) => {
        if (cancelled) return;
        setExternalCaps(caps);
        setExternalError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setExternalCaps(null);
        setExternalError(
          error instanceof Error
            ? error.message
            : "External notification setup check failed.",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const sortedSymbols = useMemo(
    () => marketSymbols.map((s) => s.id),
    [marketSymbols],
  );

  const submit = () => {
    if (replayActive) return;
    const target = Number(price);
    if (!symbol.trim()) {
      reportFrontendError(new Error("Choose a market symbol first."), {
        title: "Alert not created",
        logPrefix: "Alert form has no symbol",
      });
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      reportFrontendError(new Error("Enter a target price greater than zero."), {
        title: "Alert not created",
        logPrefix: "Alert form has invalid target price",
      });
      return;
    }
    try {
      createAlert({ symbol, condition, price: target, recurring });
    } catch (error) {
      reportFrontendError(error, {
        title: "Alert not created",
        logPrefix: "Alert form validation failed",
      });
    }
  };

  const enableBrowser = async () => {
    const next = settings.browser;
    if (!next) {
      if (perm === "denied") return;
      const result = await requestBrowserPermission();
      setPerm(result);
      setSettings({ browser: result === "granted" });
    } else {
      setSettings({ browser: false });
    }
  };

  const enablePushForActiveAlerts = () => {
    for (const alert of alerts) {
      if (!alert.push) updateAlert(alert.id, { push: true });
    }
  };

  const enableExternalForActiveAlerts = (
    channel: "telegram" | "discord",
  ) => {
    for (const alert of alerts) {
      if (!alert[channel]) updateAlert(alert.id, { [channel]: true });
    }
  };

  const togglePush = async () => {
    if (settings.push) {
      await push.disable();
      setSettings({ push: false });
      return;
    }

    if (push.registration) {
      setSettings({ push: true });
      enablePushForActiveAlerts();
      return;
    }

    try {
      await push.enable();
      setSettings({ push: true });
      enablePushForActiveAlerts();
    } catch {
      setSettings({ push: false });
    }
  };

  const pushLabel =
    push.status === "registering"
      ? "Push..."
      : push.status === "unsupported"
        ? "No push"
        : push.status === "unconfigured"
          ? "Push setup"
          : push.status === "denied"
            ? "Push blocked"
            : "Push";

  const clearAllActiveAlerts = () => {
    const count = alerts.length;
    if (!count) return;
    void requestConfirm({
      title: t("alerts.clearConfirm", { count }),
      description: t("alerts.clearWarning"),
      confirmLabel: t("alerts.deleteAll"),
      tone: "danger",
    }).then((accepted) => {
      if (accepted) clearAlerts();
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop (mobile) */}
      <div
        className="fixed inset-0 z-[900] bg-[var(--scrim)] backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        data-chart-ui
        className="platform-drawer fixed right-0 top-0 z-[901] flex h-full w-full flex-col border-l border-terminal-border-strong bg-terminal-raised shadow-floating sm:w-[400px]"
        role="dialog"
        aria-modal="true"
        aria-label="Alert Center"
      >
        {/* Header */}
        <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-terminal-border px-4">
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
            className="flex h-10 w-10 items-center justify-center rounded-xl text-ink-muted hover:bg-terminal-hover hover:text-ink"
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
              disabled={perm === "unsupported" || perm === "denied"}
              icon={<Monitor size={12} />}
              label={
                perm === "unsupported"
                  ? "No browser push"
                  : perm === "denied"
                    ? "Browser blocked"
                    : "Browser"
              }
            />
            <Toggle
              on={settings.push && push.status === "enabled"}
              onClick={togglePush}
              disabled={
                push.status === "registering" ||
                push.status === "unsupported" ||
                push.status === "denied"
              }
              icon={<Smartphone size={12} />}
              label={pushLabel}
            />
            <Toggle
              on={settings.telegram && Boolean(externalCaps?.telegram.enabled)}
              onClick={() => {
                const next = !settings.telegram;
                setSettings({ telegram: next });
                if (next) enableExternalForActiveAlerts("telegram");
              }}
              disabled={!externalCaps?.telegram.enabled}
              icon={<Send size={12} />}
              label={
                externalCaps?.telegram.configured ? "Telegram" : "Tele setup"
              }
            />
            <Toggle
              on={settings.discord && Boolean(externalCaps?.discord.enabled)}
              onClick={() => {
                const next = !settings.discord;
                setSettings({ discord: next });
                if (next) enableExternalForActiveAlerts("discord");
              }}
              disabled={!externalCaps?.discord.enabled}
              icon={<Hash size={12} />}
              label={
                externalCaps?.discord.configured ? "Discord" : "Disc setup"
              }
            />
            {push.error && (
              <div className="basis-full text-[10px] leading-4 text-bear">
                {push.error}
              </div>
            )}
            {perm === "denied" &&
              push.error !== NOTIFICATION_PERMISSION_BLOCKED_MESSAGE && (
              <div className="basis-full text-[10px] leading-4 text-choch">
                {NOTIFICATION_PERMISSION_BLOCKED_MESSAGE}
              </div>
            )}
            {externalError && (
              <div className="basis-full text-[10px] leading-4 text-bear">
                {externalError}
              </div>
            )}
          </div>

          {/* Create form */}
          <div className="space-y-3 rounded-xl border border-terminal-border bg-terminal-panel-2 p-3.5">
            <div className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
              New alert
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-2xs text-ink-faint">Symbol</span>
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  className="h-10 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
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
                  onChange={(e) => {
                    priceEditedRef.current = true;
                    setPrice(e.target.value);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  className="h-10 rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-xs text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
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
                disabled={replayActive}
                title={replayActive ? "Alert creation is disabled during Replay" : undefined}
                className="min-h-10 rounded-xl bg-brand px-3.5 text-xs font-semibold text-[var(--accent-contrast)] transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {replayActive ? "Disabled in Replay" : "Create alert"}
              </button>
            </div>
          </div>

          {/* Active alerts */}
          <Section
            title={`Active (${alerts.length})`}
            onClear={alerts.length > 0 ? clearAllActiveAlerts : undefined}
            clearLabel={t("alerts.clearAll")}
          >
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
                  {alertTargetText(a)}
                </span>
                {a.recurring && (
                  <span className="rounded bg-terminal-hover px-1 text-[9px] uppercase text-ink-faint">
                    repeat
                  </span>
                )}
                {a.source?.kind === "drawing" && (
                  <span
                    className="max-w-24 truncate rounded bg-brand/10 px-1 text-[9px] text-brand"
                    title={`${a.source.drawingTool}: ${a.source.targetLabel}`}
                  >
                    Drawing · {a.source.targetLabel}
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
                    {alertTargetText(a)}
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

          {/* Expired dynamic geometry */}
          {expired.length > 0 && (
            <Section
              title={`Expired (${expired.length})`}
              onClear={clearExpired}
            >
              {expired.map((a) => (
                <div
                  key={a.id}
                  className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel-2 px-2.5 py-1.5 opacity-80"
                >
                  <span className="font-mono text-xs font-semibold text-ink">
                    {a.symbol}
                  </span>
                  <span className="text-2xs text-ink-muted">
                    {a.source?.kind === "drawing"
                      ? `${a.source.targetLabel} · expired`
                      : "Technical target · expired"}
                  </span>
                  {a.expiredAt != null && (
                    <span className="text-[9px] text-ink-faint">
                      {fmtDateTime(a.expiredAt)}
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-0.5">
                    <button
                      onClick={() => deleteAlert(a.id)}
                      className="rounded p-1 text-ink-faint hover:bg-terminal-hover hover:text-bear"
                      aria-label="Delete expired alert"
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
      {dialog}
    </>
  );
}

function Section({
  title,
  children,
  onClear,
  clearLabel = "Clear",
}: {
  title: string;
  children: React.ReactNode;
  onClear?: () => void;
  clearLabel?: string;
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
            {clearLabel}
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
