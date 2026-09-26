'use strict';
/* #3595 phase 2: the Assigner toggle. Runs the REAL page functions (lifted from web/index.html)
 * against a stub DOM and fetch: the toggle stays hidden until the read lands, a failed read hides
 * it and says so (never a false Off), and a refused or unreachable save repaints from the store.
 *
 *   node --test web.assigner-save-3595.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const page = require('./test-support/page');

const SCRIPT = page.scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const FNS = page.liftAll(SCRIPT, ['paintAssigner', 'saveAssigner']);

/* A stub paintSwitch that behaves like the page's: null hides and strips, a boolean shows. */
function harness(fetchImpl) {
  const tog = { hidden: true, attrs: {}, getAttribute(k) { return this.attrs[k] === undefined ? null : this.attrs[k]; } };
  const msg = { textContent: '' };
  const el = { 'asg-toggle': tog, 'asg-msg': msg };
  const document = { getElementById: (id) => el[id] || null };
  const paintSwitch = (id, on) => {
    const t = el[id];
    if (on === null || on === undefined) { delete t.attrs['aria-checked']; t.hidden = true; return; }
    t.attrs['aria-checked'] = on === true ? 'true' : 'false'; t.hidden = false;
  };
  const make = new Function('document', 'fetch', 'paintSwitch',
    'let ASG_EPOCH = 0; let ASG_SAVING = false;\n' + FNS
    + '\nreturn { paintAssigner, saveAssigner, setSaving: (v) => { ASG_SAVING = v; } };');
  return { tog, msg, api: make(document, fetchImpl, paintSwitch) };
}
const settle = () => new Promise((res) => setImmediate(res));

test('a successful read shows the toggle with the stored value', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ on: true, ok: true }) }));
  await h.api.paintAssigner();
  assert.equal(h.tog.hidden, false);
  assert.equal(h.tog.getAttribute('aria-checked'), 'true');
});

test('a failed read hides the toggle and says so, never a false Off', async () => {
  const h = harness(async () => ({ ok: false, json: async () => ({}) }));
  await h.api.paintAssigner();
  assert.equal(h.tog.hidden, true);
  assert.equal(h.tog.getAttribute('aria-checked'), null, 'a failed read left an aria-checked (a confident Off)');
  assert.match(h.msg.textContent, /could not read/);
});

test('a refused save repaints from the store, and says why', async () => {
  const h = harness(async (url, opts) => (opts && opts.method === 'PUT'
    ? { ok: false, json: async () => ({ error: 'no' }) } : { ok: true, json: async () => ({ on: true, ok: true }) }));
  h.tog.attrs['aria-checked'] = 'false'; h.tog.hidden = false; // the screen showed it as off
  await h.api.saveAssigner(false);
  await settle();
  assert.equal(h.tog.getAttribute('aria-checked'), 'true', 'the toggle still shows a value the store does not hold');
  assert.equal(h.msg.textContent, 'no', 'the repaint wiped the reason the save was refused');
});

test('an unreachable save repaints from the store', async () => {
  let calls = 0;
  const h = harness(async (url, opts) => {
    calls++;
    if (opts && opts.method === 'PUT') throw new Error('offline');
    return { ok: true, json: async () => ({ on: true, ok: true }) };
  });
  h.tog.attrs['aria-checked'] = 'false';
  await h.api.saveAssigner(false);
  await settle();
  assert.equal(calls, 2, 'no repaint read after the failed save');
  assert.equal(h.tog.getAttribute('aria-checked'), 'true');
  assert.match(h.msg.textContent, /could not reach Kosmos/, 'the repaint wiped the reason the save failed');
});

test('a click while a save is in flight is refused and says so', async () => {
  let calls = 0;
  const h = harness(async () => { calls++; return { ok: true, json: async () => ({ on: true }) }; });
  h.api.setSaving(true);
  await h.api.saveAssigner(false);
  assert.equal(calls, 0);
  assert.match(h.msg.textContent, /Still saving/);
});

test('control: a successful save shows the saved value', async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ on: false, ok: true }) }));
  await h.api.saveAssigner(false);
  assert.equal(h.tog.getAttribute('aria-checked'), 'false');
  assert.equal(h.msg.textContent, '');
});
