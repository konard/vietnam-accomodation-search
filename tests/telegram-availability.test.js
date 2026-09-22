import { describe, expect, it } from 'test-anywhere';

import {
  TelegramAvailabilityService,
  createAvailabilityMessage,
} from '../src/index.js';
import { runCli } from '../bin/vietnam-accomodation-search.js';

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
        credentials: { apiHash: 'hash', apiId: '123', session: 'session' },
        offerId: 'offer-1',
        options: { recipient: '@owner' },
      },
    ]);
    expect(output[0]).toContain('Availability inquiry sent');
  });
});
