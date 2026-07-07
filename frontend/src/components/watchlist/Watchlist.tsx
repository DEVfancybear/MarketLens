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
  Trash2,
  X,
} from "lucide-react";
import { getMarketSymbol } from "@/services/market-data/symbols";
import { useMarketSymbols } from "@/store/marketSymbolStore";
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
  moveWatchlistSectionAtom,
  moveWatchlistSymbolAtom,
  removeWatchlistSymbolAtom,
  removeWatchlistSectionAtom,
  renameWatchlistSectionAtom,
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
  | { kind: "symbol"; ticker: string; index: number };

type SymbolDropEdge = "before" | "after";
type SectionDropEdge = "before" | "after";
type WatchlistDragKind = "symbol" | "section";
type WatchlistDropTarget =
  | { kind: "unsectioned"; key: string }
  | { kind: "section"; key: string; sectionId: string; edge?: SectionDropEdge }
  | { kind: "symbol"; key: string; index: number; edge: SymbolDropEdge };
type WatchlistDragBase = {
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};
type WatchlistDragState = WatchlistDragBase &
  (
    | { kind: "symbol"; ticker: string; label: string }
    | { kind: "section"; sectionId: string; label: string }
  );

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
  const renameSection = useSetAtom(renameWatchlistSectionAtom);
  const removeSection = useSetAtom(removeWatchlistSectionAtom);
  const moveSection = useSetAtom(moveWatchlistSectionAtom);
  const moveSymbol = useSetAtom(moveWatchlistSymbolAtom);

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
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [sectionDraft, setSectionDraft] = useState("");
  const skipSectionBlurRef = useRef(false);
  const [dragState, setDragState] = useState<WatchlistDragState | null>(null);
  const [dropTarget, setDropTarget] = useState<WatchlistDropTarget | null>(null);
  const watchlistBodyRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragGhostPointRef = useRef<{ x: number; y: number } | null>(null);
  const dragStateRef = useRef<WatchlistDragState | null>(null);
  const dropTargetRef = useRef<WatchlistDropTarget | null>(null);
  const suppressNextClickRef = useRef(false);

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
      return ordered.map((ticker) => ({
        kind: "symbol",
        ticker,
        index: symbols.indexOf(ticker),
      }));
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
        rows.push({ kind: "symbol", ticker: symbols[index], index });
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

  const onRowClick = useCallback(
    (ticker: string) => {
      if (suppressNextClickRef.current) {
        suppressNextClickRef.current = false;
        return;
      }
      setSymbol(ticker);
    },
    [setSymbol],
  );
  const onRemove = useCallback((ticker: string) => remove(ticker), [remove]);

  const beginSectionRename = useCallback((section: WatchlistSection) => {
    setSectionDraft(section.title);
    setEditingSectionId(section.id);
  }, []);

  const commitSectionRename = useCallback(() => {
    if (!editingSectionId) return;
    renameSection(editingSectionId, sectionDraft);
    setEditingSectionId(null);
  }, [editingSectionId, renameSection, sectionDraft]);

  const cancelSectionRename = useCallback(() => {
    skipSectionBlurRef.current = true;
    setEditingSectionId(null);
    setSectionDraft("");
  }, []);

  useEffect(() => {
    dragStateRef.current = dragState;
  }, [dragState]);

  useEffect(() => {
    dropTargetRef.current = dropTarget;
  }, [dropTarget]);

  const resolvePointerDropTarget = useCallback(
    (
      clientX: number,
      clientY: number,
      dragKind: WatchlistDragKind,
    ): WatchlistDropTarget | null => {
      const elements = document
        .elementsFromPoint(clientX, clientY)
        .filter((element): element is HTMLElement => element instanceof HTMLElement);

      const closest = <T extends HTMLElement>(selector: string): T | null => {
        for (const element of elements) {
          const match = element.closest<T>(selector);
          if (match) return match;
        }
        return null;
      };

      const unsectioned = closest<HTMLElement>("[data-watchlist-drop='unsectioned']");
      if (unsectioned) {
        return { kind: "unsectioned", key: "unsectioned-start" };
      }

      const section = closest<HTMLElement>("[data-watchlist-section-id]");
      if (section?.dataset.watchlistSectionId) {
        const sectionId = section.dataset.watchlistSectionId;
        const activeDrag = dragStateRef.current;
        if (
          dragKind === "section" &&
          activeDrag?.kind === "section" &&
          activeDrag.sectionId === sectionId
        ) {
          return null;
        }
        const sectionRect = section.getBoundingClientRect();
        const edge =
          dragKind === "section"
            ? clientY > sectionRect.top + sectionRect.height / 2
              ? "after"
              : "before"
            : undefined;
        return {
          kind: "section",
          key: `section-${sectionId}${edge ? `-${edge}` : ""}`,
          sectionId,
          edge,
        };
      }

      const symbol = closest<HTMLElement>("[data-watchlist-symbol-index]");
      if (symbol?.dataset.watchlistSymbolIndex) {
        const rowIndex = Number(symbol.dataset.watchlistSymbolIndex);
        if (!Number.isFinite(rowIndex)) return null;
        const rect = symbol.getBoundingClientRect();
        const after = clientY > rect.top + rect.height / 2;
        return {
          kind: "symbol",
          key: `symbol-${symbol.dataset.watchlistSymbol ?? rowIndex}-${after ? "after" : "before"}`,
          index: rowIndex + (after ? 1 : 0),
          edge: after ? "after" : "before",
        };
      }

      const body = watchlistBodyRef.current;
      if (!body) return null;

      const bodyRect = body.getBoundingClientRect();
      const insideBody =
        clientX >= bodyRect.left &&
        clientX <= bodyRect.right &&
        clientY >= bodyRect.top &&
        clientY <= bodyRect.bottom;
      if (!insideBody) return null;

      const sectionRows = Array.from(
        body.querySelectorAll<HTMLElement>("[data-watchlist-section-id]"),
      );
      let activeSectionId: string | null = null;
      for (const sectionRow of sectionRows) {
        const rect = sectionRow.getBoundingClientRect();
        if (clientY < rect.top) break;
        activeSectionId = sectionRow.dataset.watchlistSectionId ?? null;
      }

      if (activeSectionId) {
        if (dragKind === "section") {
          return {
            kind: "symbol",
            key: `symbol-end-${symbols.length}`,
            index: symbols.length,
            edge: "after",
          };
        }
        return {
          kind: "section",
          key: `section-${activeSectionId}`,
          sectionId: activeSectionId,
        };
      }

      return null;
    },
    [symbols.length],
  );

  const applyPointerDrop = useCallback(
    (state: WatchlistDragState, target: WatchlistDropTarget | null) => {
      if (!target) return;
      if (state.kind === "section") {
        if (target.kind === "unsectioned") {
          moveSection({ sectionId: state.sectionId, target: { kind: "start" } });
          return;
        }
        if (target.kind === "section") {
          moveSection({
            sectionId: state.sectionId,
            target: {
              kind: "section",
              sectionId: target.sectionId,
              edge: target.edge ?? "after",
            },
          });
          return;
        }
        moveSection({
          sectionId: state.sectionId,
          target: { kind: "symbol-boundary", index: target.index },
        });
        return;
      }

      if (target.kind === "unsectioned") {
        moveSymbol({
          ticker: state.ticker,
          index: 0,
          mode: "before-section",
          unsectionedStart: true,
        });
        return;
      }
      if (target.kind === "section") {
        moveSymbol({
          ticker: state.ticker,
          index: 0,
          mode: "inside-section",
          targetSectionId: target.sectionId,
        });
        return;
      }
      moveSymbol({ ticker: state.ticker, index: target.index, mode: "inside-section" });
    },
    [moveSection, moveSymbol],
  );

  const updateDropTarget = useCallback((target: WatchlistDropTarget | null) => {
    if (dropTargetRef.current?.key === target?.key) return;
    dropTargetRef.current = target;
    setDropTarget(target);
  }, []);

  const moveDragGhost = useCallback((x: number, y: number) => {
    dragGhostPointRef.current = { x, y };
    if (dragFrameRef.current !== null) return;

    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const point = dragGhostPointRef.current;
      const ghost = dragGhostRef.current;
      if (!point || !ghost) return;
      ghost.style.transform = `translate3d(${point.x + 12}px, ${point.y + 12}px, 0)`;
    });
  }, []);

  const cancelDragGhostFrame = useCallback(() => {
    if (dragFrameRef.current === null) return;
    window.cancelAnimationFrame(dragFrameRef.current);
    dragFrameRef.current = null;
  }, []);

  useEffect(() => cancelDragGhostFrame, [cancelDragGhostFrame]);

  useEffect(() => {
    if (!dragState) return;

    const onPointerMove = (event: PointerEvent) => {
      const prev = dragStateRef.current;
      if (!prev) return;

      const dx = event.clientX - prev.startX;
      const dy = event.clientY - prev.startY;
      const active = prev.active || Math.hypot(dx, dy) > 5;
      const next = { ...prev, x: event.clientX, y: event.clientY, active };

      dragStateRef.current = next;
      if (active !== prev.active) {
        setDragState(next);
      }

      if (active) {
        event.preventDefault();
        moveDragGhost(event.clientX, event.clientY);
        updateDropTarget(
          resolvePointerDropTarget(event.clientX, event.clientY, next.kind),
        );
      }
    };

    const onPointerUp = (event: PointerEvent) => {
      const state = dragStateRef.current;
      if (state?.active) {
        suppressNextClickRef.current = true;
        const finalTarget =
          resolvePointerDropTarget(event.clientX, event.clientY, state.kind) ??
          dropTargetRef.current;
        applyPointerDrop(state, finalTarget);
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 0);
      }
      dragStateRef.current = null;
      cancelDragGhostFrame();
      dragGhostPointRef.current = null;
      setDragState(null);
      updateDropTarget(null);
    };

    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [
    applyPointerDrop,
    cancelDragGhostFrame,
    dragState,
    moveDragGhost,
    resolvePointerDropTarget,
    updateDropTarget,
  ]);

  const startSymbolDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, ticker: string) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-watchlist-no-drag]")
      ) {
        return;
      }
      const next = {
        kind: "symbol" as const,
        ticker,
        label: ticker,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        active: false,
      };
      dragStateRef.current = next;
      setDragState(next);
    },
    [],
  );

  const startSectionDrag = useCallback(
    (e: React.PointerEvent<HTMLElement>, section: WatchlistSection) => {
      if (e.button !== 0) return;
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        target.closest("[data-watchlist-no-drag]")
      ) {
        return;
      }
      const next = {
        kind: "section" as const,
        sectionId: section.id,
        label: section.title,
        startX: e.clientX,
        startY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        active: false,
      };
      dragStateRef.current = next;
      setDragState(next);
    },
    [],
  );

  const consumeSuppressedClick = useCallback(() => {
    if (!suppressNextClickRef.current) return false;
    suppressNextClickRef.current = false;
    return true;
  }, []);

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
        const sectionDropPlacement =
          dropTarget?.kind === "section" &&
          dropTarget.sectionId === row.section.id
            ? dragState?.kind === "section"
              ? (dropTarget.edge ?? "after")
              : "inside"
            : null;
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
            editing={editingSectionId === row.section.id}
            draft={sectionDraft}
            dragging={
              dragState?.active === true &&
              dragState.kind === "section" &&
              dragState.sectionId === row.section.id
            }
            dropPlacement={sectionDropPlacement}
            onDraftChange={setSectionDraft}
            onStartRename={() => beginSectionRename(row.section)}
            onCommitRename={commitSectionRename}
            onCancelRename={cancelSectionRename}
            shouldSkipBlur={() => {
              if (!skipSectionBlurRef.current) return false;
              skipSectionBlurRef.current = false;
              return true;
            }}
            onRemove={() => removeSection(row.section.id)}
            onPointerDown={(e) => startSectionDrag(e, row.section)}
            consumeSuppressedClick={consumeSuppressedClick}
          />
        );
      }

      if (hiddenBySection) return null;
      return (
        <WatchRow
          key={row.ticker}
          ticker={row.ticker}
          active={row.ticker === activeSymbol}
          onSelect={onRowClick}
          onRemove={onRemove}
          onContextMenu={onRowContext}
          dragging={
            dragState?.active === true &&
            dragState.kind === "symbol" &&
            dragState.ticker === row.ticker
          }
          dropEdge={
            dropTarget?.kind === "symbol" &&
            dropTarget.key.startsWith(`symbol-${row.ticker}-`)
              ? dropTarget.edge
              : null
          }
          index={row.index}
          onPointerDown={(e) => startSymbolDrag(e, row.ticker)}
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
          dragState?.active && "bg-terminal-panel/95",
        )}
        data-watchlist-drop="unsectioned"
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

      <div
        ref={watchlistBodyRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-0.5"
      >
        {dragState?.active && sections.length > 0 && (
          <div
            className={cn(
              "relative mx-2 mb-0.5 h-3",
              dropTarget?.key === "unsectioned-start"
                ? "opacity-100"
                : "bg-transparent",
            )}
            data-watchlist-drop="unsectioned"
            aria-label="Drop outside sections"
          >
            <span
              className={cn(
                "pointer-events-none absolute left-0 right-0 top-1/2 h-[2px] -translate-y-1/2 rounded-full bg-[#6d8cff] shadow-[0_0_0_1px_rgba(109,140,255,0.24),0_0_8px_rgba(109,140,255,0.35)] transition-opacity duration-75",
                dropTarget?.key === "unsectioned-start"
                  ? "opacity-100"
                  : "opacity-0",
              )}
            />
          </div>
        )}
        {renderRows()}
      </div>

      {dragState?.active && (
        <div
          ref={dragGhostRef}
          className="pointer-events-none fixed left-0 top-0 z-[9999] rounded bg-[#2a2e39]/95 px-2 py-1 text-[11px] font-semibold text-white shadow-lg ring-1 ring-white/10 will-change-transform"
          style={{
            transform: `translate3d(${dragState.x + 12}px, ${dragState.y + 12}px, 0)`,
          }}
        >
          {dragState.label}
        </div>
      )}

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
  editing,
  draft,
  dragging,
  dropPlacement,
  onToggle,
  onDraftChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  shouldSkipBlur,
  onRemove,
  onPointerDown,
  consumeSuppressedClick,
}: {
  section: WatchlistSection;
  collapsed: boolean;
  editing: boolean;
  draft: string;
  dragging: boolean;
  dropPlacement: SectionDropEdge | "inside" | null;
  onToggle: () => void;
  onDraftChange: (value: string) => void;
  onStartRename: () => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  shouldSkipBlur: () => boolean;
  onRemove: () => void;
  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  consumeSuppressedClick: () => boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editing) return;
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [editing]);

  return (
    <div
      onPointerDown={onPointerDown}
      className={cn(
        "group relative flex h-[26px] w-full cursor-grab select-none items-center gap-1 border-y border-[#32467e] bg-[#22356d] px-3 text-left text-[10px] font-semibold uppercase tracking-wide text-[#96a0bd] transition-colors duration-100 hover:bg-[#27407f] active:cursor-grabbing",
        dropPlacement && "bg-[#29417f]",
        dragging && "opacity-45",
      )}
      data-watchlist-section-id={section.id}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-3 right-3 z-20 h-[2px] rounded-full bg-[#7a98ff] shadow-[0_0_0_1px_rgba(122,152,255,0.24),0_0_8px_rgba(122,152,255,0.38)] transition-opacity duration-75",
          dropPlacement === "before" && "top-0 -translate-y-1/2 opacity-100",
          (dropPlacement === "after" || dropPlacement === "inside") &&
            "bottom-[-1px] opacity-100",
          !dropPlacement && "bottom-[-1px] opacity-0",
        )}
      />
      <button
        type="button"
        onClick={() => {
          if (consumeSuppressedClick()) return;
          onToggle();
        }}
        data-watchlist-no-drag
        className="flex h-full shrink-0 items-center justify-center"
        aria-label={collapsed ? "Expand section" : "Collapse section"}
      >
        <ChevronDown
          size={13}
          className={cn(
            "shrink-0 text-[#96a0bd] transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </button>
      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          data-watchlist-no-drag
          onBlur={() => {
            if (shouldSkipBlur()) return;
            onCommitRename();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
          className="h-[20px] min-w-0 flex-1 rounded-sm border border-brand bg-[#2d3569] px-1 text-[10px] font-semibold uppercase tracking-wide text-white outline-none selection:bg-brand"
          aria-label={`Rename ${section.title}`}
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            if (consumeSuppressedClick()) return;
            onToggle();
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onStartRename();
          }}
          className="min-w-0 flex-1 truncate text-left uppercase"
          title="Double click to rename section"
        >
          {section.title}
        </button>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        data-watchlist-no-drag
        className="ml-auto hidden h-[20px] w-[20px] shrink-0 items-center justify-center rounded-sm text-[#96a0bd] hover:bg-[#31498f] hover:text-bear group-hover:flex"
        aria-label={`Delete ${section.title}`}
        title="Delete section"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}

interface RowProps {
  ticker: string;
  active: boolean;
  onSelect: (t: string) => void;
  onRemove: (t: string) => void;
  onContextMenu: (e: React.MouseEvent, ticker: string) => void;
  dragging: boolean;
  dropEdge: SymbolDropEdge | null;
  index: number;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
}

const WatchRow = memo(function WatchRow({
  ticker,
  active,
  onSelect,
  onRemove,
  onContextMenu,
  dragging,
  dropEdge,
  index,
  onPointerDown,
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
      onPointerDown={onPointerDown}
      className={cn(
        GRID,
        "group relative h-[30px] cursor-pointer select-none px-2 transition-[background-color,box-shadow,opacity] duration-100 hover:bg-terminal-hover",
        active && "rounded-md shadow-[inset_0_0_0_1px_var(--text-faint)]",
        dragging && "opacity-45",
      )}
      data-watchlist-symbol={ticker}
      data-watchlist-symbol-index={index}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-2 right-2 z-20 h-[2px] rounded-full bg-[#7a98ff] shadow-[0_0_0_1px_rgba(122,152,255,0.24),0_0_8px_rgba(122,152,255,0.38)] transition-opacity duration-75",
          dropEdge === "before" && "top-0 -translate-y-1/2 opacity-100",
          dropEdge === "after" && "bottom-0 translate-y-1/2 opacity-100",
          !dropEdge && "top-0 opacity-0",
        )}
      />
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
          data-watchlist-no-drag
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
  const marketSymbols = useMarketSymbols();
  const avail = marketSymbols.filter((s) => !existing.includes(s.id));
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
