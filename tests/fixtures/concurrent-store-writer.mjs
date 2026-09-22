import { LinksStore } from '../../src/links-store.js';

const [directory, id] = process.argv.slice(2);
await new LinksStore({ binaryMirror: false, directory }).saveOffers([
  {
    collectedAt: new Date().toISOString(),
    id,
    photos: [],
    price: null,
    priceVnd: null,
    raw: {},
    sourceId: id,
    title: id,
  },
]);
