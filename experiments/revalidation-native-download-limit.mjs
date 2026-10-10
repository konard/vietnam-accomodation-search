// Installed SDK download implementation, fictitious Photo and no network.
// Isolates the later OCR download contract from media normalization (#158).
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { Photo } from '@mtcute/core';
import { MtcuteTelegramProvider } from '../src/index.js';

const { downloadAsBuffer } = await import(
  new URL(
    './highlevel/methods/files/download-buffer.js',
    import.meta.resolve('@mtcute/core')
  )
);
const photo = new Photo({
  _: 'photo',
  id: 42n,
  accessHash: 1n,
  fileReference: new Uint8Array([1]),
  dcId: 2,
  date: 1,
  sizes: [{ _: 'photoSize', type: 'x', w: 800, h: 600, size: 100 }],
});
const { downloadAsIterable } = await import(
  new URL(
    './highlevel/methods/files/download-iterable.js',
    import.meta.resolve('@mtcute/core')
  )
);
let rpcCalls = 0;
const sdkClient = {
  getPrimaryDcId: () => Promise.resolve(2),
  getPoolSize: () => Promise.resolve(1),
  log: { debug() {} },
  call: () => {
    rpcCalls++;
    return Promise.resolve({ _: 'upload.file', bytes: new Uint8Array(100) });
  },
};
const control = await downloadAsBuffer(sdkClient, photo);
assert.equal(control.length, 100);
assert.equal(rpcCalls, 1);
const client = {
  start: () => Promise.resolve(),
  getMe: () => Promise.resolve({ id: 99 }),
  getMessages: () => Promise.resolve([{ media: photo }]),
  downloadAsBuffer: (location, options) =>
    downloadAsBuffer(sdkClient, location, options),
  downloadAsIterable: (location, options) =>
    downloadAsIterable(sdkClient, location, options),
  destroy: () => Promise.resolve(),
};
const provider = new MtcuteTelegramProvider({
  apiId: 12,
  apiHash: 'qa-fixture',
  session: 'qa-fixture',
  clientFactory: () => Promise.resolve(client),
});
const result = { pass: false, supportedDownloadControlBytes: control.length };
try {
  await provider.photo('42', {
    material: {
      members: [
        { id: 1, sourceId: 'telegram:qa_fixture', media: { id: '42' } },
      ],
    },
  });
  result.pass = true;
} catch (error) {
  result.error = { type: error.constructor.name, message: error.message };
} finally {
  await provider.destroy();
}
result.providerReachedRpc = rpcCalls > 1;
console.log(JSON.stringify(result));
assert(
  result.pass,
  'Default photo download must not reject its own byte-budget option before network access.'
);
