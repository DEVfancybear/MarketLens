"use client";

import { useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { ChevronRight, Code2, FilePlus2, Play, Save, TriangleAlert } from "lucide-react";
import { authStatusAtom } from "@/store/authStore";
import {
  addCustomIndicatorFromScriptAtom,
  candlesAtom,
  loadPineScriptAtom,
  newPineScriptAtom,
  pineEditorSourceAtom,
  pineEditorTitleAtom,
  pineScriptsAtom,
  savePineScriptAtom,
} from "@/store/chartStore";
import { compilePineRuntime } from "@/services/api/resources/pineRuntimeApi";
import { canUsePrivatePineWorkspace } from "@/services/privateWorkspaceAccess";

type WorkspaceStatus = { kind: "idle" | "working" | "success" | "error"; message: string };

/** Mobile-native Pine editor. It shares script atoms/runtime, never desktop editor DOM. */
export function MobilePineWorkspace() {
  const authStatus = useAtomValue(authStatusAtom);
  const candles = useAtomValue(candlesAtom);
  const scripts = useAtomValue(pineScriptsAtom);
  const [title, setTitle] = useAtom(pineEditorTitleAtom);
  const [source, setSource] = useAtom(pineEditorSourceAtom);
  const saveScript = useSetAtom(savePineScriptAtom);
  const addIndicator = useSetAtom(addCustomIndicatorFromScriptAtom);
  const loadScript = useSetAtom(loadPineScriptAtom);
  const newScript = useSetAtom(newPineScriptAtom);
  const [status, setStatus] = useState<WorkspaceStatus>({ kind: "idle", message: "Ready to compile" });

  if (!canUsePrivatePineWorkspace(authStatus)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand"><Code2 size={22} /></span>
        <strong className="text-base text-ink">Private Pine workspace</strong>
        <p className="text-sm leading-6 text-ink-muted">Sign in to create, save and run private indicators.</p>
      </div>
    );
  }

  const save = async () => {
    setStatus({ kind: "working", message: "Saving script…" });
    try {
      const saved = await saveScript({ name: title.trim() || "Untitled script", sourceCode: source });
      setStatus({ kind: "success", message: `Saved ${saved.name}` });
      return saved;
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Save failed" });
      return null;
    }
  };

  const run = async () => {
    setStatus({ kind: "working", message: "Compiling against the latest bars…" });
    try {
      const preview = await compilePineRuntime({
        scriptId: "mobile-preview",
        sourceCode: source,
        candles: candles.slice(-500),
      });
      if (preview.errors.length) throw new Error(preview.errors[0]);
      const saved = await saveScript({ name: title.trim() || preview.meta.name || "Untitled script", sourceCode: source });
      await addIndicator(saved);
      setStatus({ kind: "success", message: `${saved.name} added to chart` });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Compile failed" });
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-terminal-bg" data-chart-ui>
      <div className="flex items-center gap-2 border-b border-terminal-border p-3">
        <button type="button" onClick={() => newScript()} className="flex min-h-11 items-center gap-2 rounded-xl border border-terminal-border bg-terminal-panel-2 px-3 text-sm font-semibold text-ink-muted active:bg-terminal-pressed">
          <FilePlus2 size={17} /> New
        </button>
        <button type="button" onClick={() => void save()} disabled={status.kind === "working"} className="ml-auto flex min-h-11 items-center gap-2 rounded-xl border border-terminal-border bg-terminal-panel-2 px-3 text-sm font-semibold text-ink disabled:opacity-50 active:bg-terminal-pressed">
          <Save size={17} /> Save
        </button>
        <button type="button" onClick={() => void run()} disabled={status.kind === "working"} className="flex min-h-11 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] shadow-glow disabled:opacity-50">
          <Play size={17} fill="currentColor" /> Run
        </button>
      </div>

      <div className="space-y-3 p-3">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">Script name</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className="min-h-12 w-full rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 text-base font-semibold text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">Pine source</span>
          <textarea
            value={source}
            onChange={(event) => setSource(event.target.value)}
            spellCheck={false}
            className="min-h-[42dvh] w-full resize-y rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 py-3 font-mono text-base leading-6 text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <div aria-live="polite" className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 text-xs ${status.kind === "error" ? "border-bear/30 bg-bear/10 text-bear" : status.kind === "success" ? "border-bull/30 bg-bull/10 text-bull" : "border-terminal-border bg-terminal-panel-2 text-ink-muted"}`}>
          {status.kind === "error" ? <TriangleAlert size={16} /> : <Code2 size={16} />}
          <span>{status.message}</span>
        </div>
      </div>

      {scripts.length > 0 && (
        <section className="border-t border-terminal-border p-3">
          <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-ink-faint">Saved scripts</h3>
          <div className="space-y-2">
            {scripts.slice(0, 8).map((script) => (
              <button key={script.id} type="button" onClick={() => void loadScript(script.id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-terminal-border bg-terminal-panel px-3 text-left active:bg-terminal-pressed">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand"><Code2 size={17} /></span>
                <span className="min-w-0 flex-1"><strong className="block truncate text-sm text-ink">{script.name}</strong><small className="text-xs text-ink-faint">Open in editor</small></span>
                <ChevronRight size={18} className="text-ink-faint" />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
