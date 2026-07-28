"use client";

import { useCallback } from "react";
import { useAtomValue } from "jotai";
import {
  APP_LOCALES,
  drawingGroupName,
  drawingSectionName,
  drawingSyncModeText,
  drawingToolName,
  translate,
  type Translate,
} from "@/i18n/localization";
import { appLanguageAtom } from "@/store/localeStore";
import type {
  DrawingTool,
  DrawingToolGroupId,
} from "@/types/drawingToolManifest";

export function useI18n() {
  const language = useAtomValue(appLanguageAtom);
  const t: Translate = useCallback(
    (key, variables) => translate(language, key, variables),
    [language],
  );

  return {
    language,
    locale: APP_LOCALES[language],
    t,
    drawingToolName: useCallback(
      (tool: DrawingTool, englishName: string) =>
        drawingToolName(language, tool, englishName),
      [language],
    ),
    drawingGroupName: useCallback(
      (group: DrawingToolGroupId, englishName: string) =>
        drawingGroupName(language, group, englishName),
      [language],
    ),
    drawingSectionName: useCallback(
      (section: string | undefined) => drawingSectionName(language, section),
      [language],
    ),
    drawingSyncModeText: useCallback(
      (
        id: "chart-only" | "layout-symbol" | "global",
        english: { label: string; description: string },
      ) => drawingSyncModeText(language, id, english),
      [language],
    ),
  };
}
