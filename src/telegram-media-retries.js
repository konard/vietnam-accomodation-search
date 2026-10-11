import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classifyTelegramError } from './telegram-errors.js';

// A private, bounded work ledger. It stores categories and deadlines, never
// native file references, message text or credentials. Atomic replacement
// allows restart after a failed download without losing its server backoff.
export class TelegramMediaRetries {
  constructor(directory, { now = Date.now } = {}) {
    this.directory = directory;
    this.path = join(directory, 'telegram-media-retries.json');
    this.now = now;
    this.tail = Promise.resolve();
  }

  async records() {
    try {
      return JSON.parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  update(id, error) {
    const action = this.tail.then(async () => {
      const records = await this.records();
      const previous = records.find((row) => row.id === id);
      const remaining = records.filter((row) => row.id !== id);
      if (error) {
        const policy = classifyTelegramError(error);
        const attempts = (previous?.attempts || 0) + 1;
        remaining.push({
          id,
          attempts,
          category: policy.category,
          retryable:
            policy.retryable ||
            ['TimeoutError', 'AbortError'].includes(error.name),
          retryAt: new Date(
            this.now() +
              Math.max(
                policy.delayMs || 0,
                Math.min(60_000, 1000 * 2 ** Math.min(attempts, 6))
              )
          ).toISOString(),
        });
      }
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      await writeFile(
        `${this.path}.tmp`,
        JSON.stringify(remaining.slice(-512)),
        { mode: 0o600 }
      );
      await rename(`${this.path}.tmp`, this.path);
      return remaining.find((row) => row.id === id);
    });
    this.tail = action.catch(() => {});
    return action;
  }
}
