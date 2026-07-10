export function isReplayBackendV1Enabled(
  value = process.env.NEXT_PUBLIC_REPLAY_BACKEND_V1,
): boolean {
  if (value == null || value.trim() === "") return true;
  return !["false", "0", "off"].includes(value.trim().toLowerCase());
}
