import { loadCommandStream } from '../scripts/use-module.mjs';
// Use the locked local package so this probe measures argv handling separately
// from the CDN loader, whose deadlines and retries have dedicated tests.
process.stderr.write('phase: load locked command-stream\n');
const { $ } = await loadCommandStream(() => import('command-stream'));
const message = process.argv[2];
process.stderr.write('phase: execute native argv echo\n');
const result =
  await $`${process.execPath} -e ${'process.stdout.write(process.argv[1])'} ${message}`.run(
    { capture: true, mirror: false }
  );
process.stdout.write(await result.text());
process.stderr.write('phase: complete\n');
