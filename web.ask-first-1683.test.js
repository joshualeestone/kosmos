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
 * 📌 SCOPE, AND IT HAS CHANGED SINCE THIS PARAGRAPH WAS WRITTEN. It used to say
 * that only the OpenAI row rendered a live Disconnect, that the Claude button was
 * `disabled` with the title "Not built yet", and that #1659 was unmerged. All
 * three were measured and true then. #1659 is now THIS BRANCH: the Claude button
 * is live, it carries `data-forget`, and the handler these tests extract is bound
 * over both providers.
 * ⚠️ So do not read this file as covering one provider. It drives the SHARED
 * binding, and a reader who trusted the old paragraph would conclude the Claude
 * arm needs no coverage. A scope note that goes stale is worse than none, because
 * it is the sentence someone uses to decide what NOT to test.
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
/* `provider` is a parameter because it was hardcoded to 'openai', and that is why
   nothing in this repo asserted that a CLAUDE button calls /api/accounts/claude.
   Both ENDS of that join were pinned separately (the markup carries
   data-forget-provider="claude", the server route answers on that path) and the
   `'/api/accounts/' + provider` concatenation between them was exercised by
   nothing, on the card whose whole point is making the Claude row live. */
function world(fetchImpl, provider) {
  const start = SCRIPT.indexOf("for (const btn of box.querySelectorAll('[data-forget]'))");
  const end = SCRIPT.indexOf("for (const btn of box.querySelectorAll('[data-share]'))", start);
  assert.ok(start > 0 && end > start, 'the remove-account binding moved; re-anchor this test');

  const btn = {
    textContent: 'Disconnect',
    disabled: false,
    /* 🔑 `forgetProvider` IS THE ROUTING KEY, AND THE HANDLER REFUSES WITHOUT IT.
       ⚠️ This used to open "EVEN THOUGH TODAY'S HANDLER IGNORES IT" and to predict that
       "two of these four go RED the moment #1659 is rebased on". Both were true when
       written and are false here: the handler routes on it (`'/api/accounts/' + provider`),
       refuses on the first press without it, and this file now holds nine tests, not four.
       It contradicted the comment directly above it, and a reader taking it at face value
       would conclude the fixture's `forgetProvider` is decorative.
       Kept as a marker rather than deleted: it is the same stale-scope class this branch
       already corrected in this file's own header, surviving one line above the line the
       branch edited.
       #1659 makes the Claude row live and its handler REFUSES a button
       without this attribute ("we could not tell which provider that
       account belongs to"), correctly, because an unmarked button is a
       wiring bug rather than an OpenAI one. Measured: with the fixture as
       it was, two of these four go RED the moment #1659 is rebased on, and
       they fail as "the second click must actually remove it", which reads
       exactly like this confirm being broken. It is not; it is the fixture
       being older than the markup. Setting it now costs nothing today and
       removes a red that would otherwise land on whoever does that rebase. */
    dataset: { forget: '/some/dir', forgetProvider: provider || 'openai' },
    classList: { has: new Set(), add(c) { this.has.add(c); }, remove(c) { this.has.delete(c); } },
    listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; },
    /* The handler keeps the ARMED state in the accessible name, because aria-label
       wins over name-from-content and the confirm was otherwise sighted-only. The
       fixture has to model the attribute or the arm path throws here rather than
       failing on the behaviour under test. */
    attrs: { 'aria-label': 'Disconnect walk@example.com (OpenAI)' },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
  };
  const msg = { textContent: '' };
  /* The focus target the success path moves to, so the move is observable. */
  const acctBox = { focused: false, focus() { this.focused = true; } };
  const cancels = [];
  const box = { querySelectorAll: () => [btn] };
  const ctx = {
    box, msg, fetch: fetchImpl, console,
    paintAccounts: async () => {},
    /* 🔑 THE SAME KINDNESS THIS FIXTURE ALREADY DID FOR `forgetProvider`, one
       rebase later. #1659's handler cancels a pending announcement before it
       acts, so the extracted binding now references `acctCancelSay` and this
       sandbox did not define it. The failure was `ReferenceError:
       acctCancelSay is not defined` reported as "the first click asks and does
       NOT reach the engine", which reads exactly like the confirm being broken.
       It was not; it was the fixture being older than the markup again.
       ⚠️ A no-op rather than a defensive `typeof` guard in the handler: the
       dependency is real, so the fixture should model it rather than the
       product hiding it. */
    /* RECORDED, not a no-op. Stubbing this as `() => {}` meant deleting every
       acctCancelSay() call in the page produced zero failures, so the whole
       announce-timer mechanism was covered by nothing: the module-scope-vs-expando
       bug this branch found and fixed would go straight back in green. */
    acctCancelSay: () => { cancels.push(1); },
    /* 🛑 A `document` STUB, BECAUSE WITHOUT IT EVERY "SUCCESS" IN THIS FIXTURE RAN
       THE CATCH. #1659's success path calls
       `document.getElementById('set-accounts')` to move focus after the repaint,
       and this sandbox defined no `document`, so a successful two-press removal
       ended with `msg.textContent === "document is not defined"` and the tests
       above still passed: they assert what was FETCHED, not what was SAID.
       ⇒ The success sentence, the scrollIntoView and the focus move were exercised
       by nothing at any layer, and the next person to assert the success message
       would have been measuring the error path.
       ⚠️ THIS IS THE SECOND DEPENDENCY THIS FIXTURE MISSED. It modelled
       `acctCancelSay` and missed `document`, both added in the same diff, and its
       own comment states the principle it broke: the dependency is real, so the
       fixture should model it rather than the product hiding it behind a guard. */
    document: {
      getElementById: (id) => (id === 'set-accounts' ? acctBox : null),
    },
  };
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  return {
    acctBox,
    cancels,
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
  assert.equal(w.btn.textContent, 'Disconnect', 'blur must restore the resting label');
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
  assert.equal(w.btn.textContent, 'Disconnect', 'a refusal must restore the resting label');

  await w.click();
  assert.equal(asked, 1, 'STILL ARMED AFTER A REFUSAL: the third click fired blind');
  assert.equal(w.btn.textContent, 'Remove it?', 'the third click should have re-armed');
});

