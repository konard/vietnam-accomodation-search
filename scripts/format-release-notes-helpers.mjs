import { URL } from 'node:url';
import { normalizeReleaseVersion } from './release-naming.mjs';

export function normalizeReleaseVersionForBadge(releaseVersion) {
  return normalizeReleaseVersion(releaseVersion);
}

export function encodeShieldsStaticBadgeSegment(value) {
  return encodeURIComponent(value).replace(/-/g, '--').replace(/_/g, '__');
}

export function buildNpmVersionBadge(packageName, releaseVersion) {
  const versionWithoutV = normalizeReleaseVersionForBadge(releaseVersion);
  const badgeVersion = encodeShieldsStaticBadgeSegment(versionWithoutV);
  const packageVersionPath = encodeURIComponent(versionWithoutV);

  return `[![npm version](https://img.shields.io/badge/npm-${badgeVersion}-blue.svg)](https://www.npmjs.com/package/${packageName}/v/${packageVersionPath})`;
}

const URL_PATTERN = /https?:\/\/[^\s)"'<>\]]+/giu;

export function hasShieldsBadge(body) {
  return (String(body || '').match(URL_PATTERN) || []).some((candidate) => {
    try {
      return new URL(candidate).hostname === 'img.shields.io';
    } catch {
      return false;
    }
  });
}
