import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'test-anywhere';

import {
  analyzeMarkers,
  compareFingerprints,
  countRunningContainers,
  countDuplicateDeliveries,
  DEFAULT_TRANSITIONS,
  markerCommand,
  markerSequence,
  parseDrillArguments,
  stateFingerprint,
  summarizePollerSamples,
  transitionExpectation,
  transitionFailures,
  unhealthyComposeFile,
} from '../experiments/deploy-cutover-drill-lib.mjs';
import { validateDataDirectory } from '../scripts/data-directory.mjs';
import { LinksStore } from '../src/index.js';

const isDeno = typeof globalThis.Deno !== 'undefined';

function message(action) {
  try {
    action();
  } catch (error) {
    return error.message;
  }
  return undefined;
}

const required = [
  '--bot-env',
  'bot.env',
  '--user-env',
  'user.env',
  '--project-name',
  'vas-drill',
  '--data-directory',
  'drill-data',
];

describe('deploy cutover drill (#57)', () => {
  it('runs only against an isolated drill project and data directory', () => {
    const options = parseDrillArguments(required, { cwd: '/srv' });
    expect(options.dataDirectory).toBe(resolve('/srv', 'drill-data'));
    expect(options.transitions).toEqual(DEFAULT_TRANSITIONS);
    expect(DEFAULT_TRANSITIONS.includes('docker-restart')).toBe(false);
    expect(options.healthPort).toBe(18_080);
    const selected = parseDrillArguments([
      ...required,
      '--transitions',
      'first-deploy,unhealthy-candidate',
      '--restore-snapshot',
      '--settle-ms',
      '6000',
    ]);
    expect(selected.restoreSnapshot).toBe(true);
    expect(selected.settleMs).toBe(6_000);
    expect(selected.transitions).toEqual([
      'first-deploy',
      'unhealthy-candidate',
    ]);
    expect(parseDrillArguments(['--help']).help).toBe(true);
    expect(message(() => parseDrillArguments(required.slice(2)))).toContain(
      'are required'
    );
    for (const project of [
      'vietnam-accommodation-search',
      'staging',
      'Drill',
    ]) {
      const values = [...required];
      values[5] = project;
      expect(message(() => parseDrillArguments(values))).toContain(
        'own Compose project'
      );
    }
    const production = [...required];
    production[7] = '/srv/vietnam-search/data';
    expect(message(() => parseDrillArguments(production))).toContain(
      'data directory path must contain'
    );
    expect(
      message(() => parseDrillArguments([...required, '--health-port', '80']))
    ).toContain('--health-port must be between');
    expect(
      message(() => parseDrillArguments([...required, '--transitions', 'x']))
    ).toContain('--transitions must list');
    expect(message(() => parseDrillArguments(['--image']))).toBe(
      'Unknown or incomplete option: --image'
    );
  });

  it('counts lost and duplicated marker replies with server timestamps', () => {
    expect(markerCommand('r1', 3)).toBe('/preset show drill-r1-3');
    expect(markerSequence('Search preset not found: drill-r1-3', 'r1')).toBe(3);
    expect(markerSequence('Search preset not found: drill-r2-3', 'r1')).toBe(
      undefined
    );
    const sent = [
      { date: 100, sequence: 1 },
      { date: 102, sequence: 2 },
      { date: 104, sequence: 3 },
    ];
    const replies = [
      { date: 101, text: 'Search preset not found: drill-r1-1' },
      { date: 115, text: 'Search preset not found: drill-r1-2' },
      { date: 116, text: 'Search preset not found: drill-r1-2' },
      { date: 117, text: 'Search preset not found: drill-r1-9' },
      { date: 118, text: 'Saved preset drill-r1.' },
    ];
    expect(analyzeMarkers({ replies, run: 'r1', sent })).toEqual({
      answered: 2,
      duplicated: 1,
      lost: 1,
      maxReplyLatencySeconds: 13,
      sent: 3,
      unexpectedReplies: 1,
    });
  });

  it('summarizes the single-poller samples', () => {
    expect(countRunningContainers('abc\n\ndef\n')).toBe(2);
    expect(countRunningContainers('')).toBe(0);
    expect(summarizePollerSamples([1, 0, 0, 1])).toEqual({
      maxRunning: 1,
      samples: 4,
      zeroRunningSamples: 2,
    });
    expect(summarizePollerSamples([]).maxRunning).toBe(0);
  });

  it('reports every broken invariant of a transition', () => {
    const clean = {
      comparison: {
        binaryMirrorMissing: false,
        changedCollections: [],
        mediaFilesLost: 0,
      },
      exitCode: 0,
      markers: { duplicated: 0, lost: 0 },
      pollers: { maxRunning: 1, zeroRunningSamples: 3 },
    };
    expect(transitionFailures(clean)).toEqual([]);
    expect(transitionFailures({ ...clean, comparison: undefined })).toEqual([]);
    const unhealthy = transitionExpectation('unhealthy-candidate');
    expect(unhealthy).toEqual({
      failure: true,
      image: 'unchanged',
      uninterrupted: false,
    });
    expect(
      transitionFailures({
        ...clean,
        exitCode: 1,
        expectation: unhealthy,
        images: { after: 'sha256:a', expected: 'sha256:a' },
      })
    ).toEqual([]);
    expect(
      transitionFailures({
        ...clean,
        expectation: unhealthy,
        images: { after: 'sha256:b', expected: 'sha256:a' },
      })
    ).toEqual([
      'the bad candidate was accepted',
      'the running image is not the unchanged image',
    ]);
    expect(
      transitionFailures({
        ...clean,
        exitCode: 1,
        expectation: transitionExpectation('failed-preflight'),
        images: { after: 'sha256:a', expected: 'sha256:a' },
      })
    ).toEqual(['the old service stopped before the candidate was proven']);
    expect(transitionExpectation('rollback').image).toBe('first-deploy');
    expect(
      transitionFailures({
        comparison: {
          binaryMirrorMissing: true,
          changedCollections: ['presets'],
          mediaFilesLost: 2,
        },
        deliveries: 1,
        exitCode: 1,
        markers: { duplicated: 1, lost: 2 },
        pollers: { maxRunning: 2, zeroRunningSamples: 0 },
      })
    ).toEqual([
      'the deploy command exited 1',
      'more than one app container ran at once',
      '2 marker commands were never answered',
      '1 marker commands were answered twice',
      '1 deliveries arrived more than once',
      'collections changed: presets',
      '2 media files were lost',
      'the binary projection was not rebuilt',
    ]);
    expect(countDuplicateDeliveries(['offer a', 'offer b', 'offer a'])).toBe(1);
  });

  it('extends the production service with a check only the prior image passes', () => {
    const text = unhealthyComposeFile('../../compose.yaml');
    expect(text).toContain('file: "../../compose.yaml"');
    expect(text).toContain('service: app');
    expect(text).toContain(
      "if(!'${APP_IMAGE}'.includes(':rollback-'))process.exit(1);"
    );
    expect(text).toContain('retries: 2');
  });

  it('fingerprints decoded records, not their text form', async () => {
    // Deno runs the suite with read-only permissions.
    if (isDeno) {
      return;
    }
    const root = await realpath(await mkdtemp(join(tmpdir(), 'drill-')));
    try {
      const data = await validateDataDirectory(join(root, 'data'));
      const store = new LinksStore({ directory: data });
      await store.saveRecords('presets', [
        { id: 'b', name: 'drill-b' },
        { id: 'a', name: 'drill a' },
      ]);
      await store.saveSearchState({ cursor: 1 });
      await writeFile(join(data, 'journal.lino'), 'free text\n');
      await mkdir(join(data, 'media', 'x'), { recursive: true });
      await writeFile(join(data, 'media', 'x', 'photo'), 'cache');
      const before = await stateFingerprint(data);
      expect(before.collections.presets.records).toBe(2);
      expect(before.mediaFiles).toBe(1);
      expect(before.binaryFiles).toBe(0);
      expect(before.dataSchema).toBe(2);
      expect(Object.keys(before.collections)).toEqual([
        'journal',
        'presets',
        'search-state',
      ]);
      expect(JSON.stringify(before)).not.toContain('drill');

      await store.saveRecords('presets', [
        { id: 'a', name: 'drill a' },
        { id: 'b', name: 'drill-b' },
      ]);
      expect(compareFingerprints(before, await stateFingerprint(data))).toEqual(
        {
          binaryMirrorMissing: false,
          changedCollections: [],
          mediaFilesLost: 0,
        }
      );

      await store.saveRecords('presets', [{ id: 'a', name: 'drill a' }]);
      await store.saveSearchState({ cursor: 2 });
      await rm(join(data, 'media'), { force: true, recursive: true });
      expect(compareFingerprints(before, await stateFingerprint(data))).toEqual(
        {
          binaryMirrorMissing: false,
          changedCollections: ['presets', 'search-state'],
          mediaFilesLost: 1,
        }
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
