export async function offerPhotoMedia(offer) {
  // Load Bot API transport only when uploading; pure parsing needs no env access.
  const InputFile =
    offer.provenance?.transport === 'mtproto' && offer.photos?.length
      ? (await import('grammy')).InputFile
      : undefined;
  return (offer.photos || []).slice(0, 10).map((photo) => {
    if (offer.provenance?.transport !== 'mtproto') {
      return { media: photo, type: 'photo' };
    }
    const cached = offer.cachedPhotos?.find(
      ({ url }) => String(url) === String(photo)
    );
    if (!cached?.path) {
      throw Object.assign(
        new Error('Native offer photo has no cached upload.'),
        { code: 'TELEGRAM_MEDIA_UNAVAILABLE' }
      );
    }
    return { media: new InputFile(cached.path), type: 'photo' };
  });
}

export async function sendPhotoMedia(media, single, group) {
  if (media.length === 1 && single) {
    await single(media[0].media);
  } else if (media.length) {
    await group(media);
  }
}
