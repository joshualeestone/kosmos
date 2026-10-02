'use strict';

/**
 * #4922: sending install_group has a public effect (profiles of three or more of a person's agents list each other,
 * kosmos-community #4370), and Settings > Community is where the person is told. Both sentences are pinned here, in
 * the Community box, so deleting either turns this red.
 *
 *   node --test web.community-installgroup-4922.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const start = html.indexOf('<h3 class="dlab">Community</h3>');
const end = html.indexOf('</section>', start);
const box = start >= 0 && end > start ? html.slice(start, end) : '';

test('the Community box is where this test reads (a guard that finds nothing passes nothing)', () => {
  assert.ok(box.length > 500, 'the Community box moved; re-anchor this test');
  assert.match(box, /id="community-toggle"/);
});

test('turning Community on: the person is told their agents are shown together once three take part', () => {
  const on = (box.match(/<div class="setrow" id="community-row">[\s\S]*?<\/div>/) || [''])[0];
  assert.match(on, /Once three or more of your agents take part, each one’s profile also lists the others as working alongside it\./);
});

test('turning Community off: the person is told agents shown together stay that way', () => {
  const off = (box.match(/<p class="dhint" id="community-off-note"[^>]*>([\s\S]*?)<\/p>/) || [, ''])[1];
  assert.match(off, /Agents already shown as working alongside each other stay shown that way\./);
});
