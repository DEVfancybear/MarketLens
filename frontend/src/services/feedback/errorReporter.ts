"use client";

import { getDefaultStore } from "jotai";
import {
  describeUserFacingError,
  errorMessage,
  isApiError,
  type UserFacingError,
} from "@/services/api/errors";
import { pushToastAtom } from "@/store/toastStore";
import { logAtom } from "@/store/uiStore";

export interface ReportFrontendErrorOptions {
  title: string;
  logPrefix?: string;
  toast?: boolean;
  duration?: number;
}

export function userFacingError(
  error: unknown,
  title: string,
): UserFacingError {
  return describeUserFacingError(error, title);
}

export function userFacingErrorMessage(
  error: unknown,
  fallback = "Unknown error",
): string {
  if (isApiError(error)) {
    return describeUserFacingError(error, "Request failed").message;
  }
  return errorMessage(error, fallback);
}

export function reportFrontendError(
  error: unknown,
  options: ReportFrontendErrorOptions,
): UserFacingError {
  const description = describeUserFacingError(error, options.title);
  const store = getDefaultStore();
  const technicalSuffix = description.technical
    ? ` (${description.technical})`
    : "";
  store.set(
    logAtom,
    "error",
    `${options.logPrefix ?? options.title}: ${description.message}${technicalSuffix}`,
  );

  if (options.toast !== false) {
    store.set(pushToastAtom, {
      title: description.title,
      message: description.message,
      variant: "error",
      duration: options.duration ?? 10_000,
    });
  }

  return description;
}
