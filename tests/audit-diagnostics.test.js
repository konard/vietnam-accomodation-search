import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'test-anywhere';
import {
  createAuditDiagnostics,
  diskUsage,
  timerWarning,
} from '../experiments/audit-diagnostics.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';

describe('private audit diagnostics', () => {
  it('keeps timer value and module/line evidence while excluding arbitrary warning text and paths', () => {
    const diagnostic = timerWarning({
      name: 'TimeoutNegativeWarning',
      message: '-42.5 is a negative number. private token source message',
      stack:
        'private header\n at sleep (/private/user/source/node_modules/teleproto/Helpers.js:393:10)\n at secret content',
    });
    expect(diagnostic).toEqual({
      type: 'negative-timer',
      delayMs: -42.5,
      frames: ['Helpers.js:393:10'],
    });
    expect(timerWarning({ name: 'OtherWarning' })).toBe(undefined);
  });

  it('measures source/projection time, disk allocation and RSS without reading private contents', async () => {
    if (isDeno) {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'audit-diagnostics-'));
    try {
      await mkdir(join(directory, 'nested'));
      await writeFile(
        join(directory, 'nested', 'private.json'),
        'private material'
      );
      if (process.platform !== 'win32') {
        await symlink(directory, join(directory, 'ignored-symlink'));
      }
      const usage = await diskUsage(directory);
      expect(usage.files).toBe(1);
      expect(usage.logicalBytes).toBe(16);
      const events = [];
      const diagnostics = createAuditDiagnostics({
        directory,
        emit: (event) => events.push(event),
        minFreeBytes: 0,
      });
      expect(
        await diagnostics.measure(
          { phase: 'source', ordinal: 1 },
          async () => 'result'
        )
      ).toBe('result');
      await diagnostics.measure({ phase: 'projection' }, async () => {});
      expect(events.map(({ state }) => state)).toEqual([
        'start',
        'success',
        'start',
        'success',
      ]);
      expect(events[1].durationMs >= 0).toBe(true);
      expect(events[1].sampledPeakTreeRssBytes > 0).toBe(true);
      expect(JSON.stringify(events)).not.toContain('private');
      let failed = false;
      try {
        await diagnostics.measure({ phase: 'projection' }, async () => {
          throw new Error('private error');
        });
      } catch {
        failed = true;
      }
      expect(failed).toBe(true);
      expect(events[events.length - 1].state).toBe('failure');
      const original = new Error('original operation failure');
      const brokenRecorder = createAuditDiagnostics({
        directory,
        minFreeBytes: 0,
        emit: ({ state }) => {
          if (state === 'failure') {
            throw new Error('diagnostic recording failure');
          }
        },
      });
      let recorded;
      try {
        await brokenRecorder.measure({ phase: 'source' }, async () => {
          throw original;
        });
      } catch (error) {
        recorded = error;
      }
      expect(recorded).toBe(original);
      let invoked = false;
      const bounded = createAuditDiagnostics({
        directory,
        emit: () => {},
        minFreeBytes: Number.MAX_SAFE_INTEGER,
      });
      try {
        await bounded.measure({ phase: 'source' }, async () => {
          invoked = true;
        });
      } catch (error) {
        expect(error.code).toBe('audit-disk-budget-exhausted');
      }
      expect(invoked).toBe(false);
      expect(() =>
        createAuditDiagnostics({ directory, minFreeBytes: -1 })
      ).toThrow();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
