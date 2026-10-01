#!/usr/bin/env bash
# Run experiments/issue75-desktop-smoke.mjs with the Chromium SUID sandbox
# enabled on a host without sudo. CI does the same on a GitHub runner VM by
# chowning chrome-sandbox to root with mode 4755.
#
# The seccomp/SYS_ADMIN relaxation applies only to this disposable test
# container: Docker's default profile blocks the PID/network namespaces the
# SUID helper creates, which a runner VM allows. The packaged app keeps
# sandbox, contextIsolation, and nodeIntegration=false; the smoke asserts it.
#
# Prerequisites: npm ci, npm run example:desktop:package, and a local image
# built from the repository Dockerfile (default tag below).
set -euo pipefail
image="${1:-vas-deps-trixie:test}"
docker run --rm -u root --security-opt seccomp=unconfined --cap-add SYS_ADMIN \
  --entrypoint bash -v "$PWD:/repo:ro" "$image" -c '
set -euo pipefail
apt-get update -qq >/dev/null
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  libgtk-3-0t64 libasound2t64 libnss3 libgbm1 xauth >/dev/null
mkdir -p /work/examples/universal-app
cp -a /repo/examples/universal-app/out /work/examples/universal-app/out
cp -a /repo/experiments /repo/node_modules /repo/package.json /work/
chown -R node:node /work
sandbox=/work/examples/universal-app/out/linux-unpacked/chrome-sandbox
chown root:root "$sandbox"
chmod 4755 "$sandbox"
su node -s /bin/bash -c "cd /work && xvfb-run -a node experiments/issue75-desktop-smoke.mjs"
'
