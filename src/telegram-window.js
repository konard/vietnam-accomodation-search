// A rolling window uses UTC instants, so leap months and DST cannot shorten it.
export function telegramHistoryWindow({
  now = new Date(),
  historyDays = 90,
  since,
} = {}) {
  const end = new Date(now);
  const start =
    since === undefined
      ? new Date(end.getTime() - historyDays * 86400000)
      : new Date(since);
  if (
    !Number.isFinite(end.getTime()) ||
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(historyDays) ||
    historyDays <= 0 ||
    start > end
  ) {
    throw new TypeError(
      'Telegram history requires a valid reference time and positive rolling window.'
    );
  }
  return { now: end, since: start, historyDays: (end - start) / 86400000 };
}
