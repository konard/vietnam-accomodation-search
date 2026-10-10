// Run mounted at /app/issue-163-docker-smoke.mjs in the final production image.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodePlatform, SqliteStorage } from '@mtcute/node';
import { LogManager } from '@mtcute/core/utils.js';
import { launchBrowser } from 'browser-commander';
import { createMtcuteClient } from './src/telegram-user.js';
import { recognizeRentalPhoto } from './src/telegram-ocr.js';
import { LinksStore } from './src/links-store.js';
import { launchSettings } from './src/utils.js';

assert.notEqual(process.getuid(), 0);
assert.equal(process.env.BROWSER_NO_SANDBOX, '1');
const platform = new NodePlatform();
const storage = new SqliteStorage(':memory:');
storage.driver.setup(new LogManager('owned-image-smoke', platform), platform);
try {
  await storage.driver.load();
  const bytes = new Uint8Array([1, 2, 255]);
  storage.kv.set('owned-image-smoke', bytes);
  await storage.driver.save();
  assert.equal(
    String(new Uint8Array(storage.kv.get('owned-image-smoke'))),
    String(bytes)
  );
} finally {
  await storage.driver.destroy();
}
const client = await createMtcuteClient({ apiId: 1, apiHash: '0'.repeat(32) });
await client.destroy();
const directory = await mkdtemp(join(tmpdir(), 'owned-image-smoke-'));
let browser;
try {
  const launched = await launchBrowser(
    launchSettings({ args: ['--no-sandbox'] })
  );
  browser = launched.browser;
  await launched.page.setContent(
    '<body style="font:48px sans-serif;background:white;color:black;padding:50px">STUDIO FOR RENT<br>NHA TRANG<br>13 MILLION VND / MONTH</body>'
  );
  const photo = await launched.page.screenshot();
  const result = await recognizeRentalPhoto(photo);
  assert.match(result.text, /STUDIO FOR RENT/);
  const store = new LinksStore({ directory, binaryMirror: true });
  await store.saveRecords('offers', [
    { id: 'owned-image-smoke', photoIdentity: '42' },
  ]);
  const fresh = new LinksStore({ directory, binaryMirror: true });
  assert.equal((await fresh.loadRecords('offers'))[0].photoIdentity, '42');
  console.log(
    JSON.stringify({
      nonRoot: true,
      sqlite: true,
      provider: true,
      browser: true,
      actualTesseract: true,
      freshClink: true,
    })
  );
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
