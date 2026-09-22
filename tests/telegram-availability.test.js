import { describe, expect, it } from 'test-anywhere';

import {
  TelegramAvailabilityService,
  createAvailabilityMessage,
} from '../src/index.js';
import { runCli } from '../bin/vietnam-accomodation-search.js';

async function capturedFailure(operation) {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

describe('Telegram user-session availability checks', () => {
  it('contacts a parsed owner and closes the MTProto client', async () => {
    const events = [];
    let clientOptions;
    const service = new TelegramAvailabilityService({
      apiHash: 'api-hash',
      apiId: '12345',
      clientFactory: async (options) => {
        clientOptions = options;
        return {
          destroy: async () => events.push('destroy'),
          sendText: async (recipient, message) => {
            events.push({ message, recipient });
            return { id: 99 };
          },
          start: async (options) => events.push({ start: options }),
        };
      },
      now: () => new Date('2026-09-21T12:00:00Z'),
      session: 'secret-user-session',
      store: {
        listOffers: async () => [
          {
            contacts: { telegram: ['rental_owner'] },
            id: 'telegram:listing:1',
            title: 'Sea-view studio',
            url: 'https://t.me/rentals/1',
          },
        ],
      },
    });

    const result = await service.check('telegram:listing:1');

    expect(clientOptions).toEqual({ apiHash: 'api-hash', apiId: 12345 });
    expect(events[0]).toEqual({ start: { session: 'secret-user-session' } });
    expect(events[1].recipient).toBe('@rental_owner');
    expect(events[1].message).toContain('Sea-view studio');
    expect(events[2]).toBe('destroy');
    expect(result).toEqual({
      messageId: 99,
      offerId: 'telegram:listing:1',
      recipient: '@rental_owner',
      sentAt: '2026-09-21T12:00:00.000Z',
    });
  });

  it('accepts an explicit recipient without leaking the session', async () => {
    const recipients = [];
    const service = new TelegramAvailabilityService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {},
        sendText: async (recipient) => {
          recipients.push(recipient);
          return {};
        },
        start: async () => {},
      }),
      session: 'session',
      store: {
        listOffers: async () => [{ id: 'offer', title: 'Room' }],
      },
    });

    await service.check('offer', { recipient: '@chosen_owner' });

    expect(recipients).toEqual(['@chosen_owner']);
  });

  it('preserves both an MTProto send failure and its cleanup failure', async () => {
    const sendFailure = new Error('send failed');
    const cleanupFailure = new Error('destroy failed');
    const service = new TelegramAvailabilityService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {
          throw cleanupFailure;
        },
        sendText: async () => {
          throw sendFailure;
        },
        start: async () => {},
      }),
      session: 'session',
      store: {
        listOffers: async () => [
          {
            contacts: { telegram: ['owner_name'] },
            id: 'offer',
            title: 'Room',
          },
        ],
      },
    });

    const error = await capturedFailure(() => service.check('offer'));
    expect(error instanceof AggregateError).toBe(true);
    expect(error.errors).toEqual([sendFailure, cleanupFailure]);

    const sendOnly = new TelegramAvailabilityService({
      apiHash: 'hash',
      apiId: 1,
      clientFactory: async () => ({
        destroy: async () => {},
        sendText: async () => {
          throw sendFailure;
        },
        start: async () => {},
      }),
      session: 'session',
      store: {
        listOffers: async () => [
          {
            contacts: { telegram: ['owner_name'] },
            id: 'offer',
            title: 'Room',
          },
        ],
      },
    });
    expect(await capturedFailure(() => sendOnly.check('offer'))).toBe(
      sendFailure
    );
  });

  it('uses the capability router with a persisted idempotency key', async () => {
    const calls = [];
    let destroyed = 0;
    const service = new TelegramAvailabilityService({
      router: {
        destroy: async () => {
          destroyed += 1;
        },
        send: async (...arguments_) => {
          calls.push(arguments_);
          return { id: 77 };
        },
      },
      store: {
        listOffers: async () => [
          {
            contacts: { telegram: ['owner_name'] },
            id: 'offer-7',
            title: 'Room',
          },
        ],
      },
    });

    expect((await service.check('offer-7')).messageId).toBe(77);
    expect(calls[0][0]).toBe('@owner_name');
    expect(calls[0][2].idempotencyKey).toBe('availability:offer-7:@owner_name');
    await service.destroy();
    expect(destroyed).toBe(1);
  });

  it('rejects missing credentials or contacts before opening a client', async () => {
    let factories = 0;
    const service = new TelegramAvailabilityService({
      clientFactory: async () => {
        factories += 1;
      },
      store: { listOffers: async () => [{ id: 'offer', title: 'Room' }] },
    });

    let error;
    try {
      await service.check('offer');
    } catch (caught) {
      error = caught;
    }
    expect(error.message).toContain('Telegram user credentials');
    expect(factories).toBe(0);
  });

  it('builds a bounded plain-text inquiry', () => {
    const message = createAvailabilityMessage({
      title: 'A'.repeat(5_000),
      url: 'https://t.me/rentals/1',
    });

    expect(message.length <= 1_000).toBe(true);
    expect(message).toContain('still available');
  });

  it('passes user-session credentials through the explicit CLI command', async () => {
    const calls = [];
    const output = [];
    const application = {
      createAvailabilityService: (credentials) => ({
        check: async (offerId, options) => {
          calls.push({ credentials, offerId, options });
          return { offerId, recipient: '@owner' };
        },
      }),
    };

    const status = await runCli(['check-availability', 'offer-1', '@owner'], {
      application,
      env: {
        TELEGRAM_API_HASH: 'hash',
        TELEGRAM_API_ID: '123',
        TELEGRAM_USER_SESSION: 'session',
      },
      stdout: (line) => output.push(line),
    });

    expect(status).toBe(0);
    expect(calls).toEqual([
      {
        credentials: {
          apiHash: 'hash',
          apiId: '123',
          session: 'session',
          sessionFormat: 'mtcute/session-string-v1',
        },
        offerId: 'offer-1',
        options: { recipient: '@owner' },
      },
    ]);
    expect(output[0]).toContain('Availability inquiry sent');
  });
});
