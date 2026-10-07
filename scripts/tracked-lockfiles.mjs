import { execFileSync } from 'node:child_process';
export function trackedPackageLocks({ cwd = '.', git = execFileSync } = {}) {
  return git(
    'git',
    ['ls-files', '-z', '--', 'package-lock.json', '**/package-lock.json'],
    { cwd, encoding: 'utf8' }
  )
    .split('\0')
    .filter(Boolean)
    .sort();
}
