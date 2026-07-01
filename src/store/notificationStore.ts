"use client";
import { atom, useAtomValue } from "jotai";
import { getDefaultStore } from "jotai";
import { localStore } from "@/services/storage";

export type PushPermission = NotificationPermission | "unsupported";

export type PushStatus =
  | "unsupported"
  | "unconfigured"
  | "idle"
  | "registering"
  | "enabled"
  | "denied"
  | "error";

export interface PushRegistration {
  token: string;
  permission: NotificationPermission;
  createdAt: number;
  updatedAt: number;
}

interface PersistShape {
  registration: PushRegistration | null;
}

const STORAGE_KEY = "pushNotifications";

export const pushRegistrationAtom = atom<PushRegistration | null>(null);
export const pushStatusAtom = atom<PushStatus>("idle");
export const pushPermissionAtom = atom<PushPermission>("unsupported");
export const pushErrorAtom = atom<string | null>(null);

function persist() {
  const store = getDefaultStore();
  localStore.set<PersistShape>(STORAGE_KEY, {
    registration: store.get(pushRegistrationAtom),
  });
}

export const hydratePushAtom = atom(null, (_get, set) => {
  const saved = localStore.get<PersistShape | null>(STORAGE_KEY, null);
  if (saved?.registration) {
    set(pushRegistrationAtom, saved.registration);
    set(pushStatusAtom, "enabled");
  }
});

export const setPushCapabilityAtom = atom(
  null,
  (
    _get,
    set,
    status: PushStatus,
    permission: PushPermission,
    error?: string | null,
  ) => {
    set(pushStatusAtom, status);
    set(pushPermissionAtom, permission);
    set(pushErrorAtom, error ?? null);
  },
);

export const setPushRegistrationAtom = atom(
  null,
  (_get, set, registration: PushRegistration) => {
    set(pushRegistrationAtom, registration);
    set(pushStatusAtom, "enabled");
    set(pushPermissionAtom, registration.permission);
    set(pushErrorAtom, null);
    persist();
  },
);

export const clearPushRegistrationAtom = atom(null, (_get, set) => {
  set(pushRegistrationAtom, null);
  set(pushStatusAtom, "idle");
  set(pushErrorAtom, null);
  persist();
});

export const setPushRegisteringAtom = atom(null, (_get, set) => {
  set(pushStatusAtom, "registering");
  set(pushErrorAtom, null);
});

export const setPushErrorAtom = atom(null, (_get, set, error: string) => {
  set(pushStatusAtom, "error");
  set(pushErrorAtom, error);
});

interface NotificationState {
  pushRegistration: PushRegistration | null;
  pushStatus: PushStatus;
  pushPermission: PushPermission;
  pushError: string | null;
}

const notificationStateAtom = atom<NotificationState>((get) => ({
  pushRegistration: get(pushRegistrationAtom),
  pushStatus: get(pushStatusAtom),
  pushPermission: get(pushPermissionAtom),
  pushError: get(pushErrorAtom),
}));

export function useNotificationStore(): NotificationState;
export function useNotificationStore<T>(selector: (state: NotificationState) => T): T;
export function useNotificationStore<T>(
  selector?: (state: NotificationState) => T,
): NotificationState | T {
  const state = useAtomValue(notificationStateAtom);
  if (!selector) return state;
  return selector(state);
}
