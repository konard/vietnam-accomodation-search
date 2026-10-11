// Read-only selection through the same final search filters used by delivery.
// Never add synthetic offers to a real-source acceptance run.
export async function selectRealPhotoCandidate(
  service,
  store,
  diagnostics,
  { now = new Date(), maxAgeMs = 6 * 60 * 60 * 1000, maxCandidates = 250 } = {}
) {
  const candidates = (await store.listOffers()).filter(
    (offer) =>
      offer.photos?.length &&
      offer.cachedPhotos?.length &&
      offer.attributes?.reviewRequired !== true
  );
  diagnostics.storedPhotoCandidates = candidates.length;
  diagnostics.selection = 'no-eligible-search-result';
  diagnostics.ineligiblePhotoCandidates = 0;
  for (const stored of candidates.slice(0, maxCandidates)) {
    const { offers } = await service.searchWithReport({
      query: '',
      refresh: false,
      limit: 1,
      filters: { id: stored.id },
    });
    const candidate = offers.find((offer) => {
      const age = now.getTime() - new Date(offer.collectedAt).getTime();
      return (
        offer.photos?.length &&
        offer.cachedPhotos?.length &&
        offer.attributes?.reviewRequired !== true &&
        Number.isFinite(age) &&
        age >= 0 &&
        age <= maxAgeMs
      );
    });
    if (candidate) {
      diagnostics.selection = 'eligible-search-result';
      return candidate;
    }
    diagnostics.ineligiblePhotoCandidates += 1;
  }
  if (candidates.length > maxCandidates) {
    diagnostics.selection = 'candidate-budget-exhausted';
  }
  return undefined;
}

export function observeNotificationSearch(result, offers) {
  result.notificationSearchOffers = offers.length;
  if (!offers.length) {
    result.notificationFailure = 'empty-search-result';
  }
}

export function observePhotoNotification(result, method, response) {
  if (!method.startsWith('send')) {
    return;
  }
  if (['sendPhoto', 'sendMediaGroup'].includes(method)) {
    result.notificationMediaAttempts =
      (result.notificationMediaAttempts || 0) + 1;
    if (!response.ok) {
      result.notificationMediaRejected =
        (result.notificationMediaRejected || 0) + 1;
      result.notificationFailure = 'bot-api-media-rejected';
    }
  }
  if (response.ok) {
    const messages = Array.isArray(response.result)
      ? response.result
      : [response.result];
    result.notificationPhotoDelivered ||= messages.some(
      (message) => message?.photo?.length > 0
    );
    if (!result.notificationPhotoDelivered) {
      result.notificationFailure ||= 'text-only-fallback';
    } else {
      result.notificationFailure = undefined;
    }
  }
}
