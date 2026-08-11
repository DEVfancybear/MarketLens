"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Activity,
  AlertCircle,
  Archive,
  ChevronDown,
  CirclePause,
  Link2,
  LoaderCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import {
  getContinuousCopyGroups,
  runContinuousCopyGroupAction,
  saveContinuousCopyGroup,
} from "@/services/api/resources/executionApi";
import {
  buildContinuousCopyGroupRequest,
  continuousCopyAllocationValue,
  continuousCopyGroupViewToDraft,
  createContinuousCopyGroupDraft,
  ensureContinuousCopyTargets,
  validateContinuousCopyGroupDraft,
  type ContinuousCopyGroupDraft,
} from "@/services/execution/continuousCopier";
import {
  executionAccountsAtom,
  selectedExecutionAccountIdAtom,
} from "@/store/executionRegistryStore";
import { pushToastAtom } from "@/store/toastStore";
import { usePlatformDialog } from "@/components/ui/PlatformDialog";
import type {
  ContinuousCopyAllocation,
  ContinuousCopyConfig,
  ContinuousCopyGroupAction,
  ContinuousCopyGroupRuntimeStatus,
  ContinuousCopyGroupView,
  ContinuousCopyProtectionConfig,
  ContinuousCopyTargetRuntimeStatus,
  ContinuousCopyTargetWrite,
  ExecutionAccountSummary,
} from "@/types/execution";
import { cn } from "@/utils/cn";
import { useI18n } from "@/hooks/useI18n";
import type { Translate, TranslationKey } from "@/i18n/localization";

type RequestStatus = "idle" | "loading" | "saving" | "acting" | "error";

