"use client";

import { useMemo, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ChevronDown,
  EyeOff,
  Globe2,
  Lock,
  Magnet,
  Palette,
  Repeat2,
  Search,
  Star,
  Trash2,
} from "lucide-react";
import {
  activeToolAtom,
  drawColorAtom,
  drawingToolPreferencesAtom,
  keepDrawingModeAtom,
  newDrawingSyncModeAtom,
  setActiveToolAtom,
  setDrawColorAtom,
  setDrawingMagnetEnabledAtom,
  setDrawingMagnetModeAtom,
  setDrawingSnapToIndicatorsAtom,
  setKeepDrawingModeAtom,
  setNewDrawingSyncModeAtom,
} from "@/store/chartStore";
import { DrawingToolIcon } from "@/components/chart/drawing/DrawingToolIcon";
import { useChartCtx } from "@/components/chart/ChartContext";
import { useDrawingBulkActions } from "@/components/chart/drawing/bulk/useDrawingBulkActions";
import { DRAWING_SYNC_MODE_OPTIONS } from "@/components/chart/drawing/persistence/drawingSyncScope";
import { useDrawingToolFavorites } from "@/hooks/useDrawingToolFavorites";
import {
  DRAWING_TOOL_GROUPS,
  DRAWING_TOOL_MANIFEST,
  isDrawingToolCreationEnabled,
  type DrawingToolManifestEntry,
} from "@/types/drawingToolManifest";
import type { DrawingTool } from "@/types";
import { cn } from "@/utils/cn";
import { usePlatformDialog } from "@/components/ui/PlatformDialog";

const DRAWING_COLORS = [
  "#2962ff",
  "#26a69a",
  "#ef5350",
  "#ff9800",
  "#ab47bc",
  "#ffeb3b",
  "#ffffff",
  "#787b86",
] as const;

const AVAILABLE_TOOLS = DRAWING_TOOL_MANIFEST.filter(
  (entry) => entry.preferredForCreation && isDrawingToolCreationEnabled(entry.id),
);

/**
 * Touch presentation of the shared drawing manifest. No tool ids live in this
 * component, so desktop and mobile automatically expose the same catalog.
 */
