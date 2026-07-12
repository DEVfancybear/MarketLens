"use client";
import { Boxes, Check } from "lucide-react";
import { Dropdown } from "@/components/ui/Dropdown";
import {
  smcSettingsAtom,
  toggleSmcAtom,
  type SmcSettings,
} from "@/store/smcStore";
import { useAtomValue, useSetAtom } from "jotai";
import { cn } from "@/utils/cn";

const ITEMS: { key: keyof SmcSettings; label: string; color: string }[] = [
  {
    key: "structure",
    label: "Market Structure (BOS/CHOCH/MSS)",
    color: "var(--bos)",
  },
  {
    key: "swings",
    label: "Swing Points (HH/HL/LH/LL)",
    color: "var(--text-muted)",
  },
  { key: "fvg", label: "Fair Value Gaps", color: "var(--fvg)" },
  { key: "orderBlocks", label: "Order Blocks", color: "var(--ob)" },
  { key: "liquidity", label: "Liquidity (EQH/EQL)", color: "var(--liquidity)" },
  { key: "displacement", label: "Displacement", color: "var(--choch)" },
  { key: "sessions", label: "Sessions", color: "var(--bull)" },
  { key: "killzones", label: "Kill Zones", color: "var(--choch)" },
];

export function SmcMenu() {
  const settings = useAtomValue(smcSettingsAtom);
  const toggle = useSetAtom(toggleSmcAtom);

  return (
    <Dropdown
      width={280}
      trigger={(open) => (
        <button
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors",
            open
              ? "border-brand/25 bg-brand-soft text-brand"
              : "border-transparent text-ink-muted hover:bg-terminal-hover hover:text-ink",
          )}
        >
          <Boxes size={14} />
          SMC
        </button>
      )}
    >
      {() => (
        <div className="py-0.5">
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Smart Money Concepts
          </div>
          {ITEMS.map((it) => (
            <button
              key={it.key}
              onClick={() => toggle(it.key)}
              className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-terminal-hover"
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-sm border",
                  settings[it.key]
                    ? "border-transparent"
                    : "border-terminal-border",
                )}
                style={{
                  background: settings[it.key] ? it.color : "transparent",
                }}
              >
                {settings[it.key] && <Check size={10} className="text-white" />}
              </span>
              <span className="flex-1 text-ink">{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
