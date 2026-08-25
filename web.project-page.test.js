"use strict";
/**
 * #761, first items on the project page: member titles as the catalogue
 * writes them, no stale "bring it up to date" line, "Show all", and the
 * minus asks before it removes, in both views.
 *
 *   node --test web.project-page.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const PAGE = fs.readFileSync('web/index.html', 'utf8');
const SCRIPT = PAGE.match(/<script>([\s\S]*?)<\/script>/)[1];

test('a member row derives its title the way the cards do, so a catalogue role reads as the catalogue writes it', () => {
  assert.match(SCRIPT, /'<small class="pj-member-role">' \+ esc\(roleLine\(\{ role: m\.role \}, ROLE_TITLES\)\) \+ '<\/small>'/);
  const at = SCRIPT.indexOf('function roleLine('); const fn = SCRIPT.slice(at, SCRIPT.indexOf('\n}\n', at) + 3);
  // eslint-disable-next-line no-new-func
  const roleLine = new Function(fn + '\nreturn roleLine;')();
  const titles = new Map([['copywriter', 'Copywriter'], ['account manager', 'Account Manager']]);
  assert.equal(roleLine({ role: 'copywriter' }, titles), 'Copywriter');
  assert.equal(roleLine({ role: 'account manager' }, titles), 'Account Manager');
  // A role the catalogue has never seen gets only its first letter raised (the standing rule; it cannot invent capitals for words it has never seen).
  assert.equal(roleLine({ role: 'iOS engineer' }, titles), 'IOS engineer');
  assert.equal(roleLine({ role: 'copywriter' }, null), 'Copywriter', 'with no catalogue yet, the first letter still rises');
});

test('the files door says Show all, and the stale arm draws nothing', () => {
  assert.match(SCRIPT, /all\.textContent = more > 0 \? 'Show all ' \+ body\.total : 'Show all';/);
  assert.doesNotMatch(SCRIPT, /Has not picked this up yet/);
  assert.doesNotMatch(SCRIPT, /pj-notyet-go/);
});

test('the minus asks first, names the agent and the project, lands on the harmless answer, and only its Remove calls the drop; it is in both views', () => {
  const body = PAGE.replace(/<!--[\s\S]*?-->/g, '');
  assert.match(body, /<div class="rm-back" id="mem-modal" hidden>\s*<div class="rm-box" role="alertdialog" aria-modal="true" aria-labelledby="mem-title" aria-describedby="mem-small">/);
  // #762 factored the modal setup into openMemModal, shared by the tab
  // view's minus AND the settings rows' -- the listener itself is now a
  // one-line call, so the pins on "asks before it acts" moved onto the
  // shared function.
  const at = SCRIPT.indexOf("getElementById('pj-one-agents').addEventListener('click'"); const handler = SCRIPT.slice(at, SCRIPT.indexOf('\n});\n', at) + 5);
  assert.match(handler, /openMemModal\(btn, document\.getElementById\('pj-one-msg'\)\)/);
  assert.doesNotMatch(handler, /dropMember\(/, 'the minus removes without asking');
  const openAt = SCRIPT.indexOf('function openMemModal(btn, msg)'); const openFn = SCRIPT.slice(openAt, SCRIPT.indexOf('\n}\n', openAt) + 3);
  assert.match(openFn, /'Remove ' \+ who \+ ' from ' \+ pjName \+ '\?'/);
  assert.match(openFn, /getElementById\('mem-keep'\)\.focus\(\);/, 'Enter on the fresh dialog does not land on the harmless answer');
  assert.doesNotMatch(openFn, /dropMember\(/, 'the minus removes without asking');
  assert.match(SCRIPT, /getElementById\('mem-go'\)\.addEventListener\('click', \(\) => \{[\s\S]{0,300}dropMember\(p\.btn, p\.msg \|\| document\.getElementById\('pj-one-msg'\)\)/);
  assert.match(SCRIPT, /getElementById\('mem-keep'\)\.addEventListener\('click', memConfirmClose\);/);
  assert.match(PAGE, /\n\.pj-minus \{ display: grid;[^}]*opacity: 0; \}\n\.pj-member:hover \.pj-minus, \.pj-minus:focus-visible \{ opacity: 1; \}/);
  assert.match(PAGE, /\n#pj-remove-member \{ display: none; \}/);
});