export function MobileDrawingPalette({ onDone }: { onDone: () => void }) {
  const chartCtx = useChartCtx();
  const active = useAtomValue(activeToolAtom);
  const color = useAtomValue(drawColorAtom);
  const keepDrawing = useAtomValue(keepDrawingModeAtom);
  const preferences = useAtomValue(drawingToolPreferencesAtom);
  const syncMode = useAtomValue(newDrawingSyncModeAtom);
  const select = useSetAtom(setActiveToolAtom);
  const setColor = useSetAtom(setDrawColorAtom);
  const setKeepDrawing = useSetAtom(setKeepDrawingModeAtom);
  const setMagnetEnabled = useSetAtom(setDrawingMagnetEnabledAtom);
  const setMagnetMode = useSetAtom(setDrawingMagnetModeAtom);
  const setSnapToIndicators = useSetAtom(setDrawingSnapToIndicatorsAtom);
  const setSyncMode = useSetAtom(setNewDrawingSyncModeAtom);
  const bulk = useDrawingBulkActions();
  const [favorites, toggleFavorite] = useDrawingToolFavorites();
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { requestConfirm, dialog } = usePlatformDialog();

  const normalizedQuery = query.trim().toLowerCase();
  const groups = useMemo(
    () =>
      DRAWING_TOOL_GROUPS.map((group) => ({
        ...group,
        tools: AVAILABLE_TOOLS.filter(
          (entry) =>
            entry.group === group.id &&
            (!normalizedQuery ||
              entry.displayName.toLowerCase().includes(normalizedQuery) ||
              entry.section?.toLowerCase().includes(normalizedQuery)),
        ),
      })).filter((group) => group.tools.length > 0),
    [normalizedQuery],
  );
  const favoriteTools = AVAILABLE_TOOLS.filter(
    (entry) => favorites.has(entry.id) && groups.some((group) => group.tools.includes(entry)),
  );

  const chooseTool = (tool: DrawingTool) => {
    select(tool);
    onDone();
  };

  const chooseMagnet = (mode: "off" | "weak" | "strong") => {
    if (mode === "off") {
      setMagnetEnabled(false);
      return;
    }
    setMagnetMode(mode);
    setMagnetEnabled(true);
  };

  const allLocked =
    bulk.drawings.length > 0 && bulk.drawings.every((drawing) => drawing.locked);
  const allHidden =
    bulk.drawings.length > 0 &&
    bulk.drawings.every((drawing) => drawing.visible === false);

  const removeAllDrawings = () => {
    const count = bulk.drawings.length;
    if (!count) return;
    void requestConfirm({
      title: `Remove all ${count} drawings?`,
      description: "This cannot be undone from the current chart view.",
      confirmLabel: "Remove drawings",
      tone: "danger",
    }).then((accepted) => {
      if (accepted) bulk.remove({ kind: "all" });
    });
  };

  return (
    <div className="mobile-drawing-workspace" data-mobile-drawing-palette>
      <label className="mobile-workspace-search">
        <Search size={18} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search all drawing tools"
          inputMode="search"
          aria-label="Search drawing tools"
        />
      </label>

      <section className="mobile-drawing-controls" aria-labelledby="drawing-style-title">
        <div className="mobile-workspace-section-heading">
          <span><Palette size={17} aria-hidden="true" /></span>
          <div><h3 id="drawing-style-title">Creation defaults</h3><p>Shared with the desktop drawing engine</p></div>
        </div>
        <div className="mobile-color-row" role="group" aria-label="Drawing color">
          {DRAWING_COLORS.map((item) => (
            <button
              key={item}
              type="button"
              aria-label={`Drawing color ${item}`}
              aria-pressed={color.toLowerCase() === item.toLowerCase()}
              className={cn(color.toLowerCase() === item.toLowerCase() && "is-active")}
              style={{ "--drawing-swatch": item } as React.CSSProperties}
              onClick={() => setColor(item)}
            ><span /></button>
          ))}
        </div>
        <div className="mobile-control-grid">
          <ControlToggle
            icon={<Repeat2 />}
            title="Keep drawing"
            subtitle="Create consecutive objects"
            active={keepDrawing}
            onClick={() => setKeepDrawing(!keepDrawing)}
          />
          <div className="mobile-control-card">
            <div><Magnet size={18} /><span><strong>Magnet</strong><small>Snap anchors to OHLC or overlay indicators</small></span></div>
            <div className="mobile-choice-row" role="group" aria-label="Magnet mode">
              {(["off", "weak", "strong"] as const).map((mode) => {
                const selected = mode === "off"
                  ? !preferences.magnetEnabled
                  : preferences.magnetEnabled && preferences.magnetMode === mode;
                return <button key={mode} type="button" aria-pressed={selected} className={cn(selected && "is-active")} onClick={() => chooseMagnet(mode)}>{mode}</button>;
              })}
              <button
                type="button"
                aria-pressed={preferences.snapToIndicators}
                disabled={(chartCtx?.indicatorPoints?.length ?? 0) === 0}
                className={cn(preferences.snapToIndicators && "is-active")}
                onClick={() => setSnapToIndicators(!preferences.snapToIndicators)}
              >indicators</button>
            </div>
          </div>
          <div className="mobile-control-card mobile-control-card--wide">
            <div><Globe2 size={18} /><span><strong>New drawing scope</strong><small>Choose where new objects are synchronized</small></span></div>
            <div className="mobile-choice-stack" role="radiogroup" aria-label="New drawing synchronization">
              {DRAWING_SYNC_MODE_OPTIONS.map((option) => (
                <button key={option.id} type="button" role="radio" aria-checked={syncMode === option.id} className={cn(syncMode === option.id && "is-active")} onClick={() => setSyncMode(option.id)}>
                  <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  <span className="mobile-radio-dot" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {favoriteTools.length > 0 && (
        <ToolSection
          id="favorites"
          label="Favorites"
          icon={<Star size={18} fill="currentColor" />}
          tools={favoriteTools}
          active={active}
          favorites={favorites}
          onChoose={chooseTool}
          onFavorite={toggleFavorite}
        />
      )}

      {groups.map((group) => {
        const isCollapsed = !normalizedQuery && collapsed.has(group.id);
        return (
          <section className="mobile-tool-section" key={group.id}>
            <button
              type="button"
              className="mobile-tool-section-toggle"
              aria-expanded={!isCollapsed}
              onClick={() => {
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (next.has(group.id)) next.delete(group.id);
                  else next.add(group.id);
                  return next;
                });
              }}
            >
              <span><DrawingToolIcon iconKey={group.iconKey} size={18} /></span>
              <strong>{group.label}</strong>
              <small>{group.tools.length}</small>
              <ChevronDown size={18} className={cn(isCollapsed && "is-collapsed")} />
            </button>
            {!isCollapsed && (
              <div className="mobile-tool-catalog">
                {group.tools.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    active={active === tool.id}
                    favorite={favorites.has(tool.id)}
                    onChoose={() => chooseTool(tool.id)}
                    onFavorite={() => toggleFavorite(tool.id)}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}

      {groups.length === 0 && (
        <div className="mobile-empty-state"><strong>No drawing tools found</strong><span>Try another name or category.</span></div>
      )}

      <section className="mobile-drawing-bulk" aria-label="Manage all drawings">
        <button type="button" disabled={!bulk.drawings.length} aria-pressed={allLocked} onClick={() => bulk.toggleLock({ kind: "all" })}><Lock size={18} /><span>{allLocked ? "Unlock all" : "Lock all"}</span></button>
        <button type="button" disabled={!bulk.drawings.length} aria-pressed={allHidden} onClick={() => bulk.toggleVisibility({ kind: "all" })}><EyeOff size={18} /><span>{allHidden ? "Show all" : "Hide all"}</span></button>
        <button type="button" className="is-danger" disabled={!bulk.drawings.length} onClick={removeAllDrawings}><Trash2 size={18} /><span>Remove all</span></button>
      </section>
      {dialog}
    </div>
  );
}

function ToolSection({
  id,
  label,
  icon,
  tools,
  active,
  favorites,
  onChoose,
  onFavorite,
}: {
  id: string;
  label: string;
  icon: React.ReactNode;
  tools: readonly DrawingToolManifestEntry[];
  active: DrawingTool;
  favorites: ReadonlySet<DrawingTool>;
  onChoose: (tool: DrawingTool) => void;
  onFavorite: (tool: DrawingTool) => void;
}) {
  return <section className="mobile-tool-section" data-tool-section={id}>
    <div className="mobile-tool-section-label"><span>{icon}</span><strong>{label}</strong><small>{tools.length}</small></div>
    <div className="mobile-tool-catalog">{tools.map((tool) => <ToolCard key={tool.id} tool={tool} active={active === tool.id} favorite={favorites.has(tool.id)} onChoose={() => onChoose(tool.id)} onFavorite={() => onFavorite(tool.id)} />)}</div>
  </section>;
}

function ToolCard({
  tool,
  active,
  favorite,
  onChoose,
  onFavorite,
}: {
  tool: DrawingToolManifestEntry;
  active: boolean;
  favorite: boolean;
  onChoose: () => void;
  onFavorite: () => void;
}) {
  return <div className={cn("mobile-tool-card", active && "is-active")}>
    <button type="button" className="mobile-tool-select" aria-label={tool.displayName} aria-pressed={active} onClick={onChoose}>
      <span><DrawingToolIcon iconKey={tool.iconKey} size={20} /></span>
      <strong>{tool.displayName}</strong>
      {tool.section && <small>{tool.section}</small>}
    </button>
    {tool.favoriteEligible && <button type="button" className={cn("mobile-tool-favorite", favorite && "is-active")} aria-label={`${favorite ? "Remove" : "Add"} ${tool.displayName} ${favorite ? "from" : "to"} favorites`} aria-pressed={favorite} onClick={onFavorite}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button>}
  </div>;
}

function ControlToggle({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
}) {
  return <button type="button" role="switch" aria-checked={active} className={cn("mobile-control-toggle", active && "is-active")} onClick={onClick}>
    <span>{icon}</span><span><strong>{title}</strong><small>{subtitle}</small></span><span className="mobile-switch"><i /></span>
  </button>;
}
