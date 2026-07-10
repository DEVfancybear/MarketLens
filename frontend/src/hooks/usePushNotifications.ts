"use client";
import { useCallback, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { backendSessionAtom } from "@/store/authStore";
import {
  clearPushRegistrationAtom,
  hydratePushAtom,
  pushErrorAtom,
  pushPermissionAtom,
  pushRegistrationAtom,
  pushStatusAtom,
  setPushCapabilityAtom,
  setPushErrorAtom,
  setPushRegisteringAtom,
  setPushRegistrationAtom,
} from "@/store/notificationStore";
import {
  getPushCapability,
  registerPushToken,
  unregisterServerPushToken,
  unregisterPushToken,
} from "@/services/notifications/push";

export function usePushNotifications() {
  const registration = useAtomValue(pushRegistrationAtom);
  const status = useAtomValue(pushStatusAtom);
  const permission = useAtomValue(pushPermissionAtom);
  const error = useAtomValue(pushErrorAtom);
  const backendSession = useAtomValue(backendSessionAtom);

  const hydrate = useSetAtom(hydratePushAtom);
  const setCapability = useSetAtom(setPushCapabilityAtom);
  const setRegistering = useSetAtom(setPushRegisteringAtom);
  const setRegistration = useSetAtom(setPushRegistrationAtom);
  const clearRegistration = useSetAtom(clearPushRegistrationAtom);
  const setError = useSetAtom(setPushErrorAtom);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const refresh = useCallback(async () => {
    const capability = await getPushCapability();
    const nextStatus = !capability.supported
      ? "unsupported"
      : !capability.configured
        ? "unconfigured"
        : capability.permission === "denied"
          ? "denied"
          : registration
            ? "enabled"
            : "idle";
    setCapability(nextStatus, capability.permission, capability.error ?? null);
    return capability;
  }, [registration, setCapability]);

  const enable = useCallback(async () => {
    setRegistering();
    try {
      const next = await registerPushToken(backendSession);
      setRegistration(next);
      return next;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to enable push.";
      setError(message);
      throw err;
    }
  }, [backendSession, setError, setRegistering, setRegistration]);

  const disable = useCallback(async () => {
    const token = registration?.token;
    await unregisterPushToken();
    if (token) await unregisterServerPushToken(token, backendSession);
    clearRegistration();
  }, [backendSession, clearRegistration, registration?.token]);

  return {
    registration,
    status,
    permission,
    error,
    refresh,
    enable,
    disable,
  };
}
