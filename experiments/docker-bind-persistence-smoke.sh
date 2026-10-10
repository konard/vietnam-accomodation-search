#!/usr/bin/env bash
set -euo pipefail

# Synthetic manual smoke test: write in one short-lived container, remove it,
# and read the same canonical record from a second container on a host bind.

image="${1:-vac-pr67-local:0.12.3}"
state="$(mktemp -d "$PWD/.vietnam-accomodation-search/docker-bind-smoke.XXXXXX")"
chmod 700 "$state"
container="vac-qa-$(basename "$state")"
cleanup() {
  result=$?
  # Only the exact name and directory minted by this run may be removed.
  if docker container inspect "$container" >/dev/null 2>&1; then
    docker rm -f "$container" >/dev/null || result=1
  fi
  case "$state" in
    "$PWD"/.vietnam-accomodation-search/docker-bind-smoke.*) rm -rf -- "$state" ;;
    *) result=1 ;;
  esac
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker run --rm --pull=never --name "$container" \
  --mount "type=bind,src=$state,dst=/data" \
  --entrypoint node "$image" --input-type=module -e '
    import { LinksStore } from "./src/index.js";
    const store = new LinksStore({ directory: "/data" });
    await store.saveOffers([{ id: "synthetic-persisted-offer", title: "Synthetic" }]);
    console.log("write-ok");
  '

docker run --rm --pull=never --name "$container" \
  --mount "type=bind,src=$state,dst=/data" \
  --entrypoint node "$image" --input-type=module -e '
    import { LinksStore } from "./src/index.js";
    const store = new LinksStore({ directory: "/data" });
    const offers = await store.listOffers();
    if (offers.length !== 1 || offers[0].id !== "synthetic-persisted-offer") {
      throw new Error("host-bind persistence failed");
    }
    console.log("read-after-remove-ok");
  '

printf 'owned bind-state cleanup registered\n'
