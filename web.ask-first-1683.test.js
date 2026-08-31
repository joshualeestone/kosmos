'use strict';
/**
 * Removing a provider account must ASK FIRST (kosmos#1683).
 *
 * Josh asked for this in #770, in his own words: *"a Disconnect link at the
 * bottom that asks first."* It shipped without the asking half, so a single
 * click on Remove fired `DELETE /api/accounts/openai` immediately.
 *
 * ⚠️ DRIVEN THROUGH THE REAL CLICK BINDING, not asserted against the source.
 * The loop that binds these buttons is sliced out of the shipped page and run
 * in a VM against a fake button, so what is under test is the code that ships.
 * A source-level `assert.match` would prove the text is present and say
 * nothing about whether the first click reaches the engine, which is the only
 * thing this card is about.
 *
 * 📌 SCOPE, measured on origin/main rather than taken from the card: the card
 * says both provider rows render a live Disconnect. On main only the OPENAI
 * one is live. The Claude button is `disabled` with the title "Not built yet",
 * and it becomes live in #1659, which is unmerged. So this fixes the half that
 * is actually live today and cannot fix the other half yet.
 *
 *   node --test web.ask-first-1683.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(PAGE);

/** Run the shipped binding loop against one fake Remove button. */
function world(fetchImpl) {
  const start = SCRIPT.indexOf("for (const btn of box.querySelectorAll('[data-forget]'))");
  const end = SCRIPT.indexOf("for (const btn of box.querySelectorAll('[data-share]'))", start);
  assert.ok(start > 0 && end > start, 'the remove-account binding moved; re-anchor this test');

  const btn = {
    textContent: 'Remove',
    disabled: false,
    /* 🔑 `forgetProvider` IS SET EVEN THOUGH TODAY'S HANDLER IGNORES IT.
       #1659 makes the Claude row live and its handler REFUSES a button
       without this attribute ("we could not tell which provider that
       account belongs to"), correctly, because an unmarked button is a
       wiring bug rather than an OpenAI one. Measured: with the fixture as
       it was, two of these four go RED the moment #1659 is rebased on, and
       they fail as "the second click must actually remove it", which reads
       exactly like this confirm being broken. It is not; it is the fixture
       being older than the markup. Setting it now costs nothing today and
       removes a red that would otherwise land on whoever does that rebase. */
    dataset: { forget: '/some/dir', forgetProvider: 'openai' },
    classList: { has: new Set(), add(c) { this.has.add(c); }, remove(c) { this.has.delete(c); } },
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
  };
  const msg = { textContent: '' };
  const box = { querySelectorAll: () => [btn] };
  const ctx = {
    box, msg, fetch: fetchImpl, console,
    paintAccounts: async () => {},
  };
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return {
    btn, msg,
    click: () => btn.listeners.click(),
    blur: () => btn.listeners.blur && btn.listeners.blur(),
  };
}

test('#1683: the first click asks and does NOT reach the engine', async () => {
  const calls = [];
  const w = world(async (url, opts) => { calls.push([url, (opts || {}).method]); return { ok: true, json: async () => ({ because: 'Removed.' }) }; });

  await w.click();
  assert.deepEqual(calls, [], 'ONE CLICK REACHED THE ENGINE: the account was removed without asking');
  assert.equal(w.btn.textContent, 'Remove it?', 'the button must say what the next press will do');
  assert.equal(w.btn.classList.has.has('armed'), true, 'the armed class is what makes it look different');

  await w.click();
  assert.deepEqual(calls, [['/api/accounts/openai', 'DELETE']], 'the second click must actually remove it');
});

test('#1683: the label does not promise deletion, because the engine only forgets', () => {
  /* The sibling arm-in-place idioms in this file say "Remove it for good?".
     Copying that here would contradict the success sentence a few lines below,
     which is careful to say the sign-in file is still on the computer. */
  const w = world(async () => ({ ok: true, json: async () => ({}) }));
  w.click();
  assert.equal(w.btn.textContent, 'Remove it?');
  assert.doesNotMatch(w.btn.textContent, /for good|delete|permanent/i,
    'the confirm must not promise more than the engine does');
});

test('#1683: blur disarms, so a half-taken click does not linger', async () => {
  const calls = [];
  const w = world(async (u, o) => { calls.push([u, (o || {}).method]); return { ok: true, json: async () => ({}) }; });
  await w.click();
  w.blur();
  assert.equal(w.btn.textContent, 'Remove', 'blur must restore the resting label');
  await w.click();
  assert.deepEqual(calls, [], 'after a blur the next click must ARM again, not fire');
});

test('#1683: a refused remove disarms, so the next single click cannot fire blind', async () => {
  /* Matches the established behaviour of the sibling confirm in
     web.lost-phone.test.js: a refusal disarms and the following click re-arms.
     Without this the button would sit reading "Remove it?" after a failure and
     one press would act. */
  let asked = 0;
  const w = world(async () => { asked += 1; return { ok: false, json: async () => ({ error: 'the engine said no' }) }; });
  await w.click();
  await w.click();
  assert.equal(asked, 1, 'the second click should have tried once');
  assert.equal(w.btn.textContent, 'Remove', 'a refusal must restore the resting label');

  await w.click();
  assert.equal(asked, 1, 'STILL ARMED AFTER A REFUSAL: the third click fired blind');
  assert.equal(w.btn.textContent, 'Remove it?', 'the third click should have re-armed');
});
