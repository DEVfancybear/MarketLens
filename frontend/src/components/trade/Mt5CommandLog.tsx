"use client";
import { clearMt5LogAtom, mt5CommandLogAtom, mt5EnabledAtom } from "@/store/mt5Store";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";

export function Mt5CommandLog() {
  const enabled = useAtomValue(mt5EnabledAtom);
  const logs = useAtomValue(mt5CommandLogAtom);
  const clear = useSetAtom(clearMt5LogAtom);

  if (!enabled) return null;

  return (
    <div className="h-20 shrink-0 border-t border-terminal-border bg-terminal-panel-2">
      <div className="flex h-6 items-center justify-between border-b border-terminal-border px-2 text-[10px]">
        <span className="font-semibold uppercase text-ink-muted">MT5 log</span>
        <button
          onClick={clear}
          className="rounded px-1.5 py-0.5 text-ink-faint hover:bg-terminal-hover hover:text-ink"
        >
          Clear
        </button>
      </div>
      <div className="h-14 overflow-auto px-2 py-1 text-[10px]">
        {logs.length === 0 ? (
          <div className="py-2 text-ink-faint">No execution events yet.</div>
        ) : (
          logs.slice(0, 12).map((entry) => (
            <div key={entry.id} className="flex gap-2 leading-5">
              <span
                className={cn(
                  "w-10 shrink-0 uppercase",
                  entry.level === "error"
                    ? "text-bear"
                    : entry.level === "warn"
                      ? "text-choch"
                      : "text-ink-faint",
                )}
              >
                {entry.level}
              </span>
              <span className="w-20 shrink-0 text-ink-faint">{entry.type}</span>
              <span className="min-w-0 truncate text-ink-muted">{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
