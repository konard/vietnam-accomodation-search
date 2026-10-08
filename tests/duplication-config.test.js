import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'test-anywhere';

const configPath = new globalThis.URL('../.jscpd.json', import.meta.url);
const cli = new globalThis.URL(
  '../node_modules/jscpd/run-jscpd.js',
  import.meta.url
);

describe('actual duplication checker configuration (#152)', () => {
  it('accepts every tracked setting and preserves the existing threshold and minimum clone sizes', async () => {
    const config = JSON.parse(await readFile(configPath, 'utf8'));
    assert.equal(config.mode, 'weak');
    assert.equal(config.threshold, 10);
    assert.equal(config.minTokens, 30);
    assert.equal(config.minLines, 5);
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(cli), '--config', fileURLToPath(configPath), '--debug'],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(
      result.stderr + result.stdout,
      /unknown field|invalid|warning/iu
    );
  });

  it('excludes duplicate comments while still failing the same threshold for duplicate executable code', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'duplication-config-'));
    try {
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      // Python emits comment tokens in strict mode; JavaScript excludes them in every mode.
      const path = join(directory, '.jscpd.json');
      const writeConfig = (mode = config.mode) =>
        writeFile(
          path,
          JSON.stringify({
            ...config,
            mode,
            format: ['python'],
            reporters: ['json'],
            threshold: 0,
            output: join(directory, 'report'),
          })
        );
      await writeConfig();
      const run = () =>
        spawnSync(
          process.execPath,
          [fileURLToPath(cli), '--config', path, resolve(directory)],
          { encoding: 'utf8' }
        );
      const comments = Array.from(
        { length: 40 },
        (_, index) =>
          `# Shared documentation line ${index}: only comments should be ignored.`
      ).join('\n');
      for (const name of ['first', 'second']) {
        await writeFile(join(directory, `${name}.py`), `${comments}\n`);
      }
      const commentsOnly = run();
      assert.equal(commentsOnly.status, 0, commentsOnly.stderr);
      assert.doesNotMatch(commentsOnly.stderr, /unknown field/iu);
      await writeConfig('strict');
      const strict = run();
      assert.equal(strict.status, 1, strict.stderr);
      await writeConfig();
      for (const name of ['first', 'second']) {
        await writeFile(
          join(directory, `${name}.py`),
          Array.from(
            { length: 12 },
            (_, index) =>
              `value_${index} = compute(${index}, "duplicate executable code")`
          ).join('\n')
        );
      }
      const code = run();
      assert.equal(code.status, 1, code.stderr);
      const report = JSON.parse(
        await readFile(join(directory, 'report', 'jscpd-report.json'), 'utf8')
      );
      assert(report.duplicates.length > 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
