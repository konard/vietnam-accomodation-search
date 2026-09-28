# Post-PR #53 candidate revalidation — 2026-09-29

## Scope and privacy

This manual/local pass tested main commit
[`08f31cf`](https://github.com/konard/vietnam-accomodation-search/commit/08f31cf71f34e6bfa25e1468a5a8cd514390c084)
after PR [#53](https://github.com/konard/vietnam-accomodation-search/pull/53)
merged. It is **candidate evidence, not release acceptance**. The prior issue
batch was closed by that merge; per the current operator request, this report
does not reopen it. Private Telegram journals, page traces, source identities,
message bodies, contacts, media, sessions, bot credentials, and clink shard
files remain in ignored local storage. Only aggregates are committed.

## Deterministic checks and publication

The local Node 24.18.0 suite passed **817/817** tests across 188 suites using
the pinned Rust `clink` 0.2.10 and network/loopback access required by some
tests. This confirms that PR #53 fixed the macOS fake-Docker argv fixture
failure observed on the previous candidate. The four manual-helper suites
passed **28/28**, and `npm run check` passed. These tests include synthetic
shard interruption/reuse, tamper detection, and parser-size cases, but not
the private Telegram corpus.

[Checks and release run 36459527120](https://github.com/konard/vietnam-accomodation-search/actions/runs/36459527120)
failed Release Preflight: `NPM_TOKEN` is empty and the npm package does not
exist, so the first publication is refused. `DOCKERHUB_IMAGE` is also unset,
so Docker Hub publication is disabled. There is still no Git tag or GitHub
Release. `npm view vietnam-accomodation-search version` returns `E404`.
Local `npm pack --dry-run` includes 42 files and the CLI, but that is not a
registry install, provenance, or an immutable artifact.

## Real Telegram corpus: a new post-sharding failure

The authorized, explicitly declared GramJS session resumed the retained
private source journal/checkpoint with English/Russian/Vietnamese OCR and
Rust `clink` 0.2.10. Unlike the earlier 600-second timeout, the new sharded
projection completed **881 domain-record shards in about 30 seconds** and
**122 trace shards in about 5 seconds**. It then failed during offer
projection before writing a final audit report or advancing the source
checkpoint. The private journal and failed shard are retained.

The privacy-safe
[`experiments/inspect-failed-clink-shard.mjs`](../../../experiments/inspect-failed-clink-shard.mjs)
replays the verifier against the retained failed offer shard without printing
link values or IDs. That shard contains **73 canonical links** and **100
exported links**; `verifyExport` finds **1 missing** and **2 unexpected**
two-value links. One missing link ID appears among the unexpected links.
The failed candidate records `storage-error`. This is an actual verified
binary/text mismatch, not the prior projection throughput timeout. The
application correctly did not claim a final accepted result, but the complete
40-source/two-month corpus, discovery ranking, human-reviewed parsing, typed
link verification, and second-run idempotence remain unproved. No raw shard,
source alias, numeric identity, or listing excerpt belongs in Git or issues.

The first audit invocation stopped even earlier because the local session
format was not declared. The subsequent run set
`TELEGRAM_USER_SESSION_FORMAT=gramjs/string-session-v1`; it did not convert
the session or use it as native mtcute runtime state.

## Browser and bot-only live checks

A full polite Browser Commander pass succeeded on **10/10** committed public
routes (5 Vietnamese, 2 English, 3 Russian), with **224 cards**,
**1,607/1,607 segments consumed**, **zero incomplete cards**, and **zero
missing semantic checks**. It used normal per-domain pacing, bounded
concurrency across independent domains, private mode-`0600` traces, and no
CAPTCHA bypass. This is one current candidate pass; two consecutive passes
were recorded on the previous candidate. The exact immutable-release repeat
is still pending.

The real bot-only conversation passed bot identity, preset save/select,
`/subscribe`, fresh unseen delivery, restart, no duplicate after restart,
persisted preset/subscription, search, and cleanup. The pre- and post-run
cleanup-only scans both found **zero leftover E2E messages**. The result
remains `combinedRuntime: false` and `testUserIdentityPinned: false`.
Native mtcute user-only, combined/degraded combined, independently pinned
identities, and bot-first capability fallback were not tested with the
available GramJS driver session.

## Production-image check and untested handoff

The exact `08f31cf` Dockerfile built a local production image with matching
OCI commit/version/date labels. It returned CLI version `0.12.3`, ran as UID
`1000`, passed the pinned `clink` command smoke test, and launched/closed
headless Chromium. This is a **local image**, not a published multi-platform
digest. This pass did not cut over a running Docker bot, repeat the retained
host-bind/rollback drill on this commit, or deliberately fail a candidate.
The [previous candidate's handoff probe](../revalidation-2026-09-28/README.md#docker-deploy-handoff-and-host-bind-durability)
observed a 3,691 ms maximum sampled `/ready` interruption, but Bot API
`getMe` is independent of app delivery; it cannot establish a single poller
or prove no lost or duplicate updates.

## Conclusion

The candidate's deterministic, browser, bot-only, and production-image smoke
checks pass. It is **not production-ready**: first publication is blocked by
the absent bootstrap credential, the real private corpus now exposes an
offer-shard binary/text verification mismatch, native mtcute modes remain
unverified, and immutable-release plus message-level deploy acceptance do
not exist. New issues track these distinct gates without reopening the issues
closed by PR #53: [#54 publication](https://github.com/konard/vietnam-accomodation-search/issues/54),
[#55 corpus/storage](https://github.com/konard/vietnam-accomodation-search/issues/55),
[#56 native Telegram](https://github.com/konard/vietnam-accomodation-search/issues/56),
[#57 deploy](https://github.com/konard/vietnam-accomodation-search/issues/57),
and [#58 exact-release acceptance](https://github.com/konard/vietnam-accomodation-search/issues/58).
