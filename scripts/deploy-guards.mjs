import { appendFile, chmod, readdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { CONFLICT_MESSAGE } from '../src/telegram-runtime.js';
import { redactTelegramValue } from '../src/telegram-errors.js';
import { SCHEMA_FILE } from './data-directory.mjs';

const TRANSIENT_ENTRY = /^\.(?:write-probe-|container-write-probe)/u;
const COMMAND_TEXT_LIMIT = 160;
const OUTPUT_LIMIT = 8 * 1024;

/** What a data directory holds, read without creating or changing it. */
export async function inspectDataDirectory(path) {
  let entries;
  try {
    entries = await readdir(path);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { exists: false, hasData: false, marked: false };
    }
    throw error;
  }
  return {
    exists: true,
    hasData: entries.some(
      (name) => name !== SCHEMA_FILE && !TRANSIENT_ENTRY.test(name)
    ),
    marked: entries.includes(SCHEMA_FILE),
  };
}

function replacementRefused({ same, target, previous }) {
  // The recorded deploy wrote the marker, so its own directory without one
  // was wiped or replaced.
  if (same) {
    return !target.marked;
  }
  const previousEmpty = previous.exists && !previous.hasData;
  return (!target.marked || !target.hasData) && !previousEmpty;
}

function planMissingDirectory({ action, deployed, requested }) {
  if (action === 'deploy' && !deployed) {
    return { create: true, validate: true };
  }
  if (action === 'status' || action === 'logs') {
    return { create: false, validate: false };
  }
  throw new Error(
    deployed
      ? `Data directory ${requested} does not exist; a recorded deployment never creates its data directory.`
      : `Data directory ${requested} does not exist.`
  );
}

/**
 * Decide whether an action may use, create, or must refuse a data directory.
 * A project with a recorded deployment keeps its directory: a different path
 * needs `moveDataDirectory`, a missing one is never created, and an empty or
 * unmarked one needs `allowEmptyDataDirectory` while the old one holds data.
 */
export function planDataDirectory({
  action,
  allowEmptyDataDirectory = false,
  moveDataDirectory = false,
  previous,
  requested,
  state = {},
  target,
}) {
  const deployed = Boolean(state.currentImage || state.dataDirectory);
  const recorded = state.dataDirectory;
  const same = !recorded || recorded === requested;
  if (action === 'deploy' && !same && !moveDataDirectory) {
    throw new Error(
      `The recorded deployment uses data directory ${recorded}, not ${requested}. Pass --move-data-directory to move the deployment to ${requested}.`
    );
  }
  if (!target.exists) {
    return planMissingDirectory({ action, deployed, requested });
  }
  if (
    action === 'deploy' &&
    recorded &&
    !allowEmptyDataDirectory &&
    replacementRefused({ previous, same, target })
  ) {
    throw new Error(
      `Data directory ${requested} is empty or has no ${SCHEMA_FILE} marker, but the recorded deployment's data directory ${recorded} may hold data. Pass --allow-empty-data-directory to start from it anyway.`
    );
  }
  return { create: false, validate: true };
}

/**
 * Run inside the candidate image with the project's environment. It prints
 * only a SHA-256 digest, so the token never reaches the host process.
 */
export const TOKEN_FINGERPRINT_SCRIPT =
  "import { createHash } from 'node:crypto'; import { readFile } from 'node:fs/promises'; const file = process.env.TELEGRAM_BOT_TOKEN_FILE; const token = file ? (await readFile(file, 'utf8')).trim() : process.env.TELEGRAM_BOT_TOKEN; if (token) console.log(createHash('sha256').update('telegram-bot-token:' + token).digest('hex'));";

/** Token fingerprints recorded by every project below the state root. */
export async function readTokenFingerprints(root = '.deploy') {
  let names;
  try {
    names = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  const records = [];
  for (const entry of names.filter((name) => name.isDirectory())) {
    try {
      const state = JSON.parse(
        await readFile(join(root, entry.name, 'state.json'), 'utf8')
      );
      if (state.tokenFingerprint) {
        records.push({
          projectName: entry.name,
          tokenFingerprint: state.tokenFingerprint,
        });
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return records;
}

/** Refuse a bot token another Compose project already polls with. */
export function assertTokenNotShared({
  allowSharedToken = false,
  fingerprint,
  projectName,
  records,
}) {
  if (!fingerprint || allowSharedToken) {
    return;
  }
  const owners = records
    .filter(
      (record) =>
        record.projectName !== projectName &&
        record.tokenFingerprint === fingerprint
    )
    .map((record) => record.projectName);
  if (owners.length) {
    throw new Error(
      `Compose project ${owners.join(', ')} already deploys this bot token; Telegram allows one poller per token, so both bots would fail with 409 Conflict. Use a separate bot for ${projectName}, remove the other project's .deploy record, or pass --allow-shared-token.`
    );
  }
}

/** The host addresses the rendered Compose model publishes for the app. */
export function publishedPorts(model) {
  return (model?.services?.app?.ports || [])
    .filter((port) => port.published !== undefined && port.published !== '')
    .map((port) => ({
      host: port.host_ip || '0.0.0.0',
      port: Number(port.published),
      target: Number(port.target),
    }));
}

/** Resolves true when a TCP listener could bind the address right now. */
export function probePort({ host, port }) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', (error) =>
      error.code === 'EADDRINUSE' || error.code === 'EACCES'
        ? resolve(false)
        : reject(error)
    );
    server.listen({ exclusive: true, host, port }, () =>
      server.close(() => resolve(true))
    );
  });
}

