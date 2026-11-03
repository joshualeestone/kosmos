'use strict';
/* kosmos#7404 plan screen: the rows, Choose, the wait for the plan and the refusals, in Mona Lisa's words (m2544) and
   Ice Cream Kitty's reads (m2543). The functions are lifted from the page, so the test cannot drift from what ships. */
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(PAGE);
const STRIPE = 'https://checkout.stripe.com/c/pay/cs_test_1';
const PLANS = [{ gb: 25, price: '$5/month' }, { gb: 100, price: '$12/month' }];

function fakeDoc() {
  const els = {};
  const make = (id) => {
    const el = { id, hidden: false, disabled: false, href: '#', dataset: {}, children: [], className: '', type: '', attrs: {}, listeners: {},
      appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; },
      addEventListener(k, f) { this.listeners[k] = f; }, focus() { doc.focused = this; },
      querySelectorAll(sel) { return sel === 'button' ? this.children.flatMap((li) => li.children.filter((c) => c.tag === 'button')) : []; } };
    Object.defineProperty(el, 'textContent', { get() { return this._t || ''; }, set(v) { this._t = v; if (v === '') this.children = []; } });
    return el;
  };
  const doc = { focused: null, getElementById(id) { return els[id] || (els[id] = make(id)); }, createElement(tag) { const e = make(''); e.tag = tag; return e; } };
  return doc;
}
function pbpState() {
  const m = SCRIPT.match(/\nvar PBP = \{[^\n]*\};\n/);
  assert.ok(m, 'CONTROL: var PBP was not found in the page');
  return m[0] + SCRIPT.match(/\nconst PBP_CONFIRMING_MS = [^\n]*\n/)[0];
}
function screen(doc, fetchImpl) {
  const src = page.liftAll(SCRIPT, ['asSentence', 'plusSiAddPrice', 'pbPost', 'pbpMsg', 'pbpRows', 'pbpOnView', 'pbpShow', 'pbpRead', 'pbpPaint', 'pbpChoose']) + '\n' + pbpState();
  let on = true;
  const api = new Function('document', 'fetch', 'pbPaint', src + '\nreturn { PBP, pbpOnView, pbpShow, pbpPaint, pbpChoose, pbpRead };')(
    doc, fetchImpl, () => api.pbpShow(on, false));
  api.setOn = (v) => { on = v; };
  return api;
}
const tick = () => new Promise((r) => setImmediate(r));
const vis = (doc, id) => !doc.getElementById(id).hidden;
const answer = (body, status = 200) => () => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
const rowsText = (doc) => doc.getElementById('pb-plans-list').children.map((li) => li.children[0].textContent);

test('no plan: one row per size, in Mona Lisa\'s words, each with Choose', async () => {
  const doc = fakeDoc();
  const s = screen(doc, answer({ ok: true, plans: PLANS, planGb: null }));
  s.pbpShow(true, false); await tick(); await tick();
  assert.ok(vis(doc, 'pb-plans'));
  assert.deepEqual(rowsText(doc), ['25 GB, $5 a month', '100 GB, $12 a month']);
  const b = doc.getElementById('pb-plans-list').querySelectorAll('button');
  assert.deepEqual(b.map((x) => [x.textContent, x.attrs['aria-label']]), [['Choose', 'Choose 25 GB, $5 a month'], ['Choose', 'Choose 100 GB, $12 a month']]);
  assert.ok(!vis(doc, 'pb-plans-wait') && !vis(doc, 'pb-plans-open-row'), 'nothing to wait for yet');
});

test('a plan already: no rows, and nothing more is read', async () => {
  const doc = fakeDoc();
  let calls = 0;
  const s = screen(doc, () => { calls++; return answer({ ok: true, plans: PLANS, planGb: 25 })(); });
  s.pbpShow(true, false); await tick(); await tick();
  assert.equal(calls, 1, 'CONTROL: the first show reads');
  assert.ok(!vis(doc, 'pb-plans'));
  s.PBP.at = 0; s.pbpShow(true, false);
  assert.equal(calls, 1, 'a board with a plan kept reading every minute');
});

