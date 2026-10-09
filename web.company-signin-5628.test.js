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
      const [status, json] = await a(body);
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
    'this.start = plusCompanyStart; this.finish = plusCompanyFinish; this.managed = plusCompanyManaged; this.text = plusCompanyText;',
    'this.startOver = () => { PLUS_SI_EPOCH += 1; PLUS_CO_EPOCH += 1; };',
  ].join('\n'), ctx);
  return {
    ctx, el, calls, shown, opened,
    tick: async () => { const fn = timer; timer = null; assert.ok(fn, 'no poll was scheduled'); await fn(); },
    pending: () => timer !== null,
    line: () => el('plus-signin-msg').textContent,
  };
}

const START = {
  '/api/remote/company/start': () => [200, { ok: true, matchCode: 'K7-3M', url: 'https://login.kosmosplus.com/v1/sso/begin?x', interval: 5 }],
  '/api/remote/company/open': () => [200, { ok: true }],
  // kosmos#5651: by default an older board/coordinator that cannot send the text.
  '/api/remote/company/second-text': () => [501, { error: 'this version cannot send that text', unsupported: true }],
};

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
  assert.deepEqual(w.calls[1], ['/api/remote/company/open', {}], 'the engine was not asked to open the page');
  assert.deepEqual(w.opened, [], 'the page opened a window itself (the Mac app blocks it)');
  assert.match(w.el('plus-si-company-lead').textContent, /opened in your browser/);
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
  // Review 1: no text message is sent on this path, and the words say so rather than wait for one.
  assert.match(w.line(), /authenticator app/);
  assert.match(w.line(), /text message, this version of Kosmos cannot send it yet/);
  assert.doesNotMatch(w.line(), /Email me a code/, 'review 3: Email me a code is no way out where the company requires its own sign-in');
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

test('review 1: when the engine cannot open the page, the step says to use the link, never that it opened', async () => {
  const w = world(Object.assign({}, START, { '/api/remote/company/open': () => [409, { error: 'Kosmos could not open your browser; use the link below' }] }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  assert.match(w.el('plus-si-company-lead').textContent, /with the link below/);
  assert.doesNotMatch(w.el('plus-si-company-lead').textContent, /opened/);
});

test('review 3: the name-held sentence is said in the coordinator words; a refused code is not sent again; a new start is empty', async () => {
  const sent = [];
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/complete': (b) => { sent.push(b); return [400, { error: b.second
      ? 'wrong second code; 4 tries left'
      : 'that name is held by a computer on this account; to move it to this one, enter the code from your second step' }]; },
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  w.el('plus-si-company-name').value = 'old-laptop';
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.match(w.line(), /held by a computer on this account/, 'the takeover was hidden behind the generic words');
  assert.equal(w.el('plus-si-company-second-row').hidden, false);
  w.el('plus-si-company-second').value = '111111';
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.equal(sent.length, 2);
  await w.ctx.finish(w.el('plus-si-company-go'));          // the same refused code, pressed again
  assert.equal(sent.length, 2, 'a just-refused code was sent again, spending another try');
  assert.match(w.line(), /just refused/);
  // A new start: both boxes are empty.
  await w.ctx.start(w.el('plus-signin-company'));
  assert.equal(w.el('plus-si-company-name').value, '', 'a stale name was left for the next start');
  assert.equal(w.el('plus-si-company-second').value, '', 'a refused code was left for the next start');
});

test('review 4: a timeout or a name refusal does not mark a still-good code refused', async () => {
  const sent = [];
  let answer = [400, { error: 'that name is not allowed' }];
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/complete': (b) => { sent.push(b); return b.second ? answer : [400, { error: 'this account has a second step, so adding a computer to it needs that code too.' }]; },
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  w.el('plus-si-company-name').value = 'neo-mac';
  await w.ctx.finish(w.el('plus-si-company-go'));
  w.el('plus-si-company-second').value = '123456';
  await w.ctx.finish(w.el('plus-si-company-go'));          // refused for the name, not the code
  answer = [200, { ok: true }];
  w.el('plus-si-company-name').value = 'neo-mac2';
  await w.ctx.finish(w.el('plus-si-company-go'));          // the same, still-good code is sent
  assert.deepEqual(sent.at(-1), { name: 'neo-mac2', second: '123456' }, 'a code never judged was held back as refused');
});

