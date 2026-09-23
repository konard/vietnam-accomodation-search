#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TextDecoder, TextEncoder } from 'node:util';

import { DOMAIN_GRAPH_SCHEMA_VERSION } from '../src/domain-graph.js';
import { durableWrite } from '../src/link-cli-mirror.js';
import { RELEASE_AUDIT_SCHEMA_VERSION } from '../src/release-audit.js';
import { TRACE_SCHEMA_VERSION } from '../src/trace.js';

const PACKAGE_NAME = 'vietnam-accomodation-search';
const FULL_SHA = /^[\da-f]{40}$/u;
const SHA256 = /^sha256:[\da-f]{64}$/u;

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function parseArguments(values) {
  const result = {};
  const names = new Map([
    ['--candidate', 'candidate'],
    ['--image', 'image'],
    ['--installed-package', 'installedPackage'],
    ['--manifest', 'manifest'],
    ['--output', 'output'],
    ['--repository', 'repository'],
    ['--version', 'version'],
  ]);
  for (let index = 0; index < values.length; index += 1) {
    const property = names.get(values[index]);
    if (!property || !values[index + 1]) {
      throw new Error(`Unknown or incomplete option: ${values[index]}`);
    }
    result[property] = values[index + 1];
    index += 1;
  }
  for (const property of names.values()) {
    required(result[property], `--${property}`);
  }
  return result;
}

export function buildDockerIdentity({ image, rawManifest, version }) {
  const bytes =
    typeof rawManifest === 'string'
      ? new TextEncoder().encode(rawManifest)
      : rawManifest;
  const manifest = JSON.parse(new TextDecoder().decode(bytes));
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.manifests)) {
    throw new Error('Published image is not an OCI/Docker manifest index.');
  }
  const platforms = Object.fromEntries(
    manifest.manifests.map(({ digest, platform = {} }) => {
      const key = `${platform.os}/${platform.architecture}`;
      if (!SHA256.test(digest || '')) {
        throw new Error(`Invalid platform digest for ${key}.`);
      }
      return [key, { digest }];
    })
  );
  for (const platform of ['linux/amd64', 'linux/arm64']) {
    if (!platforms[platform]) {
      throw new Error(`Published manifest is missing ${platform}.`);
    }
  }
  return {
    image: required(image, 'Docker image'),
    version: required(version, 'Docker version'),
    manifestDigest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    platforms,
  };
}

// eslint-disable-next-line complexity -- Every external release surface must agree before an identity can be emitted.
export function buildReleaseIdentity({
  candidate,
  docker,
  githubRelease,
  installedPackage,
  npmMetadata,
  previousRelease,
  repository,
  runId,
  tagTargetSha,
}) {
  const version = required(candidate?.packageVersion, 'Candidate version');
  const tag = `v${version}`;
  const commitSha = required(candidate?.commitSha, 'Candidate commit SHA');
  if (!FULL_SHA.test(commitSha)) {
    throw new Error('Candidate commit SHA must be a full 40-character SHA.');
  }
  if (tagTargetSha !== commitSha) {
    throw new Error('Git tag target does not equal the tested candidate.');
  }
  if (githubRelease?.draft || githubRelease?.prerelease) {
    throw new Error('GitHub Release must be final and non-draft.');
  }
  if (githubRelease?.tag_name !== tag) {
    throw new Error('GitHub Release tag does not match the candidate version.');
  }
  if (
    npmMetadata?.name !== PACKAGE_NAME ||
    installedPackage?.name !== PACKAGE_NAME
  ) {
    throw new Error('Published or installed npm package name does not match.');
  }
  const versions = [
    npmMetadata?.version,
    installedPackage?.version,
    docker?.version,
  ];
  if (versions.some((observed) => observed !== version)) {
    throw new Error('Published artifact versions do not match the candidate.');
  }
  for (const runtime of ['node', 'bun', 'deno']) {
    required(candidate?.runtimes?.[runtime], `Tested ${runtime} version`);
  }
  for (const platform of ['linux/amd64', 'linux/arm64']) {
    if (!SHA256.test(docker?.platforms?.[platform]?.digest || '')) {
      throw new Error(`Docker evidence is missing ${platform}.`);
    }
  }
  if (!SHA256.test(docker?.manifestDigest || '')) {
    throw new Error('Docker manifest digest is invalid.');
  }
  const releaseUrl = required(githubRelease?.html_url, 'GitHub Release URL');
  const publishedAt = required(
    githubRelease?.published_at,
    'GitHub Release timestamp'
  );
  required(npmMetadata?.dist?.integrity, 'npm integrity');
  required(previousRelease?.tag || previousRelease?.kind, 'Release baseline');
  return {
    baseline: previousRelease,
    commitSha,
    collectedAt: new Date().toISOString(),
    docker,
    draft: false,
    package: {
      installedVersion: installedPackage.version,
      integrity: npmMetadata.dist.integrity,
      name: PACKAGE_NAME,
      ...(npmMetadata.dist.tarball
        ? { tarball: npmMetadata.dist.tarball }
        : {}),
      version,
    },
    prerelease: false,
    publishedAt,
    releaseUrl,
    runtimes: candidate.runtimes,
    schemas: {
      domainGraph: DOMAIN_GRAPH_SCHEMA_VERSION,
      linksNotation: 1,
      releaseAudit: RELEASE_AUDIT_SCHEMA_VERSION,
      trace: TRACE_SCHEMA_VERSION,
    },
    tag,
    tagTargetSha,
    workflowRunUrl: `https://github.com/${repository}/actions/runs/${runId}`,
  };
}

