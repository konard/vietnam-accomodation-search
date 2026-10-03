// Aggregate-only diagnostics for protected manual audit runs. No file names,
// source IDs, credentials, material, or arbitrary error messages are emitted.
import { readdir, readFile, stat, statfs } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { performance } from 'node:perf_hooks';

export function timerWarning(warning) {
  if (warning.name !== 'TimeoutNegativeWarning') {
    return undefined;
  }
  return {
    type: 'negative-timer',
    delayMs: Number(warning.message.match(/-\d+(?:\.\d+)?/u)?.[0]),
    frames: String(warning.stack || '')
      .split('\n')
      .slice(1, 9)
      .flatMap((line) => {
        const match = line.match(/([\w./-]+\.(?:m?js|cjs|ts)):(\d+):(\d+)/u);
        return match ? [`${basename(match[1])}:${match[2]}:${match[3]}`] : [];
      }),
  };
}

export async function diskUsage(directory) {
  let logicalBytes = 0;
  let allocatedBytes = 0;
  let files = 0;
  const directories = [directory];
  while (directories.length) {
    let entries;
    const current = directories.pop();
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
      } else if (entry.isFile()) {
        try {
          const info = await stat(path);
          logicalBytes += info.size;
          allocatedBytes += info.blocks * 512;
          files += 1;
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }
    }
  }
  const filesystem = await statfs(directory);
  return {
    allocatedBytes,
    files,
    freeBytes: filesystem.bavail * filesystem.bsize,
    logicalBytes,
  };
}

async function treeRss(pid) {
  if (process.platform !== 'linux') {
    return process.memoryUsage().rss;
  }
  try {
    const status = await readFile(`/proc/${pid}/status`, 'utf8');
    const own = Number(status.match(/^VmRSS:\s+(\d+)/mu)?.[1] || 0) * 1024;
    const children = (
      await readFile(`/proc/${pid}/task/${pid}/children`, 'utf8')
    )
      .trim()
      .split(/\s+/u)
      .filter(Boolean);
    const rss = await Promise.all(children.map(treeRss));
    return own + rss.reduce((sum, bytes) => sum + bytes, 0);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') {
      return 0;
    }
    throw error;
  }
}

export function createAuditDiagnostics({
  directory,
  emit,
  minFreeBytes = 8 * 1024 ** 3,
  maxAllocatedBytes = 4 * 1024 ** 3,
}) {
  if (
    ![minFreeBytes, maxAllocatedBytes].every(
      (n) => Number.isSafeInteger(n) && n >= 0
    )
  ) {
    throw new TypeError(
      'Audit disk budgets must be non-negative safe integers.'
    );
  }
  const started = performance.now();
  let lastDiskAt = -Infinity;
  let disk;
  let peakAllocatedBytes = 0;
  let peakTreeRssBytes = 0;
  let pending = Promise.resolve();
  const sample = (event = { phase: 'audit', state: 'sample' }) => {
    const task = pending.then(async () => {
      const now = performance.now();
      // Serialize and throttle scans during parallel projection callbacks.
      if (!disk || now - lastDiskAt >= 5_000 || event.phase === 'source') {
        disk = await diskUsage(directory);
        lastDiskAt = now;
      }
      peakAllocatedBytes = Math.max(peakAllocatedBytes, disk.allocatedBytes);
      peakTreeRssBytes = Math.max(peakTreeRssBytes, await treeRss(process.pid));
      await emit({
        ...event,
        ...disk,
        elapsedMs: Math.round(now - started),
        sampledPeakAllocatedBytes: peakAllocatedBytes,
        sampledPeakTreeRssBytes: peakTreeRssBytes,
      });
      if (
        disk.freeBytes < minFreeBytes ||
        disk.allocatedBytes > maxAllocatedBytes
      ) {
        const error = new Error(
          'Protected audit disk budget exhausted; active storage pointers are retained.'
        );
        error.code = 'audit-disk-budget-exhausted';
        throw error;
      }
    });
    pending = task.catch(() => {});
    return task;
  };
  const measure = async (event, operation) => {
    await sample({ ...event, state: 'start' });
    const begin = performance.now();
    let state = 'failure';
    try {
      const result = await operation();
      state = 'success';
      return result;
    } finally {
      const completed = sample({
        ...event,
        durationMs: Math.round(performance.now() - begin),
        state,
      });
      // Retain the operation's error if recording its failure also fails.
      if (state === 'failure') {
        await completed.catch(() => {});
      } else {
        await completed;
      }
    }
  };
  return { measure, sample };
}
