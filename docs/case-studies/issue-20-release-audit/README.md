# Issue 20/26 release-audit state — 2026-09-23

## Immutable target state

At the time this implementation was prepared:

- `gh release list --repo konard/vietnam-accomodation-search` returned no
  releases;
- `gh api repos/konard/vietnam-accomodation-search/tags` returned no tags;
- the npm registry returned HTTP 404 for `vietnam-accomodation-search`;
- `package.json` was version `0.11.30`;
- the GitHub Pages API returned HTTP 404 for the repository;
- no Telegram credentials were supplied to this workspace.

Consequently there is no honest “next release” identity and no post-change
credentialed Telegram result to attach. Those gates are **pending**, not pass.
The 2026-09-22 historical Telegram and browser reports remain the baseline.
Fixture and dry-run reports are explicitly ineligible to close the release
gate, even when every simulated gate says pass.

## Post-publication identity chain

Both automated and instant release paths now retest the exact version commit
before publishing. Node.js and Deno use their committed frozen locks; Bun
migrates the committed `package-lock.json` for its clean install and discards
the generated migration lock after its full suite. The workflow then records
the full commit SHA and concrete runtime versions.
The npm consumer smoke test separately records the name and version read from
the registry-installed package.

Docker publication checks out the final version tag rather than the workflow's
pre-version event SHA. After both native images and the multi-architecture
manifest are published, `collect-release-identity.mjs` independently reads:

- the non-draft, non-prerelease GitHub Release and its publish timestamp;
- the recursively peeled Git tag target;
- npm registry name, version, tarball URL, and integrity;
- the installed npm package name/version from the consumer smoke test;
- the exact candidate SHA and Node/Bun/Deno versions;
- the raw OCI index plus `linux/amd64` and `linux/arm64` digests; and
- release-audit, domain-graph, trace, and links-notation schema versions.

Any version/SHA/platform mismatch fails collection. The resulting sanitized
`release-identity.json` is retained as a workflow artifact and attached to the
GitHub Release. If Docker publishing is not configured, this job is skipped
and the immutable release gate stays pending.

## Rerunnable offline evidence

The ordinary test suite exercises release selection/idempotency, OCI digest
derivation, cross-artifact identity mismatches, all 39 required gate names,
baseline comparison, recursive redaction, timestamp preservation,
missing-credential behavior, and the CI/manual boundary. The audit assembler
is offline by default:

```bash
node experiments/run-release-audit.mjs \
  --release /private/release.json \
  --evidence /private/sanitized-evidence.json \
  --baseline /private/baseline.json \
  --output /private/issue-20-release-audit.json
```

The output file is atomically created or replaced with mode `0600`. Input and
output files stay private and are not repository artifacts.

## Explicit live procedure

After the first/next GitHub Release exists, stop any competing bot poller and
run the existing Telegram/browser manual probes. Assemble only sanitized gate
summaries with:

```bash
RELEASE_AUDIT_LIVE=1 \
TELEGRAM_API_ID=... \
TELEGRAM_API_HASH=... \
TELEGRAM_BOT_TOKEN=... \
TELEGRAM_USER_SESSION=... \
node experiments/run-release-audit.mjs --live \
  --release /private/release.json \
  --evidence /private/sanitized-evidence.json \
  --baseline /private/baseline.json \
  --output /private/issue-20-release-audit.json
```

All four Telegram credential classes are required because the audit includes
bot-only, user-only, and combined-routing gates. Inject them from a protected
shell or secret mount; do not put real values in shell history. The runner
refuses common CI environments and refuses
`TELEGRAM_BOT_POLLER_ACTIVE=1`. Every missing gate remains pending, every
challenge/degraded capability remains non-pass, and the previous baseline is
never overwritten. Commit only an independently reviewed sanitized comparison
containing immutable release/run links; never commit raw posts, private peer
IDs, contacts, sessions, auth keys, API hashes, tokens, or unredacted logs.
Live mode keeps the report pending until the GitHub tag and full tested SHA,
npm install/integrity, versioned two-platform image digests, runtime/schema
versions, prior baseline, and immutable timestamped evidence references are
present and mutually consistent. Pending and failed live audits both exit
non-zero.
