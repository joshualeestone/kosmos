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
  'pb-words-price', 'pb-on-say', 'pb-off-ask', 'pb-off-row', 'pb-finish', 'pb-code-text', 'pb-restore-code', 'pb-msg', 'pb-code-lead',
  'pb-backsup', 'pb-backsup-head', 'pb-readers', 'pb-never'];
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
    liftAll(SCRIPT, ['asSentence', 'pbMsg', 'pbPrice', 'pbPaint', 'pbCodeText', 'pbShowCode', 'pbSaved', 'pbFinish', 'pbPrintClear'])].join('\n'), ctx);
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
  const made = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => { const e = create(tag); made.push(e); e.tag = String(tag).toLowerCase(); return e; };
  // #7681 suite: the page makes the printout as it prints (a static child of body broke the grid's 42 rows).
  const printout = () => made.find((e) => e.id === 'pb-printout');
  const listeners = {};
  let atPrint = null;
  ctx.window = { addEventListener: (t, fn) => { listeners[t] = fn; }, removeEventListener: (t) => { delete listeners[t]; }, print: () => {
    const out = printout();
    atPrint = { text: out ? out.textContent : '', inBody: Boolean(out && out.parent === doc.body), printing: doc.body.classList.contains('pb-printing') };
  } };
  ctx.setTimeout = () => 0;
  vm.runInContext(liftAll(SCRIPT, ['pbPrint']), ctx);
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  ctx.pbPrint();
  assert.ok(atPrint, 'premise: print was called');
  assert.ok(atPrint.inBody, 'the printout was not a direct child of body at print time (the print rule hides only body\'s other children)');
  assert.ok(atPrint.printing, 'the page printed without body.pb-printing, so the print rule showed the whole page');
  assert.match(atPrint.text, new RegExp(CODE.replace(/-/g, '\\-')), 'the printout did not hold the code at print time');
  assert.equal(made.some((e) => e.tag === 'iframe'), false, 'it printed from a frame again');
  listeners.afterprint();
  assert.equal(printout().parent, null, 'the printout (with the code) stayed in the page after printing');
  assert.equal(doc.body.classList.contains('pb-printing'), false, 'the page stayed in print mode after printing');
});

/* #7681 review: the words screen states the price Kosmos+ confirmed for THIS ticket (the preview answer's price), not an
   earlier read of the board's setting: a tab open across a restart that changed it showed the old figure. */
test('the words screen shows the price the preview confirmed, not the earlier read', async () => {
  const { ctx, el } = load({ ok: true, ticket: 't1', words: { backsUp: ['your agents'], readers: [], never: [] }, price: '$6/month' });
  vm.runInContext(liftAll(SCRIPT, ['pbList', 'pbOpen', 'plusSiAddPrice']), ctx);   // the page's own price wording
  ctx.PB.st = { shown: true, price: '$5/month', state: 'off' };
  await ctx.pbOpen();
  assert.equal(ctx.PB.view, 'words', 'premise: the words screen opened');
  assert.match(el('pb-words-price').textContent, /\$6 a month/, 'the words screen showed the earlier read, not the confirmed price');
  assert.doesNotMatch(el('pb-words-price').textContent, /\$5/);
});

/* #7681 review: what happens to a printout on the paths that are not a clean print. */
function printSetup(ctx) {
  const doc = ctx.document;
  const made = [];
  const create = doc.createElement.bind(doc);
  doc.createElement = (tag) => { const e = create(tag); made.push(e); return e; };
  ctx.setTimeout = () => 1; ctx.clearTimeout = () => {};
  vm.runInContext(liftAll(SCRIPT, ['pbPrint']), ctx);
  return () => made.find((e) => e.id === 'pb-printout');   // the page makes it as it prints (#7681 suite)
}
test('a print that throws empties the printout at once and says so', () => {
  const { ctx, el } = load({ ok: true });
  ctx.window = { addEventListener: () => {}, removeEventListener: () => {}, print: () => { throw new Error('blocked'); } };
  const printout = printSetup(ctx);
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  ctx.pbPrint();
  assert.ok(printout(), 'premise: a printout was made');
  assert.equal(printout().parent, null, 'the printout (with the code) stayed in the page after a failed print');
  assert.equal(ctx.document.body.classList.contains('pb-printing'), false);
  assert.match(el('pb-msg').textContent, /could not be printed/);
});
test('hiding the panel empties a printout still waiting for afterprint', () => {
  const { ctx } = load({ ok: true });
  ctx.window = { addEventListener: () => {}, removeEventListener: () => {}, print: () => {} };   // no afterprint ever comes
  const printout = printSetup(ctx);
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  ctx.pbPrint();
  assert.ok(printout() && printout().textContent.length > 0 && printout().parent === ctx.document.body, 'premise: the printout holds the code, in the page');
  ctx.PB.st = { shown: false };
  ctx.pbPaint();
  assert.equal(printout().parent, null, 'the printout (with the code) stayed in the page after the panel hid');
  assert.equal(ctx.document.body.classList.contains('pb-printing'), false);
});
test('the "I saved it" exit takes a printout still waiting for afterprint off the page (review 3)', async () => {
  const { ctx } = load({ ok: true });
  ctx.window = { addEventListener: () => {}, removeEventListener: () => {}, print: () => {} };   // no afterprint ever comes
  const printout = printSetup(ctx);
  vm.runInContext(liftAll(SCRIPT, ['pbSaved']), ctx);
  ctx.pbShowCode({ recoveryCode: CODE, org: 'o', member: 'm' });
  ctx.pbPrint();
  assert.ok(printout() && printout().parent === ctx.document.body, 'premise: the printout is in the page');
  await ctx.pbSaved();
  assert.equal(ctx.PB.view, null, 'premise: the saved press went through');
  assert.equal(printout().parent, null, 'the printout (with the code) stayed in the page after "I saved it"');
  assert.equal(ctx.document.body.classList.contains('pb-printing'), false);
});
test('#pb-printout is never in the page\'s own markup (made only to print), and the print rule still hides the rest', () => {
  const html = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
  // #7681 suite: a static child of body is a 43rd pre-rail row in the consolidated grid (web.consolidated-980.test.js).
  assert.doesNotMatch(html, /<div id="pb-printout"/, 'the printout is back in the static markup');
  assert.match(html, /body\.pb-printing > \*:not\(#pb-printout\) \{ display: none !important; \}/, 'the print rule changed');
});
