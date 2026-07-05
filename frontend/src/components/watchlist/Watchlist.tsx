"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  LayoutGrid,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Share2,
  Smile,
  X,
} from "lucide-react";
import {
  MARKET_SYMBOLS,
  getMarketSymbol,
} from "@/services/market-data/symbols";
import {
  activeWatchlistAtom,
  watchlistSectionsAtom,
  watchlistSymbolsAtom,
  watchlistSortDirAtom,
  watchlistSortKeyAtom,
  addWatchlistSectionAtom,
  addWatchlistSymbolAtom,
  clearWatchlistAtom,
  copyWatchlistAtom,
  createWatchlistAtom,
  removeWatchlistSymbolAtom,
  renameWatchlistAtom,
  setWatchlistSharedAtom,
  setWatchlistSortAtom,
  type SortKey,
  type WatchlistSection,
} from "@/store/watchlistStore";
import { useAtomValue, useSetAtom } from "jotai";
import {
  getMarketDataState,
  useMarketDataStore,
} from "@/store/marketDataStore";
import { useQuote } from "@/hooks/useQuote";
import { setSymbolAtom, symbolAtom } from "@/store/chartStore";
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

const NO_QUOTES: Record<string, MarketQuote> = {};

const GRID =
  "grid grid-cols-[minmax(0,1fr)_minmax(60px,74px)_minmax(46px,58px)_minmax(46px,56px)] items-center gap-x-1.5";

type DisplayRow =
  | { kind: "section"; section: WatchlistSection }
  | { kind: "symbol"; ticker: string };

function tvSign(s: string): string {
  return s.replace("-", "\u2212");
}

function fmtChg(v: number | undefined, prec: number): string {
  if (v === undefined || !Number.isFinite(v)) return "\u2014";
  return tvSign(
    v.toLocaleString("en-US", {
      minimumFractionDigits: prec,
      maximumFractionDigits: prec,
    }),
  );
}

function fmtChgPct(v: number | undefined): string {
  if (v === undefined || !Number.isFinite(v)) return "\u2014";
  return tvSign(`${v.toFixed(2)}%`);
}

function priceParts(
  v: number | undefined,
  prec: number,
  pip: boolean,
): [string, string] {
  if (v === undefined || !Number.isFinite(v)) return ["\u2014", ""];
  const s = fmtPrice(v, prec);
  return pip && prec >= 1 ? [s.slice(0, -1), s.slice(-1)] : [s, ""];
}

