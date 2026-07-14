"use client";

import { useAtomValue } from "jotai";
import { CircleAlert, Info, ScrollText, TriangleAlert } from "lucide-react";
import { logsAtom } from "@/store/uiStore";
import { fmtDateTime } from "@/utils/time";
import { cn } from "@/utils/cn";

export function MobileLogsWorkspace() {
  const logs = useAtomValue(logsAtom);
  return (
    <div className="mobile-logs-workspace">
      <div className="mobile-workspace-summary"><ScrollText size={18} /><span><strong>Runtime activity</strong><small>{logs.length} recent events · newest first</small></span></div>
      {logs.length === 0 ? (
        <div className="mobile-empty-state"><strong>No events yet</strong><span>Market, chart, synchronization and execution messages will appear here.</span></div>
      ) : (
        <div className="mobile-log-list">
          {logs.map((entry) => (
            <article key={entry.id} className={cn(`is-${entry.level}`)}>
              <span className="mobile-log-icon">{entry.level === "error" ? <CircleAlert /> : entry.level === "warn" ? <TriangleAlert /> : <Info />}</span>
              <span><span><strong>{entry.level}</strong><time>{fmtDateTime(entry.time)}</time></span><p>{entry.msg}</p></span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
