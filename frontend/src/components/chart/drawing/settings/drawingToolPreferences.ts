import type { Drawing } from "../../../../types/drawing";
import {
  DRAWING_TOOLS,
  getDrawingToolManifestEntry,
  type DrawingTool,
} from "../../../../types/drawingToolManifest";
import { getDrawingSettingsSchema } from "./drawingSettingsSchema";

export const DRAWING_TOOL_PREFERENCES_VERSION = 1;

export interface DrawingToolPreferences {
  version: typeof DRAWING_TOOL_PREFERENCES_VERSION;
  keepDrawing: boolean;
  magnetEnabled: boolean;
  magnetMode: DrawingMagnetMode;
  toolDefaults: Partial<Record<DrawingTool, Partial<Drawing>>>;
}

export type DrawingMagnetMode = "weak" | "strong";

export const EMPTY_DRAWING_TOOL_PREFERENCES: DrawingToolPreferences = {
  version: DRAWING_TOOL_PREFERENCES_VERSION,
  keepDrawing: false,
  magnetEnabled: false,
  magnetMode: "weak",
  toolDefaults: {},
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
  )].filter((key) => !NEVER_DEFAULT_FIELDS.has(key));
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
  return {
    color: fallbackColor,
    ...structuredClone(definition.defaultProperties),
    ...sanitized,
  };
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
  return {
    version: DRAWING_TOOL_PREFERENCES_VERSION,
    keepDrawing: value.keepDrawing === true,
    magnetEnabled: value.magnetEnabled === true,
    magnetMode: value.magnetMode === "strong" ? "strong" : "weak",
    toolDefaults,
  };
}
