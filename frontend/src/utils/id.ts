/** Compact unique id generator (no external dependency). */
let counter = 0;

export function uid(prefix = 'id'): string {
  counter = (counter + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}
