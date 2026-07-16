import type { Drawing, DrawingTemplate, LineStat, Point } from "@/types";
import { resolveGannConfig } from "../../../../types/gann";
import { resolveRegressionTrendConfig } from "../../../../types/regressionTrend";
import { resolveVolumeProfileConfig } from "../../../../types/volumeProfile";
import { sanitizeDrawingDataSamples } from "../data/drawingDataSamples";
import { normalizeDrawingIntervalVisibility } from "../visibility/drawingIntervalVisibility";
import { normalizeDrawingSyncMode } from "./drawingSyncScope";
import {
  DRAWING_TOOLS,
  getDrawingToolManifestEntry,
  type DrawingTool,
} from "../../../../types/drawingToolManifest";

export const CURRENT_DRAWING_SCHEMA_VERSION = 1;

export type DrawingDecodeIssueCode =
  | "not-object"
  | "unsupported-version"
  | "unknown-tool"
  | "invalid-id"
  | "invalid-points"
  | "invalid-style";

export interface DrawingDecodeIssue {
  code: DrawingDecodeIssueCode;
  message: string;
  tool?: string;
  schemaVersion?: number;
}

export interface DrawingDecodeResult {
  drawing: Drawing | null;
  issue?: DrawingDecodeIssue;
  /** Original value is retained in memory for quarantine persistence. */
  quarantined?: unknown;
  migrated: boolean;
}

export interface DrawingListDecodeResult {
  drawings: Drawing[];
  quarantined: Array<{ value: unknown; issue: DrawingDecodeIssue }>;
  migrated: number;
}

type UnknownRecord = Record<string, unknown>;
const MAX_OBJECT_NAME_LENGTH = 120;
const MAX_DATA_SAMPLES = 1000;
const MAX_CONTENT_TEXT = 200;
const LINE_STAT_IDS = new Set<LineStat>([
  "priceRange",
  "percentChange",
  "pips",
  "barsRange",
  "dateTimeRange",
  "distance",
  "angle",
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizedName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim().slice(0, MAX_OBJECT_NAME_LENGTH);
  return name || undefined;
}

function normalizedGroup(value: unknown): Drawing["group"] {
  if (!isRecord(value) || typeof value.id !== "string") return undefined;
  const id = value.id.trim().slice(0, MAX_OBJECT_NAME_LENGTH);
  if (!id) return undefined;
  return { id, name: normalizedName(value.name) ?? "Group" };
}

function normalizedSync(value: unknown): Drawing["sync"] {
  if (!isRecord(value) || typeof value.symbol !== "string") return undefined;
  const symbol = value.symbol.trim().slice(0, MAX_OBJECT_NAME_LENGTH);
  if (!symbol) return undefined;
  const mode = normalizeDrawingSyncMode(value.mode);
  if (mode === "global") return { mode, symbol };
  if (typeof value.layoutId !== "string" || !value.layoutId.trim()) return undefined;
  const layoutId = value.layoutId.trim().slice(0, MAX_OBJECT_NAME_LENGTH);
  if (mode === "layout-symbol") return { mode, symbol, layoutId };
  if (typeof value.chartId !== "string" || !value.chartId.trim()) return undefined;
  return {
    mode,
    symbol,
    layoutId,
    chartId: value.chartId.trim().slice(0, MAX_OBJECT_NAME_LENGTH),
  };
}

function normalizedDataSnapshot(value: unknown): Drawing["dataSnapshot"] {
  if (!isRecord(value) || value.version !== 1 || typeof value.symbol !== "string" || !finite(value.capturedAt) || !Array.isArray(value.samples)) return undefined;
  const samples = sanitizeDrawingDataSamples(value.samples, MAX_DATA_SAMPLES);
  if (samples.length === 0) return undefined;
  return { version: 1, symbol: value.symbol.trim().slice(0, MAX_OBJECT_NAME_LENGTH), capturedAt: value.capturedAt, samples };
}

function safeContentUrl(value: unknown, kind: "image" | "social"): string | undefined {
  if (typeof value !== "string") return undefined;
  const source = value.trim();
  if (kind === "image" && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(source) && source.length <= 2_800_000) return source;
  if (source.length > 2048) return undefined;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:") return undefined;
    if (kind === "social" && !["x.com", "twitter.com", "tradingview.com", "www.tradingview.com"].includes(url.hostname.toLowerCase())) return undefined;
    return url.toString();
  } catch { return undefined; }
}

