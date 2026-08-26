"use strict";
/**
 * #761 (the room) and #764: the link card reads down with a big picture, an
 * image attachment shows at the card's width, the empty status line takes no
 * room, the Tasks box invites, and a side column can never spill under the
 * room.
 *
 *   node --test web.room-761.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

test('the link card puts the words first and the picture under them at the card\'s width', () => {
  const at = SCRIPT.indexOf('function pjPreviewCard('); const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  assert.ok(fn.indexOf("'<span class=\"lpv-txt\">'") < fn.indexOf("'<span class=\"lpv-img\">"), 'the picture still sits beside the words');
  // eslint-disable-next-line no-new-func
  const card = new Function('esc', fn + '\nreturn pjPreviewCard;')((x) => String(x));
  const html = card({ url: 'https://book.io/', title: 'Book.io', description: 'Ebooks you own.', image: '/api/preview/1', site: 'book.io' });
  assert.match(html, /<span class="lpv-txt">.*<\/span><span class="lpv-img"><img src="\/api\/preview\/1"/s);
  assert.equal(card({ url: 'https://book.io/', title: 'Book.io', image: 'https://evil/x.png' }).includes('lpv-img'), false, 'a remote image is never loaded');
  assert.match(PAGE, /\.lpv \{ display: flex; flex-direction: column; margin-top: 8px; width: min\(100%, 34rem\);/);
  assert.match(PAGE, /\.lpv-img img \{ display: block; width: 100%; height: auto; max-height: 22rem; object-fit: cover; \}/);
});

test('an image attachment reads down at the card\'s width; a document keeps its row a size up', () => {
  assert.match(PAGE, /\.att\.att-image \{ flex-direction: column; align-items: stretch; gap: 0; \}/);
  assert.match(PAGE, /\.att\.att-image \.att-pic img \{ width: 100%; height: auto; max-height: 24rem;/);
  assert.match(PAGE, /\.att:not\(\.att-image\) \.att-pic \{ flex: 0 0 128px; \}/);
  assert.match(PAGE, /\.att \{ display: flex; gap: 12px; align-items: center; margin-top: 8px; width: min\(100%, 34rem\);/);
});

test('the empty status line under the composer takes no room; the Tasks box is taller and says what it is for', () => {
  assert.match(PAGE, /\.pjmid #pj-room-msg:empty \{ display: none; \}/);
  assert.match(PAGE, /\.tkcards \{ display: flex; flex-direction: column; gap: var\(--space-4\); min-height: 14rem; \}/);
  /* kosmos#1009 replaced the `? ''` arm. This test's SUBJECT is "the Tasks box
     says what it is for", and the old pin satisfied that only when the project
     had no tasks at all -- the arm it pinned as `''` was exactly the void Josh
     hit. So the assertion is strengthened rather than merely repointed: BOTH
     arms must now be a sentence, and neither may be empty. */
  assert.match(SCRIPT, /list\.innerHTML = html \|\| \(all\.length\n\s+\? '<p class="tk-empty">[^']+<\/p>'\n\s+: '<p class="tk-empty">[^']+<\/p>'\);/,
    'an arm of the empty-tasks message is blank again, so the Tasks column can render a void');
  assert.ok(!/list\.innerHTML = html \|\| \(all\.length\n\s+\? ''/.test(SCRIPT),
    'the empty arm is back: a project with only finished tasks shows nothing above its View all link');
});

test('#764: a side column may shrink and wrap but never spill under the room', () => {
  assert.match(PAGE, /\.pjcol \{ border: 1px solid var\(--k-rule\);[^}]*min-width: 0; \}/);
  assert.match(PAGE, /\.pjcol > \*, \.pj-member, \.pj-member-b \{ min-width: 0; \}/);
  assert.match(PAGE, /\.pj-member-b b, \.pj-member-b small, \.pj-told \{ overflow-wrap: anywhere; \}/);
});

test('#761 item 9: the composer sticks to the bottom of the window while the room is on screen', () => {
  assert.match(PAGE, /\.pjmid \.composer \{ position: sticky; bottom: 0; z-index: 2; background: var\(--k-surface\);/);
});