/* 🛑 THE ARMED STATE MUST REACH THE ACCESSIBLE NAME. `aria-label` wins over
   name-from-content, so relabelling textContent to "Remove it?" changes what a
   sighted person sees and NOTHING a screen reader announces. Without this arm the
   confirm that #1683 exists to add is sighted-only, on a control whose cost is an
   OAuth sign-in, and every other test in this file passes anyway because they all
   read textContent. */
test('#1683: arming changes the ACCESSIBLE NAME, not only the visible label', () => {
  const w = world(async () => ({ ok: true, json: async () => ({ because: 'gone' }) }));
  const rest = w.btn.getAttribute('aria-label');
  assert.ok(rest && /Disconnect/.test(rest), 'the fixture lost its resting accessible name');
  w.btn.listeners.click();
  const armed = w.btn.getAttribute('aria-label');
  assert.notEqual(armed, rest,
    'the accessible name did not change on arming, so a screen-reader user cannot tell the confirm happened');
  /* WCAG 2.5.3 Label in Name: the accessible name must CONTAIN the visible words,
     and starting with them is what makes "click Remove it?" work for speech input.
     Asserted as a prefix rather than a substring because the order is the point. */
  assert.ok(armed.indexOf('Remove it?') === 0,
    'the armed name does not start with the VISIBLE label, so a speech-input user cannot say what they see (WCAG 2.5.3)');
  assert.ok(armed.indexOf(rest) > 0,
    'the armed name dropped the account identity, which is what tells two rows apart');
  w.btn.listeners.blur();
  assert.equal(w.btn.getAttribute('aria-label'), rest, 'blur disarmed the label but did not restore the name');
});

