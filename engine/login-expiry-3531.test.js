'use strict';
/* #3531: login-expiry banner detector (loginExpiryFromText).
 *   node --test login-expiry-3531.test.js
 * The strings under test are byte-exact from the installed Claude Code 2.1.281
 * banner: `⚠ Your login expires in N days · run /login to renew`. */
const { test } = require('node:test');
const assert = require('node:assert');
const status = require('./status');

test('exact 2.1.281 banner -> daysLeft', () => {
  const t = '⚠ Your login expires in 3 days · run /login to renew';
  assert.deepEqual(status.loginExpiryFromText(t), { daysLeft: 3 });
});

test('singular "1 day" parses', () => {
  const t = '⚠ Your login expires in 1 day · run /login to renew';
  assert.deepEqual(status.loginExpiryFromText(t), { daysLeft: 1 });
});

test('7 days parses', () => {
  const t = '⚠ Your login expires in 7 days · run /login to renew';
  assert.deepEqual(status.loginExpiryFromText(t), { daysLeft: 7 });
});

test('frame/prompt glyphs before the banner do not defeat the match', () => {
  const t = '│ ⚠ Your login expires in 5 days · run /login to renew';
  assert.deepEqual(status.loginExpiryFromText(t), { daysLeft: 5 });
});

test('banner as one line among a full pane capture', () => {
  const t = [
    '● working on the lease',
    '  ⚠ Your login expires in 2 days · run /login to renew',
    '❯ ',
  ].join('\n');
  assert.deepEqual(status.loginExpiryFromText(t), { daysLeft: 2 });
});

test('NEGATIVE CONTROL: an ordinary working pane -> null', () => {
  const t = '● cooking… (12s · esc to interrupt)\n❯ ';
  assert.equal(status.loginExpiryFromText(t), null);
});

test('NEGATIVE CONTROL: prose that says "login expires" WITHOUT the renew tail -> null', () => {
  // Both anchors are required on one line, so a card quoting the phrase does not match.
  const t = 'note: your login expires in 4 days according to the docs';
  assert.equal(status.loginExpiryFromText(t), null);
});

test('empty / null input -> null (fail soft)', () => {
  assert.equal(status.loginExpiryFromText(''), null);
  assert.equal(status.loginExpiryFromText(null), null);
  assert.equal(status.loginExpiryFromText(undefined), null);
});
