'use strict';
/**
 * #4612: the DM says a Muse agent finished without replying here, and shows what it answered in its own window,
 * instead of "Nothing back yet". Runs the page's own dmOwesLine on the owes shapes the thread route sends.
 *
 *   node --test web.dm-unsent-4612.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function pageFnSource(name) {
  const start = PAGE.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' is gone from the page');
  let depth = 0;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k++) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) return PAGE.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const silence = PAGE.match(/const PJ_SILENCE_AFTER_MS = [^;]+;/);
assert.ok(silence, 'PJ_SILENCE_AFTER_MS is gone');
const api = new Function([silence[0], pageFnSource('esc'), pageFnSource('pjOldEnoughToJudge'), pageFnSource('dmOwesLine'),
  'return { dmOwesLine };'].join('\n'))();

const OLD = new Date(Date.now() - 10 * 60000).toISOString();
const NEW = new Date().toISOString();

test('#4612: an owed thread with an unsent answer says so and shows the answer, at once and escaped', () => {
  const html = api.dmOwesLine({ state: 'owes', lastHeardAt: NEW, unsent: { text: 'Hi Josh <b>all</b> good\nline two', at: NEW } });
  assert.match(html, /It finished without replying here\. What it said in its own window:/);
  assert.match(html, /<blockquote class="dmunsent-text">Hi Josh &lt;b&gt;all&lt;\/b&gt; good\nline two<\/blockquote>/, html);
  assert.doesNotMatch(html, /Nothing back yet/);
});

test('#4612: without an unsent answer the line is exactly as before (CONTROL)', () => {
  assert.equal(api.dmOwesLine({ state: 'owes', lastHeardAt: OLD }), '<p class="dmnone">Nothing back yet.</p>');
  assert.equal(api.dmOwesLine({ state: 'owes', lastHeardAt: NEW }), '', 'the two-minute grace was lost');
  assert.equal(api.dmOwesLine({ state: 'owes', lastHeardAt: OLD, unsent: { text: '' } }), '<p class="dmnone">Nothing back yet.</p>');
  assert.equal(api.dmOwesLine({ state: 'clear' }), '');
});
