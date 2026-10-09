'use strict';
/**
 * kosmos#5628 slice 2b-ui: a computer whose company installed the Kosmos profile signs in through the company's
 * sign-in. Driven THROUGH the page's own functions (sliced from web/index.html) against a fake fetch and a held timer.
 *
 *   node --test web.company-signin-5628.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync('web/index.html', 'utf8'));

function slice(from, last) {
  const start = SCRIPT.indexOf(from);
  const tail = SCRIPT.indexOf(last, start);
  const end = SCRIPT.indexOf('\n}\n', tail) + 3;
  assert.ok(start > 0 && tail >= start && end > tail, `the company sign-in script moved (${from} .. ${last})`);
  return SCRIPT.slice(start, end);
}

/** answers: path -> (body) => [status, json]. */
function world(answers) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', value: '', hidden: id === 'plus-signin-company', disabled: false, href: '', focus() {} });
  const calls = [];
  const shown = [];
  const opened = [];
  let timer = null;
  const ctx = {
    document: { getElementById: el },
    fetch: async (path, init) => {
      const body = init && init.body ? JSON.parse(init.body) : null;
      calls.push([path, body]);
      const a = answers[path];
      if (!a) throw new Error('no answer for ' + path);
      const [status, json] = a(body);
      return { ok: status >= 200 && status < 300, status, json: async () => json };
    },
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    // Only the poll's timer is held: the request helper's own abort timer (PLUS_ASK_TIMEOUT_MS and up) is not a poll.
    setTimeout: (fn, ms) => { if (ms < 15000) timer = fn; return 1; }, clearTimeout: () => {},
    window: { open: (u) => opened.push(u) },
    plusWords: (s) => s, console,
    plusSiShow: (step) => shown.push(step),
    plusNameClean: (v) => String(v).toLowerCase(),
    PLUS_NAME_RULE: /^[a-z0-9-]{3,32}$/,
    PLUS_ASK_TIMEOUT_MS: 15000, PLUS_REGISTER_TIMEOUT_MS: 420000,
    paintPlus: () => { ctx.painted = (ctx.painted || 0) + 1; },
  };
  vm.runInNewContext([
    'let PLUS_SI_EPOCH = 0;',
    slice('function plusSiMsg', 'function plusSiMsg'),
    slice('async function plusSiPost(', 'async function plusSiPost('),
    slice('async function plusSiPostRaw', 'async function plusSiPostRaw'),
    slice('let PLUS_CO_EPOCH = 0;', 'async function plusCompanyFinish'),
    'this.start = plusCompanyStart; this.finish = plusCompanyFinish; this.managed = plusCompanyManaged;',
    'this.startOver = () => { PLUS_SI_EPOCH += 1; };',
  ].join('\n'), ctx);
  return {
    ctx, el, calls, shown, opened,
    tick: async () => { const fn = timer; timer = null; assert.ok(fn, 'no poll was scheduled'); await fn(); },
    pending: () => timer !== null,
    line: () => el('plus-signin-msg').textContent,
  };
}

const START = { '/api/remote/company/start': () => [200, { ok: true, matchCode: 'K7-3M', url: 'https://login.kosmosplus.com/v1/sso/begin?x', interval: 5 }] };

test('the company button shows only on a managed computer', async () => {
  const on = world({ '/api/remote/managed': () => [200, { managed: { orgSlug: 'acme' } }] });
  assert.equal(await on.ctx.managed(), true);
  assert.equal(on.el('plus-signin-company').hidden, false);
  const off = world({ '/api/remote/managed': () => [200, { managed: null }] });
  assert.equal(await off.ctx.managed(), false);
  assert.equal(off.el('plus-signin-company').hidden, true, 'an unmanaged computer was offered company sign-in');
});

test('start opens the company sign-in, shows the code, waits for approval, then names and finishes', async () => {
  let ready = false;
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready, gone: false, retry: false }],
    '/api/remote/company/complete': () => [200, { ok: true }],
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  assert.deepEqual(w.calls[0], ['/api/remote/company/start', { email: 'neo@acme.test' }]);
  assert.equal(w.el('plus-si-company-code').textContent, 'K7-3M');
  assert.deepEqual(w.opened, ['https://login.kosmosplus.com/v1/sso/begin?x']);
  assert.deepEqual(w.shown, ['plus-si-company']);
  assert.equal(w.el('plus-si-company-finish').hidden, true, 'the name step showed before approval');
  await w.tick();                      // not approved yet: asks again
  assert.equal(w.pending(), true);
  ready = true;
  await w.tick();                      // approved
  assert.equal(w.el('plus-si-company-finish').hidden, false);
  assert.equal(w.pending(), false, 'it kept asking after approval');
  w.el('plus-si-company-name').value = 'neo-mac';
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.deepEqual(w.calls.at(-1), ['/api/remote/company/complete', { name: 'neo-mac' }], 'terms or a stray field were sent');
  assert.equal(w.ctx.painted, 1);
});

test('a second step is asked for when the account has one, and sent with the finish', async () => {
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/complete': (b) => (b.second ? [200, { ok: true }]
      : [400, { error: 'this account has a second step, so adding a computer to it needs that code too.' }]),
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  w.el('plus-si-company-name').value = 'neo-mac';
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.equal(w.el('plus-si-company-second-row').hidden, false, 'no field for the second step');
  w.el('plus-si-company-second').value = '123456';
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.deepEqual(w.calls.at(-1), ['/api/remote/company/complete', { name: 'neo-mac', second: '123456' }]);
  assert.equal(w.ctx.painted, 1);
});

test('a setup that is gone goes back to the email step with why; Start over stops the asking', async () => {
  const w = world(Object.assign({}, START, { '/api/remote/company/status': () => [200, { ready: false, gone: true, because: 'this version of Kosmos cannot set up through your company yet; update Kosmos' }] }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  assert.deepEqual(w.shown, ['plus-si-company', 'plus-si-email']);
  assert.match(w.line(), /update Kosmos/);
  // Start over while waiting: the held poll runs and does nothing (no request, nothing said).
  const v = world(Object.assign({}, START, { '/api/remote/company/status': () => [200, { ready: false, gone: true }] }));
  v.el('plus-signin-email').value = 'neo@acme.test';
  await v.ctx.start(v.el('plus-signin-company'));
  const before = v.calls.length;
  v.ctx.startOver();
  await v.tick();
  assert.equal(v.calls.length, before, 'a poll after Start over still asked');
  assert.deepEqual(v.shown, ['plus-si-company'], 'a poll after Start over moved the wizard');
});

test('no address, no start', async () => {
  const w = world(START);
  w.el('plus-signin-email').value = 'not-an-address';
  await w.ctx.start(w.el('plus-signin-company'));
  assert.equal(w.calls.length, 0);
  assert.match(w.line(), /work email/);
});
