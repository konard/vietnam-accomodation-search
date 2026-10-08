#!/usr/bin/env node

// Finite, self-authored conformance probes; no protected data or credentials.
// NODE_OPTIONS=--max-old-space-size=512 node SCRIPT CANDIDATE_NODE_MODULES
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { Link, Parser, formatLinks } from 'links-notation';
import { ProcessRunner } from 'command-stream/process-runner';
import * as logging from 'log-lazy';
import { serializeRecords } from '../src/links-store.js';

const candidates = resolve(process.argv[2]);
const latest = await import(
  pathToFileURL(join(candidates, 'links-notation/dist/index.js'))
);
const rows = [];
const records = [
  ' Vietnamese Căn hộ\n\t ',
  'Нячанг',
  'e\u0301',
  `a'b"c`,
  '18446744073709551615',
].map((object, index) => ({ id: `fixture:${index}`, object }));
const notation = serializeRecords('domain-record', records);
const oldParsed = new Parser().parse(notation);
const newParsed = new latest.Parser().parse(notation);
assert.equal(latest.formatLinks(newParsed), formatLinks(oldParsed));
const hash = (text) => createHash('sha256').update(text).digest('hex');
rows.push({
  name: 'typed-codec-0.22-to-0.23',
  pass: true,
  canonicalSha256: hash(notation),
  records: records.length,
});
for (const [version, runtime] of [
  ['0.22.0', { Link, Parser }],
  ['0.23.0', latest],
]) {
  const name = `a'b"c`;
  const text = `(${runtime.Link.escapeReference(name)}: x)`;
  let restored;
  try {
    restored = new runtime.Parser().parse(text)[0]?.id;
  } catch {
    restored = undefined;
  }
  rows.push({ name: `mixed-quotes-${version}`, pass: restored === name });
}
let preCalls = 0;
let postCalls = 0;
let sinkCalls = 0;
const log = logging.makeLog({
  level: 'warn',
  preprocessors: [
    ({ args }) => {
      preCalls += 1;
      return args;
    },
  ],
  postprocessors: [
    ({ message }) => {
      postCalls += 1;
      return message;
    },
  ],
  log: {
    warn: () => {
      sinkCalls += 1;
    },
  },
});
log.warn('self-authored diagnostic');
rows.push({
  name: 'published-log-lazy-hooks',
  perLevelSinks: sinkCalls === 1,
  preprocessors: preCalls === 1,
  postprocessors: postCalls === 1,
  context: typeof logging.preprocessors?.addContext === 'function',
});

const directory = await mkdtemp(join(tmpdir(), 'issue156-runner-'));
let ownedPid;
try {
  const executable = join(directory, 'node path Нячанг');
  await symlink(process.execPath, executable);
  const argv = [
    'literal $(do-not-run)',
    'a\'b"c',
    ' Căn hộ\n\t ',
    '18446744073709551615',
  ];
  const started = performance.now();
  const result = await new ProcessRunner(
    {
      mode: 'argv',
      file: executable,
      args: [
        '-e',
        'process.stdout.write(JSON.stringify(process.argv.slice(1)))',
        ...argv,
      ],
    },
    { mirror: false, capture: true, stdin: 'ignore' }
  );
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(String(result.stdout)), argv);
  rows.push({
    name: 'runner-1.3-argv',
    pass: true,
    elapsedMs: Math.round(performance.now() - started),
  });

  const ready = join(directory, 'ready');
  const source =
    'const fs=require("node:fs"); process.on("SIGTERM",()=>setTimeout(()=>process.exit(0),500)); fs.writeFileSync(process.argv[1],"ready"); setTimeout(()=>process.exit(0),3000);';
  const runner = new ProcessRunner(
    { mode: 'argv', file: executable, args: ['-e', source, ready] },
    { mirror: false, capture: false, stdin: 'ignore', killGrace: 800 }
  );
  const pending = runner.start();
  const deadline = performance.now() + 5000;
  while (
    !(await readFile(ready).then(
      () => true,
      () => false
    ))
  ) {
    if (performance.now() > deadline) {
      throw new Error('Owned child did not start within probe budget');
    }
    await delay(10);
  }
  ownedPid = runner.pid;
  const killedAt = performance.now();
  runner.kill('SIGTERM');
  await pending;
  let alive;
  try {
    process.kill(ownedPid, 0);
    alive = true;
  } catch {
    alive = false;
  }
  rows.push({
    name: 'runner-1.3-await-owned-close',
    pass: !alive,
    aliveAfterSettlement: alive,
    elapsedMs: Math.round(performance.now() - killedAt),
  });
} finally {
  if (ownedPid) {
    try {
      process.kill(ownedPid, 'SIGKILL');
    } catch {
      /* Already exited. */
    }
    // Only the disposable child is touched; wait for the runner's reaper.
    await delay(900);
  }
  await rm(directory, { recursive: true, force: true });
}
console.log(
  JSON.stringify(
    { mode: 'self-authored-dependency-conformance', rows },
    null,
    2
  )
);
