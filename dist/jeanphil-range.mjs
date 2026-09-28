const MINUTE = 60_000;

// The period control limits which history is eligible. During startup, zoom the
// shared axis to the small amount already collected and say so in the UI.
export function chartRange(report, hours, now) {
  const selectedStart = now - hours * 3_600_000;
  const times = [...(report.market || []), ...(report.social || [])]
    .map(row => row.at)
    .filter(at => Number.isFinite(at) && at >= selectedStart && at <= now);
  if (!times.length) return {start: selectedStart, end: now, selectedStart, zoomed: false, first: null};
  const first = Math.min(...times);
  if (now - first >= (now - selectedStart) * 0.15) {
    return {start: selectedStart, end: now, selectedStart, zoomed: false, first};
  }
  const start = first - 3 * MINUTE;
  const end = Math.max(now + 2 * MINUTE, start + 15 * MINUTE);
  return {start, end, selectedStart, zoomed: true, first};
}
