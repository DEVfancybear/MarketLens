const baseUrl = (process.env.PUSH_WORKER_URL ?? "http://localhost:3000").replace(
  /\/$/,
  "",
);
const intervalMs = Number(process.env.PUSH_WORKER_INTERVAL_MS ?? "15000");
const secret = process.env.PUSH_WORKER_SECRET ?? "";

async function tick() {
  const headers = {};
  if (secret) headers["x-push-worker-secret"] = secret;

  const res = await fetch(`${baseUrl}/api/push/evaluate`, {
    method: "POST",
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const errors = Array.isArray(body.errors) && body.errors.length > 0
    ? ` errors=${body.errors.length}`
    : "";
  console.log(
    `[push-worker] devices=${body.devices ?? 0} alerts=${body.alerts ?? 0} triggered=${body.triggered ?? 0} skipped=${body.skipped ?? 0}${errors}`,
  );
  if (Array.isArray(body.errors)) {
    for (const error of body.errors.slice(0, 5)) {
      console.warn(`[push-worker] ${error}`);
    }
  }
}

console.log(
  `[push-worker] polling ${baseUrl}/api/push/evaluate every ${intervalMs}ms`,
);

await tick().catch((error) => {
  console.error(`[push-worker] ${error instanceof Error ? error.message : error}`);
});

setInterval(() => {
  void tick().catch((error) => {
    console.error(`[push-worker] ${error instanceof Error ? error.message : error}`);
  });
}, intervalMs);
