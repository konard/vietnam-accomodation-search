import { TextEncoder } from 'node:util';

import { describe, expect, it } from 'test-anywhere';

import {
  buildDockerIdentity,
  buildReleaseIdentity,
} from '../scripts/collect-release-identity.mjs';
import { createCandidateEvidence } from '../scripts/record-release-candidate.mjs';

const sha = (character) => `sha256:${character.repeat(64)}`;

describe('immutable release identity collection', () => {
  it('records exact runtime versions against the tested commit', () => {
    const commands = new Map([
      ['git status --porcelain', ''],
      ['git rev-parse HEAD', 'e'.repeat(40)],
      ['node --version', 'v24.9.0'],
      ['bun --version', '1.2.23'],
      ['deno --version', 'deno 2.5.2\nv8 14.0'],
    ]);
    const candidate = createCandidateEvidence({
      now: () => new Date('2026-09-23T12:00:00Z'),
      packageJson: { version: '1.2.3' },
      runCommand: (command, arguments_) =>
        commands.get(`${command} ${arguments_.join(' ')}`),
    });

    expect(candidate.commitSha).toBe('e'.repeat(40));
    expect(candidate.packageVersion).toBe('1.2.3');
    expect(candidate.runtimes).toEqual({
      bun: '1.2.23',
      deno: '2.5.2',
      node: 'v24.9.0',
    });
  });

  it('derives the manifest and both native platform digests from raw OCI bytes', () => {
    const rawManifest = new TextEncoder().encode(
      JSON.stringify({
        manifests: [
          {
            digest: sha('a'),
            platform: { architecture: 'amd64', os: 'linux' },
          },
          {
            digest: sha('b'),
            platform: { architecture: 'arm64', os: 'linux' },
          },
        ],
        mediaType: 'application/vnd.oci.image.index.v1+json',
        schemaVersion: 2,
      })
    );

    const identity = buildDockerIdentity({
      image: 'owner/image',
      rawManifest,
      version: '1.2.3',
    });

    expect(identity.manifestDigest).toMatch(/^sha256:[\da-f]{64}$/u);
    expect(identity.platforms['linux/amd64'].digest).toBe(sha('a'));
    expect(identity.platforms['linux/arm64'].digest).toBe(sha('b'));
  });

  it('joins authoritative GitHub, npm, candidate, and image facts', () => {
    const commitSha = 'c'.repeat(40);
    const identity = buildReleaseIdentity({
      candidate: {
        commitSha,
        packageVersion: '1.2.3',
        runtimes: { bun: '1.2.23', deno: '2.5.2', node: 'v24.9.0' },
      },
      docker: {
        image: 'owner/image',
        manifestDigest: sha('d'),
        platforms: {
          'linux/amd64': { digest: sha('a') },
          'linux/arm64': { digest: sha('b') },
        },
        version: '1.2.3',
      },
      githubRelease: {
        draft: false,
        html_url: 'https://github.com/owner/repo/releases/tag/v1.2.3',
        prerelease: false,
        published_at: '2026-09-23T00:00:00Z',
        tag_name: 'v1.2.3',
      },
      installedPackage: {
        name: 'vietnam-accomodation-search',
        version: '1.2.3',
      },
      npmMetadata: {
        dist: { integrity: 'sha512-Zml4dHVyZQ==' },
        name: 'vietnam-accomodation-search',
        version: '1.2.3',
      },
      previousRelease: { tag: 'v1.2.2' },
      repository: 'owner/repo',
      runId: '42',
      tagTargetSha: commitSha,
    });

    expect(identity.commitSha).toBe(commitSha);
    expect(identity.tagTargetSha).toBe(commitSha);
    expect(identity.package.installedVersion).toBe('1.2.3');
    expect(identity.docker.version).toBe('1.2.3');
    expect(identity.schemas.releaseAudit).toBe(2);
    expect(identity.workflowRunUrl).toBe(
      'https://github.com/owner/repo/actions/runs/42'
    );
  });

  it('rejects a tag that does not point at the exact tested candidate', () => {
    expect(() =>
      buildReleaseIdentity({
        candidate: {
          commitSha: 'a'.repeat(40),
          packageVersion: '1.0.0',
          runtimes: { bun: '1', deno: '2', node: '3' },
        },
        docker: {
          image: 'owner/image',
          manifestDigest: sha('d'),
          platforms: {
            'linux/amd64': { digest: sha('a') },
            'linux/arm64': { digest: sha('b') },
          },
          version: '1.0.0',
        },
        githubRelease: {
          draft: false,
          html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
          prerelease: false,
          published_at: '2026-09-23T00:00:00Z',
          tag_name: 'v1.0.0',
        },
        installedPackage: {
          name: 'vietnam-accomodation-search',
          version: '1.0.0',
        },
        npmMetadata: {
          dist: { integrity: 'sha512-Zml4dHVyZQ==' },
          name: 'vietnam-accomodation-search',
          version: '1.0.0',
        },
        previousRelease: { kind: 'first-release' },
        repository: 'owner/repo',
        runId: '42',
        tagTargetSha: 'b'.repeat(40),
      })
    ).toThrow(/tag target does not equal the tested candidate/u);
  });
});
