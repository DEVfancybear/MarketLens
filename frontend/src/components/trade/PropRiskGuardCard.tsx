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
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  Save,
  ShieldCheck,
  XCircle,
  Zap,
} from "lucide-react";
import {
  getExecutionPropRisk,
  updateExecutionPropRisk,
} from "@/services/api/resources/executionApi";
import { presentPropRiskHeadroom } from "@/services/execution/propRiskEvaluation";
import {
  findExactPropRiskProfile,
  resolveProfileInitialBalance,
} from "@/services/execution/propRiskProfile";
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

const DEFAULT_RULES: PropRiskRules = {
  dailyLossLimitBasisPoints: 500,
  maxLossLimitBasisPoints: 1_000,
  dailyLossReference: "startOfDayBalance",
  maxLossMode: "static",
  maxRiskPerTradeBasisPoints: 100,
  maxTotalOpenRiskBasisPoints: 300,
  requireStopLoss: true,
  warningBufferBasisPoints: 100,
  emergencyBufferBasisPoints: 50,
  dailyProfitTargetBasisPoints: null,
  profitTargetBasisPoints: null,
  bestDayLimitBasisPoints: null,
  minimumTradingDays: null,
};

const DEFAULT_ACTIONS: PropRiskActions = {
  blockNewOrders: true,
  cancelPendingOrders: true,
  closeOpenPositions: true,
  lockAfterProfitTarget: false,
  failClosedOnStaleData: true,
};

interface GuardDraft {
  enabled: boolean;
  profileId: string;
  initialBalance: string;
  providerCode: string;
  programCode: string;
  displayName: string;
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
    setAssignment(null);
    if (!accountId) return;

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

