'use strict';
/**
 * kosmos#4454 (Josh): the Mac app's own Kosmos+ setup can create a new account, so the person ticks
 * "I agree to the Terms of Service and Privacy Policy" first. Driven THROUGH the Confirm click binding
 * (the #752 lesson) against a fake fetch: unticked sends nothing, ticked sends the agreement.
 *
 *   node --test web.plus-terms-4454.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = require('./test-support/page');
const HTML = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = page.scriptOf(HTML);

function confirmWorld() {
  const els = {};
  const el = (id) => (els[id] ||= { id, textContent: '', value: '', hidden: false, checked: false, listeners: {},
    addEventListener(t, fn) { this.listeners[t] = fn; } });
  const calls = [];
  const said = [];
  const ctx = {
    document: { getElementById: el },
    fetch: async (url, opts) => { calls.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => ({}) }; },
    plusSay: (words) => { said.push(words); },
    plusNameClean: (s) => s,
    PLUS_NAME_RULE: /^[a-z0-9-]{3,32}$/,
    plusWords: (s) => s,
    paintPlus: () => {},
  };
  const start = SCRIPT.indexOf("document.getElementById('plus-confirm').addEventListener");
  const end = SCRIPT.indexOf('const PLUS_SECOND_WORDS', start);
  assert.ok(start > 0 && end > start, 'the Confirm handler moved; re-anchor this test');
  vm.runInNewContext(SCRIPT.slice(start, end), ctx);
  el('plus-code').value = '123456';
  el('plus-name').value = 'hers';
  return { el, calls, said, confirm: () => el('plus-confirm').listeners.click() };
}

test('#4454: Confirm with the box unticked sends nothing and says to tick it', async () => {
  const w = confirmWorld();
  await w.confirm();
  assert.equal(w.calls.length, 0, 'the setup was sent without the terms agreed');
  assert.match(w.said.join(' '), /tick the box to agree to the Terms of Service and Privacy Policy/);
});

test('#4454: Confirm with the box ticked sends the agreement with the code and name', async () => {
  const w = confirmWorld();
  w.el('plus-terms').checked = true;
  await w.confirm();
  assert.equal(w.calls.length, 1, 'a ticked Confirm did not send the setup');
  assert.equal(w.calls[0].url, '/api/remote/setup-complete');
  assert.deepEqual(w.calls[0].body, { code: '123456', name: 'hers', acceptedTerms: true });
});

test('#4454: the box starts unticked, sits in the setup form before Confirm, and names both documents', () => {
  const box = /<input type="checkbox" id="plus-terms"[^>]*>/.exec(HTML);
  assert.ok(box, 'no terms box in the setup form');
  assert.doesNotMatch(box[0], /checked/, 'the terms box must start unticked');
  const form = HTML.slice(HTML.indexOf('<div id="plus-code-row"'), HTML.indexOf('id="plus-confirm"'));
  assert.ok(form.includes('id="plus-terms"'), 'the box is not in the setup form, before Confirm');
  for (const id of ['plus-terms-link', 'plus-privacy-link']) {
    const a = new RegExp('<a id="' + id + '" href="#" target="_blank" rel="noreferrer noopener">').exec(form);
    assert.ok(a, id + ' must open in a new tab, with its address set from KOSMOS_SITE');
  }
});

test('#4454: paintPlus points the links at the live /terms and /privacy', async () => {
  const els = {};
  const el = (id) => (els[id] ||= { id, href: '#', hidden: false, textContent: '', style: {} });
  const start = SCRIPT.indexOf("const site = document.getElementById('plus-site-link');");
  const end = SCRIPT.indexOf("const privacyLink = document.getElementById('plus-privacy-link');", start);
  assert.ok(start > 0 && end > start, 'the link setup moved; re-anchor this test');
  const tail = SCRIPT.indexOf('\n', SCRIPT.indexOf("privacyLink.href", end));
  vm.runInNewContext("const KOSMOS_SITE = 'https://installkosmos.com';\n" + SCRIPT.slice(start, tail), { document: { getElementById: el } });
  assert.equal(els['plus-terms-link'].href, 'https://installkosmos.com/terms');
  assert.equal(els['plus-privacy-link'].href, 'https://installkosmos.com/privacy');
  assert.ok(SCRIPT.includes("const KOSMOS_SITE = 'https://installkosmos.com';"), 'KOSMOS_SITE changed; the terms live on installkosmos.com');
});
