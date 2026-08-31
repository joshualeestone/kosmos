'use strict';
/**
 * #729: the code box says what it is waiting for, to whom, and that it can
 * fail. Driven THROUGH the click binding (the #752 lesson) against a fake
 * fetch: a person's four situations, each with its own sentence.
 *
 *   node --test web.code-box.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const SCRIPT = page.scriptOf(fs.readFileSync('web/index.html', 'utf8'));

function boxWorld(fetchImpl) {
  const els = {};
  // The real page starts with the code row and the status line hidden.
  const el = (id) => (els[id] ||= { id, textContent: '', value: '', hidden: id === 'plus-code-row' || id === 'plus-sent', disabled: false, listeners: {}, focus() { this.focused = true; },
    addEventListener(t, fn) { this.listeners[t] = fn; } });
  const ctx = {
    document: { getElementById: el },
    fetch: fetchImpl,
    AbortController: class { constructor() { this.signal = { aborted: false }; } abort() { this.signal.aborted = true; if (this.onabort) this.onabort(); } },
    setTimeout: (fn, ms) => ({ fn, ms }), clearTimeout: () => {},
    setInterval: (fn, ms) => { ctx.__tick = fn; return 1; }, clearInterval: () => { ctx.__tick = null; },
    plusWords: (s) => s, console,
    // #1615: the send-code handler now advances to the ecode step via pjShow
    // (a page global), so provide it and record which step it showed.
    pjShow: (id) => { ctx.__shown = id; },
  };
  const start = SCRIPT.indexOf('const PLUS_CODE_WORDS');
  const end = SCRIPT.indexOf("document.getElementById('pj-pcode-next').addEventListener");
  assert.ok(start > 0 && end > start, 'the code box script moved');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return { ctx, el, click: () => el('plus-send-code').listeners.click() };
}

test('a good ask names the address it sent to and says the wait can take a minute', async () => {
  const w = boxWorld(async () => ({ ok: true, text: async () => '' }));
  w.el('plus-email').value = 'her@example.com';
  await w.click();
  const line = w.el('plus-sent').textContent;
  assert.match(line, /We sent a code to her@example\.com\./);
  assert.match(line, /take a minute/);
  assert.equal(w.ctx.__shown, 'pj-ecode', 'a good ask advances to the code step');
  assert.equal(w.el('plus-send-code').disabled, false, 'the button comes back after a good ask');
});

test('too many asks counts the seconds down where the person is looking, and holds the button until zero', async () => {
  const w = boxWorld(async () => ({ ok: false, json: async () => ({ error: 'you can ask for another code in 43 seconds' }) }));
  w.el('plus-email').value = 'her@example.com';
  await w.click();
  assert.match(w.el('plus-sent').textContent, /No code was sent: .*in 43 seconds/);
  assert.equal(w.el('plus-send-code').disabled, true, 'the button is held during the cooldown');
  w.ctx.__tick();
  assert.match(w.el('plus-sent').textContent, /in 42 seconds/, 'it counts down');
  for (let i = 0; i < 42; i++) w.ctx.__tick();
  assert.match(w.el('plus-sent').textContent, /ask for a code again now/);
  assert.equal(w.el('plus-send-code').disabled, false, 'the button comes back at zero');
});

test('a refusal that is not a cooldown says no code was sent and why', async () => {
  const w = boxWorld(async () => ({ ok: false, json: async () => ({ error: 'that does not look like an email address' }) }));
  w.el('plus-email').value = 'nope';
  await w.click();
  assert.equal(w.el('plus-sent').textContent, 'No code was sent: that does not look like an email address.');
  assert.notEqual(w.ctx.__shown, 'pj-ecode', 'a refused ask does not advance to the code step');
});

test('a service that does not answer is said to be slow, with the address, and nothing is claimed sent', async () => {
  const w = boxWorld(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; });
  w.el('plus-email').value = 'her@example.com';
  await w.click();
  assert.match(w.el('plus-sent').textContent, /has not answered in 15 seconds about her@example\.com/);
  assert.match(w.el('plus-sent').textContent, /Nothing was sent that we know of/);
});

test('an empty email is said before anything is asked', async () => {
  let asked = 0;
  const w = boxWorld(async () => { asked += 1; return { ok: true, text: async () => '' }; });
  await w.click();
  assert.equal(w.el('plus-sent').textContent, 'Type the email first.');
  assert.equal(asked, 0);
});
