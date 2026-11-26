'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/* kosmos#8719 part 2: the page's side of "Link this window to Kosmos" (linkSubmit), run against a stand-in page and a
   stand-in fetch: the POST it sends, where a refusal and a success are said, the button while a request is out, and
   that it never pulls the person back to an agent they moved away from. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const page = require('./test-support/page');

/* The open agent (CURRENT) is a real card from test-support/fleet, never a hand-built one (fixture-discipline). */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-linksubmit-8719-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const fleet = require('./test-support/fleet');
const BOARD = fleet.install([fleet.agent('zara'), fleet.agent('other')]);
test.after(() => { fleet.restore(); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const cardOf = (name) => {
  const c = BOARD.agents.find((a) => a.sessionName === name);
  if (!c) throw new Error('fleet has no card for ' + name);
  return c;
};

const SCRIPT = page.scriptOf(fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8'));
const BODY = page.lift(SCRIPT, 'linkSubmit');

function world(opts) {
  const o = opts || {};
  const el = (id) => ({ id, textContent: '', disabled: false, dataset: {}, focused: 0, focus() { this.focused += 1; } });
  const els = { 'd-link': el('d-link'), 'd-link-btn': el('d-link-btn'), 'd-link-msg': el('d-link-msg'), 'd-say-msg': el('d-say-msg'), 'd-say': el('d-say') };
  els['d-link'].dataset.agent = o.showing == null ? 'zara' : o.showing;
  const sent = [];
  const seen = { opened: [], ticks: 0, btnDuring: null };
  const fetch = async (url, init) => {
    sent.push({ url, init });
    seen.btnDuring = els['d-link-btn'].disabled;
    if (o.unreached) throw new Error('offline');
    if (o.moveTo) els['d-link'].dataset.agent = o.moveTo;   // the person moved while the request was out
    return { ok: o.status === 200, json: async () => o.answer };
  };
  const run = new Function('document', 'fetch', 'tick', 'openDetail', 'CURRENT',
    `${BODY}\nreturn linkSubmit;`)({ getElementById: (id) => els[id] || null }, fetch,
    async () => { seen.ticks += 1; }, (n) => { seen.opened.push(n); }, cardOf(o.current == null ? 'zara' : o.current));
  return { run, els, sent, seen };
}

test('#8719: the page posts { confirm: true } to the agent\'s link route, with the button off while it is out', async () => {
  const w = world({ status: 200, answer: { outcome: 'linked', session: 'zara', name: 'zara' } });
  assert.equal(await w.run('zara'), 'linked');
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].url, '/api/agent/zara/link');
  assert.equal(w.sent[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(w.sent[0].init.body), { confirm: true });
  assert.equal(w.seen.btnDuring, true, 'the button was live while the request was out');
  assert.equal(w.els['d-link-btn'].disabled, false, 'and comes back');
  assert.deepEqual(w.seen.opened, ['zara'], 'the page reopens on the linked agent');
  assert.equal(w.els['d-say-msg'].textContent, 'zara is linked. Kosmos can message it now.');
  assert.equal(w.els['d-say'].focused, 1, 'focus moves to the composer');
});

test('#8719: success never pulls the person back to an agent they moved away from; CONTROL above stays', async () => {
  const w = world({ status: 200, answer: { outcome: 'linked' }, current: 'other' });
  assert.equal(await w.run('zara'), 'linked');
  assert.deepEqual(w.seen.opened, [], 'it reopened zara over the agent they moved to');
  assert.equal(w.els['d-say-msg'].textContent, '');
});

test('#8719: a refusal says the server\'s reason on that agent\'s page, and only there', async () => {
  const w = world({ status: 409, answer: { outcome: 'refused', because: 'The window called zara is running vim, not Claude.' } });
  assert.equal(await w.run('zara'), 'refused');
  assert.equal(w.els['d-link-msg'].textContent, 'The window called zara is running vim, not Claude.');
  assert.equal(w.els['d-link-btn'].disabled, false);
  const moved = world({ status: 409, answer: { outcome: 'refused', because: 'about zara' }, moveTo: 'beta' });
  await moved.run('zara');
  assert.notEqual(moved.els['d-link-msg'].textContent, 'about zara', "zara's refusal was written on beta's page");
  const off = world({ unreached: true });
  assert.equal(await off.run('zara'), 'unreached');
  assert.equal(off.els['d-link-msg'].textContent, 'We could not reach Kosmos to link it.');
  assert.equal(off.els['d-link-btn'].disabled, false, 'the button comes back after a failure too');
});
