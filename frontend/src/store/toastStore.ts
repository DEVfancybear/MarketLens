"use client";
/**
 * Toast store — transient in-app notifications rendered by <Toaster/>.
 * Generic (used by the Alert Engine today; usable anywhere). Client-only, no
 * persistence. Auto-dismiss is handled by the Toaster component.
 */
import { atom, getDefaultStore } from "jotai";
import { uid } from "@/utils/id";

export type ToastVariant = "info" | "success" | "warn" | "error" | "alert";

export interface Toast {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
  createdAt: number;
  /** Auto-dismiss after this many ms (0 = sticky). */
  duration: number;
}

export interface PushToastInput {
  title: string;
  message?: string;
  variant?: ToastVariant;
  duration?: number;
}

const DEFAULT_DURATION = 6000;
const MAX_TOASTS = 5;

export interface ToastState {
  toasts: Toast[];
}

// ---------------------------------------------------------------------------
// Individual state atoms
// ---------------------------------------------------------------------------
export const toastsAtom = atom<Toast[]>([]);

// ---------------------------------------------------------------------------
// Derived read-only atom (used by compatibility hook)
// ---------------------------------------------------------------------------
export const toastStateAtom = atom<ToastState>((get) => ({
  toasts: get(toastsAtom),
}));

// ---------------------------------------------------------------------------
// Write atoms (actions)
// ---------------------------------------------------------------------------

export const pushToastAtom = atom(null, (_get, set, input: PushToastInput) => {
  const toast: Toast = {
    id: uid("toast"),
    title: input.title,
    message: input.message,
    variant: input.variant ?? "info",
    createdAt: Date.now(),
    duration: input.duration ?? DEFAULT_DURATION,
  };
  set(toastsAtom, (prev) => {
    const duplicate = prev.some(
      (current) =>
        current.title === toast.title &&
        current.message === toast.message &&
        current.variant === toast.variant,
    );
    return duplicate ? prev : [toast, ...prev].slice(0, MAX_TOASTS);
  });
});

export const dismissToastAtom = atom(null, (_get, set, id: string) => {
  set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
});

export const clearToastsAtom = atom(null, (_get, set) => {
  set(toastsAtom, []);
});

// ---------------------------------------------------------------------------
// Non-React accessor — mirrors `useToastStore.getState()` for non-React code.
// ---------------------------------------------------------------------------
export function getToastState() {
  return { toasts: getDefaultStore().get(toastsAtom) };
}

// ---------------------------------------------------------------------------
// Compatibility hook — mirrors `useToastStore(selector?)` from Zustand.
// Prefer `useAtomValue(toastsAtom)` etc. in new code for optimal rendering.
// ---------------------------------------------------------------------------
import { useAtomValue } from "jotai";
import { useMemo } from "react";

export function useToastStore(): ToastState;
export function useToastStore<T>(selector: (state: ToastState) => T): T;
export function useToastStore<T>(
  selector?: (state: ToastState) => T,
): ToastState | T {
  const state = useAtomValue(toastStateAtom);
  if (selector) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMemo(() => selector(state), [state, selector]);
  }
  return state;
}
