// Fetches recent posts from the public t.me/s/ previews of the default Telegram
// sources into a local directory outside the repository, as raw material for
// the reviewed field-level corpus. The output holds live text; anonymize it
// (experiments/issue-97-build-corpus.mjs) before anything is committed.
// Usage: node experiments/issue-97-fetch-public-previews.mjs /tmp/tg-previews
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  DEFAULT_TELEGRAM_SOURCES,
} from '../src/index.js';
import { previewText } from './telegram-preview-text.mjs';

const directory = process.argv[2] || '/tmp/tg-previews';
const pages = Number(process.env.PAGES || 2);
await mkdir(directory, { recursive: true });

function posts(html) {
  const result = [];
  for (const block of html
    .split('<div class="tgme_widget_message_wrap')
    .slice(1)) {
    const id = block.match(/data-post="([^"]+)"/u)?.[1];
    const text = block.match(
      /<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/u
    )?.[1];
    const date = block.match(/<time datetime="([^"]+)"/u)?.[1];
    if (id && text) {
      result.push({ date, id, text: previewText(text) });
    }
  }
  return result;
}

const sources = [
  ...DEFAULT_TELEGRAM_SOURCES,
  ...DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
];
const summary = [];
for (const source of sources) {
  const username = source.searchUrl?.split('/s/')[1] || source.id.split(':')[1];
  const collected = [];
  let before;
  for (let page = 0; page < pages; page += 1) {
    const url = `https://t.me/s/${username}${before ? `?before=${before}` : ''}`;
    try {
      const response = await fetch(url, {
        headers: { 'user-agent': 'Mozilla/5.0 (research; corpus review)' },
      });
      const found = posts(await response.text());
      if (!found.length) {
        break;
      }
      collected.unshift(...found);
      before = Number(found[0].id.split('/')[1]);
    } catch (error) {
      summary.push({ error: error.message, username });
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  await writeFile(
    join(directory, `${username}.json`),
    JSON.stringify(
      {
        focus: source.focus || source.geographicFocus,
        posts: collected,
        sourceId: source.id,
      },
      null,
      2
    )
  );
  summary.push({ posts: collected.length, username });
  console.log(username, collected.length);
}
await writeFile(
  join(directory, 'summary.json'),
  JSON.stringify(summary, null, 2)
);
