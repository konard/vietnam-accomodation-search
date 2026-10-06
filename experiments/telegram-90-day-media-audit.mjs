#!/usr/bin/env node

// Manual read-only supplement for captionless materials. Retained history and
// extracted text stay in an ignored private directory. This reports OCR and
// extraction observations, not human-labelled precision or recall.
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TelegramClient } from 'teleproto';
import { StringSession } from 'teleproto/sessions/index.js';
import {
  assembleTelegramAlbums,
  classifyTelegramPost,
  parseTelegramOffer,
} from '../src/index.js';
import {
  assertManualLocalRun,
  errorSummary,
} from './telegram-accommodation-audit-lib.mjs';
import {
  environmentFile,
  userCredentials,
} from './telegram-bot-conversation-e2e.mjs';
import { retainedMessages } from './telegram-90-day-coverage-audit.mjs';
import { retryTelegramFloodWait } from './telegram-live-audit-runtime.mjs';

export function recognizeImage(command, bytes) {
  return new Promise((fulfill, reject) => {
    const child = spawn(
      command,
      ['stdin', 'stdout', '--dpi', '150', '-l', 'eng+rus+vie'],
      { shell: false, stdio: ['pipe', 'pipe', 'ignore'] }
    );
    const timer = setTimeout(() => child.kill('SIGTERM'), 30_000);
    let output = '';
    child.stdout.on('data', (chunk) => {
      output = `${output}${chunk}`.slice(0, 1_048_576);
    });
    child.stdin.on('error', () => {});
    child.once('error', reject);
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        fulfill(output.trim());
      } else {
        reject(
          Object.assign(new Error('OCR failed or exceeded its deadline.'), {
            code: 'OCR_FAILED',
          })
        );
      }
    });
    child.stdin.end(bytes);
  });
}

async function save(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
  await rename(temporary, path);
}

