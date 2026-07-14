import type { SmcSettings } from "@/store/smcStore";

/** Shared SMC overlay catalog consumed by both platform presentations. */
export const SMC_MENU_ITEMS: readonly {
  key: keyof SmcSettings;
  label: string;
  color: string;
}[] = [
  { key: "structure", label: "Market Structure (BOS/CHOCH/MSS)", color: "var(--bos)" },
  { key: "swings", label: "Swing Points (HH/HL/LH/LL)", color: "var(--text-muted)" },
  { key: "fvg", label: "Fair Value Gaps", color: "var(--fvg)" },
  { key: "orderBlocks", label: "Order Blocks", color: "var(--ob)" },
  { key: "liquidity", label: "Liquidity (EQH/EQL)", color: "var(--liquidity)" },
  { key: "displacement", label: "Displacement", color: "var(--choch)" },
  { key: "sessions", label: "Sessions", color: "var(--bull)" },
  { key: "killzones", label: "Kill Zones", color: "var(--choch)" },
];
