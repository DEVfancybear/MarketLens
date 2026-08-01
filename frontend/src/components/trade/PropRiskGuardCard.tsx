"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  AlertTriangle,
  LoaderCircle,
  LockKeyhole,
  Save,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  getExecutionPropRisk,
  updateExecutionPropRisk,
} from "@/services/api/resources/executionApi";
import { resolveProfileInitialBalance } from "@/services/execution/propRiskProfile";
import type {
  ExecutionAccountSummary,
  PropRiskActions,
  PropRiskAssignment,
  PropRiskGuard,
  PropRiskProfile,
  PropRiskReason,
  PropRiskRules,
} from "@/types/execution";
import { cn } from "@/utils/cn";

const REASON_LABELS: Record<PropRiskReason, string> = {
  DAILY_LOSS_WARNING: "Sắp chạm giới hạn lỗ ngày",
  MAX_LOSS_WARNING: "Sắp chạm giới hạn lỗ tối đa",
  DAILY_LOSS_SAFETY_BUFFER: "Đã chạm vùng an toàn lỗ ngày",
  MAX_LOSS_SAFETY_BUFFER: "Đã chạm vùng an toàn lỗ tối đa",
  DAILY_LOSS_LIMIT_BREACHED: "Đã vượt giới hạn lỗ ngày",
  MAX_LOSS_LIMIT_BREACHED: "Đã vượt giới hạn lỗ tối đa",
  DAILY_PROFIT_TARGET_REACHED: "Đã đạt mục tiêu lợi nhuận ngày",
  UNPROTECTED_EXPOSURE: "Phát hiện position hoặc pending order không có Stop Loss",
  TELEMETRY_STALE: "Dữ liệu tài khoản không còn đủ mới",
  STATE_UNAVAILABLE: "Chưa có trạng thái rủi ro tin cậy",
};

interface GuardDraft {
  enabled: boolean;
  profileId: string;
  initialBalance: string;
  timezone: string;
  rules: PropRiskRules;
  actions: PropRiskActions;
}

