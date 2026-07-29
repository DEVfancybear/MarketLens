import type { Drawing } from "../../../../types/drawing";
import { resolveGannConfig } from "../../../../types/gann";
import { resolveVolumeProfileConfig } from "../../../../types/volumeProfile";
import {
  DRAWING_TOOLS,
  getDrawingToolManifestEntry,
  type DrawingTool,
} from "../../../../types/drawingToolManifest";
import {
  DEFAULT_EMOJI_SELECTION,
  findEmojiCatalogSelection,
  normalizeEmojiRecents,
  type EmojiPickerSelection,
} from "../../../../types/emojiCatalog";
import { getDrawingSettingsSchema } from "./drawingSettingsSchema";

export const DRAWING_TOOL_PREFERENCES_VERSION = 1;

export interface DrawingToolPreferences {
  version: typeof DRAWING_TOOL_PREFERENCES_VERSION;
  keepDrawing: boolean;
  magnetEnabled: boolean;
  magnetMode: DrawingMagnetMode;
  /** Overlay values augment OHLC candidates; they are not a third strength. */
  snapToIndicators: boolean;
  toolDefaults: Partial<Record<DrawingTool, Partial<Drawing>>>;
  /** Active Icons-menu item. Synced with chart settings on the backend. */
  emojiSelection: EmojiPickerSelection;
  /** Bounded, validated Icons-menu history shared across signed-in devices. */
  emojiRecents: EmojiPickerSelection[];
}

/** TradingView exposes OHLC magnets plus a separate overlay-indicator snap. */
export type DrawingMagnetMode = "weak" | "strong";

export const EMPTY_DRAWING_TOOL_PREFERENCES: DrawingToolPreferences = {
  version: DRAWING_TOOL_PREFERENCES_VERSION,
  keepDrawing: false,
  magnetEnabled: false,
  magnetMode: "weak",
  snapToIndicators: false,
  toolDefaults: {},
  emojiSelection: DEFAULT_EMOJI_SELECTION,
  emojiRecents: [],
};

const NEVER_DEFAULT_FIELDS = new Set<keyof Drawing>([
  "id",
  "schemaVersion",
  "tool",
  "points",
  "dataSnapshot",
  "content",
  "text",
  "visible",
  "intervalVisibility",
  "locked",
  "zIndex",
  "clientRevision",
  "serverRevision",
  "stop",
  "target",
  "tradeStatus",
  "hitTime",
  "hitPrice",
  "_dragging",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function defaultKeys(tool: DrawingTool): readonly (keyof Drawing)[] {
  const definition = getDrawingToolManifestEntry(tool);
  if (!definition.persistent) return [];
  return [...new Set(
    getDrawingSettingsSchema(tool).sections.flatMap((section) =>
      section.fields.map((field) => field.key),
    ),
  )].filter(
    (key) =>
      !NEVER_DEFAULT_FIELDS.has(key) || (tool === "emoji" && key === "text"),
  );
}

/** Pick only configurable, non-geometry fields that are safe for a future object. */
export function pickDrawingToolDefaults(drawing: Drawing): Partial<Drawing> {
  const defaults: Partial<Drawing> = {};
  for (const key of defaultKeys(drawing.tool)) {
    const value = drawing[key];
    if (value !== undefined) {
      (defaults as Record<string, unknown>)[key] = structuredClone(value);
    }
  }
  return defaults;
}

/**
 * Applies manifest defaults first and user defaults second. Identity and
 * geometry are supplied by the creation session and can never be overridden.
 */
export function resolveDrawingCreationDefaults(
  tool: DrawingTool,
  userDefaults: Partial<Drawing> | undefined,
  fallbackColor: string,
): Partial<Drawing> {
  const definition = getDrawingToolManifestEntry(tool);
  const allowed = new Set(defaultKeys(tool));
  const sanitized: Partial<Drawing> = {};
  if (isRecord(userDefaults)) {
    for (const key of allowed) {
      const value = userDefaults[key];
      if (value !== undefined) {
        (sanitized as Record<string, unknown>)[key] = structuredClone(value);
      }
    }
  }
  const resolved: Partial<Drawing> = {
    color: fallbackColor,
    ...structuredClone(definition.defaultProperties),
    ...sanitized,
  };
  if (definition.gannFamily) {
    resolved.gann = resolveGannConfig(resolved.gann, definition.gannFamily);
  }
  if (definition.dataSnapshotDetail === "volume-profile") {
    Object.assign(resolved, resolveVolumeProfileConfig(resolved));
  }
  return resolved;
}

/** Decode untrusted localStorage data without allowing unknown tools/fields. */
export function decodeDrawingToolPreferences(value: unknown): DrawingToolPreferences {
  if (!isRecord(value) || value.version !== DRAWING_TOOL_PREFERENCES_VERSION) {
    return structuredClone(EMPTY_DRAWING_TOOL_PREFERENCES);
  }
  const rawDefaults = isRecord(value.toolDefaults) ? value.toolDefaults : {};
  const toolDefaults: DrawingToolPreferences["toolDefaults"] = {};
  for (const tool of DRAWING_TOOLS) {
    const candidate = rawDefaults[tool];
    if (!isRecord(candidate)) continue;
    const sanitized = resolveDrawingCreationDefaults(tool, candidate, "#2962ff");
    // Persist only the user-provided safe subset, not manifest/color fallbacks.
    const filtered: Partial<Drawing> = {};
    for (const key of defaultKeys(tool)) {
      if (candidate[key] !== undefined) {
        (filtered as Record<string, unknown>)[key] = structuredClone(
          (sanitized as Record<string, unknown>)[key],
        );
      }
    }
    if (Object.keys(filtered).length > 0) toolDefaults[tool] = filtered;
  }
  const storedEmojiText = toolDefaults.emoji?.text;
  const emojiSelection =
    normalizeEmojiRecents([value.emojiSelection])[0] ??
    (typeof storedEmojiText === "string"
      ? findEmojiCatalogSelection(storedEmojiText)
      : undefined) ??
    DEFAULT_EMOJI_SELECTION;
  toolDefaults.emoji = {
    ...toolDefaults.emoji,
    text: emojiSelection.value,
  };
  return {
    version: DRAWING_TOOL_PREFERENCES_VERSION,
    keepDrawing: value.keepDrawing === true,
    magnetEnabled: value.magnetEnabled === true,
    magnetMode:
      value.magnetMode === "strong"
        ? "strong"
        : "weak",
    // Migrate the earlier audit build where indicator snapping was encoded as
    // an exclusive strength instead of TradingView's independent checkbox.
    snapToIndicators:
      value.snapToIndicators === true || value.magnetMode === "indicator",
    toolDefaults,
    emojiSelection,
    emojiRecents: normalizeEmojiRecents(value.emojiRecents),
  };
}
