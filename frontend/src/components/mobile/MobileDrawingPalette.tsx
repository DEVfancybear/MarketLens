"use client";

import { useAtomValue, useSetAtom } from "jotai";
import { Crosshair, Eraser, Minus, MousePointer2, PenLine, Square, Type, Waves } from "lucide-react";
import { activeToolAtom, setActiveToolAtom } from "@/store/chartStore";
import type { DrawingTool } from "@/types";
import { cn } from "@/utils/cn";

const TOOLS: { id: DrawingTool; label: string; icon: React.ReactNode }[] = [
  { id: "cursor", label: "Select", icon: <MousePointer2 /> },
  { id: "crosshair", label: "Crosshair", icon: <Crosshair /> },
  { id: "trendline", label: "Trend line", icon: <PenLine /> },
  { id: "horizontal", label: "Horizontal", icon: <Minus /> },
  { id: "rectangle", label: "Rectangle", icon: <Square /> },
  { id: "fibRetracement", label: "Fibonacci", icon: <Waves /> },
  { id: "text", label: "Text note", icon: <Type /> },
  { id: "eraser", label: "Eraser", icon: <Eraser /> },
];

export function MobileDrawingPalette({ onDone }: { onDone: () => void }) {
  const active = useAtomValue(activeToolAtom);
  const select = useSetAtom(setActiveToolAtom);
  return <div className="mobile-tool-grid">{TOOLS.map((tool) => <button type="button" key={tool.id} className={cn(active === tool.id && "is-active")} aria-pressed={active === tool.id} onClick={() => { select(tool.id); onDone(); }}><span>{tool.icon}</span><strong>{tool.label}</strong></button>)}</div>;
}
