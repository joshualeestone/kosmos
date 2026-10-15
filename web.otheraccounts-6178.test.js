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

/* Another computer's /api/status agents are the board's own cards, so these take REAL ones from test-support/fleet
   (fixture-discipline), as web.allagents-4812.test.js does; `over` sets the fields this section reads. */
const os = require('node:os');
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'otheraccounts-6178-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });
const fleet = require('./test-support/fleet');
const CARDS = new Map();
function card(name, over) {
  if (!CARDS.has(name)) {
    const board = fleet.install([fleet.agent(name, { state: 'idle' })]);
    CARDS.set(name, board.agents[0]);
    fleet.restore();
  }
  return Object.assign(JSON.parse(JSON.stringify(CARDS.get(name))), over || {});
}

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
  constLine('OA_STALE_MS'), constLine('OA_READ_LIMIT_MS'), constLine('OA_MAX_AGENTS'), constLine('ACCT_WARN_PCT'), constLine('AO_SEEN'), constLine('AO_MAX_ACCOUNTS'), constLine('AO_MAX_AGENTS'), constLine('AO_SKEW_MIN_MS'),
  'const OA_SEEN = new Map();\n',
  ...['computerAddressOk', 'agoWords', 'oaEligible', 'oaOthers', 'oaStale', 'oaClassify', 'oaRemember', 'oaAgentsOf', 'oaReadOne', 'aoStr', 'aoAccountsOf', 'aoAgentsOf', 'aoKeep',
    'aoShown', 'aoUnknownOf', 'aoSkewOf', 'aoUsageWords', 'aoEl', 'aoGroup', 'aoPaint'].map(slice),
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
    card('ann', { name: 'Ann', runner: 'claude', acct: 'a0' }),
    card('bo', { name: 'Bo', runner: 'claude', acct: 'a1' }),
    card('guide', { name: 'Guide', isGuide: true, runner: 'claude', acct: 'a0' }),
    card('nobody', { name: 'Nobody', runner: 'claude', acct: null }),
    card('cody', { name: 'Cody', runner: 'codex', acct: null }),
    card('stray', { name: 'Stray', runner: null, acct: null }),
  ],
  accountsWeekly: [
    { key: 'a0', email: 'p@example.com', isDefault: true, weekly: { usedPct: 82, resetsAt: FUTURE, at: Date.now() - 3600e3 }, blocked: null },
    { key: 'a1', email: 'w@example.com', weekly: null, blocked: 'not-wired' },
  ],
};
const text = (n) => n.textContent;

