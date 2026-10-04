'use strict';
/**
 * #2037 (+ #11, 0.6.39): install-flow Screen 6 "self-improving" consent switch.
 * The install-flow ships the Screen 6 MARKUP (an s6-sw pill SPAN, #fr-s6-feedback,
 * role=switch, aria-checked default-ON). This pins the BEHAVIOR wired in.
 *
 * #11 (0.6.39) removed the SECOND switch (#fr-s6-createping, "Let Kosmos know when
 * you create an agent") from this screen per Josh; it belongs on the
 * Create-an-Agent screen (#2020). #2623: that create-agent telemetry, and its
 * /api/ping-setting backend, were later deleted entirely (Josh, 2026-09-09,
 * "invasion of privacy"), so the ping assertions that used to live here are gone.
 *
 * #4820 (Josh, 2026-09-30) added a second switch directly under it, #fr-s6-community,
 * the Kosmos Community setting (/api/community-setting, default ON), wired the same way
 * with its own epoch. Its arms are at the bottom.
 *
 * Two layers:
 *  - STRUCTURE (source-grep): the markup is default-ON, the copy is present, and
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

test('Screen 6 ships the feedback consent switch as a default-ON role=switch span', () => {
  assert.match(PAGE, /id="fr-s6-feedback"[^>]*role="switch"[^>]*aria-checked="true"/, 'feedback switch missing or not default-ON');
});

test('Screen 6 has exactly TWO switches: feedback, then Community directly under it (#11, #4820)', () => {
  assert.doesNotMatch(PAGE, /id="fr-s6-createping"/, 'the create-ping switch was removed from this screen (#11); it must not be back');
  const rows = (PAGE.match(/class="s6-switch-row"/g) || []).length;
  assert.equal(rows, 2, 'Screen 6 should have exactly two switch rows after #4820; found ' + rows);
  assert.match(PAGE, /id="fr-s6-community"[^>]*role="switch"[^>]*aria-checked="true"[^>]*tabindex="0"/, 'the Community switch is missing or not default-ON');
  // Directly under the feedback row: the next row after the feedback switch's row is the Community one.
  const pane = PAGE.slice(PAGE.indexOf('id="fr-pane-6"'), PAGE.indexOf('id="fr-pane-7"'));
  assert.match(pane, /id="fr-s6-feedback-lbl"[^<]*<\/span>\s*<\/div>\s*<div class="s6-switch-row">\s*<span class="s6-sw" id="fr-s6-community"/, 'the Community switch is not the row directly under the feedback switch');
});

test('Screen 6 carries the signed-off eyebrow, headline and the feedback switch copy', () => {
  assert.match(PAGE, /Self improving/i, 'the eyebrow is missing');
  assert.match(PAGE, /Help make Kosmos better/, 'the headline is missing or not the #11 copy');
  assert.match(PAGE, /Send daily diagnostic information, bug reports, and improvement recommendations\./, 'the feedback body copy is missing or not the #11 copy');
  assert.doesNotMatch(PAGE, /Let Kosmos know when you create an agent\./, 'the removed create-ping copy is still present');
  assert.match(PAGE, /id="fr-s6-community-lbl">Let your agents join the Kosmos\+ community to help make Kosmos better\.<\/span>/, 'the Community switch label is not Josh\'s line, verbatim');
});

test('the frGo step-6 branch refreshes the feedback switch on show (so default-ON paints)', () => {
  const frGo = lift('frGo');
  const s6 = frGo.slice(frGo.indexOf('step === 6'));
  const nextBranch = s6.indexOf('step === 7');
  const branch = nextBranch > -1 ? s6.slice(0, nextBranch) : s6;
  assert.match(branch, /frRefreshFeedback\(\)/, 'frGo step 6 does not call frRefreshFeedback');
  assert.match(branch, /frRefreshCommunity\(\)/, 'frGo step 6 does not call frRefreshCommunity (#4820)');
  assert.doesNotMatch(branch, /frRefreshPing\(\)/, 'frGo step 6 still calls the removed frRefreshPing');
});

/* ---- behavior (runtime) -------------------------------------------------
 * Lift the S6 block (frSwOn/frSwSet + the feedback functions + the top-level bind
 * IIFE) and run it against a DOM stub, the way web.add-project.test.js runs
 * painters. `document` and `fetch` are injected as new-Function params, so the
 * handlers close over the stubs. Each load() re-evals fresh, resetting the
 * module-level epoch/saving state, so arms cannot leak into each other.
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
    'fr-s6-community': mkEl(opts.cm === undefined ? 'true' : opts.cm),
  };
  const documentStub = { getElementById: (id) => els[id] || null };
  const calls = [];
  let impl = async () => ({ ok: true, json: async () => ({}) });
  const fetchStub = (...a) => { calls.push(a); return impl(...a); };
  const setFetch = (fn) => { impl = fn; };
  const a = SCRIPT.indexOf('function frSwOn');
  const b = SCRIPT.indexOf('})();', SCRIPT.indexOf("wire('fr-s6-community'")) + 5;
  assert.ok(a >= 0 && b > 4, 'the S6 behavior block was found in the page (region markers held)');
  const region = SCRIPT.slice(a, b);
  // eslint-disable-next-line no-new-func
  const api = new Function('document', 'fetch',
    region + '\nreturn { frFeedbackToggle, frRefreshFeedback, frCommunityToggle, frRefreshCommunity };')(documentStub, fetchStub);
  return { els, calls, setFetch, api };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
function deferred() { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; }

test('toggle: ON -> off flips aria-checked and PUTs {on:false} to /api/feedback-setting', async () => {
  const { els, calls, setFetch, api } = load();
  setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: true }) }));
  await api.frFeedbackToggle();
  assert.equal(els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'the switch flipped Off');
  const put = calls.find((c) => c[0] === '/api/feedback-setting' && c[1] && c[1].method === 'PUT');
  assert.ok(put, 'a PUT reached /api/feedback-setting');
  assert.deepEqual(JSON.parse(put[1].body), { on: false }, 'the PUT body carries the new state');
});

test('never a false Off: a non-ok PUT is attempted, then reverts to the default-ON position', async () => {
  const { els, calls, setFetch, api } = load();
  setFetch(async () => ({ ok: false, json: async () => ({}) }));
  await api.frFeedbackToggle();
  assert.ok(calls.some((c) => c[1] && c[1].method === 'PUT'), 'a PUT was actually attempted (not a silent no-op)');
  assert.equal(els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'a failed PUT left it ON, never a false Off');
});

test('never a false Off: a thrown PUT is attempted, then reverts to the default-ON position', async () => {
  const { els, calls, setFetch, api } = load();
  setFetch(async () => { throw new Error('network down'); });
  await api.frFeedbackToggle();
  assert.ok(calls.some((c) => c[0] === '/api/feedback-setting' && c[1] && c[1].method === 'PUT'), 'a PUT was actually attempted');
  assert.equal(els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'a thrown PUT left it ON, never a false Off');
});

test('refresh: a backend on:false paints the switch Off; a non-ok GET leaves the default-ON', async () => {
  const off = load();
  off.setFetch(async () => ({ ok: true, json: async () => ({ on: false }) }));
  await off.api.frRefreshFeedback();
  assert.equal(off.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'refresh painted the persisted Off');

  const bad = load();
  bad.setFetch(async () => ({ ok: false, json: async () => ({}) }));
  await bad.api.frRefreshFeedback();
  assert.equal(bad.els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'a non-ok GET never paints a false Off');
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
  const kd = ctx.els['fr-s6-feedback'].listeners.keydown;
  assert.ok(kd && kd.length, 'a keydown listener was bound to the feedback switch');
  kd[0]({ key: 'a', preventDefault() {} });
  await flush();
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'a non-toggle key did not toggle');
  kd[0]({ key: 'Enter', preventDefault() {} });
  await flush();
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'Enter toggled the switch');
});

test('the feedback switch binds a click listener (mouse-operable)', () => {
  const { els } = load();
  assert.ok((els['fr-s6-feedback'].listeners.click || []).length, 'the feedback switch has a click listener');
});

test('epoch guard: a superseded slow response does not repaint over a newer one', async () => {
  const ctx = load();
  const slow = deferred();
  ctx.setFetch(() => slow.promise);          // first refresh: slow, resolves last
  const p1 = ctx.api.frRefreshFeedback();    // captures epoch N, awaits the slow read
  ctx.setFetch(async () => ({ ok: true, json: async () => ({ on: true }) }));
  await ctx.api.frRefreshFeedback();         // epoch N+1, paints ON (the newer answer)
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'the newer read painted ON');
  // now the STALE first read finally arrives saying Off -- it must be ignored.
  slow.resolve({ ok: true, json: async () => ({ on: false }) });
  await p1; await flush();
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'the superseded response did not repaint Off');
});

test('re-entrancy guard: a second toggle while a PUT is in flight is dropped (one PUT, one flip)', async () => {
  const ctx = load();
  const hang = deferred();
  ctx.setFetch(() => hang.promise);          // the PUT hangs, holding SAVING true
  const p1 = ctx.api.frFeedbackToggle();     // SAVING=true, optimistic flip to Off
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'the first toggle flipped optimistically');
  // Fire the second WITHOUT awaiting: with the guard it short-circuits synchronously;
  // without the guard it would proceed and send a second PUT (caught by the count
  // below), rather than hanging the test on the still-pending first fetch.
  ctx.api.frFeedbackToggle();                // SAVING true -> short-circuits, no second flip/PUT
  await flush();
  const puts = ctx.calls.filter((c) => c[1] && c[1].method === 'PUT').length;
  assert.equal(puts, 1, 'only one PUT was sent while the first was in flight');
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'the dropped second click did not flip it back');
  hang.resolve({ ok: true, json: async () => ({ on: false }) });
  await p1; await flush();
  assert.equal(ctx.els['fr-s6-feedback'].getAttribute('aria-checked'), 'false', 'final state settles Off');
});

/* ---- #4820: the Community switch (#fr-s6-community) ----------------------------- */