async function fetchJson(url, { token } = {}) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'User-Agent': PACKAGE_NAME,
    },
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function resolveTagTarget(repository, tag, token) {
  let object = (
    await fetchJson(
      `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(tag)}`,
      { token }
    )
  ).object;
  for (let depth = 0; object?.type === 'tag' && depth < 5; depth += 1) {
    object = (
      await fetchJson(
        `https://api.github.com/repos/${repository}/git/tags/${object.sha}`,
        { token }
      )
    ).object;
  }
  if (object?.type !== 'commit' || !FULL_SHA.test(object.sha || '')) {
    throw new Error('Release tag does not resolve to a full commit SHA.');
  }
  return object.sha;
}

function previousReleaseFrom(releases, tag) {
  const release = releases.find(
    (candidate) =>
      !candidate.draft && !candidate.prerelease && candidate.tag_name !== tag
  );
  return release
    ? { publishedAt: release.published_at, tag: release.tag_name }
    : { kind: 'first-release' };
}

export async function collectReleaseIdentity(
  values,
  environment = process.env
) {
  const options = parseArguments(values);
  const token = required(environment.GH_TOKEN, 'GH_TOKEN');
  const runId = required(environment.GITHUB_RUN_ID, 'GITHUB_RUN_ID');
  const tag = `v${options.version}`;
  const [candidate, installedPackage, rawManifest, githubRelease, releases] =
    await Promise.all([
      readFile(options.candidate, 'utf8').then(JSON.parse),
      readFile(options.installedPackage, 'utf8').then(JSON.parse),
      readFile(options.manifest),
      fetchJson(
        `https://api.github.com/repos/${options.repository}/releases/tags/${encodeURIComponent(tag)}`,
        { token }
      ),
      fetchJson(
        `https://api.github.com/repos/${options.repository}/releases?per_page=100`,
        { token }
      ),
    ]);
  const [npmMetadata, tagTargetSha] = await Promise.all([
    fetchJson(
      `https://registry.npmjs.org/${encodeURIComponent(PACKAGE_NAME)}/${encodeURIComponent(options.version)}`
    ),
    resolveTagTarget(options.repository, tag, token),
  ]);
  const docker = buildDockerIdentity({
    image: options.image,
    rawManifest,
    version: options.version,
  });
  const identity = buildReleaseIdentity({
    candidate,
    docker,
    githubRelease,
    installedPackage,
    npmMetadata,
    previousRelease: previousReleaseFrom(releases, tag),
    repository: options.repository,
    runId,
    tagTargetSha,
  });
  await durableWrite(options.output, `${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await collectReleaseIdentity(process.argv.slice(2));
}
