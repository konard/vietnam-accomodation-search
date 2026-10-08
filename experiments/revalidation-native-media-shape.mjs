// Self-authored public fixture using the installed SDK's real Photo class.
// No credentials, channel messages or original media are needed.
import assert from 'node:assert/strict';
import { Photo } from '@mtcute/core';
import { normalizeMtcuteMessage } from '../src/telegram-mtcute.js';
import { reconcileTelegramMaterials } from '../src/telegram-pipeline.js';

const photo = new Photo({
  _: 'photo',
  id: 42n,
  accessHash: 1n,
  fileReference: new Uint8Array([1]),
  dcId: 2,
  date: 1,
  sizes: [{ _: 'photoSize', type: 'x', w: 800, h: 600, size: 100 }],
});
const message = normalizeMtcuteMessage(
  {
    id: 1,
    chat: { id: -1000000000001, username: 'qa_fixture' },
    date: new Date(),
    media: photo,
    text: '',
  },
  { id: 'telegram:qa_fixture' }
);
let calls = 0;
const options = {
  ocr: () => {
    calls += 1;
    return Promise.resolve({
      text: 'FOR RENT Studio in Nha Trang 13 million VND / month',
    });
  },
};
const control = await reconcileTelegramMaterials(
  [{ ...message, media: { ...message.media, id: String(photo.id) } }],
  options
);
assert.equal(calls, 1, 'The media-present OCR positive control must execute.');
assert.equal(
  control.accepted.length,
  1,
  'The OCR rental fixture must be eligible.'
);
calls = 0;
const reconciled = await reconcileTelegramMaterials([message], options);
const result = {
  mediaPresentControl: true,
  sdkPhotoIdentity: String(photo.id),
  normalizedIdentityPreserved: message.media?.id === String(photo.id),
  ocrCalls: calls,
  accepted: reconciled.accepted.length,
  pass:
    message.media?.id === String(photo.id) &&
    calls === 1 &&
    reconciled.accepted.length === 1,
};
console.log(JSON.stringify(result));
assert(
  result.pass,
  'Native Photo must retain its identity and enter captionless OCR.'
);
