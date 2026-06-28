"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, X, ArrowUpDown, Search } from "lucide-react";
import {
  MARKET_SYMBOLS,
  getMarketSymbol,
} from "@/services/market-data/symbols";
import {
  watchlistSymbolsAtom,
  watchlistSortKeyAtom,
  watchlistSortDirAtom,
  addWatchlistSymbolAtom,
  removeWatchlistSymbolAtom,
  setWatchlistSortAtom,
  type SortKey,
} from "@/store/watchlistStore";
import { useAtomValue, useSetAtom } from "jotai";
import {
  useMarketDataStore,
  getMarketDataState,
} from "@/store/marketDataStore";
import { useQuote } from "@/hooks/useQuote";
import { symbolAtom, setSymbolAtom } from "@/store/chartStore";
import { useAlertStore, getAlertState } from "@/store/alertStore";
import { setAlertCenterAtom } from "@/store/uiStore";
import { Dropdown } from "@/components/ui/Dropdown";
import { Panel } from "@/components/ui/Panel";
import { IconButton } from "@/components/ui/IconButton";
import { fmtPrice, fmtPct, fmtVolume } from "@/utils/format";
import { cn } from "@/utils/cn";
import {
  WatchlistContextMenu,
  type WatchlistMenuState,
} from "./WatchlistContextMenu";
import type { MarketQuote } from "@/types";

/** Stable empty map so symbol-sort never re-renders the parent on ticks. */
const NO_QUOTES: Record<string, MarketQuote> = {};

/**
 * Realtime watchlist. Each row reads its own quote from `marketDataStore`
 * (`useQuote`), so a tick on one symbol re-renders only that row. The parent
 * reads the quotes map solely to compute sort order (cheap for a small list).
 * No mock data, no React Query.
 */
export function Watchlist() {
  const symbols = useAtomValue(watchlistSymbolsAtom);
  const sortKey = useAtomValue(watchlistSortKeyAtom);
  const sortDir = useAtomValue(watchlistSortDirAtom);
  const add = useSetAtom(addWatchlistSymbolAtom);
  const remove = useSetAtom(removeWatchlistSymbolAtom);
  const setSort = useSetAtom(setWatchlistSortAtom);

  const activeSymbol = useAtomValue(symbolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const setAlertCenter = useSetAtom(setAlertCenterAtom);

  // Quotes map used only for value-based sorting. For the default symbol sort we
  // select a stable empty map so the parent does NOT re-render on every tick —
  // only the individual ticked row (via its own useQuote) updates.
  const quotes = useMarketDataStore((s) =>
    sortKey === "symbol" ? NO_QUOTES : s.quotes,
  );

  const ordered = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const list = [...symbols];
    if (sortKey === "symbol")
      return list.sort((a, b) => a.localeCompare(b) * dir);
    return list.sort((a, b) => {
      const qa = quotes[a];
      const qb = quotes[b];
      const pick = (q?: MarketQuote) =>
        sortKey === "price"
          ? (q?.last ?? 0)
          : sortKey === "change"
            ? (q?.changePct ?? 0)
            : (q?.volume ?? 0);
      return (pick(qa) - pick(qb)) * dir;
    });
  }, [symbols, sortKey, sortDir, quotes]);

  const onSelect = useCallback(
    (ticker: string) => setSymbol(ticker),
    [setSymbol],
  );
  const onRemove = useCallback((ticker: string) => remove(ticker), [remove]);

  // Watchlist row context menu
  const [menu, setMenu] = useState<WatchlistMenuState | null>(null);
  const onRowContext = useCallback((e: React.MouseEvent, ticker: string) => {
    e.preventDefault();
    setMenu({ ticker, x: e.clientX, y: e.clientY });
  }, []);

  const onCreateAlert = useCallback(
    (ticker: string) => {
      const store = getAlertState();
      const quote = getMarketDataState().quotes[ticker];
      const price = quote?.last ?? 0;
      store.createAlert({ symbol: ticker, condition: "crossUp", price });
      setAlertCenter(true);
    },
    [setAlertCenter],
  );

  return (
    <Panel
      title="Watchlist"
      actions={
        <>
          <SortMenu sortKey={sortKey} onSort={setSort} />
          <AddSymbol onAdd={add} existing={symbols} />
        </>
      }
    >
      <div className="grid grid-cols-[1fr_70px_60px] gap-x-2 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg%</span>
      </div>
      {ordered.map((ticker) => (
        <WatchRow
          key={ticker}
          ticker={ticker}
          active={ticker === activeSymbol}
          onSelect={onSelect}
          onRemove={onRemove}
          onContextMenu={onRowContext}
        />
      ))}
      {menu && (
        <WatchlistContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onRemove={onRemove}
          onCreateAlert={onCreateAlert}
        />
      )}
    </Panel>
  );
}

