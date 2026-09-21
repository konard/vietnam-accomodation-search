# Vietnam accommodation search

A Telegram bot and command-line search service that compares accommodation
offers from popular booking websites and public Telegram communities in
Vietnam. It drives real browser pages through
[browser-commander](https://www.npmjs.com/package/browser-commander),
normalizes multilingual listings, converts prices to VND, and persists the
source records in [Links Notation](https://www.npmjs.com/package/links-notation).

The repository name intentionally retains the original `accomodation`
spelling, so the executable and npm package are named
`vietnam-accomodation-search`.

## What it does

- Starts with the top 20 from 21 ranked web-service candidates and 21 public
  Telegram-community candidates.
- Refreshes both rankings with `/update_sources`, keeping the top 20 of each.
- Navigates each configured source's web UI rather than calling a private
  accommodation API.
- Collects only the latest two months of Telegram history.
- Parses English, Vietnamese, and Russian listing text with a permissive
  accommodation schema.
- Prefers a listing's explicit VND price; otherwise, it converts supported
  currencies using a daily exchange-rate snapshot.
- Returns one offer for `/search --cheapest` or up to 50 for
  `/search --cheapest N`.
- Keeps complete raw records in a `.lino` link store for future parsers.
- Caches at most ten photos per offer under a shared 10 GiB budget. Eviction
  removes only local files; the original photo URL stays in the offer record.

## Quick Start

Node.js 22 or newer is required.

```bash
npm install
npx playwright install chromium
cp .env.example .env
```

## Configuration

Export the bot token before starting the process. The CLI does not load `.env`
itself, so use your process manager or shell to provide it.

```bash
export TELEGRAM_BOT_TOKEN='replace-with-a-BotFather-token'
npm exec vietnam-accomodation-search -- bot
```

The default cache directory is `.vietnam-accomodation-search/` in the current
working directory. It contains `offers.lino`, `sources.lino`, and downloaded
media. Do not commit it.

Chromium sandboxing remains enabled by default. In a locked-down container
where unprivileged user namespaces are unavailable, set
`BROWSER_NO_SANDBOX=1` to pass the browser command-line fallback documented by
browser-commander. Use that setting only when the surrounding container is the
security boundary.

## Telegram commands

```text
/search Da Nang
/search --cheapest Da Nang
/search --cheapest 10 Nha Trang
/update_sources
```

The first search, an explicit refresh, or a stale/incomplete cache triggers a
browser pass over every configured source. Later searches use the cache for up
to six hours. One inaccessible source is logged and skipped without discarding
results from the other sources.

The same operations are available without Telegram:

```bash
node bin/vietnam-accomodation-search.js search --cheapest 10 "Da Nang"
node bin/vietnam-accomodation-search.js update-sources
```

## Source ranking and evidence

Every source record contains a popularity metric, numeric value, evidence URL,
and observation timestamp. Seed website ranks link to public traffic evidence;
seed Telegram ranks link to the public channel or group preview where its
audience is displayed.

`/update_sources` launches a browser and performs a current Google web search
for Vietnam accommodation services. Website candidates are reranked by their
result position. Telegram candidates discovered in the search UI are combined
with the seed set, then each public `t.me` preview is visited to read its
current member or subscriber count. Only the highest 20 records of each type
are saved.

Popularity changes constantly, so the bundled list is a bootstrap candidate
set rather than a permanent claim. The evidence attached to the persisted
source record is the authoritative snapshot for a particular deployment.

## Telegram access model

The application needs only a Telegram bot token. Public channel history is
read from Telegram's public web preview through browser-commander. Live group
and channel posts are also ingested when Telegram delivers them to the bot.

Telegram does not expose arbitrary private history to bots. To monitor a
private community, add the bot there and grant the permissions needed to
receive new posts; for groups, disable BotFather privacy mode if the bot must
see ordinary messages. Messages posted before the bot joined must be forwarded
or imported separately. These platform constraints are not bypassed.

## Data model and cache

Offers keep normalized links for identity, source, URL, and VND price alongside
a lossless base64url JSON payload containing the original record. This produces
portable Links Notation while preserving unknown fields for future parsing.
Writes use a temporary file and atomic rename.

The collector recognizes common property-card markup and public Telegram
message markup. Sites can change their DOM or present consent/CAPTCHA pages;
those sources are skipped for that pass. Deployments are responsible for
respecting each source's terms, robots policy, and rate limits.

## Library usage

```js
import { createApplication } from 'vietnam-accomodation-search';

const application = createApplication({
  directory: '/var/lib/vietnam-accommodation-search',
});

const offers = await application.service.search({
  cheapest: true,
  limit: 10,
  query: 'Da Nang',
});
```

Core services accept injected browser, storage, fetch, clock, and rate
dependencies for deterministic testing.

## Contributing

```bash
npm test
npm run check
bun test --timeout 30000
deno test --allow-read
```

The legacy universal calculator example remains as a pipeline fixture for web,
desktop, and mobile build validation. Its Auto-regenerated preview screenshots
can be refreshed with:

```bash
npm run example:web:preview-images
```

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for the complete validation and
release workflow.

## License

Released under the [Unlicense](LICENSE).