test('kosmos#5651: a text-message account is texted and asked for that code; an authenticator account for the app', async () => {
  for (const [answer, words, label] of [
    [[200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }], /texted a code to the phone ending 4567/, /we texted/],
    [[200, { ok: true, sent: false, second: 'totp' }], /authenticator app/, /authenticator app/],
  ]) {
    const asked = [];
    const w = world(Object.assign({}, START, {
      '/api/remote/company/status': () => [200, { ready: true }],
      '/api/remote/company/second-text': () => { asked.push(1); return answer; },
      '/api/remote/company/complete': (b) => (b.second === '424242' ? [200, { ok: true }]
        : b.second ? [400, { error: 'that code is not the one we texted; 4 tries left' }]
        : [400, { error: 'this account has a second step, so adding a computer to it needs that code too.' }]),
    }));
    w.el('plus-signin-email').value = 'neo@acme.test';
    await w.ctx.start(w.el('plus-signin-company'));
    await w.tick();
    w.el('plus-si-company-name').value = 'neo-mac';
    await w.ctx.finish(w.el('plus-si-company-go'));
    assert.equal(asked.length, 1, 'the text was not asked for (or asked twice)');
    assert.match(w.line(), words);
    assert.match(w.el('plus-si-company-second-label').textContent, label);
    assert.doesNotMatch(w.line(), /Email me a code/);
    // A wrong code is refused in the coordinator's words, and does NOT ask for another text.
    w.el('plus-si-company-second').value = '111111';
    await w.ctx.finish(w.el('plus-si-company-go'));
    assert.match(w.line(), /4 tries left/);
    assert.equal(asked.length, 1, 'a refused code asked for another text (each one costs, and counts against the account)');
    w.el('plus-si-company-second').value = '424242';
    await w.ctx.finish(w.el('plus-si-company-go'));
    assert.deepEqual(w.calls.at(-1), ['/api/remote/company/complete', { name: 'neo-mac', second: '424242' }]);
    assert.equal(asked.length, 1, 'a finish with the code asked for another text');
  }
});

/** kosmos#5651 board review 1: a company setup at its second step, with the text request answered by `textAnswer`. */
async function atSecondStep(textAnswer) {
  const asked = [];
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/second-text': () => { asked.push(1); return textAnswer(asked.length); },
    '/api/remote/company/complete': (b) => (b.second ? [200, { ok: true }]
      : [400, { error: 'this account has a second step, so adding a computer to it needs that code too.' }]),
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  w.el('plus-si-company-name').value = 'neo-mac';
  return { w, asked };
}

test('kosmos#5651 board review 1: Finish pressed again while the text is asked for asks once', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { w, asked } = await atSecondStep(async () => { await held; return [200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }]; });
  const first = w.ctx.finish(w.el('plus-si-company-go'));
  await new Promise((r) => setImmediate(r));
  await w.ctx.text();                                      // Text me again while the first ask is out
  w.el('plus-si-company-second').value = '424242';
  const callsBefore = w.calls.length;
  await w.ctx.finish(w.el('plus-si-company-go'));          // Finish with a code while the ask is out
  assert.equal(w.calls.length, callsBefore, 'a code was finished while a new text was being asked for');
  release();
  await first;
  assert.equal(asked.length, 1, 'a text was asked for twice at once');
  assert.match(w.line(), /phone ending 4567/);
});

