'use strict';

/**
 * kosmos#2338: the OpenAI connect picker in Settings -- choose a ChatGPT
 * subscription (Codex signs in, no key) or an API key. The subscription flow is
 * start -> poll -> connected against PigeonPete's contract (start/status/cancel
 * routes on branch openai-subscription-2338); this UI is the connect-row shell
 * that wires to it.
 *
 * 🔑 THE DECIDING FUNCTIONS ARE EXTRACTED AND RUN, not matched -- which flow the
 * picker reveals, how a status state maps to the panel, and the subscription-vs-
 * key discriminator are logic a regex cannot see. The route wiring (which a regex
 * CAN see, and which must match the contract exactly) is asserted separately.
 *
 *   node --test web.openai-subscription-picker-2338.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');

function extract(name, endAnchor) {
  const a = PAGE.indexOf('function ' + name + '(');
  assert.ok(a > -1, name + ' moved; re-anchor this test');
  const b = PAGE.indexOf(endAnchor, a + 1);
  assert.ok(b > a, name + ' no longer ends where expected (anchor: ' + endAnchor + ')');
  return PAGE.slice(a, b);
}

/* --- acctOpenaiChoose: the picker reveals exactly the chosen flow ---------- */
function chooseFn() {
  const src = extract('acctOpenaiChoose', '\nfunction acctOpenaiSubView');
  const els = {
    'acct-openai-pick': { hidden: null },
    'acct-openai-key-step': { hidden: null },
    'acct-openai-sub-step': { hidden: null },
    'acct-openai-msg': { textContent: 'a stale error from a prior sign-in' },
    'acct-openai-key': { focus() { this.focused = true; } },
    'acct-openai-sub-go': { focus() { this.focused = true; } },
  };
  // acctOpenaiChoose('sub') calls acctOpenaiSubReset (defined elsewhere); spy on it
  // so the extracted function runs in isolation and we can assert idempotent entry.
  const spy = { reset: 0 };
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', 'acctOpenaiSubReset', src + '; return acctOpenaiChoose;')({ getElementById: (id) => els[id] || null }, () => { spy.reset += 1; });
  return { fn, els, spy };
}

test('choosing the key flow shows the key step and hides the picker and the subscription flow', () => {
  const { fn, els } = chooseFn();
  fn('key');
  assert.equal(els['acct-openai-pick'].hidden, true, 'the picker stayed up after a choice was made');
  assert.equal(els['acct-openai-key-step'].hidden, false, 'the key flow did not open when it was chosen');
  assert.equal(els['acct-openai-sub-step'].hidden, true, 'the subscription flow opened even though the key flow was chosen');
  assert.equal(els['acct-openai-key'].focused, true, 'the key field did not take focus');
  assert.equal(els['acct-openai-msg'].textContent, '', 'a stale status/error line was not cleared on entering a flow');
});

test('choosing the subscription flow shows the sub step and hides the picker and the key flow', () => {
  const { fn, els, spy } = chooseFn();
  fn('sub');
  assert.equal(els['acct-openai-pick'].hidden, true, 'the picker stayed up after a choice was made');
  assert.equal(els['acct-openai-sub-step'].hidden, false, 'the subscription flow did not open when it was chosen');
  assert.equal(els['acct-openai-key-step'].hidden, true, 'the key flow opened even though the subscription flow was chosen');
  assert.equal(els['acct-openai-sub-go'].focused, true, 'the Sign in button did not take focus');
  assert.equal(spy.reset, 1, 'entering the subscription step did not reset its affordances (entry is not idempotent)');
});

/* --- acctOpenaiSubView: every contract state maps, terminals stop the poll -- */
function viewFn() {
  const src = extract('acctOpenaiSubView', '\nasync function acctOpenaiLook');
  // eslint-disable-next-line no-new-func
  return new Function(src + '; return acctOpenaiSubView;')();
}