test('#4820 community toggle: ON -> off flips it and PUTs {on:false} to /api/community-setting, and leaves feedback alone', async () => {
  const { els, calls, setFetch, api } = load();
  setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: true, share: null }) }));
  await api.frCommunityToggle();
  assert.equal(els['fr-s6-community'].getAttribute('aria-checked'), 'false', 'the switch flipped Off');
  const puts = calls.filter((c) => c[1] && c[1].method === 'PUT');
  assert.equal(puts.length, 1, 'exactly one PUT');
  assert.equal(puts[0][0], '/api/community-setting', 'the PUT went somewhere else');
  assert.deepEqual(JSON.parse(puts[0][1].body), { on: false }, 'the PUT body carries the new state');
  assert.equal(els['fr-s6-feedback'].getAttribute('aria-checked'), 'true', 'the feedback switch moved too');
});

test('#4820 community toggle: a refused or thrown PUT reverts to ON, never a false Off', async () => {
  for (const impl of [async () => ({ ok: false, json: async () => ({ error: 'we could not save that setting' }) }), async () => { throw new Error('network down'); }]) {
    const { els, calls, setFetch, api } = load();
    setFetch(impl);
    await api.frCommunityToggle();
    assert.ok(calls.some((c) => c[0] === '/api/community-setting' && c[1] && c[1].method === 'PUT'), 'a PUT was actually attempted');
    assert.equal(els['fr-s6-community'].getAttribute('aria-checked'), 'true', 'a failed PUT left it Off');
  }
});

