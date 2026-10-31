'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { offer } = require('./personalbackupoffer');

test('off unless KOSMOS_PERSONAL_BACKUP is exactly 1', () => {
  assert.deepStrictEqual(offer({}), { shown: false, price: null });
  for (const v of ['0', 'true', 'yes', '', '11']) assert.strictEqual(offer({ KOSMOS_PERSONAL_BACKUP: v }).shown, false, v);
  assert.strictEqual(offer({ KOSMOS_PERSONAL_BACKUP: '1' }).shown, true);
  assert.strictEqual(offer({ KOSMOS_PERSONAL_BACKUP: ' 1 ' }).shown, true);
});

test('a price in Stripe shape is passed through; anything else is null (Price to be set)', () => {
  const on = (p) => offer({ KOSMOS_PERSONAL_BACKUP: '1', KOSMOS_PERSONAL_BACKUP_PRICE: p }).price;
  assert.strictEqual(on('$5/month'), '$5/month');
  assert.strictEqual(on('€4.99/month'), '€4.99/month');
  assert.strictEqual(on('$50/year'), '$50/year');
  for (const bad of ['', '5', 'free', '$5', '$5 a month', '<b>$5</b>/month', '$5/fortnight']) assert.strictEqual(on(bad), null, bad);
  assert.strictEqual(offer({ KOSMOS_PERSONAL_BACKUP: '1' }).price, null);
});

test('a price is never said while the offer is off', () => {
  assert.strictEqual(offer({ KOSMOS_PERSONAL_BACKUP_PRICE: '$5/month' }).price, null);
});
