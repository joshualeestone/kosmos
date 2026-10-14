'use strict';

/**
 * #5949: when a Windows agent's state is a held reading (Kosmos's check on it just failed), or
 * unknown because the check failed, the page says so on HOVER, in its own fixed words, and marks
 * a held state as remembered. The engine sends one word (`stateRead`); no engine sentence can
 * reach a card (#3729: no diagnostic lines on agent cards, and no slot for one).
 *
 * The helpers are lifted from the page and RUN; the call sites are source pins, and said so: the
 * card and list renderers need the whole page around them. The rendered pill is a copy qualifier
 * plus a title, behind no click.
 *
 *   node --test web.stateread-5949.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pageFnSource(name) {
  const start = RAW.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from web/index.html');
  let depth = 0;
  for (let k = RAW.indexOf('{', start); k < RAW.length; k += 1) {
    if (RAW[k] === '{') depth += 1;
    else if (RAW[k] === '}') { depth -= 1; if (depth === 0) return RAW.slice(start, k + 1); }
  }
  throw new Error('unbalanced ' + name);
}
function constBlock(name) {
  const start = RAW.indexOf('const ' + name + ' = {');
  assert.ok(start > -1, name + ' vanished from web/index.html');
  const end = RAW.indexOf('\n};', start);
  return RAW.slice(start, end + 3);
}

/* eslint-disable-next-line no-new-func */
const lifted = new Function(
  [constBlock('STATE_READ_SAY'), pageFnSource('esc'), pageFnSource('stateReadOf'), pageFnSource('stateReadAttrs'),
    'return { STATE_READ_SAY, stateReadOf, stateReadAttrs };'].join('\n'),
)();

test('#5949 a held reading: marked remembered, and the hover says why in plain words', () => {
  const attrs = lifted.stateReadAttrs({ state: 'working', stateRead: 'remembered' });
  assert.match(attrs, / data-read="remembered"/);
  assert.match(attrs, /title="Kosmos could not check on this agent just now, so this is what it was doing when last seen\. It will try again in a few seconds\."/);
});

test('#5949 a failed check with nothing to hold: the hover says Kosmos could not check, and will try again', () => {
  const attrs = lifted.stateReadAttrs({ state: 'unknown', stateRead: 'unreadable' });
  assert.match(attrs, / data-read="unreadable"/);
  assert.match(attrs, /title="Kosmos could not check on this agent\. It keeps trying every few seconds\."/);
});

test('#5949 a fresh look, a card without the field, and an unknown word add nothing', () => {
  assert.equal(lifted.stateReadAttrs({ state: 'idle' }), '');
  assert.equal(lifted.stateReadAttrs({ state: 'idle', stateRead: 'something the engine made up' }), '');
  assert.equal(lifted.stateReadAttrs(null), '');
  /* Read with `in`, never blind: a strict fixture card throws on a field it does not carry. */
  const strict = new Proxy({ state: 'idle' }, { get(t, p) { if (p in t || typeof p === 'symbol') return t[p]; throw new Error('read ' + String(p)); } });
  assert.equal(lifted.stateReadAttrs(strict), '');
});

test('#5949 the words are the page\'s own: no engine text, no em dash', () => {
  for (const words of Object.values(lifted.STATE_READ_SAY)) assert.doesNotMatch(words, /—/);
  assert.doesNotMatch(pageFnSource('stateReadAttrs'), /cause|because/, 'the engine\'s cause stays in the agent\'s log');
});

test('#5949 the grid card, the list row and the agent page all carry it; the remembered mark is drawn by CSS', () => {
  assert.match(pageFnSource('card'), /<div class="astate st-\$\{m\.st\}"\$\{typeof stateReadAttrs === 'function' \? stateReadAttrs\(a\) : ''\}>/);
  assert.match(pageFnSource('lrow'), /<div class="lstate"\$\{typeof stateReadAttrs === 'function' \? stateReadAttrs\(a\) : ''\}>/);
  const detail = pageFnSource('paintDetailState');
  assert.match(detail, /workingSampleIsStale\(card\) \? \{ \.\.\.card, state: 'idle', stateEvidence: '', stateRead: '' \}/, 'no mark on a state the stale-sample rule replaced');
  assert.equal(lifted.stateReadAttrs({ state: 'idle', stateRead: '' }), '', 'and the cleared word marks nothing');
  assert.match(detail, /dst\.dataset\.read = readWord; dst\.title = STATE_READ_SAY\[readWord\];/);
  assert.match(detail, /delete dst\.dataset\.read; dst\.removeAttribute\('title'\);/);
  assert.match(RAW, /\.detail-state\[data-read="remembered"\]::after \{ content: ' · when last seen';/);
  assert.match(RAW, /\.acard \.astate\[data-read="remembered"\], \.lstate\[data-read="remembered"\] \{ opacity: \.7; \}/);
});
