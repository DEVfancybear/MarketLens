/** Generates an unpredictable idempotency/correlation id; authorization remains server-side. */
export function makeClientCommandId(prefix = "exec_cmd"): string {
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (!randomUUID) {
    throw new Error("secure command identifier generation is unavailable");
  }
  return `${prefix}_${randomUUID()}`;
}

export function normalizeOrderSide(side: "long" | "short"): "buy" | "sell" {
  return side === "long" ? "buy" : "sell";
}
