// Runs the app's real browser path against the local fixture page and prints
// the self-check result. Inside the container this reproduces #95:
//   docker run --rm --read-only --tmpfs /tmp:mode=1777 --cap-drop ALL \
//     --security-opt no-new-privileges:true --entrypoint node IMAGE \
//     bin/vietnam-accomodation-search.js self-check search
import { createApplication } from '../src/index.js';
import { checkBrowser, runFixtureSearch } from '../src/self-check.js';

console.log(await checkBrowser(createApplication()));
console.log(
  await runFixtureSearch({ createApplication, environment: process.env })
);
