// Reproduces the domain-records crash with a 64 KiB parse bound: 1,000
// semantic links are saved, one more is appended with updateRecords, and the
// collection is read back, with the binary mirror on and a clink stand-in
// that stores and exports each import as it is.
// Usage: node experiments/issue-90-reproduce.mjs [checkout]
// A checkout without setNotationLimit needs MAX_NOTATION_LENGTH edited to
// 64 * 1024 in its src/link-cli-mirror.js first.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const mirrorModule = await import(join(root, 'src/link-cli-mirror.js'));
const { LinksStore } = await import(join(root, 'src/links-store.js'));
mirrorModule.setNotationLimit?.(64 * 1024);
const record = (index) => ({
  id: `subject:${index}#values.text`,
  object: `Căn hộ ${index} — view biển`,
  predicate: 'values.text',
  subject: `subject:${index}`,
  type: 'semantic-link',
});
const directory = await mkdtemp(join(tmpdir(), 'issue-90-reproduce-'));
const store = new LinksStore({
  directory,
  mirror: new mirrorModule.LinkCliMirror({
    run: async (_command, arguments_) => {
      const value = (flag) => arguments_[arguments_.indexOf(flag) + 1];
      const notation = await readFile(value('--import'), 'utf8');
      await writeFile(value('--db'), `binary:${notation.length}`);
      await writeFile(value('--export'), notation);
    },
  }),
});
try {
  await store.saveRecords(
    'domain-records',
    Array.from({ length: 1000 }, (_, index) => record(index))
  );
  await store.updateRecords('domain-records', (old) => [...old, record(1000)]);
  console.log('round-trip', (await store.loadRecords('domain-records')).length);
} catch (error) {
  console.log('FAIL', error.message);
  console.log(error.stack.split('\n').slice(1, 6).join('\n'));
  process.exitCode = 1;
} finally {
  await rm(directory, { force: true, recursive: true });
}
