"use client";

export type {
  BackendUser,
  ExchangeResult,
} from "@/services/api/resources/authApi";
export {
  backendAuthConfigured,
  backendLogout,
  backendMe,
  backendRefresh,
  ensureBackendGoogleSession,
  exchangeGoogleToken,
} from "@/services/api/resources/authApi";
