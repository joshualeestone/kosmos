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
  for (const id of ids) els.set(id, { id, textContent: '', innerHTML: '', hidden: false, value: '', attrs: {}, focus() { this.focused = true; }, setAttribute(k, v) { this.attrs[k] = v; } });
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

const IDS = ['acct-add-modal', 'acct-add-dialog', 'acct-add-t', 'acct-add-in', 'acct-provider-field', 'acct-claude-flow',
  'acct-openai-flow', 'acct-add-acts', 'acct-success', 'acct-success-say', 'acct-success-close',
  // #2241: acctShowSuccess now also touches these (the gold-box arm hides the default
  // check/heading and shows the box; the else-arm restores them). The stub throws on an
  // id it does not carry, so the real function's new refs must be declared here.
  'acct-success-box', 'acct-success-check', 'acct-success-t'];

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
  for (const id of ['acct-add-t', 'acct-add-in', 'acct-provider-field', 'acct-claude-flow', 'acct-openai-flow', 'acct-add-acts']) {
    assert.equal(els.get(id).hidden, true, id + ' is hidden while success shows');
  }
  assert.equal(els.get('acct-add-dialog').attrs['aria-labelledby'], 'acct-success-t', 'the dialog is renamed to its success heading, not the hidden form title');
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
  assert.equal(els.get('acct-add-t').hidden, false, 'the form title is left untouched');
});

test('kosmos#1656: the way out is a non-primary button (#1438) and reuses the one green check', () => {
  const at = PAGE.indexOf('id="acct-success"');
  // Bound at the next sibling (id="acct-add-acts", the plain Close row that follows the
  // #acct-success panel) rather than a fixed +600: #2241 added #acct-success-box inside the
  // panel, which pushed acct-success-close past a hard 600 and emptied the slice. This is
  // the whole panel and nothing beyond it, so it survives the panel gaining more markup.
  const panel = PAGE.slice(at, PAGE.indexOf('id="acct-add-acts"', at));
  const close = panel.slice(panel.indexOf('acct-success-close') - 60, panel.indexOf('acct-success-close') + 10);
  assert.match(close, /class="btn"/, 'the success Close is a plain .btn');
  assert.doesNotMatch(close, /uprime|danger/, 'the way out is not a primary or destructive action (the #1438 rule)');
  assert.match(panel, /class="acct-ok acct-ok-big"/, 'the success mark reuses .acct-ok rather than drawing a second check');
});

test('kosmos#1656: closeAcctAdd puts the modal back to its form state on the way out (run)', () => {
  // #2338: closeAcctAdd now also resets the ChatGPT-subscription sub-step's live
  // affordances and stops its poll, so the stub must carry those ids and the
  // acctOpenaiSubStop helper (the stub throws on anything it does not carry).
  const dom = fakeDom([...IDS, 'acct-add-open',
    'acct-openai-sub-open-row', 'acct-openai-sub-cancel-row', 'acct-openai-sub-code', 'acct-openai-sub-go']);
  // start from a success state: success shown, the form pieces and title hidden, dialog renamed
  dom.els.get('acct-success').hidden = false;
  for (const id of ['acct-add-t', 'acct-add-in', 'acct-provider-field', 'acct-add-acts']) dom.els.get(id).hidden = true;
  dom.els.get('acct-add-dialog').attrs['aria-labelledby'] = 'acct-success-t';
  // #2802: closeAcctAdd now reads the module-level ACCT_ADD_RETURN_FOCUS (the
  // control that opened the modal, to return focus to it). Inject it as a param
  // (null here) the same way ACCT_FLOW_LAST is injected below, so the lifted
  // function does not throw ReferenceError on the read.
  const close = new Function('document', 'acctAddConfirmReset', 'acctOpenaiSubStop', 'acctOpenaiSubReset', 'ACCT_ADD_RETURN_FOCUS', lift(SCRIPT, 'closeAcctAdd') + '\nreturn closeAcctAdd;')(dom.document, () => {}, () => {}, () => {}, null);
  close();
  assert.equal(dom.els.get('acct-success').hidden, true, 'the success panel is hidden on close');
  for (const id of ['acct-add-t', 'acct-add-in', 'acct-provider-field', 'acct-add-acts']) {
    assert.equal(dom.els.get(id).hidden, false, id + ' is restored on close');
  }
  assert.equal(dom.els.get('acct-add-dialog').attrs['aria-labelledby'], 'acct-add-t', 'the dialog title is restored on close');
  assert.equal(dom.els.get('acct-add-modal').hidden, true, 'the modal is closed');
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
  // Bound the slice at the NEXT handler (acct-code-go) rather than a fixed +1600 byte
  // count. #2241 (the Settings OpenAI gold-box) added a comment + a frCheckRow(...) build
  // before paintAccounts, which pushed the call pair past a hard 1600 and false-reddened
  // this despite the wiring being intact. Bounding at the handler's real end means it
  // cannot fall out of the window as the handler grows, and cannot drift into another
  // function's paintAccounts()/acctShowSuccess() pair (a false green): acct-code-go's
  // handler is the next one in source.
  const handler = SCRIPT.slice(at, SCRIPT.indexOf("acct-code-go", at));
  assert.match(handler, /paintAccounts\(\);\s*acctShowSuccess\(/, 'on a good add, success fires after the account list is repainted');
});