/* 🛑 AN UNMARKED BUTTON MUST NOT ARM. The plan recorded this decision and the code
   did not implement it: the provider guard sat INSIDE the try, after the arming,
   so a wiring fault armed on the first press and only refused on the second. The
   person saw a control reading "Remove it?" that could never remove anything, so
   the confirm promised a pending action that did not exist. Safe, and not honest.
   Guarded here because a decision recorded only in a plan is a stale comment with
   extra steps. */
test('#1659: a button with no provider marker refuses on the FIRST press and never arms', () => {
  const w = world(async () => { throw new Error('the engine must not be reached'); });
  delete w.btn.dataset.forgetProvider;
  w.btn.listeners.click();
  assert.equal(w.btn.textContent, 'Disconnect',
    'an unmarked button ARMED, so the guard is still running after the arming rather than before it');
  assert.equal(w.btn.classList.has.has('armed'), false, 'it took the armed class despite refusing');
  assert.match(w.msg.textContent, /which provider/,
    'it refused without saying why, which reads as a dead button rather than a wiring fault');
});

/* 🛑 THE CARD'S CENTRAL NEW BEHAVIOUR, AND IT WAS GUARDED BY NOTHING. #1659 makes
   the Claude row live, and the handler routes on `'/api/accounts/' + provider`.
   The markup end was pinned (data-forget-provider="claude"), the server end was
   pinned (the route answers on that path), and the JOIN between them was tested
   by no assertion anywhere in the repo: the only endpoint arm in this file was
   hardcoded to openai, because the fixture was.
   ⇒ Two ends pinned separately is not the same as the middle being covered. */
test('#1659: a CLAUDE button removes through /api/accounts/claude, not the OpenAI route', async () => {
  const calls = [];
  const w = world(async (url, opts) => {
    calls.push([url, (opts || {}).method]);
    return { ok: true, json: async () => ({ because: 'gone' }) };
  }, 'claude');
  await w.click();
  assert.deepEqual(calls, [], 'the first press reached the engine, so the confirm is not asking first');
  await w.click();
  assert.deepEqual(calls, [['/api/accounts/claude', 'DELETE']],
    'a Claude row did not remove through the Claude route, so the provider routing is wrong');
});

/* 🛑 THE SUCCESS PATH, WHICH WAS EXERCISED BY NOTHING AT ANY LAYER. This fixture
   defined no `document`, so every "successful" removal in this file actually ran
   the CATCH and ended with `msg.textContent === "document is not defined"`. The
   arms above still passed because they assert what was FETCHED, not what was SAID.
   ⇒ Three things the branch added were therefore covered by no test: the success
   sentence the route returns, the scroll, and the focus move to #set-accounts that
   exists because the repaint destroys the button the person was standing on. */
test('#1659: a successful removal SAYS the answer and moves focus off the destroyed button', async () => {
  const w = world(async () => ({ ok: true, json: async () => ({ because: 'That account is off the list.' }) }), 'claude');
  await w.click();
  await w.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(w.msg.textContent, 'That account is off the list.',
    'the success path did not say the route answer; if this reads like an error, the fixture is running the catch again');
  assert.equal(w.acctBox.focused, true,
    'focus did not move to the account list after the repaint destroyed the button, so a keyboard user is left on <body>');
});

/* 🛑 THE ANNOUNCE TIMER IS CANCELLED BEFORE EVERY WRITE, and this arm exists
   because the mechanism was covered by nothing: with the stub as a no-op, deleting
   every acctCancelSay() call in the page produced zero failures across the whole
   web suite. The race is real: the disabled default row stays pressable during an
   in-flight removal, and its 60ms deferred write lands on top of the success
   sentence, which is the one carrying where the account went. */
test('#1659: the removal path cancels the pending announcement before it writes', async () => {
  const w = world(async () => ({ ok: true, json: async () => ({ because: 'gone' }) }), 'claude');
  await w.click();
  await w.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(w.cancels.length >= 2,
    'the removal wrote to the message line without cancelling the pending announcement first, so a deferred '
    + 'refusal can replace the answer. cancels seen: ' + w.cancels.length);
});
