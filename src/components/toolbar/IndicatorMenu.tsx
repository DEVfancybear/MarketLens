"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Braces,
  ChartNoAxesCombined,
  Check,
  Code2,
  Search,
  Settings,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  addCustomIndicatorFromScriptAtom,
  deletePineScriptAtom,
  indicatorsAtom,
  loadPineScriptAtom,
  pineScriptsAtom,
  setEditingIndicatorAtom,
  toggleIndicatorAtom,
  togglePineFavoriteAtom,
} from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import type { BuiltInIndicatorType, CustomIndicatorScript } from "@/types";
import { cn } from "@/utils/cn";

const BUILT_INS: { type: BuiltInIndicatorType; name: string }[] = [
  { type: "SMA", name: "Simple Moving Average" },
  { type: "EMA", name: "Exponential Moving Average" },
  { type: "VWAP", name: "VWAP (session)" },
  { type: "RSI", name: "Relative Strength Index" },
  { type: "MACD", name: "MACD" },
  { type: "ADR", name: "Average Daily Range" },
];

type IndicatorTab = "favorites" | "myScripts" | "builtIns";

type IndicatorRow =
  | {
      kind: "script";
      id: string;
      name: string;
      author: string;
      boosts: string;
      favorite: boolean;
      active: boolean;
      sourceCode: string;
      script: CustomIndicatorScript;
    }
  | {
      kind: "builtIn";
      id: BuiltInIndicatorType;
      name: string;
      author: string;
      boosts: string;
      favorite: false;
      active: boolean;
      sourceCode: string;
      type: BuiltInIndicatorType;
    };

function builtInBoost(type: BuiltInIndicatorType) {
  const values: Record<BuiltInIndicatorType, string> = {
    SMA: "8.6K",
    EMA: "7.9K",
    VWAP: "5.1K",
    RSI: "9.4K",
    MACD: "7.2K",
    ADR: "2.8K",
  };
  return values[type];
}

function SidebarButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[13px] font-semibold transition-colors",
        active
          ? "bg-[#3f3f3f] text-ink"
          : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
      )}
    >
      {icon}
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function IndicatorMenu() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<IndicatorTab>("myScripts");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<CustomIndicatorScript | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const indicators = useAtomValue(indicatorsAtom);
  const scripts = useAtomValue(pineScriptsAtom);
  const toggleIndicator = useSetAtom(toggleIndicatorAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const addCustomIndicator = useSetAtom(addCustomIndicatorFromScriptAtom);
  const deleteScript = useSetAtom(deletePineScriptAtom);
  const togglePineFavorite = useSetAtom(togglePineFavoriteAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);

  const rows = useMemo<IndicatorRow[]>(() => {
    const sortedScripts = [...scripts].sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt,
    );
    const customRows: IndicatorRow[] = sortedScripts.map((script) => ({
      kind: "script",
      id: script.id,
      name: script.name,
      author: "You",
      boosts: "0",
      favorite: script.favorite,
      active: indicators.some(
        (item) => item.type === "CUSTOM" && item.scriptId === script.id,
      ),
      sourceCode: script.sourceCode,
      script,
    }));
    const builtInRows: IndicatorRow[] = BUILT_INS.map((item) => ({
      kind: "builtIn",
      id: item.type,
      name: item.name,
      author: "Built-in",
      boosts: builtInBoost(item.type),
      favorite: false,
      active: indicators.some((indicator) => indicator.type === item.type),
      sourceCode: item.type,
      type: item.type,
    }));
    return [...customRows, ...builtInRows];
  }, [indicators, scripts]);

  const filteredRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = rows.filter((row) => {
      if (tab === "favorites") return row.kind === "script" && row.favorite;
      if (tab === "myScripts") return row.kind === "script";
      return row.kind === "builtIn";
    });

    if (!q) return base;
    return base.filter((row) =>
      [row.name, row.author, row.sourceCode].some((value) =>
        value.toLowerCase().includes(q),
      ),
    );
  }, [query, rows, tab]);
  const scriptRows = filteredRows.filter(
    (row): row is Extract<IndicatorRow, { kind: "script" }> =>
      row.kind === "script",
  );
  const builtInRows = filteredRows.filter(
    (row): row is Extract<IndicatorRow, { kind: "builtIn" }> =>
      row.kind === "builtIn",
  );
  const personalView = tab !== "builtIns";

  useEffect(() => {
    if (!open) return;
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) setDeleteTarget(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (deleteTarget) {
        setDeleteTarget(null);
      } else {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTarget, open]);

  const activeIndicatorForRow = (row: IndicatorRow) =>
    row.kind === "script"
      ? indicators.find(
          (indicator) =>
            indicator.type === "CUSTOM" && indicator.scriptId === row.id,
        )
      : indicators.find((indicator) => indicator.type === row.type);

  const addRow = (row: IndicatorRow) => {
    if (row.kind === "script") {
      addCustomIndicator(row.script);
      return;
    }
    toggleIndicator(row.type);
  };

  const openRowSettings = (row: IndicatorRow) => {
    const active = activeIndicatorForRow(row);
    if (!active) return;
    setOpen(false);
    if (row.kind === "script") {
      loadPineScript(row.id);
      setBottomTab("pine");
    } else {
      setEditingIndicator(active.id);
    }
  };

  const openPineEditor = () => {
    setOpen(false);
    setBottomTab("pine");
  };

  const openScriptSource = (script: CustomIndicatorScript) => {
    loadPineScript(script.id);
    setOpen(false);
    setBottomTab("pine");
  };

  const confirmDeleteScript = () => {
    if (!deleteTarget) return;
    deleteScript(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded px-2 text-[11px] transition-colors",
          open
            ? "bg-terminal-hover text-ink"
            : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
        )}
      >
        <ChartNoAxesCombined size={15} />
        Indicators
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-[1000] bg-black/25 pt-9"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Indicators, metrics, and strategies"
              className="mx-auto flex h-[360px] w-[min(calc(100vw-24px),840px)] flex-col overflow-hidden rounded-lg border border-terminal-border bg-[#1f1f1f] shadow-2xl shadow-black/60"
            >
              <header className="flex h-14 shrink-0 items-center justify-between px-5">
                <h2 className="text-[21px] font-semibold leading-none text-ink">
                  Indicators, metrics, and strategies
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-8 w-8 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
                  aria-label="Close"
                  title="Close"
                >
                  <X size={22} strokeWidth={1.6} />
                </button>
              </header>

              <div className="px-5">
                <div className="flex h-10 items-center gap-2 rounded-md border border-[#4b4b4b] bg-[#202020] px-3">
                  <Search size={21} className="shrink-0 text-ink-muted" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search"
                    className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
                  />
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-5 px-5 pb-4 pt-4">
                <aside className="min-h-0">
                  <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    Personal
                  </div>
                  <div className="space-y-1">
                    <SidebarButton
                      active={!query.trim() && tab === "favorites"}
                      icon={<Star size={22} strokeWidth={1.6} />}
                      label="Favorites"
                      onClick={() => {
                        setQuery("");
                        setTab("favorites");
                      }}
                    />
                    <SidebarButton
                      active={!query.trim() && tab === "myScripts"}
                      icon={<UserRound size={22} strokeWidth={1.6} />}
                      label="My scripts"
                      onClick={() => {
                        setQuery("");
                        setTab("myScripts");
                      }}
                    />
                  </div>

                  <div className="mb-2 mt-5 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                    Technicals
                  </div>
                  <SidebarButton
                    active={!query.trim() && tab === "builtIns"}
                    icon={<ChartNoAxesCombined size={22} strokeWidth={1.6} />}
                    label="Built-ins"
                    onClick={() => {
                      setQuery("");
                      setTab("builtIns");
                    }}
                  />

                  <button
                    type="button"
                    onClick={openPineEditor}
                    className="mt-5 flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] font-semibold text-brand transition-colors hover:bg-brand/10"
                  >
                    <Code2 size={16} />
                    <span className="min-w-0 truncate">Open Pine Editor</span>
                  </button>
                </aside>

                <section className="min-w-0 overflow-hidden">
                  {personalView ? (
                    <>
                      <div className="grid grid-cols-[minmax(220px,1fr)_72px] px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                        <div>Script name</div>
                        <div />
                      </div>

                      <div className="max-h-[218px] overflow-auto pr-1">
                        {scriptRows.length === 0 ? (
                          <div className="rounded-md border border-dashed border-terminal-border px-4 py-8 text-center text-xs text-ink-muted">
                            No scripts found.
                          </div>
                        ) : (
                          scriptRows.map((row) => (
                            <div
                              key={`script:${row.id}`}
                              className={cn(
                                "group flex min-h-8 items-center rounded-md px-1 text-[13px] text-ink transition-colors hover:bg-terminal-hover",
                                row.active && "bg-brand/10",
                              )}
                            >
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  togglePineFavorite(row.id);
                                }}
                                className={cn(
                                  "flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-choch",
                                  row.favorite && "text-choch",
                                )}
                                aria-label="Add to favorites"
                                title="Add to favorites"
                              >
                                <Star
                                  size={16}
                                  fill={row.favorite ? "currentColor" : "none"}
                                />
                              </button>
                              <button
                                type="button"
                                onClick={() => addRow(row)}
                                className="min-w-0 flex-1 truncate py-1.5 text-left font-semibold hover:text-brand"
                                title={row.name}
                              >
                                {row.name}
                              </button>
                              {row.active && (
                                <Check
                                  size={14}
                                  className="ml-2 shrink-0 text-brand"
                                />
                              )}
                              <div className="ml-auto flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openScriptSource(row.script);
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
                                  aria-label="Open source"
                                  title="Open source"
                                >
                                  <Braces size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setDeleteTarget(row.script);
                                  }}
                                  className="flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-bear"
                                  aria-label="Delete script"
                                  title="Delete script"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-[minmax(220px,1fr)_124px_88px] px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                        <div>Name</div>
                        <div>Author</div>
                        <div>Boosts</div>
                      </div>

                      <div className="max-h-[218px] overflow-auto pr-1">
                        {builtInRows.length === 0 ? (
                          <div className="rounded-md border border-dashed border-terminal-border px-4 py-8 text-center text-xs text-ink-muted">
                            No indicators found.
                          </div>
                        ) : (
                          builtInRows.map((row) => (
                            <div
                              key={`builtIn:${row.id}`}
                              className={cn(
                                "group grid min-h-8 grid-cols-[minmax(220px,1fr)_124px_88px] items-center rounded-md px-1 text-[13px] text-ink transition-colors hover:bg-terminal-hover",
                                row.active && "bg-brand/10",
                              )}
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <button
                                  type="button"
                                  className="flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded text-ink-faint"
                                  aria-label="Favorite"
                                  title="Favorite"
                                >
                                  <Star size={16} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => addRow(row)}
                                  className="min-w-0 flex-1 truncate py-1.5 text-left font-semibold hover:text-brand"
                                  title={row.name}
                                >
                                  {row.name}
                                </button>
                                {row.active && (
                                  <Check
                                    size={14}
                                    className="shrink-0 text-brand"
                                  />
                                )}
                              </div>

                              <button
                                type="button"
                                onClick={() => addRow(row)}
                                className="truncate py-1.5 text-left text-brand hover:text-brand/80"
                                title={row.author}
                              >
                                {row.author}
                              </button>

                              <div className="flex min-w-0 items-center justify-between gap-1">
                                <button
                                  type="button"
                                  onClick={() => addRow(row)}
                                  className="min-w-0 truncate py-1.5 text-left text-ink"
                                  title={row.boosts}
                                >
                                  {row.boosts}
                                </button>
                                {row.active && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      openRowSettings(row);
                                    }}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted opacity-0 transition-colors hover:bg-terminal-hover hover:text-ink group-hover:opacity-100"
                                    aria-label="Settings"
                                    title="Settings"
                                  >
                                    <Settings size={14} />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>
            </div>

            {deleteTarget && (
              <div
                className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/35"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget)
                    setDeleteTarget(null);
                }}
              >
                <div
                  role="alertdialog"
                  aria-modal="true"
                  aria-label="Delete this script?"
                  className="w-[440px] rounded-md border border-[#242424] bg-[#171717] px-8 pb-6 pt-5 shadow-2xl shadow-black/70"
                >
                  <div className="flex items-start justify-between gap-4">
                    <h3 className="pt-6 text-[20px] font-semibold leading-none text-ink">
                      Delete this script?
                    </h3>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(null)}
                      className="flex h-8 w-8 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
                      aria-label="Cancel delete"
                      title="Cancel"
                    >
                      <X size={24} strokeWidth={1.5} />
                    </button>
                  </div>
                  <p className="mt-5 text-[15px] leading-6 text-ink">
                    Doing this will permanently delete your &quot;
                    {deleteTarget.name}&quot; script. You will lose access to
                    its source code forever.
                  </p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(null)}
                      className="h-9 rounded-md border border-[#4b4b4b] px-4 text-[15px] font-medium text-ink transition-colors hover:bg-terminal-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeleteScript}
                      className="h-9 rounded-md bg-[#f23645] px-4 text-[15px] font-semibold text-white transition-colors hover:bg-[#ff4d5b]"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
