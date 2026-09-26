'use strict';

/**
 * #3966 (Josh, 2026-09-26): "I'm getting a flash every 5 seconds" on an agent's page.
 *
 * A thread was rewritten whenever its markup changed, and "51 minutes ago" becoming "52 minutes
 * ago" on any row changed it. These pin the two helpers that separate a time's words from the
 * thread's shape, against the page's own source, and pin that BOTH thread painters (the agent
 * thread's setThread and the project room's paintRoom) decide a rewrite on the shape. The real
 * browser measurement is docs/browser-checks/render-thread-steady-3966.js.
 *
 *   node --test web.thread-shape-3966.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
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

/* pjWhen reads Date.now(); a fixed clock makes the words deterministic. */
function load(now) {
  // eslint-disable-next-line no-new-func
  return new Function('Date', [
    'function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;"); }',
    pageFnSource('pjWhen'),
    pageFnSource('pjWhenLive'),
    pageFnSource('threadShape'),
    pageFnSource('refreshWhens'),
    'return { pjWhenLive, threadShape, refreshWhens };',
  ].join('\n'))(class extends Date {
    constructor(...a) { if (a.length) super(...a); else super(now); }
    static now() { return now; }
  });
}

const AT = '2026-09-26T13:00:00.000Z';
const at = Date.parse(AT);

test('#3966: a time is a live span carrying its source, and its words follow the clock', () => {
  const a = load(at + 51 * 60000).pjWhenLive(AT);
  const b = load(at + 52 * 60000).pjWhenLive(AT);
  assert.match(a, /^<span class="mwhen" data-at="2026-09-26T13:00:00\.000Z">51 minutes ago<\/span>$/);
  assert.match(b, />52 minutes ago</);
  assert.equal(load(at).pjWhenLive('not a time'), '', 'an unreadable time says nothing, as pjWhen does');
});

test('#3966: two threads that differ only in a time\'s words have the SAME shape', () => {
  const row = (now) => '<div class="msg"><b>Beatrix</b>hi<span class="msg-t">' + load(now).pjWhenLive(AT) + '</span></div>';
  const { threadShape } = load(at);
  const early = row(at + 51 * 60000);
  const late = row(at + 52 * 60000);
  assert.notEqual(early, late, 'control: the markup itself did change');
  assert.equal(threadShape(early), threadShape(late));
});

test('#3966: a real change (new words, a new row) still changes the shape', () => {
  const { pjWhenLive, threadShape } = load(at + 5 * 60000);
  const one = '<div class="msg">hi<span class="msg-t">' + pjWhenLive(AT) + '</span></div>';
  assert.notEqual(threadShape(one), threadShape(one.replace('hi', 'hello')), 'edited words must repaint');
  assert.notEqual(threadShape(one), threadShape(one + one), 'a new row must repaint');
  const other = one.replace(AT, '2026-09-26T13:01:00.000Z');
  assert.notEqual(threadShape(one), threadShape(other), 'a different message time is a different row');
});

test('#3966: both thread painters decide a rewrite on the shape, not the raw markup', () => {
  const setThread = pageFnSource('setThread');
  assert.match(setThread, /const shape = threadShape\(html\);/);
  assert.match(setThread, /el\.__lastThread !== shape/);
  assert.match(setThread, /refreshWhens\(el\)/);
  assert.doesNotMatch(setThread, /el\.__lastThread !== html/, 'the raw compare is the flash');
  const paintRoom = pageFnSource('paintRoom');
  assert.match(paintRoom, /const shape = threadShape\(html\);/);
  assert.match(paintRoom, /if \(box\.__lastRoom === shape && !queryChanged\) \{\n\s*refreshWhens\(box\);\n\s*\} else \{/);
  assert.match(paintRoom, /refreshWhens\(box\)/);
  assert.doesNotMatch(paintRoom, /box\.__lastRoom !== html/, 'the raw compare is the flash, and it marked the room seen');
});

test('#3966: every thread timestamp is written through pjWhenLive', () => {
  const plain = RAW.match(/'<span class="msg-t">' \+ esc\(when[A-Z]?\)/g) || [];
  assert.deepEqual(plain, [], 'a thread time written as plain text would change the shape every minute');
  assert.ok((RAW.match(/pjWhenLive\(m\.at\)/g) || []).length >= 7, 'the thread row builders use pjWhenLive');
});

test('#3966: setLive (the project member panel #pj-msgs, and the room\'s writer) also compares by shape', () => {
  const setLive = pageFnSource('setLive');
  assert.match(setLive, /const shape = threadShape\(html\);/);
  assert.match(setLive, /if \(el\.__lastLive === shape\) \{\n\s*if \(html\.indexOf\('mwhen'\) > -1\) refreshWhens\(el\);\n\s*if \(html\.indexOf\('lring'\) > -1\) refreshRings\(el, html\);\n\s*return;\n\s*\}/);
  assert.doesNotMatch(setLive, /el\.__lastLive === html/, 'the raw compare rebuilt #pj-msgs on every minute tick');
  const verdict = pageFnSource('pjVerdict');
  assert.match(verdict, /const whenLive = pjWhenLive\(m\.at\);/, 'the member panel\'s time must be a live span');
  assert.doesNotMatch(verdict, /const when = pjWhenPart\(m\.at\)/);
});

/* #3991: a memory ring as lrowRing draws it (its arc is the reading). */
const ring = (arc) => '<svg class="lring" viewBox="0 0 36 36" aria-hidden="true"><circle class="gt" r="15.5"/>'
  + '<circle class="gf ok" r="15.5" stroke-dasharray="' + arc + ' 97.4"/></svg>';

test('#3991: a ring\'s arc length is not shape, anything else about it is', () => {
  const { threadShape } = load(at);
  const row = (arc, band) => '<div class="pj-member" data-agent="beatrix-discord">' + ring(arc).replace('gf ok', 'gf ' + band) + '</div>';
  assert.equal(threadShape(row('40.9', 'ok')), threadShape(row('55.5', 'ok')), 'a climbing reading rebuilt the column');
  assert.notEqual(threadShape(row('40.9', 'ok')), threadShape(row('40.9', 'warn')), 'a band change must still rebuild');
  /* The blanking is scoped to rings: a dasharray anywhere else is still shape. */
  const other = (arc) => '<svg class="spark"><path stroke-dasharray="' + arc + '"/></svg>';
  assert.notEqual(threadShape(other('1 2')), threadShape(other('3 4')), 'a non-ring dasharray was blanked too');
});

test('#3966: refreshWhens rewrites only the words that changed, in place', () => {
  const { refreshWhens } = load(at + 52 * 60000);
  const writes = [];
  const span = (at, text) => {
    const el = { _t: text, getAttribute: (k) => (k === 'data-at' ? at : null) };
    Object.defineProperty(el, 'textContent', { get() { return el._t; }, set(v) { writes.push(v); el._t = v; } });
    return el;
  };
  const stale = span(AT, '51 minutes ago');
  const fresh = span(AT, '52 minutes ago');
  const bad = span('not a time', 'kept');
  refreshWhens({ querySelectorAll: (sel) => (assert.equal(sel, '.mwhen[data-at]'), [stale, fresh, bad]) });
  assert.equal(stale.textContent, '52 minutes ago', 'a ticked time was not brought up to now');
  assert.deepEqual(writes, ['52 minutes ago'], 'a time already right, or unreadable, was written anyway');
});
