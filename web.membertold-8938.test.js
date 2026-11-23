'use strict';

/**
 * kosmos#8938: a company member's own Kosmos says it is the company's. This lifts the page's real functions and runs
 * them against a small fake page (no board):
 * - acctPolicyApply marks the providers the company's policy does not allow in Add a provider, restores exactly what
 *   it marked when the list changes, and never touches an option it did not mark (the Windows Qwen line, coming soon);
 * - plusOrgSees shows the what-your-company-sees line only when asked, and its words name no content.
 */

const fs = require('node:fs');
const nodePath = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);
const MAP = SCRIPT.match(/const ACCT_POLICY_ID = \{[^}]*\};/);
const SEES = SCRIPT.match(/const PLUS_ORG_SEES = '[^\n]*';/);

function optionsFrom(rows) {
  return rows.map(([value, text, disabled, off]) => ({ value, textContent: text, disabled: !!disabled, selected: false, dataset: off === undefined ? {} : { off } }));
}
function picker(rows) {
  const opts = optionsFrom(rows);
  const sel = {
    value: '',
    querySelectorAll: () => opts,
  };
  Object.defineProperty(sel, 'value', { get() { const o = opts.find((x) => x.selected); return o ? o.value : ''; }, set(v) { for (const o of opts) o.selected = o.value === v; } });
  const document = { getElementById: (id) => (id === 'acct-provider-pick' ? sel : null) };
  const apply = new Function('document', MAP[0] + '\n' + page.lift(SCRIPT, 'acctPolicyApply') + '\nreturn acctPolicyApply;')(document);
  return { opts, sel, apply };
}
const ROWS = [
  ['', 'Choose a provider…'],
  ['claude', 'Anthropic Claude'],
  ['openai', 'OpenAI'],
  ['google', 'Google Gemini'],
  ['xai', 'xAI Grok'],
  ['meta', 'Meta Muse · coming soon', true],
  ['alibaba', 'Alibaba Qwen · coming to Windows', true, 'Coming to Windows'],
  ['deepseek', 'DeepSeek · coming soon', true],
];
const byVal = (opts, v) => opts.find((o) => o.value === v);

test('the lifted pieces exist (a rename here would make every assertion vacuous)', () => {
  assert.ok(MAP, 'ACCT_POLICY_ID');
  assert.ok(SEES, 'PLUS_ORG_SEES');
  assert.match(SCRIPT, /acctPolicyMark\(\);\s+\/\/ kosmos#8938/, 'openAcctAdd calls acctPolicyMark');
});

test('a company list marks every provider it leaves out, and only those', () => {
  const { opts, apply } = picker(ROWS);
  apply(['anthropic', 'openai']);
  for (const v of ['claude', 'openai']) {
    assert.equal(byVal(opts, v).disabled, false, v + ' stays offered');
    assert.equal(byVal(opts, v).dataset.off, undefined, v);
  }
  for (const v of ['google', 'xai', 'meta', 'alibaba']) {
    assert.equal(byVal(opts, v).disabled, true, v + ' is disabled');
    assert.match(byVal(opts, v).textContent, / · not allowed by your company$/, v);
    assert.equal(byVal(opts, v).dataset.off, 'Not allowed by your company', v);
  }
  assert.equal(byVal(opts, 'google').textContent, 'Google Gemini · not allowed by your company');
  assert.equal(byVal(opts, 'alibaba').textContent, 'Alibaba Qwen · not allowed by your company', 'one reason, not two');
  assert.equal(byVal(opts, 'deepseek').textContent, 'DeepSeek · coming soon', 'a provider the policy has no id for is untouched');
});

test('no list (not a company, or not restricted) marks nothing', () => {
  for (const allowed of [null, undefined]) {
    const { opts, apply } = picker(ROWS);
    apply(allowed);
    assert.deepEqual(opts.map((o) => [o.textContent, o.disabled]), optionsFrom(ROWS).map((o) => [o.textContent, o.disabled]));
  }
});

test('a wider list later restores exactly what was marked, words and disabled state included', () => {
  const { opts, apply } = picker(ROWS);
  apply(['anthropic']);
  apply(null);
  assert.deepEqual(opts.map((o) => [o.textContent, o.disabled, o.dataset.off]), optionsFrom(ROWS).map((o) => [o.textContent, o.disabled, o.dataset.off]));
  assert.ok(opts.every((o) => o.dataset.policyOff === undefined && o.dataset.policyWas === undefined));
});

test('a selected provider the company does not allow is unselected', () => {
  const { sel, apply } = picker(ROWS);
  sel.value = 'xai';
  apply(['anthropic']);
  assert.equal(sel.value, '');
});

test('marking twice does not stack the words', () => {
  const { opts, apply } = picker(ROWS);
  apply(['anthropic']);
  apply(['anthropic']);
  assert.equal(byVal(opts, 'openai').textContent, 'OpenAI · not allowed by your company');
  apply(null);
  assert.equal(byVal(opts, 'openai').textContent, 'OpenAI');
});

test('what your company sees: shown only when asked, and it names no content as sent', () => {
  const el = { hidden: true, textContent: '' };
  const document = { getElementById: (id) => (id === 'plus-org-sees' ? el : null) };
  const sees = new Function('document', SEES[0] + '\n' + page.lift(SCRIPT, 'plusOrgSees') + '\nreturn plusOrgSees;')(document);
  sees(true);
  assert.equal(el.hidden, false);
  assert.match(el.textContent, /^Once a day your company sees: /);
  assert.match(el.textContent, /Your chats, files and keys are never in it\.$/);
  sees(false);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, '');
});

