#!/usr/bin/env node

/**
 * Downloaded-loader policy shared by every release helper.
 *
 * use-m 8.16.4 fixes the CommonJS metadata and Windows file-URL defects.
 * The named-export normalizer retains the tested Node/Bun namespace shapes.
 * Its separate load entry point still clears deadlines before response-body
 * completion (https://github.com/link-foundation/use-m/issues/80), so keep
 * byte/digest verification, trusted pinned mirrors and cancellable deadlines
 * here until the published contract passes the runtime matrix.
 *
 * Set CI_SCRIPTS_DEBUG=1 for module-shape diagnostics (default off).
 */

import { debug } from './debug-print.mjs';
import { createHash } from 'node:crypto';

/** Immutable, byte-identical CDN copies of the package-lock bootstrap. */
export const USE_M_URL = 'https://unpkg.com/use-m@8.16.4/use.js';
export const USE_M_MIRROR_URL =
  'https://cdn.jsdelivr.net/npm/use-m@8.16.4/use.js';
export const USE_M_SHA256 =
  '6cc5be008885fd2ee1f4eec0482652c4162f5d6d9703efa5116edd270d6b63f9';
export const DEFAULT_MAX_BYTES = 1024 * 1024;
export const DEFAULT_TOTAL_TIMEOUT_MS = 51000;

/** Cached `use` function, so a process fetches use.js at most once. */
let cachedUse = null;

/**
 * Candidate containers for the real module object, in resolution order.
 * `module.exports` is the Node >= 22.12 synthetic CommonJS export.
 * @param {unknown} loaded
 * @returns {unknown[]}
 */
function candidates(loaded) {
  return [
    loaded,
    loaded?.default,
    loaded?.['module.exports'],
    loaded?.default?.default,
  ];
}

/**
 * Human-readable description of a loaded module, used in error messages.
 * @param {unknown} loaded
 * @returns {string}
 */
export function describeModule(loaded) {
  if (loaded === null || loaded === undefined) {
    return String(loaded);
  }
  if (typeof loaded !== 'object' && typeof loaded !== 'function') {
    return typeof loaded;
  }
  return `${typeof loaded} with keys [${Object.keys(loaded).join(', ')}]`;
}

/**
 * Pick the object that actually carries `exportName` out of whatever `use-m`
 * returned for `moduleName`.
 *
 * @param {unknown} loaded value returned by `await use(moduleName)`
 * @param {string} exportName named export the caller needs
 * @param {string} moduleName package name, used for the error message only
 * @returns {Record<string, unknown>} object exposing `exportName`
 */
export function resolveNamedExport(loaded, exportName, moduleName) {
  for (const candidate of candidates(loaded)) {
    if (candidate && typeof candidate[exportName] === 'function') {
      debug(`resolved ${moduleName}.${exportName}`, {
        received: describeModule(loaded),
        via: candidate === loaded ? 'namespace' : 'unwrapped',
      });
      return candidate;
    }
  }
  throw new Error(
    `use('${moduleName}') did not expose a callable "${exportName}". ` +
      `Received ${describeModule(loaded)}. This usually means the CommonJS ` +
      `interop of use-m did not unwrap the module (see scripts/use-module.mjs).`
  );
}

/**
 * Per-attempt deadline. Without it a stalled CDN connection is bounded only by
 * undici's 300 s `headersTimeout`, so one fetch can burn five minutes of a
 * job's `timeout-minutes`.
 */
export const DEFAULT_TIMEOUT_MS = 15000;

/** Total attempts, including the first one. */
export const DEFAULT_ATTEMPTS = 3;

/** Delay before the second attempt; doubled for each attempt after it. */
export const DEFAULT_RETRY_DELAY_MS = 2000;

// Link a caller's lifetime without changing its cancellation reason.
function forwardAbort(controller, signal) {
  const abort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) {
    abort();
  }
  return () => signal?.removeEventListener('abort', abort);
}