test('#4820 community refresh: a read Off paints Off, ok:false included (it is not sharing); a non-ok GET or a throw leaves the default ON', async () => {
  const off = load();
  off.setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: true, share: null }) }));
  await off.api.frRefreshCommunity();
  assert.equal(off.els['fr-s6-community'].getAttribute('aria-checked'), 'false', 'refresh did not paint the saved Off');
  assert.equal(off.calls[0][0], '/api/community-setting', 'the refresh read somewhere else');
  // #4820 review 1: ok:false still carries the true on:false (an unreadable file means nothing is shared), so it paints Off,
  // as the diagnostics switch does; the consent screen must not show ON while nothing is shared.
  const bad = load();
  bad.setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: false, share: null }) }));
  await bad.api.frRefreshCommunity();
  assert.equal(bad.els['fr-s6-community'].getAttribute('aria-checked'), 'false', 'an unreadable setting was shown ON on the consent screen while nothing is shared');
  for (const impl of [async () => ({ ok: false, json: async () => ({}) }), async () => { throw new Error('down'); }]) {
    const c = load();
    c.setFetch(impl);
    await c.api.frRefreshCommunity();
    assert.equal(c.els['fr-s6-community'].getAttribute('aria-checked'), 'true', 'a could-not-read painted a false Off');
  }
});

test('#4820 community: click and Space/Enter are bound', async () => {
  const ctx = load();
  ctx.setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: true }) }));
  assert.ok((ctx.els['fr-s6-community'].listeners.click || []).length, 'no click listener');
  const kd = ctx.els['fr-s6-community'].listeners.keydown;
  assert.ok(kd && kd.length, 'no keydown listener');
  let prevented = false;
  kd[0]({ key: ' ', preventDefault() { prevented = true; } });
  await flush();
  assert.ok(prevented, 'Space did not preventDefault');
  assert.equal(ctx.els['fr-s6-community'].getAttribute('aria-checked'), 'false', 'Space did not toggle');
});

test('#4820 community epoch: a slow refresh cannot repaint over a toggle, and the two switches keep separate epochs', async () => {
  const ctx = load();
  const slow = deferred();
  ctx.setFetch(() => slow.promise);
  const p1 = ctx.api.frRefreshCommunity();   // slow read, will say ON
  ctx.setFetch(async () => ({ ok: true, json: async () => ({ on: false, ok: true }) }));
  await ctx.api.frCommunityToggle();         // the person turns it Off meanwhile
  assert.equal(ctx.els['fr-s6-community'].getAttribute('aria-checked'), 'false');
  // A feedback refresh in between must not bump the Community epoch (each switch has its own).
  await ctx.api.frRefreshFeedback();
  slow.resolve({ ok: true, json: async () => ({ on: true, ok: true }) });
  await p1; await flush();
  assert.equal(ctx.els['fr-s6-community'].getAttribute('aria-checked'), 'false', 'the stale read repainted ON over the person\'s Off');
});
