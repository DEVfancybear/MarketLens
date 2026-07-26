import type { Alert } from "../store/alertStore";
import {
  visibleChartSlots,
  type ChartLayoutPreset,
  type ChartPaneState,
} from "../store/replayLayoutStore";

export function alertOwnerChartId(
  alert: Pick<Alert, "id" | "symbol">,
  panes: readonly ChartPaneState[],
  preset: ChartLayoutPreset,
  owners: Readonly<Record<string, string>>,
): string | undefined {
  const explicitOwner = owners[alert.id]?.trim();
  if (explicitOwner) return explicitOwner;

  const visible = new Set(visibleChartSlots(preset));
  return panes.find(
    (pane) =>
      visible.has(pane.slot) &&
      pane.initialized &&
      pane.symbol === alert.symbol,
  )?.id;
}

export function selectAlertsForChart(
  alerts: readonly Alert[],
  input: {
    chartId: string;
    symbol: string;
    panes: readonly ChartPaneState[];
    preset: ChartLayoutPreset;
    owners: Readonly<Record<string, string>>;
  },
): Alert[] {
  return alerts.filter(
    (alert) =>
      alert.symbol === input.symbol &&
      alertOwnerChartId(alert, input.panes, input.preset, input.owners) ===
        input.chartId,
  );
}