function normalizedContent(value: unknown): Drawing["content"] {
  if (!isRecord(value) || !["table", "image", "social"].includes(String(value.kind))) return undefined;
  const kind = value.kind as "table" | "image" | "social";
  if (kind === "table") {
    if (!Array.isArray(value.cells)) return { kind, cells: [["Header", "Value"]] };
    const cells = value.cells.slice(0, 20).map((row) => Array.isArray(row) ? row.slice(0, 12).map((cell) => String(cell).slice(0, MAX_CONTENT_TEXT)) : []);
    return { kind, cells: cells.filter((row) => row.length > 0) };
  }
  const sourceUrl = safeContentUrl(value.sourceUrl, kind);
  return { kind, ...(sourceUrl ? { sourceUrl } : {}), ...(typeof value.alt === "string" ? { alt: value.alt.trim().slice(0, MAX_CONTENT_TEXT) } : {}) };
}

function decodePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const points: Point[] = [];
  for (const point of value) {
    if (!isRecord(point) || !finite(point.time) || !finite(point.price)) {
      return null;
    }
    points.push({
      time: point.time,
      price: point.price,
      ...(finite(point.pressure)
        ? { pressure: Math.max(0, Math.min(1, point.pressure)) }
        : {}),
    });
  }
  return points;
}

function normalizedLineStats(value: unknown): LineStat[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result = [...new Set(
    value.filter((item): item is LineStat =>
      typeof item === "string" && LINE_STAT_IDS.has(item as LineStat),
    ),
  )];
  return result;
}

function persistentTool(value: unknown): value is DrawingTool {
  return (
    typeof value === "string" &&
    (DRAWING_TOOLS as readonly string[]).includes(value) &&
    getDrawingToolManifestEntry(value as DrawingTool).persistent
  );
}

function issue(
  value: unknown,
  code: DrawingDecodeIssueCode,
  message: string,
  details: Partial<DrawingDecodeIssue> = {},
): DrawingDecodeResult {
  return {
    drawing: null,
    issue: { code, message, ...details },
    quarantined: value,
    migrated: false,
  };
}

