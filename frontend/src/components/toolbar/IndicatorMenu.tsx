"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Braces,
  ChartNoAxesCombined,
  Code2,
  Search,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  addCustomIndicatorFromScriptAtom,
  addCustomIndicatorFromSourceAtom,
  deletePineScriptAtom,
  loadPineScriptAtom,
  pineScriptsAtom,
  togglePineFavoriteAtom,
} from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import {
  listIndicatorStore,
  type PublicIndicatorScript,
} from "@/services/api/resources/pineScriptsApi";
import {
  formatPublicBoosts,
  publicIndicatorScriptId,
} from "@/services/indicatorStoreModel";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import type { CustomIndicatorScript } from "@/types";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";

type BrowserTab = "favorites" | "myScripts" | "store";

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
        "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-[14px] font-semibold transition-colors",
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

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-[#3b3b3b] px-4 py-8 text-center text-xs leading-5 text-ink-muted">
      {children}
    </div>
  );
}

function scriptMatches(script: CustomIndicatorScript, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [script.name, script.sourceCode].some((value) =>
    value.toLowerCase().includes(q),
  );
}

export function IndicatorMenu() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BrowserTab>("favorites");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<CustomIndicatorScript | null>(null);
  const [storeRows, setStoreRows] = useState<PublicIndicatorScript[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const storeRequestRef = useRef(0);
  const indicatorDialogDrag = useDraggableDialog();
  const deleteDialogDrag = useDraggableDialog();

  const scripts = useAtomValue(pineScriptsAtom);
  const addCustomIndicator = useSetAtom(addCustomIndicatorFromScriptAtom);
  const addCustomIndicatorFromSource = useSetAtom(addCustomIndicatorFromSourceAtom);
  const deleteScript = useSetAtom(deletePineScriptAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const togglePineFavorite = useSetAtom(togglePineFavoriteAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);

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
      if (deleteTarget) setDeleteTarget(null);
      else setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [deleteTarget, open]);

  useEffect(() => {
    if (!open || tab !== "store") return;
    const requestId = storeRequestRef.current + 1;
    storeRequestRef.current = requestId;
    const timeout = window.setTimeout(() => {
      setStoreLoading(true);
      setStoreError(null);
      listIndicatorStore(query)
        .then((rows) => {
          if (storeRequestRef.current !== requestId) return;
          setStoreRows(rows);
        })
        .catch((error) => {
          if (storeRequestRef.current !== requestId) return;
          const description = reportFrontendError(error, {
            title: "Indicator Store load failed",
            toast: false,
          });
          setStoreRows([]);
          setStoreError(description.message);
        })
        .finally(() => {
          if (storeRequestRef.current === requestId) setStoreLoading(false);
        });
    }, 200);
    return () => window.clearTimeout(timeout);
  }, [open, query, tab]);

  const filteredScripts = useMemo(() => {
    const sorted = [...scripts].sort(
      (a, b) =>
        Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt,
    );
    const base =
      tab === "favorites"
        ? sorted.filter((script) => script.favorite)
        : tab === "myScripts"
          ? sorted
          : [];
    return base.filter((script) => scriptMatches(script, query));
  }, [query, scripts, tab]);

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

  const selectTab = (next: BrowserTab) => {
    setTab(next);
    setQuery("");
  };

  const addPublicScript = async (script: PublicIndicatorScript) => {
    await addCustomIndicatorFromSource({
      name: script.name,
      sourceCode: script.sourceCode,
      scriptId: publicIndicatorScriptId(script),
    });
    setOpen(false);
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
              ref={indicatorDialogDrag.dialogRef}
              style={indicatorDialogDrag.dialogStyle}
              role="dialog"
              aria-modal="true"
              aria-label="Indicators, metrics, and strategies"
              className="mx-auto flex h-[600px] w-[min(calc(100vw-24px),840px)] flex-col overflow-hidden rounded-lg border border-[#242424] bg-[#1f1f1f] shadow-2xl shadow-black/60"
            >
              <header
                {...indicatorDialogDrag.dragHandleProps}
                className={cn(
                  "flex h-14 shrink-0 items-center justify-between px-5",
                  indicatorDialogDrag.dragHandleClassName,
                )}
              >
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
                <aside className="min-h-0 space-y-5 overflow-auto pr-1">
                  <div>
                    <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Personal
                    </div>
                    <div className="space-y-1">
                      <SidebarButton
                        active={tab === "favorites" && !query.trim()}
                        icon={<Star size={22} strokeWidth={1.6} />}
                        label="Favorites"
                        onClick={() => selectTab("favorites")}
                      />
                      <SidebarButton
                        active={tab === "myScripts" && !query.trim()}
                        icon={<UserRound size={22} strokeWidth={1.6} />}
                        label="My scripts"
                        onClick={() => selectTab("myScripts")}
                      />
                      <SidebarButton
                        active={tab === "store" && !query.trim()}
                        icon={<ShoppingBag size={22} strokeWidth={1.6} />}
                        label="Store"
                        onClick={() => selectTab("store")}
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={openPineEditor}
                    className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] font-semibold text-brand transition-colors hover:bg-brand/10"
                  >
                    <Code2 size={16} />
                    <span className="min-w-0 truncate">Open Pine Editor</span>
                  </button>
                </aside>

                <section className="min-w-0 overflow-hidden">
                  <div className="grid grid-cols-[minmax(220px,1fr)_128px_92px] px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    <div>{tab === "myScripts" ? "Script name" : "Name"}</div>
                    <div>{tab === "store" ? "Author" : ""}</div>
                    <div>{tab === "store" ? "Boosts" : ""}</div>
                  </div>

                  <div className="max-h-[462px] overflow-auto pr-1">
                    {(tab === "favorites" || tab === "myScripts") && (
                      <>
                        {filteredScripts.map((script) => (
                          <ScriptRow
                            key={`script:${script.id}`}
                            script={script}
                            onAdd={() => addCustomIndicator(script)}
                            onFavorite={() => togglePineFavorite(script.id)}
                            onSource={() => openScriptSource(script)}
                            onDelete={() => setDeleteTarget(script)}
                          />
                        ))}
                        {filteredScripts.length === 0 && (
                          <EmptyState>
                            {tab === "favorites"
                              ? "No favorites found."
                              : "No scripts found."}
                          </EmptyState>
                        )}
                      </>
                    )}

                    {tab === "store" && storeLoading && (
                      <EmptyState>Loading public indicators...</EmptyState>
                    )}
                    {tab === "store" && !storeLoading && storeError && (
                      <EmptyState>{storeError}</EmptyState>
                    )}
                    {tab === "store" && !storeLoading && !storeError && (
                      <>
                        {storeRows.map((item) => (
                          <StoreRow
                            key={`store:${item.id}`}
                            item={item}
                            onAdd={() => void addPublicScript(item)}
                          />
                        ))}
                        {storeRows.length === 0 && (
                          <EmptyState>No public indicators found.</EmptyState>
                        )}
                      </>
                    )}
                  </div>
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
                  ref={deleteDialogDrag.dialogRef}
                  style={deleteDialogDrag.dialogStyle}
                  role="alertdialog"
                  aria-modal="true"
                  aria-label="Delete this script?"
                  className="w-[440px] rounded-md border border-[#242424] bg-[#171717] px-8 pb-6 pt-5 shadow-2xl shadow-black/70"
                >
                  <div
                    {...deleteDialogDrag.dragHandleProps}
                    className={cn(
                      "flex items-start justify-between gap-4",
                      deleteDialogDrag.dragHandleClassName,
                    )}
                  >
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

function ScriptRow({
  script,
  onAdd,
  onFavorite,
  onSource,
  onDelete,
}: {
  script: CustomIndicatorScript;
  onAdd: () => void;
  onFavorite: () => void;
  onSource: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group grid min-h-8 grid-cols-[minmax(220px,1fr)_128px_92px] items-center rounded-md px-1 text-[13px] text-ink transition-colors hover:bg-terminal-hover">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onFavorite}
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-choch",
            script.favorite && "text-choch",
          )}
          aria-label="Add to favorites"
          title="Add to favorites"
        >
          <Star size={16} fill={script.favorite ? "currentColor" : "none"} />
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="min-w-0 flex-1 truncate py-1.5 text-left font-semibold hover:text-brand"
          title={script.name}
        >
          {script.name}
        </button>
      </div>
      <div className="truncate text-brand">You</div>
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={onSource}
          className="flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
          aria-label="Open source"
          title="Open source"
        >
          <Braces size={15} />
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex h-7 w-7 items-center justify-center rounded text-ink-muted transition-colors hover:bg-terminal-hover hover:text-bear"
          aria-label="Delete script"
          title="Delete script"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function StoreRow({
  item,
  onAdd,
}: {
  item: PublicIndicatorScript;
  onAdd: () => void;
}) {
  return (
    <div className="group grid min-h-8 grid-cols-[minmax(220px,1fr)_128px_92px] items-center rounded-md px-1 text-[13px] text-ink transition-colors hover:bg-terminal-hover">
      <div className="flex min-w-0 items-center gap-2">
        <Star
          size={16}
          fill="currentColor"
          className="h-7 w-7 shrink-0 rounded p-1.5 text-ink"
        />
        <button
          type="button"
          onClick={onAdd}
          className="min-w-0 flex-1 truncate py-1.5 text-left font-semibold hover:text-brand"
          title={item.name}
        >
          {item.name}
        </button>
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="truncate py-1.5 text-left text-brand hover:text-brand/80"
        title={item.author}
      >
        {item.author}
      </button>
      <button
        type="button"
        onClick={onAdd}
        className="truncate py-1.5 text-left font-semibold text-ink"
        title={formatPublicBoosts(item.boosts)}
      >
        {formatPublicBoosts(item.boosts)}
      </button>
    </div>
  );
}