test('kosmos#5651 board review 1: a failed request and a text that did not come can be asked again; a wait holds the button', async () => {
  const answers = [
    [400, { error: 'this computer could not reach the sign-in service' }],
    [200, { ok: true, sent: true, second: 'sms', sentTo: null }],
    [400, { error: 'a code was just texted; wait 42 seconds before asking for another' }],
  ];
  const { w, asked } = await atSecondStep((n) => answers[n - 1]);
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.equal(w.el('plus-si-company-resend').hidden, false, 'no way to ask again after a failed request');
  await w.ctx.text('');                                    // Text me again
  assert.equal(asked.length, 2);
  assert.match(w.line(), /We texted a code to your phone\. Enter it/, 'the wording with no phone ending');
  assert.equal(w.el('plus-si-company-resend').hidden, false, 'no way to ask again for a text that did not come');
  await w.ctx.text('');
  assert.match(w.line(), /wait 42 seconds/);
  assert.equal(w.el('plus-si-company-resend').disabled, true, 'the button did not wait as the coordinator asked');
});

test('kosmos#5651 board review 1: a late answer for an older setup (a new company start meanwhile) changes nothing on screen', async () => {
  let release;
  const held = new Promise((r) => { release = r; });
  const { w } = await atSecondStep(async () => { await held; return [200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }]; });
  const pending = w.ctx.finish(w.el('plus-si-company-go'));
  await new Promise((r) => setImmediate(r));
  // A new company start (same sign-in, so the request itself is not stale): only the company epoch moves.
  await w.ctx.start(w.el('plus-signin-company'));
  const before = w.line();
  release();
  await pending;
  assert.equal(w.line(), before, 'a late text answer wrote over a sign-in that was started over');
});

test('kosmos#5651 board review 2: a gone setup sends the text ask back to the email step; Text me again keeps the takeover words', async () => {
  const { w } = await atSecondStep(() => [400, { error: 'that company sign-in has expired; start again' }]);
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.deepEqual(w.shown.slice(-1), ['plus-si-email'], 'a gone setup left Text me again as a dead end');
  // The takeover words stay on every text after the first.
  const answers = [[400, { error: 'this computer could not reach the sign-in service' }], [200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }]];
  let n = 0;
  const v = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/second-text': () => answers[n++],
    '/api/remote/company/complete': () => [400, { error: 'that name is held by a computer on this account; to move it to this one, enter the code from your second step' }],
  }));
  v.el('plus-signin-email').value = 'neo@acme.test';
  await v.ctx.start(v.el('plus-signin-company'));
  await v.tick();
  v.el('plus-si-company-name').value = 'old-laptop';
  await v.ctx.finish(v.el('plus-si-company-go'));
  await v.ctx.text();
  assert.match(v.line(), /held by a computer on this account/, 'Text me again dropped the takeover warning');
  assert.match(v.line(), /phone ending 4567/);
});

test('kosmos#5651 board review 3: a late text answer for an older setup does not free Finish during the newer request', async () => {
  const releases = [];
  const { w } = await atSecondStep(() => new Promise((r) => releases.push(() => r([200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }]))));
  const a = w.ctx.finish(w.el('plus-si-company-go'));       // setup A: its text request is held
  await new Promise((r) => setImmediate(r));
  await w.ctx.start(w.el('plus-signin-company'));          // setup B
  await w.tick();
  w.el('plus-si-company-name').value = 'neo-mac';
  const b = w.ctx.finish(w.el('plus-si-company-go'));       // B's text request is held too
  await new Promise((r) => setImmediate(r));
  releases[0]();                                           // A's late answer lands
  await a;
  w.el('plus-si-company-second').value = '424242';
  const before = w.calls.length;
  await w.ctx.finish(w.el('plus-si-company-go'));          // Finish while B's request is still out
  assert.equal(w.calls.length, before, 'a late answer for setup A freed Finish while B asked for a text');
  releases[1]();
  await b;
});

