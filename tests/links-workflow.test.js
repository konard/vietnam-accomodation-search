import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'test-anywhere';

const workflow = readFileSync('.github/workflows/links.yml', 'utf8').replaceAll(
  '\r\n',
  '\n'
);

function getStepBlock(stepName) {
  const lines = workflow.split('\n');
  const header = `      - name: ${stepName}`;
  const start = lines.findIndex((line) => line === header);

  if (start === -1) {
    return '';
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith('      - ')
  );

  return lines.slice(start, end === -1 ? lines.length : end).join('\n');
}

describe('broken link workflow', () => {
  it('checks GitHub file contents at the same revision without the HTML renderer', () => {
    const checker = getStepBlock('Check links with lychee');
    const rule = checker.match(/--remap '([^ ]+) ([^']+)'/);

    expect(Boolean(rule)).toBe(true);
    const pattern = new RegExp(rule[1]);
    const replacement = rule[2];
    const revision = '49dcb1830094e8e7e14d40978c4974ab54dd4fcf';

    for (const [repository, ref, file] of [
      [
        'konard/vietnam-accomodation-search',
        revision,
        'src/application.js#L34-L59',
      ],
      ['changesets/changesets', 'main', 'docs/command-line-options.md'],
      ['owner/repo', 'feature/paging', 'docs/a%20file.md'],
      ['owner/repo', 'main', 'missing-file.md'],
    ]) {
      const url = `https://github.com/${repository}/blob/${ref}/${file}`;
      expect(url.replace(pattern, replacement)).toBe(
        `https://raw.githubusercontent.com/${repository}/${ref}/${file}`
      );
    }

    for (const url of [
      'https://github.com/owner/repo/issues/195',
      'https://github.com/owner/repo/tree/main',
      'https://github.com/owner/repo/blob/main',
      'https://github.com/user-attachments/assets/image.png',
      'https://github.com.example.com/owner/repo/blob/main/file.md',
      'https://example.com/github.com/owner/repo/blob/main/file.md',
    ]) {
      expect(url.replace(pattern, replacement)).toBe(url);
    }
  });

  it('limits concurrent requests while retaining strict HTTP status checks', () => {
    const checker = getStepBlock('Check links with lychee');
    expect(checker).toContain('--max-concurrency 4');
    expect(checker).toContain('--retry-wait-time 5');
    expect(checker).toContain('--method head');
    expect(checker).not.toContain('--accept');
  });
  it('fails for every nonzero Lychee exit even when an archive exists', () => {
    const failureStep = getStepBlock('Fail if broken links were found');

    expect(failureStep).toContain('!cancelled()');
    expect(failureStep).toContain('steps.lychee.outputs.exit_code != 0');
    expect(failureStep).not.toContain('steps.webarchive.outputs.all_archived');
    expect(failureStep).toContain(
      'An archive is a suggested replacement; it does not make the live link valid.'
    );
  });

  it('re-asks the links that never got an answer before giving up', () => {
    const recheckStep = getStepBlock('Re-check links that never got an answer');

    expect(recheckStep).toContain('id: recheck');
    expect(recheckStep).toContain('node scripts/recheck-broken-links.mjs');
    expect(recheckStep).toContain('if: steps.lychee.outputs.exit_code != 0');
    expect(recheckStep).toContain('LYCHEE_OUTPUT: lychee/out.md');
    expect(recheckStep).toContain('RECOVERED_OUTPUT: lychee/recovered.txt');
  });

  // `== 'false'` would read a skipped or crashed re-check as "nothing was
  // recovered" and skip the failure step on an empty output. Only the
  // negated form fails safe.
  it('downgrades a failure only when every unanswered link recovered', () => {
    const webarchiveStep = getStepBlock(
      'Check broken links against Web Archive'
    );
    const failureStep = getStepBlock('Fail if broken links were found');

    for (const step of [webarchiveStep, failureStep]) {
      expect(step).toContain("steps.recheck.outputs.all_recovered != 'true'");
      expect(step).not.toMatch(/all_recovered\s*==\s*'false'/);
    }
  });

  it('feeds the recovered list to the Web Archive check', () => {
    const webarchiveStep = getStepBlock(
      'Check broken links against Web Archive'
    );

    expect(webarchiveStep).toContain('RECOVERED_URLS: lychee/recovered.txt');
  });

  // The checker, the archive fallback, and the re-check run from files the
  // paths filters must name; otherwise editing them silently skips the link
  // check on the pull request that changed them.
  it('triggers on changes to every file the check depends on', () => {
    const expected = [
      '.lycheeignore',
      'scripts/check-web-archive.mjs',
      'scripts/recheck-broken-links.mjs',
      'tests/fixtures/lychee-report.md',
      'tests/links-workflow.test.js',
      'tests/recheck-broken-links.test.js',
    ];

    for (const trigger of ['push', 'pull_request']) {
      const triggerBlock = workflow.match(
        new RegExp(
          `^  ${trigger}:\\n(?:    .*\\n)*?    paths:\\n((?:      .*\\n)+)`,
          'm'
        )
      );

      expect(Boolean(triggerBlock)).toBe(true);

      for (const path of expected) {
        expect(triggerBlock[1]).toContain(`- '${path}'`);
      }
    }
  });
});