/** Decode current versioned flat payloads and historical unversioned payloads. */
export function decodeDrawing(value: unknown): DrawingDecodeResult {
  if (!isRecord(value)) return issue(value, "not-object", "Drawing must be an object");
  const version = value.schemaVersion;
  if (
    version !== undefined &&
    (!Number.isInteger(version) || Number(version) < 0 || Number(version) > CURRENT_DRAWING_SCHEMA_VERSION)
  ) {
    return issue(value, "unsupported-version", "Drawing schema version is not supported", {
      schemaVersion: typeof version === "number" ? version : undefined,
    });
  }
  if (!persistentTool(value.tool)) {
    return issue(value, "unknown-tool", "Drawing tool is unknown or non-persistent", {
      tool: typeof value.tool === "string" ? value.tool : undefined,
      schemaVersion: typeof version === "number" ? version : undefined,
    });
  }
  if (typeof value.id !== "string" || value.id.trim() === "") {
    return issue(value, "invalid-id", "Drawing id is required", { tool: value.tool });
  }
  const points = decodePoints(value.points);
  const metadata = getDrawingToolManifestEntry(value.tool);
  if (
    !points ||
    points.length < metadata.minPoints ||
    (metadata.maxPoints !== undefined && points.length > metadata.maxPoints)
  ) {
    return issue(value, "invalid-points", "Drawing points must contain finite coordinates", {
      tool: value.tool,
    });
  }
  if (
    value.color !== undefined && typeof value.color !== "string" ||
    value.lineWidth !== undefined && (!finite(value.lineWidth) || value.lineWidth <= 0)
  ) {
    return issue(value, "invalid-style", "Drawing style fields are invalid", { tool: value.tool });
  }

  const drawing = {
    ...value,
    schemaVersion: CURRENT_DRAWING_SCHEMA_VERSION,
    id: value.id.trim(),
    tool: value.tool,
    color: typeof value.color === "string" ? value.color : "#2962ff",
    lineWidth:
      finite(value.lineWidth) && value.lineWidth > 0
        ? value.lineWidth
        : metadata.defaultProperties.lineWidth,
    points,
  } as Drawing;
  const lineStats = normalizedLineStats(value.lineStats);
  if (lineStats) drawing.lineStats = lineStats;
  else if (value.showStats === true) {
    // Compatibility with the audit-slice combined delta/percent chip.
    drawing.lineStats = ["priceRange", "percentChange"];
    drawing.alwaysShowLineStats = true;
  } else delete drawing.lineStats;
  if (["left", "center", "right", "auto"].includes(String(value.lineStatsPosition))) {
    drawing.lineStatsPosition = value.lineStatsPosition as Drawing["lineStatsPosition"];
  } else delete drawing.lineStatsPosition;
  if (typeof value.alwaysShowLineStats === "boolean") {
    drawing.alwaysShowLineStats = value.alwaysShowLineStats;
  } else if (value.showStats !== true) delete drawing.alwaysShowLineStats;
  if (metadata.gannFamily && value.gann !== undefined) {
    drawing.gann = resolveGannConfig(value.gann, metadata.gannFamily);
  } else if (!metadata.gannFamily) {
    delete drawing.gann;
  }
  const intervalVisibility = normalizeDrawingIntervalVisibility(value.intervalVisibility);
  if (intervalVisibility) drawing.intervalVisibility = intervalVisibility;
  else delete drawing.intervalVisibility;
  const name = normalizedName(value.name);
  if (name) drawing.name = name;
  else delete drawing.name;
  const group = normalizedGroup(value.group);
  if (group) drawing.group = group;
  else delete drawing.group;
  const sync = normalizedSync(value.sync);
  if (sync) drawing.sync = sync;
  else delete drawing.sync;
  const dataSnapshot = normalizedDataSnapshot(value.dataSnapshot);
  if (dataSnapshot) drawing.dataSnapshot = dataSnapshot;
  else delete drawing.dataSnapshot;
  const content = normalizedContent(value.content);
  if (content) drawing.content = content;
  else delete drawing.content;
  if (drawing.tool === "regressionTrend") {
    Object.assign(drawing, resolveRegressionTrendConfig(value));
  }
  if (metadata.dataSnapshotDetail === "volume-profile") {
    Object.assign(drawing, resolveVolumeProfileConfig(value));
  }
  delete drawing._dragging;
  return {
    drawing,
    migrated: version !== CURRENT_DRAWING_SCHEMA_VERSION,
  };
}

export function decodeDrawingList(value: unknown): DrawingListDecodeResult {
  const result: DrawingListDecodeResult = { drawings: [], quarantined: [], migrated: 0 };
  if (!Array.isArray(value)) {
    result.quarantined.push({
      value,
      issue: { code: "not-object", message: "Drawing collection must be an array" },
    });
    return result;
  }
  for (const candidate of value) {
    const decoded = decodeDrawing(candidate);
    if (decoded.drawing) {
      result.drawings.push(decoded.drawing);
      if (decoded.migrated) result.migrated++;
    } else if (decoded.issue) {
      result.quarantined.push({ value: candidate, issue: decoded.issue });
    }
  }
  return result;
}

/** Encode only persistable fields; render/session transients never cross a boundary. */
export function encodeDrawing(drawing: Drawing): Drawing {
  const decoded = decodeDrawing({
    ...drawing,
    schemaVersion: CURRENT_DRAWING_SCHEMA_VERSION,
    _dragging: undefined,
  });
  if (!decoded.drawing) {
    throw new Error(decoded.issue?.message ?? "Drawing cannot be encoded");
  }
  const encoded = structuredClone(decoded.drawing);
  delete encoded._dragging;
  return encoded;
}

export function encodeDrawingList(drawings: readonly Drawing[]): Drawing[] {
  return drawings.map(encodeDrawing);
}

const TEMPLATE_FAMILIES = new Set<DrawingTemplate["family"]>(["line", "shape", "text"]);

export function decodeDrawingTemplateList(value: unknown): DrawingTemplate[] {
  if (!Array.isArray(value)) return [];
  const templates: DrawingTemplate[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) continue;
    if (
      typeof candidate.name !== "string" ||
      candidate.name.trim() === "" ||
      !TEMPLATE_FAMILIES.has(candidate.family as DrawingTemplate["family"]) ||
      typeof candidate.color !== "string"
    ) {
      continue;
    }
    templates.push({
      ...(candidate as unknown as DrawingTemplate),
      name: candidate.name.trim(),
    });
  }
  return templates;
}
