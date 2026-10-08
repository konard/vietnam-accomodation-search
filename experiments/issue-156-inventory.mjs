#!/usr/bin/env node

// Record exact lockfile resolutions, never credentials or machine paths.
// node SCRIPT LINK_CLI_CARGO_LOCK REPORT_DIRECTORY
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const [cargoPath, directory] = process.argv.slice(2);
if (!cargoPath || !directory) {
  throw new TypeError(
    'Supply the pinned link-cli Cargo.lock and report directory'
  );
}
const packageText = await readFile('package-lock.json', 'utf8');
const lock = JSON.parse(packageText);
const cargoText = await readFile(cargoPath, 'utf8');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const javascript = Object.entries(lock.packages)
  .filter(([path]) => path)
  .map(([path, value]) => ({
    name: path.split('node_modules/').at(-1),
    version: value.version,
    location: path,
  }));
const rust = cargoText
  .split('[[package]]')
  .slice(1)
  .map((block) => ({
    name: block.match(/^name = "([^"]+)"/m)?.[1],
    version: block.match(/^version = "([^"]+)"/m)?.[1],
    checksum: block.match(/^checksum = "([^"]+)"/m)?.[1] ?? null,
  }));
if (
  !rust.some(({ name, version }) => name === 'link-cli' && version === '0.2.11')
) {
  throw new TypeError('Cargo.lock must describe link-cli 0.2.11');
}
await mkdir(directory, { recursive: true });
for (const [name, payload] of [
  [
    'javascript-resolutions.json',
    {
      lockSha256: sha256(packageText),
      dependencies: lock.packages[''].dependencies,
      packages: javascript,
    },
  ],
  ['rust-resolutions.json', { lockSha256: sha256(cargoText), packages: rust }],
]) {
  await writeFile(
    join(directory, name),
    `${JSON.stringify(payload, null, 2)}\n`
  );
}
