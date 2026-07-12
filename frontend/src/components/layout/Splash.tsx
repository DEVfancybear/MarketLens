/**
 * Deterministic loading splash. Rendered identically on the server and during
 * client hydration / dynamic-import loading, so it never causes a mismatch.
 */
export function Splash() {
  return (
    <div className="terminal-shell flex h-dvh w-full items-center justify-center">
      <div className="workspace-surface flex min-w-56 flex-col items-center gap-4 rounded-2xl px-8 py-7">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-signal text-xs font-black text-white shadow-[0_10px_28px_var(--shell-glow)]">SMC</div>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-ink-muted">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
          Preparing workspace
        </div>
      </div>
    </div>
  );
}
