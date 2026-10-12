// Explicit local crash recovery. Never infer quiescence from lock age.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recoverOperationLock } from '../scripts/owned-operation-lock.mjs';

export function recoverOwnedLock(args) {
  const option = (name) => args[args.indexOf(name) + 1];
  if (
    !args.includes('--lock') ||
    !args.includes('--evidence') ||
    !args.includes('--producers-stopped')
  ) {
    throw new Error(
      'Use --lock PATH --evidence PRIVATE_OWNER_COPY --producers-stopped after independently joining every owned producer.'
    );
  }
  return recoverOperationLock(
    resolve(option('--lock')),
    resolve(option('--evidence')),
    { producersStopped: true }
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  recoverOwnedLock(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        'Exact lock recovery rejected; private evidence and cached data retained.'
      );
      process.exitCode = 1;
    });
}
