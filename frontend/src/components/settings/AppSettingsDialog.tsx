"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom, useAtomValue } from "jotai";
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
import { backendSessionAtom } from "@/store/authStore";
import { integrationSettingsOpenAtom } from "@/store/integrationSettingsStore";
import {
  getIntegrationSettings,
  saveIntegrationSettings,
  testIntegration,
  type IntegrationSettingsWrite,
} from "@/services/api/resources/integrationsApi";
import { errorMessage } from "@/services/api/errors";

const empty: IntegrationSettingsWrite = {
  mt5: { login: "", server: "", password: "", clearPassword: false },
  telegram: {
    chatId: "",
    botToken: "",
    enabled: false,
    clearBotToken: false,
  },
  discord: { webhookUrl: "", enabled: false, clearWebhook: false },
};

const fieldClassName =
  "h-11 w-full rounded-lg border border-terminal-border-strong bg-terminal-bg px-3 text-base text-ink outline-none transition-[border-color,box-shadow,background-color] placeholder:text-ink-faint hover:border-terminal-border-strong focus:border-brand focus:ring-2 focus:ring-brand/20 sm:h-10 sm:text-sm";

export function AppSettingsDialog() {
  const [open, setOpen] = useAtom(integrationSettingsOpenAtom);
  const backendSession = useAtomValue(backendSessionAtom);
  const [draft, setDraft] = useState<IntegrationSettingsWrite>(empty);
  const [configured, setConfigured] = useState({
    mt5: false,
    telegram: false,
    discord: false,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"success" | "error" | null>(
    null,
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open || !backendSession) return;
    setBusy(true);
    setMessage("");
    setMessageTone(null);
    getIntegrationSettings()
      .then((value) => {
        setDraft({
          mt5: {
            login: value.mt5.login,
            server: value.mt5.server,
            password: "",
            clearPassword: false,
          },
          telegram: {
            chatId: value.telegram.chatId,
            botToken: "",
            enabled: value.telegram.enabled,
            clearBotToken: false,
          },
          discord: {
            webhookUrl: "",
            enabled: value.discord.enabled,
            clearWebhook: false,
          },
        });
        setConfigured({
          mt5: value.mt5.passwordConfigured,
          telegram: value.telegram.botTokenConfigured,
          discord: value.discord.webhookConfigured,
        });
      })
      .catch(() => {
        setMessage("Unable to load integration settings.");
        setMessageTone("error");
      })
      .finally(() => setBusy(false));
  }, [backendSession, open]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

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

  if (!open) return null;

  const applySaved = (
    value: Awaited<ReturnType<typeof saveIntegrationSettings>>,
  ) => {
    setConfigured({
      mt5: value.mt5.passwordConfigured,
      telegram: value.telegram.botTokenConfigured,
      discord: value.discord.webhookConfigured,
    });
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
    setBusy(true);
    setMessage("");
    setMessageTone(null);
    try {
      const value = await saveIntegrationSettings(draft);
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

  const test = async (channel: "telegram" | "discord") => {
    setBusy(true);
    setMessage("");
    setMessageTone(null);
    try {
      const value = await saveIntegrationSettings(draft);
      applySaved(value);
      await testIntegration(channel);
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
      className="fixed inset-0 z-[120] flex items-stretch justify-center bg-[var(--scrim)] sm:items-center sm:p-4 sm:backdrop-blur-sm"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-settings-title"
        aria-describedby="integration-settings-description"
        aria-busy={busy}
        className="flex h-dvh w-full flex-col overflow-hidden bg-terminal-panel text-ink shadow-terminal sm:h-auto sm:max-h-[min(90dvh,820px)] sm:max-w-[760px] sm:rounded-2xl sm:border sm:border-terminal-border-strong"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-terminal-border bg-terminal-panel-2/80 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:pt-5">
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

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
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
            <div className="space-y-4 sm:space-y-5">
              <Section
                icon={<ServerCog size={18} />}
                title="MetaTrader 5"
                note="Credentials are used for runtime provisioning. Reconnect the local bridge after changing the active account."
                configured={configured.mt5}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Login"
                    value={draft.mt5.login}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        mt5: { ...draft.mt5, login: value },
                      })
                    }
                    autoComplete="username"
                  />
                  <Input
                    label="Broker server"
                    value={draft.mt5.server}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        mt5: { ...draft.mt5, server: value },
                      })
                    }
                    autoComplete="off"
                  />
                </div>
                <Secret
                  label="Password"
                  configured={configured.mt5}
                  value={draft.mt5.password}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      mt5: {
                        ...draft.mt5,
                        password: value,
                        clearPassword: false,
                      },
                    })
                  }
                  onClear={() =>
                    setDraft({
                      ...draft,
                      mt5: {
                        ...draft.mt5,
                        password: "",
                        clearPassword: true,
                      },
                    })
                  }
                />
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
                      setDraft({
                        ...draft,
                        telegram: {
                          ...draft.telegram,
                          botToken: value,
                          clearBotToken: false,
                        },
                      })
                    }
                    onClear={() =>
                      setDraft({
                        ...draft,
                        telegram: {
                          ...draft.telegram,
                          botToken: "",
                          clearBotToken: true,
                        },
                      })
                    }
                    emptyPlaceholder="Example: 123456789:AA..."
                  />
                  <Input
                    label="Chat ID"
                    value={draft.telegram.chatId}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        telegram: { ...draft.telegram, chatId: value },
                      })
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
                      setDraft({
                        ...draft,
                        telegram: { ...draft.telegram, enabled: value },
                      })
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
                    setDraft({
                      ...draft,
                      discord: {
                        ...draft.discord,
                        webhookUrl: value,
                        clearWebhook: false,
                      },
                    })
                  }
                  onClear={() =>
                    setDraft({
                      ...draft,
                      discord: {
                        ...draft.discord,
                        webhookUrl: "",
                        clearWebhook: true,
                      },
                    })
                  }
                />
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Toggle
                    label="Enable Discord alerts"
                    checked={draft.discord.enabled}
                    onChange={(value) =>
                      setDraft({
                        ...draft,
                        discord: { ...draft.discord, enabled: value },
                      })
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
            </div>
          )}
        </div>

        <footer className="flex shrink-0 flex-col gap-3 border-t border-terminal-border bg-terminal-panel-2/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:pb-4">
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
  children,
}: {
  icon: ReactNode;
  title: string;
  note: string;
  configured: boolean;
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
              <span className="inline-flex items-center gap-1 rounded-full border border-bull/20 bg-bull/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-bull">
                <Check size={11} aria-hidden="true" />
                Configured
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
