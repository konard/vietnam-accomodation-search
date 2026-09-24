# Production deployment

## Runtime contract

The multi-stage image pins native multi-architecture Rust and Node 22 base
manifests, installs the exact Playwright Chromium runtime dependencies and
`link-cli` 0.2.10, and runs as the unprivileged `node` user under `tini`.
Credentials enter only at runtime. `/data` is the sole persistent writable
path; the root filesystem is read-only in Compose. Compose maps `/data` to one
explicit host directory with long bind syntax and
`bind.create_host_path: false`; it never silently creates or selects a named
volume.

Readiness is local-only by default. `/live` reports whether the process and
health server are alive. `/ready` returns success only after Bot API `getMe`,
optional MTProto `getMe`, and grammY's polling `onStart`. Shutdown marks the
service unready before stopping subscriptions and polling, draining active
middleware, closing resources, and closing the health server.

## Local build and first deploy

```bash
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, expected numeric identities, and numeric allowlists.
install -d -m 0700 "$PWD/.vietnam-accomodation-search"
export DATA_DIRECTORY_HOST="$PWD/.vietnam-accomodation-search"
export NPM_PACKAGE_VERSION="$(node -p "require('./package.json').version")"
export VCS_REF="$(git rev-parse HEAD)"
export BUILD_DATE="$(git show -s --format=%cI HEAD)"
docker compose build app
docker compose up -d app
docker compose ps
curl --fail http://127.0.0.1:8080/ready
```

Compose requires the checked-out package version, full commit SHA, and commit
date for direct builds. The deploy helper derives those values automatically.
The image build rejects a version that disagrees with `package.json`, and
deployment checks the OCI labels and CLI version before cutover. The image's
Tini is the single init process; Compose does not add another init wrapper.

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

Every action accepts `--data-directory PATH` (or
`DATA_DIRECTORY_HOST=PATH`) and defaults to
`.vietnam-accomodation-search`. Relative paths are resolved once to absolute
paths. The deploy helper rejects empty, root, home, credential, file, and
symlinked paths; enforces `0700`; checks free space and the state-schema marker;
and proves write, fsync, and rename on the host. It then renders Compose and
requires `/data` to be the exact validated bind. A second probe runs as the
container's unprivileged service UID. Any failure happens before the old
container stops. Use the same option for deploy, status, logs, stop, and
rollback.

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

## Backup, restore, and disaster recovery

Stop the writer for a point-in-time backup, then archive the one host root.
Keep credentials elsewhere (for example `/run/secrets`), never below this
directory.

```bash
DATA_DIRECTORY_HOST=/srv/vietnam-search/data node scripts/deploy.mjs stop
mkdir -p backups
tar -C /srv/vietnam-search/data -czf backups/data-$(date -u +%Y%m%dT%H%M%SZ).tgz .
sha256sum backups/data-*.tgz > backups/SHA256SUMS
DATA_DIRECTORY_HOST=/srv/vietnam-search/data node scripts/deploy.mjs deploy
```

Before installing a release that changes the schema, make and verify this
archive. The `.state-schema.json` marker makes an older binary refuse a newer
directory instead of attempting an unsafe downgrade. Restore only into a
stopped, empty, newly created `0700` directory. Preserve both the failed
directory and archive until `/ready`, a search, and `clink` verification pass:

```bash
DATA_DIRECTORY_HOST=/srv/vietnam-search/data node scripts/deploy.mjs stop
install -d -m 0700 /srv/vietnam-search/restored
sha256sum --check backups/SHA256SUMS
tar -C /srv/vietnam-search/restored -xzf backups/data-YYYYMMDDTHHMMSSZ.tgz
DATA_DIRECTORY_HOST=/srv/vietnam-search/restored node scripts/deploy.mjs deploy
```

Mount session secret files outside `/data` (for example under `/run/secrets`)
so the ordinary data-volume backup above excludes them.

Monitor the filesystem containing the host root for capacity and inode
exhaustion. Deployment refuses less than 16 MiB free; production alerting
should retain substantially more than the configured 10 GiB storage budget.
On corruption, stop writers, copy the entire directory for forensics, verify
the latest archive checksum, restore into a new path, and switch the explicit
path only after preflight. Never repair canonical LiNo by editing its binary
projection.

## One-time named-volume migration

For installations created by older Compose files, stop the service and copy
the named volume exactly once into an empty host directory. The marker file is
the idempotency boundary: on a retry, compare manifests instead of merging two
trees.

```bash
node scripts/deploy.mjs stop
install -d -m 0700 /srv/vietnam-search/data
docker run --rm \
  --mount type=volume,src=vietnam-accomodation-search-data,dst=/source,readonly \
  --mount type=bind,src=/srv/vietnam-search/data,dst=/destination \
  alpine:3.22 sh -ceu 'test -z "$(find /destination -mindepth 1 -print -quit)"; cp -a /source/. /destination/'
find /srv/vietnam-search/data -xdev -printf '%P\t%s\t%y\n' | sort > /tmp/host.manifest
docker run --rm \
  --mount type=volume,src=vietnam-accomodation-search-data,dst=/source,readonly \
  alpine:3.22 sh -c "find /source -xdev -printf '%P\\t%s\\t%y\\n' | sort" > /tmp/volume.manifest
diff -u /tmp/volume.manifest /tmp/host.manifest
DATA_DIRECTORY_HOST=/srv/vietnam-search/data node scripts/deploy.mjs deploy
```

Do not delete the old volume until a redeploy, search, restart, and rollback
drill all succeed against the bind. If the migration is interrupted, discard
the incomplete destination, recreate it as `0700`, and repeat; never overlay a
partial copy.

## Registry configuration

The existing release workflow builds on native `linux/amd64` and
`linux/arm64` runners, publishes per-platform digests, combines immutable
digests into `latest` and version manifests, and verifies both platforms.
Configure repository variables `DOCKERHUB_IMAGE` and `DOCKERHUB_USERNAME` plus
the `DOCKERHUB_TOKEN` secret to enable it. Inspect a release with:

```bash
docker buildx imagetools inspect OWNER/IMAGE:VERSION
```

Docker builds check out the final `vVERSION` tag, not the pre-version workflow
event SHA. After npm, the GitHub Release, and both native manifests exist, the
workflow cross-checks their versions and digests against the exact retested
candidate. It uploads `release-identity.json` as a retained workflow artifact
and a GitHub Release asset. If Docker Hub publishing is not configured, no
identity artifact is created and the post-release audit remains pending.

## Example application and GitHub Pages

GitHub Pages deployment is optional by default. Pull requests and ordinary
repositories without a Pages site still build the web app and publish the
`universal-example-web` workflow artifact. They do not receive Pages write or
OIDC permissions.

To make Pages a required main-branch deployment:

1. In repository **Settings → Pages**, select **GitHub Actions** as the build
   and deployment source. This is a one-time administrator action.
2. Set the repository variable `EXAMPLE_APP_PAGES_POLICY` to `required`.
3. Re-run the Example app workflow.

The read-only `pages-policy` job runs before package installation and expensive
matrix jobs. Required mode fails immediately with a classified reason when the
site is missing, the token cannot read it, or organization/repository policy
disables Pages. It never hides a required deployment failure. Once enabled,
the workflow uses GitHub's supported configure, artifact upload, and deploy
actions. Only the deploy job receives `pages: write` and `id-token: write`.