test('the line is in the joined view, right under the company sentence', () => {
  assert.match(HTML, /<p class="fhint" id="plus-org-say" tabindex="-1"><\/p>\n\s+<!-- kosmos#8938[^\n]*-->\n\s+<p class="fhint" id="plus-org-sees" hidden><\/p>/);
  assert.match(SCRIPT, /plusOrgSees\(here && st\.org && st\.org\.kind !== 'family' && st\.wordsNeeded !== true\);/);
});

test('/api/org sends providersAllowed to the screen only, and only while a list is in force', () => {
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const start = server.indexOf("if (pathname === '/api/org' && (req.method === 'GET' || req.method === 'HEAD')) {");
  assert.ok(start > 0, 'the /api/org handler');
  const end = server.indexOf('\n    return;\n  }', server.indexOf('sendJson(res, 200, { enrolled: here, reporting:', start));
  const h = server.slice(start, end);
  const gate = h.indexOf('if (!isViaScreen(req, {})) {');
  const agentAnswer = h.slice(gate, h.indexOf('return;', gate));
  assert.ok(gate > 0, 'the screen gate');
  assert.doesNotMatch(agentAnswer, /providersAllowed/, 'an agent caller never gets the list');
  assert.ok(h.indexOf('let providersAllowed = null;') > gate, 'the list is read after the screen gate');
  assert.match(h, /\.\.\.\(providersAllowed \? \{ providersAllowed \} : \{\}\)/, 'sent only when there is a list');
  assert.match(h, /here \? require\('\.\/engine\/orgpolicy'\)\.inForce\(\) : null/, 'read only while this Kosmos is enrolled');
});

function workOrg(answer) {
  const els = { 'fr-work-org': { hidden: true, textContent: '' }, 'userpop-org': { hidden: true, textContent: '' } };
  const document = { getElementById: (id) => els[id] || null };
  const asked = [];
  const fetch = async (url) => { asked.push(url); if (answer instanceof Error) throw answer; return { json: async () => answer }; };
  const src = SCRIPT.match(/const WORK_ORG = \{[^\n]*\};/)[0] + '\n' + page.lift(SCRIPT, 'plusOrgIn') + '\n' + page.lift(SCRIPT, 'workOrgShow') + '\n' + page.lift(SCRIPT, 'workOrgPaint') + '\nreturn { workOrgPaint, WORK_ORG };';
  const api = new Function('document', 'fetch', src)(document, fetch);
  return { els, asked, api };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

test('a company member sees the company named on the welcome and in the You menu', async () => {
  const { els, api } = workOrg({ enrolled: true, org: { name: ' Testville Municipal ', kind: 'company' } });
  api.workOrgPaint();
  await settle(); await settle();
  assert.equal(els['fr-work-org'].hidden, false);
  assert.equal(els['fr-work-org'].textContent, 'This is your work Kosmos for Testville Municipal.');
  assert.equal(els['userpop-org'].hidden, false);
  assert.equal(els['userpop-org'].textContent, 'Work Kosmos for Testville Municipal');
});

test('a family, no company, an unenrolled record or a failed read shows nothing (CONTROL above shows it)', async () => {
  for (const answer of [
    { enrolled: true, org: { name: 'The Smiths', kind: 'family' } },
    { enrolled: false, org: null },
    { enrolled: false, org: { name: 'Old Co', kind: 'company' } },
    { enrolled: true, org: { name: '   ', kind: 'company' } },
    new Error('offline'),
  ]) {
    const { els, api } = workOrg(answer);
    api.workOrgPaint();
    await settle(); await settle();
    for (const id of ['fr-work-org', 'userpop-org']) {
      assert.equal(els[id].hidden, true, id + ' ' + JSON.stringify(answer && answer.org));
      assert.equal(els[id].textContent, '', id);
    }
  }
});

test('it reads /api/org at most once a minute', async () => {
  const { asked, api } = workOrg({ enrolled: true, org: { name: 'Testville', kind: 'company' } });
  api.workOrgPaint(); await settle(); await settle();
  api.workOrgPaint(); api.workOrgPaint();
  assert.deepEqual(asked, ['/api/org']);
});

test('the welcome keeps Josh’s words and adds the line after them; both callers are wired', () => {
  assert.match(HTML, /<h2>Welcome to Kosmos<\/h2>\n\s+<p>Create and manage a workforce of AI agents that work for you\.<\/p>\n\s+<!-- kosmos#8938[^\n]*-->\n\s+<p id="fr-work-org" hidden><\/p>/);
  assert.match(HTML, /<span class="userpop-plus-badge">Plus<\/span>\n\s+<\/button>\n\s+<p class="userpop-org" id="userpop-org" hidden><\/p>/);
  assert.match(SCRIPT, /member\.hidden = !m;\n\s+workOrgPaint\(\);/);
  assert.match(SCRIPT, /if \(step === 1\) workOrgPaint\(\);/);
});
