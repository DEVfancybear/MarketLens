"use client";

import { useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  PlatformContentDialog,
  usePlatformDialog,
} from "@/components/ui/PlatformDialog";
import { useI18n } from "@/hooks/useI18n";
import { EXECUTION_STATUS_TRANSLATION_KEYS } from "@/i18n/localization";
import {
  disconnectExecutionAccount,
  disconnectManagedMT5Account,
  getExecutionAccounts,
  reconnectManagedMT5Account,
  removeExecutionAccount,
  removeManagedMT5Account,
  type ExecutionPairingToken,
} from "@/services/api/resources/executionApi";
import {
  applyExecutionAccountsAtom,
  selectedExecutionAccountIdAtom,
} from "@/store/executionRegistryStore";
import { setExecutionModeAtom } from "@/store/mt5Store";
import { pushToastAtom } from "@/store/toastStore";
import type { ExecutionAccountSummary } from "@/types/execution";
import { Mt5ManagedConnectionDialog } from "./Mt5ManagedConnectionDialog";
import { PropRiskGuardCard } from "./PropRiskGuardCard";

type BusyAction = "disconnect" | "reconnect" | "remove" | null;

export function ExecutionAccountManagementDialog({
  account,
  pairing,
  pairingFailed,
  pairingLoading,
  onClose,
  onGeneratePairingToken,
}: {
  account: ExecutionAccountSummary | null;
  pairing: ExecutionPairingToken | null;
  pairingFailed: boolean;
  pairingLoading: boolean;
  onClose: () => void;
  onGeneratePairingToken: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [showCredentials, setShowCredentials] = useState(false);
  const selectedAccountId = useAtomValue(selectedExecutionAccountIdAtom);
  const applyAccounts = useSetAtom(applyExecutionAccountsAtom);
  const setMode = useSetAtom(setExecutionModeAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const { requestConfirm, dialog } = usePlatformDialog();
  const { locale, t } = useI18n();
  if (!account) return null;

  const managed = account.connectorKind === "windows_vm";
  const busy = busyAction !== null;
  const canReconnectStored =
    managed &&
    account.persistence === "managed" &&
    ["disconnected", "degraded", "blocked", "credentials_required"].includes(
      account.status,
    );

  const revision = () => {
    if (!account.connectionRevision) {
      throw new Error("missing managed connector revision");
    }
    return account.connectionRevision;
  };

  const refreshAccounts = async () => {
    const next = await getExecutionAccounts();
    applyAccounts(next);
    return next;
  };

  const disconnect = async () => {
    const confirmed = await requestConfirm({
      title: managed
        ? t("execution.manage.disconnectManaged.title")
        : t("execution.manage.disconnectEa.title"),
      description: managed
        ? t("execution.manage.disconnectManaged.description")
        : t("execution.manage.disconnectEa.description"),
      confirmLabel: t("execution.manage.disconnect.confirm"),
      cancelLabel: t("execution.manage.disconnect.cancel"),
    });
    if (!confirmed) return;
    setBusyAction("disconnect");
    try {
      if (managed) {
        await disconnectManagedMT5Account(account.id, revision());
      } else {
        await disconnectExecutionAccount(account.id);
      }
      await refreshAccounts();
      onClose();
      pushToast({
        title: t("execution.manage.disconnect.successTitle"),
        message:
          managed && account.persistence === "managed"
            ? t("execution.manage.disconnect.managedMessage")
            : managed
              ? t("execution.manage.disconnect.sessionMessage")
              : t("execution.manage.disconnect.eaMessage"),
        variant: "success",
      });
    } catch {
      pushToast({
        title: t("execution.manage.disconnect.errorTitle"),
        message: t("execution.manage.disconnect.errorMessage"),
        variant: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const reconnectStored = async () => {
    setBusyAction("reconnect");
    try {
      await reconnectManagedMT5Account(account.id, {
        expectedRevision: revision(),
      });
      await refreshAccounts();
      onClose();
      pushToast({
        title: t("execution.manage.reconnect.successTitle"),
        message: t("execution.manage.reconnect.successMessage"),
        variant: "success",
      });
    } catch {
      pushToast({
        title: t("execution.manage.reconnect.errorTitle"),
        message: t("execution.manage.reconnect.errorMessage"),
        variant: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  const remove = async () => {
    const confirmed = await requestConfirm({
      title: t("execution.manage.remove.title"),
      description: t("execution.manage.remove.description", {
        account: account.label,
      }),
      confirmLabel: t("execution.manage.remove.confirm"),
      cancelLabel: t("execution.manage.remove.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;
    setBusyAction("remove");
    try {
      if (managed) {
        await removeManagedMT5Account(account.id, revision());
      } else {
        await removeExecutionAccount(account.id);
      }
      const next = await refreshAccounts();
      const stillStopping = next.some((item) => item.id === account.id);
      if (stillStopping) {
        onClose();
        pushToast({
          title: t("execution.manage.remove.stoppingTitle"),
          message: t("execution.manage.remove.stoppingMessage"),
          variant: "info",
        });
        return;
      }
      if (selectedAccountId === account.id) setMode("simulator");
      onClose();
      pushToast({
        title: t("execution.manage.remove.successTitle"),
        message: t("execution.manage.remove.successMessage"),
        variant: "success",
      });
    } catch {
      pushToast({
        title: t("execution.manage.remove.errorTitle"),
        message: t("execution.manage.remove.errorMessage"),
        variant: "error",
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <>
      <PlatformContentDialog
        open={!showCredentials}
        onClose={busy ? () => undefined : onClose}
        title={t("execution.manage.title")}
        description={`${account.label} · ${account.server ?? account.externalAccountRef}`}
        closeLabel={t("execution.manage.closeLabel")}
        footer={
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
          >
            {t("execution.manage.close")}
          </button>
        }
      >
        <div className="space-y-3">
          {managed ? (
            <section className="rounded-xl border border-bull/25 bg-bull/5 p-3">
              <div className="flex items-start gap-2">
                <ShieldCheck
                  size={16}
                  className="mt-0.5 shrink-0 text-bull"
                  aria-hidden="true"
                />
                <div>
                  <strong className="block text-xs text-ink">
                    {t("execution.manage.managedTitle")}
                  </strong>
                  <p className="mt-1 text-[10px] leading-4 text-ink-muted">
                    {t("execution.manage.managedSummary", {
                      status: t(
                        EXECUTION_STATUS_TRANSLATION_KEYS[account.status],
                      ),
                      persistence:
                        account.persistence === "session"
                          ? t("execution.manage.persistence.session")
                          : t("execution.manage.persistence.managed"),
                    })}
                  </p>
                </div>
              </div>
            </section>
          ) : (
            <PairingSection
              pairing={pairing}
              pairingFailed={pairingFailed}
              pairingLoading={pairingLoading}
              locale={locale}
              t={t}
              busy={busy}
              copied={copied}
              setCopied={setCopied}
              onGeneratePairingToken={onGeneratePairingToken}
            />
          )}

          <PropRiskGuardCard account={account} />

          {managed && (
            <section className="grid gap-2 sm:grid-cols-2">
              {canReconnectStored && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void reconnectStored()}
                  className="flex min-h-12 items-center gap-2 rounded-xl border border-brand/35 px-3 text-left text-[11px] font-semibold text-brand hover:bg-brand/10 disabled:opacity-60 focus-ring"
                >
                  {busyAction === "reconnect" ? (
                    <LoaderCircle size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {t("execution.manage.action.reconnectStored")}
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowCredentials(true)}
                className="flex min-h-12 items-center gap-2 rounded-xl border border-terminal-border-strong px-3 text-left text-[11px] font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
              >
                <KeyRound size={15} className="text-brand" />
                {t("execution.manage.action.rotate")}
              </button>
            </section>
          )}

          <section className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={busy || managed && account.status === "disconnected"}
              onClick={() => void disconnect()}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-terminal-border-strong px-3 text-left text-[11px] font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
            >
              {busyAction === "disconnect" ? (
                <LoaderCircle size={15} className="animate-spin text-brand" />
              ) : (
                <LogOut size={15} className="text-brand" />
              )}
              {managed
                ? t("execution.manage.action.disconnectTerminal")
                : t("execution.manage.action.disconnectEa")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className="flex min-h-12 items-center gap-2 rounded-xl border border-bear/35 px-3 text-left text-[11px] font-semibold text-bear hover:bg-bear/10 disabled:opacity-60 focus-ring"
            >
              {busyAction === "remove" ? (
                <LoaderCircle size={15} className="animate-spin" />
              ) : (
                <Trash2 size={15} />
              )}
              {t("execution.manage.action.remove")}
            </button>
          </section>
          <p className="text-[9px] leading-4 text-ink-faint">
            {t("execution.manage.safety")}
          </p>
        </div>
      </PlatformContentDialog>
      <Mt5ManagedConnectionDialog
        open={showCredentials}
        account={account}
        onClose={() => {
          setShowCredentials(false);
          onClose();
        }}
      />
      {dialog}
    </>
  );
}

function PairingSection({
  pairing,
  pairingFailed,
  pairingLoading,
  locale,
  t,
  busy,
  copied,
  setCopied,
  onGeneratePairingToken,
}: {
  pairing: ExecutionPairingToken | null;
  pairingFailed: boolean;
  pairingLoading: boolean;
  locale: string;
  t: ReturnType<typeof useI18n>["t"];
  busy: boolean;
  copied: boolean;
  setCopied: (copied: boolean) => void;
  onGeneratePairingToken: () => Promise<void>;
}) {
  return (
    <section className="rounded-xl border border-terminal-border bg-terminal-panel-2/40 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <strong className="block text-xs text-ink">
            {t("execution.manage.pairing.title")}
          </strong>
          <p className="mt-1 text-[10px] leading-4 text-ink-muted">
            {t("execution.manage.pairing.description")}
          </p>
        </div>
        <button
          type="button"
          disabled={pairingLoading || busy}
          onClick={() => {
            setCopied(false);
            void onGeneratePairingToken();
          }}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg bg-brand px-3 text-[10px] font-semibold text-(--accent-contrast) hover:bg-brand-hover disabled:opacity-60 focus-ring"
        >
          {pairingLoading ? (
            <LoaderCircle size={12} className="animate-spin" />
          ) : (
            <KeyRound size={12} />
          )}
          {t("execution.manage.pairing.generate")}
        </button>
      </div>
      {pairing && (
        <div className="mt-3 rounded-lg border border-bull/25 bg-bull/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-semibold text-bull">
              {t("execution.manage.pairing.expires", {
                time: new Date(pairing.expiresAtMs).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
              })}
            </span>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(pairing.token)
                  .then(() => setCopied(true))
                  .catch(() => setCopied(false));
              }}
              className="inline-flex min-h-7 items-center gap-1 rounded-lg px-2 text-[9px] font-semibold text-bull hover:bg-bull/10 focus-ring"
            >
              {copied ? <Check size={11} /> : <Clipboard size={11} />}
              {copied
                ? t("execution.manage.pairing.copied")
                : t("execution.manage.pairing.copy")}
            </button>
          </div>
          <code className="mt-2 block break-all rounded-md bg-terminal-bg px-2 py-1.5 text-[9px] text-ink">
            {pairing.token}
          </code>
        </div>
      )}
      {pairingFailed && (
        <p className="mt-2 text-[10px] text-bear">
          {t("execution.manage.pairing.error")}
        </p>
      )}
    </section>
  );
}