/**
 * Fail before anything is built or stopped when a published port is taken
 * by something other than this project's own running container.
 */
export async function assertPortsAvailable({
  owned = [],
  ports,
  probe = probePort,
}) {
  for (const address of ports) {
    if (owned.some((own) => own.port === address.port)) {
      continue;
    }
    if (!(await probe(address))) {
      throw new Error(
        `Host port ${address.host}:${address.port} is already in use; set HEALTH_PORT to a free port.`
      );
    }
  }
}

/** Parse `docker compose port` output such as `127.0.0.1:8080`. */
export function parsePortBinding(text) {
  const match = /:(\d+)\s*$/u.exec(String(text || '').trim());
  return match ? [{ port: Number(match[1]) }] : [];
}

/** Container facts the settle window samples from `docker inspect`. */
export const SETTLE_INSPECT_FORMAT =
  '{{.RestartCount}} {{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{end}}';

export function parseSettleSample(inspectText, logsText = '') {
  const [restarts, running, health = ''] = String(inspectText)
    .trim()
    .split(/\s+/u);
  return {
    conflicts: String(logsText).split(CONFLICT_MESSAGE).length - 1,
    health,
    restarts: Number(restarts),
    running: running === 'true',
  };
}

function settleFailure(baseline, current) {
  if (current.conflicts > 0) {
    return `${current.conflicts} Telegram polling conflict(s): another poller holds this bot token`;
  }
  if (current.restarts > baseline.restarts) {
    return `the container restarted ${current.restarts - baseline.restarts} time(s)`;
  }
  if (!current.running) {
    return 'the container stopped';
  }
  if (current.health === 'unhealthy') {
    return 'the container became unhealthy';
  }
  return undefined;
}

/**
 * Watch a ready candidate for `durationMs`. Any restart, stop, unhealthy
 * status, or polling conflict fails the deployment.
 */
export async function observeSettle({
  durationMs,
  intervalMs = 2_000,
  now = Date.now,
  sample,
  sleep = delay,
}) {
  const baseline = await sample();
  const deadline = now() + durationMs;
  for (let current = baseline; ;) {
    const failure = settleFailure(baseline, current);
    if (failure) {
      throw new Error(
        `Candidate failed during the ${Math.round(durationMs / 1000)} s settle window: ${failure}.`
      );
    }
    if (now() >= deadline) {
      return current;
    }
    await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
    current = await sample();
  }
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Record each command a tagged command-stream function runs, so a failure
 * names the command it came from.
 */
export function trackCommands(run, progress) {
  const wrap =
    (target) =>
    (first, ...rest) => {
      if (Array.isArray(first) && 'raw' in first) {
        progress.command = truncate(
          String.raw({ raw: first }, ...rest).replace(/\s+/gu, ' '),
          COMMAND_TEXT_LIMIT
        );
        return target(first, ...rest);
      }
      return wrap(target(first, ...rest));
    };
  return wrap(run);
}

function commandFailure(error) {
  for (let current = error; current; current = current.cause) {
    if (typeof current.stderr === 'string' && 'exitCode' in current) {
      return current;
    }
  }
  return undefined;
}

function lastLine(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
}

function tail(text) {
  const value = String(text || '');
  return redactTelegramValue(
    value.length > OUTPUT_LIMIT ? value.slice(-OUTPUT_LIMIT) : value
  );
}

/**
 * Reduce a deploy failure to one readable line plus a private log entry.
 * Command-stream errors carry the child process as `result`; only the exit
 * code and bounded output tails are kept.
 */
export function describeDeployFailure(error, progress = {}) {
  const message = String(error?.message ?? error).split('\n')[0];
  const failed = commandFailure(error);
  const reason = failed && lastLine(failed.stderr);
  const cause = redactTelegramValue(
    reason ? message.replace(failed.message, reason) : message
  );
  const step = progress.step || 'setup';
  return {
    detail: {
      at: new Date().toISOString(),
      command: progress.command,
      exitCode: failed?.exitCode,
      message: redactTelegramValue(String(error?.message ?? error)),
      stack: redactTelegramValue(String(error?.stack || '')),
      stderr: failed ? tail(failed.stderr) : undefined,
      stdout: failed ? tail(failed.stdout) : undefined,
      step,
    },
    summary: `Deploy failed during ${step}: ${cause}`,
  };
}

/** Append one JSON line to the private deploy log. */
export async function appendDeployLog(path, entry) {
  await appendFile(path, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}
