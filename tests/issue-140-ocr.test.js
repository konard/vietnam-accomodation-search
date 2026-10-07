import { describe, it, expect } from 'test-anywhere';
import { EventEmitter } from 'node:events';
import {
  recognizeRentalPhoto,
  createTelegramOcr,
} from '../src/telegram-ocr.js';
import { LinkCliMirror } from '../src/link-cli-mirror.js';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const bytes = new Uint8Array([1, 2]);
async function failure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected failure');
}
function fakeProcess({
  output = 'For rent: studio 13M VND/month',
  exit = 0,
  hang = false,
  error,
} = {}) {
  const calls = [];
  const spawn = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdin = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    let closed = false;
    child.kill = () => {
      if (!closed) {
        closed = true;
        setTimeout(() => child.emit('close', null), 0);
      }
      return true;
    };
    child.stdin.end = () =>
      setTimeout(() => {
        if (closed) {
          return;
        }
        child.stderr.emit('data', Buffer.from('private diagnostic'));
        if (error) {
          closed = true;
          child.emit('error', error);
          return;
        }
        if (!hang) {
          child.stdout.emit('data', Buffer.from(output));
          if (!closed) {
            closed = true;
            child.emit('close', exit);
          }
        }
      }, 0);
    return child;
  };
  return { calls, spawn };
}
describe('bounded production photo OCR', () => {
  it('uses sparse-text page segmentation and returns provenance or unreadable state', async () => {
    const fake = fakeProcess();
    const result = await recognizeRentalPhoto(bytes, {
      spawnProcess: fake.spawn,
    });
    expect(result.text).toContain('13M');
    expect(result.engine).toBe('tesseract');
    expect(fake.calls[0].args).toContain('11');
    expect(
      (
        await recognizeRentalPhoto(bytes, {
          spawnProcess: fakeProcess({ output: '' }).spawn,
        })
      ).status
    ).toBe('unreadable');
  });
  it('rejects empty/oversized input, excess output, command errors and failed processes', async () => {
    expect(
      (await failure(() => recognizeRentalPhoto(new Uint8Array()))).code
    ).toBe('OCR_INPUT_BUDGET');
    expect(
      (await failure(() => recognizeRentalPhoto(bytes, { maxBytes: 1 }))).code
    ).toBe('OCR_INPUT_BUDGET');
    expect(
      (
        await failure(() =>
          recognizeRentalPhoto(bytes, {
            maxOutputBytes: 1,
            spawnProcess: fakeProcess().spawn,
          })
        )
      ).code
    ).toBe('OCR_OUTPUT_BUDGET');
    expect(
      (
        await failure(() =>
          recognizeRentalPhoto(bytes, {
            spawnProcess: fakeProcess({ exit: 1 }).spawn,
          })
        )
      ).code
    ).toBe('OCR_PROCESS_FAILED');
    expect(
      (
        await failure(() =>
          recognizeRentalPhoto(bytes, {
            spawnProcess: fakeProcess({
              error: Object.assign(new Error('missing'), { code: 'ENOENT' }),
            }).spawn,
          })
        )
      ).code
    ).toBe('ENOENT');
  });
  it('kills hanging and cancelled subprocesses and cleans up deadlines', async () => {
    expect(
      (
        await failure(() =>
          recognizeRentalPhoto(bytes, {
            timeoutMs: 5,
            spawnProcess: fakeProcess({ hang: true }).spawn,
          })
        )
      ).code
    ).toBe('OCR_TIMEOUT');
    const before = new AbortController();
    before.abort();
    expect(
      (
        await failure(() =>
          recognizeRentalPhoto(bytes, {
            signal: before.signal,
            spawnProcess: fakeProcess().spawn,
          })
        )
      ).code
    ).toBe('OCR_ABORTED');
    const during = new AbortController();
    setTimeout(() => during.abort(), 2);
    expect(
      (
        await failure(() =>
          recognizeRentalPhoto(bytes, {
            signal: during.signal,
            spawnProcess: fakeProcess({ hang: true }).spawn,
          })
        )
      ).code
    ).toBe('OCR_ABORTED');
  });
  it('propagates photo download cancellation and uses a bounded adapter', async () => {
    const fake = fakeProcess();
    const ocr = createTelegramOcr(
      { photo: async () => bytes },
      { spawnProcess: fake.spawn }
    );
    expect((await ocr('fixture', { material: {} })).status).toBe('extracted');
    const controller = new AbortController();
    controller.abort();
    const cancelled = createTelegramOcr(
      {
        photo: async (_id, { signal }) => {
          expect(signal.aborted).toBe(true);
          return bytes;
        },
      },
      { spawnProcess: fakeProcess().spawn }
    );
    expect(
      (await failure(() => cancelled('fixture', { signal: controller.signal })))
        .code
    ).toBe('OCR_ABORTED');
    const bounded = createTelegramOcr(
      {
        photo: async (_id, { signal }) =>
          new Promise((resolve, reject) =>
            signal.addEventListener('abort', () =>
              reject(new Error('download aborted'))
            )
          ),
      },
      { timeoutMs: 5 }
    );
    expect((await failure(() => bounded('fixture'))).code).toBe('OCR_TIMEOUT');
    const stalled = createTelegramOcr(
      { photo: () => new Promise(() => {}) },
      { timeoutMs: 5 }
    );
    expect((await failure(() => stalled('fixture'))).code).toBe('OCR_TIMEOUT');
  });
});
describe('clink capability preflight', () => {
  it('rejects a help-success executable that cannot import and export', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const calls = [];
    const mirror = new LinkCliMirror({
      run: async (_command, args) => {
        calls.push(args);
      },
    });
    expect((await failure(() => mirror.preflight())).code).toBe(
      'CLINK_INCOMPATIBLE'
    );
    expect(calls[1]).toContain('--import');
    expect(calls[1]).toContain('--export');
  });
  it('verifies a capable executable in an isolated directory', async () => {
    if (typeof globalThis.Deno !== 'undefined') {
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'clink-override-test-'));
    try {
      const mirror = new LinkCliMirror({
        command: 'fixture-clink',
        run: async (_command, args) => {
          if (args[0] === '--help') {
            return;
          }
          const input = args[args.indexOf('--import') + 1];
          const output = args[args.indexOf('--export') + 1];
          expect(input.startsWith(directory)).toBe(false);
          await writeFile(args[args.indexOf('--db') + 1], 'fixture');
          await writeFile(output, await readFile(input));
        },
      });
      await mirror.preflight();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it('downloads native photo references with byte and cancellation budgets', async () => {
  const { MtcuteTelegramProvider } = await import('../src/index.js');
  let media = { type: 'photo', fileSize: 2 };
  const calls = [];
  const client = {
    start: async () => {},
    getMe: async () => ({ id: 1 }),
    getMessages: async (peer, id) => {
      calls.push({ peer, id });
      return [{ media }];
    },
    downloadAsBuffer: async (_media, options) => {
      calls.push(options);
      return bytes;
    },
    destroy: async () => {},
  };
  const provider = new MtcuteTelegramProvider({
    apiId: 1,
    apiHash: 'fixture',
    session: 'fixture',
    clientFactory: async () => client,
  });
  const material = {
    members: [{ id: 2, sourceId: 'telegram:fixture', media: { id: 'photo' } }],
  };
  const controller = new AbortController();
  expect(
    await provider.photo('photo', {
      material,
      signal: controller.signal,
      maxBytes: 8,
    })
  ).toEqual(bytes);
  expect(calls[0]).toEqual({ peer: '@fixture', id: 2 });
  expect(calls[1].limit).toBe(9);
  expect(
    (await failure(() => provider.photo('absent', { material }))).code
  ).toBe('OCR_MEDIA_UNAVAILABLE');
  media = { type: 'document' };
  expect(
    (await failure(() => provider.photo('photo', { material }))).code
  ).toBe('OCR_MEDIA_UNSUPPORTED');
  media = { type: 'photo', fileSize: 20 };
  expect(
    (await failure(() => provider.photo('photo', { material, maxBytes: 8 })))
      .code
  ).toBe('OCR_INPUT_BUDGET');
  await provider.destroy();
});
