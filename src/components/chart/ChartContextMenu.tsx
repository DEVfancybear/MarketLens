"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bell,
  TrendingDown,
  TrendingUp,
  Plus,
  Minus,
  Star,
  Copy,
  StarOff,
} from "lucide-react";
import { useChartStore } from "@/store/chartStore";
import { useTradeStore } from "@/store/tradeStore";
import { useUIStore } from "@/store/uiStore";
import { useAlertStore, CONDITION_SYMBOL } from "@/store/alertStore";
import { useWatchlistStore } from "@/store/watchlistStore";
import { inferCondition } from "@/services/alertEngine";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice } from "@/utils/format";
import { uid } from "@/utils/id";
import { emit } from "@/utils/bus";
import { cn } from "@/utils/cn";

/** Right-click chart context-menu state (per the spec). */
export interface ContextMenuState {
  visible: boolean;
  /** Viewport (clientX/clientY) anchor for the menu. */
  x: number;
  y: number;
  /** Exact chart price under the cursor (from series.coordinateToPrice). */
  price: number;
  /** Candle time under the cursor, used to anchor drawings. */
  time: number;
}

type MenuItem =
  | { divider: true }
  | {
      divider?: false;
      icon: React.ReactNode;
      label: string;
      danger?: boolean;
      onClick: () => void;
    };

/**
 * TradingView-style chart context menu. Rendered in a portal so it can never be
 * clipped by the chart container, anchored at the cursor and clamped to the
 * viewport. Closes on outside-click and Esc; supports arrow-key navigation.
 */
export function ChartContextMenu({
  state,
  onClose,
}: {
  state: ContextMenuState;
  onClose: () => void;
}) {
  const symbol = useChartStore((s) => s.symbol);
  const addDrawing = useChartStore((s) => s.addDrawing);
  const drawColor = useChartStore((s) => s.drawColor);
  const place = useTradeStore((s) => s.place);
  const setBottomTab = useUIStore((s) => s.setBottomTab);
  const log = useUIStore((s) => s.log);
  const createAlert = useAlertStore((s) => s.createAlert);
  const watchlistSymbols = useWatchlistStore((s) => s.symbols);
  const addToWatchlist = useWatchlistStore((s) => s.add);
  const removeFromWatchlist = useWatchlistStore((s) => s.remove);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  const prec = getMarketSymbol(symbol)?.pricePrecision ?? 2;
  const priceStr = fmtPrice(state.price, prec);

  // ---- Clamp to viewport (auto-reposition near edges) ----
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    let x = state.x;
    let y = state.y;
    if (x + width + pad > window.innerWidth)
      x = window.innerWidth - width - pad;
    if (y + height + pad > window.innerHeight)
      y = window.innerHeight - height - pad;
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [state.x, state.y]);

  // ---- Outside click + Esc + initial focus ----
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    const raf = requestAnimationFrame(() =>
      ref.current
        ?.querySelector<HTMLButtonElement>('button[role="menuitem"]')
        ?.focus(),
    );
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
    };
  }, [onClose]);

  // ---- Arrow-key navigation ----
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>(
        'button[role="menuitem"]',
      ) ?? [],
    );
    const i = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      e.key === "ArrowDown"
        ? (i + 1) % btns.length
        : (i - 1 + btns.length) % btns.length;
    btns[next]?.focus();
  };

  // Run an action then close.
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const items: MenuItem[] = [
    {
      icon: <Bell size={14} className="text-choch" />,
      label: `Create Alert for ${symbol} at ${priceStr}`,
      onClick: act(() => {
        const candles = useChartStore.getState().candles;
        const current = candles[candles.length - 1]?.close;
        const condition = inferCondition(state.price, current);
        createAlert({ symbol, condition, price: state.price });
        log(
          "info",
          `Alert created: ${symbol} ${CONDITION_SYMBOL[condition]} ${priceStr}`,
        );
      }),
    },
    { divider: true },
    // Watchlist
    watchlistSymbols.includes(symbol)
      ? {
          icon: <StarOff size={14} className="text-ink-muted" />,
          label: `Remove ${symbol} from Watchlist`,
          onClick: act(() => removeFromWatchlist(symbol)),
        }
      : {
          icon: <Star size={14} className="text-choch" />,
          label: `Add ${symbol} to Watchlist`,
          onClick: act(() => addToWatchlist(symbol)),
        },
    {
      icon: <Copy size={14} className="text-ink-muted" />,
      label: `Copy Price ${priceStr}`,
      onClick: act(() => {
        navigator.clipboard?.writeText(priceStr);
        log("info", `Copied ${priceStr}`);
      }),
    },
    { divider: true },
    {
      icon: <TrendingDown size={14} className="text-bear" />,
      label: `Sell 1 ${symbol} at ${priceStr}`,
      onClick: act(() => {
        place({
          symbol,
          side: "short",
          type: "limit",
          price: state.price,
          quantity: 1,
        });
        setBottomTab("trade");
      }),
    },
    {
      icon: <TrendingUp size={14} className="text-bull" />,
      label: `Buy 1 ${symbol} above ${priceStr}`,
      onClick: act(() => {
        place({
          symbol,
          side: "long",
          type: "stop",
          price: state.price,
          quantity: 1,
        });
        setBottomTab("trade");
      }),
    },
    {
      icon: <Plus size={14} className="text-ink-muted" />,
      label: `Add Order at ${priceStr}`,
      onClick: act(() => {
        emit("trade:prefill", { type: "limit", price: state.price });
        setBottomTab("trade");
      }),
    },
    { divider: true },
    {
      icon: <Minus size={14} className="text-brand" />,
      label: `Draw Horizontal Line at ${priceStr}`,
      onClick: act(() => {
        addDrawing({
          id: uid("dw"),
          tool: "horizontal",
          color: drawColor,
          lineWidth: 1.5,
          points: [{ time: state.time, price: state.price }],
        });
      }),
    },
  ];

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label="Chart actions"
      onKeyDown={onMenuKeyDown}
      style={{ left: pos.x, top: pos.y, transformOrigin: "top left" }}
      className="context-menu-pop fixed z-[1000] min-w-[260px] overflow-hidden rounded-md border border-terminal-border bg-terminal-panel-2 py-1 shadow-2xl shadow-black/50"
    >
      <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
        {symbol} · {priceStr}
      </div>
      {items.map((it, i) =>
        "divider" in it && it.divider ? (
          <div key={`d${i}`} className="my-1 h-px bg-terminal-border" />
        ) : (
          <button
            key={(it as Exclude<MenuItem, { divider: true }>).label}
            role="menuitem"
            tabIndex={-1}
            onClick={(it as Exclude<MenuItem, { divider: true }>).onClick}
            className={cn(
              "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs text-ink outline-none transition-colors",
              "hover:bg-terminal-hover focus:bg-terminal-hover",
            )}
          >
            <span className="shrink-0">
              {(it as Exclude<MenuItem, { divider: true }>).icon}
            </span>
            <span className="flex-1">
              {(it as Exclude<MenuItem, { divider: true }>).label}
            </span>
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
