import { describe, expect, it } from 'test-anywhere';

import {
  assertConversationBoundary,
  formatFailureTranscript,
  isE2ELeftoverMessage,
  isFailureReply,
  parseConversationArguments,
  withDeadline,
} from './telegram-bot-conversation-e2e.mjs';

describe('manual Telegram bot conversation E2E boundary', () => {
  it('parses isolated bot-only and combined-mode configuration', () => {
    expect(
      parseConversationArguments([
        '--bot-env',
        '.env.bot',
        '--user-env',
        '.env.user',
      ])
    ).toEqual({
      botEnv: '.env.bot',
      cleanupOnly: false,
      keepData: false,
      mode: 'bot-only',
      timeoutMs: 60_000,
      userEnv: '.env.user',
    });
    const combined = parseConversationArguments([
      '--bot-env',
      '.env.bot',
      '--user-env',
      '.env.driver',
      '--mode',
      'both',
      '--runtime-user-env',
      '.env.mtcute',
    ]);
    expect(combined.mode).toBe('both');
    expect(combined.runtimeUserEnv).toBe('.env.mtcute');
    expect(
      parseConversationArguments([
        '--bot-env',
        '.env.bot',
        '--user-env',
        '.env.user',
        '--cleanup-leftovers-only',
      ]).cleanupOnly
    ).toBe(true);
  });

  it('requires explicit authorization and refuses CI or a competing poller', () => {
    expect(() => assertConversationBoundary({ CI: 'true' })).toThrow(
      /manual\/local/iu
    );
    expect(() =>
      assertConversationBoundary(
        { TELEGRAM_CONVERSATION_E2E: '1' },
        { nodeVersion: '20.0.0' }
      )
    ).toThrow(/Node\.js 22/iu);
    expect(() =>
      assertConversationBoundary({
        TELEGRAM_BOT_POLLER_ACTIVE: '1',
        TELEGRAM_CONVERSATION_E2E: '1',
      })
    ).toThrow(/competing/iu);
  });

  it('rejects incomplete, unsafe, or unbounded options before networking', () => {
    expect(() => parseConversationArguments([])).toThrow(/required/iu);
    expect(() =>
      parseConversationArguments([
        '--bot-env',
        '.env.bot',
        '--user-env',
        '.env.user',
        '--mode',
        'both',
      ])
    ).toThrow(/runtime-user-env/iu);
    expect(() =>
      parseConversationArguments([
        '--bot-env',
        '.env.bot',
        '--user-env',
        '.env.user',
        '--timeout-ms',
        '1',
      ])
    ).toThrow(/between/iu);
  });

  it('bounds a stalled driver operation with an actionable stage', async () => {
    let failure;
    try {
      await withDeadline(() => new Promise(() => {}), 5, 'offline probe');
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toBe('Timed out during offline probe.');
  });

  it('fails on bot error replies and recognizes only explicit E2E leftovers', () => {
    expect(
      isFailureReply(
        'clink export verification failed\nUsage: /search [location]'
      )
    ).toBe(true);
    expect(isFailureReply('Subscribed to preset e2e-0123456789.')).toBe(false);
    expect(isE2ELeftoverMessage('/preset use e2e-0123456789')).toBe(true);
    expect(
      isE2ELeftoverMessage(
        'clink export verification failed\nUsage: /search [location]'
      )
    ).toBe(true);
    expect(isE2ELeftoverMessage('/search Nha Trang')).toBe(false);
  });

  it('retains failed replies in a secret-redacted local transcript', () => {
    const transcript = formatFailureTranscript(
      [
        { id: 1, message: '/search Nha Trang', out: true },
        {
          id: 2,
          message:
            'clink failed with 123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi_123456',
          out: false,
        },
      ],
      'bot error reply'
    );
    expect(transcript).toContain('test-user: /search Nha Trang');
    expect(transcript).toContain('bot: clink failed with [REDACTED_TOKEN]');
    expect(transcript).not.toContain('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
  });
});
