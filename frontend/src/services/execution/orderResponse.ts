export type ExecutionTargetSubmission =
  | {
      status: "queued";
      accountId: string;
      commandId: string;
      warnings: string[];
    }
  | {
      status: "waiting";
      accountId: string;
      commandId: string;
      expiresAtMs: number;
    }
  | {
      status: "rejected" | "unavailable";
      accountId: string;
      code: string;
      message: string;
    };

export interface ExecutionOrderResponse {
  commandId: string;
  targets: ExecutionTargetSubmission[];
}

/**
 * Normalizes both the canonical camelCase response and the legacy snake_case
 * enum fields so a rolling backend deployment can never surface "undefined"
 * account names in money-sensitive feedback.
 */
export function normalizeExecutionOrderResponse(
  value: unknown,
): ExecutionOrderResponse {
  const response = record(value, "execution order response");
  const targets = response.targets;
  if (!Array.isArray(targets)) {
    throw new Error("execution order response targets are invalid");
  }
  return {
    commandId: requiredString(response, "commandId", "command_id"),
    targets: targets.map((item) => normalizeTargetSubmission(item)),
  };
}

function normalizeTargetSubmission(
  value: unknown,
): ExecutionTargetSubmission {
  const target = record(value, "execution target submission");
  const status = requiredString(target, "status");
  const accountId = requiredString(target, "accountId", "account_id");
  if (status === "queued") {
    const warnings = target.warnings;
    if (
      !Array.isArray(warnings) ||
      !warnings.every((warning) => typeof warning === "string")
    ) {
      throw new Error("execution target warnings are invalid");
    }
    return {
      status,
      accountId,
      commandId: requiredString(target, "commandId", "command_id"),
      warnings,
    };
  }
  if (status === "waiting") {
    return {
      status,
      accountId,
      commandId: requiredString(target, "commandId", "command_id"),
      expiresAtMs: requiredNumber(target, "expiresAtMs", "expires_at_ms"),
    };
  }
  if (status === "rejected" || status === "unavailable") {
    return {
      status,
      accountId,
      code: requiredString(target, "code"),
      message: requiredString(target, "message"),
    };
  }
  throw new Error(`unsupported execution target status: ${status}`);
}

function record(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function requiredString(
  value: Record<string, unknown>,
  camelCase: string,
  snakeCase?: string,
): string {
  const candidate = value[camelCase] ?? (snakeCase ? value[snakeCase] : undefined);
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error(`execution response field ${camelCase} is invalid`);
  }
  return candidate;
}

function requiredNumber(
  value: Record<string, unknown>,
  camelCase: string,
  snakeCase?: string,
): number {
  const candidate = value[camelCase] ?? (snakeCase ? value[snakeCase] : undefined);
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    throw new Error(`execution response field ${camelCase} is invalid`);
  }
  return candidate;
}
