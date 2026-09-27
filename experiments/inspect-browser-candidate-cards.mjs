// Inspect private Browser Commander checkpoints without printing listing text or URLs.
// Usage: node experiments/inspect-browser-candidate-cards.mjs checkpoint.html card-selector
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const [filename, selector] = process.argv.slice(2);
if (!filename || !selector) {
  throw new Error(
    'Usage: inspect-browser-candidate-cards.mjs checkpoint.html card-selector'
  );
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setContent(await readFile(filename, 'utf8'));
  const result = await page.evaluate((cardSelector) => {
    const cards = [...globalThis.document.querySelectorAll(cardSelector)];
    return {
      cardCount: cards.length,
      availabilityHintCards: cards.filter((card) =>
        /trống|đã\s*hết|hết\s*phòng|available|rented\s*out|đã\s*thuê/iu.test(
          card.innerText
        )
      ).length,
      availabilityNodes: cards
        .flatMap((card) =>
          [...card.querySelectorAll('*')].filter((element) =>
            [...element.childNodes].some(
              (node) =>
                node.nodeType === 3 &&
                /trống|đã\s*hết|hết\s*phòng|available|rented\s*out|đã\s*thuê/iu.test(
                  node.textContent || ''
                )
            )
          )
        )
        .slice(0, 10)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          classes: [...element.classList].slice(0, 8),
          parentClasses: [...(element.parentElement?.classList || [])].slice(
            0,
            8
          ),
        })),
      roomHintCards: cards.filter((card) =>
        /\b(?:\d+\s*(?:pn|phòng ngủ|bedrooms?|beds?|спальн|комнат)|studio)\b/iu.test(
          card.innerText
        )
      ).length,
      pricePeriodCards: cards.filter((card) =>
        /\/\s*(?:mo|month)|per\s+month|monthly|tháng|месяц|мес\.?/iu.test(
          card.innerText
        )
      ).length,
      hasGlobalContact: Boolean(
        globalThis.document.querySelector('a[href^="tel:"], a[href^="mailto:"]')
      ),
      linkedCards: cards.filter(
        (card) => card.matches('a[href]') || card.querySelector('a[href]')
      ).length,
      imageCards: cards.filter((card) => card.querySelector('img[src]')).length,
      identifiedCards: cards.filter(
        (card) => card.id || card.getAttribute('data-id')
      ).length,
      cards: cards.slice(0, 2).map((card) => ({
        tag: card.tagName.toLowerCase(),
        classes: [...card.classList],
        textLeaves: [...card.querySelectorAll('*')]
          .filter((element) =>
            [...element.childNodes].some(
              (node) => node.nodeType === 3 && node.textContent?.trim()
            )
          )
          .slice(0, 30)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            classes: [...element.classList].slice(0, 8),
          })),
        descendants: [...card.querySelectorAll('*')]
          .filter((element) => element.classList.length > 0)
          .slice(0, 35)
          .map((element) => ({
            tag: element.tagName.toLowerCase(),
            classes: [...element.classList],
            hasText: Boolean(element.textContent?.trim()),
            hasLink: Boolean(element.getAttribute('href')),
          })),
      })),
    };
  }, selector);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await browser.close();
}
