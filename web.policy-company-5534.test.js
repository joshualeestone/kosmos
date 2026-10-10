'use strict';

/**
 * #5534 slice 4: the Settings AI policies screen shows the company's AI policy (from its applied Kosmos policy) first,
 * read-only, so the screen says what every agent is handed. Runs the shipped paintPolicy and polCompanyCard against a
 * small DOM and fetch stub (the repo has no jsdom; the same pattern as web.add-project.test.js).
 *
 *   node --test web.policy-company-5534.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = PAGE.slice(PAGE.lastIndexOf('<script>'));
const REGION = SCRIPT.slice(SCRIPT.indexOf('async function paintPolicy'), SCRIPT.indexOf('function polCard(p)'));

function el(tag) {
  return {
    tag, className: '', textContent: '', hidden: false, children: [], attrs: {},
    append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; },
    get text() { return [this.textContent, ...this.children.map((c) => c.text)].join(' '); },
    all() { return [this, ...this.children.flatMap((c) => c.all())]; },
  };
}
async function paint(answer) {
  const box = el('div');
  const document = { createElement: el, getElementById: (id) => (id === 'pol-state' ? box : el('p')) };
  const fetch = async () => ({ json: async () => answer });
  const polCard = (p) => { const c = el('div'); c.className = 'polcard'; c.textContent = 'MINE ' + p.name; return c; };
  const pjSentence = (s) => s;
  const run = new Function('document', 'fetch', 'polCard', 'pjSentence', REGION + '\nreturn paintPolicy();');
  await run(document, fetch, polCard, pjSentence);
  return box;
}
const COMPANY = { name: 'Acme legal', chars: 40, opening: 'Never paste client names into a prompt.' };

test('#5534 slice 4: the company entry is shown first, read-only, with its own line', async () => {
  assert.ok(REGION.includes('function polCompanyCard'), 'premise: the region holds the company card');
  const box = await paint({ state: 'saved', policies: [{ id: 'a', name: 'Branding' }], because: null, company: COMPANY });
  const cards = box.children.filter((c) => /polcard/.test(c.className));
  assert.deepEqual(cards.map((c) => /polcompany/.test(c.className)), [true, false], 'the company card is not first');
  assert.match(cards[0].text, /Acme legal/);
  assert.match(cards[0].text, /Set by your company in its Kosmos policy\. Only your company can change or remove it\./);
  assert.equal(cards[0].all().some((n) => n.tag === 'button'), false, 'the company card offers a button');
  assert.match(box.children[0].textContent, /all of these/, 'two policies counted as one');
});

test('#5534 slice 4: with only the company\'s policy the screen does not say there are none', async () => {
  const box = await paint({ state: 'absent', policies: [], because: null, company: COMPANY });
  assert.doesNotMatch(box.text, /No policies here yet/, 'said none while every agent carries the company policy');
  assert.ok(box.children.some((c) => /polcompany/.test(c.className)), 'the company card is missing');
  // CONTROL: no company, no policy: the old sentence.
  const none = await paint({ state: 'absent', policies: [], because: null, company: null });
  assert.match(none.text, /No policies here yet/);
  assert.equal(none.children.some((c) => /polcompany/.test(c.className)), false);
  // CONTROL: the person's own alone keep the one-policy sentence.
  const one = await paint({ state: 'saved', policies: [{ id: 'a', name: 'Branding' }], because: null, company: null });
  assert.match(one.children[0].textContent, /Every agent gets it;/);
});
