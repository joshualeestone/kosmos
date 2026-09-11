'use strict';

/**
 * #1492: a way back into an account you already have.
 *
 *   node --test web.reauth-1492.test.js
 *
 * Josh's sister's Claude login expired. Settings correctly said not connected.
 * The only affordance on the screen was "Add a provider", which signs in to a
 * NEW directory, so she ended with two records for one login and no way to move
 * her agent onto either.
 *
 * The route landed in #1497 and nothing called it. These pin the calling half.
 *
 * 🔑 RUN, DO NOT GREP, WHEREVER IT IS POSSIBLE. The three assertions that carry
 * this card are about what the code DOES with a variable, and a source match
 * cannot tell a live branch from a dead one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { scriptOf, lift } = require('./test-support/page');

const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = scriptOf(PAGE);

/** A DOM stub that records what was set, and NAMES an element nobody stubbed. */
function fakeDom(ids) {
  const els = new Map();
  for (const id of ids) els.set(id, { id, textContent: '', innerHTML: '', hidden: false, value: '', focus() { this.focused = true; } });
  return {
    els,
    document: {
      getElementById(id) {
        const el = els.get(id);
        /* 🛑 THROWS RATHER THAN RETURNING undefined. A stub that answers
           undefined turns "the function reached for an element" into
           "Cannot read properties of undefined", which reads as the product
           being broken. Naming the id is the difference between a two-minute
           fix and an hour. */
        if (!el) throw new Error('the page asked for #' + id + ', which this stub does not carry');
        return el;
      },
    },
  };
}

const IDS = ['acct-add-modal', 'acct-provider-field', 'acct-provider-pick', 'acct-provider-lab',
  'acct-claude-flow', 'acct-openai-flow', 'acct-add-note', 'acct-openai-msg', 'acct-code-row',
  'acct-code', 'acct-cancel', 'acct-add', 'acct-add-t', 'acct-add-in', 'acct-claude-warn'];

/**
 * The two doors and the chrome, lifted and run together.
 *
 * `acctPick` and `frConnActive` are stubbed because they belong to other cards;
 * every function this card added is the REAL one.
 *
 * #1760: `esc` is lifted in too, not stubbed. acctReauthChrome now escapes the
 * account email before it reaches warn.innerHTML, and esc is a shared board
 * utility that is in scope on the real page. Lifting the REAL esc keeps this
 * harness faithful to the page and lets the escaping assertion below exercise
 * the actual code rather than a stub that could hide a regression.
 */
function doors() {
  const dom = fakeDom(IDS);
  const src = [
    lift(SCRIPT, 'esc'),
    lift(SCRIPT, 'acctReauthChrome'),
    lift(SCRIPT, 'openAcctReauth'),
    lift(SCRIPT, 'openAcctAdd'),
    'return { acctReauthChrome, openAcctReauth, openAcctAdd, get dir() { return ACCT_REAUTH_DIR; }, set dir(v) { ACCT_REAUTH_DIR = v; } };',
  ].join('\n');
  const picked = [];
  const fn = new Function('document', 'acctPick', 'frConnActive', 'ACCT_FLOW_LAST',
    'ACCT_ADD_TITLE', 'ACCT_ADD_INTRO', 'picked',
    'let ACCT_REAUTH_DIR = null;\n' + src);
  const api = fn(dom.document, (w, o) => picked.push([w, o]), () => false, null,
    'Add a provider', 'Pick which AI provider you want to connect.', picked);
  return { dom, api, picked };
}

test('pressing sign-in-again on a row aims the ONE flow at that account', () => {
  const { dom, api, picked } = doors();
  api.openAcctReauth('/Users/x/.claude-account-b', 'her@example.com');
  assert.equal(api.dir, '/Users/x/.claude-account-b', 'the flow was not aimed at the account that was pressed');
  assert.equal(dom.els.get('acct-add-modal').hidden, false, 'the dialog did not open');
  assert.deepEqual(picked[0] && picked[0][0], 'claude', 'reauth did not select the Claude flow');
  // The provider is not a choice here: the account already has one. The whole
  // field container is hidden, not the <label> and native <select> alone:
  // enhanceProviderSelect inserts the visible .pcombo widget as a sibling of
  // the select, so hiding the container is what actually removes the chooser.
  assert.equal(dom.els.get('acct-provider-field').hidden, true, 'the provider chooser is still offered on reauth');
  // And the dialog says which account, by name.
  assert.match(dom.els.get('acct-add-t').textContent, /Sign in again/);
  assert.match(dom.els.get('acct-add-in').textContent, /her@example\.com/, 'the dialog does not say which account this is for');
  assert.match(dom.els.get('acct-add-in').textContent, /does not make a second one/, 'the dialog does not promise the thing the card is about');
  assert.match(dom.els.get('acct-claude-warn').innerHTML, /sign in as her@example\.com/,
    'the warning still tells her to sign in to the OTHER account, which is the wrong instruction here');
});

