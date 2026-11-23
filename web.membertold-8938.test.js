'use strict';

/**
 * kosmos#8938: a company member's own Kosmos says it is the company's. This lifts the page's real functions and runs
 * them against a small fake page (no board):
 * - acctPolicyNoteText says which AI providers a company's or family's policy allows, in the server's menu words;
 * - plusOrgSees shows the what-your-company-sees line only when asked, and its words name no content as sent;
 * - workOrgShow / workOrgPaint name the company on the setup welcome and in the You menu, a company only.
 */

const fs = require('node:fs');
const nodePath = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const page = require('./test-support/page');

const HTML = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
const SCRIPT = page.scriptOf(HTML);

const noteText = new Function(page.lift(SCRIPT, 'acctPolicyNoteText') + '\nreturn acctPolicyNoteText;')();

test('the lifted pieces exist (a rename here would make every assertion vacuous)', () => {
  assert.match(SCRIPT, /acctPolicyNote\(\);\s+\/\/ kosmos#8938/, 'openAcctAdd calls acctPolicyNote');
  assert.match(HTML, /<p class="rm-small" id="acct-add-in">[^\n]*<\/p>\n\s+<!-- kosmos#8938[^\n]*-->\n\s+<p class="rm-small" id="acct-policy-note" hidden><\/p>/, 'the note sits under the intro');
});

test('a company list is said in the menu words the server sends', () => {
  const org = { name: 'Testville', kind: 'company' };
  assert.equal(noteText({ enrolled: true, org, allowedProviderNames: ['Anthropic Claude', 'OpenAI'] }),
    'Your company allows only Anthropic Claude and OpenAI for new agents in this Kosmos.');
  assert.equal(noteText({ enrolled: true, org, allowedProviderNames: ['Anthropic Claude'] }),
    'Your company allows only Anthropic Claude for new agents in this Kosmos.');
  assert.equal(noteText({ enrolled: true, org, allowedProviderNames: ['Anthropic Claude', 'OpenAI', 'Google Gemini (Google subscription)'] }),
    'Your company allows only Anthropic Claude, OpenAI and Google Gemini (Google subscription) for new agents in this Kosmos.');
  assert.equal(noteText({ enrolled: true, org, allowedProviderNames: [] }), 'Your company allows no AI provider for new agents in this Kosmos.');
});

test('an answer meant for an earlier open of the dialog is dropped; one for this open is shown', async () => {
  const el = { hidden: false, textContent: 'old' };
  let release;
  const fetch = () => new Promise((r) => { release = () => r({ json: async () => ({ enrolled: true, org: { name: 'T', kind: 'company' }, allowedProviderNames: ['OpenAI'] }) }); });
  const mk = new Function('document', 'fetch', 'let ACCT_ADD_VISIT = 1;\n' + page.lift(SCRIPT, 'acctPolicyNoteText') + '\n' + page.lift(SCRIPT, 'acctPolicyNote') + '\nreturn { acctPolicyNote, bump: () => { ACCT_ADD_VISIT += 1; } };');
  const api = mk({ getElementById: (id) => (id === 'acct-policy-note' ? el : null) }, fetch);
  const late = api.acctPolicyNote();
  assert.equal(el.hidden, true, 'hidden while the read is out');
  assert.equal(el.textContent, '');
  api.bump();   // the dialog was closed (or reopened) before the answer came
  release(); await late;
  assert.equal(el.hidden, true, 'a late answer is dropped');
  assert.equal(el.textContent, '');
  const now = api.acctPolicyNote();   // CONTROL: the same answer for the current open is shown
  release(); await now;
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, 'Your company allows only OpenAI for new agents in this Kosmos.');
});

test('an answer that lands on the success view stays hidden (CONTROL: the form view shows it)', async () => {
  for (const [success, shown] of [[{ hidden: false }, false], [{ hidden: true }, true]]) {
    const el = { hidden: true, textContent: '' };
    const fetch = async () => ({ json: async () => ({ enrolled: true, org: { name: 'T', kind: 'company' }, allowedProviderNames: ['OpenAI'] }) });
    const mk = new Function('document', 'fetch', 'let ACCT_ADD_VISIT = 1;\n' + page.lift(SCRIPT, 'acctPolicyNoteText') + '\n' + page.lift(SCRIPT, 'acctPolicyNote') + '\nreturn acctPolicyNote;');
    await mk({ getElementById: (id) => (id === 'acct-policy-note' ? el : id === 'acct-success' ? success : null) }, fetch)();
    assert.equal(el.hidden, !shown, 'success panel hidden=' + success.hidden);
  }
});

test('a family is told about its family, never its company', () => {
  assert.match(noteText({ enrolled: true, org: { name: 'The Smiths', kind: 'family' }, allowedProviderNames: ['OpenAI'] }), /^Your family allows only OpenAI /);
});

test('no list, not enrolled, no org or a malformed answer says nothing (CONTROL above says it)', () => {
  const org = { name: 'Testville', kind: 'company' };
  for (const j of [null, {}, { enrolled: true, org }, { enrolled: false, org, allowedProviderNames: ['OpenAI'] }, { enrolled: true, org: null, allowedProviderNames: ['OpenAI'] }, { enrolled: true, org, allowedProviderNames: 'OpenAI' }]) {
    assert.equal(noteText(j), '', JSON.stringify(j));
  }
});

test('what your company sees is the company\u2019s own accepted words: its report lines, then its never lines', () => {
  const text = new Function(page.lift(SCRIPT, 'plusOrgSeesText') + '\nreturn plusOrgSeesText;')();
  assert.equal(text({ reports: ['agent names, the AI provider and model each uses', ' project names '], never: ['keys and passwords'] }),
    'Your company\u2019s words for this computer. Reported: agent names, the AI provider and model each uses; project names. Never sent: keys and passwords.');
  assert.equal(text({ reports: ['agent names'], never: [] }), 'Your company\u2019s words for this computer. Reported: agent names.', 'no never lines: no "Never sent"');
  assert.equal(text({ reports: ['agent names'], backsUp: ['agent folders and their files'], never: ['keys and passwords'] }),
    'Your company\u2019s words for this computer. Reported: agent names. May back up: agent folders and their files. Never sent: keys and passwords.');
  for (const w of [null, undefined, {}, { reports: [] }, { reports: ['', '  '] }, { reports: 'agent names' }]) assert.equal(text(w), '', JSON.stringify(w));
});

test('plusOrgSees shows the words when handed a state, and hides when handed none', () => {
  const el = { hidden: true, textContent: '' };
  const document = { getElementById: (id) => (id === 'plus-org-sees' ? el : null) };
  const sees = new Function('document', page.lift(SCRIPT, 'plusOrgSeesText') + '\n' + page.lift(SCRIPT, 'plusOrgSees') + '\nreturn plusOrgSees;')(document);
  sees({ reportWords: { reports: ['agent names'], never: ['keys and passwords'] } });
  assert.equal(el.hidden, false);
  assert.equal(el.textContent, 'Your company\u2019s words for this computer. Reported: agent names. Never sent: keys and passwords.');
  sees(null);
  assert.equal(el.hidden, true);
  assert.equal(el.textContent, '');
});

test('the line is in the joined view, right under the company sentence', () => {
  assert.match(HTML, /<p class="fhint" id="plus-org-say" tabindex="-1"><\/p>\n\s+<!-- kosmos#8938[^\n]*-->\n\s+<p class="fhint" id="plus-org-sees" hidden><\/p>/);
  assert.match(SCRIPT, /plusOrgSees\(here && st\.org && st\.org\.kind !== 'family' && st\.reporting === true \? st : null\);/);
});

test('/api/org sends allowedProviderNames to the screen only, only while a list is in force, by a pure read', () => {
  const server = fs.readFileSync(nodePath.join(__dirname, 'server.js'), 'utf8');
  const start = server.indexOf("if (pathname === '/api/org' && (req.method === 'GET' || req.method === 'HEAD')) {");
  assert.ok(start > 0, 'the /api/org handler');
  const end = server.indexOf('\n    return;\n  }', server.indexOf('sendJson(res, 200, { enrolled: here, reporting:', start));
  const h = server.slice(start, end);
  const gate = h.indexOf('if (!isViaScreen(req, {})) {');
  const agentAnswer = h.slice(gate, h.indexOf('return;', gate));
  assert.ok(gate > 0, 'the screen gate');
  assert.doesNotMatch(agentAnswer, /allowedProviderNames/, 'an agent caller never gets the list');
  assert.ok(h.indexOf('let allowedProviderNames = null;') > gate, 'the list is read after the screen gate');
  assert.match(h, /\.\.\.\(allowedProviderNames \? \{ allowedProviderNames \} : \{\}\)/, 'sent only when there is a list');
  assert.match(h, /const pol = here \? op\.current\(\) : null;/, 'read only while enrolled, and by current(), which applies nothing');
  assert.match(h, /\.map\(op\.providerName\)/, 'in the menus\u2019 words, the same ones a refusal uses');
  assert.match(h, /allowedProviderNames = names && !names\.includes\(op\.providerName\(''\)\) \? \[\.\.\.new Set\(names\)\] : null;/, 'a list holding an id with no menu name is not sent at all');
  assert.doesNotMatch(agentAnswer, /reportWords/, 'an agent caller never gets the words');
  assert.match(h, /\.\.\.\(here && accepted && accepted\.reports\.length \? \{ reportWords: \{ reports: accepted\.reports, backsUp: accepted\.backsUp, never: oe\.acceptedNever\(\) \} \} : \{\}\)/, 'the accepted words, only while there are some');
});

test('the names come from orgpolicy.providerName, which tells the two Gemini rows apart', () => {
  const op = require('./engine/orgpolicy');
  assert.equal(op.providerName('anthropic'), 'Anthropic Claude');
  assert.equal(op.providerName('google'), 'Google Gemini (API key)');
  assert.equal(op.providerName('antigravity'), 'Google Gemini (Google subscription)');
  assert.equal(op.providerName('deepseek'), 'DeepSeek');
});

function workOrg(answer, member = true) {
  const els = { 'fr-work-org': { hidden: true, textContent: '' }, 'userpop-org': { hidden: true, textContent: '' } };
  const document = { getElementById: (id) => els[id] || null, documentElement: { hasAttribute: (a) => a === 'data-fed-member' && member } };
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

test('not a Kosmos+ member: the welcome still names the company, the You menu line does not (it sits under the member line)', async () => {
  const { els, api } = workOrg({ enrolled: true, org: { name: 'Testville Municipal', kind: 'company' } }, false);
  api.workOrgPaint();
  await settle(); await settle();
  assert.equal(els['fr-work-org'].textContent, 'This is your work Kosmos for Testville Municipal.');
  assert.equal(els['userpop-org'].hidden, true);
  assert.equal(els['userpop-org'].textContent, '');
});

test('a failed read is tried again on the next paint, not held for a minute', async () => {
  const { asked, api } = workOrg(new Error('offline'));
  api.workOrgPaint(); await settle(); await settle();
  api.workOrgPaint(); await settle(); await settle();
  assert.deepEqual(asked, ['/api/org', '/api/org']);
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
  assert.match(SCRIPT, /function plusOrgPaint\(\) \{\n  const st = PLUS_ORG\.state \|\| \{\};\n  const here = st\.enrolled === true && st\.org;\n  if \(PLUS_ORG\.state\) workOrgFrom\(st\);/, 'a fresh company read updates the welcome and the You menu at once');
  assert.match(HTML, /aria-describedby="acct-add-in acct-policy-note"/, 'a screen reader hears the provider line with the intro');
});

test('orgenroll.acceptedNever gives [] with no enrollment (the read-back is engine/orgrollup-5532.test.js)', () => {
  const fs2 = require('node:fs');
  const os = require('node:os');
  const root = fs2.mkdtempSync(nodePath.join(os.tmpdir(), 'membertold-8938-'));
  try {
    const oe = require('./engine/orgenroll');
    assert.deepEqual(oe.acceptedNever({ root }), [], 'no enrollment: none');
  } finally { fs2.rmSync(root, { recursive: true, force: true }); }
});
