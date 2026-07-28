"use client";

import {
  Check,
  Plus,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { useFloatingSurface } from "@/hooks/useFloatingSurface";
import { cn } from "@/utils/cn";
import {
  TRADINGVIEW_COLOR_PALETTE,
  colorOpacity,
  colorWithOpacity,
  hexToHsv,
  hsvToHex,
  normalizeHexColor,
  normalizeOpacity,
  type HsvColor,
} from "./colorPickerModel";

const CUSTOM_COLOR_STORAGE_KEY = "tradingview.customColors.v1";
const CUSTOM_COLOR_LIMIT = 9;

export interface ColorPickerPopoverProps {
  value?: string;
  opacity?: number;
  onChange: (color: string) => void;
  onOpacityChange?: (opacity: number) => void;
  allowNone?: boolean;
  noneLabel?: string;
  onClear?: () => void;
  onClose: () => void;
  side?: "bottom" | "right";
  className?: string;
  dataDrawingToolbarPopover?: boolean;
}

function customColorsFromStorage(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CUSTOM_COLOR_STORAGE_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((color): color is string => typeof color === "string")
      .map((color) => normalizeHexColor(color))
      .slice(0, CUSTOM_COLOR_LIMIT);
  } catch {
    return [];
  }
}

function persistCustomColor(color: string): string[] {
  const normalized = normalizeHexColor(color);
  const next = [
    normalized,
    ...customColorsFromStorage().filter((item) => item !== normalized),
  ].slice(0, CUSTOM_COLOR_LIMIT);
  try {
    window.localStorage.setItem(CUSTOM_COLOR_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in private browsing or embedded webviews.
  }
  return next;
}

function pickerAnchor(
  element: HTMLElement | null,
  side: "bottom" | "right",
) {
  const bounds = element?.getBoundingClientRect();
  if (!bounds) return { x: 8, y: 8 };
  return side === "right"
    ? { x: bounds.right + 6, y: bounds.top }
    : { x: bounds.left, y: bounds.bottom + 6 };
}

export function ColorPickerPopover({
  value,
  opacity,
  onChange,
  onOpacityChange,
  allowNone,
  noneLabel = "No color",
  onClear,
  onClose,
  side = "bottom",
  className,
  dataDrawingToolbarPopover,
}: ColorPickerPopoverProps) {
  const anchorElement = useRef<HTMLElement | null>(
    typeof document !== "undefined" &&
      document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );
  const [anchor, setAnchor] = useState(() =>
    pickerAnchor(anchorElement.current, side),
  );
  const [view, setView] = useState<"palette" | "custom">("palette");
  const [customColors, setCustomColors] = useState<string[]>([]);
  const normalizedValue = normalizeHexColor(value);
  const effectiveOpacity =
    opacity === undefined
      ? colorOpacity(value)
      : normalizeOpacity(opacity);
  const [draftHex, setDraftHex] = useState(normalizedValue);
  const [draftHsv, setDraftHsv] = useState<HsvColor>(() =>
    hexToHsv(normalizedValue),
  );
  const { surfaceRef, layout } = useFloatingSurface(anchor, 8);

  useEffect(() => setCustomColors(customColorsFromStorage()), []);

  useLayoutEffect(() => {
    const updateAnchor = () =>
      setAnchor((current) => {
        const next = pickerAnchor(anchorElement.current, side);
        return current.x === next.x && current.y === next.y ? current : next;
      });
    updateAnchor();
    window.addEventListener("scroll", updateAnchor, true);
    window.addEventListener("resize", updateAnchor);
    window.visualViewport?.addEventListener("scroll", updateAnchor);
    return () => {
      window.removeEventListener("scroll", updateAnchor, true);
      window.removeEventListener("resize", updateAnchor);
      window.visualViewport?.removeEventListener("scroll", updateAnchor);
    };
  }, [side]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: globalThis.PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (surfaceRef.current?.contains(target)) return;
      if (anchorElement.current?.contains(target)) return;
      onClose();
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        anchorElement.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, surfaceRef]);

  const applyPaletteColor = (color: string) => {
    onChange(
      onOpacityChange ? color : colorWithOpacity(color, effectiveOpacity),
    );
    onClose();
  };

  const applyOpacity = (nextOpacity: number) => {
    if (onOpacityChange) {
      onOpacityChange(nextOpacity);
      return;
    }
    onChange(colorWithOpacity(normalizedValue, nextOpacity));
  };

  const updateDraft = (next: HsvColor) => {
    setDraftHsv(next);
    setDraftHex(hsvToHex(next));
  };

  const addCustomColor = () => {
    const color = normalizeHexColor(draftHex);
    setCustomColors(persistCustomColor(color));
    onChange(
      onOpacityChange ? color : colorWithOpacity(color, effectiveOpacity),
    );
    onClose();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={surfaceRef}
      data-color-popover
      data-color-picker-view={view}
      data-drawing-toolbar-popover={
        dataDrawingToolbarPopover ? "true" : undefined
      }
      role="dialog"
      aria-label="Color picker"
      className={cn(
        "mobile-popover fixed z-[1500] w-[242px] overflow-y-auto rounded-md border border-terminal-border-strong bg-terminal-panel-2 p-2 shadow-floating",
        className,
      )}
      style={{
        left: layout.x,
        top: layout.y,
        maxWidth: layout.maxWidth || undefined,
        maxHeight: layout.maxHeight || undefined,
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {view === "palette" ? (
        <PaletteView
          value={normalizedValue}
          opacity={effectiveOpacity}
          customColors={customColors}
          onPick={applyPaletteColor}
          onOpenCustom={() => {
            setDraftHex(normalizedValue);
            setDraftHsv(hexToHsv(normalizedValue));
            setView("custom");
          }}
          onOpacityChange={applyOpacity}
          allowNone={allowNone}
          noneLabel={noneLabel}
          onClear={() => {
            onClear?.();
            onClose();
          }}
        />
      ) : (
        <CustomColorView
          hex={draftHex}
          hsv={draftHsv}
          onHexChange={(nextHex) => {
            setDraftHex(nextHex);
            if (/^#[0-9a-f]{6}$/i.test(nextHex)) {
              setDraftHsv(hexToHsv(nextHex));
            }
          }}
          onHsvChange={updateDraft}
          onAdd={addCustomColor}
        />
      )}
    </div>,
    document.body,
  );
}

function PaletteView({
  value,
  opacity,
  customColors,
  onPick,
  onOpenCustom,
  onOpacityChange,
  allowNone,
  noneLabel,
  onClear,
}: {
  value: string;
  opacity?: number;
  customColors: readonly string[];
  onPick: (color: string) => void;
  onOpenCustom: () => void;
  onOpacityChange: (opacity: number) => void;
  allowNone?: boolean;
  noneLabel: string;
  onClear: () => void;
}) {
  const normalizedOpacity = normalizeOpacity(opacity);
  const opacityPercent = Math.round(normalizedOpacity * 100);

  return (
    <>
      <div data-color-grid className="grid grid-cols-10 gap-[5px]">
        {TRADINGVIEW_COLOR_PALETTE.flat().map((color) => (
          <PaletteColor
            key={color}
            color={color}
            selected={value === color}
            onPick={onPick}
          />
        ))}
      </div>

      <div className="mt-4 flex min-h-7 items-center gap-[5px] border-t border-terminal-border-strong pt-3">
        <button
          type="button"
          aria-label="Add custom color"
          title="Add custom color"
          onClick={onOpenCustom}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-ring"
        >
          <Plus size={15} />
        </button>
        {customColors.map((color) => (
          <PaletteColor
            key={`custom-${color}`}
            color={color}
            selected={value === color}
            onPick={onPick}
          />
        ))}
        {allowNone && (
          <button
            type="button"
            onClick={onClear}
            className="ml-auto whitespace-nowrap rounded px-1.5 py-1 text-[10px] text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-ring"
          >
            {noneLabel}
          </button>
        )}
      </div>

      <div className="mt-3">
          <label
            htmlFor="common-color-opacity"
            className="mb-2 block text-[11px] font-medium text-ink-faint"
          >
            Opacity
          </label>
          <div className="flex items-center gap-2">
            <div
              className="relative h-[10px] min-w-0 flex-1 overflow-hidden rounded-full border border-terminal-border-strong"
              style={{
                backgroundImage:
                  "linear-gradient(45deg,#4b4f58 25%,transparent 25%,transparent 75%,#4b4f58 75%,#4b4f58),linear-gradient(45deg,#4b4f58 25%,transparent 25%,transparent 75%,#4b4f58 75%,#4b4f58)",
                backgroundPosition: "0 0,4px 4px",
                backgroundSize: "8px 8px",
              }}
            >
              <span
                className="pointer-events-none absolute inset-0"
                style={{
                  background: `linear-gradient(90deg, transparent, ${value})`,
                }}
              />
              <input
                id="common-color-opacity"
                aria-label="Opacity"
                type="range"
                min={0}
                max={100}
                value={opacityPercent}
                onChange={(event) =>
                  onOpacityChange(Number(event.target.value) / 100)
                }
                className="absolute -inset-x-0.5 -inset-y-[7px] h-6 w-[calc(100%+4px)] cursor-pointer appearance-none bg-transparent accent-white [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-terminal-panel-2 [&::-moz-range-thumb]:bg-white [&::-webkit-slider-thumb]:mt-[5px] [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-terminal-panel-2 [&::-webkit-slider-thumb]:bg-white"
              />
            </div>
            <div className="flex h-7 w-[54px] items-center rounded border border-terminal-border-strong bg-terminal-raised px-1">
              <input
                aria-label="Opacity percent"
                type="number"
                min={0}
                max={100}
                value={opacityPercent}
                onChange={(event) =>
                  onOpacityChange(
                    Math.max(0, Math.min(100, Number(event.target.value))) /
                      100,
                  )
                }
                className="min-w-0 flex-1 appearance-none bg-transparent text-right text-[11px] font-semibold text-ink outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="text-[11px] font-semibold text-ink-muted">%</span>
            </div>
          </div>
      </div>
    </>
  );
}

function PaletteColor({
  color,
  selected,
  onPick,
}: {
  color: string;
  selected: boolean;
  onPick: (color: string) => void;
}) {
  return (
    <button
      data-color-option
      type="button"
      aria-label={`Use ${color}`}
      aria-pressed={selected}
      title={color}
      onClick={() => onPick(color)}
      className={cn(
        "relative h-[18px] w-[18px] rounded-[2px] border border-black/10 transition-transform hover:scale-110 focus-ring",
        selected &&
          "ring-2 ring-white ring-offset-1 ring-offset-terminal-panel-2 after:absolute after:-inset-[3px] after:rounded-[4px] after:border after:border-black",
      )}
      style={{ backgroundColor: color }}
    >
      {selected && (
        <Check
          size={11}
          strokeWidth={3}
          className={cn(
            "absolute inset-0 m-auto drop-shadow",
            isLightColor(color) ? "text-black/75" : "text-white",
          )}
        />
      )}
    </button>
  );
}

function CustomColorView({
  hex,
  hsv,
  onHexChange,
  onHsvChange,
  onAdd,
}: {
  hex: string;
  hsv: HsvColor;
  onHexChange: (hex: string) => void;
  onHsvChange: (hsv: HsvColor) => void;
  onAdd: () => void;
}) {
  const validHex = /^#[0-9a-f]{6}$/i.test(hex);
  const hueColor = hsvToHex({
    hue: hsv.hue,
    saturation: 1,
    value: 1,
  });

  return (
    <>
      <div className="mb-2 flex items-center gap-2">
        <span
          aria-hidden="true"
          className="h-7 w-7 shrink-0 rounded border border-terminal-border-strong"
          style={{ backgroundColor: validHex ? hex : hueColor }}
        />
        <input
          aria-label="Custom color hex"
          value={hex}
          maxLength={7}
          spellCheck={false}
          onChange={(event) => {
            const raw = event.target.value.trim();
            onHexChange(raw.startsWith("#") ? raw : `#${raw}`);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && validHex) onAdd();
          }}
          className={cn(
            "h-7 min-w-0 flex-1 rounded border bg-terminal-raised px-2 text-[12px] font-semibold text-ink outline-none transition-colors focus:ring-1",
            validHex
              ? "border-terminal-border-strong focus:border-brand focus:ring-brand"
              : "border-bear focus:border-bear focus:ring-bear",
          )}
        />
        <button
          type="button"
          disabled={!validHex}
          onClick={onAdd}
          className="h-7 rounded-md bg-white px-2 text-[12px] font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 focus-ring"
        >
          Add
        </button>
      </div>
      <div className="flex h-[184px] gap-2">
        <SaturationValueArea
          hsv={hsv}
          hueColor={hueColor}
          onChange={onHsvChange}
        />
        <HueRail hsv={hsv} onChange={onHsvChange} />
      </div>
    </>
  );
}

function SaturationValueArea({
  hsv,
  hueColor,
  onChange,
}: {
  hsv: HsvColor;
  hueColor: string;
  onChange: (hsv: HsvColor) => void;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = areaRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const saturation = Math.max(
      0,
      Math.min(1, (event.clientX - bounds.left) / bounds.width),
    );
    const value = 1 - Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );
    onChange({ ...hsv, saturation, value });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next = hsv;
    if (event.key === "ArrowLeft") {
      next = { ...hsv, saturation: Math.max(0, hsv.saturation - step) };
    } else if (event.key === "ArrowRight") {
      next = { ...hsv, saturation: Math.min(1, hsv.saturation + step) };
    } else if (event.key === "ArrowUp") {
      next = { ...hsv, value: Math.min(1, hsv.value + step) };
    } else if (event.key === "ArrowDown") {
      next = { ...hsv, value: Math.max(0, hsv.value - step) };
    } else {
      return;
    }
    event.preventDefault();
    onChange(next);
  };

  return (
    <div
      ref={areaRef}
      role="slider"
      tabIndex={0}
      aria-label="Color saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(hsv.saturation * 100)}
      aria-valuetext={`${Math.round(hsv.saturation * 100)}% saturation, ${Math.round(hsv.value * 100)}% brightness`}
      className="relative min-w-0 flex-1 cursor-crosshair overflow-hidden rounded-sm focus-ring"
      style={{
        backgroundColor: hueColor,
        backgroundImage:
          "linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent)",
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          updateFromPointer(event);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <span
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/.55)]"
        style={{
          left: `${hsv.saturation * 100}%`,
          top: `${(1 - hsv.value) * 100}%`,
        }}
      />
    </div>
  );
}

