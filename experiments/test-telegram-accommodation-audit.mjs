import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

import { describe, expect, it } from 'test-anywhere';

import {
  anonymizeListing,
  assertManualLocalRun,
  classifyAccommodationPost,
  expectedDetails,
  isNhaTrangSource,
  isTelegramCommunity,
  isTelegramPrivateDialog,
  missingExpectedDetails,
  parseDotEnv,
  telegramCredentials,
} from './telegram-accommodation-audit-lib.mjs';

describe('Telegram accommodation audit helpers', () => {
  it('refuses to start the real-data E2E audit in CI/CD', () => {
    expect(() => assertManualLocalRun({ CI: 'true' })).toThrow(
      /manual\/local/iu
    );
    expect(() => assertManualLocalRun({})).not.toThrow();
  });

  it('keeps a multilingual, anonymized parser conformance corpus', async () => {
    const fixtures = JSON.parse(
      await readFile(
        new URL(
          './fixtures/telegram-accommodation-parser-cases.json',
          import.meta.url
        ),
        'utf8'
      )
    );
    expect(new Set(fixtures.map(({ id }) => id)).size).toBe(fixtures.length);
    expect(new Set(fixtures.map(({ language }) => language))).toEqual(
      new Set(['en', 'ru', 'vi'])
    );
    expect(fixtures.some(({ expected }) => expected.relevant === true)).toBe(
      true
    );
    expect(fixtures.some(({ expected }) => expected.relevant === false)).toBe(
      true
    );
    expect(JSON.stringify(fixtures)).not.toMatch(
      /https?:\/\/t\.me\/|\+\d{8,}|@[A-Za-z][A-Za-z\d_]{4,31}/u
    );
  });

  it('loads both supported user credential naming conventions', () => {
    const current = telegramCredentials(
      parseDotEnv(
        'TELEGRAM_API_ID=123\nTELEGRAM_API_HASH=hash\n' +
          'TELEGRAM_USER_SESSION=session\nTELEGRAM_BOT_TOKEN=bot'
      )
    );
    const reference = telegramCredentials(
      parseDotEnv(
        'TELEGRAM_USER_BOT_API_ID=123\n' +
          'TELEGRAM_USER_BOT_API_HASH=hash\nTELEGRAM_USER_SESSION=session'
      )
    );
    expect(current).toEqual({
      apiHash: 'hash',
      apiId: 123,
      botToken: 'bot',
      session: 'session',
    });
    expect(reference.apiId).toBe(123);
    expect(reference.apiHash).toBe('hash');
  });

  it('separates offers, requests, and unrelated posts', () => {
    expect(
      classifyAccommodationPost('Сдается квартира, 12 млн VND в месяц').relevant
    ).toBe(true);
    expect(
      classifyAccommodationPost('Ищу квартиру в Нячанге до 12 млн VND').relevant
    ).toBe(false);
    expect(classifyAccommodationPost('Экскурсия завтра').relevant).toBe(false);
  });

  it('detects multilingual Nha Trang names and expected listing details', () => {
    expect(isNhaTrangSource('Нячанг жильё')).toBe(true);
    expect(isNhaTrangSource('Nha Trang Apartment Rental')).toBe(true);
    expect(
      expectedDetails('2 bedrooms, 1 bathroom, 70 m², USD 500, pets allowed')
    ).toEqual(['price', 'bedrooms', 'bathrooms', 'areaM2', 'petsAllowed']);
  });

  it('accepts Telegram communities and rejects private user dialogs', () => {
    expect(isTelegramCommunity({ className: 'Channel' })).toBe(true);
    expect(isTelegramCommunity({ className: 'Chat' })).toBe(true);
    expect(isTelegramCommunity({ className: 'User' })).toBe(false);
    expect(isTelegramCommunity()).toBe(false);
    expect(isTelegramPrivateDialog({ className: 'User' })).toBe(true);
    expect(isTelegramPrivateDialog({ className: 'UserEmpty' })).toBe(true);
    expect(isTelegramPrivateDialog({ className: 'Channel' })).toBe(false);
  });

  it('compares independent signals with parsed fields', () => {
    expect(
      missingExpectedDetails(
        { attributes: { bedrooms: 2 }, price: { amount: 12_000_000 } },
        '2 bedrooms, 1 bathroom, 12 million VND'
      )
    ).toEqual(['bathrooms']);
  });

  it('redacts contact, address, identifiers, and URLs from examples', () => {
    const redacted = anonymizeListing(
      'ID HOME-42\nAddress: 12 Beach Street\nContact @owner +84 123 456 789\nhttps://example.com'
    );
    expect(redacted).not.toContain('HOME-42');
    expect(redacted).not.toContain('Beach Street');
    expect(redacted).not.toContain('@owner');
    expect(redacted).not.toContain('123 456');
    expect(redacted).not.toContain('example.com');
  });
});
