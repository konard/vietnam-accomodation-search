// Opens CONCURRENCY pages in one browser launched the way the application
// launches it and loads heavy booking pages on each, to see whether Chromium
// renderers crash with the host's /dev/shm. EXTRA_ARGS adds switches, for
// example EXTRA_ARGS=--disable-dev-shm-usage.
import { launchBrowser } from 'browser-commander';

const urls = [
  'https://www.booking.com/searchresults.html?ss=Nha+Trang',
  'https://www.agoda.com/search?city=2679',
  'https://www.airbnb.com/s/Nha-Trang/homes',
  'https://www.tripadvisor.com/Hotels-g293928-Nha_Trang-Hotels.html',
  'https://t.me/s/rentnhatrang',
  'https://www.traveloka.com/en-vn/hotel/vietnam/city/nha-trang-10010171',
];
const extra = (process.env.EXTRA_ARGS || '').split(' ').filter(Boolean);
const { browser, page } = await launchBrowser({
  args: ['--no-sandbox', '--disable-setuid-sandbox', ...extra],
  engine: 'playwright',
  headless: true,
});
const pages = [page];
for (let index = 1; index < Number(process.env.CONCURRENCY || 4); index += 1) {
  pages.push(await browser.newPage());
}
let crashes = 0;
for (const [index, current] of pages.entries()) {
  current.on('crash', () => {
    crashes += 1;
    console.log(`page ${index} crashed`);
  });
}
await Promise.all(
  pages.map(async (current, index) => {
    for (let step = index; step < urls.length * 2; step += pages.length) {
      const url = urls[step % urls.length];
      const started = Date.now();
      try {
        await current.goto(url, { timeout: 30000, waitUntil: 'load' });
        const length = await current.evaluate(
          () => globalThis.document.body.innerText.length
        );
        console.log(`${Date.now() - started} ms ok ${length} ${url}`);
      } catch (error) {
        console.log(
          `${Date.now() - started} ms ${error.message.split('\n')[0]} ${url}`
        );
      }
    }
  })
);
console.log(`crashes=${crashes}`);
await browser.close();
process.exit(0);
