# Production deployment

## Runtime contract

The multi-stage image pins native multi-architecture `rust:1.99.0-trixie` and
`node:24.21.0-trixie-slim` (Node.js 24 Active LTS) base manifests by digest,
installs the exact Playwright Chromium runtime dependencies and
`link-cli` 1.0.0, and runs as the unprivileged `node` user under `tini`.
Credentials enter only at runtime. `/data` is the sole persistent writable
path; the root filesystem is read-only in Compose. Compose maps `/data` to one
explicit host directory with long bind syntax and
`bind.create_host_path: false`; it never silently creates or selects a named
volume.

Readiness is local-only by default. `/live` reports whether the process and
health server are alive. `/ready` returns success only after Bot API `getMe`,
optional MTProto `getMe`, and grammY's polling `onStart`.

Deploy and rollback wait up to 300 seconds for Docker health. Override this
with `--ready-timeout SECONDS` for data-dependent startup. Both Compose and the
image use a five-minute startup grace period and two-second startup probes;
normal probes remain 15 seconds apart. This requires Compose 2.20.2 or later
and Docker Engine 25 / API 1.44 or later. A terminal container or unhealthy
status fails immediately. The helper reports observed healthy time and budget.
`node experiments/deploy-readiness-drill.mjs` reproduces the reported 40-second
application startup / 60-second healthy transition with a virtual clock; its
output records the reference data size and explicitly identifies synthetic
timing. It does not establish real protected-store startup performance.

Telegram allows one `getUpdates` poller per bot token. When another poller
takes over (`409 Conflict: terminated by other getUpdates request`), the
instance stays alive but `/ready` returns 503 with
`{"status":"not-ready","reason":"polling-conflict","conflicts":N}`, so the
Docker health check fails for as long as the conflict lasts. It logs
`telegram polling conflict: another poller holds this bot token` with the
conflict count and the next delay, and polls again after a jittered backoff
that doubles from 5 s up to 5 min. The first successful `getUpdates` makes
it ready again and logs `telegram polling resumed`. A conflict before the
first readiness still exits with code 21, and an invalid token (401) exits
with code 20 at any time. Shutdown marks the
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

### Browser sandbox

Compose sets `BROWSER_NO_SANDBOX=1`. Chromium's own sandbox needs
unprivileged user namespaces or a setuid `chrome-sandbox` helper. The container
deliberately removes both: it runs as the unprivileged `node` user, drops every
capability (`cap_drop: ALL`), sets `no-new-privileges`, keeps the default
seccomp profile, and mounts the root filesystem read-only. With the sandbox
enabled Chromium exits before its DevTools endpoint is ready, so every search
fails at launch.

The alternative, a custom seccomp profile that allows `clone`/`unshare` with
`CLONE_NEWUSER` (or `--cap-add SYS_ADMIN`), widens the kernel surface of the
whole container, including the Node.js process that holds the Telegram
credentials. Without the Chromium sandbox, a renderer exploit runs as the
`node` user inside this container. It can read `/data` and the process
environment, including the bot token, but it gets no capabilities, cannot
gain privileges, and cannot write outside `/data` and `/tmp`. Treat the
container as the browser's isolation boundary: keep the image patched (the
pinned Playwright Chromium is updated with the package), do not mount host
paths besides `/data`, and do not run this image with `--privileged`.

Outside this Compose file, leave `BROWSER_NO_SANDBOX` unset whenever Chromium's
sandbox can start, for example on a desktop or a host with unprivileged user
namespaces.

Each deploy checks the candidate with the app's own launch path before the
old container stops. Both checks run through `docker compose run` with the
deployed environment:

- `self-check browser` launches Chromium through `createApplication()`'s
  collector, with its launch options, and renders a `data:` page.
- `self-check search` serves a fixture listing page on `127.0.0.1` inside the
  container, runs one real search against it in a throwaway data directory,
  and fails unless it returns at least one offer.

CI runs the same two commands against the built image with the Compose
security options.

## Safe redeploy and operations

The deployment command serializes mutations with `.deploy/operation.lock` and
keeps its record for each Compose project in `.deploy/PROJECT/state.json`, so
a drill run with `--project-name` never replaces the production rollback
record:

