/**
 * Deterministic loading splash. Rendered identically on the server and during
 * client hydration / dynamic-import loading, so it never causes a mismatch.
 */
export function Splash() {
  return (
    <div className="relative flex h-dvh w-screen items-center justify-center overflow-hidden bg-terminal-bg text-ink">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgb(var(--accent-rgb)/0.14),transparent_34%)]" />
      <div className="relative flex flex-col items-center gap-5">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-brand/30 bg-brand/10 shadow-[0_0_44px_rgb(var(--accent-rgb)/0.16)]">
          <svg viewBox="0 0 32 32" className="h-7 w-7 text-brand" fill="none" aria-hidden="true">
            <path d="M5 23V14m7 11V8m7 14V11m8 12V6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            <path d="m4 19 8-6 7 4 9-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" opacity=".55" />
          </svg>
        </div>
        <div className="text-center">
          <div className="text-sm font-semibold tracking-[-0.01em]">SMC Terminal</div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.24em] text-ink-faint">Institutional workspace</div>
        </div>
        <div className="h-0.5 w-24 overflow-hidden rounded-full bg-terminal-border" aria-label="Loading terminal">
          <span className="block h-full w-1/2 animate-[splashProgress_1.1s_ease-in-out_infinite] rounded-full bg-brand" />
        </div>
      </div>
    </div>
  );
}
