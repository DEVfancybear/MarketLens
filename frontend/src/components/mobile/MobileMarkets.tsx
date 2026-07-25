"use client";

import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ArrowDownAZ,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ListFilter,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import {
  activeWatchlistAtom,
  activeWatchlistIdAtom,
  addWatchlistSymbolAtom,
  clearWatchlistAtom,
  createWatchlistAtom,
  addWatchlistSectionAtom,
  moveWatchlistSectionAtom,
  moveWatchlistSymbolAtom,
  removeWatchlistAtom,
  removeWatchlistSectionAtom,
  removeWatchlistSymbolAtom,
  renameWatchlistAtom,
  renameWatchlistSectionAtom,
  setActiveWatchlistAtom,
  setWatchlistSortAtom,
  watchlistListsAtom,
  watchlistSortDirAtom,
  watchlistSortKeyAtom,
  watchlistSectionsAtom,
  type SortKey,
} from "@/store/watchlistStore";
import { quotesAtom } from "@/store/marketDataStore";
import { setSymbolAtom, symbolAtom } from "@/store/chartStore";
import { useMarketSymbols } from "@/store/marketSymbolStore";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { fmtPrice } from "@/utils/format";
import { cn } from "@/utils/cn";
import { SymbolLogo } from "@/components/watchlist/SymbolLogo";
import { usePlatformDialog } from "@/components/ui/PlatformDialog";
import { sortWatchlistSymbols } from "@/store/watchlistSort";
import { MobileSheet } from "./MobileSheet";

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "manual", label: "Custom order" },
  { key: "symbol", label: "Symbol" },
  { key: "price", label: "Price" },
  { key: "change", label: "Change %" },
  { key: "changeAbs", label: "Change" },
  { key: "volume", label: "Volume" },
];

type MobileMarketRow =
  | { kind: "section"; id: string; title: string; count: number; collapsed: boolean }
  | { kind: "symbol"; ticker: string };

