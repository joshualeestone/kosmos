'use strict';
/**
 * kosmos#6178: Settings > AI Models shows the accounts on the person's OTHER computers, read by this browser from each
 * one (the #4812 sibling read). These run the SHIPPED ao* functions from web/index.html (lifted, as
 * web.allagents-4812.test.js does) against a fake document.
 *
 *   node --test web.otheraccounts-6178.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const nodePath = require('node:path');
const { makeDom } = require('./test-support/fake-dom');

const PAGE = fs.readFileSync(nodePath.join(__dirname, 'web', 'index.html'), 'utf8');
function slice(name) {
  let at = PAGE.indexOf('async function ' + name + '(');
  if (at < 0) at = PAGE.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name + ' moved or renamed; re-anchor this test');
  return PAGE.slice(at, PAGE.indexOf('\n}\n', at) + 2);
}
function constLine(name) {
  const at = PAGE.indexOf('const ' + name + ' = ');
  assert.ok(at >= 0, name + ' moved or renamed');
  return PAGE.slice(at, PAGE.indexOf('\n', at) + 1);
}
const SRC = [
  constLine('OA_STALE_MS'), constLine('OA_READ_LIMIT_MS'), constLine('OA_MAX_AGENTS'), constLine('ACCT_WARN_PCT'), constLine('AO_SEEN'), constLine('AO_MAX_ACCOUNTS'), constLine('AO_MAX_AGENTS'),
  'const OA_SEEN = new Map();\n',
  ...['computerAddressOk', 'agoWords', 'oaEligible', 'oaOthers', 'oaStale', 'oaClassify', 'oaRemember', 'oaAgentsOf', 'oaReadOne', 'aoStr', 'aoAccountsOf', 'aoAgentsOf', 'aoKeep',
    'aoShown', 'aoUsageWords', 'aoEl', 'aoGroup', 'aoPaint'].map(slice),
].join('\n');

const LIST = {
  ok: true,
  domain: 'kosmosplus.com',
  computers: [
    { name: 'laptop', address: 'laptop.kosmosplus.com', this: true, online: true },
    { name: 'studio', address: 'studio.kosmosplus.com', this: false, online: true },
    { name: 'evil', address: 'evil.example', this: false, online: true },
  ],
};
const FUTURE = Date.now() + 3 * 864e5;

function load({ protocol = 'https:', hostname = 'laptop.kosmosplus.com', list = LIST, openable = false, fetchImpl } = {}) {
  const t = makeDom();
  t.add('s-sec-accounts');
  t.add('set-other-wrap');
  t.add('set-other-note', 'p');
  t.add('set-other');
  const api = new Function('document', 'location', 'OA_LISTED', 'COMPUTERS_OPENABLE', 'fetch', `
    let OA_COMPUTERS = OA_LISTED;
    ${SRC}
    return { aoAccountsOf, aoAgentsOf, aoKeep, aoShown, aoUsageWords, aoGroup, aoPaint, oaReadOne, AO_SEEN, OA_SEEN };
  `)(t.document, { protocol, hostname }, list, openable, fetchImpl || (async () => { throw new Error('no fetch in this test'); }));
  return { api, d: t.document };
}
const STATUS = {
  agents: [
    { sessionName: 'ann', name: 'Ann', account: { dir: '/Users/p/.claude', email: 'p@example.com' } },
    { sessionName: 'bo', name: 'Bo', account: { dir: '/Users/p/.claude-work', email: 'w@example.com' } },
    { sessionName: 'guide', name: 'Guide', isGuide: true, account: { dir: '/Users/p/.claude' } },
    { sessionName: 'nobody', name: 'Nobody', account: null },
  ],
  accountsWeekly: [
    { dir: '/Users/p/.claude', email: 'p@example.com', isDefault: true, weekly: { usedPct: 82, resetsAt: FUTURE, at: Date.now() - 3600e3 }, blocked: null },
    { dir: '/Users/p/.claude-work', email: 'w@example.com', weekly: null, blocked: 'not-wired' },
  ],
};
const text = (n) => n.textContent;

test('#6178 the other computer\'s accounts are kept checked: bad entries dropped, unknown reasons not repeated', () => {
  const { api } = load();
  const got = api.aoAccountsOf({ accountsWeekly: [
    ...STATUS.accountsWeekly,
    { email: 'no-dir@example.com' },
    { dir: '/x', weekly: { usedPct: 'lots', resetsAt: 1, at: 1 }, blocked: '<script>' },
    null,
  ] });
  assert.equal(got.length, 3, 'an entry with no folder was kept: ' + JSON.stringify(got));
  assert.equal(got[0].weekly.usedPct, 82);
  assert.equal(got[2].weekly, null, 'a non-number reading was kept');
  assert.equal(got[2].blocked, null, 'a reason this page does not know was kept');
  assert.equal(api.aoAccountsOf({ agents: [] }), null, 'an older Kosmos (no accountsWeekly) must read as unknown, not as no accounts');
  assert.deepEqual(api.aoAgentsOf(STATUS).map((a) => [a.name, a.dir]), [['Ann', '/Users/p/.claude'], ['Bo', '/Users/p/.claude-work']],
    'the guide or an agent with no account was listed');
});

test('#6178 aoKeep: a fresh answer replaces, not-let-in forgets, no answer keeps the last', () => {
  const { api } = load();
  api.aoKeep('studio.kosmosplus.com', 'ok', STATUS, 5);
  assert.equal(api.AO_SEEN.get('studio.kosmosplus.com').at, 5);
  api.aoKeep('studio.kosmosplus.com', 'out', null, 9);
  assert.equal(api.AO_SEEN.get('studio.kosmosplus.com').at, 5, 'an unreachable computer lost what this page last read');
  api.aoKeep('studio.kosmosplus.com', 'notin', null, 10);
  assert.equal(api.AO_SEEN.has('studio.kosmosplus.com'), false, 'a browser no longer let in kept showing the accounts');
});

test('#6178 the section lists each account with its usage and its agents there, in the row\'s own words', () => {
  const { api, d } = load();
  api.OA_SEEN.set('studio.kosmosplus.com', { state: 'ok', agents: [], at: Date.now() });
  api.aoKeep('studio.kosmosplus.com', 'ok', STATUS, Date.now());
  api.aoPaint();
  assert.equal(d.getElementById('set-other-wrap').hidden, false);
  const list = d.getElementById('set-other');
  assert.equal(list.children.length, 1, 'only the one valid other computer: this one and a bad address are left out');
  const s = text(list);
  assert.match(s, /studio/);
  assert.match(s, /p@example\.com/);
  assert.match(s, /82% of its weekly limit used · resets /);
  assert.match(s, /Kosmos last saw it change /);
  assert.match(s, /Its agents on studio: Ann/);
  assert.match(s, /Kosmos is not set up to read usage for this account\./, 'the reason for no reading is the row\'s own sentence');
  assert.match(s, /Its agents on studio: Bo/);
  assert.doesNotMatch(s, /Guide/, 'the setup guide was listed');
  assert.doesNotMatch(s, /Move/, 'a move was offered for an account on another computer');
});

test('#6178 the usage words are the ones the row on that computer uses (acctUsageHtml)', () => {
  /* Read from the row's own source, not restated: if #6108's row changes a sentence, this goes red until the other
     computers' section says the same. (Lifting acctUsageHtml to run it needs most of the Settings page.) */
  const row = slice('acctUsageHtml');
  const mine = slice('aoUsageWords');
  for (const piece of ["'% of its weekly limit used · resets '", "' · Kosmos last saw it change '",
    "'No usage reading for this account yet. Kosmos reads it while an agent on it is working.'"]) {
    assert.ok(row.includes(piece), 'CONTROL: the row no longer says ' + piece + '; re-anchor');
    assert.ok(mine.includes(piece), 'the other computers\' section words this differently: ' + piece);
  }
  const sayOf = (src, name) => {
    const at = src.indexOf('const ' + name + ' = {');
    assert.ok(at >= 0, 'no ' + name + ' map');
    return src.slice(at, src.indexOf('}[', at));
  };
  assert.equal(sayOf(mine, 'blockedSay'), sayOf(row, 'blockedSay'), 'the reasons for no reading are worded differently from the row\'s');
  assert.equal(sayOf(mine, 'frozenSay'), sayOf(row, 'frozenSay'), 'the line under a reading that will not update is worded differently from the row\'s');
  const { api } = load();
  const now = Date.now();
  assert.equal(api.aoUsageWords({ weekly: { usedPct: 82.4, resetsAt: FUTURE, at: now }, blocked: null }, now).pct, 82, 'CONTROL: the percent is rounded as the row does');
});