test('#6178 the other computer\'s accounts are kept checked: bad entries dropped, unknown reasons not repeated', () => {
  const { api } = load();
  const got = api.aoAccountsOf({ accountsWeekly: [
    ...STATUS.accountsWeekly,
    { email: 'no-dir@example.com' },
    { key: 'a9', weekly: { usedPct: 'lots', resetsAt: 1, at: 1 }, blocked: '<script>' },
    null,
  ] });
  assert.equal(got.length, 3, 'an entry with no folder was kept: ' + JSON.stringify(got));
  assert.equal(got[0].weekly.usedPct, 82);
  assert.equal(got[2].weekly, null, 'a non-number reading was kept');
  assert.equal(got[2].blocked, null, 'a reason this page does not know was kept');
  assert.equal(api.aoAccountsOf({ agents: [] }), null, 'an older Kosmos (no accountsWeekly) must read as unknown, not as no accounts');
  assert.deepEqual(api.aoAgentsOf(STATUS).map((a) => [a.name, a.acct]), [['Ann', 'a0'], ['Bo', 'a1']],
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
  const mine = slice('aoUsageWords') + slice('aoGroup');
  for (const piece of ["'% of its weekly limit used · resets '", "' · Kosmos last saw it change '",
    "'No usage reading for this account yet. Kosmos reads it while an agent on it is working.'", "' (some could not be checked)'"]) {
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
  assert.deepEqual(r.agents.map((a) => a.sessionName), ['ann', 'bo', 'nobody', 'cody', 'stray'], 'the Agents view lost its agents');
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
  const e = { key: 'a0', email: 'p@example.com', weekly: { usedPct: 40, resetsAt: FUTURE, at: now - 864e5 }, blocked: 'own-statusline' };
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
  assert.match(t, /studio could not read its accounts when this page last asked/);
  assert.doesNotMatch(t, /No Claude account/, 'a failed read was reported as no accounts');
});

/* oaRound's arms for Settings (#6178), lifted with stand-ins for everything it calls: the read decision is the subject. */
function roundWith({ host, models, thisOnly }) {
  const reads = [];
  const api = new Function('document', 'location', 'state', `
    let OA_BUSY = false, OA_AGAIN = false, OA_COMPUTERS = state.list, OA_COMPUTERS_AT = Date.now();
    const OA_COMPUTERS_EVERY_MS = 60000;
    function oaHost() { return state.host ? {} : null; }
    function aoShown() { return state.models; }
    function oaThisOnly() { return state.thisOnly; }
    function oaPaint() {}
    function aoPaint() {}
    function oaRefreshComputers() { return null; }
    function oaEligible() { return true; }
    function oaOthers() { return [{ address: 'studio.kosmosplus.com' }]; }
    function oaReadOne(c) { state.reads.push(c.address); return Promise.resolve(null); }
    ${slice('oaRound')}
    return { oaRound };
  `)({ hidden: false }, { protocol: 'https:' }, { list: LIST, host, models, thisOnly, reads });
  return { api, reads };
}
test('#6178 oaRound reads for AI Models, even with "This computer only" ticked, and not when nothing is shown', async () => {
  const a = roundWith({ host: false, models: true, thisOnly: false });
  await a.api.oaRound();
  assert.deepEqual(a.reads, ['studio.kosmosplus.com'], 'AI Models on screen, the Agents view not: nothing was read');
  const b = roundWith({ host: false, models: true, thisOnly: true });
  await b.api.oaRound();
  assert.deepEqual(b.reads, ['studio.kosmosplus.com'], '"This computer only" (the Agents view\'s) stopped the Settings read');
  const c = roundWith({ host: false, models: false, thisOnly: false });
  await c.api.oaRound();
  assert.deepEqual(c.reads, [], 'CONTROL: with neither on screen another computer was asked');
  const d = roundWith({ host: true, models: false, thisOnly: true });
  await d.api.oaRound();
  assert.deepEqual(d.reads, [], 'CONTROL (#4812): the Agents view with "This computer only" ticked still reads nothing');
});

test('#6178 a kick while another Settings section is shown starts no round and no gap', () => {
  const t = makeDom();
  let rounds = 0;
  const flags = { shown: false };
  const k = new Function('document', 'location', 'Date', 'oaRound', 'aoPaint', 'aoShown', `
    ${PAGE.slice(PAGE.indexOf('let AO_KICKED_AT = 0;'), PAGE.indexOf('\n', PAGE.indexOf('let AO_KICKED_AT = 0;')) + 1)}
    ${constLine('AO_KICK_GAP_MS')}
    ${slice('aoKick')}
    return { aoKick };
  `)(t.document, { protocol: 'https:' }, { now: () => 1e9 }, () => { rounds++; }, () => {}, () => flags.shown);
  k.aoKick();
  assert.equal(rounds, 0, 'a paint of another section asked for a round');
  flags.shown = true;
  k.aoKick();
  assert.equal(rounds, 1, 'arriving on AI Models at once after was held back by a gap the hidden paint started');
});

test('#6178 a kept reading past its reset is not shown as this week\'s', () => {
  const { api } = load();
  const now = Date.now();
  const u = api.aoUsageWords({ weekly: { usedPct: 90, resetsAt: now - 60e3, at: now - 864e5 }, blocked: null }, now);
  assert.equal(u.pct, null, 'a reading from a week that has reset was drawn as a meter');
  assert.match(u.line, /No usage reading for this account yet/);
});

test('#6178 a kept list for a computer that has gone unreadable says so, not just that it is old', () => {
  const { api } = load();
  const now = Date.now();
  const t = text(api.aoGroup({ name: 'studio', address: 'studio.kosmosplus.com' }, { state: 'blocked', at: now - 60e3 },
    { accounts: [STATUS.accountsWeekly[0]], agents: [], at: now - 60e3 }, now));
  assert.match(t, /studio cannot be read from here right now\. Showing what this page last read/);
});

test('#6178 an agent whose account could not be read makes the list "some could not be checked", never "none"', () => {
  const { api } = load();
  const now = Date.now();
  api.aoKeep('studio.kosmosplus.com', 'ok', STATUS, now);
  const kept = api.AO_SEEN.get('studio.kosmosplus.com');
  assert.equal(kept.unknown, 1, 'only the Claude agent with no account counts (not the Codex one, a card with no record, or the guide): ' + kept.unknown);
  const c = { name: 'studio', address: 'studio.kosmosplus.com' };
  const t = text(api.aoGroup(c, { state: 'ok', at: now }, kept, now));
  assert.match(t, /Its agents on studio: Ann \(some could not be checked\)/);
  const onlyUnknown = { ...kept, agents: [] };
  assert.match(text(api.aoGroup(c, { state: 'ok', at: now }, onlyUnknown, now)), /Kosmos could not check which agents on studio are on it/);
  assert.match(text(api.aoGroup(c, { state: 'ok', at: now }, { ...onlyUnknown, unknown: 0 }, now)), /Kosmos cannot see any agents on it on studio\./,
    'CONTROL: with every agent readable, none is said plainly');
});

test('#6178 each group opens its computer, except one not connected', () => {
  const { api } = load();
  const c = { name: 'studio', address: 'studio.kosmosplus.com' };
  const now = Date.now();
  const link = (seen) => { const g = api.aoGroup(c, seen, null, now); const a = g.querySelector('.oa-open'); return a ? a.href : null; };
  assert.equal(link({ state: 'notin' }), 'https://studio.kosmosplus.com/', 'not let in: told to open it, with nothing to open');
  assert.equal(link({ state: 'out' }), null, 'a computer that is not connected was linked');
});

test('#6178 ages and reset times are said in this page\'s clock, not the other computer\'s', () => {
  const { api } = load();
  const now = Date.now();
  const theirs = now - 3600e3;   // that computer's clock runs an hour behind this one
  api.aoKeep('studio.kosmosplus.com', 'ok', { ...STATUS, checkedAt: new Date(theirs).toISOString() }, now);
  const kept = api.AO_SEEN.get('studio.kosmosplus.com');
  assert.ok(Math.abs(kept.skew - 3600e3) < 1000, 'the skew was not measured: ' + kept.skew);
  const e = { weekly: { usedPct: 50, resetsAt: theirs + 30e3, at: theirs - 120e3 }, blocked: null };   // resets in 30 s, changed 2 minutes ago, by ITS clock
  const u = api.aoUsageWords(e, now, kept.skew);
  assert.equal(u.pct, 50, 'a reading that has not reset by its own clock was dropped');
  assert.match(u.line, /Kosmos last saw it change 2 minutes ago/, 'the age was not said in this page\'s clock: ' + u.line);
  assert.equal(api.aoUsageWords(e, now, 0).pct, null, 'CONTROL: read in this clock unshifted, the reading looks a week old');
  assert.equal(api.aoAccountsOf({ accountsWeekly: [{ key: 'a0', weekly: { usedPct: 1, resetsAt: 1e300, at: now } }] })[0].weekly, null,
    'a reset time no Date can show was kept');
});

test('#6178 an old empty answer says it is old', () => {
  const { api } = load();
  const now = Date.now();
  const t = text(api.aoGroup({ name: 'studio', address: 'studio.kosmosplus.com' }, { state: 'out', at: now - 600e3 }, { accounts: [], agents: [], at: now - 600e3 }, now));
  assert.match(t, /No Claude account is set up on studio\. Not connected\. Showing what this page last read, 10 minutes ago\./);
});

test('#6178 a repaint keeps an unchanged group, and focus in a changed one moves to its new Open link', () => {
  const { api, d } = load();
  const now = Date.now();
  api.OA_SEEN.set('studio.kosmosplus.com', { state: 'ok', agents: [], at: now });
  api.aoKeep('studio.kosmosplus.com', 'ok', STATUS, now);
  api.aoPaint();
  const list = d.getElementById('set-other');
  const first = list.children[0];
  first.querySelector('.oa-open').focus();
  api.aoPaint();
  assert.equal(list.children[0], first, 'an unchanged group was rebuilt (focus in it would be lost)');
  assert.equal(d.activeElement, first.querySelector('.oa-open'), 'CONTROL: focus stayed on the Open link');
  api.aoKeep('studio.kosmosplus.com', 'ok', { ...STATUS, accountsWeekly: [] }, now);
  api.aoPaint();
  const next = list.children[0];
  assert.notEqual(next, first, 'CONTROL: a group whose words changed was not replaced');
  assert.equal(d.activeElement, next.querySelector('.oa-open'), 'focus was lost when its group was replaced');
});

test('#6178 two accounts on one email are told apart by organization or label', () => {
  const { api } = load();
  const now = Date.now();
  const c = { name: 'studio', address: 'studio.kosmosplus.com' };
  const accts = [
    { key: 'a0', email: 'p@example.com', organization: 'Acme', weekly: null, blocked: null },
    { key: 'a1', email: 'p@example.com', organization: null, label: 'Personal', weekly: null, blocked: null },
    { key: 'a2', email: 'q@example.com', organization: null, weekly: null, blocked: null },
  ];
  const names = api.aoGroup(c, { state: 'ok', at: now }, { accounts: accts, agents: [], unknown: 0, at: now }, now)
    .querySelectorAll('.ao-acct-name').map((n) => n.textContent);
  assert.deepEqual(names, ['p@example.com · Acme', 'p@example.com · Personal', 'q@example.com']);
});

test('#6178 a repaint where only the age words moved keeps the group (and focus), with the new words', () => {
  const { api, d } = load();
  const t0 = Date.now() - 300e3;
  api.OA_SEEN.set('studio.kosmosplus.com', { state: 'out', agents: [], at: t0 });
  api.aoKeep('studio.kosmosplus.com', 'ok', STATUS, t0);
  api.OA_SEEN.set('studio.kosmosplus.com', { state: 'out', agents: [], at: t0 });
  api.aoPaint();
  const list = d.getElementById('set-other');
  const first = list.children[0];
  const before = first.textContent;
  assert.match(before, /Showing what this page last read, \d+ minutes ago/, 'CONTROL: the kept list carries an age');
  first.querySelector('.ao-name').focus();
  api.AO_SEEN.get('studio.kosmosplus.com').at = t0 - 600e3;   // ten minutes older: only the age words move
  api.aoPaint();
  assert.equal(list.children[0], first, 'a group whose only change was its age words was rebuilt');
  assert.notEqual(first.textContent, before, 'the kept group still shows the old age');
  assert.equal(d.activeElement, first.querySelector('.ao-name'), 'focus left the kept group');
});

test('#6178 focus in a replaced group with no Open link goes to its name, not the page', () => {
  const { api, d } = load();
  const now = Date.now();
  api.OA_SEEN.set('studio.kosmosplus.com', { state: 'ok', agents: [], at: now });
  api.aoKeep('studio.kosmosplus.com', 'ok', STATUS, now);
  api.aoPaint();
  const list = d.getElementById('set-other');
  list.children[0].querySelector('.oa-open').focus();
  api.OA_SEEN.set('studio.kosmosplus.com', { state: 'out', agents: [], at: now });
  api.AO_SEEN.delete('studio.kosmosplus.com');
  api.aoPaint();
  const g = list.children[0];
  assert.equal(g.querySelector('.oa-open'), null, 'CONTROL: a computer not connected has no Open link');
  assert.equal(d.activeElement, g.querySelector('.ao-name'), 'focus fell to the page');
});

test('#6178 an older Kosmos or a failed read is not told "showing what this page last read"', () => {
  const { api } = load();
  const now = Date.now();
  const c = { name: 'studio', address: 'studio.kosmosplus.com' };
  for (const accounts of [null, false]) {
    const t = text(api.aoGroup(c, { state: 'out', at: now - 600e3 }, { accounts, agents: [], unknown: 0, at: now - 600e3 }, now));
    assert.doesNotMatch(t, /Showing what this page last read/, JSON.stringify(accounts) + ': ' + t);
    assert.doesNotMatch(t, /just now/, 'a failed read claimed "just now" on an old answer');
  }
});

test('#6178 a few seconds between the clocks (the read\'s own round trip) is taken as none', () => {
  const { api } = load();
  const now = Date.now();
  api.aoKeep('studio.kosmosplus.com', 'ok', { ...STATUS, checkedAt: new Date(now - 8000).toISOString() }, now);
  assert.equal(api.AO_SEEN.get('studio.kosmosplus.com').skew, 0, 'an 8 s round trip moved the reset time');
});
