# Issue 20 release-audit state — 2026-09-22

## Immutable target state

At the time this implementation was prepared:

- `gh release list --repo konard/vietnam-accomodation-search` returned no
  releases;
- `package.json` was version `0.11.30`;
- the GitHub Pages API returned HTTP 404 for the repository;
- no Telegram credentials were supplied to this workspace.

Consequently there is no honest “next release” identity and no post-change
credentialed Telegram result to attach. Those gates are **pending**, not pass.
The 2026-09-22 historical Telegram and browser reports remain the baseline.

## Rerunnable offline evidence

The ordinary test suite exercises release selection/idempotency, immutable
identity, all required gate names, baseline comparison, recursive redaction,
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
Live mode also keeps the report pending until tag, commit SHA, and package
version are all present in the release identity. A failed live gate makes the
manual command exit non-zero.
