# Post-PR #60 candidate revalidation — 2026-09-29

## Scope and privacy boundary

This local/manual pass tested main commit
[`2499611`](https://github.com/konard/vietnam-accomodation-search/commit/2499611150a88f11c442f9e8c6b0f25f8087f725)
after PR [#60](https://github.com/konard/vietnam-accomodation-search/pull/60)
merged. The PR description explicitly said the credentialed, private-corpus,
and published-release gates had not run, yet its closing references closed
Issues #54–#59. Per the operator's instruction, those issues are not reopened;
new Issues [#61](https://github.com/konard/vietnam-accomodation-search/issues/61)–[#65](https://github.com/konard/vietnam-accomodation-search/issues/65)
track the remaining acceptance.

The real Telegram audit used a mode-`0700` copy of the retained private state,
leaving the original journal and failed shard untouched. Browser traces,
Telegram journals, source identities, messages, contacts, credentials, and
failure diagnostics remain in ignored local storage. Only aggregate counts
and code locations appear here; no raw private data was committed.

## Release and deterministic checks

[Checks and release run 36507534519](https://github.com/konard/vietnam-accomodation-search/actions/runs/36507534519)
failed Release Preflight with two blockers: the unpublished npm package has no
bootstrap `NPM_TOKEN`, and committed OCI policy requires `linux/amd64` and
`linux/arm64` images while `DOCKERHUB_IMAGE` is unset. There is no Git tag,
GitHub Release, npm artifact, or published multi-architecture digest. Passing
platform jobs and a local image cannot substitute for those artifacts.

The complete local Node 24.18.0 suite passed **849/849** tests across 193
suites with Rust `clink` 0.2.10 and required network/loopback access.
`npm run check` passed. The six new real-`clink` schema-v3 regressions passed.
These establish the code-level fix for the previous name-rewrite shard, not
the full private-corpus or release gate.

## Retained Telegram audit: new production-scale serialization failure

The updated aggregate-only shard inspector classified the prior failed
73-canonical/100-exported-link shard as `name-rewritten` (1 missing link,
1 rewritten ID, 2 unexpected links). On the protected audit copy, schema-v3
projection passed that earlier offers-shard failure and advanced the source
checkpoint. A subsequent source failed before the final audit report with a
`RangeError` classified as **string-length**. The
[`experiments/diagnose-telegram-audit.mjs`](../../../experiments/diagnose-telegram-audit.mjs)
wrapper retained only safe failure metadata in a mode-`0600` file; its code
frames point to `serializeOffers → serializeRecords → formatLinks` at
`src/links-store.js:530`. One private source journal remains pending. A
negative-timeout warning was also emitted; its causal effect is unverified.

The read-only
[`experiments/profile-private-offer-merge.mjs`](../../../experiments/profile-private-offer-merge.mjs)
measured the pending batch without printing an offer or identity:

| Set                      | Offers | JSON characters | Sum of individually formatted LiNo characters |
| ------------------------ | -----: | --------------: | --------------------------------------------: |
| Existing committed state |      1 |          83,332 |                                     7,327,008 |
| Pending source batch     |    397 |       8,449,518 |                                   612,057,696 |
| Deduplicated merge       |    398 |      17,061,993 |                             **1,294,737,197** |

The `LinksStore.saveOffers` path formats the **entire** merged collection
before checking its configured 10 GiB budget. That materialization reaches
the JavaScript string limit first, so the eviction loop cannot run. This is a
new scale blocker, not proof that the complete 40-source/two-month collection
or every accommodation post parses. The first complete report and second
idempotent run remain unavailable.

## Browser, Telegram E2E, and Docker

The current polite Browser Commander audit passed **10/10** committed VI/EN/RU
routes (5 Vietnamese, 2 English, 3 Russian), **224 cards**,
**1,609/1,609 consumed segments**, zero incomplete cards, and zero missing
semantic checks. It kept private mode-`0600` traces, per-domain pacing, and
no CAPTCHA bypass. This is one mutable-candidate pass; the exact-release
two-run gate remains open.

The updated real conversation E2E refused to start before network use because
the protected local bot environment lacks an independently supplied numeric
bot identity pin. The GramJS driver environment also lacks its independent
driver pin, and no native mtcute runtime session was used. This fail-closed
result is correct security behavior, not a passing bot-only, native
user-only, combined, or fallback E2E on this commit. No test message was
created by that preflight failure. The last passing bot-only conversation is
historical evidence from the previous candidate.

The exact `2499611` production Docker image built locally with matching
OCI commit/version/date labels, CLI version `0.12.3`, UID `1000`, working
`clink`, and a successful headless Chromium smoke test. This is not a
published immutable image. The new message-level cutover drill, unhealthy
candidate restoration, host-bind recovery, and multi-architecture comparison
could not be accepted without pinned Telegram identities and published image
digests; none was live-run in this pass.

## Conclusion

Delivery is **not complete or production-ready**. The deterministic suite,
browser candidate, and local image smoke pass, but real Telegram ingestion
now fails at a 1.29-billion-character offer serialization boundary. Required
npm/Docker publication credentials, native Telegram identity/session
acceptance, message-level deploy acceptance, and an immutable exact-release
audit remain outstanding. Issues
[#61 storage/corpus](https://github.com/konard/vietnam-accomodation-search/issues/61),
[#62 publication](https://github.com/konard/vietnam-accomodation-search/issues/62),
[#63 native Telegram](https://github.com/konard/vietnam-accomodation-search/issues/63),
[#64 deploy](https://github.com/konard/vietnam-accomodation-search/issues/64),
and [#65 final acceptance](https://github.com/konard/vietnam-accomodation-search/issues/65)
own those gates.
