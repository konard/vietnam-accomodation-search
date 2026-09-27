import { describe, expect, it } from 'test-anywhere';

import {
  probeAvailability,
  summarizeSamples,
} from '../experiments/measure-deploy-handoff.mjs';

describe('manual deploy handoff probe', () => {
  it('reports a bounded observed outage on each independent channel', () => {
    expect(
      summarizeSamples([
        { atMs: 0, ready: true, botApiGetMe: true },
        { atMs: 100, ready: false, botApiGetMe: true },
        { atMs: 200, ready: false, botApiGetMe: false },
        { atMs: 300, ready: true, botApiGetMe: true },
      ])
    ).toEqual({
      samples: 4,
      ready: { passed: 2, failed: 2, longestObservedOutageMs: 300 },
      botApiGetMe: {
        passed: 3,
        failed: 1,
        longestObservedOutageMs: 200,
      },
    });
  });

  it('classifies failed fetches without exposing the token in the result', async () => {
    const token = 'private-token-for-test';
    const calls = [];
    const result = await probeAvailability({
      fetchImpl: async (url) => {
        calls.push(url);
        if (url.includes('/getMe')) {
          throw new Error(`Fetch failed for ${url}`);
        }
        return { ok: true };
      },
      readyUrl: 'http://127.0.0.1:8080/ready',
      token,
    });
    expect(calls.length).toBe(2);
    expect(result).toEqual({ ready: true, botApiGetMe: false });
    expect(JSON.stringify(result)).not.toContain(token);
  });
});
