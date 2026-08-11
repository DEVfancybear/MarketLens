# Shared Platform Dialogs

Frontend decisions and text input must stay inside the terminal UI. Browser-native
`alert()`, `confirm()`, and `prompt()` calls are prohibited because they bypass the
application theme, responsive layout, accessibility contract, and predictable test
automation.

This policy is provider-, broker-, feature-, and viewport-neutral. It applies to all
code under `frontend/src`.

## Choosing the common surface

- Use `usePlatformDialog().requestConfirm` when an action needs a user decision.
- Use `usePlatformDialog().requestPrompt` when an action needs a short text value.
- Use `PlatformContentDialog` for structured or multi-field content.
- Use the shared toast/error-reporting flow for informational success or failure;
  do not turn a one-way notification into a fake confirmation.
- Keep semantic `role="alert"` live regions and the price-alert feature intact.
  They are not browser dialog APIs.

## Promise-based confirmation

Render the hook's `dialog` value from the same mounted component that owns the
request. The returned promise resolves to `false` when the user cancels, presses
Escape, dismisses the backdrop, or the owning component unmounts.

```tsx
const { requestConfirm, dialog } = usePlatformDialog();

const discardChanges = async () => {
  const confirmed = await requestConfirm({
    title: "Discard unsaved changes?",
    description: "Your unsaved settings will be lost.",
    confirmLabel: "Discard changes",
    cancelLabel: "Keep editing",
    tone: "danger",
  });

  if (!confirmed) return;
  resetDraft();
};

return (
  <section>
    <button onClick={() => void discardChanges()}>Discard</button>
    {dialog}
  </section>
);
```

For destructive actions, use `tone: "danger"` and describe the concrete outcome.
The common dialog then focuses the cancel action by default. Neutral confirmations
focus the primary action.

## Accessibility and interaction contract

The shared implementation owns these behaviors; feature code must not recreate
them locally:

- portalled responsive layering above terminal sheets and chart surfaces;
- terminal theme tokens for dark and light modes;
- labelled `dialog` or `alertdialog` semantics;
- Escape cancellation and contained Tab navigation;
- safe initial focus and focus restoration after close;
- at least 40-pixel dialog controls and visible keyboard focus;
- cancellation of a pending promise if its owner unmounts or replaces it.

## Enforcement

`frontend/tests/ui/nativeDialogBoundary.test.ts` parses every JavaScript and
TypeScript source file with the TypeScript AST. It rejects unqualified calls and
calls through `window` or `globalThis` for all three native browser dialog APIs.

Run the boundary with the UI suite:

```bash
cd frontend
npm run test:ui
```

The AST check deliberately does not match comments, strings, object methods, ARIA
roles, or the application's price-alert domain.
