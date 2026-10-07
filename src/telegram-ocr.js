import { spawn } from 'node:child_process';
import { untilAborted } from './browser-adapters.js';

export function recognizeRentalPhoto(
  bytes,
  {
    command = 'tesseract',
    signal,
    timeoutMs = 15000,
    maxBytes = 16 * 1024 * 1024,
    maxOutputBytes = 1024 * 1024,
    spawnProcess = spawn,
  } = {}
) {
  if (!bytes?.byteLength || bytes.byteLength > maxBytes) {
    return Promise.reject(
      Object.assign(
        new Error('OCR image is empty or exceeds the input budget.'),
        { code: 'OCR_INPUT_BUDGET' }
      )
    );
  }
  return new Promise((resolve, reject) => {
    const child = spawnProcess(
      command,
      ['stdin', 'stdout', '--psm', '11', '-l', 'eng+rus+vie'],
      { shell: false, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    let text = '';
    let outputBytes = 0;
    let failure;
    const stop = (code) => {
      failure ||= Object.assign(new Error(code), { code });
      child.kill('SIGKILL');
    };
    const abort = () => stop('OCR_ABORTED');
    const timer = setTimeout(() => stop('OCR_TIMEOUT'), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    };
    signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        stop('OCR_OUTPUT_BUDGET');
      } else {
        text += chunk.toString();
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code) => {
      cleanup();
      if (failure || code !== 0) {
        reject(
          failure ||
            Object.assign(new Error('OCR process failed.'), {
              code: 'OCR_PROCESS_FAILED',
            })
        );
      } else {
        resolve({
          text: text.trim(),
          status: text.trim() ? 'extracted' : 'unreadable',
          engine: 'tesseract',
          pageSegmentation: 11,
        });
      }
    });
    if (signal?.aborted) {
      abort();
    } else {
      child.stdin.end(bytes);
    }
  });
}

export function createTelegramOcr(provider, options = {}) {
  return async (mediaId, { material, signal } = {}) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, options.timeoutMs || 15000);
    try {
      if (signal?.aborted) {
        abort();
      }
      const bytes = await untilAborted(
        provider.photo(mediaId, {
          material,
          signal: controller.signal,
          maxBytes: options.maxBytes,
        }),
        controller.signal
      );
      return await recognizeRentalPhoto(bytes, {
        ...options,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        const code = signal?.aborted ? 'OCR_ABORTED' : 'OCR_TIMEOUT';
        throw Object.assign(new Error(code), { code });
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}
