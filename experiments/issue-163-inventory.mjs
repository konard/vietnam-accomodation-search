// Resolved maintained dependencies only; no private data or network credentials.
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const baseline = resolve(process.argv[2]);
const candidate = resolve(process.argv[3]);
const direct = JSON.parse(
  await readFile(join(candidate, 'package.json'), 'utf8')
);
const packages = JSON.parse(
  await readFile(join(candidate, 'package-lock.json'), 'utf8')
).packages;
const previous = JSON.parse(
  await readFile(join(baseline, 'package-lock.json'), 'utf8')
).packages;
const inventory = [];
for (const [path, value] of Object.entries(packages)) {
  if (!path) {
    continue;
  }
  const metadata = await readFile(
    join(candidate, path, 'package.json'),
    'utf8'
  ).then(JSON.parse, () => ({}));
  const repository =
    typeof metadata.repository === 'string'
      ? metadata.repository
      : metadata.repository?.url || '';
  if (
    !/github\.com[/:](?:link-foundation|link-assistant)\//u.test(repository)
  ) {
    continue;
  }
  inventory.push({
    name: metadata.name,
    version: value.version,
    previousVersion: previous[path]?.version || null,
    direct: Boolean(
      path === `node_modules/${metadata.name}` &&
      (direct.dependencies[metadata.name] ||
        direct.devDependencies[metadata.name])
    ),
    path,
    repository,
  });
}
async function bytesBelow(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    total += entry.isDirectory()
      ? await bytesBelow(path)
      : (await stat(path)).size;
  }
  return total;
}
function startup(directory) {
  return Array.from({ length: 5 }, () => {
    const result = spawnSync(
      process.execPath,
      [
        '--max-old-space-size=512',
        '--input-type=module',
        '-e',
        'const t=performance.now(); await import("./src/index.js"); console.log(performance.now()-t);',
      ],
      { cwd: directory, encoding: 'utf8' }
    );
    if (result.status !== 0) {
      throw new Error(result.stderr);
    }
    return Math.round(Number(result.stdout.trim()));
  });
}
const records = [' Căn hộ\n\t ', 'Нячанг', `a'b"c`, '18446744073709551615'].map(
  (object, id) => ({ id: String(id), object })
);
const before = await import(
  new globalThis.URL(`file://${baseline}/src/links-store.js`)
);
const after = await import(
  new globalThis.URL(`file://${candidate}/src/links-store.js`)
);
const beforeText = before.serializeRecords('domain-record', records);
const afterText = after.serializeRecords('domain-record', records);
const runtime = await import(
  new globalThis.URL(
    `file://${candidate}/node_modules/links-notation/dist/index.js`
  )
);
const mixed = `a'b"c`;
let restored;
try {
  restored = new runtime.Parser().parse(
    `(${runtime.Link.escapeReference(mixed)}: x)`
  )[0]?.id;
} catch {
  /* Explicit failed published contract. */
}
console.log(
  JSON.stringify(
    {
      inventory,
      measurements: {
        baselineInstallBytes: await bytesBelow(join(baseline, 'node_modules')),
        candidateInstallBytes: await bytesBelow(
          join(candidate, 'node_modules')
        ),
        baselineStartupMs: startup(baseline),
        candidateStartupMs: startup(candidate),
        typedCodecUnchanged: beforeText === afterText,
        typedCodecSha256: createHash('sha256').update(afterText).digest('hex'),
        mixedQuoteReferenceRoundtrip: restored === mixed,
      },
    },
    null,
    2
  )
);
