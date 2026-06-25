'use client';
/**
 * Toast store — transient in-app notifications rendered by <Toaster/>.
 * Generic (used by the Alert Engine today; usable anywhere). Client-only, no
 * persistence. Auto-dismiss is handled by the Toaster component.
 */
import { create } from 'zustand';
import { uid } from '@/utils/id';

export type ToastVariant = 'info' | 'success' | 'warn' | 'error' | 'alert';

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

interface ToastState {
  toasts: Toast[];
  push: (input: PushToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (input) => {
    const toast: Toast = {
      id: uid('toast'),
      title: input.title,
      message: input.message,
      variant: input.variant ?? 'info',
      createdAt: Date.now(),
      duration: input.duration ?? DEFAULT_DURATION,
    };
    // Newest on top; cap the stack.
    set((s) => ({ toasts: [toast, ...s.toasts].slice(0, MAX_TOASTS) }));
    return toast.id;
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));
