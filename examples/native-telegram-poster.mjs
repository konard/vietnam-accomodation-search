// Self-authored offline transport control. Requires Chromium, Tesseract and clink.
// No Telegram credentials, public messages or remote Bot API calls are used.
/* eslint-disable require-await -- Async SDK fixtures preserve the installed client's promise contract. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { chromium } from 'playwright';
import { Photo } from '@mtcute/core';
import { Api } from 'grammy';
import {
  LinksStore,
  MediaCache,
  MtcuteTelegramProvider,
  TelegramIngestionService,
  deliverSubscriptionOffers,
} from '../src/index.js';
import { createTelegramOcr } from '../src/telegram-ocr.js';
import { LinkCliMirror, runClink } from '../src/link-cli-mirror.js';

const directory = await mkdtemp(join(tmpdir(), 'native-poster-example-'));
const browser = await chromium.launch();
let service;
let server;
let clinkCalls = 0;
const started = performance.now();
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 500 },
  });
  await page.setContent(
    '<style>body{font:40px Arial;padding:40px;color:black;background:white}p{margin:20px}</style><p>STUDIO FOR RENT IN NHA TRANG</p><p>13 million VND / month</p><p>1 bedroom. Available now.</p>'
  );
  const bytes = await page.screenshot();
  const photo = new Photo({
    _: 'photo',
    id: 42n,
    accessHash: 1n,
    fileReference: new Uint8Array([1]),
    dcId: 2,
    date: 1,
    sizes: [{ _: 'photoSize', type: 'x', w: 1000, h: 500, size: bytes.length }],
  });
  const { downloadAsIterable } = await import(
    new globalThis.URL(
      './highlevel/methods/files/download-iterable.js',
      import.meta.resolve('@mtcute/core')
    )
  );
  const sdk = {
    getPrimaryDcId: async () => 2,
    getPoolSize: async () => 1,
    log: { debug() {} },
    call: async ({ offset, limit }) => ({
      _: 'upload.file',
      bytes: bytes.subarray(Number(offset), Number(offset) + limit),
    }),
  };
  const emitter = () => ({ add() {}, remove() {} });
  const client = {
    start: async () => {},
    getMe: async () => ({ id: 99 }),
    resolvePeer: async () => ({ _: 'inputPeerUser', userId: 99 }),
    async *iterHistory() {
      yield {
        id: 1,
        date: new Date(),
        chat: { id: 99, username: 'qa_fixture' },
        media: photo,
        text: '',
      };
    },
    getMessages: async () => [{ media: photo }],
    downloadAsIterable: (location, options) =>
      downloadAsIterable(sdk, location, options),
    onNewMessage: emitter(),
    onEditMessage: emitter(),
    onDeleteMessage: emitter(),
    onMessageGroup: emitter(),
    destroy: async () => {},
  };
  const provider = new MtcuteTelegramProvider({
    apiId: 1,
    apiHash: 'fixture',
    session: 'fixture',
    clientFactory: async () => client,
  });
  const mirror = new LinkCliMirror({
    run: (...args) => {
      clinkCalls += 1;
      return runClink(...args);
    },
  });
  const store = new LinksStore({ directory, mirror });
  service = new TelegramIngestionService({
    provider,
    store,
    mediaCache: new MediaCache({ directory }),
    ocr: createTelegramOcr(provider),
  });
  await service.start([{ id: 'telegram:qa_fixture', focus: 'nha-trang' }]);
  const fresh = new LinksStore({ directory, binaryMirror: true });
  const offers = await fresh.listOffers();
  assert.equal(offers.length, 1);
  assert.deepEqual(offers[0].photos, [String(photo.id)]);
  assert.equal(offers[0].priceVnd, 13e6);
  assert.equal(offers[0].mediaStatus, 'cached');
  assert.equal(
    (await fresh.loadRecords('telegram-reviews'))[0].reason,
    'ocr-fields-unverified'
  );
  const requests = [];
  server = createServer(async (request, response) => {
    const parts = [];
    for await (const part of request) {
      parts.push(part);
    }
    const body = Buffer.concat(parts);
    requests.push({
      method: request.url.split('/').at(-1),
      multipart: String(request.headers['content-type']).includes(
        'multipart/form-data'
      ),
      bytesPresent: body.includes(bytes),
    });
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        ok: true,
        result: {
          message_id: requests.length,
          date: 0,
          chat: { id: 99, type: 'private' },
        },
      })
    );
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiRoot = `http://127.0.0.1:${server.address().port}`;
  await deliverSubscriptionOffers(
    new Api('123456:offline_fixture', { apiRoot }),
    99,
    offers,
    { store: fresh }
  );
  const child = await promisify(execFile)(
    process.execPath,
    [
      '--max-old-space-size=512',
      '--input-type=module',
      '-e',
      `
    import { Api } from 'grammy';
    import { LinksStore, deliverSubscriptionOffers } from './src/index.js';
    const store = new LinksStore({ directory: process.argv[1], binaryMirror: true });
    const offers = await store.listOffers();
    await deliverSubscriptionOffers(new Api('123456:offline_fixture', { apiRoot: process.argv[2] }), 99, offers, { store });
    console.log(JSON.stringify({ offers: offers.length, photoId: offers[0].photos[0] }));
  `,
      directory,
      apiRoot,
    ],
    { maxBuffer: 64 * 1024 }
  );
  assert.equal(JSON.parse(child.stdout).photoId, '42');
  assert.deepEqual(
    requests.map(({ method }) => method),
    ['sendMessage', 'sendPhoto']
  );
  assert(requests[1].multipart && requests[1].bytesPresent);
  console.log(
    JSON.stringify({
      mode: 'offline-local-multipart',
      installedSdk: true,
      actualTesseract: true,
      realClink: true,
      freshProcess: true,
      nativeIdentityPreserved: true,
      photoUploaded: true,
      restartDeduplicated: true,
      clinkCalls,
      durationMs: Math.round(performance.now() - started),
      liveTelegram: 'not-tested',
      ownedMessagesCreated: 0,
    })
  );
} finally {
  await service?.destroy();
  await browser.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve()));
  await rm(directory, { recursive: true, force: true });
}