test('the status states map to the right poll/paint intent', () => {
  const view = viewFn();
  // Non-terminal states keep the poll alive and never claim success.
  for (const s of ['starting', 'awaiting-browser', 'awaiting-code']) {
    assert.equal(view(s).done, false, `${s} was treated as terminal and stopped the poll`);
    assert.equal(view(s).ok, false, `${s} was read as a success`);
    assert.ok(view(s).say, `${s} left the panel with nothing to say`);
  }
  // connected is the one and only terminal success.
  assert.deepEqual({ done: view('connected').done, ok: view('connected').ok }, { done: true, ok: true },
    'connected was not the terminal success');
  // error and cancelled are terminal failures, not successes.
  for (const s of ['error', 'cancelled']) {
    assert.equal(view(s).done, true, `${s} did not stop the poll`);
    assert.equal(view(s).ok, false, `${s} was read as a success`);
  }
  // An unknown state must not silently claim success or stop the poll.
  assert.deepEqual({ done: view('sideways').done, ok: view('sideways').ok }, { done: false, ok: false },
    'an unrecognised state was treated as a terminal success');
});

/* --- route wiring: exact contract paths, no drift ------------------------- */
test('the subscription routes match the contract paths exactly', () => {
  assert.match(PAGE, /fetch\('\/api\/accounts\/openai\/subscription\/start'/, 'the start route drifted from the contract path');
  assert.match(PAGE, /fetch\('\/api\/accounts\/openai\/subscription\/status\?sessionId='/, 'the status route drifted from the contract path');
  assert.match(PAGE, /fetch\('\/api\/accounts\/openai\/subscription\/cancel'/, 'the cancel route drifted from the contract path');
});

test('a start that needs the runner routes to the install step in place, like the key path (#979)', () => {
  const i = PAGE.indexOf("'/api/accounts/openai/subscription/start'");
  assert.ok(i > -1, 'the subscription start handler moved');
  const body = PAGE.slice(i, i + 900);
  assert.match(body, /out && out\.needsRunner/, 'a needsRunner start answer is not detected, so a missing runner leaves a dead sign-in');
  assert.match(body, /ACCT_OPENAI_READY = false; acctOpenaiStep\(false\)/, 'a needsRunner start does not reveal the install step in place');
});

test('the poll treats a 404 as terminal (stops + resets), not a transient skip', () => {
  const i = PAGE.indexOf('function acctOpenaiSubWatch()');
  assert.ok(i > -1, 'acctOpenaiSubWatch moved');
  const body = PAGE.slice(i, PAGE.indexOf('\nasync function acctOpenaiSubConnected', i));
  assert.match(body, /r\.status === 404/, 'a 404 is not distinguished, so an expired session polls forever');
  // The 404 branch must stop the poll, drop the session, and reset (which re-enables the button).
  const four = body.slice(body.indexOf('r.status === 404'));
  const nextTerminal = four.slice(0, four.indexOf('if (!r.ok) return'));
  assert.match(nextTerminal, /acctOpenaiSubStop\(\)/, 'a 404 does not stop the poll');
  assert.match(nextTerminal, /ACCT_OPENAI_SUB_SESSION = null/, 'a 404 leaves the dead session id set');
  assert.match(nextTerminal, /acctOpenaiSubReset\(\)/, 'a 404 does not reset the sub-step (which re-enables the button)');
  // A non-404 non-ok must remain a transient skip (keep polling).
  assert.match(body, /if \(!r\.ok\) return;/, 'a 5xx is no longer treated as a transient skip');
});

test('a terminal error/cancelled tears down like the 404 branch (reset + null session)', () => {
  const i = PAGE.indexOf('function acctOpenaiSubWatch()');
  const body = PAGE.slice(i, PAGE.indexOf('\nasync function acctOpenaiSubConnected', i));
  // Isolate the error/cancelled branch (after the ok branch's early return).
  const fail = body.slice(body.indexOf('error / cancelled'));
  assert.match(fail, /ACCT_OPENAI_SUB_SESSION = null/, 'a terminal error leaves the dead session id set');
  assert.match(fail, /acctOpenaiSubReset\(\)/, 'a terminal error leaves the stale affordances showing / button disabled (reset handles both)');
});

test('overlapping ticks cannot double-invoke the connected handler', () => {
  const i = PAGE.indexOf('function acctOpenaiSubWatch()');
  const body = PAGE.slice(i, PAGE.indexOf('\nasync function acctOpenaiSubConnected', i));
  const ok = body.slice(body.indexOf('if (view.ok)'), body.indexOf('error / cancelled'));
  // The guard must null the session synchronously BEFORE the awaited connected call.
  assert.match(ok, /if \(!ACCT_OPENAI_SUB_SESSION\) return;\s*ACCT_OPENAI_SUB_SESSION = null;\s*await acctOpenaiSubConnected/,
    'a slow tick can double-paint success: the session is not nulled synchronously before the connected await');
});

test('acctOpenaiSubReset returns the sub-step to rest and re-enables the button', () => {
  const a = PAGE.indexOf('function acctOpenaiSubReset()');
  assert.ok(a > -1, 'acctOpenaiSubReset moved');
  const src = PAGE.slice(a, PAGE.indexOf('\n/* #2338: poll', a));
  const els = {
    'acct-openai-sub-open-row': { hidden: false },
    'acct-openai-sub-cancel-row': { hidden: false },
    'acct-openai-sub-code': { hidden: false, textContent: 'code 1234' },
    'acct-openai-sub-go': { disabled: true },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('document', src + '; return acctOpenaiSubReset;')({ getElementById: (id) => els[id] || null });
  fn();
  assert.equal(els['acct-openai-sub-open-row'].hidden, true, 'the open-page link stayed visible');
  assert.equal(els['acct-openai-sub-cancel-row'].hidden, true, 'the cancel row stayed visible');
  assert.equal(els['acct-openai-sub-code'].hidden, true, 'the device code row stayed visible');
  assert.equal(els['acct-openai-sub-code'].textContent, '', 'the device code text was not cleared');
  assert.equal(els['acct-openai-sub-go'].disabled, false, 'the Sign-in button was left stuck disabled');
});

test('a start with no sessionId does not strand a disabled button', () => {
  const i = PAGE.indexOf("'/api/accounts/openai/subscription/start'");
  assert.ok(i > -1, 'the subscription start handler moved');
  // 1400 (was 1100): #2568/#2584 added a reauthDir comment + field to the request body
  // above this guard, so the guard sits a few lines further into the handler now.
  const body = PAGE.slice(i, i + 1400);
  assert.match(body, /if \(!out \|\| !out\.sessionId\)/, 'a 2xx start with no sessionId is not guarded, so the button stays disabled behind a stuck message');
  // The guard must throw so the shared catch re-enables the button.
  const guard = body.slice(body.indexOf('!out.sessionId'));
  assert.match(guard.slice(0, 200), /throw new Error/, 'the no-sessionId guard does not throw into the catch that re-enables the button');
});

test('the connected paint mirrors the key path: a live check then the gold box', () => {
  const i = PAGE.indexOf('async function acctOpenaiSubConnected');
  assert.ok(i > -1, 'acctOpenaiSubConnected moved');
  const body = PAGE.slice(i, PAGE.indexOf('\ndocument.getElementById', i));
  assert.match(body, /frCheckRow\(\{ state: 'ok'/, 'the connected state does not build the gold check-row box the key path uses');
  assert.match(body, /await paintAccounts\(\)/, 'success is declared without the live paintAccounts() verification the key path runs first');
  assert.match(body, /acctShowSuccess\(/, 'the success panel is never shown on a connected subscription');
});

/* The poll must be torn down when the dialog closes, or a completing sign-in
   paints success into a hidden modal (the #1656 hazard the key path avoids). */
test('closing the dialog stops the subscription poll and drops the session', () => {
  const i = PAGE.indexOf('function closeAcctAdd()');
  assert.ok(i > -1, 'closeAcctAdd moved');
  const body = PAGE.slice(i, PAGE.indexOf('\ndocument.getElementById', i));
  assert.match(body, /acctOpenaiSubStop\(\)/, 'closing the dialog leaves the subscription poll running');
  assert.match(body, /ACCT_OPENAI_SUB_SESSION = null/, 'closing the dialog leaves a stale session id that a reopen could resume');
});
