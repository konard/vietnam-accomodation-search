#!/usr/bin/env bash
set -euo pipefail

# Synthetic manual smoke test: write in one short-lived container, remove it,
# and read the same canonical record from a second container on a host bind.

image="${1:-vac-pr67-local:0.12.3}"
state="$(mktemp -d "$PWD/.vietnam-accomodation-search/docker-bind-smoke.XXXXXX")"
chmod 700 "$state"

docker run --rm \
  --mount "type=bind,src=$state,dst=/data" \
  --entrypoint node "$image" --input-type=module -e '
    import { LinksStore } from "./src/index.js";
    const store = new LinksStore({ directory: "/data" });
    await store.saveOffers([{ id: "synthetic-persisted-offer", title: "Synthetic" }]);
    console.log("write-ok");
  '

docker run --rm \
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

printf 'state=%s\n' "$state"
