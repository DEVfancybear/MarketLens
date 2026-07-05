'use client';
import { ReplayControls } from './ReplayControls';
import { ReplayDashboard } from './ReplayDashboard';

/** Bottom-dock replay tab: transport controls + live replay dashboard. */
export function ReplayPanel() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-terminal-border px-3 py-2">
        <ReplayControls />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <ReplayDashboard />
      </div>
    </div>
  );
}
