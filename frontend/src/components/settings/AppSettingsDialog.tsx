"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  Check,
  CheckCircle2,
  CircleAlert,
  Loader2,
  MessageCircle,
  Send,
  ServerCog,
  ShieldCheck,
  X,
} from "lucide-react";
import { authUserAtom, backendSessionAtom } from "@/store/authStore";
import { integrationSettingsOpenAtom } from "@/store/integrationSettingsStore";
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  testIntegration,
  verifyMt5Integration,
  type IntegrationSettingsWrite,
} from "@/services/api/resources/integrationsApi";
import { errorMessage, isApiError } from "@/services/api/errors";
import { syncMt5IntegrationAtom } from "@/store/mt5Store";
import {
  APP_SETTINGS_OVERLAY_STACK_CLASS,
  createEmptyIntegrationDraft,
  mergeLoadedIntegrationSettings,
  type IntegrationDraftField,
} from "./integrationSettingsDraft";

const fieldClassName =
  "h-11 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-3 text-base text-ink outline-none transition-[border-color,box-shadow,background-color] placeholder:text-ink-faint hover:border-terminal-border-strong focus:border-brand focus:ring-2 focus:ring-brand/20 sm:h-10 sm:text-sm";

export function AppSettingsDialog() {
  const [open, setOpen] = useAtom(integrationSettingsOpenAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const userID = useAtomValue(authUserAtom)?.uid ?? null;
  const syncMt5Integration = useSetAtom(syncMt5IntegrationAtom);
  const [draft, setDraft] = useState<IntegrationSettingsWrite>(
    createEmptyIntegrationDraft,
  );
  const [configured, setConfigured] = useState({
    mt5: false,
    telegram: false,
    discord: false,
  });
  const [mt5Verification, setMt5Verification] = useState<{
    verified: boolean;
    verifiedAt: string | null;
  }>({ verified: false, verifiedAt: null });
  const [busy, setBusy] = useState(false);
  const [verifyingMt5, setVerifyingMt5] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const mt5VerificationStatusId = useId();
  const dirtyFieldsRef = useRef(new Set<IntegrationDraftField>());
  const loadSequenceRef = useRef(0);
  const sessionIdentityRef = useRef<string | null>(null);
  sessionIdentityRef.current = backendSession ? userID : null;

  const updateDraft = (
    field: IntegrationDraftField,
    update: (current: IntegrationSettingsWrite) => IntegrationSettingsWrite,
  ) => {
    dirtyFieldsRef.current.add(field);
    setDraft(update);
  };

  useEffect(() => {
    if (!open || !backendSession) {
      if (open) setBusy(false);
      return;
    }
    const sequence = ++loadSequenceRef.current;
    let cancelled = false;
    dirtyFieldsRef.current.clear();
    setBusy(true);
    setMessage("");
    setMessageTone(null);
    getIntegrationSettings()
      .then((value) => {
        if (cancelled || sequence !== loadSequenceRef.current) return;
        setDraft((current) =>
          mergeLoadedIntegrationSettings(
            current,
            value,
            dirtyFieldsRef.current,
          ),
        );
        setConfigured({
          mt5: value.mt5.passwordConfigured,
          telegram: value.telegram.botTokenConfigured,
          discord: value.discord.webhookConfigured,
        });
        setMt5Verification({
          verified: value.mt5.verified,
          verifiedAt: value.mt5.verifiedAt,
        });
      })
      .catch(() => {
        if (cancelled || sequence !== loadSequenceRef.current) return;
        setMessage("Unable to load integration settings.");
        setMessageTone("error");
      })
      .finally(() => {
        if (!cancelled && sequence === loadSequenceRef.current) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [backendSession, open, userID]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (!dialog || dialog.contains(document.activeElement)) return;
      closeButtonRef.current?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, setOpen]);

  const mt5CredentialsDirty = (
    ["mt5.login", "mt5.server", "mt5.password"] as IntegrationDraftField[]
  ).some((field) => dirtyFieldsRef.current.has(field));
  const mt5Verified = mt5Verification.verified && !mt5CredentialsDirty;

  if (!open) return null;

  const applySaved = (
    value: Awaited<ReturnType<typeof saveIntegrationSettings>>,
  ) => {
    dirtyFieldsRef.current.clear();
    setConfigured({
      mt5: value.mt5.passwordConfigured,
      telegram: value.telegram.botTokenConfigured,
      discord: value.discord.webhookConfigured,
    });
    setMt5Verification({
      verified: value.mt5.verified,
      verifiedAt: value.mt5.verifiedAt,
    });
    syncMt5Integration(value.mt5);
    setDraft((current) => ({
      ...current,
      mt5: {
        ...current.mt5,
        password: "",
        clearPassword: false,
      },
      telegram: {
        ...current.telegram,
        botToken: "",
        clearBotToken: false,
      },
      discord: {
        ...current.discord,
        webhookUrl: "",
        clearWebhook: false,
      },
    }));
  };

  const save = async () => {
    const operationIdentity = sessionIdentityRef.current;
    setBusy(true);
    setMessage("");
    setMessageTone(null);
    try {
      const value = await saveIntegrationSettings(draft);
      if (!operationIdentity || sessionIdentityRef.current !== operationIdentity) return;
      applySaved(value);
      setMessage("Settings saved.");
      setMessageTone("success");
    } catch (error) {
      setMessage(
        errorMessage(error, "Save failed. Check the fields and backend session."),
      );
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  };

  const verifyMt5 = async () => {
    const operationIdentity = sessionIdentityRef.current;
    let savedMt5: Awaited<
      ReturnType<typeof saveIntegrationSettings>
    >["mt5"] | null = null;
    setBusy(true);
    setVerifyingMt5(true);
    setMessage("");
    setMessageTone(null);
    try {
      const saved = await saveIntegrationSettings(draft);
      if (!operationIdentity || sessionIdentityRef.current !== operationIdentity) return;
      savedMt5 = saved.mt5;
      applySaved(saved);
      const result = await verifyMt5Integration();
      if (sessionIdentityRef.current !== operationIdentity) return;
      setMt5Verification({
        verified: result.mt5.verified,
        verifiedAt: result.mt5.verifiedAt,
      });
      syncMt5Integration(result.mt5);
      setMessage(
        `MT5 login ${result.account.login} on ${result.account.server} verified successfully.`,
      );
      setMessageTone("success");
    } catch (error) {
      if (
        savedMt5 &&
        isApiError(error) &&
        [400, 409, 422].includes(error.status)
      ) {
        const unverified = {
          ...savedMt5,
          verified: false,
          verifiedAt: null,
        };
        setMt5Verification({ verified: false, verifiedAt: null });
        syncMt5Integration(unverified);
      }
      setMessage(errorMessage(error, "MT5 verification failed."));
      setMessageTone("error");
    } finally {
      setVerifyingMt5(false);
      setBusy(false);
    }
  };

  const test = async (channel: "telegram" | "discord") => {
    const operationIdentity = sessionIdentityRef.current;
    setBusy(true);
    setMessage("");
    setMessageTone(null);
    try {
      const value = await saveIntegrationSettings(draft);
      if (!operationIdentity || sessionIdentityRef.current !== operationIdentity) return;
      applySaved(value);
      await testIntegration(channel);
      if (sessionIdentityRef.current !== operationIdentity) return;
      setMessage(`${channel} settings saved and test sent.`);
      setMessageTone("success");
    } catch (error) {
      setMessage(errorMessage(error, `${channel} test failed.`));
      setMessageTone("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`platform-dialog-overlay fixed inset-0 ${APP_SETTINGS_OVERLAY_STACK_CLASS} flex items-stretch justify-center bg-[var(--scrim)] sm:items-center sm:p-4 sm:backdrop-blur-sm`}
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        data-platform-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-settings-title"
        aria-describedby="integration-settings-description"
        aria-busy={busy}
        className="platform-dialog platform-dialog--fullscreen flex h-dvh w-full flex-col overflow-hidden bg-terminal-panel text-ink shadow-terminal sm:h-auto sm:max-h-[min(90dvh,820px)] sm:max-w-[760px] sm:rounded-2xl sm:border sm:border-terminal-border-strong"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header data-dialog-header className="flex shrink-0 items-start gap-3 border-b border-terminal-border bg-terminal-panel-2/80 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
          <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-brand/20 bg-brand/10 text-brand">
            <ShieldCheck size={20} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2
              id="integration-settings-title"
              className="text-base font-semibold tracking-tight text-ink sm:text-lg"
            >
              Connections & notifications
            </h2>
            <p
              id="integration-settings-description"
              className="mt-1 max-w-xl text-xs leading-5 text-ink-muted sm:text-sm"
            >
              Connect execution and alert channels. Secrets are encrypted by the
              backend and never returned.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-transparent text-ink-muted transition-colors hover:border-terminal-border hover:bg-terminal-hover hover:text-ink active:bg-terminal-pressed"
            aria-label="Close connection settings"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div data-dialog-body className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {!backendSession ? (
            <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-terminal-border-strong bg-terminal-panel-2 px-6 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                <ShieldCheck size={24} aria-hidden="true" />
              </div>
              <h3 className="mt-4 text-base font-semibold text-ink">
                Sign in required
              </h3>
              <p className="mt-2 max-w-sm text-sm leading-6 text-ink-muted">
                Sign in and establish a backend session to manage private
                integrations.
              </p>
            </div>
          ) : (
            <fieldset
              disabled={busy}
              className="m-0 min-w-0 space-y-4 border-0 p-0 sm:space-y-5"
            >
              <Section
                icon={<ServerCog size={18} />}
                title="MetaTrader 5"
                note="Credentials and verification belong to the signed-in user. Reconnect the local bridge after changing accounts."
                configured={configured.mt5}
                verified={mt5Verified}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Login"
                    value={draft.mt5.login}
                    onChange={(value) =>
                      updateDraft("mt5.login", (current) => ({
                        ...current,
                        mt5: { ...current.mt5, login: value },
                      }))
                    }
                    autoComplete="username"
                  />
                  <Input
                    label="Broker server"
                    value={draft.mt5.server}
                    onChange={(value) =>
                      updateDraft("mt5.server", (current) => ({
                        ...current,
                        mt5: { ...current.mt5, server: value },
                      }))
                    }
                    autoComplete="off"
                  />
                </div>
                <Secret
                  label="Password"
                  configured={configured.mt5}
                  value={draft.mt5.password}
                  onChange={(value) =>
                    updateDraft("mt5.password", (current) => ({
                      ...current,
                      mt5: {
                        ...current.mt5,
                        password: value,
                        clearPassword: false,
                      },
                    }))
                  }
                  onClear={() =>
                    updateDraft("mt5.password", (current) => ({
                      ...current,
                      mt5: {
                        ...current.mt5,
                        password: "",
                        clearPassword: true,
                      },
                    }))
                  }
                />
                <div className="flex flex-col gap-3 rounded-xl border border-terminal-border bg-terminal-bg/55 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div
                    id={mt5VerificationStatusId}
                    className={`flex min-w-0 items-start gap-2 text-xs leading-5 ${
                      mt5Verified
                        ? "text-bull"
                        : mt5CredentialsDirty
                          ? "text-choch"
                          : "text-ink-muted"
                    }`}
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {mt5Verified ? (
                      <CheckCircle2 className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
                    ) : (
                      <ShieldCheck className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
                    )}
                    <span>
                      {mt5Verified
                        ? `Verified for login ${draft.mt5.login} on ${draft.mt5.server}.`
                        : mt5CredentialsDirty
                          ? "These account changes are not verified yet. Save and verify them before using MT5."
                          : configured.mt5
                            ? "Credentials are saved, but verification is required before MT5 can be selected."
                            : "Enter the MT5 login, exact broker server, and master password to verify the account."}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={
                      busy ||
                      !draft.mt5.login.trim() ||
                      !draft.mt5.server.trim() ||
                      draft.mt5.clearPassword ||
                      !(configured.mt5 || draft.mt5.password.trim())
                    }
                    onClick={() => void verifyMt5()}
                    aria-describedby={mt5VerificationStatusId}
                    className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-brand/35 bg-brand/10 px-4 text-sm font-semibold text-brand transition-colors hover:border-brand/60 hover:bg-brand/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
                  >
                    {verifyingMt5 ? (
                      <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <ShieldCheck size={15} aria-hidden="true" />
                    )}
                    Save &amp; Verify MT5
                  </button>
                </div>
              </Section>

              <Section
                icon={<Send size={18} />}
                title="Telegram"
                note="Send trading alerts through a bot to a target chat."
                configured={configured.telegram}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Secret
                    label="Bot token"
                    configured={configured.telegram}
                    value={draft.telegram.botToken}
                    onChange={(value) =>
                      updateDraft("telegram.botToken", (current) => ({
                        ...current,
                        telegram: {
                          ...current.telegram,
                          botToken: value,
                          clearBotToken: false,
                        },
                      }))
                    }
                    onClear={() =>
                      updateDraft("telegram.botToken", (current) => ({
                        ...current,
                        telegram: {
                          ...current.telegram,
                          botToken: "",
                          clearBotToken: true,
                        },
                      }))
                    }
                    emptyPlaceholder="Example: 123456789:AA..."
                  />
                  <Input
                    label="Chat ID"
                    value={draft.telegram.chatId}
                    onChange={(value) =>
                      updateDraft("telegram.chatId", (current) => ({
                        ...current,
                        telegram: { ...current.telegram, chatId: value },
                      }))
                    }
                    placeholder="Example: 123456789"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Toggle
                    label="Enable Telegram alerts"
                    checked={draft.telegram.enabled}
                    onChange={(value) =>
                      updateDraft("telegram.enabled", (current) => ({
                        ...current,
                        telegram: { ...current.telegram, enabled: value },
                      }))
                    }
                  />
                  <TestButton
                    disabled={
                      busy ||
                      !(configured.telegram || draft.telegram.botToken.trim()) ||
                      !draft.telegram.chatId.trim()
                    }
                    onClick={() => void test("telegram")}
                  />
                </div>
              </Section>

              <Section
                icon={<MessageCircle size={18} />}
                title="Discord"
                note="Deliver alerts to a Discord channel through an incoming webhook."
                configured={configured.discord}
              >
                <Secret
                  label="Webhook URL"
                  configured={configured.discord}
                  value={draft.discord.webhookUrl}
                  onChange={(value) =>
                    updateDraft("discord.webhookUrl", (current) => ({
                      ...current,
                      discord: {
                        ...current.discord,
                        webhookUrl: value,
                        clearWebhook: false,
                      },
                    }))
                  }
                  onClear={() =>
                    updateDraft("discord.webhookUrl", (current) => ({
                      ...current,
                      discord: {
                        ...current.discord,
                        webhookUrl: "",
                        clearWebhook: true,
                      },
                    }))
                  }
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Toggle
                    label="Enable Discord alerts"
                    checked={draft.discord.enabled}
                    onChange={(value) =>
                      updateDraft("discord.enabled", (current) => ({
                        ...current,
                        discord: { ...current.discord, enabled: value },
                      }))
                    }
                  />
                  <TestButton
                    disabled={
                      busy ||
                      !(configured.discord || draft.discord.webhookUrl.trim())
                    }
                    onClick={() => void test("discord")}
                  />
                </div>
              </Section>
            </fieldset>
          )}
        </div>

        <footer data-dialog-footer className="flex shrink-0 flex-col gap-3 border-t border-terminal-border bg-terminal-panel-2/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pb-4">
          <div
            className={`flex min-h-5 items-start gap-2 text-xs leading-5 ${
              messageTone === "error"
                ? "text-bear"
                : messageTone === "success"
                  ? "text-bull"
                  : "text-ink-muted"
            }`}
            role={messageTone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {messageTone === "success" && (
              <CheckCircle2 className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
            )}
            {messageTone === "error" && (
              <CircleAlert className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
            )}
            <span>{message}</span>
          </div>
          <button
            type="button"
            disabled={busy || !backendSession}
            onClick={() => void save()}
            className="flex h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-sm font-semibold text-[var(--accent-contrast)] shadow-accent transition-colors hover:bg-brand-hover active:brightness-95 disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={16} aria-hidden="true" />
            )}
            Save settings
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  note,
  configured,
  verified = false,
  children,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  configured: boolean;
  verified?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-terminal-border bg-terminal-panel-2/60 shadow-sm">
      <div className="flex items-start gap-3 border-b border-terminal-border px-4 py-3.5 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-ink">{title}</h3>
            {configured && (
              <span className="inline-flex items-center gap-1 rounded-full border border-terminal-border-strong bg-terminal-panel-3 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                <Check size={11} aria-hidden="true" />
                Configured
              </span>
            )}
            {verified && (
              <span className="inline-flex items-center gap-1 rounded-full border border-bull/20 bg-bull/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bull">
                <ShieldCheck size={11} aria-hidden="true" />
                Verified
              </span>
            )}
          </div>
          <p className="mt-1 text-xs leading-5 text-ink-muted">{note}</p>
        </div>
      </div>
      <div className="space-y-4 px-4 py-4 sm:px-5">{children}</div>
    </section>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        className={fieldClassName}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Secret({
  label,
  configured,
  value,
  onChange,
  onClear,
  emptyPlaceholder = "Not configured",
}: {
  label: string;
  configured: boolean;
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  emptyPlaceholder?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        type="password"
        autoComplete="new-password"
        aria-describedby={configured ? hintId : undefined}
        className={fieldClassName}
        value={value}
        placeholder={configured ? "Configured — enter to replace" : emptyPlaceholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {configured && (
        <div
          id={hintId}
          className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] leading-5"
        >
          <span className="inline-flex items-center gap-1.5 text-bull">
            <CheckCircle2 size={13} aria-hidden="true" />
            A secret is stored securely
          </span>
          <button
            type="button"
            onClick={onClear}
            className="min-h-9 rounded-lg px-2 text-bear transition-colors hover:bg-bear/10 active:bg-bear/15 sm:min-h-8"
          >
            Clear saved secret
          </button>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex min-h-11 items-center gap-3 rounded-xl px-1 text-left text-sm font-medium text-ink transition-colors hover:text-brand"
    >
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          checked
            ? "border-brand bg-brand"
            : "border-terminal-border-strong bg-terminal-bg"
        }`}
        aria-hidden="true"
      >
        <span
          className={`absolute top-0.5 h-[18px] w-[18px] rounded-full bg-[var(--accent-contrast)] shadow-sm transition-transform ${
            checked ? "translate-x-[20px]" : "translate-x-0.5"
          }`}
        />
      </span>
      <span>{label}</span>
    </button>
  );
}

function TestButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-terminal-border-strong bg-terminal-panel-3 px-4 text-sm font-semibold text-ink transition-colors hover:border-brand/40 hover:bg-terminal-hover hover:text-brand active:bg-terminal-pressed disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
    >
      <Send size={15} aria-hidden="true" />
      Save & send test
    </button>
  );
}
