// Provider dates can be Unix seconds, JavaScript Dates, or ISO strings.
export function chronologyTimestamp(value) {
  const milliseconds =
    typeof value === 'number' && Math.abs(value) < 1e12 ? value * 1000 : value;
  const result = new Date(milliseconds ?? 0).getTime();
  return Number.isFinite(result) ? result : 0;
}

function effectiveTimestamp(offer) {
  return (
    Math.max(
      chronologyTimestamp(offer.updatedAt),
      chronologyTimestamp(offer.postedAt),
      chronologyTimestamp(offer.provenance?.editedAt),
      chronologyTimestamp(offer.raw?.editDate ?? offer.raw?.edit_date)
    ) || chronologyTimestamp(offer.collectedAt ?? offer.observedAt)
  );
}

// Old source history stays old when collected again. Re-observation resolves
// copies of the same source state; stable record content resolves unknown ties.
export function compareOfferChronology(left, right) {
  const leftTime = effectiveTimestamp(left);
  const rightTime = effectiveTimestamp(right);
  if (!leftTime && !rightTime) {
    return 0; // Legacy undated records retain the caller's replacement order.
  }
  return (
    leftTime - rightTime ||
    chronologyTimestamp(left.collectedAt ?? left.observedAt) -
      chronologyTimestamp(right.collectedAt ?? right.observedAt) ||
    String(left.id || '').localeCompare(String(right.id || ''), 'en') ||
    JSON.stringify(left).localeCompare(JSON.stringify(right), 'en')
  );
}
