"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  X,
  Search,
  Check,
  ChevronDown,
  ChevronUp,
  LayoutGrid,
  MoreHorizontal,
} from "lucide-react";
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
import { getAlertState } from "@/store/alertStore";
import { setAlertCenterAtom } from "@/store/uiStore";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { IconButton } from "@/components/ui/IconButton";
import { fmtPrice } from "@/utils/format";
import { cn } from "@/utils/cn";
import { SymbolLogo } from "./SymbolLogo";
import {
  WatchlistContextMenu,
  type WatchlistMenuState,
} from "./WatchlistContextMenu";
import type { MarketQuote } from "@/types";

/** Stable empty map so symbol-sort never re-renders the parent on ticks. */
const NO_QUOTES: Record<string, MarketQuote> = {};

/** Shared column template so the header row and data rows always align. */
const GRID =
  "grid grid-cols-[minmax(0,1fr)_minmax(60px,74px)_minmax(46px,58px)_minmax(46px,56px)] items-center gap-x-1.5";

/** TradingView renders negatives with a true minus sign and no leading "+". */
const tvSign = (s: string) => s.replace("-", "−");

function fmtChg(v: number | undefined, prec: number): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return tvSign(
    v.toLocaleString("en-US", {
      minimumFractionDigits: prec,
      maximumFractionDigits: prec,
    }),
  );
}

function fmtChgPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "—";
  return tvSign(`${v.toFixed(2)}%`);
}

/**
 * Split a formatted price into [body, superscript last digit] — TradingView
 * raises the final (fractional-pip) digit for FX and metal quotes.
 */
function priceParts(
  v: number | undefined,
  prec: number,
  pip: boolean,
): [string, string] {
  if (v === undefined || !Number.isFinite(v)) return ["—", ""];
  const s = fmtPrice(v, prec);
  return pip && prec >= 1 ? [s.slice(0, -1), s.slice(-1)] : [s, ""];
}

/**
 * TradingView-style realtime watchlist. Each row reads its own quote from
 * `marketDataStore` (`useQuote`), so a tick on one symbol re-renders only that
 * row. The parent reads the quotes map solely to compute sort order (cheap for
 * a small list). No mock data.
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

  // Quotes map used only for value-based sorting. For the default symbol sort
  // we select a stable empty map so the parent does NOT re-render on every
  // tick — only the individual ticked row (via its own useQuote) updates.
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
            : sortKey === "changeAbs"
              ? (q?.change ?? 0)
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
    <div className="flex h-full flex-col bg-terminal-panel">
      {/* Header — "Watchlist ⌄" + actions, like TradingView's panel header */}
      <div className="flex h-[38px] shrink-0 items-center justify-between pl-3 pr-1.5">
        <Dropdown
          width={200}
          trigger={() => (
            <button className="-ml-1.5 flex items-center gap-1 rounded px-1.5 py-1 text-[14px] font-semibold text-ink hover:bg-terminal-hover focus-ring">
              Watchlist
              <ChevronDown size={14} className="text-ink-muted" />
            </button>
          )}
        >
          {(close) => (
            <MenuItem onClick={close}>
              <Check size={13} className="text-brand" />
              <span>Watchlist</span>
              <span className="ml-auto text-2xs text-ink-faint">
                {symbols.length}
              </span>
            </MenuItem>
          )}
        </Dropdown>
        <div className="flex items-center gap-0.5">
          <AddSymbol onAdd={add} existing={symbols} />
          <IconButton
            size="sm"
            label="Grid view (not available)"
            className="cursor-default opacity-40 hover:bg-transparent hover:text-ink-muted"
          >
            <LayoutGrid size={15} />
          </IconButton>
          <SortMenu sortKey={sortKey} onSort={setSort} />
        </div>
      </div>

      {/* Column header — click to sort, like TradingView */}
      <div
        className={cn(
          GRID,
          "h-7 shrink-0 border-b border-terminal-border px-2",
        )}
      >
        <HeaderCell
          label="Symbol"
          k="symbol"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={setSort}
        />
        <HeaderCell
          label="Last"
          k="price"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={setSort}
          right
        />
        <HeaderCell
          label="Chg"
          k="changeAbs"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={setSort}
          right
        />
        <HeaderCell
          label="Chg%"
          k="change"
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={setSort}
          right
        />
      </div>

      {/* Rows */}
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-0.5">
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
      </div>

      {menu && (
        <WatchlistContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          onRemove={onRemove}
          onCreateAlert={onCreateAlert}
        />
      )}
    </div>
  );
}

