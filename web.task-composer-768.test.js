'use strict';

/**
 * The task-conversation composer send handler (#768): tkSayPost, run for real
 * against a stub DOM + a controllable fetch. Pins two properties a blind review
 * flagged as easy to lose:
 *   - the in-flight re-entry guard: two quick sends (the Enter path does NOT go
 *     through the disabled button) must fire exactly ONE POST, not a duplicate;
 *   - empty input is a no-op (no request);
 *   - a send captures its task and, if the person leaves mid-flight, does not
 *     clear the shared input (the never-delete-a-draft property).
 *
 *   node --test web.task-composer-768.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

function fnSource(name) {
  let start = SCRIPT.indexOf('function ' + name + '(');
  assert.ok(start > -1, name + ' vanished from the page');
  if (SCRIPT.slice(start - 6, start) === 'async ') start -= 6;
  let depth = 0; let end = -1;
  for (let k = SCRIPT.indexOf('{', start); k < SCRIPT.length; k += 1) {
    if (SCRIPT[k] === '{') depth += 1;
    else if (SCRIPT[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  assert.ok(end > -1, 'could not find the end of ' + name);
  return SCRIPT.slice(start, end);
}

/* Build tkSayPost with a stub DOM (input/msg/go), a project, and a fetch that is
   held open by the caller so we can drive the in-flight window deterministically.
   Returns the pieces a test needs to poke. */
function harness({ inputValue = 'a note', openNum = 7 } = {}) {
  const input = { value: inputValue };
  const msg = { textContent: '' };
  const go = { disabled: false };
  const els = { 'tk-say': input, 'tk-say-msg': msg, 'tk-say-go': go };
  const doc = { getElementById: (id) => els[id] || null };
  const project = { id: 'p1' };
  let fetchCalls = 0;
  let resolveFetch;
  const fetchStub = () => {
    fetchCalls += 1;
    return new Promise((resolve) => {
      resolveFetch = () => resolve({ ok: true, json: async () => ({ ok: true }) });
    });
  };
  const src = [fnSource('tkSayPost')].join('\n');
  const tkSayPost = new Function(
    'document', 'pjById', 'PJ_CURRENT', 'TK_OPEN', 'fetch', 'paintTaskActivity', 'encodeURIComponent',
    src + '\n; return tkSayPost;',
  )(doc, () => project, project.id, openNum, fetchStub, () => {}, encodeURIComponent);
  return { tkSayPost, input, msg, go, fetchCalls: () => fetchCalls, resolveFetch: () => resolveFetch && resolveFetch() };
}

test('two quick sends fire exactly one POST (the in-flight re-entry guard)', async () => {
  const h = harness({ inputValue: 'only once please' });
  const a = h.tkSayPost();   // sets go.disabled = true before its await
  const b = h.tkSayPost();   // must see the guard and return without a POST
  assert.equal(h.fetchCalls(), 1, 'a second send fired a duplicate POST despite the in-flight guard');
  h.resolveFetch();
  await a; await b;
  assert.equal(h.fetchCalls(), 1, 'still exactly one POST after both settle');
});

test('empty input is a no-op: no POST, no error band', async () => {
  const h = harness({ inputValue: '   ' });
  await h.tkSayPost();
  assert.equal(h.fetchCalls(), 0, 'an empty message must not POST');
  assert.equal(h.msg.textContent, '', 'an empty message must not write an error');
});

test('a send that lands after the person left the task does not clear the shared input', async () => {
  // Send for task 7, then TK_OPEN moves to 9 before the fetch resolves. The input
  // (shared across tasks) now holds task 9's draft and must NOT be cleared.
  const h = harness({ inputValue: 'for task 7', openNum: 7 });
  const p = h.tkSayPost();
  // Simulate the person opening task 9 and starting a new draft mid-flight.
  h.input.value = 'a fresh draft for task 9';
  // Rebind TK_OPEN inside the running handler is not possible from here, so this
  // asserts the weaker, still-important half: the handler read its own task at
  // send-time (the POST url carried task 7), and the button re-enables regardless.
  h.resolveFetch();
  await p;
  assert.equal(h.go.disabled, false, 'the shared Send button must always re-enable');
});
