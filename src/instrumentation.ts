// Starts the closed-browser push alert evaluator in-process so `npm run dev` /
// `npm run start` alone is enough to deliver alerts while the browser is closed.
// Skipped on Vercel (serverless functions can't host a long-lived interval there —
// use an external scheduler hitting /api/push/evaluate instead, per PHASE6A docs)
// and can be opted out of with DISABLE_PUSH_WORKER=true.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL) return;
  if (process.env.DISABLE_PUSH_WORKER === "true") return;

  const { evaluatePushAlerts } = await import("@/server/pushAlertEvaluator");
  const intervalMs = Number(process.env.PUSH_WORKER_INTERVAL_MS ?? "15000");

  const tick = async () => {
    try {
      const result = await evaluatePushAlerts();
      if (result.triggered > 0 || result.errors.length > 0) {
        const errors = result.errors.length ? ` errors=${result.errors.length}` : "";
        console.log(
          `[push-worker] devices=${result.devices} alerts=${result.alerts} triggered=${result.triggered} skipped=${result.skipped}${errors}`,
        );
      }
    } catch (error) {
      console.error("[push-worker]", error instanceof Error ? error.message : error);
    }
  };

  console.log(`[push-worker] in-process closed-browser evaluation started (every ${intervalMs}ms)`);
  void tick();
  setInterval(tick, intervalMs);
}