function HueRail({
  hsv,
  onChange,
}: {
  hsv: HsvColor;
  onChange: (hsv: HsvColor) => void;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const updateFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = railRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const ratio = Math.max(
      0,
      Math.min(1, (event.clientY - bounds.top) / bounds.height),
    );
    onChange({ ...hsv, hue: ratio * 360 });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onChange({
      ...hsv,
      hue:
        (hsv.hue + (event.key === "ArrowUp" ? -step : step) + 360) % 360,
    });
  };

  return (
    <div
      ref={railRef}
      role="slider"
      tabIndex={0}
      aria-label="Color hue"
      aria-valuemin={0}
      aria-valuemax={360}
      aria-valuenow={Math.round(hsv.hue)}
      className="relative w-[17px] shrink-0 cursor-ns-resize rounded-sm focus-ring"
      style={{
        background:
          "linear-gradient(to bottom,#f00 0%,#ff0 16.67%,#0f0 33.33%,#0ff 50%,#00f 66.67%,#f0f 83.33%,#f00 100%)",
      }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          updateFromPointer(event);
        }
      }}
      onKeyDown={onKeyDown}
    >
      <span
        className="pointer-events-none absolute -left-[2px] h-[5px] w-[21px] -translate-y-1/2 rounded-[2px] border border-white bg-transparent shadow-[0_0_0_1px_rgb(0_0_0/.65)]"
        style={{ top: `${(hsv.hue / 360) * 100}%` }}
      />
    </div>
  );
}

