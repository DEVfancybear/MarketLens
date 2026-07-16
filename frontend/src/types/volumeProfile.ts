export type VolumeProfilePlacement = "left" | "right";
export type VolumeProfileVolumeMode = "total" | "up-down" | "delta";

export interface VolumeProfileProperties {
  volumeProfileRows?: number;
  volumeProfileValueAreaPercent?: number;
  volumeProfileWidthPercent?: number;
  volumeProfilePlacement?: VolumeProfilePlacement;
  volumeProfileVolumeMode?: VolumeProfileVolumeMode;
  volumeProfileShowHistogram?: boolean;
  volumeProfileShowPointOfControl?: boolean;
  volumeProfileShowValueAreaHigh?: boolean;
  volumeProfileShowValueAreaLow?: boolean;
}

export interface ResolvedVolumeProfileConfig {
  volumeProfileRows: number;
  volumeProfileValueAreaPercent: number;
  volumeProfileWidthPercent: number;
  volumeProfilePlacement: VolumeProfilePlacement;
  volumeProfileVolumeMode: VolumeProfileVolumeMode;
  volumeProfileShowHistogram: boolean;
  volumeProfileShowPointOfControl: boolean;
  volumeProfileShowValueAreaHigh: boolean;
  volumeProfileShowValueAreaLow: boolean;
}

export const DEFAULT_VOLUME_PROFILE_CONFIG: Readonly<ResolvedVolumeProfileConfig> = {
  volumeProfileRows: 24,
  volumeProfileValueAreaPercent: 70,
  volumeProfileWidthPercent: 30,
  volumeProfilePlacement: "right",
  volumeProfileVolumeMode: "up-down",
  volumeProfileShowHistogram: true,
  volumeProfileShowPointOfControl: true,
  volumeProfileShowValueAreaHigh: true,
  volumeProfileShowValueAreaLow: true,
};

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveVolumeProfileConfig(
  value?: VolumeProfileProperties,
): ResolvedVolumeProfileConfig {
  return {
    volumeProfileRows: Math.max(
      1,
      Math.min(1_000, Math.floor(finiteOr(
        value?.volumeProfileRows,
        DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileRows,
      ))),
    ),
    volumeProfileValueAreaPercent: Math.max(
      0,
      Math.min(100, finiteOr(
        value?.volumeProfileValueAreaPercent,
        DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileValueAreaPercent,
      )),
    ),
    volumeProfileWidthPercent: Math.max(
      1,
      Math.min(100, finiteOr(
        value?.volumeProfileWidthPercent,
        DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileWidthPercent,
      )),
    ),
    volumeProfilePlacement:
      value?.volumeProfilePlacement === "left" ? "left" : "right",
    volumeProfileVolumeMode:
      value?.volumeProfileVolumeMode === "total" ||
      value?.volumeProfileVolumeMode === "delta"
        ? value.volumeProfileVolumeMode
        : "up-down",
    volumeProfileShowHistogram:
      value?.volumeProfileShowHistogram ??
      DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileShowHistogram,
    volumeProfileShowPointOfControl:
      value?.volumeProfileShowPointOfControl ??
      DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileShowPointOfControl,
    volumeProfileShowValueAreaHigh:
      value?.volumeProfileShowValueAreaHigh ??
      DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileShowValueAreaHigh,
    volumeProfileShowValueAreaLow:
      value?.volumeProfileShowValueAreaLow ??
      DEFAULT_VOLUME_PROFILE_CONFIG.volumeProfileShowValueAreaLow,
  };
}
