import type { ExecutionAccountSummary } from "@/types/execution";

export function eaUpgradeLabel(account: ExecutionAccountSummary): string {
  const current = account.eaVersion ? `EA ${account.eaVersion} → ` : "";
  const required = account.requiredEaVersion ?? "latest";
  return `${current}Update ${required}+`;
}

export function executionAccountBlockReason(
  account: ExecutionAccountSummary | null | undefined,
): string | null {
  if (!account || account.venueKind !== "metatrader5") {
    return "Select an MT5 account registered by the common EA.";
  }
  if (account.statusReason === "ea_update_required") {
    const current = account.eaVersion ? `EA ${account.eaVersion}` : "This EA";
    const required = account.requiredEaVersion ?? "the latest version";
    return `${current} is outdated. Install SMCExecutionEA ${required} or newer, then refresh and reattach it in MT5.`;
  }
  if (account.status !== "ready") {
    return `${account.label} is ${account.status}.`;
  }
  if (!account.tradeAllowed) {
    return `${account.label} is not allowed to trade.`;
  }
  return null;
}
