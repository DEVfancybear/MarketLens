import { Check, ChevronDown } from "lucide-react";
import type { LineStyle } from "../../../../types/drawing";
import { cn } from "../../../../utils/cn";

const COLORS = [
  "#ffffff", "#d1d4dc", "#9598a1", "#5d606b", "#363a45", "#000000",
  "#f23645", "#ff9800", "#ffeb3b", "#26a69a", "#2962ff", "#ab47bc",
  "#e91e63", "#ff5722", "#cddc39", "#089981", "#0c3299", "#673ab7",
];
const LINE_STYLES: { value: LineStyle; dash: string }[] = [
  { value: "solid", dash: "" }, { value: "dashed", dash: "6 4" },
  { value: "dotted", dash: "2 4" },
];

export function CheckBox({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return <button role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} className={cn("flex h-4 w-4 items-center justify-center rounded-[3px] border transition-colors", checked ? "border-white bg-white text-[#1e1e1e]" : "border-[#8a8d93] bg-transparent hover:border-ink")}>
    {checked && <Check size={11} strokeWidth={3} />}
  </button>;
}

export function Swatch({ color, opacity, onClick }: { color: string | undefined; opacity?: number; onClick: () => void }) {
  return <button aria-label="Choose color" onClick={(event) => { event.stopPropagation(); onClick(); }} className="relative h-[34px] w-[34px] shrink-0 overflow-hidden rounded-md border border-[#50535a]" style={{ backgroundImage: "linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%,#555),linear-gradient(45deg,#555 25%,transparent 25%,transparent 75%,#555 75%,#555)", backgroundSize: "8px 8px", backgroundPosition: "0 0,4px 4px" }}>
    <span className="absolute inset-0" style={{ background: color && color !== "none" ? color : "transparent", opacity: opacity ?? 1 }} />
  </button>;
}

export function ColorPopover({ value, opacity, onPick, onOpacity, allowNone, onClose }: { value: string | undefined; opacity?: number; onPick: (c: string | null) => void; onOpacity?: (o: number) => void; allowNone?: boolean; onClose: () => void }) {
  return <div className="absolute right-0 top-full z-30 mt-1 w-[184px] rounded-md border border-[#50535a] bg-[#242424] p-2 shadow-2xl shadow-black/60" onClick={(event) => event.stopPropagation()}>
    <div className="grid grid-cols-6 gap-1.5">{COLORS.map((color) => <button aria-label={`Use ${color}`} key={color} onClick={() => { onPick(color); onClose(); }} className="relative h-5 w-5 rounded border border-[#50535a]" style={{ background: color }}>{value?.toLowerCase() === color.toLowerCase() && <Check size={11} className="absolute inset-0 m-auto text-black/70" />}</button>)}</div>
    {onOpacity && <div className="mt-2 flex items-center gap-2"><span className="text-2xs text-[#a0a3aa]">Opacity</span><input aria-label="Opacity" type="range" min={0} max={100} value={Math.round((opacity ?? 1) * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} className="flex-1 accent-brand" /><span className="w-8 text-right text-2xs text-[#d1d4dc]">{Math.round((opacity ?? 1) * 100)}%</span></div>}
    <div className="mt-2 flex items-center gap-2 border-t border-[#50535a] pt-2"><label className="flex items-center gap-1.5 text-2xs text-[#a0a3aa]"><input aria-label="Custom color" type="color" value={/^#[0-9a-f]{6}$/i.test(value ?? "") ? value : "#2962ff"} onChange={(event) => onPick(event.target.value)} className="h-5 w-6 cursor-pointer rounded border border-[#50535a] bg-transparent p-0" />Custom</label>{allowNone && <button onClick={() => { onPick(null); onClose(); }} className="ml-auto rounded px-1.5 py-0.5 text-2xs text-[#a0a3aa] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]">No color</button>}</div>
  </div>;
}

export function LineWidget({ color, width, style, open, onToggle, onWidth, onStyle, onClose }: { color: string; width: number; style: LineStyle; open: boolean; onToggle: () => void; onWidth: (w: number) => void; onStyle: (s: LineStyle) => void; onClose: () => void }) {
  const dash = LINE_STYLES.find((item) => item.value === style)?.dash || undefined;
  return <div className="relative"><button aria-label="Line style" onClick={(event) => { event.stopPropagation(); onToggle(); }} className="flex h-[34px] items-center gap-1.5 rounded-md border border-[#50535a] bg-[#1f1f1f] px-2 hover:border-[#6a6d75] hover:bg-[#2a2a2a]"><svg width="32" height="12" className="text-[#f0f0f0]" style={{ color }}><line x1="1" y1="6" x2="31" y2="6" stroke="currentColor" strokeWidth={width} strokeDasharray={dash} strokeLinecap="round" /></svg><ChevronDown size={12} className="text-[#a0a3aa]" /></button>
    {open && <div className="absolute right-0 top-full z-30 mt-1 w-[160px] rounded-md border border-[#50535a] bg-[#242424] p-2 shadow-2xl shadow-black/60" onClick={(event) => event.stopPropagation()}><div className="mb-2 flex items-center gap-2"><span className="text-2xs text-[#a0a3aa]">Width</span><input aria-label="Line width" type="range" min={1} max={10} value={width} onChange={(event) => onWidth(Number(event.target.value))} className="flex-1 accent-brand" /><span className="w-7 text-right text-2xs text-[#d1d4dc]">{width}px</span></div>{LINE_STYLES.map((item) => <button aria-label={`${item.value} line`} key={item.value} onClick={() => { onStyle(item.value); onClose(); }} className="flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 hover:bg-[#2a2a2a]"><svg width="80" height="10" className="text-[#f0f0f0]"><line x1="1" y1="5" x2="79" y2="5" stroke="currentColor" strokeWidth="2" strokeDasharray={item.dash || undefined} /></svg>{style === item.value && <Check size={12} className="text-[#2962ff]" />}</button>)}</div>}
  </div>;
}

export function Select<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return <select value={value} onChange={(event) => { const match = options.find((option) => String(option.value) === event.target.value); if (match) onChange(match.value); }} className="h-[34px] rounded-[5px] border border-[#50535a] bg-[#1f1f1f] px-2.5 text-[13px] text-[#d1d4dc] outline-none transition-colors focus:border-[#2962ff] focus:ring-1 focus:ring-[#2962ff]">{options.map((option) => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select>;
}
