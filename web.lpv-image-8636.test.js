'use strict';
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
const lpvImageFailed = new Function("'use strict';\n" + page.lift(SCRIPT, 'lpvImageFailed') + '\nreturn lpvImageFailed;')();

/* An element with just closest() and remove(), chained by class. */
function el(tag, cls, parent) {
  const e = { tagName: tag, cls, parent, removed: false };
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