export function Watchlist() {
  const activeList = useAtomValue(activeWatchlistAtom);
  const symbols = useAtomValue(watchlistSymbolsAtom);
  const sections = useAtomValue(watchlistSectionsAtom);
  const sortKey = useAtomValue(watchlistSortKeyAtom);
  const sortDir = useAtomValue(watchlistSortDirAtom);

  const add = useSetAtom(addWatchlistSymbolAtom);
  const remove = useSetAtom(removeWatchlistSymbolAtom);
  const setSort = useSetAtom(setWatchlistSortAtom);
  const renameWatchlist = useSetAtom(renameWatchlistAtom);
  const setShared = useSetAtom(setWatchlistSharedAtom);
  const copyWatchlist = useSetAtom(copyWatchlistAtom);
  const createWatchlist = useSetAtom(createWatchlistAtom);
  const clearWatchlist = useSetAtom(clearWatchlistAtom);
  const addSection = useSetAtom(addWatchlistSectionAtom);

  const activeSymbol = useAtomValue(symbolAtom);
  const setSymbol = useSetAtom(setSymbolAtom);
  const setAlertCenter = useSetAtom(setAlertCenterAtom);

  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(activeList.name);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const skipRenameBlurRef = useRef(false);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(
    {},
  );

  const quotes = useMarketDataStore((s) =>
    sortKey === "symbol" ? NO_QUOTES : s.quotes,
  );

  useEffect(() => {
    if (!renaming) setRenameDraft(activeList.name);
  }, [activeList.name, renaming]);

  useEffect(() => {
    if (!renaming) return;
    requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renaming]);

  const ordered = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const list = [...symbols];
    if (sortKey === "symbol") {
      return list.sort((a, b) => a.localeCompare(b) * dir);
    }
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

  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!sections.length) {
      return ordered.map((ticker) => ({ kind: "symbol", ticker }));
    }

    const rows: DisplayRow[] = [];
    const sortedSections = [...sections].sort((a, b) => a.index - b.index);
    let sectionIndex = 0;

    // Sections represent manual watchlist grouping, so render grouped rows in
    // list order instead of moving section headers away from their symbols.
    for (let index = 0; index <= symbols.length; index += 1) {
      while (
        sortedSections[sectionIndex] &&
        sortedSections[sectionIndex].index === index
      ) {
        rows.push({
          kind: "section",
          section: sortedSections[sectionIndex],
        });
        sectionIndex += 1;
      }
      if (index < symbols.length) {
        rows.push({ kind: "symbol", ticker: symbols[index] });
      }
    }

    while (sortedSections[sectionIndex]) {
      rows.push({
        kind: "section",
        section: sortedSections[sectionIndex],
      });
      sectionIndex += 1;
    }

    return rows;
  }, [ordered, sections, symbols]);

  const commitRename = useCallback(() => {
    renameWatchlist(renameDraft);
    setRenaming(false);
  }, [renameDraft, renameWatchlist]);

  const cancelRename = useCallback(() => {
    skipRenameBlurRef.current = true;
    setRenameDraft(activeList.name);
    setRenaming(false);
  }, [activeList.name]);

  const startRename = useCallback(() => {
    setRenameDraft(activeList.name);
    setRenaming(true);
  }, [activeList.name]);

  const onSelect = useCallback(
    (ticker: string) => setSymbol(ticker),
    [setSymbol],
  );
  const onRemove = useCallback((ticker: string) => remove(ticker), [remove]);

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

  const renderRows = () => {
    let hiddenBySection = false;
    return displayRows.map((row) => {
      if (row.kind === "section") {
        hiddenBySection = !!collapsedSections[row.section.id];
        return (
          <SectionRow
            key={`section-${row.section.id}`}
            section={row.section}
            collapsed={hiddenBySection}
            onToggle={() =>
              setCollapsedSections((prev) => ({
                ...prev,
                [row.section.id]: !prev[row.section.id],
              }))
            }
          />
        );
      }

      if (hiddenBySection) return null;
      return (
        <WatchRow
          key={row.ticker}
          ticker={row.ticker}
          active={row.ticker === activeSymbol}
          onSelect={onSelect}
          onRemove={onRemove}
          onContextMenu={onRowContext}
        />
      );
    });
  };

  return (
    <div className="flex h-full flex-col bg-terminal-panel">
      <div className="flex h-[38px] shrink-0 items-center justify-between pl-3 pr-1.5">
        {renaming ? (
          <div className="-ml-1.5 mr-2 flex h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-sm border border-brand bg-terminal-hover px-2 shadow-[0_0_0_1px_rgba(41,98,255,0.28)]">
            <Smile size={15} className="shrink-0 text-ink-muted" />
            <input
              ref={renameInputRef}
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={() => {
                if (skipRenameBlurRef.current) {
                  skipRenameBlurRef.current = false;
                  return;
                }
                commitRename();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") cancelRename();
              }}
              className="min-w-0 flex-1 bg-transparent text-[14px] font-semibold text-ink outline-none selection:bg-brand selection:text-white"
              aria-label="Rename watchlist"
            />
          </div>
        ) : (
          <WatchlistTitleMenu
            name={activeList.name}
            shared={activeList.shared}
            symbolCount={symbols.length}
            sectionCount={sections.length}
            onToggleShare={() => setShared()}
            onCopy={copyWatchlist}
            onRename={startRename}
            onAddSection={() => {
              const activeIndex = symbols.indexOf(activeSymbol);
              addSection({
                title: `SECTION ${sections.length + 1}`,
                index: activeIndex >= 0 ? activeIndex : symbols.length,
              });
            }}
            onClear={clearWatchlist}
            onCreate={() => {
              const name = window.prompt("Create new list", "Untitled list");
              if (name !== null) createWatchlist(name);
            }}
          />
        )}

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

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-0.5">
        {renderRows()}
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

function WatchlistTitleMenu({
  name,
  shared,
  symbolCount,
  sectionCount,
  onToggleShare,
  onCopy,
  onRename,
  onAddSection,
  onClear,
  onCreate,
}: {
  name: string;
  shared: boolean;
  symbolCount: number;
  sectionCount: number;
  onToggleShare: () => void;
  onCopy: () => void;
  onRename: () => void;
  onAddSection: () => void;
  onClear: () => void;
  onCreate: () => void;
}) {
  return (
    <Dropdown
      width={216}
      trigger={(open) => (
        <button
          className={cn(
            "-ml-1.5 flex max-w-[180px] items-center gap-1 rounded px-1.5 py-1 text-[14px] font-semibold text-ink hover:bg-terminal-hover focus-ring",
            open && "bg-terminal-hover",
          )}
        >
          <span className="truncate">{name}</span>
          {open ? (
            <ChevronUp size={14} className="shrink-0 text-ink-muted" />
          ) : (
            <ChevronDown size={14} className="shrink-0 text-ink-muted" />
          )}
        </button>
      )}
    >
      {(close) => (
        <div className="py-0.5">
          <WatchlistMenuRow
            icon={<Share2 size={16} />}
            label="Share list"
            onClick={onToggleShare}
          >
            <span
              className={cn(
                "ml-auto inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors",
                shared ? "bg-brand" : "bg-terminal-border",
              )}
            >
              <span
                className={cn(
                  "h-4 w-4 rounded-full bg-ink transition-transform",
                  shared && "translate-x-4",
                )}
              />
            </span>
          </WatchlistMenuRow>
          <WatchlistMenuRow
            icon={<Copy size={16} />}
            label="Make a copy..."
            onClick={() => {
              onCopy();
              close();
            }}
          />
          <WatchlistMenuRow
            icon={<Pencil size={16} />}
            label="Rename"
            onClick={() => {
              close();
              onRename();
            }}
          />
          <WatchlistMenuRow
            icon={<Plus size={16} />}
            label="Add section"
            onClick={() => {
              onAddSection();
              close();
            }}
          >
            <span className="ml-auto text-[10px] text-ink-faint">
              {sectionCount + 1}
            </span>
          </WatchlistMenuRow>
          <WatchlistMenuRow
            icon={<Eraser size={16} />}
            label="Clear list"
            disabled={symbolCount === 0}
            onClick={() => {
              onClear();
              close();
            }}
          />
          <div className="my-1 h-px bg-terminal-border" />
          <WatchlistMenuRow
            icon={<Plus size={16} />}
            label="Create new list..."
            onClick={() => {
              close();
              onCreate();
            }}
          />
        </div>
      )}
    </Dropdown>
  );
}

function WatchlistMenuRow({
  icon,
  label,
  onClick,
  disabled,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 px-3 text-left text-[12px] font-semibold text-ink transition-colors hover:bg-terminal-hover disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-ink-muted">
        {icon}
      </span>
      <span>{label}</span>
      {children}
    </button>
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

function SectionRow({
  section,
  collapsed,
  onToggle,
}: {
  section: WatchlistSection;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex h-[26px] w-full items-center gap-1 border-y border-[#32467e] bg-[#22356d] px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#96a0bd] hover:bg-[#27407f]"
    >
      <ChevronDown
        size={13}
        className={cn(
          "shrink-0 text-[#96a0bd] transition-transform",
          collapsed && "-rotate-90",
        )}
      />
      <span className="truncate">{section.title}</span>
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
  const pip = meta?.assetClass === "forex" || meta?.assetClass === "metal";
  const up = (quote?.change ?? 0) >= 0;
  const chgColor = up ? "var(--bull)" : "var(--bear)";

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
        active && "rounded-md shadow-[inset_0_0_0_1px_var(--text-faint)]",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <SymbolLogo id={ticker} />
        <span className="truncate text-[13px] font-semibold leading-none text-ink">
          {ticker}
        </span>
      </div>

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

      <div
        className="tnum truncate text-right text-[13px] leading-none"
        style={{ color: quote ? chgColor : "var(--text-faint)" }}
      >
        {fmtChg(quote?.change, prec)}
      </div>

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
