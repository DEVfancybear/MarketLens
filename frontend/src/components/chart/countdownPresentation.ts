export function formatCountdown(remaining: number): string {
  if (!Number.isFinite(remaining) || remaining <= 0) return "0:00";

  const wholeSeconds = Math.floor(remaining);
  const h = Math.floor(wholeSeconds / 3600);
  const m = Math.floor((wholeSeconds % 3600) / 60);
  const s = wholeSeconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");

  return h === 0 ? `${m}:${pad(s)}` : `${h}:${pad(m)}:${pad(s)}`;
}
