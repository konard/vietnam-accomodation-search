import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'test-anywhere';

import { evaluatePagesPolicy } from '../scripts/pages-policy.mjs';

const workflow = readFileSync(
  '.github/workflows/example-app.yml',
  'utf8'
).replaceAll('\r\n', '\n');

function job(name) {
  const start = workflow.indexOf(`  ${name}:\n`);
  const rest = workflow.slice(start + 1);
  const length = rest.search(/\n {2}[a-zA-Z0-9_-]+:\n/u);
  return workflow.slice(
    start,
    length < 0 ? workflow.length : start + 1 + length
  );
}

describe('GitHub Pages workflow policy', () => {
  it('runs the read-only policy before every expensive example job', () => {
    expect(job('pages-policy')).toContain('      pages: read');
    expect(job('pages-policy')).not.toContain('pages: write');
    for (const name of [
      'web-build',
      'desktop-package',
      'android-build',
      'ios-build',
      'preview-regen',
    ]) {
      expect(job(name)).toContain('needs: [pages-policy]');
    }
  });

  it('keeps build artifacts visible when optional and deploys only after enablement', () => {
    expect(job('web-build')).toContain('name: universal-example-web');
    expect(job('pages-deploy')).toContain(
      "if: needs.pages-policy.outputs.deploy == 'true'"
    );
    expect(job('pages-deploy')).toContain('      pages: write');
    expect(job('pipeline-status')).toContain('      - pages-policy');
  });

  it('covers enabled, missing, denied, policy-disabled, pull-request, and optional states', () => {
    expect(
      evaluatePagesPolicy({
        apiStatus: 200,
        buildType: 'workflow',
        eventName: 'push',
        required: true,
      })
    ).toEqual({ reason: 'pages-enabled', status: 'enabled' });
    expect(
      evaluatePagesPolicy({
        apiStatus: 200,
        buildType: 'legacy',
        eventName: 'push',
        required: true,
      })
    ).toEqual({
      reason: 'pages-source-must-be-github-actions',
      status: 'failure',
    });
    expect(
      evaluatePagesPolicy({ apiStatus: 404, eventName: 'push', required: true })
    ).toEqual({
      reason: 'enable-pages-in-repository-settings',
      status: 'failure',
    });
    expect(
      evaluatePagesPolicy({ apiStatus: 403, eventName: 'push', required: true })
    ).toEqual({
      reason: 'token-cannot-read-pages-settings',
      status: 'failure',
    });
    expect(
      evaluatePagesPolicy({ apiStatus: 409, eventName: 'push', required: true })
    ).toEqual({
      reason: 'pages-disabled-by-repository-policy',
      status: 'failure',
    });
    expect(
      evaluatePagesPolicy({ eventName: 'pull_request', required: true })
    ).toEqual({ reason: 'pull-request-read-only', status: 'skipped' });
    expect(evaluatePagesPolicy({ eventName: 'push', required: false })).toEqual(
      { reason: 'deployment-optional', status: 'skipped' }
    );
  });

  it('becomes deploy-enabled after the documented administrator enablement', () => {
    expect(
      evaluatePagesPolicy({ apiStatus: 404, eventName: 'push', required: true })
        .status
    ).toBe('failure');
    expect(
      evaluatePagesPolicy({
        apiStatus: 200,
        buildType: 'workflow',
        eventName: 'push',
        required: true,
      }).status
    ).toBe('enabled');
  });
});
