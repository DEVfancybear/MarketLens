"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { useSetAtom } from "jotai";
import { KeyRound, LoaderCircle, ServerCog, ShieldCheck } from "lucide-react";
import { PlatformContentDialog } from "@/components/ui/PlatformDialog";
import { useI18n } from "@/hooks/useI18n";
import {
  connectManagedMT5Account,
  getExecutionAccounts,
  reconnectManagedMT5Account,
} from "@/services/api/resources/executionApi";
import { userFacingErrorMessage } from "@/services/feedback/errorReporter";
import { applyExecutionAccountsAtom } from "@/store/executionRegistryStore";
import { pushToastAtom } from "@/store/toastStore";
import type { ExecutionAccountSummary } from "@/types/execution";

export function Mt5ManagedConnectionDialog({
  open,
  account = null,
  onClose,
}: {
  open: boolean;
  account?: ExecutionAccountSummary | null;
  onClose: () => void;
}) {
  const formId = useId();
  const connectRequestId = useRef("");
  const [label, setLabel] = useState("");
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [server, setServer] = useState("");
  const [persistence, setPersistence] = useState<"session" | "managed">(
    "managed",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const applyAccounts = useSetAtom(applyExecutionAccountsAtom);
  const pushToast = useSetAtom(pushToastAtom);
  const { t } = useI18n();
  const rotating = account?.connectorKind === "windows_vm";

  useEffect(() => {
    if (!open) return;
    setLabel(account?.label ?? "");
    setLogin("");
    setPassword("");
    setServer(account?.server ?? "");
    setPersistence(account?.persistence ?? "managed");
    connectRequestId.current = crypto.randomUUID();
    setError("");
  }, [account, open]);

  if (!open) return null;

  const close = () => {
    if (busy) return;
    setPassword("");
    setLogin("");
    setError("");
    connectRequestId.current = "";
    onClose();
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (rotating && account?.connectionRevision) {
        await reconnectManagedMT5Account(account.id, {
          expectedRevision: account.connectionRevision,
          login: login.trim(),
          password,
          server: server.trim(),
        });
      } else {
        await connectManagedMT5Account({
          requestId: connectRequestId.current || crypto.randomUUID(),
          platform: "mt5",
          login: login.trim(),
          password,
          server: server.trim(),
          label: label.trim(),
          persistence,
        });
      }
      setPassword("");
      setLogin("");
      connectRequestId.current = "";
      applyAccounts(await getExecutionAccounts());
      pushToast({
        title: rotating
          ? t("execution.managed.toast.rotateTitle")
          : t("execution.managed.toast.connectTitle"),
        message: t("execution.managed.toast.message"),
        variant: "success",
      });
      onClose();
    } catch (cause) {
      setPassword("");
      setError(
        userFacingErrorMessage(
          cause,
          t("execution.managed.error"),
        ),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <PlatformContentDialog
      open
      onClose={close}
      title={
        rotating
          ? t("execution.managed.dialog.rotateTitle")
          : t("execution.managed.dialog.connectTitle")
      }
      description={
        rotating
          ? t("execution.managed.dialog.rotateDescription", {
              account: account.label,
            })
          : t("execution.managed.dialog.connectDescription")
      }
      closeLabel={t("execution.managed.dialog.close")}
      footer={
        <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={close}
            className="min-h-11 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
          >
            {t("execution.managed.dialog.cancel")}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={busy}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-(--accent-contrast) hover:bg-brand-hover disabled:opacity-60 focus-ring"
          >
            {busy ? (
              <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <ServerCog size={16} aria-hidden="true" />
            )}
            {busy
              ? t("execution.managed.dialog.submitting")
              : rotating
                ? t("execution.managed.dialog.submitRotate")
                : t("execution.managed.dialog.submitConnect")}
          </button>
        </div>
      }
    >
      <form id={formId} onSubmit={submit} className="space-y-4">
        <div className="rounded-xl border border-bull/25 bg-bull/5 p-3 text-[11px] leading-5 text-ink-muted">
          <div className="flex items-start gap-2">
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-bull" aria-hidden="true" />
            <p>
              {t("execution.managed.security")}
            </p>
          </div>
        </div>

        {!rotating && (
          <Field
            label={t("execution.managed.field.label")}
            htmlFor={`${formId}-label`}
            requiredText={t("execution.managed.field.required")}
          >
            <input
              id={`${formId}-label`}
              required
              maxLength={80}
              autoComplete="off"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="Primary demo"
              className="mt-1 min-h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-bg px-3 text-sm text-ink placeholder:text-ink-faint focus-ring"
            />
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t("execution.managed.field.login")}
            htmlFor={`${formId}-login`}
            requiredText={t("execution.managed.field.required")}
          >
            <input
              id={`${formId}-login`}
              required
              inputMode="numeric"
              pattern="[0-9]+"
              maxLength={32}
              autoComplete="off"
              value={login}
              onChange={(event) => setLogin(event.target.value.replace(/\D/g, ""))}
              placeholder="12345678"
              className="mt-1 min-h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-bg px-3 text-sm text-ink placeholder:text-ink-faint focus-ring"
            />
          </Field>
          <Field
            label={t("execution.managed.field.password")}
            htmlFor={`${formId}-password`}
            requiredText={t("execution.managed.field.required")}
          >
            <div className="relative mt-1">
              <KeyRound
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
                aria-hidden="true"
              />
              <input
                id={`${formId}-password`}
                type="password"
                required
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-bg py-2 pl-9 pr-3 text-sm text-ink focus-ring"
              />
            </div>
          </Field>
        </div>

        <Field
          label={t("execution.managed.field.server")}
          htmlFor={`${formId}-server`}
          requiredText={t("execution.managed.field.required")}
        >
          <input
            id={`${formId}-server`}
            required
            maxLength={128}
            autoComplete="off"
            value={server}
            onChange={(event) => setServer(event.target.value)}
            placeholder="Broker-MT5-Demo"
            aria-describedby={`${formId}-server-help`}
            className="mt-1 min-h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-bg px-3 text-sm text-ink placeholder:text-ink-faint focus-ring"
          />
          <span id={`${formId}-server-help`} className="mt-1 block text-[10px] text-ink-faint">
            {t("execution.managed.field.serverHelp")}
          </span>
        </Field>

        {!rotating && (
          <fieldset>
            <legend className="text-xs font-semibold text-ink">
              {t("execution.managed.persistence.legend")}
            </legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <PersistenceOption
                checked={persistence === "managed"}
                onChange={() => setPersistence("managed")}
                value="managed"
                title={t("execution.managed.persistence.managedTitle")}
                description={t(
                  "execution.managed.persistence.managedDescription",
                )}
              />
              <PersistenceOption
                checked={persistence === "session"}
                onChange={() => setPersistence("session")}
                value="session"
                title={t("execution.managed.persistence.sessionTitle")}
                description={t(
                  "execution.managed.persistence.sessionDescription",
                )}
              />
            </div>
          </fieldset>
        )}

        <div
          aria-live="assertive"
          className={
            error
              ? "rounded-xl border border-bear/30 bg-bear/10 p-3 text-xs leading-5 text-bear"
              : "sr-only"
          }
        >
          {error}
        </div>
      </form>
    </PlatformContentDialog>
  );
}

function Field({
  label,
  htmlFor,
  requiredText,
  children,
}: {
  label: string;
  htmlFor: string;
  requiredText: string;
  children: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink">
      {label}
      <span className="sr-only"> ({requiredText})</span>
      {children}
    </label>
  );
}

function PersistenceOption({
  checked,
  onChange,
  value,
  title,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  value: "session" | "managed";
  title: string;
  description: string;
}) {
  return (
    <label
      className={`flex min-h-24 cursor-pointer gap-2 rounded-xl border p-3 transition-colors focus-within:ring-2 focus-within:ring-brand/60 ${
        checked
          ? "border-brand/55 bg-brand/10"
          : "border-terminal-border-strong bg-terminal-panel-2/35 hover:bg-terminal-hover"
      }`}
    >
      <input
        type="radio"
        name="mt5-persistence"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-1 accent-(--accent)"
      />
      <span>
        <strong className="block text-xs text-ink">{title}</strong>
        <span className="mt-1 block text-[10px] leading-4 text-ink-muted">{description}</span>
      </span>
    </label>
  );
}
