// Builds experiments/fixtures/reviewed-live-corpus.json from live public
// Telegram previews and Vietnamese web listing cards.
//
//   node experiments/issue-97-fetch-public-previews.mjs   # → /tmp/tg-previews
//   node experiments/issue-97-collect-vi-cards.mjs /tmp/vi-cards.json
//   node experiments/issue-97-build-corpus.mjs /tmp/tg-previews /tmp/vi-cards.json
//
// Contacts, links, handles, and names are replaced before anything is
// written. Expected values start from the parser's output and are then
// replaced by the reviewed values in fixtures/reviewed-live-corpus-review.json,
// so every disagreement with the parser is recorded there.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { FIELDS, predictCase } from './field-corpus-metrics.mjs';

const [
  previewDirectory = '/tmp/tg-previews',
  cardsFile = '/tmp/vi-cards.json',
] = process.argv.slice(2);
const fixtures = new globalThis.URL('./fixtures/', import.meta.url);
const RATES = { EUR: 30_000, RUB: 300, USD: 26_000, VND: 1 };
const WEB_POSTED_AT = '2026-10-05T00:00:00.000Z';

const ENTITIES = { '&amp;': '&', '&gt;': '>', '&lt;': '<', '&quot;': '"' };

// Web cards carry the poster in labelled fields; every other occurrence of
// those values is removed as well.
function cardPeople(value) {
  return [...String(value).matchAll(/^(?:author|contact):\s*(.+)$/gimu)]
    .map(([, name]) => name.trim())
    .filter((name) => name.length > 2 && !name.startsWith('['));
}

export function anonymize(value) {
  let text = String(value)
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&(?:amp|gt|lt|quot);/gu, (entity) => ENTITIES[entity]);
  for (const name of cardPeople(text)) {
    text = text.split(name).join('[NAME]');
  }
  return (
    text
      .replace(/https?:\/\/\S+|(?:www\.|t\.me\/)\S+/giu, '[URL]')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/gu, '[EMAIL]')
      .replace(/@[A-Za-z]\w{3,}/gu, '[TELEGRAM_HANDLE]')
      .replace(/((?:line|微信|wechat)\s*[:：]\s*)[\w.-]{3,}/giu, '$1[CONTACT]')
      .replace(
        /(?<![\d.,])(?:\+|00)\d{1,3}(?:[\s.\-()]*\d){7,12}(?![\d.,])/gu,
        '[PHONE]'
      )
      .replace(/(?<![\d.,])0\d{2,3}(?:[\s.-]*\d){6,8}(?![\d.,])/gu, '[PHONE]')
      .replace(
        /((?<!\p{L})(?:liên\s*hệ|lh|zalo|whatsapp|viber|контакт\p{L}*|пишите|звоните|contact|author|người\s*đăng)\s*[:：]?\s*)(?!\[)[^\n\d[]{2,40}/giu,
        '$1[CONTACT]'
      )
      .replace(/[一-鿿]姐/gu, '[NAME]')
      // A name next to a phone or messenger contact: "[PHONE] Дмитрий.",
      // "1️⃣ Cẩm — Zalo", or a name alone on the line above the contact.
      .replace(
        /((?:\[PHONE\]|📞)[ \t]*(?:[—–|-][ \t]*)?)\p{Lu}\p{Ll}+/gu,
        '$1[NAME]'
      )
      .replace(/(\[PHONE\][ \t]*\n)\p{Lu}\p{Ll}+[ \t]*$/gmu, '$1[NAME]')
      .replace(/\p{Lu}\p{Ll}+(?=[ \t]*[|—–-][ \t]*\[PHONE\])/gu, '[NAME]')
      .replace(/(©[^\n]*?\.[ \t]*)\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+/gu, '$1[NAME]')
      .replace(
        /\p{Lu}\p{Ll}+(?=[ \t]*[—–-][ \t]*(?:Zalo|WhatsApp|Telegram))/gu,
        '[NAME]'
      )
      .replace(
        /^\p{Lu}\p{Ll}+(?: \p{Lu}\p{Ll}+)?[ \t.]*$(?=\n[^\n]*(?:\[PHONE\]|\[CONTACT\]|📞))/gmu,
        '[NAME]'
      )
  );
}

