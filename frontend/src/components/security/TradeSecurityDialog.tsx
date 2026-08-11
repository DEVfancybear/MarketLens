"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Eye,
  EyeOff,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { PlatformContentDialog } from "@/components/ui/PlatformDialog";
import { errorMessage, isApiError } from "@/services/api/errors";
import { currentIdToken } from "@/services/auth/firebaseAuth";
import {
  configureTradeSecurity,
  getTradeSecurityStatus,
  lockTradeSession,
  registerTradePasswordPrompt,
  type TradeSecurityStatus,
} from "@/services/security/tradePassword";
import { cn } from "@/utils/cn";

type PromptRequest = {
  error?: string;
  resolve: (password: string | null) => void;
};

const inputClass =
  "h-11 w-full rounded-xl border border-terminal-border-strong bg-terminal-panel px-3 pr-11 text-sm font-medium text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/15";

function validTradePasswordLength(password: string): boolean {
  const characters = Array.from(password).length;
  return (
    characters >= 8 &&
    characters <= 128 &&
    new TextEncoder().encode(password).length <= 512
  );
}

export function TradeSecurityDialog() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [status, setStatus] = useState<TradeSecurityStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [disableConfirmationOpen, setDisableConfirmationOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [showDisablePassword, setShowDisablePassword] = useState(false);
  const [prompt, setPrompt] = useState<PromptRequest | null>(null);
  const [promptPassword, setPromptPassword] = useState("");
  const [showPromptPassword, setShowPromptPassword] = useState(false);
  const promptRef = useRef<PromptRequest | null>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const currentPasswordInputRef = useRef<HTMLInputElement>(null);
  const disablePasswordInputRef = useRef<HTMLInputElement>(null);
  const protectionSwitchRef = useRef<HTMLButtonElement>(null);

  const requestPassword = useCallback((error?: string) => {
    return new Promise<string | null>((resolve) => {
      promptRef.current?.resolve(null);
      const request = { error, resolve };
      promptRef.current = request;
      setPromptPassword("");
      setShowPromptPassword(false);
      setPrompt(request);
    });
  }, []);

  const settlePrompt = useCallback((password: string | null) => {
    const current = promptRef.current;
    promptRef.current = null;
    setPrompt(null);
    setPromptPassword("");
    setShowPromptPassword(false);
    current?.resolve(password);
  }, []);

  useEffect(() => {
    registerTradePasswordPrompt(requestPassword);
    return () => {
      registerTradePasswordPrompt(null);
      promptRef.current?.resolve(null);
      promptRef.current = null;
    };
  }, [requestPassword]);

  useEffect(() => {
    const open = () => setSettingsOpen(true);
    window.addEventListener("trade-security-settings-open", open);
    return () => window.removeEventListener("trade-security-settings-open", open);
  }, []);

  useEffect(() => {
    if (!settingsOpen) return;
    setLoading(true);
    setSettingsError("");
    setNewPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setShowNewPassword(false);
    setShowCurrentPassword(false);
    setDisableConfirmationOpen(false);
    setDisablePassword("");
    setShowDisablePassword(false);
    void getTradeSecurityStatus()
      .then(setStatus)
      .catch((error) =>
        setSettingsError(errorMessage(error, "Could not load trade security.")),
      )
      .finally(() => setLoading(false));
  }, [settingsOpen]);

  useEffect(() => {
    if (!prompt) return;
    const frame = requestAnimationFrame(() => promptInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [prompt]);

  useEffect(() => {
    if (!disableConfirmationOpen) return;
    const frame = requestAnimationFrame(() =>
      disablePasswordInputRef.current?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [disableConfirmationOpen]);

  const saveConfiguration = useCallback(
    async (configuration: {
      enabled: boolean;
      password?: string;
      currentPassword?: string;
    }): Promise<boolean> => {
      setSaving(true);
      setSettingsError("");
      try {
        const idToken = await currentIdToken(true);
        if (!idToken) throw new Error("Sign in again to change trade security.");
        const next = await configureTradeSecurity({
          ...configuration,
          idToken,
        });
        setStatus(next);
        setNewPassword("");
        setConfirmPassword("");
        setCurrentPassword("");
        setDisablePassword("");
        setShowNewPassword(false);
        setShowCurrentPassword(false);
        setShowDisablePassword(false);
        return true;
      } catch (error) {
        if (isApiError(error) && error.status === 403) {
          setSettingsError("Incorrect trade password. Please try again.");
        } else if (isApiError(error) && error.status === 428) {
          setSettingsError("Enter your current trade password.");
        } else {
          setSettingsError(
            errorMessage(error, "Could not update trade security."),
          );
        }
        return false;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const validateNewPassword = () => {
    if (!validTradePasswordLength(newPassword)) {
      setSettingsError("Use 8-128 characters for the trade password.");
      return false;
    }
    if (newPassword !== confirmPassword) {
      setSettingsError("The password confirmation does not match.");
      return false;
    }
    return true;
  };

  const toggleProtection = () => {
    if (!status || saving) return;
    if (status.enabled) {
      if (disableConfirmationOpen) {
        cancelDisableConfirmation();
        return;
      }
      setSettingsError("");
      setCurrentPassword("");
      setShowCurrentPassword(false);
      setDisablePassword("");
      setShowDisablePassword(false);
      setDisableConfirmationOpen(true);
      return;
    }
    const nextEnabled = !status.enabled;
    if (nextEnabled && !status.configured) {
      if (!validateNewPassword()) return;
      void saveConfiguration({ enabled: true, password: newPassword });
      return;
    }
    void saveConfiguration({ enabled: nextEnabled });
  };

  const lockSession = async () => {
    setSaving(true);
    setSettingsError("");
    try {
      await lockTradeSession();
      setStatus((current) =>
        current ? { ...current, unlocked: false } : current,
      );
    } catch (error) {
      setSettingsError(errorMessage(error, "Could not lock this trade session."));
    } finally {
      setSaving(false);
    }
  };

  const submitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    if (!status || !validateNewPassword()) return;
    const requiresCurrentPassword = status.enabled && status.configured;
    if (requiresCurrentPassword && currentPassword.length === 0) {
      setSettingsError("Enter your current trade password.");
      currentPasswordInputRef.current?.focus();
      return;
    }
    const saved = await saveConfiguration({
      enabled: status.configured ? status.enabled : true,
      password: newPassword,
      currentPassword: currentPassword || undefined,
    });
    if (!saved && requiresCurrentPassword) {
      setCurrentPassword("");
      setShowCurrentPassword(false);
      requestAnimationFrame(() => currentPasswordInputRef.current?.focus());
    }
  };

  const submitDisableProtection = async (event: FormEvent) => {
    event.preventDefault();
    if (!disablePassword) {
      setSettingsError("Enter your current trade password.");
      disablePasswordInputRef.current?.focus();
      return;
    }
    const saved = await saveConfiguration({
      enabled: false,
      currentPassword: disablePassword,
    });
    setDisablePassword("");
    if (saved) {
      setDisableConfirmationOpen(false);
      requestAnimationFrame(() => protectionSwitchRef.current?.focus());
    } else {
      setShowDisablePassword(false);
      requestAnimationFrame(() => disablePasswordInputRef.current?.focus());
    }
  };

  function cancelDisableConfirmation() {
    if (saving) return;
    setDisableConfirmationOpen(false);
    setDisablePassword("");
    setShowDisablePassword(false);
    setSettingsError("");
    requestAnimationFrame(() => protectionSwitchRef.current?.focus());
  }

  const closeSettings = () => {
    if (saving) return;
    setSettingsOpen(false);
    setSettingsError("");
    setNewPassword("");
    setConfirmPassword("");
    setCurrentPassword("");
    setShowNewPassword(false);
    setShowCurrentPassword(false);
    setDisableConfirmationOpen(false);
    setDisablePassword("");
    setShowDisablePassword(false);
  };

  const dismissSettings = () => {
    if (disableConfirmationOpen) {
      cancelDisableConfirmation();
      return;
    }
    closeSettings();
  };

  return (
    <>
      <PlatformContentDialog
        open={settingsOpen}
        onClose={dismissSettings}
        title="Trade security"
        description="Optional second password for live orders and execution actions."
        closeLabel={
          disableConfirmationOpen ? "Cancel turning off protection" : "Close"
        }
        footer={
          <button
            type="button"
            disabled={saving}
            onClick={dismissSettings}
            className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-60 focus-ring"
          >
            {disableConfirmationOpen ? "Cancel" : "Close"}
          </button>
        }
      >
        {loading ? (
          <div className="flex min-h-40 items-center justify-center text-ink-muted">
            <LoaderCircle size={22} className="animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            <section className="rounded-2xl border border-terminal-border bg-terminal-panel-2/40 p-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span
                    className={cn(
                      "mt-0.5 rounded-xl p-2",
                      status?.enabled
                        ? "bg-bull/10 text-bull"
                        : "bg-terminal-hover text-ink-muted",
                    )}
                  >
                    {status?.enabled ? (
                      <ShieldCheck size={19} />
                    ) : (
                      <ShieldOff size={19} />
                    )}
                  </span>
                  <div>
                    <strong className="block text-sm text-ink">
                      Require trade password
                    </strong>
                    <p
                      id="trade-security-state-description"
                      className="mt-1 text-xs leading-5 text-ink-muted"
                    >
                      {status?.enabled
                        ? status.unlocked
                          ? "Unlocked for this browser session and its tabs."
                          : "The first live trade in this browser asks for the password."
                        : "Orders continue without a second password."}
                    </p>
                  </div>
                </div>
                <button
                  ref={protectionSwitchRef}
                  type="button"
                  role="switch"
                  aria-checked={status?.enabled ?? false}
                  aria-label="Require trade password"
                  aria-describedby="trade-security-state-description"
                  aria-expanded={
                    status?.enabled ? disableConfirmationOpen : undefined
                  }
                  aria-controls={
                    disableConfirmationOpen
                      ? "disable-trade-password-form"
                      : undefined
                  }
                  disabled={!status || saving}
                  onClick={toggleProtection}
                  className={cn(
                    "relative h-7 w-12 shrink-0 rounded-full border transition-colors motion-reduce:transition-none focus-ring disabled:opacity-50",
                    status?.enabled
                      ? "border-brand bg-brand"
                      : "border-terminal-border-strong bg-terminal-panel",
                  )}
                >
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none",
                      status?.enabled ? "translate-x-5" : "translate-x-0",
                    )}
                  />
                </button>
              </div>
            </section>

            {disableConfirmationOpen ? (
              <form
                id="disable-trade-password-form"
                className="space-y-4 rounded-2xl border border-bear/25 bg-bear/5 p-4"
                onSubmit={(event) => void submitDisableProtection(event)}
              >
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-bear/10 p-2 text-bear">
                    <ShieldOff size={18} />
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-ink">
                      Confirm turning off protection
                    </h3>
                    <p
                      id="disable-trade-password-description"
                      className="mt-1 text-xs leading-5 text-ink-muted"
                    >
                      Enter your current trade password to turn off protection
                      for live orders and execution actions.
                    </p>
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="disable-trade-password"
                    className="mb-1.5 block text-xs font-semibold text-ink-muted"
                  >
                    Current trade password
                  </label>
                  <div className="relative">
                    <input
                      ref={disablePasswordInputRef}
                      id="disable-trade-password"
                      type={showDisablePassword ? "text" : "password"}
                      autoComplete="current-password"
                      maxLength={512}
                      value={disablePassword}
                      onChange={(event) =>
                        setDisablePassword(event.target.value)
                      }
                      aria-invalid={settingsError.length > 0}
                      aria-describedby={
                        settingsError
                          ? "disable-trade-password-description trade-security-settings-error"
                          : "disable-trade-password-description"
                      }
                      className={inputClass}
                    />
                    <PasswordVisibilityButton
                      visible={showDisablePassword}
                      onClick={() =>
                        setShowDisablePassword((value) => !value)
                      }
                    />
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={cancelDisableConfirmation}
                    className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-50 focus-ring"
                  >
                    Keep protection on
                  </button>
                  <button
                    type="submit"
                    disabled={saving || disablePassword.length === 0}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-bear px-4 text-sm font-semibold text-white hover:bg-bear/90 disabled:opacity-50 focus-ring"
                  >
                    {saving && <LoaderCircle size={15} className="animate-spin" />}
                    Turn off protection
                  </button>
                </div>
              </form>
            ) : (
              <>
                {status?.enabled && status.unlocked && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void lockSession()}
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover disabled:opacity-50 focus-ring"
                  >
                    <ShieldOff size={15} />
                    Lock this browser now
                  </button>
                )}

                <form
                  id="trade-password-settings-form"
                  className="space-y-3"
                  onSubmit={(event) => void submitPasswordChange(event)}
                >
                  {status?.configured && status.enabled && (
                    <div>
                      <label
                        htmlFor="current-trade-password"
                        className="mb-1.5 block text-xs font-semibold text-ink-muted"
                      >
                        Current trade password
                      </label>
                      <div className="relative">
                        <input
                          ref={currentPasswordInputRef}
                          id="current-trade-password"
                          type={showCurrentPassword ? "text" : "password"}
                          autoComplete="current-password"
                          maxLength={512}
                          value={currentPassword}
                          onChange={(event) =>
                            setCurrentPassword(event.target.value)
                          }
                          aria-invalid={settingsError.length > 0}
                          aria-describedby={
                            settingsError
                              ? "trade-security-settings-error"
                              : undefined
                          }
                          className={inputClass}
                        />
                        <PasswordVisibilityButton
                          visible={showCurrentPassword}
                          onClick={() =>
                            setShowCurrentPassword((value) => !value)
                          }
                        />
                      </div>
                    </div>
                  )}
                  <div>
                    <label
                      htmlFor="new-trade-password"
                      className="mb-1.5 block text-xs font-semibold text-ink-muted"
                    >
                      {status?.configured
                        ? "New trade password"
                        : "Trade password"}
                    </label>
                    <div className="relative">
                      <input
                        id="new-trade-password"
                        type={showNewPassword ? "text" : "password"}
                        autoComplete="new-password"
                        minLength={8}
                        maxLength={512}
                        value={newPassword}
                        onChange={(event) => setNewPassword(event.target.value)}
                        aria-invalid={settingsError.length > 0}
                        aria-describedby={
                          settingsError
                            ? "trade-password-guidance trade-security-settings-error"
                            : "trade-password-guidance"
                        }
                        className={inputClass}
                      />
                      <PasswordVisibilityButton
                        visible={showNewPassword}
                        onClick={() =>
                          setShowNewPassword((value) => !value)
                        }
                      />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="confirm-trade-password"
                      className="mb-1.5 block text-xs font-semibold text-ink-muted"
                    >
                      Confirm trade password
                    </label>
                    <input
                      id="confirm-trade-password"
                      type={showNewPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={512}
                      value={confirmPassword}
                      onChange={(event) =>
                        setConfirmPassword(event.target.value)
                      }
                      aria-invalid={settingsError.length > 0}
                      aria-describedby={
                        settingsError
                          ? "trade-password-guidance trade-security-settings-error"
                          : "trade-password-guidance"
                      }
                      className={inputClass}
                    />
                  </div>
                  <p
                    id="trade-password-guidance"
                    className="text-[11px] leading-4 text-ink-faint"
                  >
                    Use 8-128 characters. Spaces and password-manager paste are
                    supported. The password is never saved in this browser.
                  </p>
                  <button
                    type="submit"
                    disabled={
                      !status ||
                      saving ||
                      newPassword.length === 0 ||
                      confirmPassword.length === 0 ||
                      (status.configured &&
                        status.enabled &&
                        currentPassword.length === 0)
                    }
                    className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:opacity-50 focus-ring"
                  >
                    {saving ? (
                      <LoaderCircle size={15} className="animate-spin" />
                    ) : (
                      <KeyRound size={15} />
                    )}
                    {status?.configured
                      ? "Update password"
                      : "Set password and enable"}
                  </button>
                </form>
              </>
            )}

            {settingsError && (
              <p
                id="trade-security-settings-error"
                role="alert"
                className="rounded-xl border border-bear/25 bg-bear/10 px-3 py-2 text-xs leading-5 text-bear"
              >
                {settingsError}
              </p>
            )}
          </div>
        )}
      </PlatformContentDialog>

      <PlatformContentDialog
        open={prompt !== null}
        onClose={() => settlePrompt(null)}
        title="Approve trade"
        description="Enter once to unlock live trading for this browser session."
        footer={
          <>
            <button
              type="button"
              onClick={() => settlePrompt(null)}
              className="min-h-10 rounded-xl border border-terminal-border-strong px-4 text-sm font-semibold text-ink hover:bg-terminal-hover focus-ring"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="trade-password-approval-form"
              disabled={promptPassword.length === 0}
              className="min-h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-[var(--accent-contrast)] hover:bg-brand-hover disabled:opacity-50 focus-ring"
            >
              Approve
            </button>
          </>
        }
      >
        <form
          id="trade-password-approval-form"
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (promptPassword) settlePrompt(promptPassword);
          }}
        >
          <label
            htmlFor="trade-password-approval"
            className="block text-xs font-semibold text-ink-muted"
          >
            Trade password
          </label>
          <div className="relative">
            <input
              ref={promptInputRef}
              id="trade-password-approval"
              type={showPromptPassword ? "text" : "password"}
              autoComplete="current-password"
              maxLength={512}
              value={promptPassword}
              onChange={(event) => setPromptPassword(event.target.value)}
              aria-invalid={Boolean(prompt?.error)}
              aria-describedby={
                prompt?.error ? "trade-password-approval-error" : undefined
              }
              className={inputClass}
            />
            <PasswordVisibilityButton
              visible={showPromptPassword}
              onClick={() => setShowPromptPassword((value) => !value)}
            />
          </div>
          {prompt?.error && (
            <p
              id="trade-password-approval-error"
              role="alert"
              className="text-xs font-medium text-bear"
            >
              {prompt.error}
            </p>
          )}
        </form>
      </PlatformContentDialog>
    </>
  );
}

function PasswordVisibilityButton({
  visible,
  onClick,
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-terminal-hover hover:text-ink focus-ring"
      aria-label={visible ? "Hide password" : "Show password"}
    >
      {visible ? <EyeOff size={16} /> : <Eye size={16} />}
    </button>
  );
}
