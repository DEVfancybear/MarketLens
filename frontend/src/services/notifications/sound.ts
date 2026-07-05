/**
 * Alert sound — a short two-tone chime synthesized via the Web Audio API.
 *
 * No audio asset to ship/host, and no autoplay issues: the AudioContext is
 * created lazily on first use (which happens after a user has interacted with
 * the page to create/enable alerts). All calls are SSR- and failure-safe.
 */
let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = audioCtx ?? new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

function beep(ctx: AudioContext, freq: number, start: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.type = 'sine';
  osc.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

/** Play the alert chime (rising two-tone). Safe to call anywhere. */
export function playAlertSound(): void {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    beep(ctx, 880, 0, 0.18);
    beep(ctx, 1320, 0.16, 0.22);
  } catch {
    /* ignore audio failures */
  }
}
