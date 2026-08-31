'use strict';

/**
 * kosmos#1656: the provider-connect modal shows a real success state, and only
 * while the modal is open.
 *
 *   node --test web.connect-success-1656.test.js
 *
 * On a good connect the "Add a provider" modal stops showing the sign-in controls
 * and shows a success panel: the reused green check, "Success! Successfully
 * connected to <account>", and a plain Close.
 *
 * 🔑 The one hazard is delivery timing. The Claude path is poll-driven
 * (acctFlowWatch), so a sign-in can finish AFTER the person dismissed the modal.
 * acctShowSuccess must NOT mutate a hidden modal, or the next open shows a stale
 * "Success!" with no provider form. That is the guard the second test carries.
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
        if (!el) throw new Error('the page asked for #' + id + ', which this stub does not carry');
        return el;
      },
    },
  };
}

const IDS = ['acct-add-modal', 'acct-add-in', 'acct-provider-field', 'acct-claude-flow',
  'acct-openai-flow', 'acct-add-acts', 'acct-success', 'acct-success-say', 'acct-success-close'];

/** acctShowSuccess, the REAL one, run against a stub in a known start state. */
function makeShow(modalHidden) {
  const dom = fakeDom(IDS);
  dom.els.get('acct-add-modal').hidden = modalHidden;
  dom.els.get('acct-success').hidden = true;      // starts hidden, like the HTML
  dom.els.get('acct-claude-flow').hidden = true;  // flows start hidden until a provider is picked
  dom.els.get('acct-openai-flow').hidden = true;
  const fn = new Function('document', lift(SCRIPT, 'acctShowSuccess') + '\nreturn acctShowSuccess;');
  return { show: fn(dom.document), els: dom.els };
}

test('kosmos#1656: on an OPEN modal, success shows, names the account, and hides the sign-in controls', () => {
  const { show, els } = makeShow(false);
  show('your Claude account');
  assert.equal(els.get('acct-success').hidden, false, 'the success panel is shown');
  assert.equal(els.get('acct-success-say').textContent, 'Successfully connected to your Claude account.');
  for (const id of ['acct-add-in', 'acct-provider-field', 'acct-claude-flow', 'acct-openai-flow', 'acct-add-acts']) {
    assert.equal(els.get(id).hidden, true, id + ' is hidden while success shows');
  }
  assert.equal(els.get('acct-success-close').focused, true, 'focus lands on the way out');
});

test('kosmos#1656: a background sign-in that finishes on a DISMISSED modal paints nothing', () => {
  /* The regression this guards: the Claude path is poll-driven, so if the person
     dismissed the modal before the connect completed, acctShowSuccess ran against
     a hidden modal, hid the controls, and stranded a stale "Success!" for the next
     open. The guard is a no-op when #acct-add-modal is hidden. */
  const { show, els } = makeShow(true);
  show('your Claude account');
  assert.equal(els.get('acct-success').hidden, true, 'success is NOT shown on a hidden modal');
  assert.equal(els.get('acct-success-say').textContent, '', 'no message is written');
  assert.equal(els.get('acct-provider-field').hidden, false, 'the sign-in controls are left untouched');
});

test('kosmos#1656: the way out is a non-primary button (#1438) and reuses the one green check', () => {
  const at = PAGE.indexOf('id="acct-success"');
  const panel = PAGE.slice(at, at + 600);
  const close = panel.slice(panel.indexOf('acct-success-close') - 60, panel.indexOf('acct-success-close') + 10);
  assert.match(close, /class="btn"/, 'the success Close is a plain .btn');
  assert.doesNotMatch(close, /uprime|danger/, 'the way out is not a primary or destructive action (the #1438 rule)');
  assert.match(panel, /class="acct-ok acct-ok-big"/, 'the success mark reuses .acct-ok rather than drawing a second check');
});

test('kosmos#1656: closeAcctAdd puts the modal back to its form state on the way out', () => {
  const at = SCRIPT.indexOf('function closeAcctAdd');
  const closeFn = SCRIPT.slice(at, at + 800);
  assert.match(closeFn, /getElementById\('acct-success'\)/, 'closeAcctAdd hides the success panel on close, so the next open is clean');
  assert.match(closeFn, /acct-provider-field/, 'closeAcctAdd restores the sign-in controls on close');
});

/* The two previous tests prove acctShowSuccess WORKS in isolation. These pin that it
   is actually WIRED: without them, deleting a call site would leave every other test
   green while the success state silently never appeared. The Claude path is RUN (it is
   the poll-driven one, and a run cannot be fooled by a dead branch); the OpenAI add is
   inside an async fetch handler, so its call site is pinned by source instead. */
test('kosmos#1656: acctFlowPaint on the connected phase shows success (Claude wiring, run)', () => {
  const dom = fakeDom([...IDS, 'acct-flow', 'acct-flow-say', 'acct-code-row', 'acct-add', 'acct-add-note']);
  dom.els.get('acct-add-modal').hidden = false;   // modal is open when the connect lands
  dom.els.get('acct-success').hidden = true;
  dom.els.get('acct-claude-flow').hidden = true;
  dom.els.get('acct-openai-flow').hidden = true;
  dom.els.get('acct-add-note').classList = { add() {}, remove() {} };
  const src = [lift(SCRIPT, 'acctFlowPaint'), lift(SCRIPT, 'acctShowSuccess'), 'return acctFlowPaint;'].join('\n');
  const paint = new Function(
    'document', 'frConnActive', 'ACCT_FLOW_SAY', 'acctPick', 'acctFlowStop', 'paintAccounts', 'pjSentence', 'ACCT_FLOW_LAST', src,
  )(dom.document, () => false, {}, () => {}, () => {}, () => {}, (s) => s, null);
  paint({ phase: 'connected' });
  assert.equal(dom.els.get('acct-success').hidden, false, 'the connected phase shows the success panel: the call site is wired');
  assert.equal(dom.els.get('acct-success-say').textContent, 'Successfully connected to your Claude account.');
});

test('kosmos#1656: the OpenAI add-success is wired to acctShowSuccess (source-pinned)', () => {
  const at = SCRIPT.indexOf("getElementById('acct-openai-go').addEventListener");
  const handler = SCRIPT.slice(at, at + 1600);
  assert.match(handler, /paintAccounts\(\);\s*acctShowSuccess\(/, 'on a good add, success fires after the account list is repainted');
});
