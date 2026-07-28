# English/Vietnamese Localization

Last updated: 2026-07-29.

## User contract

- The terminal supports English (`en-US`) and Vietnamese (`vi-VN`).
- The selector is always available in the desktop top bar and under
  **Preferences / Tùy chọn** on mobile.
- The choice is stored in `localStorage` under `app-language`, survives reloads,
  and updates the document `lang` attribute.
- The first visit follows the browser language when it begins with `vi`;
  otherwise it defaults to English.
- Locale changes only presentation. Symbol IDs, drawing IDs, saved layouts,
  scripts, account names, user notes, Unix candle timestamps, and backend
  payloads are never translated.

## Ownership

| Layer | Owner | Purpose |
| --- | --- | --- |
| Locale state | `src/store/localeStore.ts` | Detect, persist, and apply `en` / `vi` |
| Typed product copy | `src/i18n/localization.ts` | Core navigation, mobile, and drawing terminology |
| React access | `src/hooks/useI18n.ts` | Reactive `t`, locale, tool/group/section helpers |
| Existing-copy boundary | `src/i18n/documentLocalization.ts` | Exact legacy UI strings, accessibility attributes, and bounded count patterns |
| Controls | `LanguageMenu.tsx`, `MobileMenuScreen.tsx` | Desktop and mobile selection |

New components should use `useI18n` and typed semantic keys. The document
boundary is a compatibility layer for existing dialogs and must only contain
exact product copy or narrowly bounded UI patterns. Do not add generic
sentence translation, remote content, log payloads, symbol names, or user data.

## TradingView terminology

Vietnamese drawing names follow TradingView's Vietnamese Help Center. Important
canonical terms include:

- Drawing tools → **Công cụ vẽ**
- Trend line → **Đường xu hướng**
- Fib Retracement → **Fibonacci thoái lui**
- Long/Short position → **Vị thế mua / Vị thế bán**
- Bar Replay → **Chế độ Phát lại thanh**
- Magnet → **Nam châm**
- Lock all drawings → **Khóa tất cả hình vẽ**
- Object Tree → **Cây đối tượng**

Stable drawing IDs remain English implementation identifiers. Localization
maps labels by ID, so switching languages cannot invalidate saved drawings,
favorites, templates, alerts, or synchronization scope.

## Verification

```powershell
cd frontend
npm run check:i18n
npm run typecheck
npm run build
```

Browser QA must verify both desktop and mobile, switch EN → VI → EN, reload
after each selection, open at least one drawing group, and search for a tool
using both its English and Vietnamese names.
