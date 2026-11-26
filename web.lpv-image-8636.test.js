'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#8636, the page half: a link preview picture that fails to load in the browser takes its box away
 * (lpvImageFailed, listening for errors in the capture phase), so the card keeps its words and never shows a broken
 * picture. Only a preview card's picture box is touched. The board half is server.unfurl-image-8636.test.js.
 *
 *   node --test web.lpv-image-8636.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
// eslint-disable-next-line no-new-func
const { lpvImageFailed, pjPreviewCard, LPV_FAILED } = new Function('esc', "'use strict';\nconst LPV_FAILED = new Set();\n" + page.lift(SCRIPT, 'lpvImageFailed') + '\n'
  + page.lift(SCRIPT, 'pjPreviewCard') + '\nreturn { lpvImageFailed, pjPreviewCard, LPV_FAILED };')((x) => String(x).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';'));

/* An element with just closest() and remove(), chained by class. */
function el(tag, cls, parent) {
  const e = { tagName: tag, cls, parent, removed: false, src: '' };
  e.getAttribute = (k) => (k === 'src' ? e.src : null);
  e.closest = (sel) => { for (let n = e; n; n = n.parent) if ('.' + n.cls === sel) return n; return null; };
  e.remove = () => { e.removed = true; };
  return e;
}

test('a failed preview picture removes its box, and only that', () => {
  const card = el('A', 'lpv', null);
  const box = el('SPAN', 'lpv-img', card);
  const img = el('IMG', '', box);
  lpvImageFailed({ target: img });
  assert.equal(box.removed, true, 'the broken picture box stayed');
  assert.equal(card.removed, false, 'the card itself went, words and all');
});

test('any other failing image or element is left alone', () => {
  const avatar = el('IMG', '', el('SPAN', 'av', null));
  lpvImageFailed({ target: avatar });
  const stray = el('SPAN', 'lpv-img', null);   // a box outside a card
  lpvImageFailed({ target: el('IMG', '', stray) });
  assert.equal(stray.removed, false, 'a box outside a preview card was removed');
  const script = el('SCRIPT', '', el('SPAN', 'lpv-img', el('A', 'lpv', null)));
  lpvImageFailed({ target: script });
  assert.equal(script.parent.removed, false, 'a non-image error removed the box');
  lpvImageFailed({});
  lpvImageFailed(null);
});

test('the page listens for it in the capture phase (an error does not bubble)', () => {
  assert.match(SCRIPT, /document\.addEventListener\('error', lpvImageFailed, true\);/);
});

test('a picture that failed here is not asked for again when the card is drawn again; others still are', () => {
  LPV_FAILED.clear();
  const preview = { url: 'https://name.example/', title: 'Name', image: '/api/unfurl/image?url=https%3A%2F%2Fname.example%2Fog.jpeg' };
  assert.match(pjPreviewCard(preview), /<img src=/, 'CONTROL: the card asks for its picture');
  const card = el('A', 'lpv', null);
  const img = el('IMG', '', el('SPAN', 'lpv-img', card));
  img.src = preview.image;
  lpvImageFailed({ target: img });
  const again = pjPreviewCard(preview);
  assert.doesNotMatch(again, /<img/, 'the redrawn card asked again for a picture that failed');
  assert.match(again, /lpv-title">Name</, 'the words went too');
  assert.match(pjPreviewCard({ ...preview, image: '/api/unfurl/image?url=other' }), /<img src=/, 'another picture was refused');
});

test('the page declares LPV_FAILED before the card renderer, and keeps the newest 500 failures', () => {
  const at = SCRIPT.indexOf('const LPV_FAILED = new Set();');
  assert.ok(at > 0, 'LPV_FAILED is not declared in the page');
  assert.ok(at < SCRIPT.indexOf('function pjPreviewCard('), 'LPV_FAILED is declared after the renderer that reads it');
  LPV_FAILED.clear();
  const card = el('A', 'lpv', null);
  for (let i = 0; i < 501; i++) { const img = el('IMG', '', el('SPAN', 'lpv-img', card)); img.src = '/api/unfurl/image?url=' + i; lpvImageFailed({ target: img }); }
  assert.equal(LPV_FAILED.size, 500);
  assert.equal(LPV_FAILED.has('/api/unfurl/image?url=0'), false, 'the oldest failure was kept over the newest');
  assert.equal(LPV_FAILED.has('/api/unfurl/image?url=500'), true, 'the newest failure was not kept');
});

test('a card with no words whose picture failed here is not drawn at all; with words it keeps them', () => {
  LPV_FAILED.clear();
  const pic = '/api/unfurl/image?url=only';
  assert.match(pjPreviewCard({ url: 'https://pic.example/', image: pic }), /<img/, 'CONTROL: a picture-only card is drawn while its picture loads');
  LPV_FAILED.add(pic);
  assert.equal(pjPreviewCard({ url: 'https://pic.example/', image: pic }), '', 'a card with nothing left to show was drawn');
  assert.match(pjPreviewCard({ url: 'https://pic.example/', title: 'Words', image: pic }), /Words/);
});
