/**
 * Shared numeric-input parsing for drawing settings.
 *
 * React text inputs need to allow temporary drafts such as "", "-", and "."
 * while the user is typing.  `Number("")` returns 0, which is dangerous for
 * position price fields because clearing a target/stop input would immediately
 * move that level to zero.  Keep the draft parser explicit so every settings
 * input can distinguish "not a complete number yet" from a real numeric value.
 */

export function parseNumberDraft(text: string): number | null {
  const value = text.trim();
  if (
    value === "" ||
    value === "-" ||
    value === "+" ||
    value === "." ||
    value === "-." ||
    value === "+."
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