async function withAbort(signal, operation) {
  signal.throwIfAborted();
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => {
    rejectAbort = () => reject(signal.reason);
    signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try {
    return await Promise.race([aborted, operation()]);
  } finally {
    signal.removeEventListener('abort', rejectAbort);
  }
}

async function readBoundedSource(response, maxBytes, signal) {
  let source;
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => {});
    };
    signal.addEventListener('abort', abort, { once: true });
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        bytes += value.byteLength;
        if (bytes > maxBytes) {
          throw new Error('use-m bundle exceeds byte limit');
        }
        chunks.push(Buffer.from(value));
      }
      source = Buffer.concat(chunks).toString('utf8');
    } finally {
      signal.removeEventListener('abort', abort);
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else {
    source = await response.text();
  }
  if (Buffer.byteLength(source) > maxBytes) {
    throw new Error('use-m bundle exceeds byte limit');
  }
  return source;
}

// Keep deadlines armed through body reads and digest verification, and race
// cancellation even when a collaborator ignores the fetch signal.
async function fetchUseOnce({
  fetchImpl,
  url,
  timeoutMs,
  signal,
  expectedSha256,
  maxBytes,
}) {
  const controller = new AbortController();
  const timer =
    timeoutMs > 0
      ? setTimeout(
          () =>
            controller.abort(
              new Error(
                `Timed out after ${timeoutMs}ms while fetching use-m from ${url}`
              )
            ),
          timeoutMs
        )
      : null;
  const unlink = forwardAbort(controller, signal);
  try {
    return await withAbort(controller.signal, async () => {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(
          `Failed to fetch use-m from ${url}: ${response.status} ${response.statusText || ''}`.trim()
        );
      }
      const source = await readBoundedSource(
        response,
        maxBytes,
        controller.signal
      );
      if (
        createHash('sha256').update(source).digest('hex') !== expectedSha256
      ) {
        throw new Error('use-m bundle SHA-256 mismatch; refusing evaluation');
      }
      controller.signal.throwIfAborted();
      // use-m ships as an eval-able bundle; this is its documented entry point.
      const evaluated = await eval(source);
      const use = evaluated?.use ?? evaluated?.default?.use;
      if (typeof use !== 'function') {
        throw new Error(
          `use-m loaded from ${url} did not export a callable "use". ` +
            `Received ${describeModule(evaluated)}.`
        );
      }
      return use;
    });
  } catch (error) {
    // `fetch` reports an abort as its own error; the reason says what happened.
    throw controller.signal.aborted ? controller.signal.reason : error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    unlink();
  }
}

/**
 * Fill in the load defaults, keeping every knob injectable from a test.
 * @param {Record<string, unknown>} options
 * @returns {{fetchImpl: typeof fetch, url: string, attempts: number,
 *   timeoutMs: number, retryDelayMs: number,
 *   sleep: (ms: number) => Promise<void>}}
 */
function loadSettings(options) {
  return {
    fetchImpl: options.fetchImpl ?? fetch,
    url: options.url ?? USE_M_URL,
    mirrorUrl: options.url ? options.url : USE_M_MIRROR_URL,
    expectedSha256: options.expectedSha256 ?? USE_M_SHA256,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
    totalTimeoutMs: options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS,
    attempts: options.attempts ?? DEFAULT_ATTEMPTS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    sleep:
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
  };
}

/**
 * Fetch and evaluate use-m, caching the result for the whole process.
 *
 * The load is a network dependency of every release script, so it is bounded
 * on both axes: each attempt carries a deadline and a transient failure is
 * retried with exponential backoff. The worst case stays well inside a job's
 * `timeout-minutes` (3 x 15 s + 2 s + 4 s = 51 s by default).
 *
 * The final error names the CDN, the URL and the attempt count. A bare
 * `TypeError: fetch failed` names neither, which makes a third-party outage
 * look like a defect in the release logic.
 *
 * @param {{fetchImpl?: typeof fetch, url?: string, attempts?: number,
 *   timeoutMs?: number, totalTimeoutMs?: number, retryDelayMs?: number,
 *   maxBytes?: number, expectedSha256?: string, signal?: AbortSignal,
 *   sleep?: (ms: number) => Promise<void>}} [options] injection seam for tests
 * @returns {Promise<(name: string) => Promise<unknown>>}
 */