test('#6178 each state says one line: not let in, unreachable, an older Kosmos, reading', () => {
  const { api } = load();
  const c = { name: 'studio', address: 'studio.kosmosplus.com' };
  const now = Date.now();
  assert.match(text(api.aoGroup(c, { state: 'notin' }, null, now)), /not let in on studio yet/);
  assert.match(text(api.aoGroup(c, { state: 'out' }, null, now)), /Not connected\./);
  assert.match(text(api.aoGroup(c, null, null, now)), /Reading its accounts/);
  assert.match(text(api.aoGroup(c, { state: 'ok', at: now }, { accounts: null, agents: [], at: now }, now)), /older Kosmos/);
  const kept = text(api.aoGroup(c, { state: 'out', at: now - 600e3 }, { accounts: [STATUS.accountsWeekly[0]], agents: [], at: now - 600e3 }, now));
  assert.match(kept, /Not connected\. Showing what this page last read/, 'a kept list was not said to be old');
  assert.match(kept, /82%/, 'CONTROL: the kept list is still shown');
});

test('#6178 the app\'s own board cannot read them: a line saying where they can be seen, only when there are others', () => {
  const local = load({ protocol: 'http:', hostname: '127.0.0.1', openable: true });
  local.api.aoPaint();
  assert.equal(local.d.getElementById('set-other-wrap').hidden, false);
  assert.match(text(local.d.getElementById('set-other-note')), /open Kosmos from this computer's Kosmos\+ address/);
  assert.equal(local.d.getElementById('set-other').children.length, 0, 'the local board listed computers it cannot read');
  const alone = load({ protocol: 'http:', hostname: '127.0.0.1', openable: false });
  alone.api.aoPaint();
  assert.equal(alone.d.getElementById('set-other-wrap').hidden, true, 'a person with one computer was told about other computers');
});

test('#6178 the reads run while AI Models is on screen, and not otherwise', () => {
  const { api, d } = load();
  assert.equal(api.aoShown(), true, 'CONTROL: the section is shown');
  d.getElementById('s-sec-accounts').hidden = true;
  assert.equal(api.aoShown(), false, 'a hidden AI Models section still asked for reads');
});

/* The page's own read with aoKeep DEFINED, as on the real page. A lifted oaReadOne without aoKeep skips the call, so
   this is the only test that runs it: the first build referenced a variable scoped to the read's try block, which
   threw on every answer and took #4812's Agents view down with it (caught by the browser check, 2026-10-14). */
test('#6178 the real read keeps the accounts AND still keeps the agents (#4812 unharmed)', async () => {
  const { api } = load({ fetchImpl: async () => ({ status: 200, json: async () => STATUS }) });
  const r = await api.oaReadOne({ name: 'studio', address: 'studio.kosmosplus.com', online: true });
  assert.ok(r && r.state === 'ok', 'the read did not come back ok: ' + JSON.stringify(r));
  assert.deepEqual(r.agents.map((a) => a.sessionName), ['ann', 'bo', 'nobody'], 'the Agents view lost its agents');
  const kept = api.AO_SEEN.get('studio.kosmosplus.com');
  assert.ok(kept && Array.isArray(kept.accounts) && kept.accounts.length === 2, 'the accounts were not kept: ' + JSON.stringify(kept));
  const gate = load({ fetchImpl: async () => ({ status: 401, json: async () => ({}) }) });
  gate.api.AO_SEEN.set('studio.kosmosplus.com', kept);
  await gate.api.oaReadOne({ name: 'studio', address: 'studio.kosmosplus.com', online: true });
  assert.equal(gate.api.AO_SEEN.has('studio.kosmosplus.com'), false, 'CONTROL: not let in did not forget them');
});

test('#6178 an old reading that will not update says so, as its own row does', () => {
  const { api } = load();
  const now = Date.now();
  const c = { name: 'studio', address: 'studio.kosmosplus.com' };
  const e = { dir: '/d', email: 'p@example.com', weekly: { usedPct: 40, resetsAt: FUTURE, at: now - 864e5 }, blocked: 'own-statusline' };
  const t = text(api.aoGroup(c, { state: 'ok', at: now }, { accounts: [e], agents: [], at: now }, now));
  assert.match(t, /40% of its weekly limit used/, 'CONTROL: the reading is shown');
  assert.match(t, /This is the last reading Kosmos saw\. It will not update, because this account is set up its own way\./, 'an old reading was shown as current');
  const live = text(api.aoGroup(c, { state: 'ok', at: now }, { accounts: [{ ...e, blocked: null }], agents: [], at: now }, now));
  assert.doesNotMatch(live, /will not update/, 'CONTROL: a reading that still updates was called frozen');
});

test('#6178 a burst of repaints asks for one round, not one each', () => {
  const t = makeDom();
  let rounds = 0;
  const clock = { now: 1e9 };
  const kick = new Function('document', 'location', 'Date', 'oaRound', 'aoPaint', `
    ${PAGE.slice(PAGE.indexOf('let AO_KICKED_AT = 0;'), PAGE.indexOf('\n', PAGE.indexOf('let AO_KICKED_AT = 0;')) + 1)}
    ${constLine('AO_KICK_GAP_MS')}
    ${slice('aoKick')}
    return { aoKick, AO_KICK_GAP_MS };
  `)(t.document, { protocol: 'https:' }, { now: () => clock.now }, () => { rounds++; }, () => {});
  kick.aoKick(); kick.aoKick(); kick.aoKick();
  assert.equal(rounds, 1, 'three repaints in a burst started ' + rounds + ' rounds');
  clock.now += kick.AO_KICK_GAP_MS + 1;
  kick.aoKick();
  assert.equal(rounds, 2, 'CONTROL: a repaint after the gap did not ask for a round');
});

test('#6178 arriving on AI Models from the Settings menu reads the other computers', () => {
  const go = slice('settingsGo');
  assert.ok(/section === 'accounts' && typeof aoKick === 'function'\) aoKick\(\)/.test(go), 'settingsGo does not kick the read when AI Models opens');
});

test('#6178 a computer that could not read its own accounts says so, never "no account"', () => {
  const { api } = load();
  assert.equal(api.aoAccountsOf({ agents: [], accountsWeekly: null }), false);
  const now = Date.now();
  const t = text(api.aoGroup({ name: 'studio', address: 'studio.kosmosplus.com' }, { state: 'ok', at: now }, { accounts: false, agents: [], at: now }, now));
  assert.match(t, /studio could not read its accounts just now/);
  assert.doesNotMatch(t, /No Claude account/, 'a failed read was reported as no accounts');
});
