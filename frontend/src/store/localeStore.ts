"use client";

import { atom } from "jotai";
import { localStore } from "@/services/storage";
import type { AppLanguage } from "@/i18n/localization";

export const APP_LANGUAGE_STORAGE_KEY = "app-language";

export const appLanguageAtom = atom<AppLanguage>("en");

function isAppLanguage(value: unknown): value is AppLanguage {
  return value === "en" || value === "vi";
}

function browserLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "en";
  return navigator.language.toLowerCase().startsWith("vi") ? "vi" : "en";
}

function applyDocumentLanguage(language: AppLanguage): void {
  if (typeof document !== "undefined") document.documentElement.lang = language;
}

export const hydrateAppLanguageAtom = atom(null, (_get, set) => {
  const stored = localStore.get<unknown>(APP_LANGUAGE_STORAGE_KEY, null);
  const language = isAppLanguage(stored) ? stored : browserLanguage();
  set(appLanguageAtom, language);
  applyDocumentLanguage(language);
});

export const setAppLanguageAtom = atom(
  null,
  (_get, set, language: AppLanguage) => {
    set(appLanguageAtom, language);
    localStore.set(APP_LANGUAGE_STORAGE_KEY, language);
    applyDocumentLanguage(language);
  },
);
