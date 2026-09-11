'use strict';

/**
 * kosmos#2575 (STATE half): the "Not waiting? Clear it" button clears a STALE
 * needs_you through Pete's engine route (POST /api/agent/<name>/clear-selfreport)
 * and re-reads the thread so the question comes off screen. Distinct from the
 * head "Hide" (the DISPLAY half, #2575 display: a per-session collapse that keeps
 * the safety breadcrumb because the agent IS waiting). This runs the real
 * pjClearState lifted from the page, so the wiring is exercised, not restated.
 *
 *   node --test web.pj-clear-state-2575.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const page = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/* Lift the real function and run it against stubs. The free names it closes over
   (PJ_QUESTION_AGENT, document, fetch, loadThread) become new Function params, so
   the test drives the actual shipped body rather than a copy of it. */
function harness({ target, fetchImpl }) {
  const calls = { fetch: [], loadThread: 0 };
  const btn = { disabled: false };
  const emsg = { textContent: '' };
  const document = {
    getElementById: (id) => (id === 'pj-question-clear' ? btn
      : (id === 'pj-question-clear-msg' ? emsg : null)),
  };
  const fetch = (url, opts) => { calls.fetch.push({ url, opts }); return fetchImpl(url, opts); };
  const loadThread = async () => { calls.loadThread += 1; };
  const announces = [];
  const pjAnnounce = (t) => { announces.push(t); };
  const src = page.lift(SCRIPT, 'pjClearState');
  const make = new Function('PJ_QUESTION_AGENT', 'document', 'fetch', 'loadThread', 'pjAnnounce',
    src + '\nreturn pjClearState;');
  return { run: make(target, document, fetch, loadThread, pjAnnounce), calls, btn, emsg, announces };
}

function jsonRes(ok, body) {
  return Promise.resolve({ ok, json: async () => body });
}

test('#2575: a successful clear POSTs the route and re-reads the thread', async () => {
  const h = harness({ target: 'Mara', fetchImpl: () => jsonRes(true, { ok: true, cleared: true, state: 'idle', by: 'operator' }) });
  await h.run();
  assert.equal(h.calls.fetch.length, 1, 'the clear did not call the engine route');
  const c = h.calls.fetch[0];
  assert.equal(c.url, '/api/agent/Mara/clear-selfreport', 'the wrong route (or agent) was cleared');
  assert.equal(c.opts.method, 'POST');
  assert.match(c.opts.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(c.opts.body), { reason: 'operator-dismissed' },
    'the route wants an optional {reason}; the dismiss provenance was dropped');
  assert.equal(h.calls.loadThread, 1, 'a successful clear must re-read the thread so the question comes off screen');
  assert.equal(h.btn.disabled, false, 'the button was left disabled after a success');
  assert.equal(h.emsg.textContent, '', 'a success wrote a stale error line');
});

test('#2575: cleared:false is the idempotent no-op, still a success, still refreshes (keyed on cleared/ok, never `by`)', async () => {
  // The route returns cleared:false when there was nothing sticky to clear
  // (already idle, or the agent self-cleared in a race). That still means the
  // agent is not-waiting, so the thread must refresh -- and `by` (here 'auto',
  // not 'operator') must NOT be read as a failure signal.
  const h = harness({ target: 'Mara', fetchImpl: () => jsonRes(true, { ok: true, cleared: false, state: null, by: 'auto' }) });
  await h.run();
  assert.equal(h.calls.loadThread, 1, 'the idempotent no-op still means not-waiting, so the thread must refresh');
  assert.equal(h.emsg.textContent, '', 'the documented idempotent path was treated as an error');
});

test('#2575: a rejected response surfaces a message, announces it, does not refresh, and re-enables', async () => {
  const h = harness({ target: 'Mara', fetchImpl: () => jsonRes(false, { ok: false, because: 'that self-report could not be cleared' }) });
  await h.run();
  assert.equal(h.calls.loadThread, 0, 'a failed clear pretended the state changed');
  assert.match(h.emsg.textContent, /could not clear/i, 'a failed clear was swallowed silently -- the false-progress this page is built against');
  // Routed through pjAnnounce (not just the visible span), so a repeated identical
  // failure still re-announces for screen readers (the round-33 lesson).
  assert.equal(h.announces.length, 1, 'the failure did not announce through pjAnnounce');
  assert.equal(h.announces[0], h.emsg.textContent, 'the announced text and the visible text drifted apart');
  assert.equal(h.btn.disabled, false, 'the button stayed disabled after a failure, so a retry is impossible');
});

test('#2575: a thrown fetch is caught, messaged, announced, and the button re-enabled', async () => {
  const h = harness({ target: 'Mara', fetchImpl: () => Promise.reject(new Error('offline')) });
  await h.run();
  assert.equal(h.calls.loadThread, 0);
  assert.match(h.emsg.textContent, /could not clear/i);
  assert.equal(h.announces.length, 1, 'a thrown fetch did not announce through pjAnnounce');
  assert.equal(h.btn.disabled, false);
});

test('#2575: no painted question means no target, so the click is a no-op', async () => {
  const h = harness({ target: null, fetchImpl: () => jsonRes(true, { ok: true, cleared: true }) });
  await h.run();
  assert.equal(h.calls.fetch.length, 0, 'a click with no waiting flag on screen still hit the engine');
});

test('#2575: the clear target follows the painted question (paintThread sets PJ_QUESTION_AGENT from body.asking, nulls it otherwise)', () => {
  assert.match(SCRIPT,
    /PJ_QUESTION_AGENT = body\.asking \? \(\(body\.agent && body\.agent\.sessionName\) \|\| null\) : null;/,
    'paintThread no longer captures the asking agent into PJ_QUESTION_AGENT; the clear button could target a stale or wrong agent');
});

test('#2575: pjClearState never keys on `by` (provenance) -- only ok/cleared, per Pete\'s contract', () => {
  const src = page.lift(SCRIPT, 'pjClearState');
  assert.doesNotMatch(src, /\.by\b/,
    'pjClearState reads a `.by` property; the contract keys on `cleared`/ok, not provenance');
});

test('#2575: the state-clear button ships inside the question block (#2691 removed the separate head Hide)', () => {
  assert.match(PAGE, /id="pj-question-clear"/, 'the state-clear button markup is gone');
  const q = PAGE.indexOf('id="pj-question"');
  const clear = PAGE.indexOf('id="pj-question-clear"');
  assert.ok(q > 0 && clear > q, 'the clear button is not inside the #pj-question block');
  // #2691 removed the head "Hide" (the DISPLAY half); this STATE-clear control is
  // now the only per-agent dismiss affordance, and it lives in the question block.
  assert.equal(PAGE.indexOf('id="pj-thread-hide"'), -1,
    'the head "Hide" button is back; #2691 removed it as part of the Off-mode walk-back');
});