```bash
node scripts/deploy.mjs deploy
node scripts/deploy.mjs deploy --ready-timeout 300
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

`.deploy/PROJECT/state.json` records the data directory of the last deploy,
and every later `deploy` of that project must use it:

- Only the first deploy of a project creates a missing data directory, and
  it prints `Created data directory PATH`. If that deploy then fails, for
  example on the port or shared-token check, it removes the directory again
  while it holds no data, together with an empty `.deploy/PROJECT/`, and
  prints `Removed PATH, which the failed attempt created.` With a recorded deployment a
  missing directory is an error for every mutating action, so a mistyped
  path never becomes a new, empty directory.
- A different path fails before anything is built or stopped, naming both
  paths. Pass `--move-data-directory` to move the deployment deliberately.
  If the candidate then fails, the previous image starts again on the
  previous directory.
- A directory without the `.state-schema.json` marker, or with no data, is
  refused while the recorded directory may still hold data. This covers the
  project's own directory after it was wiped or replaced. Pass
  `--allow-empty-data-directory` to start from it anyway.

Before the image is built or pulled, the helper also checks that every host
port the app publishes (`HEALTH_PORT`, default `127.0.0.1:8080`) is free,
except a port this project's running container already holds. A taken port
fails with `Host port HOST:PORT is already in use; set HEALTH_PORT to a free
port.`

Telegram allows one poller per bot token, so a second Compose project with
the same token makes both bots fail with 409. After the build the helper runs
a short script in the candidate container that prints only
`sha256("telegram-bot-token:" + token)`; the token itself never reaches the
host process or `.deploy/`. The fingerprint is recorded in the project's
`state.json`, and a deploy whose token fingerprint another project already
recorded is refused unless `--allow-shared-token` is passed. Drills and test
projects started with `--project-name` therefore need a separate bot; remove
`.deploy/OTHER-PROJECT/` after removing a project that is gone for good.

Pass `--image OWNER/IMAGE:IMMUTABLE_TAG` to pull rather than build. A deploy
creates a unique candidate tag, smoke-tests the CLI and `clink`, validates
credentials without `getUpdates`, and checks the data mount while the old
poller remains live. It then gracefully stops the old poller and starts the
candidate. After the old service stops, the canonical state (every file in
the data directory except the rebuildable `.binary` projection, the `media`
cache, and lock or probe files) is copied into a private `0700` snapshot in
`.deploy/PROJECT/snapshots/`, with a manifest of relative paths, modes, and
SHA-256 digests only. The two newest snapshots are kept. Only then is the
data schema marker raised to the candidate's version. A readiness failure
stops the candidate, removes files it created, restores every snapshot file
and verifies its digest, and restarts the exact prior image ID; the deploy
exits non-zero.

A candidate that became ready is then watched for a settle window
(`--settle-seconds`, default 30; `0` disables it). Every 2 s the helper reads
the container's restart count, running state, and health status, and counts
polling-conflict lines in its logs since it started. Any restart, stop,
`unhealthy` status, or polling conflict fails the deploy, which restores the
previous image and state as above. `Deployment healthy` is printed only after
the window passes. A failed first deploy has no previous image; it removes
the containers it created with `docker compose down` (volumes and the bind
directory are kept) and exits non-zero.

A failure prints one line naming the step and the cause, for example
`Deploy failed during pulling the image: Error response from daemon: pull
access denied for vac-local`, followed by `Full details:
.deploy/PROJECT/deploy.log`. Command output is shown on the terminal as it
runs and is captured as well, so the cause is the last line of the failing
command's stderr. When the deploy recovered, the step is still the one that
failed (`waiting for readiness`, `observing the settle window`), and the
recovery follows on its own line, for example `Recovered: previous image and
state restored.` That `0600` log gets one JSON line per failure with the step,
the recovery, the last command, its exit code, the stack, and the last 8 KiB
of the command's stdout and stderr, with Telegram tokens redacted. When the
failed attempt removed the `.deploy/PROJECT/` it created, the entry goes to
`.deploy/deploy.log`.

The data schema marker is version 4 from the release that writes every large
record collection, such as `domain-records` and `traces`, through an atomic
chunk index (#90). An older image would ignore `KIND.index.json` and read a
stale or missing `KIND.lino`. Version 3 did the same for offers (#61), so an
older image would read stale `offers.lino` data. The previous version 2 marker
introduced escaped schema-v3 collection names (#55). `rollback` therefore compares the previous image's
recorded data schema with the directory's marker. For an older schema it
refuses unless `--restore-snapshot` is passed, which restores the state
captured before the last cutover and discards changes written since. A
rollback within one data schema keeps the current data. Both require the
same `--data-directory` as the recorded deploy.

Telegram allows only one `getUpdates` consumer per bot token. Consequently,
the short interval between old-poller stop and candidate-poller readiness is
unavoidable; the workflow never overlaps them. A candidate that cannot pass
offline/preflight checks never reaches cutover.

## Message-level cutover drill

`experiments/deploy-cutover-drill.mjs` proves those guarantees through
Telegram itself. It is manual and local-only: it refuses CI and needs
`TELEGRAM_DEPLOY_DRILL=1`, distinct numeric bot and driver identity pins, a
Compose project whose name contains `drill`, and a new data directory whose
path contains `drill`. The bot environment file is the Compose `env_file` and
must allowlist the driver account.

```bash
TELEGRAM_DEPLOY_DRILL=1 node experiments/deploy-cutover-drill.mjs \
  --bot-env /secure/drill-bot.env --user-env /secure/driver.env \
  --project-name vas-drill --data-directory /srv/vas-drill/data \
  --image OWNER/IMAGE:VERSION --health-port 18080