test('Choose: Stripe\'s page becomes a link the person presses, and the screen waits for the plan', async () => {
  const doc = fakeDoc();
  const s = screen(doc, (url, init) => (/checkout$/.test(url) ? answer({ ok: true, url: STRIPE }) : answer({ ok: true, plans: PLANS, planGb: null }))());
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  assert.equal(doc.getElementById('pb-plans-open').href, STRIPE);
  assert.ok(vis(doc, 'pb-plans-open-row') && vis(doc, 'pb-plans-list'), 'the link, and the rows stay');
  assert.equal(doc.getElementById('pb-plans-wait').textContent, 'Finish the 25 GB plan on the payment page. This updates when it arrives.');
  assert.equal(doc.focused && doc.focused.id, 'pb-plans-open');
  await s.pbpChoose(100);
  assert.equal(doc.getElementById('pb-plans-wait').textContent, 'Finish the 100 GB plan on the payment page. This updates when it arrives.', 'a second Choose names the plan chosen last');
});

test('Choose sends the size, never a price', async () => {
  const doc = fakeDoc();
  let sent = null;
  const s = screen(doc, (url, init) => { if (/checkout$/.test(url)) sent = JSON.parse(init.body); return (/checkout$/.test(url) ? answer({ ok: true, url: STRIPE }) : answer({ ok: true, plans: PLANS, planGb: null }))(); });
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(100);
  assert.deepEqual(sent, { gb: 100 });
});

test('a page the board names anywhere but Stripe\'s checkout is never linked', async () => {
  for (const url of ['https://evil.example/pay', 'http://checkout.stripe.com/c/pay/x', 'https://checkout.stripe.com.evil.example/x', 'javascript:alert(1)']) {
    const doc = fakeDoc();
    const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: true, url }) : answer({ ok: true, plans: PLANS, planGb: null }))());
    s.pbpShow(true, false); await tick(); await tick();
    await s.pbpChoose(25);
    assert.ok(!vis(doc, 'pb-plans-open-row'), url);
    assert.equal(doc.getElementById('pb-plans-open').href, '#', url);
    assert.equal(doc.getElementById('pb-plans-msg').textContent, 'The payment page could not be opened just now, and nothing was charged. Choose your plan again to try once more.', url);
  }
});

test('a refused checkout says the coordinator\'s reason, and the rows stay', async () => {
  const doc = fakeDoc();
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: false, code: 'backup_plan_exists', because: 'This account already has a backup plan.' }) : answer({ ok: true, plans: PLANS, planGb: null }))());
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  assert.equal(doc.getElementById('pb-plans-msg').textContent, 'This account already has a backup plan.');
  assert.ok(vis(doc, 'pb-plans-list') && !vis(doc, 'pb-plans-open-row'));
  assert.ok(doc.getElementById('pb-plans-list').querySelectorAll('button').every((b) => !b.disabled), 'Choose works again');
});

test('a remote session gets the board\'s step-up instruction for Choose', async () => {
  const doc = fakeDoc();
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ code: 'remote_step_up_needed', error: 'confirm it is you on this device first' }, 403) : answer({ ok: true, plans: PLANS, planGb: null }))());
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  assert.equal(doc.getElementById('pb-plans-msg').textContent, 'Confirm it is you on this device first.');
});

test('the plan arriving ends the wait: the rows, the link and the line go', async () => {
  const doc = fakeDoc();
  let plan = null;
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: true, url: STRIPE }) : answer({ ok: true, plans: PLANS, planGb: plan }))());
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  assert.ok(vis(doc, 'pb-plans-open-row'), 'CONTROL: waiting');
  plan = 25; s.PBP.at = 0; s.pbpShow(true, false); await tick(); await tick();
  assert.ok(!vis(doc, 'pb-plans') && !vis(doc, 'pb-plans-open-row') && !vis(doc, 'pb-plans-wait'));
  assert.equal(s.PBP.url, null);
});

