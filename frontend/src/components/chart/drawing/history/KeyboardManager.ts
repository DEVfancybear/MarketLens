/**
 * KeyboardManager — centralized keyboard shortcut registry.
 *
 * Register shortcuts with a key combination and a callback.
 * The manager handles input-field exclusion and modifier matching.
 */
export type KeyCombo = {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  meta?: boolean;
};

export interface Shortcut {
  combo: KeyCombo;
  handler: (e: KeyboardEvent) => void;
  /** Optional label for display in a shortcuts panel. */
  label?: string;
}

export class KeyboardManager {
  private shortcuts: Shortcut[] = [];

  register(sc: Shortcut): () => void {
    this.shortcuts.push(sc);
    return () => {
      this.shortcuts = this.shortcuts.filter((s) => s !== sc);
    };
  }

  /** Process a keyboard event. Returns true if a shortcut was handled. */
  handle(e: KeyboardEvent): boolean {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return false;

    for (const sc of this.shortcuts) {
      const c = sc.combo;
      if (
        e.key.toLowerCase() === c.key.toLowerCase() &&
        !!c.ctrl === (e.ctrlKey || e.metaKey) &&
        !!c.shift === e.shiftKey &&
        !!c.alt === e.altKey &&
        !!c.meta === e.metaKey
      ) {
        e.preventDefault();
        sc.handler(e);
        return true;
      }
    }
    return false;
  }

  /** Get all registered shortcuts (for help panel). */
  getAll(): Shortcut[] {
    return [...this.shortcuts];
  }
}
