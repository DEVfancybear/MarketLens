"use client";

import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { ChevronDown, Plus, Star } from "lucide-react";
import { timeframeAtom, setTimeframeAtom } from "@/store/chartStore";
import { useTimeframeFavorites } from "@/hooks/useTimeframeFavorites";
import {
  CUSTOM_INTERVAL_TYPES,
  type CustomIntervalType,
  TIMEFRAME_MENU_GROUPS,
  customIntervalToTimeframe,
  timeframeShortLabel,
  visibleToolbarTimeframes,
} from "@/components/toolbar/timeframeSelectorModel";
import type { Timeframe } from "@/types";
import { cn } from "@/utils/cn";
import { MobileSheet } from "./MobileSheet";

export function MobileTimeframeBar() {
  const active = useAtomValue(timeframeAtom);
  const setTimeframe = useSetAtom(setTimeframeAtom);
  const { favorites, toggleFavorite, addFavorite } = useTimeframeFavorites();
  const [open, setOpen] = useState(false);
  const [customType, setCustomType] = useState<CustomIntervalType>("minutes");
  const [customValue, setCustomValue] = useState("");
  const visible = useMemo(
    () => visibleToolbarTimeframes(favorites, active),
    [active, favorites],
  );
  const resolvedCustom = customIntervalToTimeframe(customType, customValue);

  const choose = (timeframe: Timeframe) => {
    setTimeframe(timeframe);
    setOpen(false);
  };

  return (
    <>
      <div className="mobile-timeframes" aria-label="Chart interval">
        {visible.map((item) => (
          <button key={item} type="button" aria-pressed={active === item} onClick={() => setTimeframe(item)} className={cn(active === item && "is-active")}>{timeframeShortLabel(item)}</button>
        ))}
        <button type="button" aria-label="Select interval" className="mobile-timeframe-more" onClick={() => setOpen(true)}><ChevronDown size={18} /></button>
      </div>

      {open && (
        <MobileSheet title="Chart interval" onClose={() => setOpen(false)} fullscreen>
          <div className="mobile-interval-browser">
            <section className="mobile-custom-interval">
              <div className="mobile-workspace-section-heading"><span><Plus size={17} /></span><div><h3>Add custom interval</h3><p>Uses the same supported chart intervals as desktop</p></div></div>
              <div className="mobile-custom-interval-fields">
                <label><span>Type</span><select aria-label="Custom interval type" value={customType} onChange={(event) => setCustomType(event.target.value as CustomIntervalType)}>{CUSTOM_INTERVAL_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
                <label><span>Interval</span><input aria-label="Custom interval value" inputMode="numeric" value={customValue} onChange={(event) => setCustomValue(event.target.value.replace(/[^\d]/g, ""))} /></label>
                <button type="button" disabled={!resolvedCustom} onClick={() => {
                  if (!resolvedCustom) return;
                  addFavorite(resolvedCustom);
                  choose(resolvedCustom);
                  setCustomValue("");
                }}>Add</button>
              </div>
            </section>

            {TIMEFRAME_MENU_GROUPS.map((group) => (
              <section className="mobile-interval-group" key={group.label}>
                <header><h3>{group.label}</h3><small>{group.items.filter((item) => item.timeframe).length} supported</small></header>
                <div>
                  {group.items.map((item) => {
                    const supported = Boolean(item.timeframe);
                    const favorite = Boolean(item.timeframe && favorites.includes(item.timeframe));
                    return <article key={`${group.label}:${item.label}`} className={cn(item.timeframe === active && "is-active", !supported && "is-disabled")}>
                      <button type="button" disabled={!item.timeframe} onClick={() => item.timeframe && choose(item.timeframe)}><span><strong>{item.label}</strong><small>{item.timeframe ?? "Not available from the current data provider"}</small></span></button>
                      {item.timeframe && <button type="button" className={cn("mobile-interval-favorite", favorite && "is-active")} aria-label={`${favorite ? "Remove" : "Add"} ${item.label} ${favorite ? "from" : "to"} favorite intervals`} aria-pressed={favorite} onClick={() => toggleFavorite(item.timeframe!)}><Star size={18} fill={favorite ? "currentColor" : "none"} /></button>}
                    </article>;
                  })}
                </div>
              </section>
            ))}
          </div>
        </MobileSheet>
      )}
    </>
  );
}
