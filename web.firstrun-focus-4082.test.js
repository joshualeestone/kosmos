'use strict';

/**
 * #4082: a first-run subscription sign-in that finishes hides its step, and focus inside that step fell to the page
 * (a keyboard or screen-reader user lost their place). Gemini's is covered in web.agy-on-3568.test.js; this pins
 * GPT's, run as written (frOpenaiSubConnected lifted from the page) against a stand-in page.
 *
 *   node --test web.firstrun-focus-4082.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function lift(name) {
  const start = PAGE.indexOf('async function ' + name + '(');
  assert.ok(start > -1, name + ' moved; update this test');
  let depth = 0; let end = -1;
  for (let k = PAGE.indexOf('{', start); k < PAGE.length; k += 1) {
    if (PAGE[k] === '{') depth += 1;
    else if (PAGE[k] === '}') { depth -= 1; if (depth === 0) { end = k + 1; break; } }
  }
  return PAGE.slice(start, end);
}

function run(focusId, { paintFails = false, during = null, frStep = 5 } = {}) {
  const els = {};
  const doc = { body: { id: 'body' }, activeElement: null };
  const el = (id) => (els[id] || (els[id] = { id, hidden: false, textContent: '', attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; }, focus() { doc.activeElement = this; this.textAtFocus = this.textContent; },
    contains(x) {
      const pre = { 'fr-openai-sub-step': 'fr-openai-sub-', 'fr-openai-pick': 'fr-openai-pick-' }[this.id];
      return !!pre && !!x && typeof x.id === 'string' && x.id.startsWith(pre);
    } }));
  doc.getElementById = el;
  doc.activeElement = focusId === 'body' ? doc.body : el(focusId);
  const fn = new Function('document', 'paintAccounts', 'frPaintOpenai', 'FR_STEP', `
    let ACCT_OPENAI_SUB_SESSION = 's1';
    ${lift('frOpenaiSubConnected')}
    return frOpenaiSubConnected;`)(doc, async () => { if (during) during(el); }, async () => { if (paintFails) throw new Error('offline'); }, frStep);
  return { fn, doc, el };
}

test('#4082: GPT\'s subscription success moves focus from the hidden step to the connected box', async () => {
  const r = run('fr-openai-sub-open');
  await r.fn({});
  assert.equal(r.el('fr-openai-sub-step').hidden, true);
  assert.equal(r.doc.activeElement, r.el('fr-openai-msg'), 'focus stayed on a control in the hidden step');
  assert.equal(r.el('fr-openai-msg').attrs.tabindex, '-1');
  assert.match(r.el('fr-openai-msg').textContent, /connected/, 'focus landed on an empty box');
});

test('#4082: the box says the result the moment focus lands, not the poll\'s stale "finish signing in" line', async () => {
  let atRead = null;
  const r = run('fr-openai-sub-open', { during: (el) => { atRead = el('fr-openai-msg').textContent; } });
  r.el('fr-openai-msg').textContent = 'Finish signing in on the page that opened.';
  await r.fn({});
  assert.equal(atRead, 'GPT is connected.', 'during the accounts read the focused box said: ' + JSON.stringify(atRead));
});

test('#4082: from the page itself too (focus already dropped), and even when the repaint fails', async () => {
  const r = run('body', { paintFails: true });
  await r.fn({});   // must not reject: it runs in the poll's interval callback, where a rejection goes unhandled
  assert.equal(r.doc.activeElement, r.el('fr-openai-msg'));
  assert.equal(r.el('fr-openai-msg').textContent, 'GPT is connected.', 'the sentence did not survive the failed repaint');
});

test('#4082: focus in the re-shown picker (Connect pressed again mid sign-in) also lands on the box when it connects', async () => {
  const r = run('fr-openai-pick-sub');
  await r.fn({});
  assert.equal(r.el('fr-openai-pick').hidden, true);
  assert.equal(r.doc.activeElement, r.el('fr-openai-msg'), 'focus was left in the hidden picker');
});

for (const id of ['fr-alt', 'fr-openai-connect']) {
  test(`#4082: focus on ${id} (hidden or disabled by the success) also lands on the box`, async () => {
    const r = run(id);
    await r.fn({});
    assert.equal(r.doc.activeElement, r.el('fr-openai-msg'));
  });
}
test('#4082: focus lands first, then the sentence is written (Grok\'s order: the live region reads it once)', async () => {
  const r = run('fr-openai-sub-open');
  r.el('fr-openai-msg').textContent = 'Finish signing in on the page that opened.';
  await r.fn({});
  assert.notEqual(r.el('fr-openai-msg').textAtFocus, 'GPT is connected.', 'the sentence was written before focus moved');
  assert.equal(r.el('fr-openai-msg').textContent, 'GPT is connected.');
});
test('#4082: off the model step, focus is not moved', async () => {
  const r = run('fr-openai-sub-open', { frStep: 6 });
  await r.fn({});
  assert.equal(r.doc.activeElement, r.el('fr-openai-sub-open'));
});
test('#4082 CONTROL: a person who has moved on keeps their place', async () => {
  const r = run('fr-grok-connect');
  await r.fn({});
  assert.equal(r.doc.activeElement, r.el('fr-grok-connect'), 'focus was taken from outside the step');
});

test('#4082: focus moves before the accounts read, so a person who Tabs on during it keeps their place', async () => {
  const r = run('fr-openai-sub-cancel', { during: (el) => el('fr-grok-connect').focus() });
  await r.fn({});
  assert.equal(r.doc.activeElement, r.el('fr-grok-connect'), 'focus was pulled back to the box after the person moved on');
});