```

The drill runs `first-deploy`, `redeploy`, `failed-preflight` (an image that
cannot be pulled), `rollback`, `unhealthy-candidate`, and `recreate`
(`docker compose down`, then a fresh container on the same bind);
`--transitions ...,docker-restart` adds a Docker daemon restart through
`sudo -n`. After the first deploy it saves a drill preset and subscribes to
it. During every transition the driver sends a read-only
`/preset show drill-RUN-N` marker every `--marker-interval-ms`, while the
drill samples `/ready` and the project's running app containers. The
unhealthy candidate uses a generated Compose file in `.deploy/PROJECT/` that
extends the production service; its health check fails for every image except
the deploy helper's `:rollback-` tag of the prior image.

A transition fails when the deploy result is not the expected one, more than
one app container runs, a marker is never answered or answered twice, a
delivery arrives twice, the decoded records of any collection (presets,
subscriptions, delivered offers, cursors) change, media files are lost, or
the binary projection is not rebuilt. A failed preflight must also keep the
old container running throughout, an unhealthy candidate must end on the
exact previous image ID, and a rollback must end on the first deploy's image
ID. The report contains counts, digests, image IDs, the longest `/ready`
outage, and the longest marker reply latency by Telegram server time. Deploy
output stays in `.deploy/PROJECT/drill-RUN.log`. Cleanup unsubscribes,
deletes the preset and every drill message, re-reads the conversation to
count leftovers, and removes the drill project together with its
`.deploy/PROJECT/state.json` record and snapshots, so the next run can start
with `first-deploy` on a new data directory. The drill logs stay.

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
DATA_DIRECTORY_HOST=/srv/vietnam-search/restored node scripts/deploy.mjs deploy --move-data-directory
```

The restored directory is a different path from the recorded one, so the
deploy needs `--move-data-directory`. The archive contains the
`.state-schema.json` marker and the data, so no other flag is needed.

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

If the project already has a deploy record for another directory, add
`--move-data-directory`; a copied volume without `.state-schema.json` also
needs `--allow-empty-data-directory`, and the first validation then marks it
as schema 1.

Do not delete the old volume until a redeploy, search, restart, and rollback
drill all succeed against the bind. If the migration is interrupted, discard
the incomplete destination, recreate it as `0700`, and repeat; never overlay a
partial copy.

## Image size

The runtime image is about 1.4 GiB unpacked (`du -sxm /` inside the image:
1415 MiB on `0.12.3`; about 640 MB gzip-compressed, which is what a redeploy
pulls). Most of it is Playwright's Chromium (about 660 MiB) and its system
libraries. The `-slim` Node base keeps the rest small; the full
`node:24.21.0-trixie` base adds about 1 GiB of build tools and libraries the
runtime never uses (2412 MiB unpacked, about 1 GB compressed).

The budget is **1600 MiB** unpacked. The pull-request Docker build check
measures the image with `du -sxm /` and fails above it. Raise the budget only
with a recorded reason in the pull request that needs it.

## Registry configuration

The existing release workflow builds on native `linux/amd64` and
`linux/arm64` runners, publishes per-platform digests, combines immutable
digests into `latest` and version manifests, and verifies both platforms.
Configure repository variables `DOCKERHUB_IMAGE` and `DOCKERHUB_USERNAME` plus
the `DOCKERHUB_TOKEN` secret.

The accepted OCI policy is committed in `.github/oci-policy.json`: every
release must publish both `linux/amd64` and `linux/arm64` images (issue #54).
Release-mode preflight and the Docker configuration job therefore fail, before
and after npm publication respectively, when `DOCKERHUB_IMAGE` is unset; a
skipped image job is never reported as a successful release.
`release-identity.json` records the policy it was checked against, and the
release audit rejects an identity without a `required` policy. Shipping without
images would need a reviewed change to that file, the identity collector, and
the audit, not a missing variable. Inspect a release with:

```bash
docker buildx imagetools inspect OWNER/IMAGE:VERSION
```

Docker builds check out the final `vVERSION` tag, not the pre-version workflow
event SHA. After npm, the GitHub Release, and both native manifests exist, the
workflow cross-checks their versions and digests against the exact retested
candidate. It uploads `release-identity.json` as a retained workflow artifact
and a GitHub Release asset. If Docker Hub publishing is not configured, the
release run fails instead of producing an identity without images.

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
