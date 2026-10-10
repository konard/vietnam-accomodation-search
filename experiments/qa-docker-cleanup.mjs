// Exact, run-owned Docker cleanup. Never prunes shared Docker resources.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
const exec = promisify(execFile);
const lines = (value) => [...new Set(value.trim().split('\n').filter(Boolean))];

export async function dockerCommand(args) {
  return (
    await exec('docker', args, { timeout: 30_000, maxBuffer: 4 * 1024 ** 2 })
  ).stdout;
}

export async function dockerInventory(run = dockerCommand) {
  const rows = await Promise.all([
    run(['ps', '-aq', '--no-trunc']),
    run(['network', 'ls', '-q', '--no-trunc']),
    run(['volume', 'ls', '-q']),
    run([
      'image',
      'ls',
      '--no-trunc',
      '--format',
      '{{.ID}} {{.Repository}}:{{.Tag}}',
    ]),
    run(['buildx', 'ls', '--format', '{{.Name}}']),
  ]);
  return Object.fromEntries(
    ['containers', 'networks', 'volumes', 'images', 'builders'].map(
      (name, index) => [name, lines(rows[index]).sort()]
    )
  );
}

export class QaDockerCleanup {
  constructor({ runId, baseline, run = dockerCommand }) {
    if (!/^vac-qa-[a-z0-9-]{8,100}$/u.test(runId)) {
      throw new Error('Unique Docker QA run ID required.');
    }
    this.runId = runId;
    this.label = `foundation.qa.run=${runId}`;
    this.baseline = baseline;
    this.run = run;
    this.imageRefs = new Set();
    this.builders = new Set();
  }

  ownImage(ref) {
    if (this.baseline.images.some((row) => row.endsWith(` ${ref}`))) {
      throw new Error('Refusing to own a pre-existing image reference.');
    }
    this.imageRefs.add(ref);
  }

  ownBuilder(name) {
    if (this.baseline.builders.includes(name) || !name.startsWith(this.runId)) {
      throw new Error('Refusing to own a pre-existing or unrelated builder.');
    }
    this.builders.add(name);
  }

  async cleanup() {
    const failures = [];
    const attempt = async (name, action) => {
      try {
        await action();
      } catch {
        failures.push(name);
      }
    };
    for (const [kind, list, remove] of [
      [
        'containers',
        ['ps', '-aq', '--filter', `label=${this.label}`],
        ['rm', '-f'],
      ],
      [
        'networks',
        ['network', 'ls', '-q', '--filter', `label=${this.label}`],
        ['network', 'rm'],
      ],
      [
        'volumes',
        ['volume', 'ls', '-q', '--filter', `label=${this.label}`],
        ['volume', 'rm'],
      ],
    ]) {
      await attempt(kind, async () => {
        for (const id of lines(await this.run(list))) {
          // A unique label alone is not permission to destroy the baseline.
          if (this.baseline[kind].includes(id)) {
            throw new Error(
              'QA label unexpectedly belongs to baseline resource.'
            );
          }
          await attempt(`${kind} deletion`, () => this.run([...remove, id]));
        }
        if (lines(await this.run(list)).length) {
          throw new Error('Owned Docker resource survived.');
        }
      });
    }
    for (const builder of this.builders) {
      await attempt('builder deletion', async () => {
        if ((await dockerInventory(this.run)).builders.includes(builder)) {
          await this.run(['buildx', 'rm', builder]);
        }
      });
    }
    for (const ref of this.imageRefs) {
      await attempt('image deletion', async () => {
        if (
          (await dockerInventory(this.run)).images.some((row) =>
            row.endsWith(` ${ref}`)
          )
        ) {
          await this.run(['image', 'rm', ref]);
        }
      });
    }
    let restored = false;
    await attempt('baseline verification', async () => {
      for (let attempt = 0; attempt < 10 && !restored; attempt += 1) {
        restored =
          JSON.stringify(await dockerInventory(this.run)) ===
          JSON.stringify(this.baseline);
        if (!restored) {
          await delay(300);
        }
      }
      if (!restored) {
        throw new Error('Docker inventory differs from baseline.');
      }
    });
    return {
      pass: failures.length === 0 && restored,
      failures,
      baselineRestored: restored,
    };
  }
}
