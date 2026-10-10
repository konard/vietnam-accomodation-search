import { untilAborted } from './browser-adapters.js';

export async function downloadBoundedPhoto(
  client,
  media,
  { signal = AbortSignal.timeout(15000), maxBytes }
) {
  const chunks = [];
  let bytes = 0;
  let requested = 0;
  const partBytes = 64 * 1024;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  const budgetError = () =>
    Object.assign(new Error('OCR photo exceeds the download budget.'), {
      code: 'OCR_INPUT_BUDGET',
    });
  const iterator = client
    .downloadAsIterable(media, {
      abortSignal: controller.signal,
      // Size hints may be wrong; measure the stream instead.
      fileSize: Infinity,
      partSize: 64,
      throttle: () => {
        requested += partBytes;
        if (requested > maxBytes + 3 * partBytes) {
          const error = budgetError();
          controller.abort(error);
          throw error;
        }
      },
    })
    [Symbol.asyncIterator]();
  try {
    for (;;) {
      const item = await untilAborted(iterator.next(), controller.signal);
      if (item.done) {
        break;
      }
      bytes += item.value.byteLength;
      if (bytes > maxBytes) {
        throw budgetError();
      }
      chunks.push(item.value);
    }
    const result = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', abort);
    await untilAborted(iterator.return?.(), signal).catch(() => {});
  }
}
