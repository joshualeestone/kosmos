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
  /* #529: GitHub is the first built flow. The coming-soon writer
     (svcDoorText) still emits no control; only svcDoorLiveHtml may, and only
     for names in SVC_BUILT, whose list is the honest inventory of what
     connects today. */
  const plain = fn.slice(fn.indexOf('function svcDoorText'), fn.indexOf('function svcDoorLiveHtml'));
  assert.ok(!/<button/.test(plain), 'the coming-soon door writer emits a control; an unbuilt service must not offer one');
  const built = fn.slice(fn.indexOf('const SVC_BUILT'), fn.indexOf('function svcDoorText'));
  assert.match(built, /'GitHub': '\/api\/github'/, 'GitHub is built and must be listed as such');
  assert.match(built, /'Vercel': '\/api\/vercel'/, 'Vercel is built and must be listed as such');
  const list = built.slice(0, built.indexOf('};') + 2);
  assert.ok(!/'Cloudflare'|'Gmail'/.test(list), 'a service without a flow is listed as built');
  /* Mona Lisa's absent-CLI sentence is built from a per-service row now
     (#529, Vercel): the template and GitHub's row are pinned separately, so
     the sentence a person reads is still hers, for every built service. */
  assert.match(fn, /<b>To connect ' \+ esc\(name\) \+ ', this Mac needs ' \+ esc\(t\.cli\) \+ ', and it is not here yet\.<\/b> '/, 'the absent-CLI sentence lost its shape');
  assert.match(fn, /'GitHub': \{ cli: 'the GitHub CLI', install: 'https:\/\/cli\.github\.com'/, 'GitHub lost its tool words');
  assert.match(fn, /'Vercel': \{ cli: 'the Vercel CLI', install: 'https:\/\/vercel\.com\/docs\/cli'/, 'Vercel lost its tool words');
});
