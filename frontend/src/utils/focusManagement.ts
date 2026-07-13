export const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

type FocusTrapEvent = {
  key: string;
  shiftKey: boolean;
  currentTarget: HTMLElement;
  preventDefault: () => void;
};

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      (element.offsetParent !== null || element === document.activeElement),
  );
}

export function focusFirstWithin(
  root: HTMLElement | null,
  preferredSelector?: string,
): void {
  if (!root) return;
  const preferred = preferredSelector
    ? root.querySelector<HTMLElement>(preferredSelector)
    : null;
  (preferred ?? focusableElements(root)[0] ?? root).focus();
}

export function trapFocusWithin(event: FocusTrapEvent): void {
  if (event.key !== "Tab") return;

  const focusable = focusableElements(event.currentTarget);
  if (focusable.length === 0) {
    event.preventDefault();
    event.currentTarget.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
