import { stableHash } from './utils.js';

// Executed in the browser realm. Absence of a next link is not proof that an
// unrecognized, JavaScript-driven catalogue has been exhausted.
// eslint-disable-next-line complexity -- Only recognized terminal controls prove catalogue exhaustion.
export function extractWebPagination(selectors = {}) {
  const documentRef = globalThis.document;
  const href = documentRef.location.href;
  if (
    selectors.detailPath &&
    new RegExp(selectors.detailPath, 'u').test(documentRef.location.pathname)
  ) {
    return { complete: true, evidence: 'declared-detail-page' };
  }
  const nextSelector =
    selectors.paginationNext ||
    'a[rel="next"], .pagination .next, .pager .next, [data-pagination-next], [aria-label="Next page"], [aria-label="Next"]';
  const controls = [...documentRef.querySelectorAll(nextSelector)];
  const disabled = (element) =>
    element.hasAttribute('disabled') ||
    element.getAttribute('aria-disabled') === 'true' ||
    element.classList.contains('disabled') ||
    element.parentElement?.classList.contains('disabled');
  const next = controls.find(
    (element) => !disabled(element) && element.getAttribute('href')
  );
  if (next) {
    return {
      nextUrl: new globalThis.URL(next.getAttribute('href'), href).href,
      evidence: 'next-link',
    };
  }
  if (controls.length && controls.every(disabled)) {
    return { complete: true, evidence: 'disabled-next-control' };
  }
  const pager = documentRef.querySelector(
    selectors.paginationContainer ||
      '.pagination, .pager, [aria-label="Pagination"], [data-pagination]'
  );
  const current = Number(
    pager
      ?.querySelector('[aria-current="page"], .current, .active')
      ?.textContent?.trim()
  );
  const numbers = [...(pager?.querySelectorAll('a[href]') || [])]
    .map((element) => Number(element.textContent.trim()))
    .filter((number) => Number.isSafeInteger(number) && number > 0);
  if (
    current > 0 &&
    numbers.length &&
    numbers.every((number) => number <= current)
  ) {
    return { complete: true, evidence: 'last-numbered-page' };
  }
  return { complete: false, evidence: 'unrecognized-pagination' };
}

export class WebPaginationProgress {
  constructor(store) {
    this.store = store;
    this.entries = new Map();
  }

  async load(firstUrl) {
    const id = stableHash(firstUrl);
    let stored = this.entries.get(id);
    if (!stored && this.store?.queryRecords) {
      [stored] = await this.store.queryRecords('web-pagination-checkpoints', {
        path: 'id',
        value: id,
      });
    } else if (!stored) {
      stored = (
        await this.store?.loadRecords?.('web-pagination-checkpoints')
      )?.find((entry) => entry.id === id);
    }
    const age = Date.now() - Date.parse(stored?.updatedAt);
    if (
      stored &&
      stored.complete === false &&
      stored.firstUrl === firstUrl &&
      age >= 0 &&
      age < 6 * 60 * 60 * 1000
    ) {
      return stored;
    }
    return {
      id,
      firstUrl,
      nextUrl: firstUrl,
      visited: [],
      rows: [],
      complete: false,
    };
  }

  async commit(checkpoint) {
    // Raw rows and the next cursor share one durable record. A restart can
    // reparse every earlier page even if offer persistence was interrupted.
    if (this.store?.appendRecords) {
      await this.store.appendRecords('web-pagination-checkpoints', [
        checkpoint,
      ]);
    } else if (this.store?.updateRecords) {
      await this.store.updateRecords(
        'web-pagination-checkpoints',
        (entries) => [
          ...entries.filter(({ id }) => id !== checkpoint.id),
          checkpoint,
        ]
      );
    }
    this.entries.set(checkpoint.id, checkpoint);
    if (this.entries.size > 4 && this.store) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}

// Each invocation is finite; subsequent invocations resume the same slice.
// Storage/memory budget loss remains explicit even on a terminal page.
// eslint-disable-next-line complexity -- Every bound, navigation and durability outcome leaves an explicit resumable state.
export async function collectWebPages({
  firstUrl,
  fetchPage,
  progress,
  maxPages = 25,
  maxRows = 10_000,
  deadline = Infinity,
  signal,
}) {
  const checkpoint = await progress.load(firstUrl);
  const rows = new Map(
    checkpoint.rows.map((row) => [
      row.url || stableHash(JSON.stringify(row)),
      row,
    ])
  );
  const visited = new Set(checkpoint.visited);
  let nextUrl = checkpoint.nextUrl || firstUrl;
  if (checkpoint.reason === 'unrecognized-pagination') {
    visited.delete(nextUrl);
  }
  let complete = false;
  let reason = 'page-budget';
  let retentionLoss = checkpoint.retentionLoss === true;
  for (let page = 0; page < maxPages; page += 1) {
    signal?.throwIfAborted();
    if (Date.now() >= deadline) {
      reason = 'paging-deadline';
      break;
    }
    let origin;
    try {
      origin = new globalThis.URL(nextUrl).origin;
    } catch {
      reason = 'invalid-pagination-url';
      break;
    }
    if (origin !== new globalThis.URL(firstUrl).origin) {
      reason = 'cross-origin-pagination';
      break;
    }
    if (visited.has(nextUrl)) {
      reason = 'navigation-loop';
      break;
    }
    let result;
    try {
      result = await fetchPage(nextUrl);
    } catch (error) {
      if (signal?.aborted || !rows.size) {
        throw error;
      }
      reason = error.classification || error.code || 'page-fetch-failed';
      break;
    }
    visited.add(nextUrl);
    for (const row of result.rows) {
      const key = row.url || stableHash(JSON.stringify(row));
      if (rows.has(key) || rows.size < maxRows) {
        rows.set(key, row);
      } else {
        retentionLoss = true;
      }
    }
    const paging = result.pagination || {};
    complete = paging.complete === true && !retentionLoss;
    reason = retentionLoss
      ? 'row-retention-budget'
      : complete
        ? 'terminal-page'
        : paging.nextUrl
          ? 'page-budget'
          : 'unrecognized-pagination';
    if (paging.nextUrl) {
      nextUrl = paging.nextUrl;
    }
    const saved = {
      ...checkpoint,
      rows: [...rows.values()],
      visited: [...visited],
      nextUrl,
      complete,
      retentionLoss,
      reason,
      updatedAt: new Date().toISOString(),
    };
    await progress.commit(saved);
    if (paging.complete === true || !paging.nextUrl) {
      break;
    }
  }
  const saved = {
    ...checkpoint,
    rows: [...rows.values()],
    visited: [...visited],
    nextUrl,
    complete,
    retentionLoss,
    reason,
    updatedAt: new Date().toISOString(),
  };
  await progress.commit(saved);
  return Object.defineProperties([...rows.values()], {
    paginationComplete: { value: complete },
    paginationCheckpoint: {
      value: {
        id: saved.id,
        pages: visited.size,
        nextUrl,
        complete,
        retentionLoss,
        reason,
        updatedAt: saved.updatedAt,
      },
    },
  });
}