test('#1760: the account email is escaped before it reaches the warning innerHTML', () => {
  /* The warning is the one reauth surface that writes the email into innerHTML
     rather than textContent, so it is the one that must escape. A real email
     cannot carry markup, but the sink must not depend on that: an email with
     angle brackets has to arrive as text, never as live HTML. If esc were
     dropped, `<b>` here would open a real bold element and the assertion below
     would see the literal `<b>` gone. */
  const { dom, api } = doors();
  api.openAcctReauth('/Users/x/.claude-account-b', 'a<b>x</b>@example.com');
  const html = dom.els.get('acct-claude-warn').innerHTML;
  assert.match(html, /a&lt;b&gt;x&lt;\/b&gt;@example\.com/,
    'the account email was not HTML-escaped in the reauth warning');
  assert.doesNotMatch(html, /a<b>x<\/b>@example\.com/,
    'the raw email markup reached innerHTML unescaped');
});

test('🛑 the stock door CLEARS the aim, so + Add a provider can never quietly reauth', () => {
  /* THE DANGEROUS DIRECTION. A stale dir makes the next "Add a provider" sign
     in to an account that already exists: the mirror image of this card's own
     defect, and worse, because it silently succeeds. */
  const { dom, api } = doors();
  api.openAcctReauth('/Users/x/.claude-account-b', 'her@example.com');
  assert.equal(api.dir, '/Users/x/.claude-account-b', 'setup failed; the rest of this test proves nothing');
  api.openAcctAdd();
  assert.equal(api.dir, null, 'the add-a-provider door left the dialog aimed at an existing account');
  // and the chrome came back, or the dialog would still read "Sign in again".
  assert.equal(dom.els.get('acct-add-t').textContent, 'Add a provider', 'the dialog kept the reauth title');
  assert.equal(dom.els.get('acct-provider-field').hidden, false, 'the provider chooser stayed hidden');
  assert.equal(dom.els.get('acct-add').textContent, 'Start the sign-in', 'the button kept the reauth label');
});

test('one button, two requests, and never a plain start', () => {
  /* Evaluated rather than matched: the body is a ternary, and a source match
     cannot tell which arm is reachable.
     🛑 #1587 moved the POST out of the click handler into `acctAddStart` so the
     install-confirm gate can run first; the either-arm body moved with it, and
     this pin follows it there. */
  const at = SCRIPT.indexOf('async function acctAddStart');
  assert.ok(at > -1, 'the start worker moved; restate this pin');
  /* 1800, not 1200: #1574 added the confirm flag and its comment to the body. */
  const m = SCRIPT.slice(at, at + 1800).match(/body: JSON\.stringify\((.+?)\),\n/s);
  assert.ok(m, 'the start request no longer builds a body this test can read');
  /* 🛑 #1574 GAVE THE BODY A SECOND INPUT, so the harness has to supply it or the
     expression throws. Both are passed here for the same reason the ternary is
     evaluated rather than matched: a source match cannot tell which arm is
     reachable, and it cannot tell what the flag resolves to either. */
  const build = new Function('ACCT_REAUTH_DIR', 'installConfirmed', 'return ' + m[1] + ';');

  const reauth = build('/Users/x/.claude-account-b', true);
  /* #1937: the aimed ("Sign in again") arm now also carries `reauth: true`, the
     explicit signal the server threads to connect.start so it skips the
     already-connected short-circuit and runs a real login. The fresh/another arm
     below deliberately does NOT carry it. */
  assert.deepEqual(reauth, { accountDir: '/Users/x/.claude-account-b', reauth: true, installConfirmed: true },
    'an aimed sign-in does not ask for that account, and carries the #1937 reauth flag');

  const fresh = build(null, true);
  assert.deepEqual(fresh, { another: true, installConfirmed: true },
    'an unaimed sign-in does not ask for ANOTHER account');

  /* 🛑 #1574: THE FLAG MUST TRAVEL, NOT BE PINNED TRUE. A body that hardcoded
     `installConfirmed: true` would satisfy the two assertions above and would be
     the defect this card exists to close: the page asserting a consent nobody
     gave. Building it with `false` is what tells those two apart. */
  const unconfirmed = build(null, false);
  assert.equal(unconfirmed.installConfirmed, false,
    'the request says a person confirmed even when nobody did, which is exactly the #1574 defect');

  /* 🛑 THE ROUTE REFUSES BOTH TOGETHER, so neither shape may carry both, and a
     plain start would sign into the DEFAULT config and could log the person's
     main account out. That hazard is what kept this button disabled for a day. */
  for (const [name, body] of [['aimed', reauth], ['fresh', fresh], ['unconfirmed', unconfirmed]]) {
    assert.ok(!('accountDir' in body && 'another' in body), name + ' asks for a new account and an existing one at once');
    /* The confirm flag alone is not an ask: a body carrying only `installConfirmed`
       is still the plain start #248 is about. */
    assert.ok(('accountDir' in body) || ('another' in body), name + ' sends a plain start');
  }
});

