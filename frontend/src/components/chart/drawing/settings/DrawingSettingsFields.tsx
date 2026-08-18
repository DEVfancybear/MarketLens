import { Check, ChevronDown } from "lucide-react";
import {
  ColorPickerPopover,
  ColorSwatchButton,
} from "../../../ui/ColorPicker";
import type { LineStyle } from "../../../../types/drawing";
import { cn } from "../../../../utils/cn";

const LINE_STYLES: { value: LineStyle; dash: string }[] = [
  { value: "solid", dash: "" }, { value: "dashed", dash: "6 4" },
  { value: "dotted", dash: "2 4" },
];

export function CheckBox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <button role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors", checked ? "border-brand bg-brand text-(--accent-contrast)" : "border-terminal-border-strong bg-transparent hover:border-ink")}>
    {checked && <Check size={11} strokeWidth={3} />}
  </button>;
}

export function Swatch({ color, opacity, onClick }: { color: string | undefined; opacity?: number; onClick: () => void }) {
  return <ColorSwatchButton color={color} opacity={opacity} onClick={onClick} />;
}

export function ColorPopover({ value, opacity, onPick, onOpacity, allowNone, onClose }: { value: string | undefined; opacity?: number; onPick: (c: string | null) => void; onOpacity?: (o: number) => void; allowNone?: boolean; onClose: () => void }) {
  return <ColorPickerPopover
    value={value}
    opacity={opacity}
    onChange={(color) => onPick(color)}
    onOpacityChange={onOpacity}
    allowNone={allowNone}
    onClear={() => onPick(null)}
    onClose={onClose}
  />;
}

export function LineWidget({ color, width, style, open, onToggle, onWidth, onStyle, onClose }: { color: string; width: number; style: LineStyle; open: boolean; onToggle: () => void; onWidth: (w: number) => void; onStyle: (s: LineStyle) => void; onClose: () => void }) {
  const dash = LINE_STYLES.find((item) => item.value === style)?.dash || undefined;
  return <div className="relative"><button aria-label="Line style" onClick={(event) => { event.stopPropagation(); onToggle(); }} className="flex h-[34px] items-center gap-1.5 rounded-md border border-terminal-border-strong bg-terminal-raised px-2 hover:border-brand hover:bg-terminal-hover"><svg width="32" height="12" className="text-ink" style={{ color }}><line x1="1" y1="6" x2="31" y2="6" stroke="currentColor" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" /></svg><ChevronDown size={12} className="text-ink-faint" /></button>
    {open && <div className="mobile-popover absolute right-0 top-full z-30 mt-1 w-[160px] rounded-md border border-terminal-border-strong bg-terminal-panel-2 p-2 shadow-floating" onClick={(event) => event.stopPropagation()}><div className="mb-2 flex items-center gap-2"><span className="text-2xs text-ink-faint">Width</span><input aria-label="Line width" type="range" min={1} max={10} value={width} onChange={(event) => onWidth(Number(event.target.value))} className="flex-1 accent-brand" /><span className="w-7 text-right text-2xs text-ink-muted">{width}px</span></div>{LINE_STYLES.map((item) => <button aria-label={`${item.value} line`} key={item.value} onClick={() => { onStyle(item.value); onClose(); }} className="flex w-full items-center justify-between gap-2 rounded-sm px-1.5 py-1 hover:bg-terminal-hover"><svg width="80" height="10" className="text-ink"><line x1="1" y1="5" x2="79" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash || undefined} /></svg>{style === item.value && <Check size={12} className="text-brand" />}</button>)}</div>}
  </div>;
}

export function Select<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <select value={value} onChange={(event) => { const match = options.find((option) => String(option.value) === event.target.value); if (match) onChange(match.value); }} className="h-[34px] rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[13px] text-ink-muted outline-hidden transition-colors focus:border-brand focus:ring-1 focus:ring-brand">{options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select>;
}
