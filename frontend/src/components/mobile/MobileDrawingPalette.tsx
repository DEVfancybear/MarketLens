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
import { ColorPickerPopover } from "@/components/ui/ColorPicker";
import { useI18n } from "@/hooks/useI18n";

const AVAILABLE_TOOLS = DRAWING_TOOL_MANIFEST.filter(
  (entry) => entry.preferredForCreation && isDrawingToolCreationEnabled(entry.id),
);

/**
 * Touch presentation of the shared drawing manifest. No tool ids live in this
 * component, so desktop and mobile automatically expose the same catalog.
 */
export function MobileDrawingPalette({ onDone }: { onDone: () => void }) {
  const {
    t,
    drawingToolName,
    drawingGroupName,
    drawingSectionName,
    drawingSyncModeText,
  } = useI18n();
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
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const { requestConfirm, dialog } = usePlatformDialog();

  const normalizedQuery = query.trim().toLowerCase();
  const localizedTools = useMemo(
    () =>
      AVAILABLE_TOOLS.map((entry) => ({
        ...entry,
        displayName: drawingToolName(entry.id, entry.displayName),
        section: drawingSectionName(entry.section),
      })),
    [drawingSectionName, drawingToolName],
  );
  const groups = useMemo(
    () =>
      DRAWING_TOOL_GROUPS.map((group) => ({
        ...group,
        label: drawingGroupName(group.id, group.label),
        tools: localizedTools.filter(
          (entry) =>
            entry.group === group.id &&
            (!normalizedQuery ||
              entry.displayName.toLowerCase().includes(normalizedQuery) ||
              AVAILABLE_TOOLS.find((source) => source.id === entry.id)
                ?.displayName.toLowerCase().includes(normalizedQuery) ||
              entry.section?.toLowerCase().includes(normalizedQuery)),
        ),
      })).filter((group) => group.tools.length > 0),
    [drawingGroupName, localizedTools, normalizedQuery],
  );
  const favoriteTools = localizedTools.filter(
    (entry) =>
      favorites.has(entry.id) &&
      groups.some((group) => group.tools.some((tool) => tool.id === entry.id)),
  );
  const localizedSyncOptions = DRAWING_SYNC_MODE_OPTIONS.map((option) => ({
    ...option,
    ...drawingSyncModeText(option.id, option),
  }));

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
      title: t("drawing.removeConfirm", { count }),
      description: t("drawing.removeWarning"),
      confirmLabel: t("drawing.removeDrawings"),
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
          placeholder={t("drawing.search")}
          inputMode="search"
          aria-label={t("drawing.searchAria")}
        />
      </label>

      <section className="mobile-drawing-controls" aria-labelledby="drawing-style-title">
        <div className="mobile-workspace-section-heading">
          <span><Palette size={17} aria-hidden="true" /></span>
          <div><h3 id="drawing-style-title">{t("drawing.creationDefaults")}</h3><p>{t("drawing.sharedEngine")}</p></div>
        </div>
        <div className="relative mb-3">
          <button
            type="button"
            aria-label={t("drawing.color")}
            aria-expanded={colorPickerOpen}
            onClick={() => setColorPickerOpen((current) => !current)}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl border border-terminal-border-strong bg-terminal-panel-2 px-3 text-left text-sm font-semibold text-ink transition-colors active:bg-terminal-pressed focus-ring"
          >
            <span
              className="h-6 w-6 shrink-0 rounded-md border border-terminal-border-strong"
              style={{ backgroundColor: color }}
            />
            <span className="min-w-0 flex-1">
              {t("drawing.color")}
              <small className="ml-2 font-mono text-[11px] font-medium uppercase text-ink-faint">
                {color}
              </small>
            </span>
            <ChevronDown
              size={17}
              className={cn(
                "text-ink-faint transition-transform",
                colorPickerOpen && "rotate-180",
              )}
            />
          </button>
          {colorPickerOpen && (
            <ColorPickerPopover
              value={color}
              onChange={setColor}
              onClose={() => setColorPickerOpen(false)}
            />
          )}
        </div>
        <div className="mobile-control-grid">
          <ControlToggle
            icon={<Repeat2 />}
            title={t("drawing.keepDrawing")}
            subtitle={t("drawing.keepDrawingHelp")}
            active={keepDrawing}
            onClick={() => setKeepDrawing(!keepDrawing)}
          />
          <div className="mobile-control-card">
            <div><Magnet size={18} /><span><strong>{t("drawing.magnet")}</strong><small>{t("drawing.magnetHelp")}</small></span></div>
            <div className="mobile-choice-row" role="group" aria-label={t("drawing.magnetMode")}>
              {(["off", "weak", "strong"] as const).map((mode) => {
                const selected = mode === "off"
                  ? !preferences.magnetEnabled
                  : preferences.magnetEnabled && preferences.magnetMode === mode;
                return <button key={mode} type="button" aria-pressed={selected} className={cn(selected && "is-active")} onClick={() => chooseMagnet(mode)}>{t(`drawing.magnet.${mode}`)}</button>;
              })}
              <button
                type="button"
                aria-pressed={preferences.snapToIndicators}
                disabled={(chartCtx?.indicatorPoints?.length ?? 0) === 0}
                className={cn(preferences.snapToIndicators && "is-active")}
                onClick={() => setSnapToIndicators(!preferences.snapToIndicators)}
              >{t("drawing.indicators")}</button>
            </div>
          </div>
          <div className="mobile-control-card mobile-control-card--wide">
            <div><Globe2 size={18} /><span><strong>{t("drawing.newScope")}</strong><small>{t("drawing.newScopeHelp")}</small></span></div>
            <div className="mobile-choice-stack" role="radiogroup" aria-label={t("drawing.newSync")}>
              {localizedSyncOptions.map((option) => (
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
          label={t("drawing.favorites")}
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
        <div className="mobile-empty-state"><strong>{t("drawing.noResults")}</strong><span>{t("drawing.tryAnother")}</span></div>
      )}

      <section className="mobile-drawing-bulk" aria-label={t("drawing.manageAll")}>
        <button type="button" disabled={!bulk.drawings.length} aria-pressed={allLocked} onClick={() => bulk.toggleLock({ kind: "all" })}><Lock size={18} /><span>{allLocked ? t("drawing.unlockAll") : t("drawing.lockAll")}</span></button>
        <button type="button" disabled={!bulk.drawings.length} aria-pressed={allHidden} onClick={() => bulk.toggleVisibility({ kind: "all" })}><EyeOff size={18} /><span>{allHidden ? t("drawing.showAll") : t("drawing.hideAll")}</span></button>
        <button type="button" className="is-danger" disabled={!bulk.drawings.length} onClick={removeAllDrawings}><Trash2 size={18} /><span>{t("drawing.removeAll")}</span></button>
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
  const { t } = useI18n();
  return <div className={cn("mobile-tool-card", active && "is-active")}>
    <button type="button" className="mobile-tool-select" aria-label={tool.displayName} aria-pressed={active} onClick={onChoose}>
      <span><DrawingToolIcon iconKey={tool.iconKey} size={20} /></span>
      <strong>{tool.displayName}</strong>
      {tool.section && <small>{tool.section}</small>}
    </button>
    {tool.favoriteEligible && <button type="button" className={cn("mobile-tool-favorite", favorite && "is-active")} aria-label={favorite ? t("drawing.removeFavorite", { tool: tool.displayName }) : t("drawing.addFavorite", { tool: tool.displayName })} aria-pressed={favorite} onClick={onFavorite}><Star size={16} fill={favorite ? "currentColor" : "none"} /></button>}
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