export function PropRiskCompactStatus({
  account,
}: {
  account: ExecutionAccountSummary | null;
}) {
  const [assignment, setAssignment] = useState<PropRiskAssignment | null>(null);
  const accountId = account?.id;
  useEffect(() => {
    if (!accountId) {
      setAssignment(null);
      return;
    }
    let active = true;
    const refresh = () => {
      void getExecutionPropRisk(accountId)
        .then((guard) => {
          if (active) setAssignment(guard.assignment);
        })
        .catch(() => {
          if (active) setAssignment(null);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [accountId]);
  const evaluation = assignment?.evaluation;
  if (!assignment?.enabled) return null;
  const locked = evaluation?.status === "locked" || evaluation?.status === "breached";
  const warning = !evaluation || evaluation.status === "warning";
  const label = locked
    ? "Risk locked"
    : !evaluation
      ? "Risk syncing"
      : warning
        ? "Risk warning"
        : "Risk guard";
  return (
    <span
      aria-live="polite"
      title={
        evaluation?.reason
          ? REASON_LABELS[evaluation.reason]
          : evaluation
            ? assignment.displayName
            : "Đang chờ heartbeat tài khoản đầu tiên; lệnh mới được fail-closed."
      }
      className={cn(
        "inline-flex min-h-7 items-center gap-1.5 rounded-lg border px-2 text-[9px] font-semibold",
        locked
          ? "border-bear/30 bg-bear/10 text-bear"
          : warning
            ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
            : "border-bull/25 bg-bull/10 text-bull",
      )}
    >
      {locked ? (
        <LockKeyhole size={11} />
      ) : warning ? (
        <AlertTriangle size={11} />
      ) : (
        <ShieldCheck size={11} />
      )}
      {label}
      {evaluation && (
        <span className="tabular-nums text-ink-muted">
          · {Math.max(0, evaluation.dailyLossRemaining).toFixed(0)} {account?.currency}
        </span>
      )}
    </span>
  );
}

export function PropRiskGuardCard({
  account,
}: {
  account: ExecutionAccountSummary;
}) {
  const latestAccount = useRef(account);
  latestAccount.current = account;
  const accountId = account.id;
  const [guard, setGuard] = useState<PropRiskGuard | null>(null);
  const [draft, setDraft] = useState<GuardDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void getExecutionPropRisk(accountId)
      .then((next) => {
        if (!active) return;
        setGuard(next);
        setDraft(draftFromGuard(next, latestAccount.current));
      })
      .catch(() => {
        if (active) setError("Không thể tải cấu hình bảo vệ quỹ.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accountId]);

  const selectedProfile = useMemo(
    () => guard?.profiles.find((profile) => profile.id === draft?.profileId),
    [draft?.profileId, guard?.profiles],
  );
  const presetLocked = selectedProfile?.rulesLocked ?? true;
  const balanceAutoDetected = selectedProfile?.capitalMode === "referenceBalances";
  const assignment = guard?.assignment ?? null;
  const waitingForEvaluation = Boolean(
    assignment?.enabled && !assignment.evaluation,
  );

  useEffect(() => {
    if (!waitingForEvaluation || saving) return;
    let active = true;
    let timeoutId: number | undefined;

    const refresh = async () => {
      try {
        const next = await getExecutionPropRisk(accountId);
        if (active) setGuard(next);
      } catch {
        // Keep the last known guard visible and retry while the heartbeat is pending.
      } finally {
        if (active) {
          timeoutId = window.setTimeout(() => void refresh(), 2_000);
        }
      }
    };

    timeoutId = window.setTimeout(() => void refresh(), 2_000);
    return () => {
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [accountId, saving, waitingForEvaluation]);

  const chooseProfile = (profile: PropRiskProfile) => {
    setDraft((current) => ({
      enabled: current?.enabled ?? true,
      profileId: profile.id,
      initialBalance: String(
        resolveProfileInitialBalance(
          profile.capitalMode,
          profile.referenceBalances,
          latestAccount.current.balance ?? latestAccount.current.equity,
        ) ?? current?.initialBalance ?? "",
      ),
      timezone: profile.timezone,
      rules: { ...profile.rules },
      actions: { ...profile.actions },
    }));
  };

  const save = async () => {
    if (!draft || !selectedProfile) return;
    const initialBalance = Number(draft.initialBalance);
    if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
      setError("Vốn ban đầu phải là một số dương.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const next = await updateExecutionPropRisk({
        accountId,
        enabled: draft.enabled,
        profileId: draft.profileId,
        initialBalance,
        timezone: draft.timezone,
        rules: draft.rules,
        actions: draft.actions,
        displayName: selectedProfile.displayName,
        providerCode: selectedProfile.providerCode,
        programCode: selectedProfile.programCode,
      });
      setGuard(next);
      setDraft(draftFromGuard(next, latestAccount.current));
    } catch {
      setError("Không thể lưu cấu hình. Account chưa thay đổi.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-xl border border-terminal-border bg-terminal-panel-2/40 p-3">
        <div className="flex min-h-24 items-center justify-center gap-2 text-[11px] text-ink-muted">
          <LoaderCircle size={14} className="animate-spin text-brand" />
          Đang tải Prop Risk Guard…
        </div>
      </section>
    );
  }

  if (!draft || !guard) {
    return (
      <section
        role="alert"
        className="rounded-xl border border-bear/30 bg-bear/5 p-3 text-[11px] text-bear"
      >
        {error ?? "Prop Risk Guard hiện chưa khả dụng."}
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-xl border border-terminal-border bg-terminal-panel-2/40">
      <div className="border-b border-terminal-border bg-[linear-gradient(120deg,rgba(124,92,255,0.14),transparent_58%)] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 gap-2.5">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand/25 bg-brand/10 text-brand">
              <ShieldCheck size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <strong className="block text-xs text-ink">Prop Risk Guard</strong>
              <p className="mt-1 text-[10px] leading-4 text-ink-muted">
                Web tự chặn lệnh quá rủi ro, hủy pending và đóng position khi
                chạm vùng bảo vệ. Chỉ cấu hình một lần, tự reset theo ngày của quỹ.
              </p>
            </div>
          </div>
          <label className="flex shrink-0 cursor-pointer items-center gap-2 text-[10px] font-semibold text-ink">
            <span>{draft.enabled ? "Đang bật" : "Đang tắt"}</span>
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, enabled: event.target.checked } : current,
                )
              }
              className="size-4 accent-[var(--accent)]"
              aria-label="Bật bảo vệ tài khoản quỹ tự động"
            />
          </label>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {assignment?.evaluation && (
          <RiskStatus assignment={assignment} currency={account.currency} />
        )}
        {assignment?.enabled && !assignment.evaluation && (
          <p
            aria-live="polite"
            className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-2.5 text-[10px] leading-4 text-amber-200"
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            Đang chờ heartbeat đầu tiên để chụp baseline ngày. Trong thời gian này,
            lệnh mới được chặn an toàn (fail-closed).
          </p>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[10px] text-ink-muted">
            <span className="font-medium">Mẫu quỹ / giai đoạn</span>
            <select
              value={draft.profileId}
              onChange={(event) => {
                const profile = guard.profiles.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (profile) chooseProfile(profile);
              }}
              className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] text-ink outline-none focus:border-brand focus-ring"
            >
              {guard.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.displayName}
                </option>
              ))}
            </select>
          </label>
          <Field
            label={balanceAutoDetected ? "Vốn gốc (tự nhận diện)" : "Vốn ban đầu"}
            value={draft.initialBalance}
            onChange={(value) => setDraft({ ...draft, initialBalance: value })}
            inputMode="decimal"
            readOnly={balanceAutoDetected}
          />
        </div>

        {presetLocked && (
          <p className="rounded-lg border border-brand/20 bg-brand/5 px-2.5 py-2 text-[9px] leading-4 text-ink-muted">
            Preset quỹ được khóa theo phiên bản để không thể nới lỏng rule nhưng vẫn
            mang nhãn của nhà cung cấp. Chọn một mẫu cho phép tùy chỉnh nếu bạn cần
            một bộ rule riêng.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PercentField
            label="Lỗ tối đa/ngày"
            basisPoints={draft.rules.dailyLossLimitBasisPoints}
            disabled={presetLocked}
            onChange={(value) => patchRule(setDraft, "dailyLossLimitBasisPoints", value)}
          />
          <PercentField
            label="Lỗ tối đa tổng"
            basisPoints={draft.rules.maxLossLimitBasisPoints}
            disabled={presetLocked}
            onChange={(value) => patchRule(setDraft, "maxLossLimitBasisPoints", value)}
          />
          <PercentField
            label="Risk tối đa/lệnh"
            basisPoints={draft.rules.maxRiskPerTradeBasisPoints}
            disabled={presetLocked}
            onChange={(value) => patchRule(setDraft, "maxRiskPerTradeBasisPoints", value)}
          />
          <PercentField
            label="Tổng risk đang mở"
            basisPoints={draft.rules.maxTotalOpenRiskBasisPoints}
            disabled={presetLocked}
            onChange={(value) => patchRule(setDraft, "maxTotalOpenRiskBasisPoints", value)}
          />
          <PercentField
            label="Cảnh báo trước"
            basisPoints={draft.rules.warningBufferBasisPoints}
            disabled={presetLocked}
            onChange={(value) => patchRule(setDraft, "warningBufferBasisPoints", value)}
          />
          <PercentField
            label="Đóng khẩn cấp trước"
            basisPoints={draft.rules.emergencyBufferBasisPoints}
            disabled={presetLocked}
            onChange={(value) => patchRule(setDraft, "emergencyBufferBasisPoints", value)}
          />
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <PercentField
            label="Mục tiêu lợi nhuận ngày (tùy chọn)"
            basisPoints={draft.rules.dailyProfitTargetBasisPoints ?? null}
            allowEmpty
            disabled={presetLocked}
            onChange={(value) =>
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      rules: {
                        ...current.rules,
                        dailyProfitTargetBasisPoints: value || null,
                      },
                    }
                  : current,
              )
            }
          />
          <Field
            label="Múi giờ reset"
            value={draft.timezone}
            readOnly={presetLocked}
            onChange={(value) => setDraft({ ...draft, timezone: value })}
          />
        </div>

        <fieldset className="rounded-lg border border-terminal-border p-2.5">
          <legend className="px-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
            Tự động xử lý
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <ActionToggle
              label="Chặn lệnh mới"
              checked={draft.actions.blockNewOrders}
              disabled={presetLocked}
              onChange={(checked) => patchAction(setDraft, "blockNewOrders", checked)}
            />
            <ActionToggle
              label="Hủy toàn bộ pending"
              checked={draft.actions.cancelPendingOrders}
              disabled={presetLocked}
              onChange={(checked) =>
                patchAction(setDraft, "cancelPendingOrders", checked)
              }
            />
            <ActionToggle
              label="Đóng toàn bộ position"
              checked={draft.actions.closeOpenPositions}
              disabled={presetLocked}
              onChange={(checked) =>
                patchAction(setDraft, "closeOpenPositions", checked)
              }
            />
            <ActionToggle
              label="Fail closed khi mất dữ liệu"
              checked={draft.actions.failClosedOnStaleData}
              disabled={presetLocked}
              onChange={(checked) =>
                patchAction(setDraft, "failClosedOnStaleData", checked)
              }
            />
            <ActionToggle
              label="Bắt buộc stop loss"
              checked={draft.rules.requireStopLoss}
              disabled={presetLocked}
              onChange={(checked) => patchRule(setDraft, "requireStopLoss", checked)}
            />
            <ActionToggle
              label="Khóa khi đạt target ngày"
              checked={draft.actions.lockAfterProfitTarget}
              disabled={presetLocked}
              onChange={(checked) =>
                patchAction(setDraft, "lockAfterProfitTarget", checked)
              }
            />
          </div>
        </fieldset>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-[9px] leading-4 text-ink-faint">
            <Zap size={11} className="shrink-0 text-brand" aria-hidden="true" />
            Safety buffer chủ động đóng trước limit để chừa khoảng cho spread và slippage.
          </p>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-[10px] font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:opacity-60 focus-ring"
          >
            {saving ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}
            Lưu & tự động bảo vệ
          </button>
        </div>
        {error && (
          <p role="alert" className="text-[10px] text-bear">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

function RiskStatus({
  assignment,
  currency,
}: {
  assignment: PropRiskAssignment;
  currency: string;
}) {
  const evaluation = assignment.evaluation!;
  const locked = evaluation.status === "locked" || evaluation.status === "breached";
  const warning = evaluation.status === "warning";
  const Icon = locked ? LockKeyhole : warning ? AlertTriangle : ShieldCheck;
  const format = (value: number) =>
    new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 2,
    }).format(value);
  return (
    <div
      aria-live="polite"
      className={cn(
        "rounded-xl border p-2.5",
        locked
          ? "border-bear/30 bg-bear/5"
          : warning
            ? "border-amber-400/30 bg-amber-400/5"
            : "border-bull/25 bg-bull/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-[10px] font-semibold",
            locked ? "text-bear" : warning ? "text-amber-300" : "text-bull",
          )}
        >
          <Icon size={13} aria-hidden="true" />
          {locked ? "ĐÃ KHÓA GIAO DỊCH" : warning ? "CẢNH BÁO RỦI RO" : "ĐANG BẢO VỆ"}
        </span>
        <span className="text-[9px] text-ink-faint">{assignment.tradingDay}</span>
      </div>
      {evaluation.reason && (
        <p className="mt-1.5 text-[10px] text-ink-muted">
          {REASON_LABELS[evaluation.reason]}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <RiskMeter
          label="Còn lại hôm nay"
          value={evaluation.dailyLossRemaining}
          limit={evaluation.dailyLossLimit}
          floor={evaluation.equity - evaluation.dailyLossRemaining}
          format={format}
        />
        <RiskMeter
          label="Còn lại tổng"
          value={evaluation.maxLossRemaining}
          limit={evaluation.maxLossLimit}
          floor={evaluation.equity - evaluation.maxLossRemaining}
          format={format}
        />
      </div>
    </div>
  );
}

function RiskMeter({
  label,
  value,
  limit,
  floor,
  format,
}: {
  label: string;
  value: number;
  limit: number;
  floor: number;
  format: (value: number) => string;
}) {
  const ratio = limit > 0 ? Math.max(0, Math.min(1, value / limit)) : 0;
  return (
    <div className="rounded-lg bg-terminal-bg/70 p-2">
      <span className="text-[9px] text-ink-faint">{label}</span>
      <strong className="mt-0.5 block text-[11px] tabular-nums text-ink">
        {format(value)}
      </strong>
      <span className="mt-0.5 block text-[8px] tabular-nums text-ink-faint">
        Ngưỡng equity: {format(floor)}
      </span>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-terminal-border">
        <span
          className={cn(
            "block h-full rounded-full",
            ratio > 0.4 ? "bg-bull" : ratio > 0.15 ? "bg-amber-400" : "bg-bear",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal";
  readOnly?: boolean;
}) {
  return (
    <label className="space-y-1 text-[10px] text-ink-muted">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        readOnly={readOnly}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] tabular-nums text-ink outline-none read-only:text-ink-faint focus:border-brand focus-ring"
      />
    </label>
  );
}

function PercentField({
  label,
  basisPoints,
  onChange,
  allowEmpty,
  disabled,
}: {
  label: string;
  basisPoints: number | null;
  onChange: (basisPoints: number) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(
    basisPoints == null ? "" : String(basisPoints / 100),
  );
  useEffect(() => {
    setValue(basisPoints == null ? "" : String(basisPoints / 100));
  }, [basisPoints]);
  return (
    <label className="space-y-1 text-[10px] text-ink-muted">
      <span className="font-medium">{label}</span>
      <span className="relative block">
        <input
          value={value}
          inputMode="decimal"
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value;
            setValue(next);
            if (allowEmpty && next.trim() === "") {
              onChange(0);
              return;
            }
            const percent = Number(next);
            if (Number.isFinite(percent)) onChange(Math.round(percent * 100));
          }}
          className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 pr-7 text-[11px] tabular-nums text-ink outline-none disabled:cursor-not-allowed disabled:opacity-55 focus:border-brand focus-ring"
        />
        <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[10px] text-ink-faint">
          %
        </span>
      </span>
    </label>
  );
}

function ActionToggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex min-h-9 items-center gap-2 rounded-lg bg-terminal-bg/60 px-2 text-[10px] text-ink-muted",
        disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:text-ink",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-[var(--accent)]"
      />
      {label}
    </label>
  );
}

function draftFromGuard(
  guard: PropRiskGuard,
  account: ExecutionAccountSummary,
): GuardDraft | null {
  if (guard.assignment) {
    return {
      enabled: guard.assignment.enabled,
      profileId: guard.assignment.profileId,
      initialBalance: String(guard.assignment.initialBalance),
      timezone: guard.assignment.timezone,
      rules: { ...guard.assignment.rules },
      actions: { ...guard.assignment.actions },
    };
  }
  const profile = guard.profiles[0];
  if (!profile) return null;
  return {
    enabled: true,
    profileId: profile.id,
    initialBalance: String(
      resolveProfileInitialBalance(
        profile.capitalMode,
        profile.referenceBalances,
        account.balance ?? account.equity,
      ) ?? "",
    ),
    timezone: profile.timezone,
    rules: { ...profile.rules },
    actions: { ...profile.actions },
  };
}

function patchRule<K extends keyof PropRiskRules>(
  setDraft: Dispatch<SetStateAction<GuardDraft | null>>,
  key: K,
  value: PropRiskRules[K],
) {
  setDraft((current) =>
    current
      ? { ...current, rules: { ...current.rules, [key]: value } }
      : current,
  );
}

function patchAction<K extends keyof PropRiskActions>(
  setDraft: Dispatch<SetStateAction<GuardDraft | null>>,
  key: K,
  value: PropRiskActions[K],
) {
  setDraft((current) =>
    current
      ? { ...current, actions: { ...current.actions, [key]: value } }
      : current,
  );
}
