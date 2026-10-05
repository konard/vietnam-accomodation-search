title: Live Telegram extraction: 18% wrong prices (fees/areas taken as rent), 66% sold-out posts accepted as current, 42% missing locations; gate uses only 16 fixtures
state: OPEN
author: konard (Konstantin Diachenko)
labels:
comments: 0
assignees:
projects:
milestone:
issue-type:
parent: konard/vietnam-accomodation-search#100
sub-issues:
sub-issues-completed:
blocked-by:
blocking:
number: 97
--

## Summary

The audit's accuracy gate is computed only on a **16-case** reviewed fixture corpus ([`experiments/fixtures/telegram-accommodation-parser-cases.json`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/experiments/fixtures/telegram-accommodation-parser-cases.json), [`corpusClassificationMetrics`](https://github.com/konard/vietnam-accomodation-search/blob/49dcb1830094e8e7e14d40978c4974ab54dd4fcf/experiments/audit-telegram-accommodations.mjs#L230-L272)), so it reports precision and recall = 1. Live data on main [`49dcb18`](https://github.com/konard/vietnam-accomodation-search/commit/49dcb1830094e8e7e14d40978c4974ab54dd4fcf) shows large field-level errors that no gate measures.

## Evidence

Source: one real public Nha Trang rental channel in the protected 40-source audit, two-month window. Counts only; QA reviewed it locally.

- 1,031 messages: 996 accepted as `rental-offer`, 12 excluded (`no-accommodation-evidence`), 0 errors.
- A random 30-offer manual sample: all 30 were genuine rental listings, so **offer/non-offer precision looks good** on this source.
- The batch's own segment counters say `mapped: 0, reviewedUnknown: 996`. No field segment was mapped.

### 1. Wrong prices (false values) — 18.3% of labelled posts

874 posts state the rent explicitly (`Стоимость аренды: 14.000.000 VND / месяц`). Comparing the extracted `priceVnd` with that labelled value: **714 correct, 160 wrong (accuracy 0.817)**.

| error                                        | count | examples (labelled → extracted)                                                                         |
| -------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------- |
| a fee or utility line picked instead of rent | 87    | 14,000,000 → **500,000**; 12,000,000 → **250,000**; 8,000,000 → **200,000**; 14,000,000 → **1,000,000** |
| a non-price number turned into millions      | 61    | "**60** м²" or "Mường Thanh **60** Trần Phú" with labelled 14.5M–21M → **60,000,000**                   |
| a USD rent misread                           | 1     | **2,300 USD**/month → **5,000 VND** (the electricity rate `5.000 VND/кВт⋅ч`)                            |
| other                                        | 11    |                                                                                                         |

A 16/16 manual check of the out-of-range prices confirmed the checker. Since `search --cheapest` sorts by `priceVnd`, these errors appear **first** in cheapest results and in budget filters, and `/subscribe` max-price filters let them through.

### 2. Sold-out listings are accepted as current offers

**653 of 996 (65.6%)** accepted posts begin with `❌Sold out‼️` (the channel edits a post after renting it). No code in `src/` recognizes sold-out or rented markers in any language. The records have no availability signal, and **48** of those sold-out offers are flagged `attributes.availableNow` because the original text says `СВОБОДНА!`. Search and subscriptions will show and deliver unavailable apartments as fresh.

### 3. Location missing although present (false negatives)

`location` is null on **419 of 996 (42%)** offers. In **418** of them the text names a Nha Trang place: `Mường Thanh 60 Trần Phú`, `Hà Quang 1, Phước Hải`, `ACC Vườn Xoài`, `Vĩnh Trường`, and so on. Location filters and the "Nha Trang" query matching miss these.

## Acceptance criteria

- [ ] Price extraction prefers the labelled rent line (`стоимость/цена аренды`, `giá thuê`, `rent`, and equivalents) over utility, fee, deposit, area, floor, or building numbers. Handle multi-option rents (3/6/12-month and per-floor) as a range or minimum. Handle USD/EUR correctly. Add regression cases built from these patterns (synthetic text, no live identities).
- [ ] Recognize sold, rented, or no-longer-available markers in RU/EN/VI (`Sold out`, `сдана`, `занята`, `đã cho thuê`, `hết phòng`, edited-post markers). Mark such offers unavailable and exclude them from search and subscriptions by default. A sold-out marker overrides `availableNow`.
- [ ] Extract location from building, street, and ward names (a gazetteer of common Nha Trang complexes, streets, and wards) when no explicit "Район:" label exists.
- [ ] Replace the 16-case gate with a **field-level** reviewed live sample: at least 200 messages across at least 10 sources and all three languages, with expected `priceVnd`, period, availability, location, rooms, and offer/non-offer. Report per-field precision and recall in the audit. Set thresholds, for example price ≥ 0.98 and availability ≥ 0.98.
