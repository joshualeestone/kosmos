'use strict';
/**
 * PR-C2 (#2037 + #2020): install-flow Screen 6 "self-improving" consent switches.
 * Renet's install-flow ships the Screen 6 MARKUP (two s6-sw pill SPANS,
 * #fr-s6-feedback / #fr-s6-createping, role=switch, aria-checked default-ON). This
 * pins the BEHAVIOR PR-C2 wires in.
 *
 * Two layers:
 *  - STRUCTURE (source-grep): the markup is default-ON, the copies are present, and
 *    the frGo step-6 branch refreshes on show.
 *  - BEHAVIOR (runtime): the real handlers, lifted out of the page and run against a
 *    DOM stub + a mocked fetch, so the subtle control flow is actually exercised, not
 *    just matched as text -- the optimistic flip, the revert on a failed/thrown PUT
 *    (the "never a false Off" property), the refresh painting the backend state, and
 *    the keyboard (Space/Enter) path a role=switch requires.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const page = require('./test-support/page');
const RAW = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(RAW);
const lift = (name) => page.lift(SCRIPT, name);
function codeOnly(src) {
  return src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
}
const PAGE = codeOnly(RAW);

/* ---- structure ---------------------------------------------------------- */

test('Screen 6 ships the two consent switches as default-ON role=switch spans', () => {
  assert.match(PAGE, /id="fr-s6-feedback"[^>]*role="switch"[^>]*aria-checked="true"/, 'feedback switch missing or not default-ON');
  assert.match(PAGE, /id="fr-s6-createping"[^>]*role="switch"[^>]*aria-checked="true"/, 'create-ping switch missing or not default-ON');
});

test('Screen 6 carries the signed-off eyebrow, headline and both switch copies', () => {
  assert.match(PAGE, /Self improving/i, 'the eyebrow is missing');
  assert.match(PAGE, /Help make Kosmos work better for everyone/, 'the headline is missing');
  assert.match(PAGE, /Have an agent send a daily report with any bugs or improvement suggestions\./, 'the feedback copy is missing');
  assert.match(PAGE, /Let Kosmos know when you create an agent\./, 'the create-ping copy is missing');
});

test('the frGo step-6 branch refreshes both switches on show (so default-ON paints)', () => {
  const frGo = lift('frGo');
  const s6 = frGo.slice(frGo.indexOf('step === 6'));
  const nextBranch = s6.indexOf('step === 7');
  const branch = nextBranch > -1 ? s6.slice(0, nextBranch) : s6;
  assert.match(branch, /frRefreshFeedback\(\)/, 'frGo step 6 does not call frRefreshFeedback');
  assert.match(branch, /frRefreshPing\(\)/, 'frGo step 6 does not call frRefreshPing');
});

/* ---- behavior (runtime) -------------------------------------------------
 * Lift the S6 block (the six functions + the top-level bind IIFE) and run it
 * against a DOM stub, the way web.add-project.test.js runs painters. `document`
 * and `fetch` are injected as new-Function params, so the handlers close over
 * the stubs. Each load() re-evals fresh, resetting the module-level epoch/saving
 * state, so arms cannot leak into each other.
 * ---------------------------------------------------------------------- */

function mkEl(checked) {
  return {
    attrs: { 'aria-checked': checked },
    listeners: {},
    getAttribute(k) { return this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  };
}

function load(opts = {}) {
  const els = {
    'fr-s6-feedback': mkEl(opts.fb === undefined ? 'true' : opts.fb),
    'fr-s6-createping': mkEl(opts.ping === undefined ? 'true' : opts.ping),
  };
  const documentStub = { getElementById: (id) => els[id] || null };
  const calls = [];
  let impl = async () => ({ ok: true, json: async () => ({}) });
  const fetchStub = (...a) => { calls.push(a); return impl(...a); };
  const setFetch = (fn) => { impl = fn; };
  const a = SCRIPT.indexOf('function frSwOn');
  const b = SCRIPT.indexOf('})();', SCRIPT.indexOf("wire('fr-s6-createping'")) + 5;
  assert.ok(a >= 0 && b > 4, 'the S6 behavior block was found in the page (region markers held)');
  const region = SCRIPT.slice(a, b);
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch',
    region + '\nreturn { frFeedbackToggle, frPingToggle, frRefreshFeedback, frRefreshPing };')(documentStub, fetchStub);
  return { els, calls, setFetch, api };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

test('toggle: ON -> off flips aria-checked and PUTs {on:false} to its own backend', async () => {
  const { els, calls, setFetch, api } = load();
  setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: true }) }));
  await api.frFeedbackToggle();
  assert.equal(els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'the switch flipped Off');
  const put = calls.find((c) => c[0] === '/api/feedback-setting' && c[1] && c[1].method === 'PUT');
  assert.ok(put, 'a PUT reached /api/feedback-setting');
  assert.deepEqual(JSON.parse(put[1].body), { on: false }, 'the PUT body carries the new state');
});