test('reauth is offered on subscription rows (Claude AND OpenAI chatgpt), never on api-key rows, and each is wired to its own flow', () => {
  /* ⭐ ON A SIGNED-IN ROW TOO, AND THAT IS THE POINT, NOT AN OVERSIGHT. #874
     measured that this badge cannot see a REJECTED token, so Josh's own case
     was a green row and a dead login. Gating the remedy on "not signed in"
     would hide it from exactly the state the card came from. */
  const at = PAGE.indexOf('const acctRowHtml = (a) =>');
  assert.ok(at > -1, 'the row builder moved; restate this pin');
  const row = PAGE.slice(at, PAGE.indexOf('box.innerHTML = accountGroupsHtml', at));

  /* #2568/#2584: the old `isOpenai || a.apiKey ? ''` single suppression is now a
     per-provider ternary. The Claude arm (the non-openai branch) is gated on `a.apiKey`
     -- an api-key Claude account still cannot browser-OAuth reauth (writing OAuth into a
     stored-key dir is refused by the connect-start guard #2432; the answer is
     remove-and-re-add). A Claude subscription row (apiKey present-and-false) still gets it. */
  const claudeAt = row.indexOf('data-reauth="');
  assert.ok(claudeAt > -1, 'the Claude reauth button is gone');
  const claudeBit = row.slice(claudeAt - 300, claudeAt + 200);
  assert.match(claudeBit, /a\.apiKey \? ''/, 'the Claude reauth is not withheld from api-key rows');
  assert.doesNotMatch(claudeBit, /connection/,
    'the Claude reauth is gated on connection state, which hides the very #874 case');
  assert.match(row, /data-reauth="' \+ esc\(a\.dir\)/, 'the Claude reauth button does not carry the account it means');

  /* #2584 gave the OpenAI ChatGPT-subscription row a real reauth-in-place, so it now
     offers a sign-in-again too -- via the SUBSCRIPTION flow, gated on the auth_mode SHAPE
     so an api-key OpenAI row (no sign-in to redo) is excluded. */
  const openaiAt = row.indexOf('data-openai-reauth="');
  assert.ok(openaiAt > -1, 'the OpenAI chatgpt row has no reauth button (#2568/#2584)');
  const openaiBit = row.slice(openaiAt - 300, openaiAt + 200);
  assert.match(openaiBit, /a\.authMode === 'chatgpt'/, 'the OpenAI reauth is not gated on the chatgpt auth-mode shape');
  assert.match(row, /data-openai-reauth="' \+ esc\(a\.dir\)/, 'the OpenAI reauth button does not carry the account it means');

  // Each is wired to its OWN flow, never crossed: Claude -> browser-OAuth reauth,
  // OpenAI -> the subscription reauth (which threads reauthDir).
  assert.match(PAGE, /querySelectorAll\('\[data-reauth\]'\)/, 'nothing listens to the Claude sign-in-again buttons');
  assert.match(PAGE, /openAcctReauth\(btn\.dataset\.reauth/, 'the Claude click does not aim the flow at that row');
  assert.match(PAGE, /querySelectorAll\('\[data-openai-reauth\]'\)/, 'nothing listens to the OpenAI sign-in-again buttons');
  assert.match(PAGE, /openAcctReauthOpenai\(btn\.dataset\.openaiReauth/, 'the OpenAI click does not aim the subscription reauth at that row');
  // The subscription-start POST threads the reauth target so the engine refreshes in place.
  assert.match(PAGE, /reauthDir: ACCT_OPENAI_REAUTH_DIR \|\| undefined/, 'the subscription reauth does not thread reauthDir to the engine');
});