test('kosmos#5651 board review 4: "all the texts ... or start again" keeps the person on the code step', async () => {
  const { w } = await atSecondStep(() => [400, { error: 'that is all the texts this setup can send; enter the code you have, or start again on the computer' }]);
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.deepEqual(w.shown, ['plus-si-company'], 'a person holding a good code was sent back to the email step');
  assert.equal(w.el('plus-si-company-resend').hidden, true, 'Text me again offered after all the texts');
  assert.equal(w.el('plus-si-company-second-row').hidden, false);
});

test('kosmos#5651 board review 5: a late finish answer for an older setup does not free the newer finish', async () => {
  const releases = [];
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/complete': () => new Promise((r) => releases.push(() => r([400, { error: 'that name is not allowed' }]))),
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  w.el('plus-si-company-name').value = 'neo-mac';
  const a = w.ctx.finish(w.el('plus-si-company-go'));       // setup A's finish is out
  await new Promise((r) => setImmediate(r));
  await w.ctx.start(w.el('plus-signin-company'));          // setup B
  assert.equal(w.el('plus-si-company-go').disabled, false, 'a new setup started with Finish held by the old one');
  await w.tick();
  w.el('plus-si-company-name').value = 'neo-mac2';
  const b = w.ctx.finish(w.el('plus-si-company-go'));       // B's finish is out
  await new Promise((r) => setImmediate(r));
  releases[0]();                                           // A's late answer
  await a;
  assert.equal(w.el('plus-si-company-go').disabled, true, 'a late answer for setup A freed Finish during B\'s finish');
  releases[1]();
  await b;
});

test('kosmos#5651 board review 6: an abandoned setup\'s late text answer does not free Finish during the new setup\'s finish', async () => {
  const texts = [];
  const finishes = [];
  const w = world(Object.assign({}, START, {
    '/api/remote/company/status': () => [200, { ready: true }],
    '/api/remote/company/second-text': () => new Promise((r) => texts.push(() => r([200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }]))),
    '/api/remote/company/complete': (b) => (b.name === 'b-mac'
      ? new Promise((r) => finishes.push(() => r([200, { ok: true }])))
      : [400, { error: 'this account has a second step, so adding a computer to it needs that code too.' }]),
  }));
  w.el('plus-signin-email').value = 'neo@acme.test';
  await w.ctx.start(w.el('plus-signin-company'));
  await w.tick();
  w.el('plus-si-company-name').value = 'a-mac';
  const a = w.ctx.finish(w.el('plus-si-company-go'));       // A: refused for the second step; its text is held
  await new Promise((r) => setImmediate(r));
  w.ctx.startOver();
  await w.ctx.start(w.el('plus-signin-company'));          // B
  await w.tick();
  w.el('plus-si-company-name').value = 'b-mac';
  const b = w.ctx.finish(w.el('plus-si-company-go'));       // B's finish is out
  await new Promise((r) => setImmediate(r));
  texts[0]();                                              // A's late text answer
  await a;
  assert.equal(w.el('plus-si-company-go').disabled, true, 'an abandoned setup freed Finish during the new finish');
  finishes[0]();
  await b;
  assert.equal(w.ctx.painted, 1, 'the new setup finished but the wizard did not move on');
});

test('kosmos#5651 board review 8: after a text, Text me again waits the minute; a failed resend keeps where the code went', async () => {
  const answers = [[200, { ok: true, sent: true, second: 'sms', sentTo: '4567' }], [400, { error: 'this computer could not reach the sign-in service' }]];
  const { w } = await atSecondStep((n) => answers[n - 1]);
  await w.ctx.finish(w.el('plus-si-company-go'));
  assert.equal(w.el('plus-si-company-resend').disabled, true, 'Text me again offered inside the coordinator\'s minute');
  await w.ctx.text();                                      // a resend that fails (the button is driven directly)
  assert.match(w.line(), /phone ending 4567/, 'a failed resend wiped where the code went');
  assert.match(w.el('plus-si-company-second-label').textContent, /we texted/);
});
