#!/usr/bin/env node

/**
 * Validate Docker Hub publish configuration against the committed OCI policy.
 *
 * .github/oci-policy.json records the accepted policy: every release
 * publishes linux/amd64 and linux/arm64 images, so an unset DOCKERHUB_IMAGE
 * fails the release and the image jobs are never skipped.
 * Set DOCKERHUB_IMAGE and provide:
 * - DOCKERHUB_USERNAME: Docker Hub account name
 * - DOCKERHUB_TOKEN: Docker Hub access token
 * - DOCKERFILE: Dockerfile path (optional, defaults to ./Dockerfile)
 * - DOCKER_CONTEXT: build context path (optional, defaults to .)
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CONTEXT = '.';
const DEFAULT_DOCKERFILE = './Dockerfile';
export const OCI_POLICY_FILE = '.github/oci-policy.json';

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasExplicitTag(image) {
  const lastSegment = image.split('/').at(-1) ?? '';
  return lastSegment.includes(':');
}

function normalizeRelativePath(value, fallback) {
  return clean(value) || fallback;
}

function fileExists(cwd, filePath) {
  return existsSync(path.resolve(cwd, filePath));
}

function directoryExists(cwd, directoryPath) {
  return existsSync(path.resolve(cwd, directoryPath));
}

// Only a required policy is supported: the release identity and audit both
// demand the published manifest and its per-platform digests.
export function readOciPolicy({
  cwd = process.cwd(),
  file = OCI_POLICY_FILE,
} = {}) {
  let policy;
  try {
    policy = JSON.parse(readFileSync(path.resolve(cwd, file), 'utf8'));
  } catch {
    policy = undefined;
  }
  const platforms = Array.isArray(policy?.platforms) ? policy.platforms : [];
  if (policy?.policy !== 'required' || platforms.length === 0) {
    throw new Error(
      `OCI policy is missing or invalid (${file}) -- only a committed required policy is supported`
    );
  }
  return { platforms, policy: policy.policy, registry: policy.registry };
}

export function evaluateDockerPublishConfig({
  cwd = process.cwd(),
  env = process.env,
  policyFile = OCI_POLICY_FILE,
} = {}) {
  const image = clean(env.DOCKERHUB_IMAGE);
  const username = clean(env.DOCKERHUB_USERNAME);
  const token = clean(env.DOCKERHUB_TOKEN);
  const context = normalizeRelativePath(env.DOCKER_CONTEXT, DEFAULT_CONTEXT);
  const dockerfile = normalizeRelativePath(env.DOCKERFILE, DEFAULT_DOCKERFILE);
  const errors = [];
  let policy;
  try {
    policy = readOciPolicy({ cwd, file: policyFile });
  } catch (error) {
    errors.push(error.message);
  }

  if (!image) {
    if (policy) {
      errors.push(
        `${policyFile} requires ${policy.platforms.join(' and ')} images, but DOCKERHUB_IMAGE is not set`
      );
    }
    return {
      context,
      dockerfile,
      enabled: false,
      errors,
      image,
      username,
    };
  }

  if (/\s/.test(image)) {
    errors.push('DOCKERHUB_IMAGE must not contain whitespace');
  }

  if (hasExplicitTag(image)) {
    errors.push(
      'DOCKERHUB_IMAGE must not include a tag; release tags are generated from npm'
    );
  }

  if (!username) {
    errors.push('DOCKERHUB_USERNAME is required when DOCKERHUB_IMAGE is set');
  }

  if (!token) {
    errors.push('DOCKERHUB_TOKEN is required when DOCKERHUB_IMAGE is set');
  }

  if (!directoryExists(cwd, context)) {
    errors.push(`Docker context does not exist: ${context}`);
  }

  if (!fileExists(cwd, dockerfile)) {
    errors.push(`Dockerfile does not exist: ${dockerfile}`);
  }

  return {
    context,
    dockerfile,
    enabled: errors.length === 0,
    errors,
    image,
    username,
  };
}

function setOutput(name, value, env = process.env) {
  const outputFile = env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${name}=${value}\n`);
  }
  console.log(`Output: ${name}=${value}`);
}

function isCliEntryPoint() {
  return (
    typeof process !== 'undefined' &&
    process.argv?.[1] &&
    fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
  );
}

export function main({ env = process.env, stderr = console.error } = {}) {
  const config = evaluateDockerPublishConfig({ env });

  setOutput('enabled', config.enabled ? 'true' : 'false', env);
  setOutput('context', config.context, env);
  setOutput('dockerfile', config.dockerfile, env);
  setOutput('image', config.image, env);

  if (config.errors.length > 0) {
    for (const error of config.errors) {
      stderr(`::error::${error}`);
    }
    return 1;
  }

  console.log(`Docker Hub publishing is enabled for ${config.image}`);
  return 0;
}

if (isCliEntryPoint()) {
  process.exitCode = main();
}
