"use client";
import { executionModeAtom, mt5EnabledAtom, setExecutionModeAtom } from "@/store/mt5Store";
import { cn } from "@/utils/cn";
import { useAtomValue, useSetAtom } from "jotai";
import { Radio, Wifi } from "lucide-react";
import type { ExecutionMode } from "@/types/mt5";
import { useEffect } from "react";
import { activeAtom } from "@/store/replayStore";
import { isReplayBackendV1Enabled } from "@/services/replay/backendReplayFlag";

const MODES: { value: ExecutionMode; label: string }[] = [
  { value: "simulator", label: "Sim" },
  { value: "mt5", label: "MT5" },
];

export function ExecutionModeSwitch() {
  const mode = useAtomValue(executionModeAtom);
  const enabled = useAtomValue(mt5EnabledAtom);
  const setMode = useSetAtom(setExecutionModeAtom);
  const replayActive = useAtomValue(activeAtom);
  const isolatedReplay = isReplayBackendV1Enabled() && replayActive;

  useEffect(() => {
    if (isolatedReplay && mode !== "simulator") setMode("simulator");
  }, [isolatedReplay, mode, setMode]);

  return (
    <div className="flex items-center gap-1 rounded-sm border border-terminal-border bg-terminal-bg p-0.5">
      {MODES.map((item) => {
        const active = mode === item.value;
        const disabled = item.value === "mt5" && (!enabled || isolatedReplay);
        return (
          <button
            key={item.value}
            disabled={disabled}
            onClick={() => setMode(item.value)}
            className={cn(
              "flex h-6 items-center gap-1 rounded-sm px-2 text-[10px] font-semibold transition-colors",
              active
                ? item.value === "mt5"
                  ? "bg-bear/15 text-bear"
                  : "bg-brand/15 text-brand"
                : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
              disabled && "cursor-not-allowed opacity-45 hover:bg-transparent",
            )}
            title={disabled
              ? isolatedReplay ? "MT5 execution is disabled during isolated replay trading" : "MT5 bridge is disabled"
              : `${item.label} execution mode`}
          >
            {item.value === "mt5" ? <Wifi size={12} /> : <Radio size={12} />}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
