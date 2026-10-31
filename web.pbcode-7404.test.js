'use strict';
/**
 * kosmos#7404 (backupscreens-7404, challenge round 7): the recovery code leaves the page when it should. The panel's
 * SHIPPED functions run on the fake DOM: the code shown, then gone after "I saved my recovery code", kept when that
 * confirm is refused, and gone when the Kosmos+ section hides the panel.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { scriptOf, liftAll } = require('./test-support/page');
const { makeDom } = require('./test-support/fake-dom');

const SCRIPT = scriptOf(fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8'));
const IDS = ['pb', 'pb-off', 'pb-words', 'pb-code', 'pb-onview', 'pb-restore', 'pb-price', 'pb-on-row', 'pb-restore-hint',
  'pb-words-price', 'pb-on-say', 'pb-off-ask', 'pb-off-row', 'pb-finish', 'pb-code-text', 'pb-restore-code', 'pb-msg', 'pb-code-lead'];
const CODE = 'K7QD-3MXA-9VPE-H2NW-4TBR-6YC8-JF';

function load(answer) {
  const dom = makeDom();
  for (const id of IDS) dom.add(id, id === 'pb-restore-code' ? 'textarea' : 'div');
  const pbDecl = SCRIPT.match(/var PB = \{[^\n]*\};/);
  assert.ok(pbDecl, 'var PB is gone from the page');
  const ctx = { document: dom.document, posted: [], answer };
  vm.createContext(ctx);
  vm.runInContext([pbDecl[0],
    // The network is the test's: pbPost answers what the test says, pbMaybe reads nothing.
    'async function pbPost(kind, body) { posted.push({ kind, body }); return answer; }',
    'function pbMaybe() {}',
    liftAll(SCRIPT, ['asSentence', 'pbMsg', 'pbPrice', 'pbPaint', 'pbCodeText', 'pbShowCode', 'pbSaved', 'pbFinish'])].join('\n'), ctx);
  ctx.PB.st = { shown: true, price: null, state: 'needs-key' };
  return { ctx, el: (id) => dom.document.getElementById(id) };
}

test('the code is on screen once shown, and gone (page and memory) after I saved my recovery code', async () => {
  const { ctx, el } = load({ ok: true, deleted: 1 });
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  assert.equal(el('pb-code-text').textContent, CODE, 'CONTROL: the code is shown');
  assert.equal(el('pb-code').hidden, false);
  await ctx.pbSaved();
  assert.equal(JSON.stringify(ctx.posted), JSON.stringify([{ kind: 'saved', body: { org: 'o', member: 'm' } }]));   // made in the vm realm
  assert.equal(el('pb-code-text').textContent, '', 'the code is still on the page');
  assert.equal(ctx.PB.code, null, 'the code is still held by the page');
  assert.equal(el('pb-code').hidden, true);
});

test('a refused confirm keeps the code on screen, so the person can still save it', async () => {
  const { ctx, el } = load({ ok: false, because: 'the recovery code is not registered with Kosmos+ yet' });
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  await ctx.pbSaved();
  assert.equal(el('pb-code-text').textContent, CODE);
  assert.equal(ctx.PB.code, CODE);
  assert.match(el('pb-msg').textContent, /^The recovery code is not registered/, 'the refusal said as a sentence');
});

test('the panel hiding (Kosmos+ section, switch off) drops the code and a typed one', () => {
  const { ctx, el } = load({ ok: true });
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  el('pb-restore-code').value = 'k7qd-3mxa';
  ctx.PB.st = { shown: false };
  ctx.pbPaint();
  assert.equal(el('pb').hidden, true);
  assert.equal(el('pb-code-text').textContent, '');
  assert.equal(ctx.PB.code, null);
  assert.equal(el('pb-restore-code').value, '');
});

/* #7681 item 4: Finish setting up after a restore whose key-ready write failed. The key step answers ok with no code to
   show (this computer already holds the keys), and the page says so instead of appearing to do nothing. */
test('Finish setting up on a computer that already holds the keys says the key is set up', async () => {
  const { ctx, el } = load({ ok: true });
  await ctx.pbFinish();
  assert.equal(JSON.stringify(ctx.posted.map((p) => p.kind)), JSON.stringify(['key']));
  assert.equal(el('pb-msg').textContent, 'Your backup key is set up on this computer.', 'the press said nothing');
  assert.equal(ctx.PB.code, null, 'no code was shown');
  // CONTROL: a key step that does make a code shows it, and does not claim the key was already set up.
  const shown = load({ ok: true, recoveryCode: CODE, org: 'o', member: 'm' });
  await shown.ctx.pbFinish();
  assert.equal(shown.el('pb-code-text').textContent, CODE);
  assert.doesNotMatch(shown.el('pb-msg').textContent, /already|is set up on this computer/);
});

/* #7681 item 2: Print prints THIS page with only the code (#pb-printout under body.pb-printing), never a hidden frame,
   which some browsers print as the parent page (Settings, no code). The fake window records what was there at print. */
test('Print puts the code on this page for the print only, and takes it off after', async () => {
  const { ctx, el } = load({ ok: true });
  const doc = ctx.document;
  const out = doc.createElement('div'); out.id = 'pb-printout'; doc.body.appendChild(out);
  const made = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => { made.push(String(tag).toLowerCase()); return create(tag); };
  doc.getElementById = ((get) => (id) => (id === 'pb-printout' ? out : get(id)))(doc.getElementById.bind(doc));
  const listeners = {};
  let atPrint = null;
  ctx.window = { addEventListener: (t, fn) => { listeners[t] = fn; }, print: () => { atPrint = { text: out.textContent, printing: doc.body.classList.contains('pb-printing') }; } };
  ctx.setTimeout = () => 0;
  vm.runInContext(liftAll(SCRIPT, ['pbPrint']), ctx);
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  ctx.pbPrint();
  assert.ok(atPrint, 'premise: print was called');
  assert.ok(atPrint.printing, 'the page printed without body.pb-printing, so the print rule showed the whole page');
  assert.match(atPrint.text, new RegExp(CODE.replace(/-/g, '\\-')), 'the printout did not hold the code at print time');
  assert.equal(made.includes('iframe'), false, 'it printed from a frame again');
  listeners.afterprint();
  assert.equal(out.textContent, '', 'the code stayed on the printout after printing');
  assert.equal(doc.body.classList.contains('pb-printing'), false, 'the page stayed in print mode after printing');
});
