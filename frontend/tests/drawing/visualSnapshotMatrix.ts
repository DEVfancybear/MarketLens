import {
  DRAWING_TOOL_GROUPS,
  DRAWING_TOOL_MANIFEST,
  isDrawingToolCreationEnabled,
  type DrawingToolGroupId,
  type DrawingToolManifestEntry,
} from "../../src/types/drawingToolManifest";

/**
 * A single source of truth for visual/browser coverage.
 *
 * The matrix is intentionally derived from the manifest rather than a second
 * hand-maintained list.  The adapter contract remains the correctness oracle;
 * these cases describe the visual state that should be captured when a human
 * reviews a browser artifact.
 */
export interface DrawingVisualSnapshotCase {
  readonly id: DrawingToolManifestEntry["id"];
  readonly displayName: string;
  readonly group: DrawingToolGroupId | null;
  readonly groupLabel: string | null;
  readonly creationMode: DrawingToolManifestEntry["creationMode"];
  readonly pointCount: number;
  readonly coverage: "browser" | "contract-only";
  readonly screenshotName: string;
  readonly visualContract: readonly VisualContractFlag[];
}

export type VisualContractFlag =
  | "anchors"
  | "body"
  | "fill"
  | "text"
  | "data-snapshot"
  | "always-render";

const groupLabels = new Map(
  DRAWING_TOOL_GROUPS.map((group) => [group.id, group.label] as const),
);

/** Resolve the deterministic fixture point count used by browser gestures. */
export function matrixFixturePointCount(
  entry: Pick<DrawingToolManifestEntry, "id" | "creationMode" | "minPoints" | "maxPoints">,
): number {
  // Position adapters store entry/target/stop as three points even though the
  // UI starts them with one click.
  if (entry.id === "long" || entry.id === "short") return 3;
  if (entry.maxPoints !== undefined) return entry.maxPoints;
  if (entry.creationMode === "pointer-continuous" || entry.creationMode === "click-freeform") {
    return Math.max(entry.minPoints, 4);
  }
  return entry.minPoints;
}

function visualContract(entry: DrawingToolManifestEntry): VisualContractFlag[] {
  const flags: VisualContractFlag[] = ["body"];
  if (entry.minPoints > 0) flags.unshift("anchors");
  if (entry.settingsFeatures.includes("fill")) flags.push("fill");
  if (entry.settingsFeatures.includes("text") || entry.overlayExtension === "text-editor") {
    flags.push("text");
  }
  if (entry.dataSnapshot) flags.push("data-snapshot");
  if (entry.viewportCulling === "always-render") flags.push("always-render");
  return flags;
}

function screenshotName(id: string): string {
  // Keep names portable across Windows/macOS/Linux and stable for CI artifacts.
  return `drawing-${id.replace(/[^a-z0-9_-]/gi, "-").toLowerCase()}.png`;
}

/**
 * All persistent tools, including legacy tools that are intentionally hidden
 * from creation menus. Hidden tools still get contract coverage and a stable
 * matrix row so a future migration cannot silently drop them.
 */
export const DRAWING_VISUAL_SNAPSHOT_MATRIX: readonly DrawingVisualSnapshotCase[] =
  Object.freeze(
    DRAWING_TOOL_MANIFEST
      .filter((entry) => entry.persistent)
      .map((entry) =>
        Object.freeze({
          id: entry.id,
          displayName: entry.displayName,
          group: entry.group,
          groupLabel: entry.group ? groupLabels.get(entry.group) ?? null : null,
          creationMode: entry.creationMode,
          pointCount: matrixFixturePointCount(entry),
          coverage:
            entry.preferredForCreation &&
            entry.group &&
            isDrawingToolCreationEnabled(entry.id)
              ? "browser"
              : "contract-only",
          screenshotName: screenshotName(entry.id),
          visualContract: Object.freeze(visualContract(entry)),
        }),
      ),
  );

export const DRAWING_BROWSER_SNAPSHOT_CASES =
  DRAWING_VISUAL_SNAPSHOT_MATRIX.filter((item) => item.coverage === "browser");

export const DRAWING_CONTRACT_ONLY_SNAPSHOT_CASES =
  DRAWING_VISUAL_SNAPSHOT_MATRIX.filter((item) => item.coverage === "contract-only");
