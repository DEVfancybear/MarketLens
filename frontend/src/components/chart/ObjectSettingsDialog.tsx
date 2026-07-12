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
  DEFAULT_FIB_LEVELS,
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
  const patchFibLevel = (idx: number, p: Partial<FibLevelConfig>) => {
    const next = normalizedFibLevels(drawing);
    if (!next[idx]) return;
    next[idx] = { ...next[idx], ...p };
    patch({ fibLevels: next });
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
            ? "border-[#f0f0f0] text-[#f0f0f0]"
            : "border-transparent text-[#d1d4dc] hover:text-[#f0f0f0]",
        )}
      >
        {id}
      </button>
    );

    return createPortal(
      <>
        <div
          data-chart-ui
          className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 p-4"
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
            className="flex max-h-[calc(100dvh-32px)] w-[min(calc(100vw-32px),380px)] flex-col overflow-hidden rounded-md border border-[#3a3a3a] bg-[#1f1f1f] shadow-2xl shadow-black/70"
            onClick={() => {
              setPop(null);
              setTplOpen(false);
            }}
          >
            <div
              {...dragHandleProps}
              className={cn(
                "flex items-center justify-between px-5 pb-2 pt-4",
                dragHandleClassName,
              )}
            >
              <div className="flex items-center gap-2">
                <span className="text-[20px] font-semibold leading-7 text-[#f0f0f0]">
                  Text
                </span>
                <Pencil size={16} className="text-[#d1d4dc]" />
              </div>
              <button
                onClick={cancel}
                aria-label="Close settings"
                className="rounded-sm p-1 text-[#d1d4dc] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]"
              >
                <X size={24} strokeWidth={1.5} />
              </button>
            </div>

            <div role="tablist" aria-label="Drawing settings sections" className="mx-5 flex items-center gap-6 border-b border-[#5a5a5a] pt-3">
              {(settings.tabs as readonly Tab[]).map(textTabBtn)}
            </div>

            <div className="min-h-[420px] flex-1 overflow-y-auto px-5 py-5">
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
                          ? "border-[#f0f0f0] bg-[#2a2a2a] text-[#f0f0f0]"
                          : "border-[#50535a] text-[#f0f0f0] hover:border-[#6a6d75]",
                      )}
                    >
                      B
                    </button>
                    <button
                      onClick={() => patch({ italic: !drawing.italic })}
                      className={cn(
                        "flex h-[34px] w-[34px] items-center justify-center rounded-md border font-serif text-[16px] italic transition-colors",
                        drawing.italic
                          ? "border-[#f0f0f0] bg-[#2a2a2a] text-[#f0f0f0]"
                          : "border-[#50535a] text-[#f0f0f0] hover:border-[#6a6d75]",
                      )}
                    >
                      I
                    </button>
                  </div>

                  <textarea
                    value={drawing.text ?? ""}
                    onChange={(e) => patch({ text: e.target.value })}
                    rows={8}
                    className="mb-4 h-[176px] w-full resize-none rounded-md border border-[#2962ff] bg-[#1f1f1f] px-2.5 py-2 text-[13px] text-[#f0f0f0] outline-none placeholder:text-[#5d606b]"
                  />

                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <CheckBox
                        checked={!!drawing.textBackground}
                        onChange={(v) => patch({ textBackground: v })}
                      />
                      <span className="min-w-[82px] text-[14px] font-medium text-[#d1d4dc]">
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
                      <span className="min-w-[82px] text-[14px] font-medium text-[#d1d4dc]">
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
                      <span className="text-[14px] font-medium text-[#d1d4dc]">
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
                          ? "border-[#f0f0f0] bg-[#f0f0f0] text-[#1f1f1f]"
                          : "border-[#50535a] text-[#d1d4dc] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]",
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

            <div className="flex h-[58px] shrink-0 items-center justify-between border-t border-[#3a3a3a] px-5">
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setTplOpen((o) => !o);
                    setPop(null);
                  }}
                  className="flex h-[34px] min-w-[104px] items-center justify-between rounded-[5px] border border-[#50535a] bg-[#1f1f1f] px-2.5 text-[13px] font-medium text-[#f0f0f0] hover:border-[#6a6d75]"
                >
                  Template
                  <ChevronDown size={15} className="text-[#a0a3aa]" />
                </button>
                {tplOpen && (
                  <div
                    className="absolute bottom-full left-0 z-30 mb-1 w-[180px] rounded-md border border-[#50535a] bg-[#242424] p-1 shadow-2xl shadow-black/60"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      onClick={onSaveTemplate}
                      className="w-full rounded px-2 py-1.5 text-left text-[11px] text-[#f0f0f0] hover:bg-[#2a2a2a]"
                    >
                      Save as template...
                    </button>
                    {familyTemplates.length > 0 && (
                      <div className="my-1 h-px bg-[#50535a]" />
                    )}
                    {familyTemplates.map((t) => (
                      <div
                        key={t.name}
                        className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-[#f0f0f0] hover:bg-[#2a2a2a]"
                      >
                        <button
                          onClick={() => {
                            applyTemplate({ id: drawing.id, template: t });
                            setTplOpen(false);
                          }}
                          className="flex flex-1 items-center gap-2 text-left"
                        >
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-[#50535a]"
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
                          className="rounded px-1 text-[#8a8d93] opacity-0 hover:text-[#f23645] group-hover:opacity-100"
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
                  className="h-[34px] rounded-[5px] border border-[#f0f0f0] bg-transparent px-3.5 text-[14px] font-semibold text-[#f0f0f0] hover:bg-[#2a2a2a]"
                >
                  Cancel
                </button>
                <button
                  onClick={ok}
                  className="h-[34px] rounded-[5px] border border-[#f0f0f0] bg-[#f0f0f0] px-4 text-[14px] font-semibold text-[#1f1f1f] hover:bg-white"
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
            ? "border-[#f0f0f0] text-[#f0f0f0]"
            : "border-[#f0f0f0] text-[#f0f0f0]"
          : isFib
            ? "border-transparent text-[#d1d4dc] hover:text-[#f0f0f0]"
            : "border-transparent text-[#d1d4dc] hover:text-[#f0f0f0]",
      )}
    >
      {id}
    </button>
  );

  return createPortal(
    <>
      <div
      data-chart-ui
      className="fixed inset-0 z-[110] flex items-start justify-center bg-black/50 p-4"
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
            ? "flex max-h-[calc(100dvh-32px)] w-[min(calc(100vw-32px),456px)] flex-col overflow-hidden rounded-md border border-[#3a3a3a] bg-[#1f1f1f] shadow-2xl shadow-black/70"
            : "flex max-h-[calc(100dvh-32px)] w-[min(calc(100vw-32px),380px)] flex-col overflow-hidden rounded-md border border-[#3a3a3a] bg-[#1f1f1f] shadow-2xl shadow-black/70",
        )}
        onClick={() => {
          setPop(null);
          setTplOpen(false);
        }}
      >
        {isFib && (
          <div
            {...dragHandleProps}
            className={cn(
              "flex items-center justify-between px-5 pb-2 pt-4",
              dragHandleClassName,
            )}
          >
            <div className="flex items-center gap-2">
              <span className="text-[20px] font-semibold leading-7 text-[#f0f0f0]">
                {settings.title}
              </span>
              <Pencil size={16} className="text-[#d1d4dc]" />
            </div>
            <button
              onClick={cancel}
              aria-label="Close settings"
              className="rounded-sm p-1 text-[#d1d4dc] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]"
            >
              <X size={24} strokeWidth={1.5} />
            </button>
          </div>
        )}
        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Drawing settings sections"
          {...(!isFib ? dragHandleProps : {})}
          className={cn(
            isFib
              ? "mx-5 flex items-center gap-6 border-b border-[#5a5a5a] pt-3"
              : "mx-5 flex items-center gap-6 border-b border-[#5a5a5a] pt-3",
            !isFib && dragHandleClassName,
          )}
        >
          {tabs.map(tabBtn)}
        </div>

        <div
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
                      <span className="w-[88px] shrink-0 text-[14px] font-medium text-[#d1d4dc]">
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

                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 py-2">
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
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 h-px bg-[#3a3a3a]" />

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
                      <span className="w-[88px] shrink-0 text-[14px] font-medium text-[#d1d4dc]">
                        Background
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.round((drawing.opacity ?? 0.12) * 100)}
                        onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
                        className="w-[150px] accent-[#2962ff]"
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
              )}

              {!isFib && isText && (
                <p className="py-6 text-center text-xs text-[#a0a3aa]">
                  Edit text and font on the <b className="text-[#f0f0f0]">Text</b> tab.
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
                      ? "border-[#f0f0f0] bg-[#2a2a2a] text-[#f0f0f0]"
                      : "border-[#50535a] text-[#f0f0f0] hover:border-[#6a6d75] hover:bg-[#2a2a2a]",
                  )}
                >
                  <Bold size={14} />
                </button>
                <button
                  onClick={() => patch({ italic: !drawing.italic })}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded border transition-colors",
                    drawing.italic
                      ? "border-[#f0f0f0] bg-[#2a2a2a] text-[#f0f0f0]"
                      : "border-[#50535a] text-[#f0f0f0] hover:border-[#6a6d75] hover:bg-[#2a2a2a]",
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
                className="w-full resize-none rounded-md border border-[#2962ff] bg-[#1f1f1f] px-2.5 py-2 text-[13px] text-[#f0f0f0] outline-none placeholder:text-[#5d606b]"
              />
              {isShape && (
                <div className="mt-3 flex items-center gap-3">
                  <span className="text-xs text-[#a0a3aa]">Text alignment</span>
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
                      ? "border-[#f0f0f0] bg-[#f0f0f0] text-[#1f1f1f]"
                      : "border-[#50535a] text-[#d1d4dc] hover:bg-[#2a2a2a] hover:text-[#f0f0f0]",
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
          className={cn(
            "flex items-center justify-between border-t",
            isFib
              ? "h-[58px] shrink-0 border-[#3a3a3a] px-5"
              : "h-[58px] shrink-0 border-[#3a3a3a] px-5",
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
                  ? "h-[34px] min-w-[104px] border-[#50535a] bg-[#1f1f1f] text-[13px] font-medium text-[#f0f0f0]"
                  : "h-[34px] min-w-[104px] border-[#50535a] bg-[#1f1f1f] text-[13px] font-medium text-[#f0f0f0] hover:border-[#6a6d75] hover:bg-[#1f1f1f]",
              )}
            >
              Template
              <ChevronDown size={15} className="text-[#a0a3aa]" />
            </button>
            {tplOpen && (
              <div
                className="absolute bottom-full left-0 z-30 mb-1 w-[180px] rounded-md border border-[#50535a] bg-[#242424] p-1 shadow-2xl shadow-black/60"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={onSaveTemplate}
                  className="w-full rounded px-2 py-1.5 text-left text-[11px] text-[#f0f0f0] hover:bg-[#2a2a2a]"
                >
                  Save as template…
                </button>
                {familyTemplates.length > 0 && (
                  <div className="my-1 h-px bg-[#50535a]" />
                )}
                {familyTemplates.map((t) => (
                  <div
                    key={t.name}
                    className="group flex items-center gap-2 rounded px-2 py-1.5 text-[11px] text-[#f0f0f0] hover:bg-[#2a2a2a]"
                  >
                    <button
                      onClick={() => {
                        applyTemplate({ id: drawing.id, template: t });
                        setTplOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-full border border-[#50535a]"
                        style={{ background: t.color }}
                      />
                      <span className="truncate">{t.name}</span>
                    </button>
                    <button
                      title="Delete template"
                      onClick={() =>
                        deleteTemplate({ name: t.name, family: t.family })
                      }
                      className="rounded px-1 text-[#8a8d93] opacity-0 hover:text-[#f23645] group-hover:opacity-100"
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
                  ? "h-[34px] border-[#f0f0f0] bg-transparent px-3.5 text-[14px] font-semibold text-[#f0f0f0] hover:bg-[#2a2a2a]"
                  : "h-[34px] border-[#f0f0f0] bg-transparent px-3.5 text-[14px] font-semibold text-[#f0f0f0] hover:bg-[#2a2a2a]",
              )}
            >
              Cancel
            </button>
            <button
              onClick={ok}
              className={cn(
                "rounded-md px-5 py-1.5 text-xs font-medium",
                isFib
                  ? "h-[34px] border border-[#f0f0f0] bg-[#f0f0f0] px-4 text-[14px] font-semibold text-[#1f1f1f] hover:bg-white"
                  : "h-[34px] border border-[#f0f0f0] bg-[#f0f0f0] px-4 text-[14px] font-semibold text-[#1f1f1f] hover:bg-white",
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