export function MobileMarkets({ onOpenChart }: { onOpenChart: () => void }) {
  const list = useAtomValue(activeWatchlistAtom);
  const activeListId = useAtomValue(activeWatchlistIdAtom);
  const lists = useAtomValue(watchlistListsAtom);
  const sortKey = useAtomValue(watchlistSortKeyAtom);
  const sortDir = useAtomValue(watchlistSortDirAtom);
  const sections = useAtomValue(watchlistSectionsAtom);
  const quotes = useAtomValue(quotesAtom);
  const active = useAtomValue(symbolAtom);
  const catalog = useMarketSymbols();
  const setSymbol = useSetAtom(setSymbolAtom);
  const addSymbol = useSetAtom(addWatchlistSymbolAtom);
  const removeSymbol = useSetAtom(removeWatchlistSymbolAtom);
  const setActiveList = useSetAtom(setActiveWatchlistAtom);
  const createList = useSetAtom(createWatchlistAtom);
  const renameList = useSetAtom(renameWatchlistAtom);
  const removeList = useSetAtom(removeWatchlistAtom);
  const clearList = useSetAtom(clearWatchlistAtom);
  const setSort = useSetAtom(setWatchlistSortAtom);
  const addSection = useSetAtom(addWatchlistSectionAtom);
  const renameSection = useSetAtom(renameWatchlistSectionAtom);
  const removeSection = useSetAtom(removeWatchlistSectionAtom);
  const moveSection = useSetAtom(moveWatchlistSectionAtom);
  const moveSymbol = useSetAtom(moveWatchlistSymbolAtom);
  const [searchOpen, setSearchOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const { requestPrompt, requestConfirm, dialog } = usePlatformDialog();

  const symbols = list.symbols;
  const displayedSymbols = useMemo(() => {
    return sortWatchlistSymbols(
      symbols.map((ticker, index) => ({ ticker, index })),
      sortKey,
      sortDir,
      quotes,
    ).map((entry) => entry.ticker);
  }, [quotes, sortDir, sortKey, symbols]);
  const marketRows = useMemo<MobileMarketRow[]>(() => {
    if (!sections.length) {
      return displayedSymbols.map((ticker) => ({ kind: "symbol", ticker }));
    }

    const ordered = [...sections].sort((a, b) => a.index - b.index);
    if (!list.symbols.length) {
      return [
        ...displayedSymbols.map((ticker): MobileMarketRow => ({ kind: "symbol", ticker })),
        ...ordered.map((section): MobileMarketRow => ({
          kind: "section",
          id: section.id,
          title: section.title,
          count: 0,
          collapsed: collapsedSections.has(section.id),
        })),
      ];
    }

    const rows: MobileMarketRow[] = [];
    const appendSymbols = (from: number, to: number) => {
      const members = new Set(list.symbols.slice(from, to));
      for (const ticker of displayedSymbols) {
        if (members.has(ticker)) rows.push({ kind: "symbol", ticker });
      }
    };

    appendSymbols(0, ordered[0]?.index ?? list.symbols.length);
    ordered.forEach((section, index) => {
      const end = ordered[index + 1]?.index ?? list.symbols.length;
      const collapsed = collapsedSections.has(section.id);
      rows.push({
        kind: "section",
        id: section.id,
        title: section.title,
        count: Math.max(0, end - section.index),
        collapsed,
      });
      if (!collapsed) appendSymbols(section.index, end);
    });
    return rows;
  }, [collapsedSections, displayedSymbols, list.symbols, sections]);
  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    if (!value) return catalog;
    return catalog.filter(
      (item) =>
        item.id.toLowerCase().includes(value) ||
        item.name.toLowerCase().includes(value) ||
        item.exchange.toLowerCase().includes(value),
    );
  }, [catalog, query]);

  const openSymbol = (ticker: string) => {
    setSymbol(ticker);
    setSearchOpen(false);
    setQuery("");
    onOpenChart();
  };

  const createNewList = () => {
    void requestPrompt({
      title: "Create new list",
      label: "List name",
      defaultValue: "New watchlist",
    }).then((value) => {
      const name = value?.trim();
      if (name) createList(name);
    });
  };

  const renameActiveList = () => {
    void requestPrompt({
      title: "Rename watchlist",
      label: "List name",
      defaultValue: list.name,
    }).then((value) => {
      const name = value?.trim();
      if (name) renameList(name);
    });
  };

  const clearActiveList = () => {
    void requestConfirm({
      title: `Clear “${list.name}”?`,
      description: "All instruments will be removed from this watchlist.",
      confirmLabel: "Clear list",
      tone: "danger",
    }).then((accepted) => {
      if (accepted) clearList();
    });
  };

  const deleteActiveList = () => {
    void requestConfirm({
      title: `Delete “${list.name}”?`,
      description: "This watchlist and its sections will be permanently removed.",
      confirmLabel: "Delete list",
      tone: "danger",
    }).then((accepted) => {
      if (accepted) removeList(activeListId);
    });
  };

  const createSection = () => {
    void requestPrompt({
      title: "Add section",
      label: "Section name",
      defaultValue: "New section",
    }).then((value) => {
      const title = value?.trim();
      if (title) addSection(title);
    });
  };

  const renameSectionById = (sectionId: string, currentTitle: string) => {
    void requestPrompt({
      title: "Rename section",
      label: "Section name",
      defaultValue: currentTitle,
    }).then((value) => {
      const title = value?.trim();
      if (title) renameSection(sectionId, title);
    });
  };

  const deleteSectionById = (sectionId: string, title: string) => {
    void requestConfirm({
      title: `Delete section “${title}”?`,
      description: "Instruments in the section will stay in the watchlist.",
      confirmLabel: "Delete section",
      tone: "danger",
    }).then((accepted) => {
      if (accepted) removeSection(sectionId);
    });
  };

  return (
    <section className="mobile-screen">
      <header className="mobile-screen-header">
        <div><small>MARKETS</small><h1>{list.name}</h1></div>
        <div className="mobile-header-actions">
          <button type="button" className="mobile-icon-button" aria-label="Search markets" onClick={() => setSearchOpen(true)}><Search size={20} /></button>
          <button type="button" className="mobile-icon-button" aria-label="Manage watchlists" onClick={() => setManageOpen(true)}><ListFilter size={20} /></button>
        </div>
      </header>
      <div className="mobile-market-summary"><Star size={16} /><span>{symbols.length} instruments</span><span>{SORT_OPTIONS.find((option) => option.key === sortKey)?.label}{sortKey === "manual" ? "" : ` ${sortDir === "asc" ? "↑" : "↓"}`}</span><span className="ml-auto text-bull">Live</span></div>
      <div className="mobile-market-list">
        {marketRows.length === 0 && (
          <div className="mobile-empty-state mobile-market-empty"><strong>This watchlist is empty</strong><span>Search the MT5 catalog to add your first instrument.</span><button type="button" aria-label="Find a market to add" onClick={() => setSearchOpen(true)}><Search size={17} />Search markets</button></div>
        )}
        {marketRows.map((row) => {
          if (row.kind === "section") {
            return <button
              type="button"
              key={`section-${row.id}`}
              className={cn("mobile-market-section", row.collapsed && "is-collapsed")}
              aria-expanded={!row.collapsed}
              onClick={() => setCollapsedSections((current) => {
                const next = new Set(current);
                if (next.has(row.id)) next.delete(row.id);
                else next.add(row.id);
                return next;
              })}
            >
              <ChevronDown size={17} />
              <strong>{row.title}</strong>
              <small>{row.count}</small>
            </button>;
          }
          const ticker = row.ticker;
          const quote = quotes[ticker];
          const meta = getMarketSymbol(ticker);
          const positive = (quote?.changePct ?? 0) >= 0;
          return <button type="button" key={ticker} className={cn("mobile-market-row", active === ticker && "is-active")} onClick={() => openSymbol(ticker)}>
            <span className="mobile-symbol-avatar" aria-hidden="true"><SymbolLogo id={ticker} size={26} /></span>
            <span className="mobile-symbol-copy"><strong>{ticker}</strong><small>{meta?.name ?? meta?.exchange ?? "Market"}</small></span>
            <span className="mobile-quote"><strong>{quote ? fmtPrice(quote.last, meta?.pricePrecision ?? 2) : "—"}</strong><small className={positive ? "text-bull" : "text-bear"}>{quote ? `${positive ? "+" : ""}${quote.changePct.toFixed(2)}%` : "Waiting"}</small></span>
            <ChevronRight size={17} className="text-ink-faint" />
          </button>;
        })}
      </div>

      {searchOpen && (
        <MobileSheet title="Search markets" onClose={() => { setSearchOpen(false); setQuery(""); }} fullscreen>
          <label className="mobile-picker-search"><Search size={18} /><input type="search" autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, market or venue" inputMode="search" /></label>
          <div className="mobile-market-search-results">
            {results.map((item) => {
              const included = list.symbols.includes(item.id);
              return <article key={item.id}>
                <button type="button" className="mobile-market-search-main" onClick={() => openSymbol(item.id)}>
                  <span className="mobile-symbol-avatar" aria-hidden="true"><SymbolLogo id={item.id} size={26} /></span><span><strong>{item.id}</strong><small>{item.name} · {item.exchange}</small></span>{item.id === active && <Check size={18} />}
                </button>
                <button type="button" className={cn("mobile-watchlist-toggle", included && "is-active")} aria-label={`${included ? "Remove" : "Add"} ${item.id} ${included ? "from" : "to"} watchlist`} aria-pressed={included} onClick={() => included ? removeSymbol(item.id) : addSymbol(item.id)}>{included ? <X size={18} /> : <Plus size={18} />}</button>
              </article>;
            })}
            {results.length === 0 && <div className="mobile-empty-state"><strong>No markets found</strong><span>Check the MT5 catalog connection or try another search.</span></div>}
          </div>
        </MobileSheet>
      )}

      {manageOpen && (
        <MobileSheet title="Manage watchlists" onClose={() => setManageOpen(false)} fullscreen>
          <div className="mobile-watchlist-manager">
            <section>
              <div className="mobile-workspace-section-heading"><span><Star size={17} /></span><div><h3>Watchlists</h3><p>Switch or manage the shared lists</p></div></div>
              <div className="mobile-watchlist-list">
                {lists.map((item) => <button key={item.id} type="button" aria-pressed={item.id === activeListId} className={cn(item.id === activeListId && "is-active")} onClick={() => setActiveList(item.id)}><span><strong>{item.name}</strong><small>{item.symbols.length} instruments</small></span>{item.id === activeListId && <Check size={18} />}</button>)}
              </div>
              <div className="mobile-watchlist-actions">
                <button type="button" onClick={createNewList}><Plus size={17} />New</button>
                <button type="button" onClick={renameActiveList}><Pencil size={17} />Rename</button>
                <button type="button" disabled={!list.symbols.length} onClick={clearActiveList}><Trash2 size={17} />Clear</button>
                <button type="button" className="is-danger" disabled={lists.length <= 1} onClick={deleteActiveList}><Trash2 size={17} />Delete</button>
              </div>
            </section>
            <section>
              <div className="mobile-workspace-section-heading"><span><ArrowDownAZ size={17} /></span><div><h3>Sort instruments</h3><p>Tap the active field again to reverse direction</p></div></div>
              <div className="mobile-sort-options">{SORT_OPTIONS.map((option) => <button key={option.key} type="button" aria-pressed={sortKey === option.key} className={cn(sortKey === option.key && "is-active")} onClick={() => setSort(option.key)}>{option.label}{sortKey === option.key && option.key !== "manual" && <span>{sortDir === "asc" ? "↑" : "↓"}</span>}</button>)}</div>
            </section>
            <section>
              <div className="mobile-workspace-section-heading"><span><ListFilter size={17} /></span><div><h3>Sections</h3><p>Group and reorder the shared watchlist</p></div></div>
              <button type="button" className="mobile-add-section" onClick={createSection}><Plus size={17} />Add section</button>
              <div className="mobile-watchlist-sections">
                {[...sections].sort((a, b) => a.index - b.index).map((section, index, ordered) => <article key={section.id}>
                  <span><strong>{section.title}</strong><small>Starts at instrument {section.index + 1}</small></span>
                  <div>
                    <button type="button" aria-label={`Move ${section.title} up`} disabled={index === 0} onClick={() => { const previous = ordered[index - 1]; if (previous) moveSection({ sectionId: section.id, target: { kind: "section", sectionId: previous.id, edge: "before" } }); }}><ArrowUp size={17} /></button>
                    <button type="button" aria-label={`Move ${section.title} down`} disabled={index === ordered.length - 1} onClick={() => { const next = ordered[index + 1]; if (next) moveSection({ sectionId: section.id, target: { kind: "section", sectionId: next.id, edge: "after" } }); }}><ArrowDown size={17} /></button>
                    <button type="button" aria-label={`Rename ${section.title}`} onClick={() => renameSectionById(section.id, section.title)}><Pencil size={17} /></button>
                    <button type="button" aria-label={`Delete ${section.title}`} className="is-danger" onClick={() => deleteSectionById(section.id, section.title)}><Trash2 size={17} /></button>
                  </div>
                </article>)}
                {sections.length === 0 && <p>No sections yet.</p>}
              </div>
            </section>
            <section>
              <div className="mobile-workspace-section-heading"><span><ListFilter size={17} /></span><div><h3>Instruments</h3><p>Visible in {list.name}</p></div></div>
              <div className="mobile-manage-symbols">{list.symbols.map((ticker, index) => <div key={ticker}>
                <span><strong>{ticker}</strong><small>{getMarketSymbol(ticker)?.name ?? "Market"}</small></span>
                <select aria-label={`Section for ${ticker}`} value={sectionForSymbol(index, sections)} onChange={(event) => { const sectionId = event.target.value; if (sectionId) moveSymbol({ ticker, index: 0, mode: "inside-section", targetSectionId: sectionId }); else moveSymbol({ ticker, index: 0, mode: "before-section", unsectionedStart: true }); }}><option value="">Unsectioned</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}</select>
                <button type="button" aria-label={`Move ${ticker} up`} disabled={index === 0} onClick={() => moveSymbol({ ticker, index: index - 1 })}><ArrowUp size={18} /></button>
                <button type="button" aria-label={`Move ${ticker} down`} disabled={index === list.symbols.length - 1} onClick={() => moveSymbol({ ticker, index: index + 2 })}><ArrowDown size={18} /></button>
                <button type="button" aria-label={`Remove ${ticker} from watchlist`} onClick={() => removeSymbol(ticker)}><X size={18} /></button>
              </div>)}</div>
            </section>
          </div>
        </MobileSheet>
      )}
      {dialog}
    </section>
  );
}

function sectionForSymbol(
  index: number,
  sections: readonly { id: string; index: number }[],
): string {
  const ordered = [...sections].sort((a, b) => a.index - b.index);
  let active = "";
  for (const section of ordered) {
    if (section.index > index) break;
    active = section.id;
  }
  return active;
}
