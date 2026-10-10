'use strict';

/**
 * #5787 (Josh, 2026-10-10 14:07 and 14:15, during his real new-account Kosmos+ test): "we just combine these pages so
 * you just land here after logging in". The "You're signed in / Done" landing is gone; every sign-in ends on the
 * connected pane, whose box is now the connect block (line art, his #4744 sentence with Copy, a Scan to connect code,
 * and the two store buttons greyed with "Coming soon" until each store lists the app).
 * The layout and the ribbon are measured in a browser by docs/browser-checks/render-plus-panel-3829.js.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

test('#5787: the signed-in landing is gone, so it cannot come back unnoticed', () => {
  assert.equal(PAGE.includes('id="plus-si-done"'), false, 'the landing card markup');
  assert.equal(PAGE.includes('plus-si-done-go'), false, 'its Done button');
  assert.equal(/PLUS_SI_LANDED/.test(PAGE), false, 'the flag that held the pane for it');
  assert.equal(PAGE.includes("You're signed in to Kosmos+"), false, 'its heading');
  // CONTROL: the step list the landing sat in is still there, so the first check above is not vacuous.
  assert.match(PAGE, /const PLUS_SI_STEPS = \['plus-si-email'[^\]]*'plus-si-expired'\];/);
});

test('#5787: an owned address ends like a typed one, on the connected pane', () => {
  const i = PAGE.indexOf('#5787: an owned address ends like a typed one');
  assert.ok(i > 0, 'the owned branch comment');
  const after = PAGE.slice(i, i + 2200);
  assert.match(after, /Signed in\. Connecting this computer to Kosmos\+\./);
  assert.match(after, /paintPlus\(\);/);
});

test("#5787: the connect block keeps Josh's #4744 sentence word for word, with Copy", () => {
  assert.match(PAGE, /<span class="plus-chip-say" id="plus-chip-say">Access this computer from other devices at <b>login\.kosmosplus\.com<\/b><\/span>\s*<button class="btn" type="button" id="plus-copy"/);
});

test('#5787: the Scan to connect code is drawn in the page, never fetched', () => {
  const i = PAGE.indexOf('id="plus-qr"');
  assert.ok(i > 0);
  const fig = PAGE.slice(i, PAGE.indexOf('</figure>', i));
  assert.match(fig, /<svg viewBox="0 0 29 29"[^>]*aria-label="Code that opens login\.kosmosplus\.com on a phone"><path stroke="#000000" d="M0 0\.5h7/);
  assert.match(fig, /<figcaption>Scan to connect<\/figcaption>/);
  assert.equal(/<img|https?:\/\/[^"]*qr/i.test(fig), false, 'no image or QR service');
});

test('#5787: both store buttons ship greyed with "Coming soon", and no store link is set yet', () => {
  for (const key of ['ios', 'android']) {
    assert.match(PAGE, new RegExp('<span class="plus-store" id="plus-store-' + key + '" data-store="' + key + '" aria-disabled="true">[\\s\\S]*?<i class="plus-sash">Coming soon</i></span>'));
  }
  assert.match(PAGE, /const PLUS_STORE_LINKS = \{ ios: '', android: '' \};/);
  assert.match(PAGE, /plusStoresPaint\(PLUS_STORE_LINKS\);/);
});
