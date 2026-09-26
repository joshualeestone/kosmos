'use strict';
/* #3595: the Recommender guard checkboxes flip before their save lands. Runs the REAL page
 * functions (lifted from web/index.html) against a stub DOM and fetch, so the failure paths are
 * executed rather than matched by regex: a failed or dropped save must put the box back to what
 * the store holds, even while the box has focus (the person just clicked it).
 *
 *   node --test web.recommender-save-3595.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const FNS = page.liftAll(SCRIPT, ['paintRecommenderFrom', 'paintRecommender', 'recUndoGuard', 'saveRecommender']);

/* A fresh copy of the functions over a stub DOM. `fetchImpl` answers each call; the store is
   what a successful GET returns. */
function harness(fetchImpl) {
  const el = {};
  for (const id of ['rec-toggle', 'rec-guards-row', 'rec-off-note', 'rec-msg']) el[id] = { id, hidden: false, textContent: '' };
  for (const k of ['money', 'public', 'delete']) el['rec-guard-' + k] = { id: 'rec-guard-' + k, checked: true };
  const document = { activeElement: null, getElementById: (id) => el[id] || null };
  const switches = [];
  const paintSwitch = (id, v) => switches.push([id, v]);
  const make = new Function('document', 'fetch', 'paintSwitch',
    "let REC_EPOCH = 0; let REC_SAVING = false; const REC_GUARDS = ['money', 'public', 'delete'];\n"
    + FNS + '\nreturn { saveRecommender, paintRecommender, setSaving: (v) => { REC_SAVING = v; } };');
  return { el, document, switches, api: make(document, fetchImpl, paintSwitch) };
}

const STORE = { on: true, guards: { money: true, public: false, delete: true } };
const okGet = () => ({ ok: true, json: async () => STORE });

test('a REFUSED guard save puts the focused box back to the stored value', async () => {
  const h = harness(async (url, opts) => (opts && opts.method === 'PUT'
    ? { ok: false, json: async () => ({ error: 'no' }) } : okGet()));
  const cb = h.el['rec-guard-public'];
  cb.checked = true; // the person just ticked it on; the store has it off
  h.document.activeElement = cb;
  await h.api.saveRecommender({ guard: 'public', value: true });
  await new Promise((res) => setImmediate(res)); // let the forced repaint's GET land
  assert.equal(cb.checked, false, 'the box still shows a guard as on that the store has off');
  assert.equal(h.el['rec-msg'].textContent, 'no', 'the repaint wiped the reason the save was refused');
});

test('an UNREACHABLE save (fetch throws) puts the box back too', async () => {
  const h = harness(async () => { throw new Error('offline'); });
  const cb = h.el['rec-guard-public'];
  cb.checked = true;
  h.document.activeElement = cb;
  await h.api.saveRecommender({ guard: 'public', value: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(cb.checked, false, 'a network failure left the flipped box standing');
});

test('a click DROPPED while another save is in flight is undone', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return okGet(); });
  h.api.setSaving(true);
  const cb = h.el['rec-guard-money'];
  cb.checked = false; // the person unticked it
  await h.api.saveRecommender({ guard: 'money', value: false });
  assert.equal(calls, 0, 'control: the dropped click did not send anything');
  assert.equal(cb.checked, true, 'a dropped click left the box unticked with nothing saved');
});

test('a refused save is undone even when a repaint started meanwhile (epoch moved)', async () => {
  let release;
  const gate = new Promise((res) => { release = res; });
  const h = harness(async (url, opts) => {
    if (opts && opts.method === 'PUT') { await gate; return { ok: false, json: async () => ({ error: 'no' }) }; }
    return okGet();
  });
  const cb = h.el['rec-guard-public'];
  cb.checked = true;
  h.document.activeElement = cb;
  const saving = h.api.saveRecommender({ guard: 'public', value: true });
  const repaint = h.api.paintRecommender(); // bumps the epoch while the PUT is in flight
  release();
  await saving; await repaint;
  await new Promise((res) => setImmediate(res));
  assert.equal(cb.checked, false, 'a refused save stayed on screen because a repaint had moved the epoch');
});

test('a toggle click dropped while saving says so', async () => {
  const h = harness(async () => okGet());
  h.api.setSaving(true);
  await h.api.saveRecommender({ on: true });
  assert.match(h.el['rec-msg'].textContent, /Still saving/);
});

test('control: a SUCCESSFUL save keeps the new value', async () => {
  const saved = { on: true, guards: { money: true, public: true, delete: true } };
  const h = harness(async () => ({ ok: true, json: async () => saved }));
  const cb = h.el['rec-guard-public'];
  cb.checked = true;
  h.document.activeElement = cb;
  await h.api.saveRecommender({ guard: 'public', value: true });
  assert.equal(cb.checked, true, 'a successful save was reverted');
});
