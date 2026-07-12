import type { Drawing, DrawingTemplate, Point } from "@/types";
import { normalizeDrawingIntervalVisibility } from "../visibility/drawingIntervalVisibility";
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

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function decodePoints(value: unknown): Point[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const points: Point[] = [];
  for (const point of value) {
    if (!isRecord(point) || !finite(point.time) || !finite(point.price)) {
      return null;
    }
    points.push({ time: point.time, price: point.price });
  }
  return points;
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
  const intervalVisibility = normalizeDrawingIntervalVisibility(value.intervalVisibility);
  if (intervalVisibility) drawing.intervalVisibility = intervalVisibility;
  else delete drawing.intervalVisibility;
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
