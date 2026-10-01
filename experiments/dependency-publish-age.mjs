#!/usr/bin/env node
// Print the npm publish age of every direct dependency resolved in a lockfile,
// so a bump can be checked against Deno's 24 h minimum dependency age.
// Usage: node experiments/dependency-publish-age.mjs [package-dir]
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const dir = process.argv[2] ?? '.';
const manifest = JSON.parse(await readFile(path.join(dir, 'package.json')));
const lock = JSON.parse(await readFile(path.join(dir, 'package-lock.json')));
const names = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
});
for (const name of names.sort()) {
  const version = lock.packages[`node_modules/${name}`]?.version;
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}`
  );
  const time = (await response.json()).time?.[version];
  const hours = time
    ? ((Date.now() - Date.parse(time)) / 36e5).toFixed(1)
    : '?';
  console.log(`${name}@${version} published ${time} (${hours} h ago)`);
}
