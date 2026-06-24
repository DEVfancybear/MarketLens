'use client';
import {
  Camera, Maximize2, Minimize2, Moon, Sun, PlayCircle, Layout as LayoutIcon, PanelRightClose, PanelRightOpen,
} from 'lucide-react';
import { SymbolSearch } from './SymbolSearch';
import { IndicatorMenu } from './IndicatorMenu';
import { SmcMenu } from './SmcMenu';
import { ChartSettingsMenu } from './ChartSettingsMenu';
import { IconButton } from '@/components/ui/IconButton';
import { Dropdown, MenuItem } from '@/components/ui/Dropdown';
import { useChartStore } from '@/store/chartStore';
import { useReplayStore } from '@/store/replayStore';
import { useUIStore } from '@/store/uiStore';
import { TIMEFRAMES, type Timeframe } from '@/types';
import { cn } from '@/utils/cn';
import { captureChart } from '@/components/chart/chartRegistry';

export function TopToolbar() {
  const { timeframe, setTimeframe, candles } = useChartStore();
  const replay = useReplayStore();
  const ui = useUIStore();

  const toggleReplay = () => {
    if (replay.active) {
      replay.disarm();
    } else if (replay.selecting) {
      replay.cancelSelect();
    } else {
      if (candles.length < 50) return;
      // Enter TradingView-style bar selection: click a candle to start.
      replay.beginSelect();
      ui.setBottomTab('replay');
    }
  };

  const screenshot = async () => {
    const blob = await captureChart();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${useChartStore.getState().symbol}_${timeframe}_${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
    ui.log('info', 'Screenshot saved');
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      ui.setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      ui.setFullscreen(false);
    }
  };

  return (
    <div className="flex h-full items-center gap-1 px-2">
      <SymbolSearch />

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      {/* Timeframes — TradingView segmented control */}
      <div className="flex items-center gap-0.5">
        {TIMEFRAMES.map((tf: Timeframe) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={cn(
              'h-7 min-w-[28px] rounded px-1.5 text-2xs font-medium transition-colors',
              tf === timeframe
                ? 'bg-terminal-hover font-semibold text-ink'
                : 'text-ink-muted hover:bg-terminal-hover hover:text-ink',
            )}
          >
            {tf}
          </button>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-terminal-border" />

      <IndicatorMenu />
      <SmcMenu />
      <ChartSettingsMenu />

      <button
        onClick={toggleReplay}
        className={cn(
          'flex h-7 items-center gap-1.5 rounded px-2 text-xs transition-colors',
          replay.active || replay.selecting
            ? 'bg-brand/15 text-brand'
            : 'text-ink-muted hover:bg-terminal-hover hover:text-ink',
        )}
      >
        <PlayCircle size={14} />
        {replay.selecting ? 'Select bar…' : 'Replay'}
      </button>

      {/* Layout selector (visual presets) */}
      <Dropdown
        width={160}
        trigger={() => (
          <button className="flex h-7 items-center gap-1.5 rounded px-2 text-xs text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink">
            <LayoutIcon size={14} />
            Layout
          </button>
        )}
      >
        {(close) => (
          <div>
            {['Single', '2 Horizontal', '2 Vertical', 'Grid 2×2'].map((l) => (
              <MenuItem key={l} onClick={close}>
                {l}
              </MenuItem>
            ))}
          </div>
        )}
      </Dropdown>

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton label="Screenshot" onClick={screenshot}>
          <Camera size={15} />
        </IconButton>
        <IconButton label="Toggle watchlist" onClick={ui.toggleRight} active={ui.rightOpen}>
          {ui.rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
        </IconButton>
        <IconButton label="Theme" onClick={ui.toggleTheme}>
          {ui.theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </IconButton>
        <IconButton label="Fullscreen" onClick={toggleFullscreen}>
          {ui.fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </IconButton>
      </div>
    </div>
  );
}