test('toggle: the ping switch targets /api/ping-setting, not the feedback one', async () => {
  const { calls, setFetch, api } = load();
  setFetch(async () => ({ ok: true, json: async () => ({ on: false }) }));
  await api.frPingToggle();
  assert.ok(calls.some((c) => c[0] === '/api/ping-setting' && c[1] && c[1].method === 'PUT'), 'ping PUT hit /api/ping-setting');
  assert.ok(!calls.some((c) => c[0] === '/api/feedback-setting'), 'the ping toggle did not touch the feedback backend');
});

test('never a false Off: a non-ok PUT reverts to the default-ON position', async () => {
  const { els, setFetch, api } = load();
  setFetch(async () => ({ ok: false, json: async () => ({}) }));
  await api.frFeedbackToggle();
  assert.equal(els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'a failed PUT left it ON, never a false Off');
});

test('never a false Off: a thrown PUT reverts to the default-ON position', async () => {
  const { els, setFetch, api } = load();
  setFetch(async () => { throw new Error('network down'); });
  await api.frPingToggle();
  assert.equal(els['fr-s6-createping'].getAttribute('aria-checked'), 'true', 'a thrown PUT left it ON, never a false Off');
});

test('refresh: a backend on:false paints the switch Off; a non-ok GET leaves the default-ON', async () => {
  const off = load();
  off.setFetch(async () => ({ ok: true, json: async () => ({ on: false }) }));
  await off.api.frRefreshFeedback();
  assert.equal(off.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'refresh painted the persisted Off');

  const bad = load();
  bad.setFetch(async () => ({ ok: false, json: async () => ({}) }));
  await bad.api.frRefreshPing();
  assert.equal(bad.els['fr-s6-createping'].getAttribute('aria-checked'), 'true', 'a non-ok GET never paints a false Off');
});

test('keyboard: Space fires the toggle and prevents default scroll (role=switch is keyboard-operable)', async () => {
  const ctx = load();
  ctx.setFetch(async () => ({ ok: true, json: async () => ({ on: false }) }));
  const kd = ctx.els['fr-s6-feedback'].listeners.keydown;
  assert.ok(kd && kd.length, 'a keydown listener was bound to the feedback switch');
  let prevented = false;
  kd[0]({ key: ' ', preventDefault() { prevented = true; } });
  await flush();
  assert.ok(prevented, 'Space called preventDefault (no page scroll)');
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'Space toggled the switch');
});

test('keyboard: Enter fires the toggle too; a non-toggle key does nothing', async () => {
  const ctx = load();
  ctx.setFetch(async () => ({ ok: true, json: async () => ({ on: false }) }));
  const kd = ctx.els['fr-s6-createping'].listeners.keydown;
  assert.ok(kd && kd.length, 'a keydown listener was bound to the ping switch');
  kd[0]({ key: 'a', preventDefault() {} });
  await flush();
  assert.equal(ctx.els['fr-s6-createping'].getAttribute('aria-checked'), 'true', 'a non-toggle key did not toggle');
  kd[0]({ key: 'Enter', preventDefault() {} });
  await flush();
  assert.equal(ctx.els['fr-s6-createping'].getAttribute('aria-checked'), 'false', 'Enter toggled the switch');
});

test('both switches bind a click listener (mouse-operable)', () => {
  const { els } = load();
  assert.ok((els['fr-s6-feedback'].listeners.click || []).length, 'the feedback switch has a click listener');
  assert.ok((els['fr-s6-createping'].listeners.click || []).length, 'the ping switch has a click listener');
});
