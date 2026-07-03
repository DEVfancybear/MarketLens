"use client";
import { Code2, LineChart, Check, Settings } from "lucide-react";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import { useAtomValue, useSetAtom } from "jotai";
import { getDefaultStore } from "jotai";
import {
  indicatorsAtom,
  toggleIndicatorAtom,
  removeIndicatorAtom,
  setEditingIndicatorAtom,
  clearIndicatorsAtom,
  loadPineScriptAtom,
} from "@/store/chartStore";
import { setBottomTabAtom } from "@/store/uiStore";
import type { BuiltInIndicatorType } from "@/types";
import { cn } from "@/utils/cn";

const OPTIONS: { type: BuiltInIndicatorType; label: string }[] = [
  { type: "SMA", label: "Simple Moving Average" },
  { type: "EMA", label: "Exponential Moving Average" },
  { type: "VWAP", label: "VWAP (session)" },
  { type: "RSI", label: "Relative Strength Index" },
  { type: "MACD", label: "MACD" },
  { type: "ADR", label: "Average Daily Range" },
];

export function IndicatorMenu() {
  const indicators = useAtomValue(indicatorsAtom);
  const toggleIndicator = useSetAtom(toggleIndicatorAtom);
  const removeIndicator = useSetAtom(removeIndicatorAtom);
  const setEditingIndicator = useSetAtom(setEditingIndicatorAtom);
  const loadPineScript = useSetAtom(loadPineScriptAtom);
  const setBottomTab = useSetAtom(setBottomTabAtom);
  // Derived from live store state every render — never stale.
  const active = new Set(indicators.map((i) => i.type));

  return (
    <Dropdown
      width={280}
      trigger={() => (
        <button className="flex h-7 items-center gap-1.5 rounded px-2 text-[11px] text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink">
          <LineChart size={14} />
          Indicators
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Source scripts
          </div>
          <MenuItem
            onClick={() => {
              setBottomTab("pine");
              close();
            }}
          >
            <Code2 size={13} className="text-brand" />
            <span className="flex-1">Open Pine Editor</span>
          </MenuItem>
          <div className="mx-3 my-1 border-t border-terminal-border" />
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Add indicator
          </div>
          {OPTIONS.map((o) => (
            <MenuItem
              key={o.type}
              active={active.has(o.type)}
              onClick={() => {
                toggleIndicator(o.type);
                if (!active.has(o.type)) {
                  setTimeout(() => {
                    const added = getDefaultStore()
                      .get(indicatorsAtom)
                      .find((i) => i.type === o.type);
                    if (added) {
                      close();
                      setEditingIndicator(added.id);
                    }
                  }, 0);
                } else {
                  close();
                }
              }}
            >
              <span className="w-10 font-mono text-2xs text-brand">
                {o.type}
              </span>
              <span className="flex-1">{o.label}</span>
              {active.has(o.type) && <Check size={13} className="text-bull" />}
            </MenuItem>
          ))}

          {/* Active indicators with settings gear */}
          {indicators.filter((i) => i.visible).length > 0 && (
            <>
              <div className="mx-3 my-1 border-t border-terminal-border" />
              <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
                Active indicators
              </div>
              {indicators
                .filter((i) => i.visible)
                .map((ind) => (
                  <div
                    key={ind.id}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 text-[11px] text-ink",
                      "hover:bg-terminal-hover",
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ background: ind.color }}
                    />
                    <span className="flex-1 truncate">
                      {ind.type === "CUSTOM"
                        ? (ind.name ?? "Custom script")
                        : ind.type}
                      {ind.length > 0 && ` (${ind.length})`}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        close();
                        if (ind.type === "CUSTOM" && ind.scriptId) {
                          loadPineScript(ind.scriptId);
                          setBottomTab("pine");
                        } else {
                          setEditingIndicator(ind.id);
                        }
                      }}
                      className="rounded p-0.5 text-ink-muted hover:text-ink hover:bg-terminal-hover/50"
                      title="Settings"
                    >
                      <Settings size={11} />
                    </button>
                  </div>
                ))}
            </>
          )}

          {/* Remove all */}
          {indicators.length > 0 && (
            <>
              <div className="mx-3 my-1 border-t border-terminal-border" />
              <button
                onClick={() => {
                  getDefaultStore().set(clearIndicatorsAtom);
                  close();
                }}
                className="w-full px-3 py-1.5 text-left text-[11px] text-bear hover:bg-bear/10"
              >
                Remove all indicators
              </button>
            </>
          )}
        </div>
      )}
    </Dropdown>
  );
}
