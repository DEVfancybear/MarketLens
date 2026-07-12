"use client";
/**
 * useDrawingActions — single source of truth for the per-drawing action list
 * (Settings, Clone, Lock, Hide, Bring to Front, Send to Back, Delete). Shared by
 * the right-click `DrawingContextMenu` and the toolbar's "⋯ More" popover so both
 * stay in sync.
 */
import type { ReactNode } from "react";
import {
  Trash2,
  Copy,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ChevronUp,
  ChevronDown,
  Settings,
  Clock3,
  Globe2,
  PanelsTopLeft,
  Monitor,
} from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  duplicateDrawingAtom,
  bringToFrontAtom,
  sendToBackAtom,
  setEditingDrawingAtom,
  timeframeAtom,
  updateDrawingAtom,
  drawingsAtom,
  drawingLayoutIdAtom,
  drawingChartIdAtom,
  symbolAtom,
} from "@/store/chartStore";
import type { Drawing } from "@/types";
import {
  DRAWING_INTERVAL_VISIBILITY_PRESETS,
  intervalVisibilityForPreset,
} from "./visibility/drawingIntervalVisibility";
import {
  DRAWING_SYNC_MODE_OPTIONS,
  drawingSyncBinding,
  drawingSyncMode,
} from "./persistence/drawingSyncScope";
import { BatchPropertyChangeCommand, drawingCommandManager } from "./history/CommandManager";
import { useDrawingBulkActions } from "./bulk/useDrawingBulkActions";
import type { DrawingBulkScope } from "./bulk/drawingBulkOperations";

export type DrawingAction =
  | { divider: true }
  | {
      divider?: false;
      icon: ReactNode;
      label: string;
      onClick: () => void;
      danger?: boolean;
    };

/**
 * @param drawing  the selected drawing (or null)
 * @param onAfter  invoked after any action runs (e.g. close the menu/popover)
 */
export function useDrawingActions(
  drawing: Drawing | null,
  onAfter?: () => void,
): DrawingAction[] {
  const duplicate = useSetAtom(duplicateDrawingAtom);
  const toFront = useSetAtom(bringToFrontAtom);
  const toBack = useSetAtom(sendToBackAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const drawings = useAtomValue(drawingsAtom);
  const layoutId = useAtomValue(drawingLayoutIdAtom);
  const chartId = useAtomValue(drawingChartIdAtom);
  const symbol = useAtomValue(symbolAtom);
  const bulk = useDrawingBulkActions();

  if (!drawing) return [];

  const actionScope: DrawingBulkScope =
    bulk.selectedIds.size > 1 && bulk.selectedIds.has(drawing.id)
      ? { kind: "selected" }
      : { kind: "object", drawingId: drawing.id };
  const actionTargets = bulk.targets(actionScope);
  const allLocked = actionTargets.length > 0 && actionTargets.every((item) => item.locked);
  const allHidden = actionTargets.length > 0 && actionTargets.every((item) => item.visible === false);

  const act = (fn: (id: string) => void) => () => {
    fn(drawing.id);
    onAfter?.();
  };
  const intervalActions: DrawingAction[] = DRAWING_INTERVAL_VISIBILITY_PRESETS.map(
    (preset) => ({
      icon: <Clock3 size={14} className="text-ink-muted" />,
      label: `Intervals: ${preset.label}`,
      onClick: () => {
        updateDrawing({
          id: drawing.id,
          patch: {
            intervalVisibility: intervalVisibilityForPreset(preset.id, timeframe),
          },
        });
        onAfter?.();
      },
    }),
  );
  const syncTargets = drawing.group
    ? drawings.filter((candidate) => candidate.group?.id === drawing.group?.id)
    : [drawing];
  const syncIcons = {
    "chart-only": <Monitor size={14} className="text-ink-muted" />,
    "layout-symbol": <PanelsTopLeft size={14} className="text-ink-muted" />,
    global: <Globe2 size={14} className="text-ink-muted" />,
  };
  const syncActions: DrawingAction[] = DRAWING_SYNC_MODE_OPTIONS.map((option) => ({
    icon: syncIcons[option.id],
    label: `${drawingSyncMode(drawing) === option.id ? "✓ " : ""}${option.label}`,
    onClick: () => {
      const binding = drawingSyncBinding(option.id, { symbol, layoutId, chartId });
      drawingCommandManager.execute(new BatchPropertyChangeCommand(
        updateDrawing,
        syncTargets.map((candidate) => ({
          id: candidate.id,
          newProps: { sync: binding },
          oldProps: { sync: candidate.sync },
        })),
        "Change Drawing Sync",
      ));
      onAfter?.();
    },
  }));

  return [
    {
      icon: <Settings size={14} className="text-ink-muted" />,
      label: "Settings",
      onClick: () => {
        setEditing(drawing.id);
        onAfter?.();
      },
    },
    { divider: true },
    {
      icon: <Copy size={14} className="text-ink-muted" />,
      label: "Clone",
      onClick: act(duplicate),
    },
    allLocked
      ? {
          icon: <Unlock size={14} className="text-choch" />,
          label: actionTargets.length > 1 ? "Unlock selected" : "Unlock",
          onClick: () => { bulk.toggleLock(actionScope); onAfter?.(); },
        }
      : {
          icon: <Lock size={14} className="text-ink-muted" />,
          label: actionTargets.length > 1 ? "Lock selected" : "Lock",
          onClick: () => { bulk.toggleLock(actionScope); onAfter?.(); },
        },
    allHidden
      ? {
          icon: <Eye size={14} className="text-bull" />,
          label: actionTargets.length > 1 ? "Show selected" : "Show",
          onClick: () => { bulk.toggleVisibility(actionScope); onAfter?.(); },
        }
      : {
          icon: <EyeOff size={14} className="text-ink-muted" />,
          label: actionTargets.length > 1 ? "Hide selected" : "Hide",
          onClick: () => { bulk.toggleVisibility(actionScope); onAfter?.(); },
        },
    ...intervalActions,
    { divider: true },
    ...syncActions,
    { divider: true },
    {
      icon: <ChevronUp size={14} className="text-ink-muted" />,
      label: "Bring to Front",
      onClick: act(toFront),
    },
    {
      icon: <ChevronDown size={14} className="text-ink-muted" />,
      label: "Send to Back",
      onClick: act(toBack),
    },
    { divider: true },
    {
      icon: <Trash2 size={14} className="text-bear" />,
      label: actionTargets.length > 1 ? "Delete selected" : "Delete",
      onClick: () => { bulk.remove(actionScope); onAfter?.(); },
      danger: true,
    },
  ];
}
