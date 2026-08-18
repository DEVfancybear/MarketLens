"use client";
import { useId } from "react";
import { Boxes, Check } from "lucide-react";
import { Dropdown } from "@/components/ui/Dropdown";
import {
  smcSettingsAtom,
  toggleSmcAtom,
} from "@/store/smcStore";
import { useAtomValue, useSetAtom } from "jotai";
import { cn } from "@/utils/cn";
import { SMC_MENU_ITEMS } from "@/components/chart/smcMenuItems";

export function SmcMenu() {
  const settings = useAtomValue(smcSettingsAtom);
  const toggle = useSetAtom(toggleSmcAtom);
  const menuId = useId();

  return (
    <Dropdown
      width={280}
      portal
      trigger={(open) => (
        <button
          type="button"
          aria-label="SMC"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={menuId}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand",
            open
              ? "bg-brand/15 text-brand"
              : "text-ink-muted hover:bg-terminal-hover hover:text-ink",
          )}
        >
          <Boxes size={14} />
          <span className="hidden xl:inline">SMC</span>
        </button>
      )}
    >
      {() => (
        <div
          id={menuId}
          role="menu"
          aria-label="Smart Money Concepts"
          className="py-0.5"
          onKeyDown={(event) => {
            if (
              event.key !== "ArrowDown" &&
              event.key !== "ArrowUp" &&
              event.key !== "Home" &&
              event.key !== "End"
            ) {
              return;
            }
            event.preventDefault();
            const items = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "[role='menuitemcheckbox']",
              ),
            );
            if (!items.length) return;
            const currentIndex = items.indexOf(document.activeElement as HTMLElement);
            const nextIndex =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? items.length - 1
                  : event.key === "ArrowDown"
                    ? (currentIndex + 1 + items.length) % items.length
                    : (currentIndex - 1 + items.length) % items.length;
            items[nextIndex]?.focus();
          }}
        >
          <div className="px-3 py-1 text-2xs font-semibold uppercase tracking-wide text-ink-faint">
            Smart Money Concepts
          </div>
          {SMC_MENU_ITEMS.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={settings[it.key]}
              tabIndex={-1}
              onClick={() => toggle(it.key)}
              className="flex min-h-9 w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs hover:bg-terminal-hover focus-visible:bg-terminal-hover focus-visible:outline-hidden"
            >
              <span
                className={cn(
                  "flex h-3.5 w-3.5 items-center justify-center rounded-xs border",
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
