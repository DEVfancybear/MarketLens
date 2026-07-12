/**
 * Deterministic loading splash. Rendered identically on the server and during
 * client hydration / dynamic-import loading, so it never causes a mismatch.
 */
export function Splash() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-terminal-bg">
      <div className="flex flex-col items-center gap-3">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-terminal-border border-t-brand" />
        <span className="text-2xs uppercase tracking-widest text-ink-faint">
          SMC Trading Terminal
        </span>
      </div>
    </div>
  );
}