  const currentAssignment = assignment?.accountId === accountId ? assignment : null;
  const evaluation = currentAssignment?.evaluation;
  if (!currentAssignment?.enabled) return null;

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
            ? currentAssignment.displayName
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
    setGuard(null);
    setDraft(null);
    setLoading(true);
    setError(null);
    void getExecutionPropRisk(accountId)
      .then((next) => {
        if (!active) return;
        setGuard(next);
        setDraft(draftFromGuard(next));
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
  const assignment = guard?.assignment ?? null;
  const exactAssignedProfile = useMemo(
    () =>
      assignment && guard
        ? findExactPropRiskProfile(
            guard.profiles,
            assignment.profileId,
            assignment.profileVersion,
          )
        : undefined,
    [assignment, guard],
  );
  const legacyAssignment = Boolean(assignment && !exactAssignedProfile);
  const hasLoadedGuard = guard !== null;
  const profileGroups = useMemo(() => groupProfiles(guard?.profiles ?? []), [guard?.profiles]);

  useEffect(() => {
    if (!hasLoadedGuard || saving) return;
    let active = true;
    let timeoutId: number | undefined;

    const refresh = async () => {
      try {
        const next = await getExecutionPropRisk(accountId);
        if (active) setGuard(next);
      } catch {
        // Keep the last known guard and unsaved edits visible.
      } finally {
        if (active) timeoutId = window.setTimeout(() => void refresh(), 5_000);
      }
    };

    timeoutId = window.setTimeout(() => void refresh(), 5_000);
    return () => {
      active = false;
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
    };
  }, [accountId, hasLoadedGuard, saving]);

  const chooseProfile = (profile: PropRiskProfile) => {
    setDraft((current) => {
      const suggestedCapital = resolveProfileInitialBalance(
        profile.capitalMode,
        profile.referenceBalances,
        latestAccount.current.balance ?? latestAccount.current.equity,
      );
      return {
        enabled: current?.enabled ?? false,
        profileId: profile.id,
        initialBalance: String(suggestedCapital ?? current?.initialBalance ?? ""),
        providerCode: profile.providerCode,
        programCode: profile.programCode,
        displayName: profile.displayName,
        timezone: profile.timezone,
        rules: profile.rulesLocked
          ? mergeCatalogObjectivesWithLocalPolicy(profile.rules, current?.rules)
          : { ...profile.rules },
        actions: current?.actions ? { ...current.actions } : { ...profile.actions },
      };
    });
    setError(null);
  };

  const save = async () => {
    if (!draft || !selectedProfile) {
      setError("Hãy chọn đúng quỹ, chương trình và giai đoạn trước khi lưu.");
      return;
    }
    const initialBalance = Number(draft.initialBalance);
    if (!Number.isFinite(initialBalance) || initialBalance <= 0) {
      setError("Vốn gốc phải là một số dương và cần được bạn xác nhận.");
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
        displayName: draft.displayName,
        providerCode: draft.providerCode,
        programCode: draft.programCode,
      });
      setGuard(next);
      setDraft(draftFromGuard(next));
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
                Chọn đúng quỹ, chương trình và giai đoạn cho từng account. Guard áp dụng
                strategy từ catalog dữ liệu, không suy đoán giai đoạn từ broker hoặc login.
              </p>
            </div>
          </div>
          <label
            className={cn(
              "flex shrink-0 items-center gap-2 text-[10px] font-semibold",
              selectedProfile ? "cursor-pointer text-ink" : "cursor-not-allowed text-ink-faint",
            )}
          >
            <span>
              {!selectedProfile ? "Chưa cấu hình" : draft.enabled ? "Đang bật" : "Đang tắt"}
            </span>
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={!selectedProfile}
              onChange={(event) =>
                setDraft((current) =>
                  current ? { ...current, enabled: event.target.checked } : current,
                )
              }
              className="size-4 accent-(--accent)"
              aria-label="Bật bảo vệ tài khoản quỹ tự động"
            />
          </label>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {assignment?.evaluation && !legacyAssignment && (
          <RiskStatus assignment={assignment} currency={account.currency} />
        )}

        {assignment?.enabled && !assignment.evaluation && !legacyAssignment && (
          <Notice tone="warning">
            Đang chờ heartbeat đầu tiên để tạo trạng thái theo dõi. Trong thời gian này,
            lệnh mới được chặn an toàn nếu bật fail-closed.
          </Notice>
        )}

        {legacyAssignment && (
          <Notice tone="warning">
            Cấu hình cũ không khớp một phiên bản catalog đang hoạt động. Hệ thống không tự
            đổi sang giai đoạn khác; hãy chọn lại và xác nhận một lần cho account này.
          </Notice>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1 text-[10px] text-ink-muted">
            <span className="font-medium">Quỹ / chương trình / giai đoạn</span>
            <select
              value={draft.profileId}
              onChange={(event) => {
                const profile = guard.profiles.find(
                  (candidate) => candidate.id === event.target.value,
                );
                if (profile) chooseProfile(profile);
              }}
              disabled={guard.profiles.length === 0}
              className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] text-ink outline-hidden disabled:cursor-not-allowed disabled:opacity-60 focus:border-brand focus-ring"
            >
              <option value="">Chọn chương trình / giai đoạn</option>
              {profileGroups.map(([providerCode, profiles]) => (
                <optgroup key={providerCode} label={providerCode.toUpperCase()}>
                  {profiles.map((profile) => (
                    <option key={`${profile.id}:${profile.version}`} value={profile.id}>
                      {profile.displayName}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {selectedProfile?.capitalMode === "referenceBalances" ? (
            <CapitalSelect
              value={draft.initialBalance}
              balances={selectedProfile.referenceBalances}
              onChange={(value) => setDraft({ ...draft, initialBalance: value })}
            />
          ) : (
            <Field
              label="Vốn gốc chính xác"
              value={draft.initialBalance}
              onChange={(value) => setDraft({ ...draft, initialBalance: value })}
              inputMode="decimal"
              disabled={!selectedProfile}
            />
          )}
        </div>

        {guard.profiles.length === 0 && (
          <Notice tone="danger">
            Catalog profile chưa khả dụng. Guard không chọn profile mặc định và sẽ không bật.
          </Notice>
        )}

        {selectedProfile && (
          <>
            {selectedProfile.rulesLocked ? (
              <ProfileObjectiveSummary profile={selectedProfile} />
            ) : (
              <CustomProfileEditor draft={draft} setDraft={setDraft} />
            )}

            <LocalGuardPolicyEditor draft={draft} setDraft={setDraft} />

            <fieldset className="rounded-lg border border-terminal-border p-2.5">
              <legend className="px-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
                Tự động xử lý
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                <ActionToggle
                  label="Chặn lệnh mới"
                  checked={draft.actions.blockNewOrders}
                  onChange={(checked) => patchAction(setDraft, "blockNewOrders", checked)}
                />
                <ActionToggle
                  label="Hủy toàn bộ pending"
                  checked={draft.actions.cancelPendingOrders}
                  onChange={(checked) => patchAction(setDraft, "cancelPendingOrders", checked)}
                />
                <ActionToggle
                  label="Đóng toàn bộ position"
                  checked={draft.actions.closeOpenPositions}
                  onChange={(checked) => patchAction(setDraft, "closeOpenPositions", checked)}
                />
                <ActionToggle
                  label="Fail closed khi mất dữ liệu"
                  checked={draft.actions.failClosedOnStaleData}
                  onChange={(checked) =>
                    patchAction(setDraft, "failClosedOnStaleData", checked)
                  }
                />
                <ActionToggle
                  label="Bắt buộc Stop Loss"
                  checked={draft.rules.requireStopLoss}
                  onChange={(checked) => patchRule(setDraft, "requireStopLoss", checked)}
                />
                <ActionToggle
                  label="Khóa khi đạt target ngày cục bộ"
                  checked={draft.actions.lockAfterProfitTarget}
                  onChange={(checked) =>
                    patchAction(setDraft, "lockAfterProfitTarget", checked)
                  }
                />
              </div>
            </fieldset>
          </>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-1.5 text-[9px] leading-4 text-ink-faint">
            <Zap size={11} className="mt-0.5 shrink-0 text-brand" aria-hidden="true" />
            Rule của quỹ và policy bảo vệ cục bộ được lưu riêng theo account. Các số lịch sử
            trước lúc bật Guard không được giả định là dữ liệu chính thức.
          </p>
          <button
            type="button"
            disabled={saving || !selectedProfile}
            onClick={() => void save()}
            className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-[10px] font-semibold text-(--accent-contrast) hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 focus-ring"
          >
            {saving ? (
              <LoaderCircle size={13} className="animate-spin" />
            ) : (
              <Save size={13} />
            )}
            {legacyAssignment ? "Xác nhận & lưu" : "Lưu cấu hình"}
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

function ProfileObjectiveSummary({ profile }: { profile: PropRiskProfile }) {
  const rules = profile.rules;
  return (
    <div className="rounded-xl border border-brand/20 bg-brand/5 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-semibold text-ink">Objectives từ catalog v{profile.version}</p>
          <p className="mt-0.5 text-[9px] leading-4 text-ink-muted">
            Công thức được khóa theo phiên bản; policy an toàn bên dưới vẫn do bạn cấu hình.
          </p>
        </div>
        {profile.officialSourceUrl && (
          <a
            href={profile.officialSourceUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-[9px] text-brand hover:underline focus-ring"
          >
            Nguồn
            <ExternalLink size={10} />
          </a>
        )}
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        <RuleSummary
          label="Max Daily Loss"
          value={`${formatPercent(rules.dailyLossLimitBasisPoints)} · ${dailyReferenceLabel(rules.dailyLossReference)}`}
        />
        <RuleSummary
          label="Max Loss"
          value={`${formatPercent(rules.maxLossLimitBasisPoints)} · ${maxLossModeLabel(rules.maxLossMode)}`}
        />
        {rules.profitTargetBasisPoints != null && (
          <RuleSummary
            label="Profit Target"
            value={formatPercent(rules.profitTargetBasisPoints)}
          />
        )}
        {rules.bestDayLimitBasisPoints != null && (
          <RuleSummary
            label="Best Day"
            value={`Tối đa ${formatPercent(rules.bestDayLimitBasisPoints)} tổng ngày dương`}
          />
        )}
        {rules.minimumTradingDays != null && (
          <RuleSummary
            label="Minimum Trading Days"
            value={`${rules.minimumTradingDays} ngày`}
          />
        )}
        <RuleSummary label="Múi giờ reset" value={profile.timezone} />
      </div>
    </div>
  );
}

function CustomProfileEditor({
  draft,
  setDraft,
}: {
  draft: GuardDraft;
  setDraft: Dispatch<SetStateAction<GuardDraft | null>>;
}) {
  return (
    <fieldset className="space-y-2 rounded-xl border border-brand/20 bg-brand/5 p-2.5">
      <legend className="px-1 text-[9px] font-semibold uppercase tracking-wide text-brand">
        Profile tùy chỉnh
      </legend>
      <div className="grid gap-2 sm:grid-cols-3">
        <Field
          label="Tên hiển thị"
          value={draft.displayName}
          onChange={(value) => setDraft({ ...draft, displayName: value })}
        />
        <Field
          label="Mã quỹ"
          value={draft.providerCode}
          onChange={(value) => setDraft({ ...draft, providerCode: value.toLowerCase() })}
        />
        <Field
          label="Mã chương trình"
          value={draft.programCode}
          onChange={(value) => setDraft({ ...draft, programCode: value.toLowerCase() })}
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <PercentField
          label="Max Daily Loss"
          basisPoints={draft.rules.dailyLossLimitBasisPoints}
          onChange={(value) => patchRule(setDraft, "dailyLossLimitBasisPoints", value)}
        />
        <SelectField
          label="Mốc Daily Loss"
          value={draft.rules.dailyLossReference}
          options={[
            ["startOfDayBalance", "Balance đầu ngày"],
            ["initialBalance", "Vốn gốc"],
          ]}
          onChange={(value) =>
            patchRule(
              setDraft,
              "dailyLossReference",
              value as PropRiskRules["dailyLossReference"],
            )
          }
        />
        <PercentField
          label="Max Loss"
          basisPoints={draft.rules.maxLossLimitBasisPoints}
          onChange={(value) => patchRule(setDraft, "maxLossLimitBasisPoints", value)}
        />
        <SelectField
          label="Chiến lược Max Loss"
          value={draft.rules.maxLossMode}
          options={[
            ["static", "Static"],
            ["endOfDayTrailing", "EOD trailing"],
          ]}
          onChange={(value) =>
            patchRule(setDraft, "maxLossMode", value as PropRiskRules["maxLossMode"])
          }
        />
        <PercentField
          label="Profit Target (tùy chọn)"
          basisPoints={draft.rules.profitTargetBasisPoints ?? null}
          allowEmpty
          onChange={(value) =>
            patchRule(setDraft, "profitTargetBasisPoints", value || null)
          }
        />
        <PercentField
          label="Best Day tối đa (tùy chọn)"
          basisPoints={draft.rules.bestDayLimitBasisPoints ?? null}
          allowEmpty
          onChange={(value) =>
            patchRule(setDraft, "bestDayLimitBasisPoints", value || null)
          }
        />
        <IntegerField
          label="Minimum Trading Days (tùy chọn)"
          value={draft.rules.minimumTradingDays ?? null}
          onChange={(value) => patchRule(setDraft, "minimumTradingDays", value)}
        />
        <Field
          label="Múi giờ reset (IANA)"
          value={draft.timezone}
          onChange={(value) => setDraft({ ...draft, timezone: value })}
        />
      </div>
    </fieldset>
  );
}

function LocalGuardPolicyEditor({
  draft,
  setDraft,
}: {
  draft: GuardDraft;
  setDraft: Dispatch<SetStateAction<GuardDraft | null>>;
}) {
  return (
    <fieldset className="rounded-lg border border-terminal-border p-2.5">
      <legend className="px-1 text-[9px] font-semibold uppercase tracking-wide text-ink-faint">
        Policy bảo vệ cục bộ
      </legend>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <PercentField
          label="Risk tối đa/lệnh"
          basisPoints={draft.rules.maxRiskPerTradeBasisPoints}
          onChange={(value) => patchRule(setDraft, "maxRiskPerTradeBasisPoints", value)}
        />
        <PercentField
          label="Tổng risk đang mở"
          basisPoints={draft.rules.maxTotalOpenRiskBasisPoints}
          onChange={(value) => patchRule(setDraft, "maxTotalOpenRiskBasisPoints", value)}
        />
        <PercentField
          label="Cảnh báo trước"
          basisPoints={draft.rules.warningBufferBasisPoints}
          onChange={(value) => patchRule(setDraft, "warningBufferBasisPoints", value)}
        />
        <PercentField
          label="Đóng khẩn cấp trước"
          basisPoints={draft.rules.emergencyBufferBasisPoints}
          onChange={(value) => patchRule(setDraft, "emergencyBufferBasisPoints", value)}
        />
        <PercentField
          label="Target ngày cục bộ (tùy chọn)"
          basisPoints={draft.rules.dailyProfitTargetBasisPoints ?? null}
          allowEmpty
          onChange={(value) =>
            patchRule(setDraft, "dailyProfitTargetBasisPoints", value || null)
          }
        />
      </div>
    </fieldset>
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
  const format = createMoneyFormatter(currency);
  const initialBalance = assignment.initialBalance;

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

      <div className="mt-2 overflow-hidden rounded-lg border border-terminal-border bg-terminal-bg/45">
        <ObjectiveRow
          label={`Max Daily Loss: -${format(evaluation.dailyLossLimit)}`}
          result={formatMoneyResult(evaluation.dailyLossResult, initialBalance, format)}
          state={evaluation.dailyLossRemaining > 0 ? "pass" : "fail"}
        />
        <ObjectiveRow
          label={`Max Loss (${maxLossModeLabel(assignment.rules.maxLossMode)}): -${format(evaluation.maxLossLimit)}`}
          result={formatMoneyResult(evaluation.maxLossResult, initialBalance, format)}
          state={evaluation.maxLossRemaining > 0 ? "pass" : "fail"}
        />
        {evaluation.profitTarget != null && evaluation.profitTargetResult != null && (
          <ObjectiveRow
            label={`Profit Target: +${format(evaluation.profitTarget)}`}
            result={formatMoneyResult(evaluation.profitTargetResult, initialBalance, format)}
            state={evaluation.profitTargetMet ? "pass" : "pending"}
          />
        )}
        {assignment.rules.bestDayLimitBasisPoints != null && (
          <BestDayObjective assignment={assignment} format={format} />
        )}
        {evaluation.minimumTradingDays != null && (
          <ObjectiveRow
            label={`Minimum Trading Days: ${evaluation.minimumTradingDays}`}
            result={
              evaluation.tradingDays == null
                ? "Chờ dữ liệu xác thực"
                : `${evaluation.tradingDays} ngày`
            }
            state={
              evaluation.tradingDays == null
                ? "pending"
                : evaluation.tradingDays >= evaluation.minimumTradingDays
                  ? "pass"
                  : "pending"
            }
          />
        )}
      </div>

      {evaluation.historyQuality !== "authoritative" && (
        <p className="mt-2 flex items-start gap-1.5 text-[9px] leading-4 text-ink-faint">
          <CircleDashed size={11} className="mt-0.5 shrink-0" />
          Kết quả EOD trailing, Best Day và lịch sử chỉ gồm dữ liệu từ khi Guard được bật;
          không được xem là lịch sử chính thức trước thời điểm đó.
        </p>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <RiskMeter
          label="Headroom hôm nay"
          exceededLabel="Đã vượt hôm nay"
          value={evaluation.dailyLossRemaining}
          limit={evaluation.dailyLossLimit}
          floor={evaluation.equity - evaluation.dailyLossRemaining}
          format={format}
        />
        <RiskMeter
          label="Headroom tổng"
          exceededLabel="Đã vượt tổng"
          value={evaluation.maxLossRemaining}
          limit={evaluation.maxLossLimit}
          floor={evaluation.equity - evaluation.maxLossRemaining}
          format={format}
        />
      </div>
    </div>
  );
}

function BestDayObjective({
  assignment,
  format,
}: {
  assignment: PropRiskAssignment;
  format: (value: number) => string;
}) {
  const evaluation = assignment.evaluation!;
  const total = evaluation.positiveDaysProfit ?? 0;
  const best = evaluation.bestDayProfit ?? 0;
  const other = Math.max(0, total - best);
  const hasData = total > 0 && evaluation.bestDayRatioBasisPoints != null;
  const ratio = hasData ? (evaluation.bestDayRatioBasisPoints ?? 0) / 100 : 0;

  return (
    <div className="grid gap-2 border-t border-terminal-border px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(150px,1.2fr)_auto] sm:items-center">
      <div>
        <span className="block text-[9px] font-medium text-ink">
          Best Day: tối đa {formatPercent(assignment.rules.bestDayLimitBasisPoints ?? 0)}
        </span>
        <span className="mt-0.5 block text-[8px] text-ink-faint">
          {hasData ? `${ratio.toFixed(2)}% tổng ngày dương` : "Chờ ngày dương"}
        </span>
      </div>
      <div>
        <span className="flex h-1.5 overflow-hidden rounded-full bg-terminal-border">
          {total > 0 && (
            <>
              <span
                className="bg-brand"
                style={{ width: `${Math.min(100, (best / total) * 100)}%` }}
              />
              <span className="flex-1 bg-bull/70" />
            </>
          )}
        </span>
        <span className="mt-1 flex justify-between gap-2 text-[8px] tabular-nums text-ink-faint">
          <span>Best: {format(best)}</span>
          <span>Ngày dương khác: {format(other)}</span>
        </span>
      </div>
      <ObjectiveStateIcon
        state={!hasData ? "pending" : evaluation.bestDayMet ? "pass" : "pending"}
      />
    </div>
  );
}

function ObjectiveRow({
  label,
  result,
  state,
}: {
  label: string;
  result: string;
  state: ObjectiveState;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-terminal-border px-2.5 py-2 first:border-t-0">
      <span className="min-w-0 text-[9px] font-medium text-ink">{label}</span>
      <span className="text-right text-[9px] tabular-nums text-ink-muted">{result}</span>
      <ObjectiveStateIcon state={state} />
    </div>
  );
}

type ObjectiveState = "pass" | "fail" | "pending";

function ObjectiveStateIcon({ state }: { state: ObjectiveState }) {
  if (state === "pass") {
    return <CheckCircle2 size={14} className="text-bull" aria-label="Đạt" />;
  }
  if (state === "fail") {
    return <XCircle size={14} className="text-bear" aria-label="Vi phạm" />;
  }
  return <CircleDashed size={14} className="text-amber-300" aria-label="Chưa đạt" />;
}

function RiskMeter({
  label,
  exceededLabel,
  value,
  limit,
  floor,
  format,
}: {
  label: string;
  exceededLabel: string;
  value: number;
  limit: number;
  floor: number;
  format: (value: number) => string;
}) {
  const presentation = presentPropRiskHeadroom(value, limit);
  return (
    <div className="rounded-lg bg-terminal-bg/70 p-2">
      <span className="text-[9px] text-ink-faint">
        {presentation.exceeded ? exceededLabel : label}
      </span>
      <strong
        className={cn(
          "mt-0.5 block text-[11px] tabular-nums",
          presentation.exceeded ? "text-bear" : "text-ink",
        )}
      >
        {format(presentation.displayValue)}
      </strong>
      <span className="mt-0.5 block text-[8px] tabular-nums text-ink-faint">
        Ngưỡng equity: {format(floor)}
      </span>
      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-terminal-border">
        <span
          className={cn(
            "block h-full rounded-full",
            presentation.ratio > 0.4
              ? "bg-bull"
              : presentation.ratio > 0.15
                ? "bg-amber-400"
                : "bg-bear",
          )}
          style={{ width: `${presentation.ratio * 100}%` }}
        />
      </span>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "warning" | "danger";
}) {
  return (
    <p
      role={tone === "danger" ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-2.5 text-[10px] leading-4",
        tone === "danger"
          ? "border-bear/30 bg-bear/5 text-bear"
          : "border-amber-400/30 bg-amber-400/5 text-amber-200",
      )}
    >
      <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

function RuleSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-terminal-bg/60 px-2 py-1.5">
      <span className="block text-[8px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span className="mt-0.5 block text-[9px] font-medium text-ink">{value}</span>
    </div>
  );
}

function CapitalSelect({
  value,
  balances,
  onChange,
}: {
  value: string;
  balances: readonly number[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-[10px] text-ink-muted">
      <span className="font-medium">Vốn gốc (gợi ý, cần xác nhận)</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] tabular-nums text-ink outline-hidden focus:border-brand focus-ring"
      >
        <option value="">Chọn vốn gốc</option>
        {balances.map((balance) => (
          <option key={balance} value={balance}>
            {new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(balance)}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({
  label,
  value,
  onChange,
  inputMode,
  readOnly,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: "decimal";
  readOnly?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="space-y-1 text-[10px] text-ink-muted">
      <span className="font-medium">{label}</span>
      <input
        value={value}
        inputMode={inputMode}
        readOnly={readOnly}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] tabular-nums text-ink outline-hidden read-only:text-ink-faint disabled:cursor-not-allowed disabled:opacity-55 focus:border-brand focus-ring"
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="space-y-1 text-[10px] text-ink-muted">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] text-ink outline-hidden focus:border-brand focus-ring"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function IntegerField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [textValue, setTextValue] = useState(value == null ? "" : String(value));
  useEffect(() => {
    setTextValue(value == null ? "" : String(value));
  }, [value]);
  return (
    <label className="space-y-1 text-[10px] text-ink-muted">
      <span className="font-medium">{label}</span>
      <input
        value={textValue}
        inputMode="numeric"
        onChange={(event) => {
          const next = event.target.value;
          setTextValue(next);
          if (next.trim() === "") {
            onChange(null);
            return;
          }
          const parsed = Number(next);
          if (Number.isInteger(parsed)) onChange(parsed);
        }}
        className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 text-[11px] tabular-nums text-ink outline-hidden focus:border-brand focus-ring"
      />
    </label>
  );
}

function PercentField({
  label,
  basisPoints,
  onChange,
  allowEmpty,
}: {
  label: string;
  basisPoints: number | null;
  onChange: (basisPoints: number) => void;
  allowEmpty?: boolean;
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
          className="h-10 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2 pr-7 text-[11px] tabular-nums text-ink outline-hidden focus:border-brand focus-ring"
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
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg bg-terminal-bg/60 px-2 text-[10px] text-ink-muted hover:text-ink">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-3.5 accent-(--accent)"
      />
      {label}
    </label>
  );
}

function draftFromGuard(guard: PropRiskGuard): GuardDraft {
  if (guard.assignment) {
    const exactProfile = findExactPropRiskProfile(
      guard.profiles,
      guard.assignment.profileId,
      guard.assignment.profileVersion,
    );
    return {
      enabled: exactProfile ? guard.assignment.enabled : false,
      profileId: exactProfile ? guard.assignment.profileId : "",
      initialBalance: String(guard.assignment.initialBalance),
      providerCode: guard.assignment.providerCode,
      programCode: guard.assignment.programCode,
      displayName: guard.assignment.displayName,
      timezone: guard.assignment.timezone,
      rules: { ...guard.assignment.rules },
      actions: { ...guard.assignment.actions },
    };
  }

  return {
    enabled: false,
    profileId: "",
    initialBalance: "",
    providerCode: "custom",
    programCode: "custom",
    displayName: "Quỹ tùy chỉnh",
    timezone: "UTC",
    rules: { ...DEFAULT_RULES },
    actions: { ...DEFAULT_ACTIONS },
  };
}

function mergeCatalogObjectivesWithLocalPolicy(
  catalogRules: PropRiskRules,
  currentRules?: PropRiskRules,
): PropRiskRules {
  if (!currentRules) return { ...catalogRules };
  return {
    ...catalogRules,
    maxRiskPerTradeBasisPoints: currentRules.maxRiskPerTradeBasisPoints,
    maxTotalOpenRiskBasisPoints: currentRules.maxTotalOpenRiskBasisPoints,
    requireStopLoss: currentRules.requireStopLoss,
    warningBufferBasisPoints: currentRules.warningBufferBasisPoints,
    emergencyBufferBasisPoints: currentRules.emergencyBufferBasisPoints,
    dailyProfitTargetBasisPoints: currentRules.dailyProfitTargetBasisPoints ?? null,
  };
}

function groupProfiles(
  profiles: readonly PropRiskProfile[],
): Array<[string, PropRiskProfile[]]> {
  const groups = new Map<string, PropRiskProfile[]>();
  for (const profile of profiles) {
    const group = groups.get(profile.providerCode) ?? [];
    group.push(profile);
    groups.set(profile.providerCode, group);
  }
  return Array.from(groups.entries());
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

function createMoneyFormatter(currency: string) {
  const formatter = new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: currency || "USD",
    maximumFractionDigits: 2,
  });
  return (value: number) => formatter.format(value);
}

function formatMoneyResult(
  value: number,
  initialBalance: number,
  format: (value: number) => string,
) {
  const percentage = initialBalance > 0 ? (value / initialBalance) * 100 : 0;
  return `${format(value)} (${percentage.toFixed(1)}%)`;
}

function formatPercent(basisPoints: number) {
  return `${basisPoints / 100}%`;
}

function dailyReferenceLabel(reference: PropRiskRules["dailyLossReference"]) {
  return reference === "startOfDayBalance" ? "balance đầu ngày" : "vốn gốc";
}

function maxLossModeLabel(mode: PropRiskRules["maxLossMode"]) {
  return mode === "endOfDayTrailing" ? "EOD trailing" : "static";
}
