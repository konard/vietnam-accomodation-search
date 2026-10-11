// Finite self-authored bind failure; no credentials or real listening socket.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { qaTemporaryDirectory, withQaCleanup } from './qa-cleanup.mjs';

await withQaCleanup(async (scope, signal) => {
  const directory = await qaTemporaryDirectory(scope, 'vac-bind-control-');
  const moduleUrl = pathToFileURL(`${process.cwd()}/src/self-check.js`).href;
  const code = `
    import http from 'node:http';
    http.Server.prototype.listen = function () {
      queueMicrotask(() => this.emit('error', new Error('Self-authored bind failure')));
      return this;
    };
    process.once('uncaughtException', () => {
      console.log(JSON.stringify({bindErrorUncaught:true}));
      setTimeout(() => process.exit(42), 20);
    });
    const {runFixtureSearch} = await import(${JSON.stringify(moduleUrl)});
    try {
      await runFixtureSearch({createApplication:()=>{throw new Error('Must not reach application')}});
      process.exitCode = 1;
    } catch {
      console.log(JSON.stringify({bindErrorRejected:true}));
    }
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TMPDIR: directory, TMP: directory, TEMP: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
    signal,
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.resume();
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  scope.defer('watchdog', () => clearTimeout(timer));
  scope.defer('child', async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await ended;
    }
  });
  const exitCode = await ended;
  const residue = await readdir(directory);
  const bindErrorRejected = output.includes('"bindErrorRejected":true');
  const ownedFixturesRemoved = residue.length === 0;
  console.log(
    JSON.stringify({
      bindErrorRejected,
      bindErrorUncaught: output.includes('"bindErrorUncaught":true'),
      ownedFixturesRemoved,
      childExit: exitCode,
      pass: bindErrorRejected && ownedFixturesRemoved && exitCode === 0,
    })
  );
  assert(bindErrorRejected, 'The self-check must reject a bind error.');
  assert(ownedFixturesRemoved, 'The self-check must remove its owned fixture.');
  assert.equal(exitCode, 0);
});
