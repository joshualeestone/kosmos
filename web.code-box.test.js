'use strict';
/**
 * #729: the code box says what it is waiting for, to whom, and that it can
 * fail. Driven THROUGH the handler (the #752 lesson) against a fake fetch: a
 * person's situations, each with its own sentence.
 *
 * kosmos#4698: the connected flow's own enrol pair (plus-email / plus-send-code)
 * could never show and was removed; the code box a person uses is the sign-in
 * wizard's "Email me a code" (plusSiRequestCode, #3478), so this drives that.
 *
 *   node --test web.code-box.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync('web/index.html', 'utf8'));

/** The slice from `from` to the end of the function or block that starts at `last`. */
function slice(from, last) {
  const start = SCRIPT.indexOf(from);
  const tail = SCRIPT.indexOf(last, start);
  const end = SCRIPT.indexOf('\n}\n', tail) + 3;
  assert.ok(start > 0 && tail >= start && end > tail, `the code box script moved (${from} .. ${last})`);
  return SCRIPT.slice(start, end);
}

function boxWorld(fetchImpl) {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', value: '', hidden: false, disabled: false, focus() {} });
  const staged = [];
  const ctx = {
    document: { getElementById: el },
    fetch: fetchImpl,
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; } },
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: (fn) => { ctx.__tick = fn; return 1; }, clearInterval: () => { ctx.__tick = null; },
    plusWords: (s) => s, console,
    plusSiStage: (stage, data) => staged.push([stage, data]),
  };
  vm.runInNewContext([
    slice('const PLUS_CODE_WORDS', 'function plusCountdown'),
    slice('function plusSiMsg', 'async function plusSiPostRaw'),
    slice('async function plusSiRequestCode', 'async function plusSiRequestCode'),
    'this.plusSiRequestCode = plusSiRequestCode;',
  ].join('\n'), ctx);
  const btn = el('plus-signin-code');
  return { ctx, el, staged, btn, click: () => ctx.plusSiRequestCode(btn), line: () => el('plus-signin-msg').textContent };
}

test('a good ask goes to the code step, naming the address the code went to', async () => {
  const asked = [];
  const w = boxWorld(async (path, init) => { asked.push([path, JSON.parse(init.body)]); return { ok: true, json: async () => ({ stage: 'code_sent' }) }; });
  w.el('plus-signin-email').value = 'her@example.com';
  await w.click();
  assert.deepEqual(asked, [['/api/remote/signin-start', { email: 'her@example.com' }]]);
  assert.equal(w.el('plus-si-code-to').textContent, 'her@example.com');
  assert.deepEqual(w.staged.map((s) => s[0]), ['code_sent']);
  assert.equal(w.btn.disabled, false, 'the button comes back after a good ask');
});

test('while it asks, the line says what it is asking for and for whom', async () => {
  let during = '';
  const w = boxWorld(async () => { during = w.line(); return { ok: true, json: async () => ({ stage: 'code_sent' }) }; });
  w.el('plus-signin-email').value = 'her@example.com';
  await w.click();
  assert.equal(during, 'Asking for a code for her@example.com.');
});

test('too many asks counts the seconds down where the person is looking, and holds the button until zero', async () => {
  const w = boxWorld(async () => ({ ok: false, json: async () => ({ error: 'you can ask for another code in 43 seconds' }) }));
  w.el('plus-signin-email').value = 'her@example.com';
  await w.click();
  assert.match(w.line(), /No code was sent: .*in 43 seconds/);
  assert.equal(w.btn.disabled, true, 'the button is held during the cooldown');
  w.ctx.__tick();
  assert.match(w.line(), /in 42 seconds/, 'it counts down');
  for (let i = 0; i < 42; i++) w.ctx.__tick();
  assert.match(w.line(), /ask for a code again now/);
  assert.equal(w.btn.disabled, false, 'the button comes back at zero');
});

test('a refusal that is not a cooldown says no code was sent and why, and stays on the email step', async () => {
  const w = boxWorld(async () => ({ ok: false, json: async () => ({ error: 'that does not look like an email address' }) }));
  w.el('plus-signin-email').value = 'nope';
  await w.click();
  assert.equal(w.line(), 'No code was sent: that does not look like an email address.');
  assert.deepEqual(w.staged, [], 'no step change for an ask that was refused');
  assert.equal(w.btn.disabled, false);
});

test('a service that does not answer is said to be slow, nothing is claimed sent, and the button comes straight back', async () => {
  const w = boxWorld(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  w.el('plus-signin-email').value = 'her@example.com';
  await w.click();
  assert.equal(w.line(), 'No code was sent: the sign-in service has not answered in 15 seconds; check this computer is online and try again.');
  assert.deepEqual(w.staged, []);
  // kosmos#4698: "in 15 seconds" here is how long it waited, not a cooldown. It was read as one: the
  // button was held and the line counted "has not answered in 14 seconds" down.
  assert.equal(w.btn.disabled, false, 'a timeout held the button as if it were a cooldown');
  assert.equal(w.ctx.__tick, undefined, 'a timeout started a countdown');
});

test('an empty email is said before anything is asked', async () => {
  let asked = 0;
  const w = boxWorld(async () => { asked += 1; return { ok: true, json: async () => ({}) }; });
  await w.click();
  assert.equal(w.line(), 'Type the email first.');
  assert.equal(asked, 0);
});
