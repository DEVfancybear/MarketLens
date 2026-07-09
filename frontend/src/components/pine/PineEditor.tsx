"use client";

import { useMemo, useRef, useState } from "react";
import {
  CloudUpload,
  Edit3,
  FilePlus2,
  Play,
  Save,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  addCustomIndicatorFromScriptAtom,
  candlesAtom,
  deletePineScriptAtom,
  loadPineScriptAtom,
  newPineScriptAtom,
  pineEditorScriptIdAtom,
  pineEditorSourceAtom,
  pineEditorTitleAtom,
  pineScriptsAtom,
  savePineScriptAtom,
  togglePineFavoriteAtom,
} from "@/store/chartStore";
import { logAtom } from "@/store/uiStore";
import { compilePineScript, extractPineScriptMeta } from "@/services/pineScript";
import { compilePineRuntime } from "@/services/api/resources/pineRuntimeApi";
import type { CustomIndicatorScript } from "@/types";
import { cn } from "@/utils/cn";

export function PineEditor() {
  const [scriptId] = useAtom(pineEditorScriptIdAtom);
  const [title, setTitle] = useAtom(pineEditorTitleAtom);
  const [source, setSource] = useAtom(pineEditorSourceAtom);
  const candles = useAtomValue(candlesAtom);
  const scripts = useAtomValue(pineScriptsAtom);
  const saveScript = useSetAtom(savePineScriptAtom);
  const addCustomIndicator = useSetAtom(addCustomIndicatorFromScriptAtom);
  const loadScript = useSetAtom(loadPineScriptAtom);
  const deleteScript = useSetAtom(deletePineScriptAtom);
  const toggleFavorite = useSetAtom(togglePineFavoriteAtom);
  const newScript = useSetAtom(newPineScriptAtom);
  const doLog = useSetAtom(logAtom);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<{
    level: "idle" | "ok" | "error";
    text: string;
  }>({ level: "idle", text: "Ready" });
  const [query, setQuery] = useState("");

  const meta = useMemo(() => extractPineScriptMeta(source), [source]);
  const filteredScripts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return scripts
      .filter((script) => {
        if (!q) return true;
        return (
          script.name.toLowerCase().includes(q) ||
          script.sourceCode.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt,
      );
  }, [query, scripts]);
  const lineCount = Math.max(1, source.split("\n").length);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, index) => index + 1),
    [lineCount],
  );
  // The untouched default title is a placeholder — let the script's own
  // indicator("…") title win until the user names it explicitly.
  const trimmedTitle = title.trim();
  const dirtyTitle =
    (trimmedTitle && trimmedTitle !== "Untitled script"
      ? trimmedTitle
      : meta.name) || "Untitled script";

  const syncScroll = () => {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  };

  const saveCurrentScript = () =>
    saveScript({
      id: scriptId,
      name: dirtyTitle,
      sourceCode: source,
    });

  const handleSave = async () => {
    const saved = await saveCurrentScript();
    setStatus({ level: "ok", text: `Saved ${saved.name}` });
    doLog("info", `Saved Pine script: ${saved.name}`);
  };

  const handleRun = async () => {
    let preview = await compilePineRuntime({
      scriptId: "preview",
      sourceCode: source,
      candles: candles.slice(-500),
    }).catch(() => compilePineScript(source, candles.slice(-500), "preview"));
    if (preview.errors.length > 0) {
      const message = preview.errors[0];
      setStatus({ level: "error", text: message });
      doLog("error", `Pine compile failed: ${message}`);
      return;
    }

    const saved = await saveCurrentScript();
    await addCustomIndicator(saved);
    setStatus({ level: "ok", text: `Added ${saved.name} to chart` });
    doLog("info", `Added Pine indicator: ${saved.name}`);
  };

  const handleLoad = async (script: CustomIndicatorScript) => {
    await loadScript(script.id);
    setStatus({ level: "idle", text: `Loaded ${script.name}` });
  };

  const handleAddSaved = async (script: CustomIndicatorScript) => {
    await addCustomIndicator(script);
    setStatus({ level: "ok", text: `Added ${script.name} to chart` });
    doLog("info", `Added Pine indicator: ${script.name}`);
  };

  const handleDelete = async (script: CustomIndicatorScript) => {
    await deleteScript(script.id);
    setStatus({ level: "idle", text: `Deleted ${script.name}` });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#050505]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-terminal-border bg-black px-3">
        <div className="mr-2 text-xs font-semibold text-ink">Pine Editor</div>
        <div className="min-w-0 max-w-[280px] truncate rounded px-2 py-1 text-sm font-semibold text-ink">
          {dirtyTitle}
        </div>
        <button
          onClick={newScript}
          className="flex h-8 w-8 items-center justify-center rounded border border-terminal-border text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink"
          title="New script"
          aria-label="New script"
        >
          <FilePlus2 size={16} />
        </button>
        <button
          onClick={handleRun}
          className="flex h-8 w-8 items-center justify-center rounded border border-terminal-border text-ink-muted transition-colors hover:border-brand/60 hover:bg-brand/15 hover:text-brand"
          title="Save and add to chart"
          aria-label="Save and add to chart"
        >
          <Play size={16} />
        </button>
        <button
          onClick={handleSave}
          className="flex h-8 w-8 items-center justify-center rounded text-brand transition-colors hover:bg-brand/15"
          title="Save script"
          aria-label="Save script"
        >
          <CloudUpload size={17} />
        </button>
        <button
          onClick={handleSave}
          className="ml-auto flex h-8 items-center gap-1.5 rounded border border-terminal-border px-3 text-xs font-medium text-ink transition-colors hover:bg-terminal-hover"
        >
          <Save size={14} />
          Save
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-terminal-border bg-[#111]">
          <div className="flex h-9 shrink-0 items-center border-b border-terminal-border px-3 text-xs font-semibold text-ink">
            My scripts
          </div>
          <div className="border-b border-terminal-border p-2">
            <div className="flex h-8 items-center gap-2 rounded border border-terminal-border bg-[#070707] px-2">
              <Search size={14} className="text-ink-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                className="h-full min-w-0 flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-muted"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            {filteredScripts.length === 0 ? (
              <div className="px-3 py-6 text-xs text-ink-muted">
                No saved scripts.
              </div>
            ) : (
              filteredScripts.map((script) => (
                <div
                  key={script.id}
                  className={cn(
                    "group rounded px-2 py-2 text-xs text-ink transition-colors hover:bg-terminal-hover",
                    script.id === scriptId && "bg-brand/15",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleFavorite(script.id)}
                      className={cn(
                        "shrink-0 rounded p-0.5 text-ink-muted hover:text-choch",
                        script.favorite && "text-choch",
                      )}
                      title="Favorite"
                      aria-label="Favorite"
                    >
                      <Star
                        size={13}
                        fill={script.favorite ? "currentColor" : "none"}
                      />
                    </button>
                    <button
                      onClick={() => handleLoad(script)}
                      className="min-w-0 flex-1 truncate text-left font-semibold hover:text-brand"
                      title={script.name}
                    >
                      {script.name}
                    </button>
                  </div>
                  <div className="mt-1 flex items-center gap-1 pl-5">
                    <button
                      onClick={() => handleAddSaved(script)}
                      className="rounded bg-brand px-2 py-0.5 text-2xs font-semibold text-white hover:bg-brand/80"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => handleLoad(script)}
                      className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-terminal-hover hover:text-ink"
                      title="Edit"
                      aria-label="Edit"
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      onClick={() => handleDelete(script)}
                      className="flex h-6 w-6 items-center justify-center rounded text-ink-muted hover:bg-bear/10 hover:text-bear"
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-terminal-border bg-[#070707] px-3">
            <label className="text-2xs font-semibold uppercase tracking-wide text-ink-faint">
              Script name
            </label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-6 w-[260px] rounded border border-terminal-border bg-terminal-bg px-2 text-xs text-ink outline-none focus:border-brand"
            />
            <span className="text-2xs text-ink-faint">
              {meta.overlay ? "Overlay" : "Separate pane"}
            </span>
            <span
              className={cn(
                "ml-auto truncate text-2xs",
                status.level === "ok" && "text-bull",
                status.level === "error" && "text-bear",
                status.level === "idle" && "text-ink-muted",
              )}
              title={status.text}
            >
              {status.text}
            </span>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-[56px_1fr] overflow-hidden font-mono text-[12px] leading-5">
            <div
              ref={gutterRef}
              className="overflow-hidden border-r border-terminal-border bg-[#050505] py-2 text-right text-ink-faint"
            >
              {lineNumbers.map((line) => (
                <div key={line} className="h-5 pr-3 tabular-nums">
                  {line}
                </div>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setStatus({ level: "idle", text: "Ready" });
              }}
              onScroll={syncScroll}
              spellCheck={false}
              aria-label="Pine source code"
              className="h-full w-full resize-none overflow-auto bg-[#050505] px-3 py-2 font-mono text-[12px] leading-5 text-ink outline-none selection:bg-brand/30"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
