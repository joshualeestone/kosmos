'use strict';

/**
 * #529: every Connections pill opens to a door; none renders a fake
 * Connect. (Josh, 2026-08-24 10:25.)
 *
 *   node --test web.svc-doors.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const PAGE = fs.readFileSync('web/index.html', 'utf8');

test('no pill is inert and no door holds a control for an unbuilt flow', () => {
  const at = PAGE.indexOf('id="s-sec-connect"');
  const end = PAGE.indexOf('<section class="dsec"', at + 10);
  const sec = PAGE.slice(at, end);
  assert.equal((sec.match(/<span class="boardname/g) || []).length, 0,
    'a span pill survives; a clickable pill must be a button');
  const pills = (sec.match(/<button type="button" class="boardname/g) || []).length;
  const rows = (sec.match(/class="boardrow"/g) || []).length;
  const doors = (sec.match(/class="svc-door"/g) || []).length;
  assert.ok(pills >= 60, 'the pill inventory shrank unexpectedly: ' + pills);
  assert.equal(doors, rows, 'a category row lacks its door');

  const fn = PAGE.slice(PAGE.indexOf('const SVC_DOORS'), PAGE.indexOf('/* The connect tab\'s one computed sentence'));
  for (const name of ['GitHub', 'Vercel', 'Cloudflare', 'Gmail']) {
    assert.ok(fn.includes("'" + name + "'"), name + ' lost its own sentence');
  }
  // The generic door is an ANSWER (how it will work), not a bare label.
  assert.match(fn, /you sign in on/, 'the generic door lost its how-it-works sentence');
  assert.match(fn, /never sees a password/, 'the generic door lost the key promise');
  // No fake Connect: the door writer emits text only. If a Connect control
  // is ever added, it must be gated on a built flow, and this pin restated.
  assert.ok(!/svcDoorText[\s\S]{0,800}<button/.test(fn),
    'the door writer emits a control; nothing here is connectable yet');
});
