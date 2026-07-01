"use client";
import { useCallback, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
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
  unregisterPushToken,
} from "@/services/notifications/push";

export function usePushNotifications() {
  const registration = useAtomValue(pushRegistrationAtom);
  const status = useAtomValue(pushStatusAtom);
  const permission = useAtomValue(pushPermissionAtom);
  const error = useAtomValue(pushErrorAtom);

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
      const next = await registerPushToken();
      setRegistration(next);
      return next;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unable to enable push.";
      setError(message);
      throw err;
    }
  }, [setError, setRegistering, setRegistration]);

  const disable = useCallback(async () => {
    await unregisterPushToken();
    clearRegistration();
  }, [clearRegistration]);

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