export function ContinuousCopierPanel() {
  const { t } = useI18n();
  const accounts = useAtomValue(executionAccountsAtom);
  const selectedAccountId = useAtomValue(selectedExecutionAccountIdAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const { requestConfirm, dialog } = usePlatformDialog();
  const [groups, setGroups] = useState<ContinuousCopyGroupView[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ContinuousCopyGroupDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [status, setStatus] = useState<RequestStatus>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [archiveArmed, setArchiveArmed] = useState(false);
  const initialLoadStartedRef = useRef(false);
  const mutationInFlightRef = useRef(false);

  const selectedView = groups.find(
    (view) => view.group.id === selectedGroupId,
  );
  const signature = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = Boolean(draft && baseline && signature !== baseline);

  const installView = useCallback(
    (view: ContinuousCopyGroupView) => {
      const nextDraft = continuousCopyGroupViewToDraft(view, accounts);
      setGroups((current) => [
        view,
        ...current.filter((item) => item.group.id !== view.group.id),
      ]);
      setSelectedGroupId(view.group.id);
      setDraft(nextDraft);
      setBaseline(JSON.stringify(nextDraft));
      setMessage(null);
      setArchiveArmed(false);
    },
    [accounts],
  );

  const refresh = useCallback(
    async (resetSelection: boolean) => {
      if (!resetSelection && mutationInFlightRef.current) return;
      if (resetSelection) setStatus("loading");
      try {
        const next = await getContinuousCopyGroups();
        // Do not let a poll that started before a mutation replace the newer
        // response or make the editor appear idle while approval is pending.
        if (!resetSelection && mutationInFlightRef.current) return;
        setGroups(next);
        setStatus("idle");
        if (resetSelection) setMessage(null);
        if (!resetSelection) return;
        const preferred =
          next.find((item) => item.group.sourceAccountId === selectedAccountId) ??
          next[0];
        if (preferred) {
          const nextDraft = continuousCopyGroupViewToDraft(preferred, accounts);
          setSelectedGroupId(preferred.group.id);
          setDraft(nextDraft);
          setBaseline(JSON.stringify(nextDraft));
        } else {
          const nextDraft = createContinuousCopyGroupDraft(
            accounts,
            selectedAccountId,
          );
          setSelectedGroupId(null);
          setDraft(nextDraft);
          setBaseline(JSON.stringify(nextDraft));
        }
      } catch {
        if (!resetSelection) return;
        setStatus("error");
        setMessage(t("copier.continuous.unavailable"));
      }
    },
    [accounts, selectedAccountId, t],
  );

  useEffect(() => {
    if (initialLoadStartedRef.current) return;
    initialLoadStartedRef.current = true;
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!draft || dirty || accounts.length === 0) return;
    const next = draft.group.sourceAccountId
      ? ensureContinuousCopyTargets(draft, accounts)
      : createContinuousCopyGroupDraft(accounts, selectedAccountId);
    const nextSignature = JSON.stringify(next);
    if (nextSignature === signature) return;
    setDraft(next);
    setBaseline(nextSignature);
  }, [accounts, dirty, draft, selectedAccountId, signature]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(false), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const confirmDiscard = useCallback(
    async (description: string) =>
      !dirty ||
      requestConfirm({
        title: t("copier.continuous.unsaved"),
        description,
        confirmLabel: t("copier.continuous.discard"),
        cancelLabel: t("copier.continuous.cancel"),
        tone: "danger",
      }),
    [dirty, requestConfirm, t],
  );

  const selectView = async (view: ContinuousCopyGroupView) => {
    if (
      !(await confirmDiscard(
        t("copier.continuous.confirm.open"),
      ))
    ) {
      return;
    }
    installView(view);
  };

  const createGroup = async () => {
    if (
      !(await confirmDiscard(
        t("copier.continuous.confirm.create"),
      ))
    ) {
      return;
    }
    const nextDraft = createContinuousCopyGroupDraft(accounts, selectedAccountId);
    setSelectedGroupId(null);
    setDraft(nextDraft);
    setBaseline(JSON.stringify(nextDraft));
    setMessage(null);
    setArchiveArmed(false);
  };

  const refreshFromServer = async () => {
    if (
      !(await confirmDiscard(
        t("copier.continuous.confirm.refresh"),
      ))
    ) {
      return;
    }
    await refresh(true);
  };

  const save = async () => {
    if (!draft) return;
    const validation = validateContinuousCopyGroupDraft(draft);
    if (validation.length) {
      setMessage(
        validation
          .map((item) => localizeContinuousValidation(t, item))
          .join(" "),
      );
      return;
    }
    mutationInFlightRef.current = true;
    setStatus("saving");
    setMessage(null);
    try {
      const saved = await saveContinuousCopyGroup(
        buildContinuousCopyGroupRequest(draft),
      );
      installView(saved);
      setStatus("idle");
      pushToast({
        title: draft.groupId
          ? t("copier.continuous.toast.updated")
          : t("copier.continuous.toast.created"),
        message: t("copier.continuous.toast.saved"),
        variant: "success",
      });
    } catch {
      setStatus("error");
      setMessage(
        t("copier.continuous.saveError"),
      );
    } finally {
      mutationInFlightRef.current = false;
    }
  };

  const runAction = async (action: ContinuousCopyGroupAction) => {
    if (!selectedView) return;
    mutationInFlightRef.current = true;
    setStatus("acting");
    setMessage(null);
    try {
      const saved = await runContinuousCopyGroupAction({
        groupId: selectedView.group.id,
        expectedRevision: selectedView.group.revision,
        action,
      });
      installView(saved);
      setStatus("idle");
      pushToast({
        title: t(continuousActionTitleKey(action)),
        message:
          action === "reconcile"
            ? t("copier.continuous.toast.reconcileMessage")
            : t("copier.continuous.toast.actionMessage"),
        variant: "success",
      });
    } catch {
      setStatus("error");
      setMessage(t("copier.continuous.actionError"));
    } finally {
      mutationInFlightRef.current = false;
    }
  };

  if (status === "loading" && !draft) {
    return (
      <div className="grid min-h-64 place-items-center" aria-live="polite">
        <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
          <LoaderCircle size={15} className="animate-spin motion-reduce:animate-none" />
          {t("copier.continuous.loading")}
        </span>
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto p-3 sm:p-4">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-3 border-b border-terminal-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-ink">
                {t("copier.continuous.title")}
              </h2>
              <span className="rounded-md border border-bull/25 bg-bull/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide text-bull">
                {t("copier.continuous.badge")}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-[10px] leading-4 text-ink-muted sm:text-[11px] sm:leading-5">
              {t("copier.continuous.description")}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshFromServer()}
            disabled={status === "loading" || status === "saving" || status === "acting"}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-terminal-border-strong px-3 text-[10px] font-semibold text-ink-muted transition-colors hover:border-brand/45 hover:text-brand disabled:opacity-45 focus-ring sm:min-h-9"
          >
            <RefreshCw size={13} aria-hidden="true" />
            {t("copier.continuous.refresh")}
          </button>
        </header>

        {message && (
          <div
            role="alert"
            className="mt-3 flex gap-2 rounded-xl border border-bear/25 bg-bear/5 p-3 text-[10px] leading-4 text-bear"
          >
            <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}

        <div className="mt-4 grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
          <aside aria-label={t("copier.continuous.groupsAria")} className="min-w-0">
            <div className="flex items-center justify-between gap-3">
              <div>
                <strong className="block text-[11px] text-ink">
                  {t("copier.continuous.groups")}
                </strong>
                <span className="text-[9px] text-ink-faint">
                  {t("copier.continuous.groupCount", { count: groups.length })}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void createGroup()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand px-3 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 focus-ring sm:min-h-9"
              >
                <Plus size={13} aria-hidden="true" />
                {t("copier.continuous.new")}
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
              {groups.map((view) => {
                const account = accounts.find(
                  (item) => item.id === view.group.sourceAccountId,
                );
                const active = view.group.id === selectedGroupId;
                return (
                  <button
                    key={view.group.id}
                    type="button"
                    onClick={() => void selectView(view)}
                    aria-pressed={active}
                    className={cn(
                      "min-h-[76px] rounded-xl border p-3 text-left transition-colors focus-ring",
                      active
                        ? "border-brand/45 bg-brand/10"
                        : "border-terminal-border bg-terminal-panel-2/45 hover:border-terminal-border-strong",
                    )}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <strong className="truncate text-[11px] text-ink">
                        {view.group.name}
                      </strong>
                      <RuntimeBadge status={view.group.runtimeStatus} />
                    </span>
                    <span className="mt-1 block truncate text-[9px] text-ink-faint">
                      {t("copier.continuous.source", {
                        account: account?.label ?? view.group.sourceAccountId,
                      })}
                    </span>
                    <span className="mt-2 flex items-center gap-3 text-[8px] uppercase tracking-wide text-ink-faint">
                      <span>{t("copier.continuous.links", { count: view.activeLinks })}</span>
                      <span>{t("copier.continuous.queued", { count: view.pendingWork })}</span>
                      <span className={view.unresolvedErrors ? "text-bear" : undefined}>
                        {t("copier.continuous.errors", { count: view.unresolvedErrors })}
                      </span>
                    </span>
                  </button>
                );
              })}
              {groups.length === 0 && (
                <div className="rounded-xl border border-dashed border-terminal-border-strong bg-terminal-panel-2/25 p-4 text-[10px] leading-4 text-ink-faint sm:col-span-2 xl:col-span-1">
                  {t("copier.continuous.emptyGroups")}
                </div>
              )}
            </div>
          </aside>

          {draft ? (
            <CopierGroupEditor
              draft={draft}
              view={selectedView}
              accounts={accounts}
              dirty={dirty}
              busy={status === "loading" || status === "saving" || status === "acting"}
              archiveArmed={archiveArmed}
              onArchiveArmed={setArchiveArmed}
              onChange={setDraft}
              onSave={() => void save()}
              onDiscard={() => {
                if (selectedView) installView(selectedView);
                else void createGroup();
              }}
              onAction={(action) => void runAction(action)}
            />
          ) : (
            <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-terminal-border-strong text-xs text-ink-faint">
              {t("copier.continuous.selectGroup")}
            </div>
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
}

function CopierGroupEditor({
  draft,
  view,
  accounts,
  dirty,
  busy,
  archiveArmed,
  onArchiveArmed,
  onChange,
  onSave,
  onDiscard,
  onAction,
}: {
  draft: ContinuousCopyGroupDraft;
  view?: ContinuousCopyGroupView;
  accounts: ExecutionAccountSummary[];
  dirty: boolean;
  busy: boolean;
  archiveArmed: boolean;
  onArchiveArmed: (armed: boolean) => void;
  onChange: (draft: ContinuousCopyGroupDraft) => void;
  onSave: () => void;
  onDiscard: () => void;
  onAction: (action: ContinuousCopyGroupAction) => void;
}) {
  const { t } = useI18n();
  const setGroup = (patch: Partial<ContinuousCopyGroupDraft["group"]>) =>
    onChange({ ...draft, group: { ...draft.group, ...patch } });
  const setConfig = (patch: Partial<ContinuousCopyConfig>) =>
    setGroup({ config: { ...draft.group.config, ...patch } });
  const setTarget = (next: ContinuousCopyTargetWrite) =>
    onChange({
      ...draft,
      targets: draft.targets.map((target) =>
        target.accountId === next.accountId ? next : target,
      ),
    });
  const source = accounts.find(
    (account) => account.id === draft.group.sourceAccountId,
  );

  return (
    <section className="min-w-0 rounded-xl border border-terminal-border bg-terminal-panel-2/30">
      <div className="flex flex-col gap-3 border-b border-terminal-border p-3 sm:flex-row sm:items-start sm:justify-between sm:p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="truncate text-xs text-ink">
              {draft.groupId
                ? draft.group.name
                : t("copier.continuous.newGroup")}
            </strong>
            {view ? (
              <RuntimeBadge status={view.group.runtimeStatus} />
            ) : (
              <span className="rounded-md bg-brand/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-brand">
                {t("copier.continuous.draft")}
              </span>
            )}
            {dirty && (
              <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[8px] font-semibold uppercase text-amber-300">
                {t("copier.continuous.unsaved")}
              </span>
            )}
          </div>
          <p className="mt-1 text-[9px] leading-4 text-ink-faint">
            {source
              ? t("copier.continuous.sourceAuthority", {
                  account: source.label,
                })
              : t("copier.continuous.chooseAuthority")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={busy}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-terminal-border-strong px-3 text-[10px] font-semibold text-ink-muted hover:text-ink disabled:opacity-45 focus-ring sm:min-h-9"
            >
              <RotateCcw size={12} aria-hidden="true" />
              {t("copier.continuous.discard")}
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            disabled={busy || !dirty}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-brand px-3 text-[10px] font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45 focus-ring sm:min-h-9"
          >
            {busy ? (
              <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" />
            ) : (
              <Save size={12} aria-hidden="true" />
            )}
            {t("copier.continuous.save")}
          </button>
        </div>
      </div>

      {view && (
        <div className="grid grid-cols-3 border-b border-terminal-border">
          <ActivityMetric
            icon={<Link2 size={13} />}
            label={t("copier.continuous.metric.links")}
            value={view.activeLinks}
          />
          <ActivityMetric
            icon={<Activity size={13} />}
            label={t("copier.continuous.metric.work")}
            value={view.pendingWork}
          />
          <ActivityMetric
            icon={<AlertCircle size={13} />}
            label={t("copier.continuous.metric.errors")}
            value={view.unresolvedErrors}
            alert={view.unresolvedErrors > 0}
          />
        </div>
      )}

      <div className="space-y-4 p-3 sm:p-4">
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="sr-only">{t("copier.continuous.identity")}</legend>
          <Field
            label={t("copier.continuous.groupName")}
            description={t("copier.continuous.groupNameDescription")}
          >
            <input
              value={draft.group.name}
              onChange={(event) => setGroup({ name: event.target.value })}
              maxLength={120}
              required
              className={inputClass}
            />
          </Field>
          <Field
            label={t("copier.continuous.sourceAccount")}
            description={t("copier.continuous.sourceAccountDescription")}
          >
            <select
              value={draft.group.sourceAccountId}
              disabled={busy || Boolean(view?.activeLinks)}
              onChange={(event) => {
                const group = {
                  ...draft.group,
                  sourceAccountId: event.target.value,
                };
                onChange(
                  ensureContinuousCopyTargets({ ...draft, group }, accounts),
                );
              }}
              className={inputClass}
            >
              <option value="">{t("copier.continuous.selectSource")}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.label} - {account.brokerCode} - {localizeAccountStatus(t, account.status)}
                </option>
              ))}
            </select>
          </Field>
        </fieldset>

        <fieldset className="rounded-xl border border-terminal-border bg-terminal-panel/45 p-3">
          <legend className="px-1 text-[10px] font-semibold text-ink">
            {t("copier.continuous.coverage")}
          </legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Toggle
              label={t("copier.continuous.market")}
              description={t("copier.continuous.marketDescription")}
              checked={draft.group.config.copyMarketOrders}
              onChange={(checked) => setConfig({ copyMarketOrders: checked })}
            />
            <Toggle
              label={t("copier.continuous.pending")}
              description={t("copier.continuous.pendingDescription")}
              checked={draft.group.config.copyPendingOrders}
              onChange={(checked) => setConfig({ copyPendingOrders: checked })}
            />
            <Toggle
              label={t("copier.continuous.sltp")}
              description={t("copier.continuous.sltpDescription")}
              checked={draft.group.config.copyStopLossTakeProfit}
              onChange={(checked) =>
                setConfig({ copyStopLossTakeProfit: checked })
              }
            />
            <Toggle
              label={t("copier.continuous.modifications")}
              description={t("copier.continuous.modificationsDescription")}
              checked={draft.group.config.copyModifications}
              onChange={(checked) => setConfig({ copyModifications: checked })}
            />
            <Toggle
              label={t("copier.continuous.partialCloses")}
              description={t("copier.continuous.partialClosesDescription")}
              checked={draft.group.config.copyPartialCloses}
              onChange={(checked) => setConfig({ copyPartialCloses: checked })}
            />
            <Toggle
              label={t("copier.continuous.enabled")}
              description={
                view?.activeLinks
                  ? t("copier.continuous.enabledLinkedDescription")
                  : t("copier.continuous.enabledDraftDescription")
              }
              checked={draft.group.enabled}
              disabled={Boolean(view?.activeLinks)}
              onChange={(enabled) => setGroup({ enabled })}
            />
          </div>
        </fieldset>

        <details className="group rounded-xl border border-terminal-border bg-terminal-panel/45">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3 focus-ring">
            <span className="inline-flex items-center gap-2 text-[10px] font-semibold text-ink">
              <SlidersHorizontal size={13} className="text-brand" />
              {t("copier.continuous.filters")}
            </span>
            <ChevronDown size={14} className="text-ink-faint transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <div className="grid gap-3 border-t border-terminal-border p-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field
              label={t("copier.continuous.magic")}
              description={t("copier.continuous.magicDescription")}
            >
              <input
                type="number"
                step="1"
                value={draft.group.config.sourceMagicFilter ?? ""}
                onChange={(event) =>
                  setConfig({
                    sourceMagicFilter: event.target.value
                      ? Number(event.target.value)
                      : undefined,
                  })
                }
                placeholder={t("copier.continuous.anyMagic")}
                className={inputClass}
              />
            </Field>
            <Field
              label={t("copier.continuous.commentPrefix")}
              description={t("copier.continuous.commentDescription")}
            >
              <input
                value={draft.group.config.sourceCommentPrefix ?? ""}
                onChange={(event) =>
                  setConfig({ sourceCommentPrefix: event.target.value || undefined })
                }
                placeholder={t("copier.continuous.commentPlaceholder")}
                className={inputClass}
              />
            </Field>
            <Field label={t("copier.continuous.maxSlippage")} suffix="points">
              <IntegerInput
                value={draft.group.config.maxSlippagePoints}
                onChange={(maxSlippagePoints) => setConfig({ maxSlippagePoints })}
              />
            </Field>
            <Field label={t("copier.continuous.staleWindow")} suffix="ms">
              <IntegerInput
                value={draft.group.config.staleAfterMs}
                min={1}
                onChange={(staleAfterMs) => setConfig({ staleAfterMs })}
              />
            </Field>
            <Field label={t("copier.continuous.reconcileInterval")} suffix="ms">
              <IntegerInput
                value={draft.group.config.reconciliationIntervalMs}
                min={1}
                onChange={(reconciliationIntervalMs) =>
                  setConfig({ reconciliationIntervalMs })
                }
              />
            </Field>
          </div>
        </details>

        <fieldset>
          <legend className="text-[10px] font-semibold text-ink">
            {t("copier.continuous.followers")}
          </legend>
          <p className="mt-1 text-[9px] leading-4 text-ink-faint">
            {t("copier.continuous.followersDescription")}
          </p>
          <div className="mt-2 space-y-2">
            {draft.targets.map((target) => {
              const account = accounts.find((item) => item.id === target.accountId);
              const serverTarget = view?.targets.find(
                (item) => item.accountId === target.accountId,
              );
              return (
                <FollowerEditor
                  key={target.accountId}
                  target={target}
                  account={account}
                  runtimeStatus={serverTarget?.runtimeStatus}
                  statusMessage={serverTarget?.statusMessage}
                  membershipLocked={Boolean(view?.activeLinks)}
                  onChange={setTarget}
                />
              );
            })}
            {draft.targets.length === 0 && (
              <div className="rounded-xl border border-dashed border-terminal-border-strong p-5 text-center text-[10px] leading-4 text-ink-faint">
                {t("copier.continuous.noFollowers")}
              </div>
            )}
          </div>
        </fieldset>

        {view && (
          <fieldset className="rounded-xl border border-terminal-border bg-terminal-panel/45 p-3">
            <legend className="px-1 text-[10px] font-semibold text-ink">
              {t("copier.continuous.runtimeControls")}
            </legend>
            <p className="text-[9px] leading-4 text-ink-faint">
              {t("copier.continuous.runtimeDescription")}
            </p>
            {view.group.statusMessage && (
              <p className="mt-2 rounded-lg bg-terminal-panel-2 px-2.5 py-2 text-[9px] text-ink-muted">
                {view.group.statusMessage}
              </p>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              {view.group.runtimeStatus === "paused" || !view.group.enabled ? (
                <ActionButton
                  icon={<Zap size={12} />}
                  label={t("copier.continuous.resume")}
                  disabled={busy || dirty}
                  onClick={() => onAction("resume")}
                />
              ) : (
                <ActionButton
                  icon={<CirclePause size={12} />}
                  label={t("copier.continuous.pause")}
                  disabled={busy || dirty}
                  onClick={() => onAction("pause")}
                />
              )}
              <ActionButton
                icon={<RefreshCw size={12} />}
                label={t("copier.continuous.reconcile")}
                disabled={busy || dirty}
                onClick={() => onAction("reconcile")}
              />
              {archiveArmed ? (
                <>
                  <ActionButton
                    icon={<Archive size={12} />}
                    label={t("copier.continuous.confirmArchive")}
                    danger
                    disabled={busy || dirty || view.activeLinks > 0}
                    onClick={() => onAction("archive")}
                  />
                  <ActionButton
                    label={t("copier.continuous.cancel")}
                    disabled={busy}
                    onClick={() => onArchiveArmed(false)}
                  />
                </>
              ) : (
                <ActionButton
                  icon={<Archive size={12} />}
                  label={t("copier.continuous.archive")}
                  disabled={busy || dirty || view.activeLinks > 0}
                  onClick={() => onArchiveArmed(true)}
                />
              )}
            </div>
            {view.activeLinks > 0 && (
              <p className="mt-2 text-[9px] text-amber-300" role="status">
                {t("copier.continuous.archiveBlocked")}
              </p>
            )}
            {dirty && (
              <p className="mt-2 text-[9px] text-amber-300" role="status">
                {t("copier.continuous.dirtyBlocked")}
              </p>
            )}
          </fieldset>
        )}
      </div>
    </section>
  );
}

function FollowerEditor({
  target,
  account,
  runtimeStatus,
  statusMessage,
  membershipLocked,
  onChange,
}: {
  target: ContinuousCopyTargetWrite;
  account?: ExecutionAccountSummary;
  runtimeStatus?: ContinuousCopyTargetRuntimeStatus;
  statusMessage?: string;
  membershipLocked: boolean;
  onChange: (target: ContinuousCopyTargetWrite) => void;
}) {
  const { t } = useI18n();
  const setConfig = (patch: Partial<ContinuousCopyTargetWrite["config"]>) =>
    onChange({ ...target, config: { ...target.config, ...patch } });
  const setProtection = (patch: Partial<ContinuousCopyProtectionConfig>) =>
    setConfig({
      protection: { ...target.config.protection, ...patch },
    });

  return (
    <details
      className={cn(
        "group rounded-xl border bg-terminal-panel-2/45",
        target.enabled ? "border-brand/30" : "border-terminal-border",
      )}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 focus-ring">
        <input
          type="checkbox"
          checked={target.enabled}
          disabled={membershipLocked}
          onChange={(event) =>
            onChange({ ...target, enabled: event.target.checked })
          }
          onClick={(event) => event.stopPropagation()}
          aria-label={t("copier.continuous.enableFollower", {
            account: account?.label ?? target.accountId,
          })}
          className="h-4 w-4 shrink-0 accent-[var(--accent)] focus-ring"
        />
        <span className="min-w-0 flex-1">
          <strong className="block truncate text-[11px] text-ink">
            {account?.label ?? target.accountId}
          </strong>
          <span className="mt-0.5 block truncate text-[9px] text-ink-faint">
            {account
              ? `${account.brokerCode} - ${account.externalAccountRef} - ${localizeAccountStatus(t, account.status)}`
              : t("copier.continuous.accountMissing")}
          </span>
        </span>
        <RuntimeBadge status={runtimeStatus ?? "inactive"} />
        <ChevronDown size={14} className="shrink-0 text-ink-faint transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="space-y-4 border-t border-terminal-border p-3">
        {statusMessage && (
          <p className="rounded-lg bg-terminal-panel px-2.5 py-2 text-[9px] leading-4 text-ink-muted">
            {statusMessage}
          </p>
        )}
        <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <legend className="sr-only">
            {t("copier.continuous.followerSizing")}
          </legend>
          <Field label={t("copier.allocation.label")}>
            <select
              value={target.config.allocation.mode}
              onChange={(event) =>
                setConfig({ allocation: allocationForMode(event.target.value) })
              }
              className={inputClass}
            >
              <option value="sameQuantity">{t("copier.allocation.same")}</option>
              <option value="fixedQuantity">{t("copier.allocation.fixed")}</option>
              <option value="multiplier">{t("copier.allocation.multiplier")}</option>
              <option value="equityProportional">{t("copier.allocation.equity")}</option>
              <option value="riskPercent">{t("copier.allocation.risk")}</option>
            </select>
          </Field>
          {target.config.allocation.mode !== "sameQuantity" ? (
            <Field
              label={
                target.config.allocation.mode === "fixedQuantity"
                  ? t("copier.allocation.fixed")
                  : target.config.allocation.mode === "riskPercent"
                    ? t("copier.allocation.riskShort")
                    : t("copier.allocation.multiplier")
              }
              suffix={target.config.allocation.mode === "riskPercent" ? "%" : undefined}
            >
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={continuousCopyAllocationValue(target.config.allocation)}
                onChange={(event) =>
                  setConfig({
                    allocation: allocationWithValue(
                      target.config.allocation,
                      event.target.value,
                    ),
                  })
                }
                className={inputClass}
              />
            </Field>
          ) : (
            <div className="flex items-end">
              <div className="flex min-h-11 w-full items-center rounded-lg border border-terminal-border bg-terminal-panel px-2.5 text-[9px] text-ink-faint sm:min-h-9">
                {t("copier.allocation.usesSource")}
              </div>
            </div>
          )}
          <Field
            label={t("copier.allocation.maxLot")}
            description={t("copier.allocation.maxLotDescription")}
          >
            <input
              type="number"
              inputMode="decimal"
              min="0.00000001"
              step="0.01"
              value={target.config.maxQuantity ?? ""}
              onChange={(event) =>
                setConfig({ maxQuantity: event.target.value || undefined })
              }
              placeholder={t("copier.allocation.brokerMax")}
              className={inputClass}
            />
          </Field>
          <Toggle
            label={t("copier.continuous.reverse")}
            description={t("copier.continuous.reverseDescription")}
            checked={target.config.reverseTrade}
            onChange={(reverseTrade) => setConfig({ reverseTrade })}
            compact
          />
        </fieldset>

        <SymbolMappingEditor
          mapping={target.config.symbolMapping}
          onChange={(symbolMapping) => setConfig({ symbolMapping })}
        />

        <fieldset className="rounded-xl border border-terminal-border bg-terminal-panel/40 p-3">
          <legend className="flex items-center gap-1.5 px-1 text-[10px] font-semibold text-ink">
            <ShieldCheck size={13} className="text-brand" />
            {t("copier.continuous.protection")}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Toggle
              label={t("copier.continuous.marginCap")}
              description={t("copier.continuous.marginCapDescription")}
              checked={Boolean(target.config.protection.brokerMarginCap)}
              onChange={(checked) =>
                setProtection({
                  brokerMarginCap: checked
                    ? { basis: "balance", basisPoints: 3_500, alert: false }
                    : undefined,
                })
              }
              compact
            />
            {target.config.protection.brokerMarginCap && (
              <>
                <Field label={t("copier.continuous.marginBasis")}>
                  <select
                    value={target.config.protection.brokerMarginCap.basis}
                    onChange={(event) =>
                      setProtection({
                        brokerMarginCap: {
                          ...target.config.protection.brokerMarginCap!,
                          basis: event.target.value as "equity" | "balance",
                        },
                      })
                    }
                    className={inputClass}
                  >
                    <option value="equity">{t("copier.continuous.liveEquity")}</option>
                    <option value="balance">{t("copier.continuous.balance")}</option>
                  </select>
                </Field>
                <Field label={t("copier.continuous.marginCapValue")} suffix="%">
                  <PercentInput
                    value={target.config.protection.brokerMarginCap.basisPoints}
                    onChange={(basisPoints) =>
                      setProtection({
                        brokerMarginCap: {
                          ...target.config.protection.brokerMarginCap!,
                          basisPoints: basisPoints ?? 0,
                        },
                      })
                    }
                  />
                </Field>
                <Toggle
                  label={t("copier.continuous.marginAlert")}
                  description={t("copier.continuous.marginAlertDescription")}
                  checked={target.config.protection.brokerMarginCap.alert}
                  onChange={(alert) =>
                    setProtection({
                      brokerMarginCap: {
                        ...target.config.protection.brokerMarginCap!,
                        alert,
                      },
                    })
                  }
                  compact
                />
              </>
            )}
            <Field
              label={t("copier.continuous.maxDrawdown")}
              suffix="%"
              description={t("copier.continuous.maxDrawdownDescription")}
            >
              <PercentInput
                value={target.config.protection.maxDrawdownBasisPoints}
                optional
                onChange={(maxDrawdownBasisPoints) =>
                  setProtection({ maxDrawdownBasisPoints })
                }
              />
            </Field>
          </div>
          <div className="mt-3 grid gap-3 border-t border-terminal-border pt-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={t("copier.continuous.trailingStart")} suffix="points">
              <ProtectionPointInput
                value={target.config.protection.trailingStartPoints}
                onChange={(trailingStartPoints) =>
                  setProtection({ trailingStartPoints })
                }
              />
            </Field>
            <Field label={t("copier.continuous.trailingDistance")} suffix="points">
              <ProtectionPointInput
                value={target.config.protection.trailingStopPoints}
                onChange={(trailingStopPoints) =>
                  setProtection({ trailingStopPoints })
                }
              />
            </Field>
            <Field label={t("copier.continuous.trailingStep")} suffix="points">
              <ProtectionPointInput
                value={target.config.protection.trailingStepPoints}
                onChange={(trailingStepPoints) =>
                  setProtection({ trailingStepPoints })
                }
              />
            </Field>
            <Field label={t("copier.continuous.breakevenTrigger")} suffix="points">
              <ProtectionPointInput
                value={target.config.protection.breakevenTriggerPoints}
                onChange={(breakevenTriggerPoints) =>
                  setProtection({ breakevenTriggerPoints })
                }
              />
            </Field>
            <Field label={t("copier.continuous.breakevenOffset")} suffix="points">
              <ProtectionPointInput
                value={target.config.protection.breakevenOffsetPoints}
                onChange={(breakevenOffsetPoints) =>
                  setProtection({ breakevenOffsetPoints })
                }
              />
            </Field>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-ink-faint">
            {t("copier.continuous.protectionDescription")}
          </p>
        </fieldset>
      </div>
    </details>
  );
}

function SymbolMappingEditor({
  mapping,
  onChange,
}: {
  mapping: Record<string, string>;
  onChange: (mapping: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const [canonical, setCanonical] = useState("");
  const [venue, setVenue] = useState("");
  const entries = Object.entries(mapping);

  const add = () => {
    const key = canonical.trim().toUpperCase();
    const value = venue.trim();
    if (!key || !value) return;
    onChange({ ...mapping, [key]: value });
    setCanonical("");
    setVenue("");
  };

  return (
    <fieldset className="rounded-xl border border-terminal-border bg-terminal-panel/40 p-3">
      <legend className="px-1 text-[10px] font-semibold text-ink">
        {t("copier.continuous.symbolMapping")}
      </legend>
      <p className="text-[9px] leading-4 text-ink-faint">
        {t("copier.continuous.symbolMappingDescription")}
      </p>
      {entries.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {entries.map(([source, target]) => (
            <div
              key={source}
              className="grid grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_40px] items-center gap-2"
            >
              <input
                aria-label={t("copier.continuous.canonicalSymbolAria", {
                  symbol: source,
                })}
                value={source}
                onChange={(event) => {
                  const next = { ...mapping };
                  delete next[source];
                  const key = event.target.value.trim().toUpperCase();
                  if (key) next[key] = target;
                  onChange(next);
                }}
                className={inputClass}
              />
              <span className="text-center text-ink-faint" aria-hidden="true">
                {t("copier.continuous.mappingTo")}
              </span>
              <input
                aria-label={t("copier.continuous.followerSymbolAria", {
                  symbol: source,
                })}
                value={target}
                onChange={(event) =>
                  onChange({ ...mapping, [source]: event.target.value })
                }
                className={inputClass}
              />
              <button
                type="button"
                aria-label={t("copier.continuous.removeMappingAria", {
                  symbol: source,
                })}
                onClick={() => {
                  const next = { ...mapping };
                  delete next[source];
                  onChange(next);
                }}
                className="grid min-h-11 place-items-center rounded-lg border border-terminal-border text-ink-faint hover:border-bear/40 hover:text-bear focus-ring sm:min-h-9"
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <input
          aria-label={t("copier.continuous.newCanonicalAria")}
          value={canonical}
          onChange={(event) => setCanonical(event.target.value)}
          placeholder={t("copier.continuous.sourceSymbolPlaceholder")}
          className={inputClass}
        />
        <input
          aria-label={t("copier.continuous.newFollowerAria")}
          value={venue}
          onChange={(event) => setVenue(event.target.value)}
          placeholder={t("copier.continuous.followerSymbolPlaceholder")}
          className={inputClass}
        />
        <button
          type="button"
          onClick={add}
          disabled={!canonical.trim() || !venue.trim()}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-terminal-border-strong px-3 text-[10px] font-semibold text-ink-muted hover:border-brand/45 hover:text-brand disabled:opacity-40 focus-ring sm:min-h-9"
        >
          <Plus size={12} aria-hidden="true" />
          {t("copier.continuous.addMapping")}
        </button>
      </div>
    </fieldset>
  );
}

function RuntimeBadge({
  status,
}: {
  status: ContinuousCopyGroupRuntimeStatus | ContinuousCopyTargetRuntimeStatus;
}) {
  const { t } = useI18n();
  const tone =
    status === "active"
      ? "bg-bull/10 text-bull"
      : status === "error"
        ? "bg-bear/10 text-bear"
        : status === "degraded" || status === "waiting"
          ? "bg-amber-500/10 text-amber-300"
          : status === "starting" || status === "connecting"
            ? "bg-brand/10 text-brand"
            : "bg-terminal-hover text-ink-faint";
  return (
    <span
      aria-label={t("copier.runtime.aria", {
        status: localizeRuntimeStatus(t, status),
      })}
      className={cn(
        "shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-wide",
        tone,
      )}
    >
      {localizeRuntimeStatus(t, status)}
    </span>
  );
}

function ActivityMetric({
  icon,
  label,
  value,
  alert,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0 border-r border-terminal-border px-2 py-3 last:border-r-0 sm:px-4">
      <span className={cn("flex items-center gap-1 text-ink-faint", alert && "text-bear")}>
        {icon}
        <span className="truncate text-[8px] uppercase tracking-wide">{label}</span>
      </span>
      <strong className={cn("mt-1 block tabular text-sm text-ink", alert && "text-bear")}>
        {value}
      </strong>
    </div>
  );
}

function Field({
  label,
  description,
  suffix,
  children,
}: {
  label: string;
  description?: string;
  suffix?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1 text-[9px] text-ink-faint">
      <span className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink-muted">{label}</span>
        {suffix && <span>{suffix}</span>}
      </span>
      {children}
      {description && <span className="leading-4">{description}</span>}
    </label>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
  compact,
  disabled,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-2.5 rounded-lg border border-terminal-border bg-terminal-panel-2/50 p-2.5",
        compact && "min-h-[67px]",
        disabled && "cursor-not-allowed opacity-55",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)] focus-ring"
      />
      <span className="min-w-0">
        <strong className="block text-[10px] text-ink">{label}</strong>
        <span className="mt-0.5 block text-[9px] leading-4 text-ink-faint">
          {description}
        </span>
      </span>
    </label>
  );
}

function IntegerInput({
  value,
  min = 0,
  onChange,
}: {
  value: number;
  min?: number;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      step="1"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
      className={inputClass}
    />
  );
}

function ProtectionPointInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return <IntegerInput value={value} onChange={onChange} />;
}

function PercentInput({
  value,
  optional,
  onChange,
}: {
  value?: number;
  optional?: boolean;
  onChange: (basisPoints: number | undefined) => void;
}) {
  const { t } = useI18n();
  return (
    <input
      type="number"
      inputMode="decimal"
      min="0.01"
      max="100"
      step="0.01"
      value={value == null ? "" : value / 100}
      placeholder={optional ? t("copier.continuous.disabled") : undefined}
      onChange={(event) =>
        onChange(
          event.target.value
            ? Math.round(Number(event.target.value) * 100)
            : undefined,
        )
      }
      className={inputClass}
    />
  );
}

function ActionButton({
  icon,
  label,
  danger,
  disabled,
  onClick,
}: {
  icon?: React.ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-40 focus-ring sm:min-h-9",
        danger
          ? "border-bear/35 bg-bear/5 text-bear hover:bg-bear/10"
          : "border-terminal-border-strong text-ink-muted hover:border-brand/45 hover:text-brand",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function allocationForMode(mode: string): ContinuousCopyAllocation {
  switch (mode) {
    case "fixedQuantity":
      return { mode, quantity: "0.1", unit: "lots" };
    case "multiplier":
      return { mode, multiplier: "1" };
    case "equityProportional":
      return { mode, multiplier: "1" };
    case "riskPercent":
      return { mode, basisPoints: 50 };
    default:
      return { mode: "sameQuantity" };
  }
}

function allocationWithValue(
  allocation: ContinuousCopyAllocation,
  value: string,
): ContinuousCopyAllocation {
  switch (allocation.mode) {
    case "fixedQuantity":
      return { ...allocation, quantity: value };
    case "multiplier":
    case "equityProportional":
      return { ...allocation, multiplier: value };
    case "riskPercent":
      return {
        ...allocation,
        basisPoints: Math.round(Number(value) * 100),
      };
    case "sameQuantity":
      return allocation;
  }
}

function continuousActionTitleKey(
  action: ContinuousCopyGroupAction,
): TranslationKey {
  const keys: Record<ContinuousCopyGroupAction, TranslationKey> = {
    pause: "copier.continuous.toast.paused",
    resume: "copier.continuous.toast.resumed",
    reconcile: "copier.continuous.toast.reconcile",
    archive: "copier.continuous.toast.archived",
  };
  return keys[action];
}

function localizeRuntimeStatus(
  t: Translate,
  status: ContinuousCopyGroupRuntimeStatus | ContinuousCopyTargetRuntimeStatus,
): string {
  const keys: Partial<Record<string, TranslationKey>> = {
    inactive: "copier.runtime.inactive",
    starting: "copier.runtime.starting",
    active: "copier.runtime.active",
    paused: "copier.runtime.paused",
    degraded: "copier.runtime.degraded",
    error: "copier.runtime.error",
    connecting: "copier.runtime.connecting",
    waiting: "copier.runtime.waiting",
  };
  const key = keys[status];
  return key ? t(key) : status;
}

function localizeAccountStatus(t: Translate, status: string): string {
  const keys: Partial<Record<string, TranslationKey>> = {
    disabled: "copier.account.disabled",
    offline: "copier.account.offline",
    connecting: "copier.account.connecting",
    ready: "copier.account.ready",
    degraded: "copier.account.degraded",
    blocked: "copier.account.blocked",
  };
  const key = keys[status];
  return key ? t(key) : status;
}

function localizeContinuousValidation(t: Translate, message: string): string {
  const keys: Partial<Record<string, TranslationKey>> = {
    "Group name is required.": "copier.validation.groupName",
    "Choose a source account.": "copier.validation.source",
    "Pair at least one follower account.": "copier.validation.follower",
    "Enable at least one follower before starting the group.":
      "copier.validation.enableFollower",
    "Maximum slippage must be zero or a positive whole number.":
      "copier.validation.slippage",
    "Stale event window must be a positive number of milliseconds.":
      "copier.validation.stale",
    "Reconciliation interval must be a positive number of milliseconds.":
      "copier.validation.reconcile",
    "Magic filter must be a whole number.": "copier.validation.magic",
    "The source account cannot also be a follower.":
      "copier.validation.sourceFollower",
    "Each follower account can appear only once.":
      "copier.validation.uniqueFollower",
    "Risk-percent allocation requires copied stop-loss protection on the initial order.":
      "copier.validation.riskNeedsStop",
    "Every follower must have an account.":
      "copier.validation.followerAccount",
    "Fixed follower lot must be greater than zero.":
      "copier.validation.fixedLot",
    "Follower multiplier must be greater than zero.":
      "copier.validation.multiplier",
    "Follower risk must be between 0.01% and 100%.":
      "copier.validation.risk",
    "Follower maximum lot must be greater than zero.":
      "copier.validation.maxLot",
    "Broker margin cap must be between 0.01% and 100%.":
      "copier.validation.marginCap",
    "Maximum drawdown must be between 0.01% and 100%.":
      "copier.validation.drawdown",
    "Protection distances must be zero or positive whole points.":
      "copier.validation.protectionPoints",
    "Trailing step must be positive when trailing stop is enabled.":
      "copier.validation.trailingStep",
  };
  const key = keys[message];
  return key ? t(key) : message;
}

const inputClass =
  "h-11 min-w-0 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-2.5 text-base text-ink outline-none placeholder:text-ink-faint focus:border-brand focus-visible:ring-2 focus-visible:ring-brand/35 sm:h-9 sm:text-[10px]";