function HeaderCell({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  right,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sortKey === k;
  return (
    <button
      onClick={() => onSort(k)}
      className={cn(
        "flex items-center gap-px text-[11px] text-ink-faint transition-colors hover:text-ink",
        right && "justify-end",
        active && "text-ink-muted",
      )}
    >
      {label}
      {active &&
        (sortDir === "asc" ? (
          <ChevronUp size={11} />
        ) : (
          <ChevronDown size={11} />
        ))}
    </button>
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
  // FX/metal quotes raise the last (fractional-pip) digit, TradingView-style.
  const pip = meta?.assetClass === "forex" || meta?.assetClass === "metal";
  const up = (quote?.change ?? 0) >= 0;
  const chgColor = up ? "var(--bull)" : "var(--bear)";

  // Tick flash — TradingView flashes only the Last cell (solid bull/bear
  // block + white text, fading out). `seq` keys the span so the CSS animation
  // restarts on every tick, even two same-direction ticks in a row.
  const prevPrice = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; seq: number } | null>(
    null,
  );
  useEffect(() => {
    const last = quote?.last;
    if (
      last !== undefined &&
      prevPrice.current !== undefined &&
      last !== prevPrice.current
    ) {
      const dir = last > prevPrice.current ? "up" : "down";
      setFlash((f) => ({ dir, seq: (f?.seq ?? 0) + 1 }));
    }
    prevPrice.current = last;
  }, [quote?.last]);

  const [body, supDigit] = priceParts(quote?.last, prec, pip);

  return (
    <div
      onClick={() => onSelect(ticker)}
      onContextMenu={(e) => onContextMenu(e, ticker)}
      className={cn(
        GRID,
        "group relative h-[30px] cursor-pointer select-none px-2 hover:bg-terminal-hover",
        // Active symbol: rounded outline, like TradingView's focused row
        active && "rounded-md shadow-[inset_0_0_0_1px_var(--text-faint)]",
      )}
    >
      {/* Symbol + logo */}
      <div className="flex min-w-0 items-center gap-1.5">
        <SymbolLogo id={ticker} />
        <span className="truncate text-[13px] font-semibold leading-none text-ink">
          {ticker}
        </span>
      </div>

      {/* Last — flash cell */}
      <div className="-mr-[3px] text-right">
        <span
          key={flash?.seq ?? 0}
          className={cn(
            "tnum inline-block rounded-sm px-[3px] py-px text-[13px] leading-none text-ink",
            flash?.dir === "up" && "wl-flash-up",
            flash?.dir === "down" && "wl-flash-down",
          )}
        >
          {body}
          {supDigit && (
            <span className="align-super text-[9px]">{supDigit}</span>
          )}
        </span>
      </div>

      {/* Chg (absolute) */}
      <div
        className="tnum truncate text-right text-[13px] leading-none"
        style={{ color: quote ? chgColor : "var(--text-faint)" }}
      >
        {fmtChg(quote?.change, prec)}
      </div>

      {/* Chg% + hover remove */}
      <div
        className="tnum relative text-right text-[13px] leading-none"
        style={{ color: quote ? chgColor : "var(--text-faint)" }}
      >
        {fmtChgPct(quote?.changePct)}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove(ticker);
          }}
          className="absolute -right-1 top-1/2 hidden h-[18px] w-[18px] -translate-y-1/2 items-center justify-center rounded-sm text-ink-faint hover:text-bear group-hover:flex"
          style={{ background: "var(--hover)" }}
          title="Remove"
          aria-label={`Remove ${ticker}`}
        >
          <X size={12} />
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
    { key: "symbol", label: "Symbol name" },
    { key: "price", label: "Last price" },
    { key: "changeAbs", label: "Change" },
    { key: "change", label: "Change %" },
    { key: "volume", label: "Volume" },
  ];
  return (
    <Dropdown
      align="right"
      width={160}
      trigger={() => (
        <IconButton size="sm" label="More">
          <MoreHorizontal size={15} />
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            Sort by
          </div>
          {opts.map((o) => (
            <MenuItem
              key={o.key}
              active={o.key === sortKey}
              onClick={() => {
                onSort(o.key);
                close();
              }}
            >
              {o.label}
            </MenuItem>
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
      width={300}
      trigger={() => (
        <IconButton size="sm" label="Add symbol">
          <Plus size={16} />
        </IconButton>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center gap-1.5 border-b border-terminal-border px-3 pb-2 pt-1">
            <Search size={13} className="text-ink-faint" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search symbol"
              className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <div className="max-h-64 overflow-auto py-1">
            {filtered.map((s) => (
              <button
                key={s.id}
                onClick={() => {
                  onAdd(s.id);
                  close();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-terminal-hover"
              >
                <SymbolLogo id={s.id} />
                <span className="text-xs font-semibold text-ink">{s.id}</span>
                <span className="min-w-0 flex-1 truncate text-2xs text-ink-muted">
                  {s.name}
                </span>
                <span className="rounded bg-terminal-hover px-1.5 py-0.5 text-[9px] uppercase text-ink-faint">
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