test('after a few minutes with no plan, the line says the payment is being confirmed; never a spinner', async () => {
  const doc = fakeDoc();
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: true, url: STRIPE }) : answer({ ok: true, plans: PLANS, planGb: null }))());
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  s.PBP.since = Date.now() - 4 * 60000; s.pbpPaint(true);
  assert.equal(doc.getElementById('pb-plans-wait').textContent, 'Your payment is being confirmed. This updates when your plan arrives.');
  assert.ok(vis(doc, 'pb-plans-open-row'), 'the link stays, to open the page again');
});

test('a plans read that fails says so plainly, the rows stay, and a read that works clears it', async () => {
  const doc = fakeDoc();
  let fail = false;
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: true, url: STRIPE })() : fail ? Promise.reject(new Error('offline')) : answer({ ok: true, plans: PLANS, planGb: null })()));
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  fail = true; s.PBP.at = 0; s.pbpShow(true, false); await tick(); await tick();
  assert.equal(doc.getElementById('pb-plans-msg').textContent, 'This Kosmos could not be reached. Try again.');
  assert.ok(vis(doc, 'pb-plans-list'));
  fail = false; s.PBP.at = 0; s.pbpShow(true, false); await tick(); await tick();
  assert.equal(doc.getElementById('pb-plans-msg').textContent, '', 'a read that worked left the old refusal up');
});

test('a refused Choose stays up when the next read works', async () => {
  const doc = fakeDoc();
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: false, because: 'This account already has a backup plan.' })() : answer({ ok: true, plans: PLANS, planGb: null })()));
  s.pbpShow(true, false); await tick(); await tick();
  await s.pbpChoose(25);
  assert.equal(doc.getElementById('pb-plans-msg').textContent, 'This account already has a backup plan.', 'CONTROL');
  s.pbpRead(); await tick(); await tick();
  assert.equal(doc.getElementById('pb-plans-msg').textContent, 'This account already has a backup plan.', 'a plans read cleared a refused Choose');
});

test('a first read that fails is shown, though there are no rows yet', async () => {
  const doc = fakeDoc();
  const s = screen(doc, answer({ ok: false, because: 'Kosmos+ could not be reached just now, so the plans cannot be shown. Try again in a minute.' }));
  s.pbpShow(true, false); await tick(); await tick();
  assert.ok(vis(doc, 'pb-plans'), 'the refusal sat in a hidden box');
  assert.equal(doc.getElementById('pb-plans-msg').textContent, 'Kosmos+ could not be reached just now, so the plans cannot be shown. Try again in a minute.');
});

test('with rows and no payment page open, nothing more is read each minute; a failed read is tried again', async () => {
  const doc = fakeDoc();
  let calls = 0, fail = true;
  const s = screen(doc, () => { calls++; return fail ? answer({ ok: false, because: 'x' })() : answer({ ok: true, plans: PLANS, planGb: null })(); });
  s.pbpShow(true, false); await tick(); await tick();
  fail = false; s.PBP.at = 0; s.pbpShow(true, false); await tick(); await tick();
  assert.equal(calls, 2, 'CONTROL: a failed first read is tried again');
  s.PBP.at = 0; s.pbpShow(true, false); await tick(); await tick();
  assert.equal(calls, 2, 'the plans were read again with nothing to wait for');
});

test('personal backup going off drops the plans, the wait and any answer still out', async () => {
  const doc = fakeDoc();
  let release;
  const s = screen(doc, (u) => (/checkout$/.test(u) ? new Promise((r) => { release = () => r({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, url: STRIPE }) }); }) : answer({ ok: true, plans: PLANS, planGb: null })()));
  s.pbpShow(true, false); await tick(); await tick();
  const choosing = s.pbpChoose(25);
  s.setOn(false); s.pbpShow(false, true);
  release(); await choosing;
  assert.equal(s.PBP.url, null, 'a checkout answer for a panel that is gone was kept');
  assert.equal(s.PBP.plans, null);
  assert.ok(!vis(doc, 'pb-plans'));
});

