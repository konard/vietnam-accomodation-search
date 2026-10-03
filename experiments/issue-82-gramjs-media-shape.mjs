#!/usr/bin/env node
// Builds real teleproto (GramJS) media objects and prints the identity the
// pipeline derives from them. No network or Telegram account is used.
import { Api } from 'teleproto';
import bigInt from 'big-integer';

import { assembleTelegramAlbums } from '../src/telegram-pipeline.js';

const photo = new Api.Photo({
  id: bigInt('5431234567890123456'),
  accessHash: bigInt('-123456789'),
  fileReference: Buffer.alloc(32, 7),
  date: 1_790_000_000,
  sizes: [
    new Api.PhotoStrippedSize({ type: 'i', bytes: Buffer.alloc(900, 1) }),
    new Api.PhotoSize({ type: 'm', w: 320, h: 240, size: 12_000 }),
  ],
  dcId: 5,
});
const document = new Api.Document({
  id: bigInt('6431234567890123456'),
  accessHash: bigInt('42'),
  fileReference: Buffer.alloc(16, 3),
  date: 1_790_000_000,
  mimeType: 'video/mp4',
  size: bigInt(1000),
  dcId: 5,
  attributes: [],
});
const messages = [
  {
    chatId: 1,
    groupedId: 'g',
    id: 1,
    text: 'Studio for rent',
    media: new Api.MessageMediaPhoto({ photo }),
  },
  {
    chatId: 1,
    groupedId: 'g',
    id: 2,
    media: new Api.MessageMediaPhoto({ photo }),
  },
  {
    chatId: 1,
    groupedId: 'g',
    id: 3,
    media: new Api.MessageMediaDocument({ document }),
  },
];
console.log(
  'photo.id type:',
  typeof photo.id,
  photo.id?.constructor?.name,
  String(photo.id)
);
console.log('media.id:', messages[0].media.id);
const [album] = assembleTelegramAlbums(messages);
console.log(
  'mediaIds:',
  album.mediaIds.map((value) =>
    typeof value === 'object' ? `object:${value.className}` : value
  )
);
console.log(
  'JSON bytes of mediaIds:',
  Buffer.byteLength(JSON.stringify(album.mediaIds))
);
