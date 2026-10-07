import { retryTelegramOperation } from './telegram-errors.js';

// Recreate a failed lazy iterator at the last successfully yielded message.
export async function* resilientTelegramHistory(
  factory,
  options = {},
  retry = {}
) {
  let cursor = { ...options };
  let iterator;
  try {
    while (true) {
      const result = await retryTelegramOperation(
        async () => {
          try {
            if (!iterator) {
              const iterable = factory(cursor);
              iterator = (
                iterable[Symbol.asyncIterator] || iterable[Symbol.iterator]
              ).call(iterable);
            }
            return await iterator.next();
          } catch (error) {
            iterator = undefined;
            throw error;
          }
        },
        { idempotent: true, maxDelayMs: 300000, maxElapsedMs: 600000, ...retry }
      );
      if (result.done) {
        return;
      }
      const message = result.value;
      cursor = {
        ...cursor,
        offset: {
          id: message.id,
          date: Math.floor(new Date(message.date).getTime() / 1000),
        },
      };
      yield message;
    }
  } finally {
    await iterator?.return?.();
  }
}
