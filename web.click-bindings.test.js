'use strict';
/**
 * #752, the class: `addEventListener('click', someFn)` hands the event into
 * someFn's FIRST parameter. When that parameter is not the event (an
 * attachment, an id, an option), every real click passes a MouseEvent where
 * a value was expected, and nothing says so. This scans every bare-identifier
 * binding in the page and refuses a handler whose first parameter is not
 * event-shaped. Inline arrows and anonymous functions are not bindings of a
 * named handler and are not scanned; a named handler with no parameters is
 * fine.
 *
 *   node --test web.click-bindings.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync('web/index.html', 'utf8'));

const EVENT_NAMES = /^(e|ev|evt|event|_e|_ev|_evt|_event|_)$/;

/** A binding on a comment line is not a binding: a comment that quotes the
 *  wrong shape must not trip the scan, and commented-out code is not live.
 *  Judged by the line's start (house style opens block comments with /* and
 *  continues them with *), not by a tokenizer: the page carries regex
 *  literals with quotes in them, which fooled the first version of this. */
function liveLine(script, at) {
  const lineStart = script.lastIndexOf('\n', at) + 1;
  return !/^\s*(\/\*|\*|\/\/)/.test(script.slice(lineStart, at));
}

function signatures(script) {
  const sigs = new Map();
  for (const m of script.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) sigs.set(m[1], m[2]);
  for (const m of script.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/g)) if (!sigs.has(m[1])) sigs.set(m[1], m[2]);
  for (const m of script.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?([A-Za-z_$][\w$]*)\s*=>/g)) if (!sigs.has(m[1])) sigs.set(m[1], m[2]);
  return sigs;
}

function suspects(script) {
  const sigs = signatures(script);
  const out = [];
  for (const m of script.matchAll(/addEventListener\('([a-z]+)',\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    const [, type, fn] = m;
    if (!liveLine(script, m.index)) continue;
    if (!sigs.has(fn)) continue; // not a function this page defines by name (e.g. a bound method); out of scope
    const first = sigs.get(fn).split(',')[0].trim().replace(/=.*$/, '').trim();
    if (first && !EVENT_NAMES.test(first)) out.push({ type, fn, first });
  }
  return out;
}

test('no bare handler bound to a DOM event takes something other than the event first', () => {
  const found = suspects(SCRIPT);
  assert.deepEqual(found, [], 'these handlers receive the event where they expect a value: ' + JSON.stringify(found));
});

test('CONTROL: the #752 shape is what this scan catches', () => {
  const wrong = "async function pjPostSend(attachment) { }\ndocument.getElementById('x').addEventListener('click', pjPostSend);";
  assert.deepEqual(suspects(wrong), [{ type: 'click', fn: 'pjPostSend', first: 'attachment' }]);
  const right = "async function pjPostSend(attachment) { }\ndocument.getElementById('x').addEventListener('click', () => pjPostSend());\nfunction onKey(e) { }\nx.addEventListener('keydown', onKey);";
  assert.deepEqual(suspects(right), []);
  const commented = "/* el.addEventListener('click', pjPostSend) was the bug */\n * el.addEventListener('click', pjPostSend) quoted again\n// el.addEventListener('click', pjPostSend)\nasync function pjPostSend(attachment) { }\nel.addEventListener('click', () => pjPostSend());";
  assert.deepEqual(suspects(commented), [], 'a comment line tripped the scan');
});

test('the scan sees the page: it found a real number of bindings', () => {
  const n = [...SCRIPT.matchAll(/addEventListener\('([a-z]+)',\s*([A-Za-z_$][\w$]*)\s*[,)]/g)].length;
  assert.ok(n >= 20, 'only ' + n + ' bare bindings found; the page or the pattern changed');
});