/* The real no-plan stop, as the job writes it (engine/personalbackup.js NO_PLAN through report()). */
const NO_PLAN_LINES = { stopped: 'There is no backup plan on this account, so nothing new is backed up. What is already backed up stays yours to restore.', noPlan: true, plain: '' };
test('the run\'s no-plan stop keeps the plan screen open, says to choose, and its stop line gives way', async () => {
  const doc = fakeDoc();
  const s = screen(doc, answer({ ok: true, plans: PLANS, planGb: null }));
  doc.getElementById('pb-job').hidden = false; doc.getElementById('pb-on-say').textContent = 'Personal backup has stopped on this computer.';
  s.pbpOnView(true, NO_PLAN_LINES, false); await tick(); await tick();
  s.pbpOnView(true, NO_PLAN_LINES, false);
  assert.ok(vis(doc, 'pb-plans'), 'the no-plan stop hid the plans');
  assert.deepEqual(rowsText(doc), ['25 GB, $5 a month', '100 GB, $12 a month']);
  assert.equal(doc.getElementById('pb-on-say').textContent, 'Personal backup is on, but nothing is backed up until you choose a plan.');
  assert.ok(!vis(doc, 'pb-job'), 'the dead-end stop line stayed beside the rows');
});

test('any other stop still hides the plan screen', async () => {
  const doc = fakeDoc();
  let calls = 0;
  const s = screen(doc, () => { calls++; return answer({ ok: true, plans: PLANS, planGb: null })(); });
  doc.getElementById('pb-job').hidden = false; doc.getElementById('pb-on-say').textContent = 'Personal backup has stopped on this computer.';
  s.pbpOnView(true, { stopped: 'Remote access is not set up on this computer, so nothing was backed up.', noPlan: false, plain: '' }, false); await tick(); await tick();
  assert.ok(!vis(doc, 'pb-plans')); assert.equal(calls, 0);
  assert.ok(vis(doc, 'pb-job')); assert.equal(doc.getElementById('pb-on-say').textContent, 'Personal backup has stopped on this computer.');
});

test('the no-plan stop line stays while the plans cannot be read, so the person is told something', async () => {
  const doc = fakeDoc();
  const s = screen(doc, answer({ ok: false, because: 'x' }));
  doc.getElementById('pb-job').hidden = false;
  s.pbpOnView(true, NO_PLAN_LINES, false); await tick(); await tick();
  s.pbpOnView(true, NO_PLAN_LINES, false);
  assert.ok(vis(doc, 'pb-job'));
});


test('the off view says "from" the smallest plan\'s price; the words view keeps the plain price', () => {
  const f = new Function(page.liftAll(SCRIPT, ['plusSiAddPrice', 'pbPrice']) + '\nreturn pbPrice;')();
  assert.equal(f({ price: '$5/month' }, true), 'Personal backup is from $5 a month, billed to your Kosmos+ account.');
  assert.equal(f({ price: '$5/month' }), 'Personal backup is $5 a month, billed to your Kosmos+ account.');
  assert.equal(f({ price: null }, true), '', 'a line with no price');
});

test('Choose refused because the account already has a plan reads the plan, and the rows give way to it', async () => {
  const doc = fakeDoc();
  let planGb = null, reads = 0;
  const s = screen(doc, (u) => (/checkout$/.test(u) ? answer({ ok: false, code: 'backup_plan_exists', because: 'This account already has a backup plan.' })()
    : (reads++, answer({ ok: true, plans: PLANS, planGb })())));
  s.pbpShow(true, false); await tick(); await tick();
  planGb = 100;
  await s.pbpChoose(25); await tick(); await tick();
  assert.equal(reads, 2, 'the plan was not read again');
  assert.ok(!vis(doc, 'pb-plans'), 'the rows stayed beside a plan the account already has');
});
