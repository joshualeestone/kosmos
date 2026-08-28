'use strict';

/**
 * Accounts grouped by provider (#1393).
 *
 * 🔑 Josh, twice on 2026-08-28: the Claude Max 20x row "is still not in that
 * bounding box that it's supposed to be in, that goes underneath Claude". The
 * section heading already promised the shape, "Your AI models, by provider"; the
 * list was flat with the provider repeated on every row.
 *
 * 🛑 THE FUNCTION IS EXTRACTED AND RUN. A regex over the page cannot tell you how
 * a list of three accounts partitions, and the partition is the whole subject.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, 'web', 'index.html'), 'utf8');

function loadGroups() {
  const at = PAGE.indexOf('function accountGroupsHtml(');
  assert.notEqual(at, -1, 'accountGroupsHtml is gone from the page');
  const src = PAGE.slice(at, PAGE.indexOf('\n}', at) + 2);
  return new Function('esc', src + '; return accountGroupsHtml;')((s) => String(s));
}
const groups = loadGroups();
/* A row builder that names its account, so a test can see WHICH rows landed in
   WHICH box rather than only how many did. */
const row = (a) => '<div class="acct-box" data-who="' + (a.email || a.keyTail) + '"></div>';

const CLAUDE_A = { email: 'you@yourcompany.com', providerName: 'Anthropic / Claude' };
const CLAUDE_B = { email: 'josh@stonesyndicate.com', providerName: 'Anthropic / Claude' };
const OPENAI = { keyTail: '9f2a', provider: 'openai', providerName: 'OpenAI' };

test('#1393: two providers make two boxes, each holding its own accounts', () => {
  const html = groups([CLAUDE_A, CLAUDE_B, OPENAI], row);
  const boxes = html.match(/<section class="acct-prov">/g) || [];
  assert.equal(boxes.length, 2, 'expected one box per provider, got ' + boxes.length);
  /* The Max-20x case as Josh described it: the Claude accounts are INSIDE the
     Anthropic box, not beside it. */
  const anthropic = html.slice(html.indexOf('Anthropic / Claude'), html.indexOf('OpenAI'));
  assert.match(anthropic, /you@yourcompany\.com/, 'a Claude account left its own box');
  assert.match(anthropic, /josh@stonesyndicate\.com/, 'the second Claude account left its box');
  assert.doesNotMatch(anthropic, /9f2a/, 'the OpenAI account landed in the Anthropic box');
});

test('#1393: one account still gets a box, so the shape does not change as accounts arrive', () => {
  const html = groups([CLAUDE_A], row);
  assert.equal((html.match(/<section class="acct-prov">/g) || []).length, 1);
  assert.match(html, /1 account</, 'a single account did not read as "1 account"');
  assert.doesNotMatch(html, /1 accounts/, 'the singular is assembled, not written out');
});

test('#1393: a provider with no accounts gets NO box', () => {
  /* An empty group is a promise of something that is not there. This falls out of
     grouping the LIST rather than iterating a fixed roster of providers, which is
     why the assertion is about OpenAI being absent entirely. */
  const html = groups([CLAUDE_A, CLAUDE_B], row);
  assert.equal((html.match(/<section class="acct-prov">/g) || []).length, 1);
  assert.doesNotMatch(html, /OpenAI/, 'a provider with no accounts still drew a box');
});

test('#1393: no accounts at all draws nothing', () => {
  assert.equal(groups([], row), '');
  assert.equal(groups(null, row), '');
});

test('#1393: each head COUNTS ITS OWN ROWS, so the number cannot disagree with the box', () => {
  /* 🛑 THIS IS kosmos#1346 RESTATED. That screen said "3 agents" over three rows
     and "6 agents" underneath, because one number came from the data and the other
     from a document-wide DOM query. Here both come from the same array. */
  const html = groups([CLAUDE_A, CLAUDE_B, OPENAI], row);
  for (const [name, want] of [['Anthropic / Claude', 2], ['OpenAI', 1]]) {
    const at = html.indexOf(name);
    const seg = html.slice(at, html.indexOf('</section>', at));
    const stated = Number((seg.match(/>(\d+) accounts?</) || [])[1]);
    const actual = (seg.match(/class="acct-box"/g) || []).length;
    assert.equal(stated, want, name + ' head says ' + stated);
    assert.equal(stated, actual,
      name + ' head says ' + stated + ' but the box holds ' + actual);
  }
});

test('#1393: the per-row provider label is gone, and the ORG line is not', () => {
  /* They are different facts: the provider is now the box's, the organisation is
     still the account's. Removing both would have been the easy over-correction. */
  /* 🛑 COUNTED INSIDE THE ROW BUILDER, NOT GREPPED FOR THE DECLARATION. My first
     version asserted the `const provider = ...` line was gone, and perturbation
     showed that re-adding the label INLINE walked straight past it: an assertion
     about how a thing is DECLARED cannot see it being rendered another way.
     The row builder must mention `acct-org` exactly ONCE, and that once is the
     organisation line. */
  const at = PAGE.indexOf('const acctRowHtml = (a) => {');
  assert.notEqual(at, -1, 'the row builder is gone');
  const rowSrc = PAGE.slice(at, PAGE.indexOf('box.innerHTML = accountGroupsHtml', at));
  const hits = (rowSrc.match(/acct-org/g) || []).length;
  assert.equal(hits, 1,
    'the row builder mentions acct-org ' + hits + ' times; exactly one (the organisation) is expected');
  assert.match(rowSrc, /a\.organization[\s\S]{0,160}acct-org/,
    'the organisation line was removed along with the provider label');
});

test('#1393 COMPATIBILITY: rows stay DESCENDANTS of #set-accounts', () => {
  /* 🔑 THE REASON A WRAPPER IS SAFE AND A RESTRUCTURE WOULD NOT BE.
     docs/browser-checks/render-accounts-openai.js reads
     `#set-accounts .acct-box`, a descendant selector, and it is in the release
     gate. A group box between them keeps that true; moving rows out of
     #set-accounts would not. */
  const check = fs.readFileSync(
    path.join(__dirname, 'docs', 'browser-checks', 'render-accounts-openai.js'), 'utf8');
  assert.match(check, /#set-accounts \.acct-box/,
    'the gated check no longer uses the descendant selector this change relies on');
  const html = groups([CLAUDE_A, OPENAI], row);
  assert.match(html, /<section class="acct-prov">[\s\S]*class="acct-box"/,
    'rows are no longer inside the group box');
});