export async function loadUse(options = {}) {
  const settings = loadSettings(options);
  const { url, attempts } = settings;
  const cacheable = Object.keys(options).length === 0;
  if (cachedUse && cacheable) {
    return cachedUse;
  }
  const controller = new AbortController();
  const unlink = forwardAbort(controller, options.signal);
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error(`use-m retry budget exceeded ${settings.totalTimeoutMs}ms`)
      ),
    settings.totalTimeoutMs
  );
  let lastError;
  try {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        const use = await fetchUseOnce({
          ...settings,
          url: attempt % 2 === 0 ? settings.mirrorUrl : url,
          signal: controller.signal,
        });
        debug('loaded use-m', { url, attempt });
        if (cacheable) {
          cachedUse = use;
        }
        return use;
      } catch (error) {
        lastError = error;
        if (controller.signal.aborted) {
          throw controller.signal.reason;
        }
        debug('use-m load attempt failed', {
          url,
          attempt,
          attempts,
          error: error?.message,
        });
        if (attempt < attempts) {
          await withAbort(controller.signal, () =>
            settings.sleep(settings.retryDelayMs * 2 ** (attempt - 1))
          );
        }
      }
    }
    throw bootstrapFailure(url, attempts, lastError);
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

function bootstrapFailure(url, attempts, cause) {
  return new Error(
    `Failed to load use-m from ${url} after ${attempts} attempt(s): ` +
      `${cause?.message ?? String(cause)}. This is a network dependency ` +
      'of the release scripts; verify the pinned bundle or retry a CDN outage.',
    { cause }
  );
}

/**
 * Load a package through use-m and return it with CommonJS namespaces
 * normalised around a named export the caller needs.
 *
 * @param {string} moduleName package specifier passed to use-m
 * @param {string} exportName named export that must be callable
 * @param {(name: string) => Promise<unknown>} [use] pre-loaded use-m function
 * @returns {Promise<Record<string, unknown>>}
 */
export async function useModule(moduleName, exportName, use) {
  const resolvedUse = use ?? (await loadUse());
  return resolveNamedExport(
    await resolvedUse(moduleName),
    exportName,
    moduleName
  );
}

/**
 * Load `command-stream` with `$` guaranteed to be callable and with
 * non-zero exits rejecting.
 *
 * The errexit switch is the semantics every release script is written
 * against: without it `$` RESOLVES on a non-zero exit, so every
 * `try { await $`...`; } catch` in the release path is unreachable and a
 * crashed step prints the success line. The scripts that deliberately
 * probe for a non-zero outcome (`push-main-with-rebase-retry.mjs`,
 * `land-via-pull-request.mjs`) use `runCommand`/`runStrict` from
 * run-command.mjs, which resolves with the code, so this switch does not
 * reach them.
 *
 * @param {(name: string) => Promise<unknown>} [use] pre-loaded use-m function
 * @returns {Promise<Record<string, unknown>>} command-stream exports
 */
export async function loadCommandStream(use) {
  const commandStream = await useModule('command-stream@1.3.0', '$', use);
  const shell = commandStream.shell;

  if (shell && typeof shell.errexit === 'function') {
    shell.errexit(true);
  } else {
    debug(
      'command-stream did not expose shell.errexit; $ keeps resolve-on-exit semantics'
    );
  }

  return commandStream;
}

/**
 * Load `lino-arguments` with `makeConfig` guaranteed to be callable.
 *
 * @param {(name: string) => Promise<unknown>} [use] pre-loaded use-m function
 * @returns {Promise<Record<string, unknown>>} lino-arguments exports
 */
export function loadLinoArguments(use) {
  return useModule('lino-arguments@0.3.0', 'makeConfig', use);
}
