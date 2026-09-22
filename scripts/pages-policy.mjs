#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function evaluatePagesPolicy({
  apiStatus,
  buildType,
  eventName,
  required = false,
} = {}) {
  if (eventName === 'pull_request') {
    return { reason: 'pull-request-read-only', status: 'skipped' };
  }
  if (!required) {
    return { reason: 'deployment-optional', status: 'skipped' };
  }
  if (apiStatus === 200) {
    if (buildType !== 'workflow') {
      return {
        reason: 'pages-source-must-be-github-actions',
        status: 'failure',
      };
    }
    return { reason: 'pages-enabled', status: 'enabled' };
  }
  if (apiStatus === 403) {
    return { reason: 'token-cannot-read-pages-settings', status: 'failure' };
  }
  if (apiStatus === 409 || apiStatus === 422) {
    return { reason: 'pages-disabled-by-repository-policy', status: 'failure' };
  }
  return {
    reason: 'enable-pages-in-repository-settings',
    status: 'failure',
  };
}

function output(result) {
  for (const [key, value] of Object.entries(result)) {
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
    }
    console.log(`${key}=${value}`);
  }
}

async function main() {
  const required = process.env.PAGES_REQUIRED === 'true';
  const eventName = process.env.GITHUB_EVENT_NAME || 'local';
  if (eventName === 'pull_request' || !required) {
    output(evaluatePagesPolicy({ eventName, required }));
    return;
  }
  const response = await fetch(
    `${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}/pages`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${process.env.GITHUB_TOKEN || ''}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }
  );
  let settings = {};
  if (response.status === 200) {
    try {
      settings = await response.json();
    } catch {
      settings = {};
    }
  }
  const result = evaluatePagesPolicy({
    apiStatus: response.status,
    buildType: settings.build_type,
    eventName,
    required,
  });
  output(result);
  if (result.status === 'failure') {
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
