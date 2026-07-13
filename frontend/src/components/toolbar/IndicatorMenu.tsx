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
import { authStatusAtom } from "@/store/authStore";
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
import {
  canShowUserFavoriteControls,
  canUsePrivatePineWorkspace,
  type IndicatorBrowserTab,
} from "@/services/privateWorkspaceAccess";
import { reportFrontendError } from "@/services/feedback/errorReporter";
import type { CustomIndicatorScript } from "@/types";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";
import { trapFocusWithin } from "@/utils/focusManagement";

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
          ? "bg-brand/12 text-brand"
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
    <div className="rounded-xl border border-dashed border-terminal-border-strong bg-terminal-panel/40 px-4 py-10 text-center text-xs leading-5 text-ink-muted">
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
  const [tab, setTab] = useState<IndicatorBrowserTab>("store");
  const [query, setQuery] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<CustomIndicatorScript | null>(null);
  const [storeRows, setStoreRows] = useState<PublicIndicatorScript[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);
  const [storeError, setStoreError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const storeRequestRef = useRef(0);
  const indicatorDialogDrag = useDraggableDialog();
  const deleteDialogDrag = useDraggableDialog();

  const authStatus = useAtomValue(authStatusAtom);
  const scripts = useAtomValue(pineScriptsAtom);
  const addCustomIndicator = useSetAtom(addCustomIndicatorFromScriptAtom);
  const addCustomIndicatorFromSource = useSetAtom(addCustomIndicatorFromSourceAtom);
  const deleteScript = useSetAtom(deletePineScriptAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const togglePineFavorite = useSetAtom(togglePineFavoriteAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  const canUsePrivatePine = canUsePrivatePineWorkspace(authStatus);
  const canShowFavorites = canShowUserFavoriteControls(authStatus);

  useEffect(() => {
    if (!open) return;
    const timeout = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (open) {
      wasOpenRef.current = true;
      return;
    }
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const frame = window.requestAnimationFrame(() => triggerRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!canUsePrivatePine && tab !== "store") {
      setTab("store");
      setQuery("");
    }
  }, [canUsePrivatePine, tab]);

  useEffect(() => {
    if (!open) setDeleteTarget(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
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
    if (!canUsePrivatePine) return [];
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
  }, [canUsePrivatePine, query, scripts, tab]);

  const openPineEditor = () => {
    if (!canUsePrivatePine) return;
    setOpen(false);
    setBottomTab("pine");
  };

  const openScriptSource = (script: CustomIndicatorScript) => {
    if (!canUsePrivatePine) return;
    loadPineScript(script.id);
    setOpen(false);
    setBottomTab("pine");
  };

  const confirmDeleteScript = () => {
    if (!deleteTarget) return;
    deleteScript(deleteTarget.id);
    setDeleteTarget(null);
  };

  const selectTab = (next: IndicatorBrowserTab) => {
    if (!canUsePrivatePine && next !== "store") return;
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
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[11px] font-semibold transition-colors",
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
            className="fixed inset-0 z-[1000] bg-[var(--scrim)] px-3 pt-14 backdrop-blur-sm"
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
              tabIndex={-1}
              onKeyDown={trapFocusWithin}
              className="mx-auto flex h-[min(680px,calc(100dvh-72px))] w-[min(calc(100vw-24px),900px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
            >
              <header
                {...indicatorDialogDrag.dragHandleProps}
                className={cn(
                  "flex h-16 shrink-0 items-center justify-between border-b border-terminal-border px-5",
                  indicatorDialogDrag.dragHandleClassName,
                )}
              >
                <h2 className="text-xl font-semibold leading-none tracking-[-0.02em] text-ink">
                  Indicators, metrics, and strategies
                </h2>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  aria-label="Close"
                  title="Close"
                >
                  <X size={22} strokeWidth={1.6} />
                </button>
              </header>

              <div className="px-5">
                <div
                  data-testid="indicator-search-control"
                  className="mt-4 flex h-11 items-center gap-2 rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 shadow-inner transition-[border-color,box-shadow] focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20"
                >
                  <Search size={21} className="shrink-0 text-ink-muted" />
                  <input
                    ref={searchRef}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label="Search indicators"
                    placeholder="Search"
                    className="h-full min-w-0 flex-1 border-0 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted focus-visible:!outline-none"
                  />
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr] gap-5 px-5 pb-5 pt-4">
                <aside className="min-h-0 space-y-5 overflow-auto pr-1">
                  <div>
                    <div className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                      Personal
                    </div>
                    <div className="space-y-1">
                      {canUsePrivatePine && (
                        <>
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
                        </>
                      )}
                      <SidebarButton
                        active={tab === "store" && !query.trim()}
                        icon={<ShoppingBag size={22} strokeWidth={1.6} />}
                        label="Store"
                        onClick={() => selectTab("store")}
                      />
                    </div>
                  </div>

                  {canUsePrivatePine && (
                    <button
                      type="button"
                      onClick={openPineEditor}
                      className="flex h-9 w-full items-center gap-2 rounded-md px-3 text-left text-[12px] font-semibold text-brand transition-colors hover:bg-brand/10"
                    >
                      <Code2 size={16} />
                      <span className="min-w-0 truncate">Open Pine Editor</span>
                    </button>
                  )}
                </aside>

                <section className="min-w-0 overflow-hidden">
                  <div className="grid grid-cols-[minmax(220px,1fr)_128px_92px] px-1 pb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                    <div>{tab === "myScripts" ? "Script name" : "Name"}</div>
                    <div>{tab === "store" ? "Author" : ""}</div>
                    <div>{tab === "store" ? "Boosts" : ""}</div>
                  </div>

                  <div className="max-h-[462px] overflow-auto pr-1">
                    {canUsePrivatePine &&
                      (tab === "favorites" || tab === "myScripts") && (
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
                            showFavoriteMarker={canShowFavorites}
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
                className="fixed inset-0 z-[1001] flex items-center justify-center bg-[var(--scrim)] px-4 backdrop-blur-sm"
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
                  tabIndex={-1}
                  onKeyDown={trapFocusWithin}
                  className="w-full max-w-[440px] rounded-2xl border border-terminal-border-strong bg-terminal-raised px-7 pb-6 pt-5 shadow-floating"
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
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
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
                      className="min-h-11 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink transition-colors hover:bg-terminal-hover"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={confirmDeleteScript}
                      className="min-h-11 rounded-xl bg-bear px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90"
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
  showFavoriteMarker,
  onAdd,
}: {
  item: PublicIndicatorScript;
  showFavoriteMarker: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="group grid min-h-8 grid-cols-[minmax(220px,1fr)_128px_92px] items-center rounded-md px-1 text-[13px] text-ink transition-colors hover:bg-terminal-hover">
      <div className="flex min-w-0 items-center gap-2">
        {showFavoriteMarker && (
          <Star
            size={16}
            fill="none"
            className="h-7 w-7 shrink-0 rounded p-1.5 text-ink-muted"
          />
        )}
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
