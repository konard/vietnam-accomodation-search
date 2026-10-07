import { describe, expect, it } from 'test-anywhere';
import {
  parseTelegramOffer,
  reconcileTelegramMaterials,
} from '../src/index.js';

const now = new Date('2026-10-07T00:00:00Z');
const poster =
  'Свободно: с 01/10/26\nЛокация: Центр Нячанга\nСтудия\n35 м2\nЦена: 13 млн VND / месяц.';
const photo = {
  id: 1,
  chatId: 'qa-144',
  date: now,
  text: '',
  mediaId: 'photo',
};
const reconcile = (text) =>
  reconcileTelegramMaterials([photo], {
    ocr: async () => ({
      text,
      status: 'extracted',
      engine: 'reviewed-control',
    }),
    extract: (material) =>
      parseTelegramOffer({ ...material, photos: material.mediaIds }, { now }),
  });

describe('captionless poster rental evidence (#129)', () => {
  it('accepts a monthly housing price without a rental verb and retains provisional review', async () => {
    const result = await reconcile(poster);
    expect(result.accepted.length).toBe(1);
    expect(result.accepted[0].priceVnd).toBe(13000000);
    expect(result.accepted[0].attributes.reviewRequired).toBe(true);
    expect(result.accepted[0].photos).toEqual(['photo']);
    expect(result.accepted[0].raw.mediaExtraction[0].engine).toBe(
      'reviewed-control'
    );
    expect(result.reviewQueue[0].reason).toBe('ocr-fields-unverified');
    expect(result.complete).toBe(false);
  });

  it('keeps navigation, receipts, sales, requests and unparseable prices out of accepted housing', async () => {
    for (const text of [
      'Panorama Nha Trang\n€ 19 phút\n9,3 km',
      'Apartment receipt\nTotal: 13 million VND',
      'For sale: studio in Nha Trang, 13 million VND/month',
      'Looking for a studio in Nha Trang, 13 million VND/month',
      'Студия\nНячанг\nЦена: 15 xem VND / wes',
      'Motorbike for rent: 1 million VND/month',
    ]) {
      expect((await reconcile(text)).accepted.length).toBe(0);
    }
  });
});
