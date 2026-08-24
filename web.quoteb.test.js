'use strict';
/**
 * #460, the renderer half: a quoted line draws as the pack's .quoteb ONLY
 * where the engine attached a source row (`quotes[]`, offsets into `text`),
 * and no styling path reads the text. The functions are EXECUTED with the
 * same page-scope harness web.post-receipt.test.js uses, because a grep for
 * "quoteb" in a 26,000-line file proves nothing about which input reaches it.
 *
 * Positive control: a verbatim requote of another author's row, tagged.
 * Negatives: the same words by their original author (untagged, because the
 * engine never tags the origin); a row beginning with '>' and no tag; a tag
 * the renderer cannot trust (offsets past the text, overlapping, no source).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');

function pageScope() {
  const src = PAGE.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(src, 'the page has no script block');
  const written = {};
  const el = (id) => new Proxy(function () {}, {
    get: (t, k) => (k === 'textContent' || k === 'value' ? ''
      : (k === 'innerHTML' ? (written[id] || '') : el(id))),
    set: (t, k, v) => { if (k === 'innerHTML') written[id] = String(v); return true; },
    apply: () => el(id),
  });
  const document = {
    getElementById: (id) => el(id), querySelector: () => el('?'), querySelectorAll: () => [],
    addEventListener: () => {}, createElement: () => el('new'),
    documentElement: el('html'), body: el('body'), readyState: 'complete',
  };
  const window = {
    addEventListener: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }),
    location: { hash: '', pathname: '/' },
    localStorage: { getItem: () => null, setItem: () => {} },
  };
  // eslint-disable-next-line no-new-func
  return new Function(
    'document', 'window', 'navigator', 'fetch', 'setInterval', 'setTimeout',
    'clearInterval', 'EventSource', 'location', 'localStorage',
    src[1] + '\n return { pjRoomRow, pjRoomBody };',
  )(document, window, {}, () => new Promise(() => {}), () => 0, () => 0, () => {},
    function EventSource() {}, window.location, window.localStorage);
}
const api = pageScope();
const P = { agents: [{ sessionName: 'mara', name: 'Mara' }, { sessionName: 'leo', name: 'Leo' }] };
const QUOTE = 'Whichever number you publish first is the one people plan around, so change the doc.';
const row = (from, text, extra) => ({ id: 'r' + from, from, at: Date.now(), text, ...(extra || {}) });

test('positive control: a tagged verbatim requote draws .quoteb around exactly the tagged span, with the source named', () => {
  const text = 'Mara said: ' + QUOTE + ' I agree, and I would change the page too.';
  const start = text.indexOf(QUOTE);
  const html = api.pjRoomRow(row('leo', text, { quotes: [{ of: 'rmara', from: 'mara', start, end: start + QUOTE.length }] }), P, null);
  const blocks = html.match(/<blockquote class="quoteb">/g) || [];
  assert.equal(blocks.length, 1);
  assert.match(html, new RegExp('<blockquote class="quoteb">' + QUOTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<cite class="quoteb-from">Mara, earlier</cite></blockquote>'));
  assert.match(html, /<p>Mara said:<\/p>/, 'the prose before the quote lost its own paragraph');
  assert.match(html, /<p>I agree, and I would change the page too\.<\/p>/, 'the prose after the quote lost its own paragraph');
  assert.ok(html.indexOf('<p>Mara said:') < html.indexOf('<blockquote') && html.indexOf('<blockquote') < html.indexOf('<p>I agree'), 'order');
});

test('the operator as source reads "You, earlier"', () => {
  const text = QUOTE;
  const html = api.pjRoomRow(row('leo', text, { quotes: [{ of: 'm1', from: 'you', start: 0, end: text.length }] }), P, null);
  assert.match(html, /<cite class="quoteb-from">You, earlier<\/cite>/);
  assert.doesNotMatch(html, /<p><\/p>/, 'an empty paragraph was drawn around a whole-post quote');
});

test('negative: the same words by their original author, untagged, draw no blockquote', () => {
  const html = api.pjRoomRow(row('mara', QUOTE), P, null);
  assert.doesNotMatch(html, /quoteb/);
  assert.match(html, /<p>Whichever number/);
});

test('negative: a leading ">" with no tag is text, not a quote (no styling path reads the text)', () => {
  const html = api.pjRoomRow(row('leo', '> ' + QUOTE + '\nsee the diff'), P, null);
  assert.doesNotMatch(html, /quoteb/);
  assert.match(html, /&gt; Whichever/);
});

test('negative: a tag the renderer cannot trust is the flat paragraph, never a partial quote', () => {
  const text = 'x ' + QUOTE;
  for (const bad of [
    [{ of: 'r1', from: 'mara', start: 2, end: text.length + 5 }],
    [{ of: 'r1', from: 'mara', start: 5, end: 2 }],
    [{ of: '', from: 'mara', start: 2, end: text.length }],
    [{ of: 'r1', from: 'mara', start: 2, end: 40 }, { of: 'r2', from: 'mara', start: 30, end: 60 }],
    [{ of: 'r1', from: 'mara', start: 2, end: 40 }, null],
  ]) {
    const html = api.pjRoomRow(row('leo', text, { quotes: bad }), P, null);
    assert.doesNotMatch(html, /quoteb/, 'styled on ' + JSON.stringify(bad));
    assert.match(html, /<p>x Whichever/);
  }
});

test('the rule exists once, on the message, and nothing a person reads carries an em dash', () => {
  assert.equal((PAGE.match(/\.msg \.quoteb \{/g) || []).length, 1);
  const fn = PAGE.slice(PAGE.indexOf('function pjRoomBody('), PAGE.indexOf('function pjRoomRow('));
  assert.doesNotMatch(fn, /—/);
  assert.doesNotMatch(fn, /\/\^>|\/\^\\s\*>|indexOf\('>'\)|startsWith\('>'\)|charAt\(0\) === '>'/, 'the renderer reads the text for a quote mark');
});