async function json(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function inspectMaterial(client, source, material, command) {
  const results = [];
  const messages = await retryTelegramFloodWait(() =>
    client.getMessages(source.username, { ids: material.messageIds })
  );
  for (const message of messages) {
    if (!message.media) {
      continue;
    }
    if (message.media.className !== 'MessageMediaPhoto') {
      results.push({
        id: message.id,
        state: 'unsupported-media',
        type: message.media.className,
      });
      continue;
    }
    const bytes = await retryTelegramFloodWait(() =>
      client.downloadMedia(message.media)
    );
    const text = await recognizeImage(command, bytes);
    results.push({
      id: message.id,
      state: 'ocr-completed',
      bytes: bytes.length,
      text,
    });
  }
  const text = results
    .map((result) => result.text || '')
    .filter(Boolean)
    .join('\n');
  const relevance = classifyTelegramPost(text);
  const extracted = relevance.eligible
    ? parseTelegramOffer(
        {
          ...material,
          text,
          chat: { username: source.username },
          messageId: material.messageIds[0],
        },
        { now: new Date(material.date) }
      )
    : undefined;
  return {
    materialId: material.id,
    messageIds: material.messageIds,
    results,
    relevance,
    historicalOfferExtracted: Boolean(extracted),
    attributes: extracted?.attributes,
    price: extracted?.price,
    location: extracted?.location,
  };
}

function mediaSummary(results, completedSources) {
  return {
    completedSources,
    materials: results.length,
    errors: results.filter((result) => result.error).length,
    historicalOffersExtracted: results.filter(
      (result) => result.historicalOfferExtracted
    ).length,
    unsupportedMedia: results
      .flatMap((result) => result.results || [])
      .filter((result) => result.state === 'unsupported-media').length,
    emptyOcr: results.filter((result) =>
      result.results?.every((image) => !image.text)
    ).length,
    results,
    limitation:
      'Only complete retained public sources are inspected. OCR is not human-reviewed recall; current downloads may reflect later edits. Production ingestion has not been changed.',
  };
}

async function cachedMaterial(
  client,
  source,
  material,
  command,
  output,
  ordinal
) {
  const key = createHash('sha256')
    .update(
      JSON.stringify([source.username, material.messageIds, material.mediaIds])
    )
    .digest('hex');
  const path = join(output, `${key}.json`);
  let result = await json(path);
  if (!result || result.error) {
    try {
      result = {
        sourceOrdinal: ordinal,
        ...(await inspectMaterial(client, source, material, command)),
      };
    } catch (error) {
      result = {
        sourceOrdinal: ordinal,
        materialId: material.id,
        error: errorSummary(error),
      };
    }
    await save(path, result);
  }
  return result;
}

function assertMediaBoundary() {
  assertManualLocalRun(process.env);
  if (
    process.env.TELEGRAM_HISTORY_AUDIT !== '1' ||
    Number(process.versions.node.split('.')[0]) < 22
  ) {
    throw new Error('Manual opt-in and supported Node.js 22+ are required.');
  }
}

export async function runMediaAudit({
  userEnv,
  historyDirectory,
  tesseractCommand = 'tesseract',
}) {
  assertMediaBoundary();
  const directory = resolve(historyDirectory);
  const cohort = await json(join(directory, 'cohort.json'));
  if (!cohort?.sources?.length) {
    throw new Error('A retained private history cohort is required.');
  }
  const output = join(directory, 'media-audit');
  await mkdir(output, { recursive: true, mode: 0o700 });
  const credentials = await userCredentials(await environmentFile(userEnv));
  const client = new TelegramClient(
    new StringSession(credentials.session),
    credentials.apiId,
    credentials.apiHash,
    { autoReconnect: false, connectionRetries: 2, requestRetries: 2 }
  );
  client.setLogLevel?.('none');
  const results = [];
  const completedSources = [];
  try {
    await client.connect();
    if (!(await client.checkAuthorization())) {
      throw new Error('The existing user session is not authorized.');
    }
    for (const [index, source] of cohort.sources.entries()) {
      const sourceDirectory = join(
        directory,
        `source-${String(index + 1).padStart(2, '0')}`
      );
      const checkpoint = await json(join(sourceDirectory, 'checkpoint.json'));
      if (!checkpoint?.complete) {
        continue;
      }
      if (
        checkpoint.username !== source.username ||
        checkpoint.cutoff !== cohort.cutoff
      ) {
        throw new Error('Source checkpoint does not match the frozen cohort.');
      }
      completedSources.push(index + 1);
      const materials = assembleTelegramAlbums(
        await retainedMessages(sourceDirectory, checkpoint.pages)
      ).filter((material) => !material.text.trim() && material.mediaIds.length);
      for (const material of materials) {
        const result = await cachedMaterial(
          client,
          source,
          material,
          tesseractCommand,
          output,
          index + 1
        );
        results.push(result);
        console.log(
          JSON.stringify({
            stage: 'media-inspected',
            sourceOrdinal: index + 1,
            materials: results.length,
            historicalOfferExtracted: result.historicalOfferExtracted,
            error: Boolean(result.error),
          })
        );
      }
    }
    const summary = mediaSummary(results, completedSources);
    await save(join(output, 'report.json'), summary);
    console.log(
      JSON.stringify({
        stage: 'media-finished',
        ...summary,
        results: undefined,
      })
    );
    return summary;
  } finally {
    await client.disconnect().catch(() => {});
    await client.destroy?.().catch(() => {});
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const arguments_ = process.argv.slice(2);
    const options = {};
    const names = {
      '--user-env': 'userEnv',
      '--history-directory': 'historyDirectory',
      '--tesseract-command': 'tesseractCommand',
    };
    for (let index = 0; index < arguments_.length; index++) {
      const name = names[arguments_[index]];
      if (!name || !arguments_[index + 1]) {
        throw new Error('Unknown or incomplete media audit option.');
      }
      options[name] = arguments_[++index];
    }
    if (!options.userEnv || !options.historyDirectory) {
      throw new Error('--user-env and --history-directory are required.');
    }
    process.exitCode = (await runMediaAudit(options)).errors ? 1 : 0;
  } catch (error) {
    console.error(
      JSON.stringify({ stage: 'media-failed', ...errorSummary(error) })
    );
    process.exitCode = 1;
  }
}