function language(text) {
  const count = (pattern) => (text.match(pattern) || []).length;
  const cjk = count(/[一-鿿]/gu);
  const cyrillic = count(/[а-яё]/giu);
  const vietnamese = count(
    /[ăâđêôơưạảãáàặẳẵắằậẩẫấầẹẻẽéèệểễếềịỉĩíìọỏõóòộổỗốồợởỡớờụủũúùựửữứừỵỷỹýỳ]/giu
  );
  if (cjk > 20) {
    return 'zh';
  }
  if (cyrillic > 20 && cyrillic > vietnamese) {
    return 'ru';
  }
  if (vietnamese > 5) {
    return 'vi';
  }
  return 'en';
}

async function telegramMessages() {
  const messages = [];
  for (const file of (await readdir(previewDirectory)).sort()) {
    if (!file.endsWith('.json') || file === 'summary.json') {
      continue;
    }
    const preview = JSON.parse(
      await readFile(join(previewDirectory, file), 'utf8')
    );
    for (const post of preview.posts || []) {
      messages.push({
        focus: preview.focus,
        postedAt: new Date(post.date).toISOString(),
        sourceId: preview.sourceId,
        sourceType: 'telegram',
        text: post.text,
      });
    }
  }
  return messages;
}

async function webMessages() {
  const cards = JSON.parse(await readFile(cardsFile, 'utf8'));
  return cards.map((card) => ({
    focus: 'nha-trang',
    postedAt: WEB_POSTED_AT,
    sourceId: card.sourceId,
    sourceType: 'web',
    text: card.text,
  }));
}

async function readReview() {
  try {
    return JSON.parse(
      await readFile(
        new globalThis.URL('reviewed-live-corpus-review.json', fixtures),
        'utf8'
      )
    );
  } catch {
    return { reviews: {} };
  }
}

const seen = new Set();
const cases = [];
const review = await readReview();
for (const input of [...(await telegramMessages()), ...(await webMessages())]) {
  const text = anonymize(input.text).trim();
  const key = `${input.sourceId}\n${text}`;
  if (!text || seen.has(key)) {
    continue;
  }
  seen.add(key);
  const index =
    cases.filter(({ input: other }) => other.sourceId === input.sourceId)
      .length + 1;
  const id = `${input.sourceId.replace(/^telegram:/u, 'tg-')}-${String(index).padStart(3, '0')}`;
  const testCase = { id, language: language(text), input: { ...input, text } };
  const predicted = await predictCase(testCase, { rates: RATES });
  const reviewed = review.reviews[id] || {};
  const expected = Object.fromEntries(
    FIELDS.map((field) => [
      field,
      field in reviewed ? reviewed[field] : predicted[field],
    ])
  );
  cases.push({ ...testCase, expected: JSON.parse(JSON.stringify(expected)) });
}

const corpus = {
  schemaVersion: 1,
  collectedAt: WEB_POSTED_AT.slice(0, 10),
  dataPolicy: 'anonymized-live-sample',
  rates: RATES,
  reviewedFields: FIELDS,
  cases,
};
await writeFile(
  new globalThis.URL('reviewed-live-corpus.json', fixtures),
  `${JSON.stringify(corpus, null, 2)}\n`
);
console.error(
  `${cases.length} cases, ${new Set(cases.map(({ input }) => input.sourceId)).size} sources, languages ${JSON.stringify(
    cases.reduce(
      (all, { language: name }) => ({ ...all, [name]: (all[name] || 0) + 1 }),
      {}
    )
  )}`
);
