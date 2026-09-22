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

- Starts with 20 ranked web services, 20 nationwide Telegram communities, and
  up to 40 additional Nha Trang-focused Telegram communities.
- Refreshes all three rankings with `/update_sources`, independently keeping
  20 web, 20 nationwide Telegram, and up to 40 Nha Trang Telegram sources while
  searching in English, Russian, and Vietnamese.
- Navigates each configured source's web UI rather than calling a private
  accommodation API.
- Paginates public Telegram previews through the latest two months of history.
- Parses English, Vietnamese, and Russian listing text into searchable fields
  such as bedrooms, bathrooms, area, floor, district, availability date,
  minimum stay, deposit, furnishing, pets, amenities, and owner contacts.
- Preserves every labeled field and the complete raw message, including fields
  not yet understood by the normalizer.
- Reconciles the same accommodation across official URLs, platform IDs, source
  property IDs, and conservative listing fingerprints while preserving every
  raw source variant.
- Follows explicitly discovered accommodation websites for direct price
  checks, persists per-source price history, and reports official-site price
  increases and drops without mislabeling marketplace prices as official.
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

For the production container path, fill the untracked `.env` and run:

```bash
docker compose up --build -d
docker compose ps
```

The health endpoint is bound to `127.0.0.1:8080` by default. State lives in
the `vietnam-accomodation-search-data` named volume and survives image
replacement. See [deployment and recovery](docs/deployment.md) for candidate
preflight, redeploy, rollback, logs, backup, restore, and Docker Hub setup.

## Configuration

Export the bot token before starting the process. The CLI does not load `.env`
itself, so use your process manager or shell to provide it.

```bash
export TELEGRAM_BOT_TOKEN='replace-with-a-BotFather-token'
npm exec vietnam-accomodation-search -- bot
```

Availability inquiries and private history use a Telegram user session. Create
one with `telegram auth login --session-file /run/secrets/telegram-session`;
choose an explicit `0600` session file, `--session-stdout` handoff, or an
injected `TELEGRAM_USER_SESSION_FILE`. No implicit session destination is
used. The session is equivalent to account access: never log, commit, or back
it up with ordinary application state. `telegram auth
status|validate|rotate|logout` manage its lifecycle. `telegram preflight`
validates configured numeric identities with `getMe` without starting
`getUpdates`.

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
/search --cheapest 10 --filter bedrooms=2 --filter petsAllowed=true Nha Trang
/search --filter labeledFields.электричество=счётчику Нячанг
/search --types studio,hotel --min-rooms 1 --max-total-vnd 15000000 Nha Trang
/search --max-per-room-vnd 8000000 --max-per-bed-vnd 5000000 Nha Trang
/preset list
/preset show [NAME]
/preset save NAME [SEARCH OPTIONS]
/preset use NAME
/preset delete NAME
/subscribe [NAME]
/unsubscribe
/subscription
/update_sources
/check_availability OFFER_ID [@owner]
```

The first search, an explicit refresh, or a stale/incomplete cache triggers a
browser pass over every configured source. Later searches use the cache for up
to six hours. One inaccessible source is logged and skipped without discarding
results from the other sources.

The built-in `default` preset is empty and cannot be deleted. A named preset is
global for that numeric Telegram user. Search arguments temporarily override
the active preset. Rooms are not bedrooms: room filters require an explicit
room count, and per-room/per-bed filters exclude records missing the respective
count. Studios are selected by type and do not imply one room. Prices retain
their quoted billing period; range filters compare the normalized quoted VND
amount without changing that period.

The same search operations are available without Telegram:

```bash
node bin/vietnam-accomodation-search.js search --cheapest 10 "Da Nang"
node bin/vietnam-accomodation-search.js update-sources
node bin/vietnam-accomodation-search.js check-availability OFFER_ID @owner
```

## Source ranking and evidence

Every source record contains a popularity metric, numeric value, evidence URL,
and observation timestamp. Seed website ranks link to public traffic evidence;
seed Telegram ranks link to the public channel or group preview where its
audience is displayed.

`/update_sources` launches a browser and performs current Google web searches
for Vietnam accommodation services plus multilingual Nha Trang Telegram
communities. Website candidates are reranked by their result position.
Telegram candidates discovered in the search UI are combined with their seed
cohort, then each public `t.me` preview is visited to read its current member or
subscriber count. The highest 20 web and nationwide Telegram records and up to
40 independently ranked Nha Trang Telegram records are saved.

Popularity changes constantly, so the bundled list is a bootstrap candidate
set rather than a permanent claim. The evidence attached to the persisted
source record is the authoritative snapshot for a particular deployment.

## Telegram access model

Search and public-preview ingestion need no user session. Public channel
history is read through browser-commander, following older-message links until
the two-month cutoff. A bot token adds Bot API commands and updates from chats
where the bot is present. An MTProto user session adds a two-month backfill and
continuous updates for configured sources the account can already access:

```bash
node bin/vietnam-accomodation-search.js telegram ingest
```

The service supports bot-only, MTProto user-only ingestion, and combined modes.
Combined routing is bot-first and falls back to MTProto only
for a classified capability rejection known to occur before a send. It never
falls back after an ambiguous timeout. Bot commands and subscription chat
delivery are unavailable in user-only mode because there is no Bot API command
surface. In combined mode, incomplete/foreign user-session configuration or an
MTProto startup/authentication failure is reported with redacted diagnostics
and the Bot API surface continues in bot-only mode. The ingest-only command
still fails closed because it has no Bot API work to perform.

Telegram does not expose arbitrary private history to bots. To monitor a
private community, add the bot there and grant the permissions needed to
receive new posts; for groups, disable BotFather privacy mode if the bot must
see ordinary messages. Messages posted before the bot joined must be forwarded
or imported separately. These platform constraints are not bypassed.

Searching never contacts an owner automatically. When a parsed post contains
an `@username`, it is used only after an explicit availability command. Private
mode is the default and requires numeric allowlists; public search/subscription
traffic is rate-limited while privileged actions still fail closed. See the
[Telegram operations guide](docs/telegram.md) for BotFather privacy mode,
permissions, capability degradation, rotation, revocation, and incident
response.

## Data model and cache

Every record field is represented as deterministic, typed, addressable
two-value links. Canonical human-readable `.lino` text is mirrored into an
immutable, verified `clink` file-mapped database snapshot; unknown/raw fields
round-trip through the same schema rather than an opaque JSON-only payload.
Writes use fsync, atomic rename, a process lock, and content-hash repair. See
the [associative storage guide](docs/storage.md) for schema, migration,
recovery, compaction, installation, and point-in-time backup details.

Merged offers retain all source IDs, identifiers, raw variants, contacts,
attributes, photos, and price observations. Learned identity aliases are saved,
so future records can match any previously observed platform or official URL.
A marketplace URL and an accommodation's official URL have distinct
provenance; only a page visited as `official-web` produces an official price
change event.

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

See [open-source competitor research](docs/COMPETITOR-RESEARCH.md) for the
reproducible search snapshot and capability comparison, and
[Issue 1 development notes](docs/ISSUE-1-DEVELOPMENT-NOTES.md) for the durable
architecture, parser, security, and validation findings from the work logs.
The [implementation handoff](docs/IMPLEMENTATION-HANDOFF.md) tracks the audited
deployment, Telegram, subscription, and associative-storage workstreams.

## Contributing

```bash
npm test
npm run test:coverage
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
