"use client";

import {
  Brush,
  ChartNoAxesCombined,
  Play,
  SlidersHorizontal,
} from "lucide-react";
import { useAtomValue } from "jotai";
import { ChartPopupSurface } from "@/components/chart/ChartPopupSurface";
import { useReplayClientProjection } from "@/store/replayClientStore";
import { replaySelectionModeAtom } from "@/store/replayUiState";

export function MobileChartActions({
  openDrawing,
  openIndicators,
  openTools,
  openReplay,
}: {
  openDrawing: () => void;
  openIndicators: () => void;
  openTools: () => void;
  openReplay: () => void;
}) {
  const replay = useReplayClientProjection();
  const selection = useAtomValue(replaySelectionModeAtom);
  const replayBusy = Boolean(replay.snapshot) ||
    replay.connection === "connecting" ||
    replay.connection === "recovering";

  if (selection !== "idle") return null;

  return (
    <ChartPopupSurface
      dragLabel="Move chart actions"
      data-mobile-chart-actions
      className="mobile-chart-actions-surface"
    >
      <div role="toolbar" aria-label="Chart actions" className="mobile-chart-actions">
        <Action label="Draw" onClick={openDrawing}><Brush size={18} /></Action>
        <Action label="Indicators" onClick={openIndicators}><ChartNoAxesCombined size={18} /></Action>
        <Action label="Tools" onClick={openTools}><SlidersHorizontal size={18} /></Action>
        {!replayBusy && (
          <Action label="Replay" onClick={openReplay}><Play size={18} /></Action>
        )}
      </div>
    </ChartPopupSurface>
  );
}

function Action({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
      <span className="mobile-chart-action-label">{label}</span>
    </button>
  );
}
