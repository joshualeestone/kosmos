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

const IDS = ['acct-add-modal', 'acct-provider-pick', 'acct-provider-lab', 'acct-claude-flow',
  'acct-openai-flow', 'acct-add-note', 'acct-openai-msg', 'acct-code-row', 'acct-code',
  'acct-cancel', 'acct-add', 'acct-add-t', 'acct-add-in', 'acct-claude-warn'];

/**
 * The two doors and the chrome, lifted and run together.
 *
 * `acctPick` and `frConnActive` are stubbed because they belong to other cards;
 * every function this card added is the REAL one.
 */
function doors() {
  const dom = fakeDom(IDS);
  const src = [
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
  // The provider is not a choice here: the account already has one.
  assert.equal(dom.els.get('acct-provider-pick').hidden, true, 'the provider picker is still offered');
  assert.equal(dom.els.get('acct-provider-lab').hidden, true, 'the provider label is still offered');
  // And the dialog says which account, by name.
  assert.match(dom.els.get('acct-add-t').textContent, /Sign in again/);
  assert.match(dom.els.get('acct-add-in').textContent, /her@example\.com/, 'the dialog does not say which account this is for');
  assert.match(dom.els.get('acct-add-in').textContent, /does not make a second one/, 'the dialog does not promise the thing the card is about');
  assert.match(dom.els.get('acct-claude-warn').innerHTML, /sign in as her@example\.com/,
    'the warning still tells her to sign in to the OTHER account, which is the wrong instruction here');
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
  assert.equal(dom.els.get('acct-provider-pick').hidden, false, 'the provider picker stayed hidden');
  assert.equal(dom.els.get('acct-add').textContent, 'Start the sign-in', 'the button kept the reauth label');
});

test('one button, two requests, and never a plain start', () => {
  /* Evaluated rather than matched: the body is a ternary, and a source match
     cannot tell which arm is reachable. */
  const at = SCRIPT.indexOf("getElementById('acct-add').addEventListener");
  assert.ok(at > -1, 'the button wiring moved; restate this pin');
  const m = SCRIPT.slice(at, at + 1200).match(/body: JSON\.stringify\((.+?)\),\n/s);
  assert.ok(m, 'the start request no longer builds a body this test can read');
  const build = new Function('ACCT_REAUTH_DIR', 'return ' + m[1] + ';');

  const reauth = build('/Users/x/.claude-account-b');
  assert.deepEqual(reauth, { accountDir: '/Users/x/.claude-account-b' },
    'an aimed sign-in does not ask for that account');

  const fresh = build(null);
  assert.deepEqual(fresh, { another: true },
    'an unaimed sign-in does not ask for ANOTHER account');

  /* 🛑 THE ROUTE REFUSES BOTH TOGETHER, so neither shape may carry both, and a
     plain start would sign into the DEFAULT config and could log the person's
     main account out. That hazard is what kept this button disabled for a day. */
  for (const [name, body] of [['aimed', reauth], ['fresh', fresh]]) {
    assert.ok(!('accountDir' in body && 'another' in body), name + ' asks for a new account and an existing one at once');
    assert.ok(Object.keys(body).length > 0, name + ' sends a plain start');
  }
});

test('the row offers it on every Claude row, including a signed-in one, and never on OpenAI', () => {
  /* ⭐ ON A SIGNED-IN ROW TOO, AND THAT IS THE POINT, NOT AN OVERSIGHT. #874
     measured that this badge cannot see a REJECTED token, so Josh's own case
     was a green row and a dead login. Gating the remedy on "not signed in"
     would hide it from exactly the state the card came from. */
  const at = PAGE.indexOf('const acctRowHtml = (a) =>');
  assert.ok(at > -1, 'the row builder moved; restate this pin');
  const row = PAGE.slice(at, PAGE.indexOf('box.innerHTML = accountGroupsHtml', at));

  const reauthBit = row.slice(row.indexOf('data-reauth') - 400, row.indexOf('data-reauth') + 400);
  assert.match(reauthBit, /isOpenai \? ''/, 'the sign-in-again button is not withheld from OpenAI rows');
  assert.doesNotMatch(reauthBit, /connection/,
    'the button is gated on the connection state, which hides it from the very case #874 describes');
  assert.match(row, /data-reauth="' \+ esc\(a\.dir\)/, 'the button does not carry the account it means');

  // It is wired, not decorative.
  assert.match(PAGE, /querySelectorAll\('\[data-reauth\]'\)/, 'nothing listens to the sign-in-again buttons');
  assert.match(PAGE, /openAcctReauth\(btn\.dataset\.reauth/, 'the click does not aim the flow at that row');
});
