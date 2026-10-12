// Offline, resumable import. SQLite holds identities and source working sets;
// the canonical store remains LiNo. No target API calls are made.
import { DatabaseSync } from 'node:sqlite';
import { readFile, stat, mkdir, copyFile, chmod } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { LinksStore } from '../src/links-store.js';
import {
  deduplicateOffers,
  offerIdentityKeys,
  normalizeOffer,
} from '../src/offers.js';
import { parseTelegramOffer } from '../src/telegram-parser.js';
import { sharedOfferUrl } from '../src/offer-url-identity.js';
import { withQaCleanup } from './qa-cleanup.mjs';
import { acquireQaStorageGuard } from './qa-storage-guard.mjs';
import { durableWrite } from '../src/link-cli-mirror.js';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const PAGE_BYTES = 4 * 1024 * 1024;
const GROUP_BYTES = 32 * 1024 * 1024;

async function canonicalVersion(directory) {
  for (const name of ['offers.index.json', 'offers.lino']) {
    try {
      const hash = createHash('sha256');
      for await (const bytes of createReadStream(join(directory, name))) {
        hash.update(bytes);
      }
      return `${name}:${hash.digest('hex')}`;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return 'empty';
}

async function pageText(path) {
  if ((await stat(path)).size > PAGE_BYTES) {
    throw new Error(
      'Split this retained page before import; page memory bound exceeded.'
    );
  }
  const text = await readFile(path, 'utf8');
  if (Buffer.byteLength(text) > PAGE_BYTES) {
    throw new Error('Input page grew beyond its memory bound.');
  }
  return text;
}

function stageDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(
    'PRAGMA journal_mode=WAL; PRAGMA cache_size=-2048; CREATE TABLE IF NOT EXISTS input (key TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS aliases (alias TEXT, key TEXT, PRIMARY KEY(alias,key)); CREATE INDEX IF NOT EXISTS alias_key ON aliases(key); CREATE TABLE IF NOT EXISTS pages (key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS output (id TEXT PRIMARY KEY, body TEXT, time REAL); CREATE TABLE IF NOT EXISTS processed (key TEXT PRIMARY KEY); CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT);'
  );
  return db;
}

function insertOffer(db, key, offer) {
  const body = JSON.stringify(offer);
  if (Buffer.byteLength(body) > 256 * 1024) {
    throw new Error(
      'One normalized offer exceeds the bounded import record size; raw page retained.'
    );
  }
  db.prepare('INSERT OR REPLACE INTO input VALUES (?,?)').run(key, body);
  db.prepare('DELETE FROM aliases WHERE key=?').run(key);
  for (const alias of new Set([
    `id:${offer.id}`,
    ...offerIdentityKeys(offer),
  ])) {
    if (alias.startsWith('url:') && sharedOfferUrl(alias.slice(4))) {
      continue;
    }
    db.prepare('INSERT OR IGNORE INTO aliases VALUES (?,?)').run(alias, key);
  }
}

async function reconcile(db, check) {
  db.exec('DELETE FROM output; DELETE FROM processed;');
  const group = db.prepare(
    'WITH RECURSIVE connected(key) AS (SELECT ? UNION SELECT b.key FROM connected c JOIN aliases a ON a.key=c.key JOIN aliases b ON b.alias=a.alias) SELECT key,body FROM input JOIN connected USING(key) LIMIT 129'
  );
  while (true) {
    await check();
    const next = db
      .prepare(
        'SELECT key FROM input WHERE key NOT IN (SELECT key FROM processed) ORDER BY key LIMIT 1'
      )
      .get();
    if (!next) {
      return;
    }
    const rows = group.all(next.key);
    if (
      rows.length > 128 ||
      rows.reduce((sum, row) => sum + Buffer.byteLength(row.body), 0) >
        GROUP_BYTES
    ) {
      throw new Error(
        'Identity component exceeds the bounded reconciliation size; staged evidence retained for review.'
      );
    }
    const offers = deduplicateOffers(rows.map((row) => JSON.parse(row.body)));
    db.exec('BEGIN');
    try {
      for (const offer of offers) {
        db.prepare('INSERT INTO output VALUES (?,?,?)').run(
          String(offer.id),
          JSON.stringify(offer),
          Date.parse(offer.collectedAt) || 0
        );
      }
      for (const row of rows) {
        db.prepare('INSERT INTO processed VALUES (?)').run(row.key);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}

function importedOffer(row, page, manifest) {
  const material = {
    ...row.material,
    ...row,
    sourceId: page.sourceId || row.sourceId || row.material?.sourceId,
  };
  if (page.format === 'telegram') {
    return parseTelegramOffer(material, {
      now: manifest.frozenAt,
      historyDays: 90,
    });
  }
  if (page.format === 'web') {
    return normalizeOffer(
      { ...material, text: row.text || row.raw?.text || row.material?.text },
      {
        now: new Date(
          material.collectedAt || page.collectedAt || manifest.frozenAt
        ),
      }
    );
  }
  return row;
}

async function stagePage({ db, page, manifest, manifestPath, staging, key }) {
  const path = resolve(dirname(manifestPath), page.path);
  const text = await pageText(path);
  if (sha(text) !== page.sha256) {
    throw new Error('Retained page checksum mismatch.');
  }
  const decoded = JSON.parse(text);
  const rows = Array.isArray(decoded)
    ? decoded
    : decoded.messages || decoded.offers || decoded.reviewPack;
  if (!Array.isArray(rows)) {
    throw new Error('Retained page has no recognized records.');
  }
  await copyFile(path, join(staging, `${page.sha256}.json`));
  await chmod(join(staging, `${page.sha256}.json`), 0o600);
  db.exec('BEGIN');
  try {
    for (const [ordinal, row] of rows.entries()) {
      const offer = importedOffer(row, page, manifest);
      if (offer) {
        insertOffer(db, `${key}:${ordinal}`, offer);
      }
    }
    db.prepare('INSERT INTO pages VALUES (?)').run(key);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function importCollectedCache({
  manifestPath,
  directory,
  scope,
  signal,
  guardFactory = acquireQaStorageGuard,
  memoryBytes = 192 * 1024 * 1024,
}) {
  directory = resolve(directory);
  manifestPath = resolve(manifestPath);
  const manifestText = await pageText(manifestPath);
  const manifest = JSON.parse(manifestText);
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.pages) ||
    manifest.pages.length > 10000
  ) {
    throw new Error('Invalid offline cache manifest.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const guard = await guardFactory(scope, {
    paths: [directory, dirname(manifestPath)],
    signal,
  });
  signal = guard.signal;
  const check = async () => {
    signal?.throwIfAborted();
    await guard.check();
    if (process.memoryUsage().heapUsed > memoryBytes) {
      throw new Error(
        'Offline import memory guard stopped work; staged evidence retained.'
      );
    }
  };
  const staging = join(directory, '.offline-import');
  await mkdir(staging, { recursive: true, mode: 0o700 });
  await durableWrite(
    join(staging, 'owner.json'),
    JSON.stringify(guard.owner || { synthetic: true })
  );
  const db = stageDatabase(join(staging, 'staging.sqlite'));
  await chmod(join(staging, 'staging.sqlite'), 0o600);
  try {
    const store = new LinksStore({ directory, maxOfferShardBytes: 256 * 1024 });
    const identity = sha(manifestText);
    let baseline = db
      .prepare('SELECT value FROM metadata WHERE key=?')
      .get('canonical')?.value;
    if (baseline === undefined) {
      baseline = await canonicalVersion(directory);
      db.prepare('INSERT INTO metadata VALUES (?,?)').run(
        'canonical',
        baseline
      );
    }
    const unchanged = async () => {
      await check();
      if ((await canonicalVersion(directory)) !== baseline) {
        throw new Error(
          'Canonical cache changed during offline import; staged evidence retained. Use a separate staging cache to reconcile concurrent writes.'
        );
      }
    };
    await unchanged();
    if (!db.prepare('SELECT key FROM pages WHERE key=?').get('existing')) {
      // Stage prior canonical offers before new pages. Original chronology and
      // evidence stay intact; restarting never duplicates completed pages.
      for await (const offer of new LinksStore({ directory }).iterOffers({
        signal,
      })) {
        await check();
        insertOffer(db, `existing:${offer.id}`, offer);
      }
      db.prepare('INSERT INTO pages VALUES (?)').run('existing');
    }
    for (const [index, page] of manifest.pages.entries()) {
      await check();
      if (
        !/^[a-f0-9]{64}$/u.test(page.sha256) ||
        !['offers', 'telegram', 'web'].includes(page.format)
      ) {
        throw new Error('Invalid offline page descriptor.');
      }
      const key = `${identity}:${index}:${page.sha256}`;
      if (db.prepare('SELECT key FROM pages WHERE key=?').get(key)) {
        continue;
      }
      await stagePage({ db, page, manifest, manifestPath, staging, key });
      await check();
    }
    await reconcile(db, check);
    async function* offers() {
      for (const row of db
        .prepare('SELECT body FROM output ORDER BY time DESC,id')
        .iterate()) {
        await check();
        yield JSON.parse(row.body);
      }
    }
    let publicationChecked = false;
    await store.replaceOffersFromStream(offers(), {
      signal,
      check: async () => {
        await check();
        if (!publicationChecked) {
          await unchanged();
          publicationChecked = true;
        }
      },
    });
    db.prepare('UPDATE metadata SET value=? WHERE key=?').run(
      await canonicalVersion(directory),
      'canonical'
    );
    await durableWrite(
      join(staging, 'checkpoint.json'),
      JSON.stringify({
        version: 1,
        manifest: identity,
        complete: true,
        offline: true,
        liveAcceptance: false,
      })
    );
    return { complete: true, offline: true, liveAcceptance: false };
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const option = (name) => args[args.indexOf(name) + 1];
  if (!args.includes('--manifest') || !args.includes('--directory')) {
    throw new Error(
      'Use --manifest CHECKSUMMED_PAGES.json --directory PRIVATE_CACHE.'
    );
  }
  withQaCleanup((scope, signal) =>
    importCollectedCache({
      manifestPath: option('--manifest'),
      directory: option('--directory'),
      scope,
      signal,
    })
  )
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        'Offline cache import incomplete; private checkpoints and evidence retained.'
      );
      process.exitCode = 1;
    });
}