interface RowProps {
  ticker: string;
  active: boolean;
  onSelect: (t: string) => void;
  onRemove: (t: string) => void;
  onContextMenu: (e: React.MouseEvent, ticker: string) => void;
}

/** Memoized so sibling ticks don't re-render this row; price comes from its own selector. */
const WatchRow = memo(function WatchRow({
  ticker,
  active,
  onSelect,
  onRemove,
  onContextMenu,
}: RowProps) {
  const quote = useQuote(ticker);
  const meta = getMarketSymbol(ticker);
  const prec = meta?.pricePrecision ?? 2;
  const up = (quote?.changePct ?? 0) >= 0;

  // Price-flash on update
  const prevPrice = useRef<number | undefined>(quote?.last);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  useEffect(() => {
    if (
      quote &&
      prevPrice.current !== undefined &&
      quote.last !== prevPrice.current
    ) {
      setFlash(quote.last > prevPrice.current ? "up" : "down");
      const t = setTimeout(() => setFlash(null), 350);
      prevPrice.current = quote.last;
      return () => clearTimeout(t);
    }
    prevPrice.current = quote?.last;
  }, [quote?.last]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      onClick={() => onSelect(ticker)}
      onContextMenu={(e) => onContextMenu(e, ticker)}
      className={cn(
        "group grid cursor-pointer grid-cols-[1fr_70px_60px] items-center gap-x-2 px-3 py-0.5 h-7 transition-colors hover:bg-terminal-hover",
        // Active: blue left border + subtle tint
        active && "border-l-[3px] border-l-brand bg-brand/5 pl-[9px]",
        // Price flash
        flash === "up" && "animate-watch-flash-up",
        flash === "down" && "animate-watch-flash-down",
      )}
    >
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold leading-none text-ink">
          {ticker}
        </div>
        <div className="truncate text-[11px] leading-none text-ink-faint">
          {meta?.exchange ?? ""}
        </div>
      </div>
      <div className="tabular text-right text-[13px] leading-none text-ink">
        {quote ? fmtPrice(quote.last, prec) : "—"}
      </div>
      <div className="flex items-center justify-end gap-1">
        <span
          className="tabular text-right text-[13px] leading-none"
          style={{ color: up ? "var(--bull)" : "var(--bear)" }}
        >
          {quote ? fmtPct(quote.changePct) : "—"}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(ticker);
          }}
          className="opacity-0 transition-opacity group-hover:opacity-100"
          title="Remove"
          aria-label={`Remove ${ticker}`}
        >
          <X size={12} className="text-ink-faint hover:text-bear" />
        </button>
      </div>
    </div>
  );
});

function SortMenu({
  sortKey,
  onSort,
}: {
  sortKey: SortKey;
  onSort: (k: SortKey) => void;
}) {
  const opts: { key: SortKey; label: string }[] = [
    { key: "symbol", label: "Symbol" },
    { key: "price", label: "Last price" },
    { key: "change", label: "Change %" },
    { key: "volume", label: "Volume" },
  ];
  return (
    <Dropdown
      align="right"
      width={150}
      trigger={() => (
        <IconButton size="sm" label="Sort">
          <ArrowUpDown size={13} />
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          {opts.map((o) => (
            <button
              key={o.key}
              onClick={() => {
                onSort(o.key);
                close();
              }}
              className={cn(
                "flex w-full px-3 py-1.5 text-left text-xs hover:bg-terminal-hover",
                o.key === sortKey ? "text-brand" : "text-ink",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}

function AddSymbol({
  onAdd,
  existing,
}: {
  onAdd: (t: string) => void;
  existing: string[];
}) {
  const [q, setQ] = useState("");
  const avail = MARKET_SYMBOLS.filter((s) => !existing.includes(s.id));
  const filtered = avail.filter(
    (s) =>
      s.id.toLowerCase().includes(q.toLowerCase()) ||
      s.name.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <Dropdown
      align="right"
      width={260}
      trigger={() => (
        <IconButton size="sm" label="Add symbol">
          <Plus size={14} />
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1">
            <Search size={12} className="text-ink-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Add symbol…"
              className="w-full bg-transparent text-xs text-ink outline-none"
            />
          </div>
          <div className="max-h-60 overflow-auto">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onAdd(s.id);
                  close();
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-terminal-hover"
              >
                <span className="text-xs font-semibold text-ink">{s.id}</span>
                <span className="ml-2 truncate text-2xs text-ink-muted">
                  {s.name}
                </span>
                <span className="ml-auto rounded bg-terminal-hover px-1.5 py-0.5 text-[9px] uppercase text-ink-faint">
                  {s.exchange}
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-center text-2xs text-ink-faint">
                Nothing to add
              </div>
            )}
          </div>
        </div>
      )}
    </Dropdown>
  );
}
