"use client";

import { Languages } from "lucide-react";
import { useAtomValue, useSetAtom } from "jotai";
import { Dropdown, MenuItem } from "@/components/ui/Dropdown";
import {
  APP_LANGUAGE_LABELS,
  type AppLanguage,
} from "@/i18n/localization";
import { useI18n } from "@/hooks/useI18n";
import {
  appLanguageAtom,
  setAppLanguageAtom,
} from "@/store/localeStore";
import { cn } from "@/utils/cn";

export function LanguageMenu({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const language = useAtomValue(appLanguageAtom);
  const setLanguage = useSetAtom(setAppLanguageAtom);
  const { t } = useI18n();

  return (
    <Dropdown
      align="right"
      width={190}
      trigger={(open) => (
        <button
          type="button"
          aria-label={t("language.change")}
          aria-haspopup="menu"
          aria-expanded={open}
          className={cn(
            "flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-ink-muted transition-colors hover:bg-terminal-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60",
            className,
          )}
        >
          <Languages size={15} aria-hidden="true" />
          <span>{compact ? language.toUpperCase() : APP_LANGUAGE_LABELS[language]}</span>
        </button>
      )}
    >
      {(close) => (
        <div role="menu" aria-label={t("language.label")}>
          <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("language.label")}
          </div>
          {(["en", "vi"] as const).map((option: AppLanguage) => (
            <MenuItem
              key={option}
              active={language === option}
              role="menuitemradio"
              aria-checked={language === option}
              onClick={() => {
                setLanguage(option);
                close();
              }}
            >
              <span className="flex-1">
                {option === "en"
                  ? t("language.english")
                  : t("language.vietnamese")}
              </span>
              <span className="text-[10px] uppercase text-ink-faint">
                {option}
              </span>
            </MenuItem>
          ))}
        </div>
      )}
    </Dropdown>
  );
}
