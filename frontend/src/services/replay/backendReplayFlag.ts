export function isReplayBackendV1Enabled(
  value = process.env.NEXT_PUBLIC_REPLAY_BACKEND_V1,
): boolean {
  return value?.trim().toLowerCase() === "true";
}
