/** Presentation helpers shared by the widget components. */

/** Render a 0..1 focus factor / fraction as a percentage, e.g. 0.72 → "72%". */
export function formatPercent(value: number, precision = 0): string {
  const factor = 10 ** precision;
  const pct = Math.round(value * 100 * factor) / factor;
  return `${pct}%`;
}

/** Render a nullable focus factor, using an em dash when unavailable. */
export function formatFocusFactor(value: number | null): string {
  return value === null ? '—' : formatPercent(value);
}

/** Format a UTC epoch-ms timestamp as a locale date-time, or an em dash when null. */
export function formatTimestamp(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleString();
}
