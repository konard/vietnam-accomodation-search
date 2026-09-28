import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  RETAINED_FAILURES,
  sha256,
  splitNotation,
} from '../src/link-cli-mirror.js';
import { LinkCliMirror, serializeRecords } from '../src/index.js';

const isDeno = typeof globalThis.Deno !== 'undefined';
// Tiny shards keep the fixtures fast; the default bounds are covered by the
// splitNotation cases.
const tiny = { averageLinks: 8, maxLinks: 16, minLinks: 4 };
const tinyMirror = {
  averageShardLinks: 8,
  maxShardLinks: 16,
  minShardLinks: 4,
};

function offers(count, marker = '') {
  return Array.from({ length: count }, (_, index) => ({
    id: `offer-${index}`,
    price: { amount: index * 10, currency: 'VND' },
    text: `Room ${index}${marker}\nnear the beach (${index % 7})`,
    url: `https://audit.invalid/${index}`,
  }));
}

// Emulates clink: writes both database files and exports the import exactly.
function fakeClink({ fail, names = true, onRun } = {}) {
  const calls = [];
  let running = 0;
  const run = async (_command, arguments_, options) => {
    running += 1;
    calls.push({ arguments_, running });
    try {
      await onRun?.(options);
      if (fail?.(calls.length)) {
        const error = new Error('clink exited with 1');
        error.code = 'storage-process-failed';
        throw error;
      }
      const database = arguments_[arguments_.indexOf('--db') + 1];
      const source = arguments_[arguments_.indexOf('--import') + 1];
      const target = arguments_[arguments_.indexOf('--export') + 1];
      const notation = await readFile(source, 'utf8');
      await writeFile(database, `binary:${sha256(notation)}`);
      if (names) {
        await writeFile(
          database.replace(/data\.links$/u, 'data.names.links'),
          'names'
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      await writeFile(target, notation);
    } finally {
      running -= 1;
    }
  };
  return { calls, run };
}

async function pointerOf(directory, kind) {
  return JSON.parse(
    await readFile(join(directory, '.binary', `${kind}.current.json`), 'utf8')
  );
}

async function manifestOf(directory) {
  return JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

describe('content-defined LiNo sharding', () => {
  it('keeps small notation as one exact shard', () => {
    expect(splitNotation('')).toEqual(['']);
    expect(splitNotation('offer: (a b)\n')).toEqual(['offer: (a b)\n']);
    const notation = serializeRecords('offer', offers(2));
    expect(splitNotation(notation)).toEqual([notation]);
  });

  it('partitions large notation exactly on whole links within bounds', () => {
    const notation = serializeRecords('offer', offers(30));
    const shards = splitNotation(notation);
    expect(shards.length > 2).toBe(true);
    expect(shards.join('\n')).toBe(notation);
    for (const shard of shards) {
      const lines = shard.split('\n').filter((line) => line.startsWith('('));
      expect(lines.length <= 128).toBe(true);
    }
    expect(splitNotation(notation)).toEqual(shards);
  });

  it('confines a local edit to few shards so the rest are reused', () => {
    const before = splitNotation(serializeRecords('offer', offers(40)), tiny);
    const changed = offers(40);
    changed[10].text = 'Edited room';
    changed.splice(30, 0, { id: 'inserted', text: 'New room' });
    const after = splitNotation(serializeRecords('offer', changed), tiny);
    const previous = new Set(before.map((shard) => sha256(shard)));
    const rebuilt = after.filter((shard) => !previous.has(sha256(shard)));
    expect(rebuilt.length <= 4).toBe(true);
    expect(after.length - rebuilt.length > before.length - 6).toBe(true);
  });

  it('falls back to one shard when shards cannot reproduce the text', () => {
    const notation = `${serializeRecords('offer', offers(20))}\n\n`;
    expect(splitNotation(notation)).toEqual([notation]);
  });
});

describe('sharded link-cli projection', () => {
  it('builds, verifies, reuses, and prunes content-addressed shards', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'sharded-projection-'));
    const notation = serializeRecords('offer', offers(12));
    const shards = splitNotation(notation, tiny);
    // Hold each run until three are in flight (or every shard has started),
    // so the concurrency assertion does not depend on scheduler timing.
    const clink = fakeClink({
      onRun: async () => {
        while (
          clink.calls.length < shards.length &&
          Math.max(...clink.calls.map(({ running }) => running)) < 3
        ) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      },
    });
    const events = [];
    const mirror = new LinkCliMirror({
      ...tinyMirror,
      concurrency: 3,
      onProgress: (event) => events.push(event),
      run: clink.run,
    });
    try {
      const staged = await mirror.stage({
        directory,
        kind: 'offers',
        notation,
      });
      await staged.activate();
      expect(clink.calls.length).toBe(shards.length);
      expect(Math.max(...clink.calls.map(({ running }) => running))).toBe(3);
      expect(events.at(-1)).toEqual({
        completed: shards.length,
        elapsedMs: events.at(-1).elapsedMs,
        phase: 'binary-projection',
        reused: 0,
        status: 'shards',
        total: shards.length,
      });

      const pointer = await pointerOf(directory, 'offers');
      expect(pointer.sha256).toBe(sha256(notation));
      const manifest = await manifestOf(pointer.directory);
      expect(manifest.version).toBe(3);
      expect(manifest.shards).toEqual(shards.map((shard) => sha256(shard)));
      const shardRoot = join(directory, '.binary', 'offers.shards');
      const first = await manifestOf(join(shardRoot, manifest.shards[0]));
      expect(Object.keys(first.files)).toEqual([
        'data.links',
        'verified.lino',
        'data.names.links',
      ]);

      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(shards.length);

      const changed = offers(12);
      changed[6].text = 'Edited room';
      const edited = serializeRecords('offer', changed);
      const next = await mirror.stage({
        directory,
        kind: 'offers',
        notation: edited,
      });
      const rebuilt = clink.calls.length - shards.length;
      expect(rebuilt >= 1 && rebuilt <= 2).toBe(true);
      expect(events.at(-1).reused).toBe(
        splitNotation(edited, tiny).length - rebuilt
      );
      await next.activate();
      const kept = (
        await manifestOf((await pointerOf(directory, 'offers')).directory)
      ).shards;
      expect((await readdir(shardRoot)).sort()).toEqual([...kept].sort());
      expect(await exists(pointer.directory)).toBe(false);

      const small = serializeRecords('offer', offers(1));
      await (
        await mirror.stage({ directory, kind: 'offers', notation: small })
      ).activate();
      expect(await exists(shardRoot)).toBe(false);
      const smallPointer = await pointerOf(directory, 'offers');
      expect((await manifestOf(smallPointer.directory)).shards).toBe(undefined);
      expect(
        await readFile(join(smallPointer.directory, 'verified.lino'), 'utf8')
      ).toBe(small);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('rebuilds only a corrupted shard and detects layout changes', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'sharded-repair-'));
    const clink = fakeClink({ names: false });
    const mirror = new LinkCliMirror({ ...tinyMirror, run: clink.run });
    try {
      const notation = serializeRecords('offer', offers(10));
      await mirror.ensure({ directory, kind: 'offers', notation });
      const initialRuns = clink.calls.length;
      const pointer = await pointerOf(directory, 'offers');
      const manifest = await manifestOf(pointer.directory);
      const shardRoot = join(directory, '.binary', 'offers.shards');
      const target = join(shardRoot, manifest.shards[1]);
      expect(Object.keys((await manifestOf(target)).files)).toEqual([
        'data.links',
        'verified.lino',
      ]);

      await writeFile(join(target, 'data.links'), 'corrupt-binary');
      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns + 1);
      const failed = (await readdir(shardRoot)).filter((name) =>
        name.includes('.failed-')
      );
      expect(failed.length).toBe(1);

      const shardManifest = await manifestOf(target);
      await writeFile(
        join(target, 'manifest.json'),
        JSON.stringify({
          ...shardManifest,
          files: { ...shardManifest.files, 'other.links': 'x' },
        })
      );
      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns + 2);

      await writeFile(
        join(target, 'manifest.json'),
        JSON.stringify({
          ...shardManifest,
          files: { 'data.links': shardManifest.files['data.links'] },
        })
      );
      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns + 3);

      await writeFile(join(target, 'verified.lino'), 'corrupt: (left right)\n');
      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns + 4);

      await writeFile(
        join(pointer.directory, 'manifest.json'),
        JSON.stringify({ ...manifest, shards: manifest.shards.slice(1) })
      );
      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns + 4);
      expect((await manifestOf(pointer.directory)).shards).toEqual(
        manifest.shards
      );

      const resharded = new LinkCliMirror({
        maxShardLinks: 10_000,
        run: clink.run,
      });
      await resharded.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns + 5);
      expect(await exists(shardRoot)).toBe(false);

      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(clink.calls.length).toBe(initialRuns * 2 + 5);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('keeps the previous projection and bounded diagnostics on failure', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'sharded-failure-'));
    let failing = false;
    const clink = fakeClink({ fail: () => failing });
    const heartbeats = [];
    const mirror = new LinkCliMirror({
      ...tinyMirror,
      concurrency: 1,
      onProgress: (event) => {
        heartbeats.push(event.status);
        throw new Error('diagnostic sink failed');
      },
      run: async (command, arguments_, options) => {
        options.onProgress({ status: 'running' });
        options.onProgress({ status: 'finished' });
        await clink.run(command, arguments_, options);
      },
    });
    try {
      const notation = serializeRecords('offer', offers(10));
      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(heartbeats.includes('running')).toBe(true);
      expect(heartbeats.includes('finished')).toBe(false);
      const previous = await pointerOf(directory, 'offers');

      failing = true;
      const changed = serializeRecords('offer', offers(10, ' changed'));
      for (let attempt = 0; attempt < RETAINED_FAILURES + 2; attempt += 1) {
        const error = await mirror
          .stage({ directory, kind: 'offers', notation: changed })
          .then(
            () => undefined,
            (caught) => caught
          );
        expect(error?.code).toBe('storage-process-failed');
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(await pointerOf(directory, 'offers')).toEqual(previous);
      const candidate = join(directory, '.binary', `offers-${sha256(changed)}`);
      expect(
        JSON.parse(await readFile(join(candidate, 'failure.json'), 'utf8')).code
      ).toBe('storage-process-failed');

      failing = false;
      await mirror.ensure({ directory, kind: 'offers', notation: changed });
      const root = join(directory, '.binary');
      const failedCandidates = (await readdir(root)).filter((name) =>
        name.includes('.failed-')
      );
      expect(failedCandidates.length).toBe(RETAINED_FAILURES);
      const failedShards = (await readdir(join(root, 'offers.shards'))).filter(
        (name) => name.includes('.failed-')
      );
      expect(failedShards.length).toBe(RETAINED_FAILURES);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('resumes an interrupted projection from its verified shards', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'sharded-resume-'));
    // The third import fails as a deadline or TERM would.
    const clink = fakeClink({ fail: (call) => call === 3 });
    const events = [];
    const mirror = new LinkCliMirror({
      ...tinyMirror,
      concurrency: 1,
      onProgress: (event) => events.push(event),
      run: clink.run,
    });
    try {
      const notation = serializeRecords('offer', offers(12));
      const shards = splitNotation(notation, tiny);
      expect(shards.length > 3).toBe(true);
      const error = await mirror
        .stage({ directory, kind: 'offers', notation })
        .then(
          () => undefined,
          (caught) => caught
        );
      expect(error?.code).toBe('storage-process-failed');

      await mirror.ensure({ directory, kind: 'offers', notation });
      expect(events.at(-1).reused).toBe(2);
      expect(events.at(-1).completed).toBe(shards.length);
      expect(clink.calls.length).toBe(shards.length + 1);
      const pointer = await pointerOf(directory, 'offers');
      expect(pointer.sha256).toBe(sha256(notation));
      const exported = await Promise.all(
        shards.map((shard) =>
          readFile(
            join(
              directory,
              '.binary',
              'offers.shards',
              sha256(shard),
              'verified.lino'
            ),
            'utf8'
          )
        )
      );
      expect(exported.join('\n')).toBe(notation);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('propagates missing databases and unreadable shard manifests', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'sharded-io-errors-'));
    const clink = fakeClink();
    try {
      const notation = serializeRecords('offer', offers(10));
      let active = 0;
      let started = 0;
      const empty = new LinkCliMirror({
        ...tinyMirror,
        concurrency: 3,
        run: async (_command, arguments_) => {
          active += 1;
          started += 1;
          try {
            await new Promise((resolve) => setTimeout(resolve, 5 * started));
            const source = arguments_[arguments_.indexOf('--import') + 1];
            const target = arguments_[arguments_.indexOf('--export') + 1];
            await writeFile(target, await readFile(source, 'utf8'));
          } finally {
            active -= 1;
          }
        },
      });
      const missing = await empty
        .stage({ directory, kind: 'offers', notation })
        .then(
          () => undefined,
          (error) => error
        );
      expect(missing?.code).toBe('ENOENT');
      // No shard run may outlive the failed transaction or start after it.
      expect(active).toBe(0);
      expect(started).toBe(3);

      const mirror = new LinkCliMirror({ ...tinyMirror, run: clink.run });
      await mirror.ensure({ directory, kind: 'offers', notation });
      const shard = sha256(splitNotation(notation, tiny)[0]);
      const manifestPath = join(
        directory,
        '.binary',
        'offers.shards',
        shard,
        'manifest.json'
      );
      await rm(manifestPath);
      await mkdir(manifestPath);
      const unreadable = await mirror
        .stage({
          directory,
          kind: 'offers',
          notation: serializeRecords('offer', offers(10, ' changed')),
        })
        .then(
          () => undefined,
          (error) => error
        );
      expect(unreadable?.code).toBe('EISDIR');
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it('projects record-shaped shards through real link-cli', async () => {
    if (isDeno) {
      return;
    }
    const mirror = new LinkCliMirror({
      averageShardLinks: 24,
      maxShardLinks: 32,
      minShardLinks: 16,
    });
    try {
      await mirror.preflight();
    } catch {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'sharded-real-clink-'));
    try {
      const notation = serializeRecords('offer', offers(12));
      expect(splitNotation(notation, mirror.shardOptions).length > 3).toBe(
        true
      );
      await mirror.ensure({ directory, kind: 'offers', notation });
      const pointer = await pointerOf(directory, 'offers');
      const manifest = await manifestOf(pointer.directory);
      expect(manifest.shards.length > 3).toBe(true);
      await mirror.ensure({ directory, kind: 'offers', notation });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
