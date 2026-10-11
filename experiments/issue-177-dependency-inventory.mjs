// Public registry evidence for both committed lockfiles; no private npm config.
import { readFile, writeFile } from 'node:fs/promises';

const manifests = ['.', 'examples/universal-app'];
const packages = new Map();
const projects = [];
for (const directory of manifests) {
  const manifest = JSON.parse(
    await readFile(`${directory}/package.json`, 'utf8')
  );
  const lock = JSON.parse(
    await readFile(`${directory}/package-lock.json`, 'utf8')
  );
  const entries = [];
  for (const [path, value] of Object.entries(lock.packages)) {
    if (!path || !value.version) {
      continue;
    }
    const name = value.name || path.split('node_modules/').at(-1);
    entries.push({ name, version: value.version, path });
    packages.set(name, undefined);
  }
  projects.push({
    directory,
    direct: { ...manifest.dependencies, ...manifest.devDependencies },
    entries,
  });
}
const pending = [...packages.keys()];
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (pending.length) {
      const name = pending.shift();
      try {
        const response = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`,
          { signal: AbortSignal.timeout(15000) }
        );
        if (!response.ok) {
          throw new Error(`Registry HTTP ${response.status}`);
        }
        packages.set(name, { latest: (await response.json()).version });
      } catch (error) {
        packages.set(name, { unavailable: error.message });
      }
    }
  })
);
const report = {
  observedAt: new Date().toISOString(),
  source: 'https://registry.npmjs.org/{package}/latest',
  policy:
    'A latest-tag difference is reported for every transitive; it does not establish compatibility or vulnerability. command-stream 2.0.0 was rejected; 2.0.2 removes the vulnerable compatibility tree and passes a clean production consumer audit.',
  projects: projects.map(({ directory, direct, entries }) => ({
    directory,
    direct: Object.entries(direct).map(([name, requested]) => ({
      name,
      requested,
      versions: [
        ...new Set(
          entries
            .filter((entry) => entry.name === name)
            .map((entry) => entry.version)
        ),
      ],
      ...packages.get(name),
    })),
    lockedPackages: entries.map((entry) => ({
      ...entry,
      ...packages.get(entry.name),
    })),
  })),
};
if (process.argv[2]) {
  await writeFile(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    projects: projects.length,
    registryPackages: packages.size,
    unavailable: [...packages.values()].filter((value) => value.unavailable)
      .length,
  })
);