export function ColorSwatchButton({
  color,
  opacity,
  onClick,
  label = "Choose color",
  className,
}: {
  color?: string;
  opacity?: number;
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        event.currentTarget.focus();
        onClick();
      }}
      className={cn(
        "relative h-[34px] w-[34px] shrink-0 overflow-hidden rounded-md border border-terminal-border-strong focus-ring",
        className,
      )}
      style={{
        backgroundImage:
          "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%,#555),linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%,#555)",
        backgroundPosition: "0 0,4px 4px",
        backgroundSize: "8px 8px",
      }}
    >
      <span
        className="absolute inset-0"
        style={{
          background:
            color && color !== "none" ? color : "transparent",
          opacity: normalizeOpacity(opacity),
        }}
      />
    </button>
  );
}

export function ColorPickerControl({
  value,
  opacity,
  onChange,
  onOpacityChange,
  allowNone,
  noneLabel,
  onClear,
  label,
  side,
  triggerClassName,
}: Omit<ColorPickerPopoverProps, "onClose"> & {
  label?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ColorSwatchButton
        color={value}
        opacity={opacity}
        label={label}
        className={triggerClassName}
        onClick={() => setOpen((current) => !current)}
      />
      {open && (
        <ColorPickerPopover
          value={value}
          opacity={opacity}
          onChange={onChange}
          onOpacityChange={onOpacityChange}
          allowNone={allowNone}
          noneLabel={noneLabel}
          onClear={onClear}
          side={side}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function isLightColor(color: string): boolean {
  const normalized = normalizeHexColor(color);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 165;
}
