# Production deployment

## Runtime contract

The multi-stage image pins native multi-architecture Rust and Node 22 base
manifests, installs the exact Playwright Chromium runtime dependencies and
`link-cli` 0.2.10, and runs as the unprivileged `node` user under `tini`.
Credentials enter only at runtime. `/data` is the sole persistent writable
volume; the root filesystem is read-only in Compose.

Readiness is local-only by default. `/live` reports whether the process and
health server are alive. `/ready` returns success only after Bot API `getMe`,
optional MTProto `getMe`, and grammY's polling `onStart`. Shutdown marks the
service unready before stopping subscriptions and polling, draining active
middleware, closing resources, and closing the health server.

## Local build and first deploy

```bash
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, expected numeric identities, and numeric allowlists.
docker compose build app
docker compose up -d app
docker compose ps
curl --fail http://127.0.0.1:8080/ready
```

Use `TELEGRAM_*_FILE` variables for mounted secret files. Do not add a session
to an image layer. For a published image:

```bash
APP_IMAGE=OWNER/IMAGE:VERSION docker compose pull app
APP_IMAGE=OWNER/IMAGE:VERSION docker compose up -d --no-build app
```

## Safe redeploy and operations

The deployment command serializes mutations with `.deploy/operation.lock`:

```bash
node scripts/deploy.mjs deploy
node scripts/deploy.mjs status
node scripts/deploy.mjs logs
node scripts/deploy.mjs rollback
node scripts/deploy.mjs stop
```

Pass `--image OWNER/IMAGE:IMMUTABLE_TAG` to pull rather than build. A deploy
creates a unique candidate tag, smoke-tests the CLI and `clink`, validates
credentials without `getUpdates`, and checks the data mount while the old
poller remains live. It then gracefully stops the old poller and starts the
candidate. A readiness failure retags and restores the exact prior image ID,
and the deploy exits non-zero.

Telegram allows only one `getUpdates` consumer per bot token. Consequently,
the short interval between old-poller stop and candidate-poller readiness is
unavoidable; the workflow never overlaps them. A candidate that cannot pass
offline/preflight checks never reaches cutover.

## Backup and restore

Stop the writer for a point-in-time backup, then archive the named volume:

```bash
node scripts/deploy.mjs stop
mkdir -p backups
docker run --rm \
  -v vietnam-accomodation-search-data:/data:ro \
  -v "$PWD/backups:/backup" \
  alpine:3.22 tar -C /data -czf /backup/data.tgz .
docker compose up -d app
```

Restore only into a stopped service and preferably a new empty volume. Restore
overwrites application state, so preserve the old archive until `/ready` and a
search have succeeded:

```bash
node scripts/deploy.mjs stop
docker run --rm \
  -v vietnam-accomodation-search-data:/data \
  -v "$PWD/backups:/backup:ro" \
  alpine:3.22 sh -c 'find /data -mindepth 1 -delete && tar -C /data -xzf /backup/data.tgz'
docker compose up -d app
```

Mount session secret files outside `/data` (for example under `/run/secrets`)
so the ordinary data-volume backup above excludes them.

## Registry configuration

The existing release workflow builds on native `linux/amd64` and
`linux/arm64` runners, publishes per-platform digests, combines immutable
digests into `latest` and version manifests, and verifies both platforms.
Configure repository variables `DOCKERHUB_IMAGE` and `DOCKERHUB_USERNAME` plus
the `DOCKERHUB_TOKEN` secret to enable it. Inspect a release with:

```bash
docker buildx imagetools inspect OWNER/IMAGE:VERSION
```
