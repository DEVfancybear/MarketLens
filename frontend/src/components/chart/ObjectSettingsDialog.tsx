"use client";
/**
 * ObjectSettingsDialog — TradingView-style settings dialog for every drawing
 * EXCEPT the Long/Short position tool (that keeps its own richer
 * `PositionSettingsDialog`). Both read `editingDrawingIdAtom`; this one bails
 * out for position tools so the two never render at once.
 *
 * Layout mirrors TradingView's object dialog:
 *   • Tabs: Style · Text · Coordinates · Visibility (Text hidden for plain lines)
 *   • Style (shape): Extend · Border · Middle line · Background
 *   • Style (line):  Line color + width/style
 *   • Text: colour + font size + Bold/Italic, a text area, and alignment
 *   • Footer: Template ▼ (save/apply/delete) · Cancel · Ok
 * Edits apply live for preview; Cancel reverts to the snapshot taken on open.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bold, Italic, ChevronDown, Pencil, X } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  editingDrawingIdAtom,
  candlesAtom,
  timeframeAtom,
  drawingsAtom,
  setEditingDrawingAtom,
  updateDrawingAtom,
  drawingTemplatesAtom,
  saveTemplateAtom,
  applyTemplateAtom,
  deleteTemplateAtom,
  saveDrawingToolDefaultsAtom,
} from "@/store/chartStore";
import {
  DEFAULT_CHANNEL_LEVELS,
  DEFAULT_FIB_LEVELS,
  type ChannelLevelConfig,
  type Drawing,
  type FibAlignH,
  type FibAlignV,
  type FibLevelConfig,
  type FibTextMode,
} from "@/types";
import { useDraggableDialog } from "@/hooks/useDraggableDialog";
import { cn } from "@/utils/cn";
import { NumberField, Row, SectionTitle } from "./PositionSettingsDialog";
import { SaveDrawingTemplateDialog } from "./SaveDrawingTemplateDialog";
import { getDrawingSettingsSchema } from "./drawing/settings/drawingSettingsSchema";
import {
  drawingCommandManager,
  PreviewedPropertyChangeCommand,
} from "./drawing/history/CommandManager";
import {
  buildDrawingSettingsCommit,
  buildDrawingSettingsRevert,
} from "./drawing/settings/drawingSettingsTransaction";
import { CheckBox, ColorPopover, LineWidget, Select, Swatch } from "./drawing/settings/DrawingSettingsFields";
import { DrawingIntervalVisibilityFields } from "./drawing/settings/DrawingIntervalVisibilityFields";
import { DrawingCoordinatesFields } from "./drawing/settings/DrawingCoordinatesFields";

const FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40];
const EXTEND_OPTS: { value: NonNullable<Drawing["extend"]>; label: string }[] = [
  { value: "none", label: "Don't extend" },
  { value: "left", label: "Extend left" },
  { value: "right", label: "Extend right" },
  { value: "both", label: "Extend both" },
];
const LINE_END_OPTS: { value: NonNullable<Drawing["lineEnd"]>; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "arrow", label: "Arrow" },
];
const V_ALIGN: { value: NonNullable<Drawing["textVAlign"]>; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];
const H_ALIGN: { value: NonNullable<Drawing["textHAlign"]>; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];

const FIB_LEVEL_MODES: { value: FibTextMode; label: string }[] = [
  { value: "values", label: "Values" },
  { value: "percent", label: "Percents" },
];
const FIB_H_ALIGN: { value: FibAlignH; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "center", label: "Center" },
  { value: "right", label: "Right" },
];
const FIB_V_ALIGN: { value: FibAlignV; label: string }[] = [
  { value: "top", label: "Top" },
  { value: "middle", label: "Middle" },
  { value: "bottom", label: "Bottom" },
];

type Tab = "style" | "text" | "coordinates" | "visibility";

function normalizedFibLevels(d: Drawing): FibLevelConfig[] {
  return DEFAULT_FIB_LEVELS.map((base, i) => {
    const custom = d.fibLevels?.[i];
    return {
      ...base,
      ...(custom ?? {}),
      value: Number.isFinite(custom?.value) ? custom!.value : base.value,
      color: custom?.color || base.color,
      enabled: custom?.enabled ?? base.enabled,
    };
  });
}

function normalizedChannelLevels(d: Drawing): ChannelLevelConfig[] {
  const source = d.channelLevels?.length ? d.channelLevels : DEFAULT_CHANNEL_LEVELS;
  return source
    .filter((level) => Number.isFinite(level.value))
    .map((level) => ({ ...level, enabled: level.enabled !== false }));
}

// ---- dialog -------------------------------------------------------------

export function ObjectSettingsDialog() {
  const editingId = useAtomValue(editingDrawingIdAtom);
  const candles = useAtomValue(candlesAtom);
  const timeframe = useAtomValue(timeframeAtom);
  const drawings = useAtomValue(drawingsAtom);
  const setEditing = useSetAtom(setEditingDrawingAtom);
  const updateDrawing = useSetAtom(updateDrawingAtom);
  const templates = useAtomValue(drawingTemplatesAtom);
  const saveTemplate = useSetAtom(saveTemplateAtom);
  const applyTemplate = useSetAtom(applyTemplateAtom);
  const deleteTemplate = useSetAtom(deleteTemplateAtom);
  const saveToolDefaults = useSetAtom(saveDrawingToolDefaultsAtom);

  const [tab, setTab] = useState<Tab>("style");
  const [pop, setPop] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  // Snapshot of the object as it was when the dialog opened (for Cancel).
  const snapshot = useRef<Drawing | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  // Latest cancel handler, so the keydown effect can call it without TDZ.
  const cancelRef = useRef<() => void>(() => {});
  const templateDialogOpenRef = useRef(false);
  templateDialogOpenRef.current = templateDialogOpen;
  const { dialogRef, dialogStyle, dragHandleProps, dragHandleClassName } =
    useDraggableDialog();

  const drawing = drawings.find((d) => d.id === editingId) ?? null;
  const settings = drawing ? getDrawingSettingsSchema(drawing.tool) : null;
  const isPosition = settings?.profile === "position";

  // Capture the original style once per opened object.
  useEffect(() => {
    if (editingId && drawing && snapshot.current?.id !== editingId) {
      snapshot.current = JSON.parse(JSON.stringify(drawing));
      returnFocus.current = document.activeElement as HTMLElement | null;
    }
    if (!editingId) snapshot.current = null;
    setTab((settings?.tabs[0] ?? "style") as Tab);
    setPop(null);
    setTplOpen(false);
    setTemplateDialogOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]);

  useEffect(() => {
    if (!editingId) returnFocus.current?.focus();
  }, [editingId]);

  useEffect(() => {
    if (editingId && !isPosition) dialogRef.current?.focus();
  }, [dialogRef, editingId, isPosition]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && editingId && !templateDialogOpenRef.current) {
        cancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingId]);

  if (typeof document === "undefined" || !drawing || !settings || isPosition) return null;

  const family = settings.templateFamily;
  const isFib = settings.profile === "fib";
  const isText = settings.profile === "text";
  const isPlainText = settings.profile === "text";
  const isShape = settings.profile === "shape";
  const isRect = settings.hasFeature("middle-line");
  const isTrendline = settings.hasFeature("trendline-parity");
  const hasPriceLabel = settings.hasFeature("price-label");
  const hasTimeLabel = settings.hasFeature("time-label");
  const isChannel = settings.hasFeature("channel-levels");
  const hasTextTab = settings.tabs.includes("text");

  const patch = (p: Partial<Drawing>) =>
    updateDrawing({ id: drawing.id, patch: p });

  const cancel = () => {
    const snap = snapshot.current;
    if (snap && snap.id === drawing.id) {
      // Full revert: cover every key in either the current or the snapshot
      // object so fields ADDED during editing (e.g. bold) are cleared too —
      // a plain `{...d, ...snap}` merge would keep them (JSON drops undefined).
      updateDrawing({ id: drawing.id, patch: buildDrawingSettingsRevert(drawing, snap) });
    }
    setEditing(null);
  };
  const ok = () => {
    const snap = snapshot.current;
    if (snap && snap.id === drawing.id) {
      const change = buildDrawingSettingsCommit(drawing, snap);
      if (change) {
        drawingCommandManager.execute(new PreviewedPropertyChangeCommand(
          updateDrawing,
          drawing.id,
          change.after,
          change.before,
        ));
      }
    }
    saveToolDefaults(drawing);
    setEditing(null);
  };
  cancelRef.current = cancel;

  const fibLevels = normalizedFibLevels(drawing);
  const channelLevels = normalizedChannelLevels(drawing);
  const patchFibLevel = (idx: number, p: Partial<FibLevelConfig>) => {
    const next = normalizedFibLevels(drawing);
    if (!next[idx]) return;
    next[idx] = { ...next[idx], ...p };
    patch({ fibLevels: next });
  };
  const patchChannelLevel = (idx: number, p: Partial<ChannelLevelConfig>) => {
    const next = normalizedChannelLevels(drawing);
    if (!next[idx]) return;
    next[idx] = { ...next[idx], ...p };
    patch({ channelLevels: next });
  };

  const onSaveTemplate = () => {
    setTplOpen(false);
    setPop(null);
    setTemplateDialogOpen(true);
  };
  const familyTemplates = templates.filter((t) => t.family === family);

  if (isPlainText) {
    const textTabBtn = (id: Tab) => (
      <button
        key={id}
        role="tab"
        aria-selected={tab === id}
        onClick={() => {
          setTab(id);
          setPop(null);
        }}
        className={cn(
          "border-b-[3px] px-0 pb-[9px] text-[16px] font-semibold capitalize transition-colors",
          tab === id
            ? "border-terminal-border-strong text-ink"
            : "border-transparent text-ink-muted hover:text-ink",
        )}
      >
        {id}
      </button>
    );

    return createPortal(
      <>
        <div
          data-chart-ui
          className="platform-dialog-overlay fixed inset-0 z-[110] flex items-start justify-center bg-[var(--scrim)] backdrop-blur-sm p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) cancel();
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`${settings.title} settings`}
            tabIndex={-1}
            style={dialogStyle}
            className="platform-dialog flex max-h-[calc(100dvh-32px)] w-[min(calc(100vw-32px),400px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
            onClick={() => {
              setPop(null);
              setTplOpen(false);
            }}
          >
            <div
              data-dialog-header
              {...dragHandleProps}
              className={cn(
                "flex items-center justify-between px-5 pb-2 pt-4",
                dragHandleClassName,
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[20px] font-semibold leading-7 text-ink">
                  Text
                </span>
                <Pencil size={16} className="text-ink-muted" />
              </div>
              <button
                onClick={cancel}
                aria-label="Close settings"
                className="rounded-sm p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
              >
                <X size={24} strokeWidth={1.5} />
              </button>
            </div>

            <div data-dialog-tabs role="tablist" aria-label="Drawing settings sections" className="mx-5 flex items-center gap-6 border-b border-terminal-border pt-3">
              {(settings.tabs as readonly Tab[]).map(textTabBtn)}
            </div>

            <div data-dialog-body className="min-h-[420px] flex-1 overflow-y-auto px-5 py-5">
              {tab === "text" && (
                <>
                  <div className="mb-4 flex items-center gap-2">
                    <div className="relative">
                      <Swatch
                        color={drawing.textColor ?? drawing.color}
                        onClick={() =>
                          setPop(pop === "text-c" ? null : "text-c")
                        }
                      />
                      {pop === "text-c" && (
                        <ColorPopover
                          value={drawing.textColor ?? drawing.color}
                          onPick={(c) =>
                            c && patch({ textColor: c, color: c })
                          }
                          onClose={() => setPop(null)}
                        />
                      )}
                    </div>
                    <Select
                      value={drawing.fontSize ?? 16}
                      options={FONT_SIZES.map((s) => ({
                        value: s,
                        label: String(s),
                      }))}
                      onChange={(v) => patch({ fontSize: v })}
                    />
                    <button
                      onClick={() => patch({ bold: !drawing.bold })}
                      className={cn(
                        "flex h-[34px] w-[34px] items-center justify-center rounded-md border text-[15px] font-semibold transition-colors",
                        drawing.bold
                          ? "border-terminal-border-strong bg-terminal-hover text-ink"
                          : "border-terminal-border-strong text-ink hover:border-brand",
                      )}
                    >
                      B
                    </button>
                    <button
                      onClick={() => patch({ italic: !drawing.italic })}
                      className={cn(
                        "flex h-[34px] w-[34px] items-center justify-center rounded-md border font-serif text-[16px] italic transition-colors",
                        drawing.italic
                          ? "border-terminal-border-strong bg-terminal-hover text-ink"
                          : "border-terminal-border-strong text-ink hover:border-brand",
                      )}
                    >
                      I
                    </button>
                  </div>

                  <textarea
                    value={drawing.text ?? ""}
                    onChange={(e) => patch({ text: e.target.value })}
                    rows={8}
                    className="mb-4 h-[176px] w-full resize-none rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/15"
                  />

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <CheckBox
                        checked={!!drawing.textBackground}
                        onChange={(v) => patch({ textBackground: v })}
                      />
                      <span className="min-w-[82px] text-[14px] font-medium text-ink-muted">
                        Background
                      </span>
                      <div
                        className={cn(
                          "relative",
                          !drawing.textBackground && "opacity-45",
                        )}
                      >
                        <Swatch
                          color={
                            drawing.textBackgroundColor ??
                            "rgba(54,58,69,0.85)"
                          }
                          onClick={() =>
                            setPop(pop === "text-bg" ? null : "text-bg")
                          }
                        />
                        {pop === "text-bg" && (
                          <ColorPopover
                            value={
                              drawing.textBackgroundColor ?? "#363a45"
                            }
                            onPick={(c) =>
                              c &&
                              patch({
                                textBackground: true,
                                textBackgroundColor: c,
                              })
                            }
                            onClose={() => setPop(null)}
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <CheckBox
                        checked={!!drawing.textBorder}
                        onChange={(v) => patch({ textBorder: v })}
                      />
                      <span className="min-w-[82px] text-[14px] font-medium text-ink-muted">
                        Border
                      </span>
                      <div
                        className={cn(
                          "relative",
                          !drawing.textBorder && "opacity-45",
                        )}
                      >
                        <Swatch
                          color={drawing.textBorderColor ?? "#a64650"}
                          onClick={() =>
                            setPop(pop === "text-border" ? null : "text-border")
                          }
                        />
                        {pop === "text-border" && (
                          <ColorPopover
                            value={drawing.textBorderColor ?? "#a64650"}
                            onPick={(c) =>
                              c &&
                              patch({
                                textBorder: true,
                                textBorderColor: c,
                              })
                            }
                            onClose={() => setPop(null)}
                          />
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <CheckBox
                        checked={!!drawing.textWrap}
                        onChange={(v) => patch({ textWrap: v })}
                      />
                      <span className="text-[14px] font-medium text-ink-muted">
                        Text wrap
                      </span>
                    </div>
                  </div>
                </>
              )}

              {tab === "coordinates" && (
                <DrawingCoordinatesFields
                  points={drawing.points}
                  candles={candles}
                  labels={settings.coordinateLabels}
                  onChange={(points) => patch({ points })}
                />
              )}

              {tab === "visibility" && (
                <>
                  <Row label="On chart">
                    <button
                      onClick={() => patch({ visible: drawing.visible === false })}
                      className={cn(
                        "rounded border px-2.5 py-1 text-xs transition-colors",
                        drawing.visible !== false
                          ? "border-terminal-border-strong bg-brand text-[var(--accent-contrast)]"
                          : "border-terminal-border-strong text-ink-muted hover:bg-terminal-hover hover:text-ink",
                      )}
                    >
                      {drawing.visible !== false ? "Shown" : "Hidden"}
                    </button>
                  </Row>
                  <DrawingIntervalVisibilityFields
                    value={drawing.intervalVisibility}
                    currentTimeframe={timeframe}
                    onChange={(intervalVisibility) => patch({ intervalVisibility })}
                  />
                </>
              )}
            </div>

            <div data-dialog-footer className="flex h-[58px] shrink-0 items-center justify-between border-t border-terminal-border px-5">
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTplOpen((o) => !o);
                    setPop(null);
                  }}
                  className="flex h-[34px] min-w-[104px] items-center justify-between rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[13px] font-medium text-ink hover:border-brand"
                >
                  Template
                  <ChevronDown size={15} className="text-ink-faint" />
                </button>
                {tplOpen && (
                  <div
                    className="mobile-popover absolute bottom-full left-0 z-30 mb-1 w-[180px] rounded-md border border-terminal-border-strong bg-terminal-panel-2 p-1 shadow-floating"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={onSaveTemplate}
                      className="w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                    >
                      Save as template...
                    </button>
                    {familyTemplates.length > 0 && (
                      <div className="my-1 h-px bg-terminal-border" />
                    )}
                    {familyTemplates.map((t) => (
                      <div
                        key={t.name}
                        className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-ink hover:bg-terminal-hover"
                      >
                        <button
                          onClick={() => {
                            applyTemplate({ id: drawing.id, template: t });
                            setTplOpen(false);
                          }}
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-terminal-border-strong"
                            style={{ background: t.color }}
                          />
                          <span className="truncate">{t.name}</span>
                        </button>
                        <button
                          title="Delete template"
                          onClick={() =>
                            deleteTemplate({
                              name: t.name,
                              family: t.family,
                            })
                          }
                          className="rounded px-1 text-ink-faint opacity-0 hover:text-bear group-hover:opacity-100"
                        >
                          x
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={cancel}
                  className="h-[34px] rounded-[5px] border border-terminal-border-strong bg-transparent px-3.5 text-[14px] font-semibold text-ink hover:bg-terminal-hover"
                >
                  Cancel
                </button>
                <button
                  onClick={ok}
                  className="h-[34px] rounded-[5px] border border-terminal-border-strong bg-brand px-4 text-[14px] font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover"
                >
                  Ok
                </button>
              </div>
            </div>
          </div>
        </div>
        <SaveDrawingTemplateDialog
          open={templateDialogOpen}
          templates={familyTemplates}
          onCloseAction={() => setTemplateDialogOpen(false)}
          onSaveAction={(name) => saveTemplate({ id: drawing.id, name })}
        />
      </>,
      document.body,
    );
  }

  const tabs = settings.tabs as readonly Tab[];

  const tabBtn = (id: Tab) => (
    <button
      key={id}
      role="tab"
      aria-selected={tab === id}
      onClick={() => {
        setTab(id);
        setPop(null);
      }}
      className={cn(
        isFib
          ? "border-b-[3px] px-0 pb-[9px] text-[16px] font-semibold capitalize transition-colors"
          : "border-b-[3px] px-0 pb-[9px] text-[16px] font-semibold capitalize transition-colors",
        tab === id
          ? isFib
            ? "border-terminal-border-strong text-ink"
            : "border-terminal-border-strong text-ink"
          : isFib
            ? "border-transparent text-ink-muted hover:text-ink"
            : "border-transparent text-ink-muted hover:text-ink",
      )}
    >
      {id}
    </button>
  );

  return createPortal(
    <>
      <div
      data-chart-ui
      className="platform-dialog-overlay fixed inset-0 z-[110] flex items-start justify-center bg-[var(--scrim)] backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${settings.title} settings`}
        tabIndex={-1}
        style={dialogStyle}
        className={cn(
          isFib
            ? "platform-dialog flex max-h-[calc(100dvh-32px)] w-[min(calc(100vw-32px),480px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating"
            : "platform-dialog flex max-h-[calc(100dvh-32px)] w-[min(calc(100vw-32px),400px)] flex-col overflow-hidden rounded-2xl border border-terminal-border-strong bg-terminal-raised shadow-floating",
        )}
        onClick={() => {
          setPop(null);
          setTplOpen(false);
        }}
      >
        {isFib && (
          <div
            data-dialog-header
            {...dragHandleProps}
            className={cn(
              "flex items-center justify-between px-5 pb-2 pt-4",
              dragHandleClassName,
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[20px] font-semibold leading-7 text-ink">
                {settings.title}
              </span>
              <Pencil size={16} className="text-ink-muted" />
            </div>
            <button
              onClick={cancel}
              aria-label="Close settings"
              className="rounded-sm p-1 text-ink-muted hover:bg-terminal-hover hover:text-ink"
            >
              <X size={24} strokeWidth={1.5} />
            </button>
          </div>
        )}
        {/* Tabs */}
        <div
          data-dialog-tabs
          role="tablist"
          aria-label="Drawing settings sections"
          {...(!isFib ? dragHandleProps : {})}
          className={cn(
            isFib
              ? "mx-5 flex items-center gap-6 border-b border-terminal-border pt-3"
              : "mx-5 flex items-center gap-6 border-b border-terminal-border pt-3",
            !isFib && dragHandleClassName,
          )}
        >
          {tabs.map(tabBtn)}
        </div>

        <div
          data-dialog-body
          className={cn(
            isFib
              ? "min-h-0 flex-1 overflow-y-auto px-5 py-4"
              : "min-h-[180px] flex-1 overflow-y-auto px-5 py-5",
          )}
        >
          {/* -------------------------------------------------- STYLE */}
          {tab === "style" && (
            <>
              {isFib && (
                <>
                  <div className="space-y-1">
                    <div className="flex items-center gap-3 py-[7px]">
                      <CheckBox
                        checked={drawing.fibTrendLine !== false}
                        onChange={(v) => patch({ fibTrendLine: v })}
                      />
                      <span className="w-[88px] shrink-0 text-[14px] font-medium text-ink-muted">
                        Trend line
                      </span>
                      <div className="relative">
                        <Swatch
                          color={drawing.fibTrendLineColor ?? drawing.color}
                          onClick={() =>
                            setPop(pop === "fib-trend-color" ? null : "fib-trend-color")
                          }
                        />
                        {pop === "fib-trend-color" && (
                          <ColorPopover
                            value={drawing.fibTrendLineColor ?? drawing.color}
                            onPick={(c) => c && patch({ fibTrendLineColor: c })}
                            onClose={() => setPop(null)}
                          />
                        )}
                      </div>
                      <LineWidget
                        color={drawing.fibTrendLineColor ?? drawing.color}
                        width={drawing.fibTrendLineWidth ?? drawing.lineWidth ?? 1}
                        style={drawing.fibTrendLineStyle ?? "dashed"}
                        open={pop === "fib-trend-line"}
                        onToggle={() =>
                          setPop(pop === "fib-trend-line" ? null : "fib-trend-line")
                        }
                        onWidth={(w) => patch({ fibTrendLineWidth: w })}
                        onStyle={(s) => patch({ fibTrendLineStyle: s })}
                        onClose={() => setPop(null)}
                      />
                    </div>
                    <Row label="Levels line">
                      <LineWidget
                        color={drawing.fibLevelLineColor ?? drawing.color}
                        width={drawing.fibLevelLineWidth ?? drawing.lineWidth ?? 1}
                        style={drawing.fibLevelLineStyle ?? drawing.lineStyle ?? "solid"}
                        open={pop === "fib-level-line"}
                        onToggle={() =>
                          setPop(pop === "fib-level-line" ? null : "fib-level-line")
                        }
                        onWidth={(w) => patch({ fibLevelLineWidth: w })}
                        onStyle={(s) => patch({ fibLevelLineStyle: s })}
                        onClose={() => setPop(null)}
                      />
                    </Row>
                    <Row label="Extend">
                      <Select
                        value={drawing.extend ?? "none"}
                        options={EXTEND_OPTS}
                        onChange={(v) => patch({ extend: v })}
                      />
                    </Row>

                    <div className="grid grid-cols-1 gap-y-2 py-2">
                      {fibLevels.map((level, index) => (
                        <div key={`${index}-${level.value}`} className="flex items-center gap-2">
                          <CheckBox
                            checked={level.enabled}
                            onChange={(v) => patchFibLevel(index, { enabled: v })}
                          />
                          <NumberField
                            value={Number(level.value)}
                            onCommit={(v) => patchFibLevel(index, { value: v })}
                            className={cn(
                              "h-[34px] w-[98px]",
                              !level.enabled && "opacity-45",
                            )}
                          />
                          <div className="relative">
                            <Swatch
                              color={level.color}
                              onClick={() =>
                                setPop(pop === `fib-level-${index}` ? null : `fib-level-${index}`)
                              }
                            />
                            {pop === `fib-level-${index}` && (
                              <ColorPopover
                                value={level.color}
                                onPick={(c) => c && patchFibLevel(index, { color: c })}
                                onClose={() => setPop(null)}
                              />
                            )}
                          </div>
                          <input
                            aria-label={`Fib level ${index + 1} text`}
                            value={level.text ?? ""}
                            onChange={(event) => patchFibLevel(index, { text: event.target.value })}
                            placeholder="Level text"
                            className="h-[34px] min-w-0 flex-1 rounded-[5px] border border-terminal-border-strong bg-terminal-raised px-2.5 text-[13px] text-ink-muted outline-none focus:border-brand"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 h-px bg-terminal-border" />

                    <Row label="Use one color">
                      <CheckBox
                        checked={!!drawing.fibUseOneColor}
                        onChange={(v) => patch({ fibUseOneColor: v })}
                      />
                      <div className="relative">
                        <Swatch
                          color={drawing.fibLevelLineColor ?? drawing.color}
                          onClick={() =>
                            setPop(pop === "fib-one-color" ? null : "fib-one-color")
                          }
                        />
                        {pop === "fib-one-color" && (
                          <ColorPopover
                            value={drawing.fibLevelLineColor ?? drawing.color}
                            onPick={(c) =>
                              c && patch({ fibUseOneColor: true, fibLevelLineColor: c })
                            }
                            onClose={() => setPop(null)}
                          />
                        )}
                      </div>
                    </Row>
                    <div className="flex items-center gap-3 py-[7px]">
                      <CheckBox
                        checked={drawing.fibBackground !== false}
                        onChange={(v) => patch({ fibBackground: v })}
                      />
                      <span className="w-[88px] shrink-0 text-[14px] font-medium text-ink-muted">
                        Background
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((drawing.opacity ?? 0.12) * 100)}
                        onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
                        className="w-[150px] accent-brand"
                      />
                    </div>
                    <Row label="Reverse">
                      <CheckBox
                        checked={!!drawing.fibReverse}
                        onChange={(v) => patch({ fibReverse: v })}
                      />
                    </Row>
                    <Row label="Prices">
                      <CheckBox
                        checked={drawing.fibShowPrices !== false}
                        onChange={(v) => patch({ fibShowPrices: v })}
                      />
                    </Row>
                    <Row label="Levels">
                      <CheckBox
                        checked={drawing.fibShowLevels !== false}
                        onChange={(v) => patch({ fibShowLevels: v })}
                      />
                      <Select
                        value={drawing.fibLevelsFormat ?? "values"}
                        options={FIB_LEVEL_MODES}
                        onChange={(v) => patch({ fibLevelsFormat: v })}
                      />
                    </Row>
                    <Row label="Labels">
                      <Select
                        value={drawing.fibLabelsHAlign ?? "left"}
                        options={FIB_H_ALIGN}
                        onChange={(v) => patch({ fibLabelsHAlign: v })}
                      />
                      <Select
                        value={drawing.fibLabelsVAlign ?? "middle"}
                        options={FIB_V_ALIGN}
                        onChange={(v) => patch({ fibLabelsVAlign: v })}
                      />
                    </Row>
                    <Row label="Text">
                      <CheckBox
                        checked={drawing.fibShowText !== false}
                        onChange={(v) => patch({ fibShowText: v })}
                      />
                      <Select
                        value={drawing.fibTextHAlign ?? "center"}
                        options={FIB_H_ALIGN}
                        onChange={(v) => patch({ fibTextHAlign: v })}
                      />
                      <Select
                        value={drawing.fibTextVAlign ?? "middle"}
                        options={FIB_V_ALIGN}
                        onChange={(v) => patch({ fibTextVAlign: v })}
                      />
                    </Row>
                    <Row label="Font size">
                      <Select
                        value={drawing.fontSize ?? 12}
                        options={FONT_SIZES.map((s) => ({ value: s, label: String(s) }))}
                        onChange={(v) => patch({ fontSize: v })}
                      />
                    </Row>
                    <Row label="Fib levels based on log scale">
                      <CheckBox
                        checked={!!drawing.fibLogScale}
                        onChange={(v) => patch({ fibLogScale: v })}
                      />
                    </Row>
                  </div>
                </>
              )}

              {!isFib && isShape && (
                <>
                  {isRect && (
                    <Row label="Extend">
                      <Select
                        value={drawing.extend ?? "none"}
                        options={EXTEND_OPTS}
                        onChange={(v) => patch({ extend: v })}
                      />
                    </Row>
                  )}
                  <Row label="Border">
                    <div className="relative flex items-center gap-2">
                      <Swatch
                        color={drawing.color}
                        onClick={() =>
                          setPop(pop === "border-c" ? null : "border-c")
                        }
                      />
                      {pop === "border-c" && (
                        <ColorPopover
                          value={drawing.color}
                          onPick={(c) => c && patch({ color: c })}
                          onClose={() => setPop(null)}
                        />
                      )}
                      <LineWidget
                        color={drawing.color}
                        width={drawing.lineWidth ?? 2}
                        style={drawing.lineStyle ?? "solid"}
                        open={pop === "border-l"}
                        onToggle={() =>
                          setPop(pop === "border-l" ? null : "border-l")
                        }
                        onWidth={(w) => patch({ lineWidth: w })}
                        onStyle={(s) => patch({ lineStyle: s })}
                        onClose={() => setPop(null)}
                      />
                    </div>
                  </Row>
                  {isRect && (
                    <Row label="Middle line">
                      <CheckBox
                        checked={!!drawing.showMiddleLine}
                        onChange={(v) => patch({ showMiddleLine: v })}
                      />
                      <div className="relative flex items-center gap-2">
                        <Swatch
                          color={drawing.middleLineColor ?? drawing.color}
                          onClick={() =>
                            setPop(pop === "mid-c" ? null : "mid-c")
                          }
                        />
                        {pop === "mid-c" && (
                          <ColorPopover
                            value={drawing.middleLineColor ?? drawing.color}
                            onPick={(c) => c && patch({ middleLineColor: c })}
                            onClose={() => setPop(null)}
                          />
                        )}
                        <LineWidget
                          color={drawing.middleLineColor ?? drawing.color}
                          width={drawing.lineWidth ?? 2}
                          style={drawing.middleLineStyle ?? "dashed"}
                          open={pop === "mid-l"}
                          onToggle={() =>
                            setPop(pop === "mid-l" ? null : "mid-l")
                          }
                          onWidth={(w) => patch({ lineWidth: w })}
                          onStyle={(s) => patch({ middleLineStyle: s })}
                          onClose={() => setPop(null)}
                        />
                      </div>
                    </Row>
                  )}
                  <Row label="Background">
                    <CheckBox
                      checked={!!drawing.fillColor && drawing.fillColor !== "none"}
                      onChange={(v) =>
                        patch({ fillColor: v ? drawing.fillColor ?? drawing.color : undefined })
                      }
                    />
                    <div className="relative flex items-center gap-2">
                      <Swatch
                        color={drawing.fillColor ?? drawing.color}
                        opacity={drawing.opacity ?? 0.3}
                        onClick={() => setPop(pop === "bg-c" ? null : "bg-c")}
                      />
                      {pop === "bg-c" && (
                        <ColorPopover
                          value={drawing.fillColor ?? drawing.color}
                          opacity={drawing.opacity ?? 0.3}
                          onPick={(c) => patch({ fillColor: c ?? undefined })}
                          onOpacity={(o) => patch({ opacity: o })}
                          allowNone
                          onClose={() => setPop(null)}
                        />
                      )}
                    </div>
                  </Row>
                </>
              )}

              {!isFib && !isShape && !isText && (
                <>
                <Row label="Line">
                  <div className="relative flex items-center gap-2">
                    <Swatch
                      color={drawing.color}
                      onClick={() =>
                        setPop(pop === "border-c" ? null : "border-c")
                      }
                    />
                    {pop === "border-c" && (
                      <ColorPopover
                        value={drawing.color}
                        onPick={(c) => c && patch({ color: c })}
                        onClose={() => setPop(null)}
                      />
                    )}
                    <LineWidget
                      color={drawing.color}
                      width={drawing.lineWidth ?? 2}
                      style={drawing.lineStyle ?? "solid"}
                      open={pop === "border-l"}
                      onToggle={() =>
                        setPop(pop === "border-l" ? null : "border-l")
                      }
                      onWidth={(w) => patch({ lineWidth: w })}
                      onStyle={(s) => patch({ lineStyle: s })}
                      onClose={() => setPop(null)}
                    />
                  </div>
                </Row>
                {isTrendline && (
                  <div className="mt-4 space-y-3 border-t border-terminal-border pt-4">
                    <Row label="Start"><Select value={drawing.lineStart ?? "normal"} options={LINE_END_OPTS} onChange={(lineStart) => patch({ lineStart })} /></Row>
                    <Row label="End"><Select value={drawing.lineEnd ?? "normal"} options={LINE_END_OPTS} onChange={(lineEnd) => patch({ lineEnd })} /></Row>
                    <Row label="Midpoint"><CheckBox checked={drawing.showMidpoint !== false} onChange={(showMidpoint) => patch({ showMidpoint })} /></Row>
                    <Row label="Price labels"><CheckBox checked={!!drawing.showPriceLabels} onChange={(showPriceLabels) => patch({ showPriceLabels })} /></Row>
                    <Row label="Stats"><CheckBox checked={!!drawing.showStats} onChange={(showStats) => patch({ showStats })} /></Row>
                  </div>
                )}
                {(hasPriceLabel || hasTimeLabel) && (
                  <div className="mt-4 space-y-3 border-t border-terminal-border pt-4">
                    {hasPriceLabel && (
                      <Row label="Price label"><CheckBox checked={drawing.showPriceLabels !== false} onChange={(showPriceLabels) => patch({ showPriceLabels })} /></Row>
                    )}
                    {hasTimeLabel && (
                      <Row label="Time label"><CheckBox checked={drawing.showTimeLabel !== false} onChange={(showTimeLabel) => patch({ showTimeLabel })} /></Row>
                    )}
                  </div>
                )}
                {isChannel && (
                  <div className="mt-4 space-y-3 border-t border-terminal-border pt-4">
                    <Row label="Extend"><Select value={drawing.extend ?? "none"} options={EXTEND_OPTS} onChange={(extend) => patch({ extend })} /></Row>
                    <Row label="Background"><CheckBox checked={drawing.channelBackground !== false} onChange={(channelBackground) => patch({ channelBackground })} /></Row>
                    <SectionTitle>Levels</SectionTitle>
                    {channelLevels.map((level, index) => (
                      <div key={`${index}-${level.value}`} className="flex items-center gap-2">
                        <CheckBox checked={level.enabled} onChange={(enabled) => patchChannelLevel(index, { enabled })} />
                        <NumberField value={level.value} onCommit={(value) => patchChannelLevel(index, { value })} className="h-[34px] flex-1" />
                        <button aria-label={`Remove channel level ${index + 1}`} onClick={() => patch({ channelLevels: channelLevels.filter((_, itemIndex) => itemIndex !== index) })} className="rounded px-2 py-1 text-xs text-ink-faint hover:bg-terminal-hover hover:text-bear">Remove</button>
                      </div>
                    ))}
                    <button onClick={() => patch({ channelLevels: [...channelLevels, { value: 0.25, enabled: true }] })} className="rounded border border-terminal-border-strong px-2.5 py-1.5 text-xs text-ink-muted hover:bg-terminal-hover">Add level</button>
                  </div>
                )}
                </>
              )}

              {!isFib && isText && (
                <p className="py-6 text-center text-xs text-ink-faint">
                  Edit text and font on the <b className="text-ink">Text</b> tab.
                </p>
              )}
            </>
          )}

          {/* --------------------------------------------------- TEXT */}
          {tab === "text" && hasTextTab && (
            <>
              <div className="mb-3 flex items-center gap-2">
                <div className="relative">
                  <Swatch
                    color={drawing.textColor ?? drawing.color}
                    onClick={() => setPop(pop === "text-c" ? null : "text-c")}
                  />
                  {pop === "text-c" && (
                    <ColorPopover
                      value={drawing.textColor ?? drawing.color}
                      onPick={(c) => c && patch({ textColor: c })}
                      onClose={() => setPop(null)}
                    />
                  )}
                </div>
                <Select
                  value={drawing.fontSize ?? (isShape ? 14 : 13)}
                  options={FONT_SIZES.map((s) => ({ value: s, label: String(s) }))}
                  onChange={(v) => patch({ fontSize: v })}
                />
                <button
                  onClick={() => patch({ bold: !drawing.bold })}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded border transition-colors",
                    drawing.bold
                      ? "border-terminal-border-strong bg-terminal-hover text-ink"
                      : "border-terminal-border-strong text-ink hover:border-brand hover:bg-terminal-hover",
                  )}
                >
                  <Bold size={14} />
                </button>
                <button
                  onClick={() => patch({ italic: !drawing.italic })}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded border transition-colors",
                    drawing.italic
                      ? "border-terminal-border-strong bg-terminal-hover text-ink"
                      : "border-terminal-border-strong text-ink hover:border-brand hover:bg-terminal-hover",
                  )}
                >
                  <Italic size={14} />
                </button>
              </div>
              <textarea
                value={drawing.text ?? ""}
                onChange={(e) => patch({ text: e.target.value })}
                placeholder="Add text"
                rows={isShape ? 4 : 3}
                className="w-full resize-none rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 py-2.5 text-[13px] text-ink outline-none placeholder:text-ink-faint focus:border-brand focus:ring-2 focus:ring-brand/15"
              />
              {isShape && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs text-ink-faint">Text alignment</span>
                  <Select
                    value={drawing.textVAlign ?? "middle"}
                    options={V_ALIGN}
                    onChange={(v) => patch({ textVAlign: v })}
                  />
                  <Select
                    value={drawing.textHAlign ?? "center"}
                    options={H_ALIGN}
                    onChange={(v) => patch({ textHAlign: v })}
                  />
                </div>
              )}
            </>
          )}

          {/* -------------------------------------------- COORDINATES */}
          {tab === "coordinates" && (
            <DrawingCoordinatesFields
              points={drawing.points}
              candles={candles}
              labels={settings.coordinateLabels}
              onChange={(points) => patch({ points })}
            />
          )}

          {/* --------------------------------------------- VISIBILITY */}
          {tab === "visibility" && (
            <>
              <Row label="On chart">
                <button
                  onClick={() => patch({ visible: drawing.visible === false })}
                  className={cn(
                    "rounded border px-2.5 py-1 text-xs transition-colors",
                    drawing.visible !== false
                      ? "border-terminal-border-strong bg-brand text-[var(--accent-contrast)]"
                      : "border-terminal-border-strong text-ink-muted hover:bg-terminal-hover hover:text-ink",
                  )}
                >
                  {drawing.visible !== false ? "Shown" : "Hidden"}
                </button>
              </Row>
              <DrawingIntervalVisibilityFields
                value={drawing.intervalVisibility}
                currentTimeframe={timeframe}
                onChange={(intervalVisibility) => patch({ intervalVisibility })}
              />
            </>
          )}
        </div>

        {/* Footer: Template ▼ · Cancel · Ok */}
        <div
          data-dialog-footer
          className={cn(
            "flex items-center justify-between border-t",
            isFib
              ? "h-[58px] shrink-0 border-terminal-border px-5"
              : "h-[58px] shrink-0 border-terminal-border px-5",
          )}
        >
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setTplOpen((o) => !o);
                setPop(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs",
                isFib
                  ? "h-[34px] min-w-[104px] border-terminal-border-strong bg-terminal-raised text-[13px] font-medium text-ink"
                  : "h-[34px] min-w-[104px] border-terminal-border-strong bg-terminal-raised text-[13px] font-medium text-ink hover:border-brand hover:bg-terminal-raised",
              )}
            >
              Template
              <ChevronDown size={15} className="text-ink-faint" />
            </button>
            {tplOpen && (
              <div
                className="mobile-popover absolute bottom-full left-0 z-30 mb-1 w-[180px] rounded-md border border-terminal-border-strong bg-terminal-panel-2 p-1 shadow-floating"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={onSaveTemplate}
                  className="w-full rounded px-2 py-1.5 text-left text-[11px] text-ink hover:bg-terminal-hover"
                >
                  Save as template…
                </button>
                {familyTemplates.length > 0 && (
                  <div className="my-1 h-px bg-terminal-border" />
                )}
                {familyTemplates.map((t) => (
                  <div
                    key={t.name}
                    className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-ink hover:bg-terminal-hover"
                  >
                    <button
                      onClick={() => {
                        applyTemplate({ id: drawing.id, template: t });
                        setTplOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-terminal-border-strong"
                        style={{ background: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </button>
                    <button
                      title="Delete template"
                      onClick={() =>
                        deleteTemplate({ name: t.name, family: t.family })
                      }
                      className="rounded px-1 text-ink-faint opacity-0 hover:text-bear group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cancel}
              className={cn(
                "rounded-md border px-4 py-1.5 text-xs",
                isFib
                  ? "h-[34px] border-terminal-border-strong bg-transparent px-3.5 text-[14px] font-semibold text-ink hover:bg-terminal-hover"
                  : "h-[34px] border-terminal-border-strong bg-transparent px-3.5 text-[14px] font-semibold text-ink hover:bg-terminal-hover",
              )}
            >
              Cancel
            </button>
            <button
              onClick={ok}
              className={cn(
                "rounded-md px-5 py-1.5 text-xs font-medium",
                isFib
                  ? "h-[34px] border border-terminal-border-strong bg-brand px-4 text-[14px] font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover"
                  : "h-[34px] border border-terminal-border-strong bg-brand px-4 text-[14px] font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover",
              )}
            >
              Ok
            </button>
          </div>
        </div>
      </div>
      </div>
      <SaveDrawingTemplateDialog
        open={templateDialogOpen}
        templates={familyTemplates}
        onCloseAction={() => setTemplateDialogOpen(false)}
        onSaveAction={(name) => saveTemplate({ id: drawing.id, name })}
      />
    </>,
    document.body,
  );
}
