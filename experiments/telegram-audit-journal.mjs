import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { durableWrite, sha256 } from '../src/link-cli-mirror.js';
import { saveAuditCheckpoint } from './telegram-live-audit-runtime.mjs';

export function sourceJournalPath(stateDirectory, alias) {
  return join(stateDirectory, 'source-journals', `${sha256(alias)}.json`);
}

export function sourceJournalCommitted(journal, checkpoint) {
  return Boolean(
    journal?.batchId &&
    journal.batchId === checkpoint?.batchId &&
    checkpoint?.phase !== 'projection-pending'
  );
}

export async function loadSourceJournal(stateDirectory, alias) {
  const path = sourceJournalPath(stateDirectory, alias);
  let entry;
  try {
    entry = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const { digest, payload } = entry;
  if (digest !== sha256(JSON.stringify(payload))) {
    throw new Error('The private source journal checksum does not match.');
  }
  if (
    payload.version !== 1 ||
    payload.alias !== alias ||
    typeof payload.batchId !== 'string' ||
    !Number.isFinite(Date.parse(payload.cutoff))
  ) {
    throw new Error('The private source journal belongs to another window.');
  }
  return payload;
}

export async function saveSourceJournal(stateDirectory, payload) {
  const path = sourceJournalPath(stateDirectory, payload.alias);
  await mkdir(join(stateDirectory, 'source-journals'), {
    mode: 0o700,
    recursive: true,
  });
  const contents = JSON.stringify({
    digest: sha256(JSON.stringify(payload)),
    payload,
  });
  await durableWrite(path, `${contents}\n`);
}

export async function saveCollectedSourceBatch({
  checkpointStore,
  payload,
  previous,
  stateDirectory,
  updatedAt = new Date().toISOString(),
}) {
  await saveSourceJournal(stateDirectory, payload);
  await saveAuditCheckpoint(checkpointStore, {
    batchId: payload.batchId,
    collectedOldestMessageId: payload.offsetId,
    complete: false,
    cutoff: payload.cutoff,
    id: payload.alias,
    messagesScanned: previous?.messagesScanned || 0,
    ...(previous?.oldestMessageId === undefined
      ? {}
      : { oldestMessageId: previous.oldestMessageId }),
    metrics: previous?.metrics || {},
    phase: 'projection-pending',
    state: 'pending',
    updatedAt,
  });
}

export async function removeSourceJournal(stateDirectory, alias) {
  await rm(sourceJournalPath(stateDirectory, alias), { force: true });
}
