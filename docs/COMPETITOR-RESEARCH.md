# Open-source competitor research

This is a reproducible research snapshot for the accommodation-search feature,
not a claim that every repository on every forge has been enumerated. GitHub
search results, stars, and maintenance status change continuously. The snapshot
was recorded on 2026-09-21 UTC.

## Method

The following GitHub repository searches were reviewed with the GitHub CLI:

```text
booking scraper
airbnb scraper
hotel price tracker
vacation rental aggregator
telegram real estate bot
```

Results were screened for features relevant to this project: browser-driven
collection, listing details, multi-source aggregation, identity reconciliation,
price history, change notification, availability, and chat workflows. Generic
HTML scraping tutorials, abandoned forks without distinct behavior, closed
source products, and repositories unrelated to accommodation were excluded
from the comparison. The representative repositories below cover each distinct
capability found in that search universe.

## Representative projects

| Project                                                                             | Snapshot                       | Relevant capability                                                                      |
| ----------------------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| [BookingScraper](https://github.com/ZoranPandovski/BookingScraper)                  | 100 stars, GPL-3.0             | Booking.com hotel search and extraction                                                  |
| [booking-scraper](https://github.com/Edioff/booking-scraper)                        | 3 stars, MIT                   | Playwright, multi-city search, details, prices, amenities, reviews                       |
| [airbnb-scraper](https://github.com/digital-engineering/airbnb-scraper)             | 210 stars, GPL-3.0             | Advanced Airbnb search with Scrapy                                                       |
| [pyairbnb](https://github.com/johnbalvin/pyairbnb)                                  | 149 stars, MIT                 | Listing metadata, coordinates, reviews, hosts, currency and availability data            |
| [actor-booking-scraper](https://github.com/dtrungtin/actor-booking-scraper)         | 17 stars, Apache-2.0           | Structured Booking.com hotel records                                                     |
| [actor-airbnb-scraper](https://github.com/dtrungtin/actor-airbnb-scraper)           | 30 stars, license not declared | Broad public Airbnb listing data                                                         |
| [findmyhotel](https://github.com/yelm-212/findmyhotel)                              | 0 stars, license not declared  | Scheduled Playwright checks, price history, availability changes, Discord alerts         |
| [hotel-price-tracker](https://github.com/jaanit/hotel-price-tracker)                | 1 star, license not declared   | Kayak hotel price collection                                                             |
| [Vacation-Finder](https://github.com/charleshall888/Vacation-Finder)                | 0 stars, license not declared  | Airbnb, Vrbo, Vacasa, and local-agency aggregation                                       |
| [telegram-real-estate-bot](https://github.com/nematjon555/telegram-real-estate-bot) | 0 stars, license not declared  | Categorized Telegram listings, lead capture, administration, spreadsheet synchronization |

Stars are included only as a discovery signal and are not a quality score. A
missing declared license means code should not be copied or redistributed.
This project implements its behavior independently under the Unlicense.

## Capability comparison

| Capability found in competitors            | Support here           | Notes                                                                                                                                                                           |
| ------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser-driven marketplace search          | Yes                    | Browser Commander with Playwright visits configured public search UIs.                                                                                                          |
| Multi-market aggregation                   | Yes                    | 20 ranked web sources, 20 nationwide Telegram sources, and 20 Nha Trang-focused sources.                                                                                        |
| Multi-city or free-text destination search | Yes                    | The query is applied to every source and retained with each normalized offer.                                                                                                   |
| Multilingual structured details            | Yes                    | English, Vietnamese, and Russian parsing covers occupancy, rooms, area, floor, fees, dates, coordinates, rating, review count, amenities, contacts, and unknown labeled fields. |
| Up to ten listing photos                   | Yes                    | Original URLs are retained and local files share a bounded 10 GiB cache.                                                                                                        |
| Currency normalization                     | Yes                    | Explicit VND is preferred; USD, EUR, and GBP can be converted through a cached rate snapshot.                                                                                   |
| Cross-source deduplication                 | Yes                    | Canonical official URLs, platform IDs, source property IDs, and conservative structural/contact fingerprints are used.                                                          |
| Transitive merge and provenance            | Yes                    | All source IDs, raw variants, identifiers, search queries, contacts, attributes, and photos survive a merge.                                                                    |
| Persistent price history                   | Yes                    | Every source observation is stored in Links Notation, including unchanged checks.                                                                                               |
| Official-property-site checks              | Yes, when discoverable | An explicitly marked or labeled official URL is visited directly, even if its marketplace card has no price; it stays distinct from the marketplace URL.                        |
| Official price increase/drop detection     | Yes                    | Only direct `official-web` observations generate official price-change events; marketplace and Telegram prices remain in history without being mislabeled.                      |
| Search-time price-change display           | Yes                    | CLI and Telegram search results show the latest official increase or drop.                                                                                                      |
| Availability                               | Partial by design      | Parsed dates and explicit owner inquiries are supported. A site-specific availability calendar is not fabricated when a generic page does not expose one.                       |
| Scheduled execution                        | Deployment concern     | Repeated CLI or bot searches refresh stale data; cron, systemd, or the hosting platform owns process scheduling.                                                                |
| Proactive Discord/email alerts             | Not duplicated         | Telegram and CLI expose detected changes. Adding a new outbound channel requires an explicit notification policy and credentials.                                               |
| Lead-management CRM or spreadsheet sync    | Out of scope           | The bot searches and checks availability; it does not collect sales leads or become an agency CRM.                                                                              |
| Anti-bot circumvention                     | Explicitly excluded    | Sources may be skipped on consent, CAPTCHA, or access blocks. Terms, robots policies, and rate limits must be respected.                                                        |

The comparison distinguishes useful accommodation-search behavior from adjacent
business workflows. “Support” therefore means implementing the relevant search,
normalization, reconciliation, history, and availability behavior, rather than
copying every deployment choice or unrelated CRM feature.

## Design consequences

- Exact platform or official-site identity wins over heuristic matching.
- A fallback fingerprint requires location plus a title/structure discriminator;
  a shared agent phone number alone cannot merge different units.
- Identity keys learned during a merge are persisted, so a later update may
  match any prior alias.
- Official website prices use a dedicated `official-web` provenance type. A
  marketplace page is never described as the accommodation's official site.
- Raw records and unfamiliar labeled fields remain available for future parser
  improvements without a data migration.
- Source-specific adapters can be added when a public generic page does not
  expose a calendar, review body, or other structured field reliably.
