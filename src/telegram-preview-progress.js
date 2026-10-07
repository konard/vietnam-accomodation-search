import { stableHash } from './utils.js';

// The cursor is committed after that slice's offers are durably stored.
// A failed save leaves the cursor at the previous committed slice.
export class TelegramPreviewProgress {
  constructor(store) {
    this.store = store;
    this.entries = new Map();
  }

  async load(firstUrl, window) {
    const id = stableHash(firstUrl);
    let checkpoint = this.entries.get(id);
    if (!checkpoint && this.store?.queryRecords) {
      [checkpoint] = await this.store.queryRecords(
        'telegram-preview-checkpoints',
        { path: 'id', value: id }
      );
    }
    if (
      !checkpoint ||
      checkpoint.firstUrl !== firstUrl ||
      !Number.isFinite(Date.parse(checkpoint.cutoff)) ||
      new Date(checkpoint.cutoff) > window.since ||
      !Number.isSafeInteger(checkpoint.newestId)
    ) {
      return { id, firstUrl, cutoff: window.since.toISOString() };
    }
    return checkpoint;
  }

  async commit(checkpoint) {
    if (!checkpoint) {
      return;
    }
    if (this.store?.updateRecords) {
      await this.store.updateRecords(
        'telegram-preview-checkpoints',
        (current) => [
          ...current.filter(({ id }) => id !== checkpoint.id),
          checkpoint,
        ]
      );
    }
    this.entries.set(checkpoint.id, checkpoint);
  }
}
