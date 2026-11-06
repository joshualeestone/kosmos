'use strict';
/**
 * kosmos#7206 slice 3 (review 3): every mark providerMarkNode copies out of #firstrun into a menu or the project tally
 * must paint on its own. A mark filled from a gradient (fill="url(#...)") draws nothing once copied, because the
 * gradient's definition stays behind inside #firstrun: the #3422 class, found again on MiniMax's mark (now one
 * currentColor path, as Gemini's). So no provider
 * mapped in PROVIDER_MARK_KEY may point at a #firstrun mark whose markup uses url(#...).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function markKeys() {
  const at = PAGE.indexOf('const PROVIDER_MARK_KEY = {');
  assert.ok(at > -1, 'PROVIDER_MARK_KEY moved; re-anchor this test');
  const body = PAGE.slice(at, PAGE.indexOf('\n};', at));
  return [...new Set([...body.matchAll(/:\s*'([a-z]+)'/g)].map((m) => m[1]))];
}
function markMarkup(key) {
  const re = new RegExp('<span[^>]*data-pmark="' + key + '"[^>]*>[\\s\\S]*?</span>');
  const m = PAGE.match(re);
  return m ? m[0] : null;
}

test('#7206: no mark copied into a menu is painted from a gradient that stays behind in #firstrun', () => {
  const keys = markKeys();
  assert.ok(keys.length >= 8, 'CONTROL: only ' + keys.length + ' marks read from PROVIDER_MARK_KEY: ' + keys.join(', '));
  for (const k of keys) {
    const mark = markMarkup(k);
    if (!mark) continue;   // providerMarkNode falls back to the letter chip
    assert.equal(/url\(#/.test(mark), false, `the ${k} mark is filled from a gradient; copied out of #firstrun it draws nothing`);
  }
});

test('CONTROL: the check can fail: a gradient-filled mark is caught, a currentColor one is not', () => {
  assert.equal(/url\(#/.test('<span data-pmark="x"><svg><path fill="url(#g)" d="M0"/></svg></span>'), true);
  assert.equal(/url\(#/.test(markMarkup('minimax') || 'missing url(#'), false, 'MiniMax\'s mark is missing or gradient-filled again');
});
