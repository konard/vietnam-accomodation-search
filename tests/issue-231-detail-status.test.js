/* eslint local/no-changelog-comments: ["warn", {allowDatesInStrings:true}] -- Fixed dates are synthetic test inputs. */
import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import {
  detailStatus,
  WebDetailStatusCache,
  applyDetailStatus,
} from '../src/web-detail-status.js';

it('excludes expired/rented detail pages without inferring status from age', async () => {
  const now = new Date('2026-10-12T00:00:00Z');
  assert.equal(
    detailStatus(
      {
        text: 'Tin đăng đã hết hạn. Giá 5 triệu/tháng',
        publishedAt: '2023-01-01',
      },
      now
    ).status,
    'expired'
  );
  assert.equal(
    detailStatus({ text: 'Đã cho thuê. 5 triệu/tháng' }, now).status,
    'rented'
  );
  assert.equal(
    detailStatus({ text: 'Đang cho thuê', publishedAt: '2023-01-01' }, now)
      .status,
    'active'
  );
  assert.equal(
    detailStatus({ text: '5 triệu/tháng', publishedAt: '2023-01-01' }, now)
      .status,
    'unknown'
  );
  assert.equal(
    applyDetailStatus(
      { attributes: {} },
      detailStatus({ text: 'Tin đăng đã hết hạn' }, now)
    ).attributes.availableNow,
    false
  );
  let clock = now;
  let fetches = 0;
  const cache = new WebDetailStatusCache({ now: () => clock, ttlMs: 1000 });
  const fetch = async () => {
    fetches++;
    return { text: 'Tin đăng đã hết hạn' };
  };
  await cache.inspect('https://homedy.com/listing-es123', fetch);
  await cache.inspect('https://homedy.com/listing-es123', fetch);
  assert.equal(fetches, 1);
  clock = new Date(now.getTime() + 1001);
  await cache.inspect('https://homedy.com/listing-es123', fetch);
  assert.equal(fetches, 2);
});
