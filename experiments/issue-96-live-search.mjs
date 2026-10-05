// Runs one cold-cache product search through createApplication() and prints
// the per-source outcome report, the elapsed time, and a sample of offers.
// Usage: DATA_DIRECTORY=$(mktemp -d) node experiments/issue-96-live-search.mjs "Nha Trang apartment for rent"
import { createApplication } from '../src/index.js';

const query = process.argv[2] || 'Nha Trang apartment for rent';
const application = createApplication({ environment: process.env });
const started = Date.now();
const { offers, report } = await application.service.searchWithReport({
  query,
  refresh: true,
});
console.log(
  JSON.stringify(
    {
      elapsedMs: Date.now() - started,
      offers: offers.length,
      outcomes: report.outcomes.map(
        ({ category, message, offers: count, sourceId, status }) => ({
          category,
          message: message?.slice(0, 160),
          offers: count,
          sourceId,
          status,
        })
      ),
      sample: offers.slice(0, 15).map((offer) => ({
        location: offer.location,
        period: offer.period,
        priceVnd: offer.priceVnd,
        sourceId: offer.sourceId,
        title: offer.title?.slice(0, 100),
        url: offer.url,
      })),
      summary: report.summary,
    },
    null,
    2
  )
);
process.exit(0);
