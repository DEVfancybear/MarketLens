"use client";

import {
  clearMt5LogAtom,
  mt5CommandLogAtom,
  mt5EnabledAtom,
} from "@/store/mt5Store";
import { selectedExecutionAccountAtom } from "@/store/executionRegistryStore";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";
import { CircleCheck, Trash2 } from "lucide-react";

interface Mt5CommandLogProps {
  variant?: "compact" | "activity";
}

export function Mt5CommandLog({
  variant = "compact",
}: Mt5CommandLogProps) {
  const enabled = useAtomValue(mt5EnabledAtom);
  const account = useAtomValue(selectedExecutionAccountAtom);
  const allLogs = useAtomValue(mt5CommandLogAtom);
  const clear = useSetAtom(clearMt5LogAtom);
  const accountId = account?.id;
  const logs = accountId
    ? allLogs.filter((entry) => entry.accountId === accountId)
    : [];
  const expanded = variant === "activity";

  if (!enabled && !expanded) return null;

  return (
    <section
      aria-label={`MT5 execution activity for ${account?.label ?? "selected account"}`}
      className={cn(
        "flex min-h-0 flex-col bg-terminal-panel-2",
        expanded
          ? "flex-1"
          : "h-20 shrink-0 border-t border-terminal-border",
      )}
    >
      <header
        className={cn(
          "flex shrink-0 items-center justify-between border-b border-terminal-border px-3",
          expanded ? "h-9" : "h-6",
        )}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-semibold uppercase text-ink-muted">
            MT5 activity
          </span>
          {expanded && (
            <span className="rounded-full bg-terminal-hover px-1.5 py-0.5 text-[9px] tabular-nums text-ink-faint">
              {logs.length}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={logs.length === 0}
          onClick={() => clear(accountId)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-faint transition-colors hover:bg-terminal-hover hover:text-ink disabled:pointer-events-none disabled:opacity-40"
          aria-label="Clear execution activity for this account"
        >
          {expanded && <Trash2 size={11} aria-hidden="true" />}
          Clear
        </button>
      </header>

      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        className={cn(
          "min-h-0 overflow-auto text-[10px]",
          expanded ? "flex-1" : "h-14 px-2 py-1",
        )}
      >
        {logs.length === 0 ? (
          expanded ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="grid size-8 place-items-center rounded-full bg-bull/10 text-bull">
                <CircleCheck size={16} aria-hidden="true" />
              </span>
              <div className="text-xs font-medium text-ink-muted">
                {enabled
                  ? "No execution activity for this account"
                  : "Select an MT5 account to view activity"}
              </div>
              <p className="max-w-md text-[10px] leading-4 text-ink-faint">
                {enabled
                  ? "New routing results and MT5 broker acknowledgements will appear here. Cleared history stays hidden until a new event arrives."
                  : "Broker acknowledgements, fills, rejections, and reconciliation warnings are scoped to the selected execution account."}
              </p>
            </div>
          ) : (
            <div className="py-2 text-ink-faint">No execution events yet.</div>
          )
        ) : expanded ? (
          <div className="divide-y divide-terminal-border/65">
            {logs.map((entry) => (
              <div
                key={entry.id}
                className="grid min-h-8 grid-cols-[68px_56px_116px_minmax(0,1fr)] items-center gap-2 px-3 py-1.5 hover:bg-terminal-hover/45"
              >
                <time
                  dateTime={new Date(entry.time).toISOString()}
                  className="tabular-nums text-ink-faint"
                >
                  {formatLogTime(entry.time)}
                </time>
                <LogLevel level={entry.level} />
                <span className="truncate font-medium text-ink-faint">
                  {entry.type}
                </span>
                <span className="min-w-0 break-words leading-4 text-ink-muted">
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        ) : (
          logs.slice(0, 12).map((entry) => (
            <div key={entry.id} className="flex gap-2 leading-5">
              <LogLevel level={entry.level} />
              <span className="w-24 shrink-0 truncate text-ink-faint">
                {entry.type}
              </span>
              <span className="min-w-0 truncate text-ink-muted">
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function LogLevel({
  level,
}: {
  level: "info" | "warn" | "error";
}) {
  return (
    <span
      className={cn(
        "w-12 shrink-0 uppercase",
        level === "error"
          ? "text-bear"
          : level === "warn"
            ? "text-choch"
            : "text-ink-faint",
      )}
    >
      {level}
    </span>
  );
}

function formatLogTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
