'use strict';

/**
 * #5948 step 2: an account an agent is set up to use stays listed, as signed out, when its sign-in or key is gone.
 *
 *   node --test engine/signedoutaccounts-5948.test.js
 */

const os = require('node:os');
const nodePath = require('node:path');
const SANDBOX = nodePath.join(os.tmpdir(), 'kosmos-signedoutaccts-5948-' + process.pid);
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');

const { signedOutRows } = require('./signedoutaccounts');
const { answer } = require('./accountline');

const jobs = { gk: { configDir: '/h/.grok-work', runner: 'grok' }, gk2: { configDir: '/h/.grok-work', runner: 'grok' }, gm: { configDir: '/h/.gemini-x', runner: 'gemini' }, cx: { configDir: null, runner: 'codex' }, cl: { configDir: '/h/.claude-a', runner: 'claude' }, stopped: { configDir: '/h/.grok-old', runner: 'grok' } };
const readJob = (n) => jobs[n] || null;
const readName = (p, d) => (d === '/h/.gemini-x' ? 'Team key' : null);
/* Real board cards (test-support/fleet), never hand-built ones (fixture-discipline.test.js). The module reads only a
   card's sessionName, name and runner; a test that needs another runner spreads the real card. */
const DISPLAY = { gk: 'Gk', gk2: 'Gk Two', stopped: 'Old', a1: 'A1', a2: 'A2', a3: 'A3', a4: 'A4', a5: 'A5' };
const FLEET = (() => {
  const names = ['gk', 'gk2', 'gm', 'cx', 'cl', 'nobody', 'd', 'e', 's', 'l', 'm', 'stopped', 'a1', 'a2', 'a3', 'a4', 'a5'];
  const b = fleet.install(names.map((n) => fleet.agent(n, { state: 'idle', displayName: DISPLAY[n] || null })));
  try { return b.agents; } finally { b.restore(); }
})();
test.after(() => { require('node:fs').rmSync(SANDBOX, { recursive: true, force: true }); });
const card = (sessionName, runner) => {
  const c = FLEET.find((x) => x.sessionName === sessionName);
  assert.ok(c, 'setup: no fleet card for ' + sessionName);
  return runner === undefined ? c : { ...c, runner };
};

test('#5948: a named account folder an agent uses, with no listed row, comes back as one signed-out row naming its agents', () => {
  const rows = signedOutRows([card('gk', 'grok'), card('gk2', 'grok')], { xai: [] }, readJob, readName);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  const r = rows[0];
  assert.deepEqual([r.provider, r.providerName, r.dir, r.label, r.signedOut], ['xai', 'Grok', '/h/.grok-work', 'work', true]);
  assert.deepEqual(r.usedBy, ['Gk', 'Gk Two']);
  assert.deepEqual([r.connection.state, r.connection.badge], ['none', 'signed_out']);
  assert.match(r.connection.because, /no longer on this computer, and Gk, Gk Two use it\. To fix it, add the key or sign in again in Settings > AI Models\.$/);
});

test('#5948 CONTROLS: a listed folder, a default-account agent, a Claude agent and an unknown runner add nothing', () => {
  assert.deepEqual(signedOutRows([card('gk', 'grok')], { xai: [{ dir: '/h/.grok-work' }] }, readJob, readName), [],
    'a folder the list already shows was added again');
  assert.deepEqual(signedOutRows([card('cx', 'codex')], { openai: [] }, readJob, readName), [], 'a default-account agent was read as signed out');
  assert.deepEqual(signedOutRows([card('cl', 'claude')], {}, readJob, readName), []);
  // An unknown runner, read where the module reads it (the job first): no row.
  assert.deepEqual(signedOutRows([card('cl')], {}, () => ({ configDir: '/h/.muse-x', runner: 'muse' }), readName), []);
  assert.deepEqual(signedOutRows([card('nobody', 'grok')], { xai: [] }, readJob, readName), [], 'an agent with no job');
  // The provider is matched too: a gemini folder is not answered by a grok row of the same path.
  assert.equal(signedOutRows([card('gm', 'gemini')], { xai: [{ dir: '/h/.gemini-x' }], google: [] }, readJob, readName).length, 1);
});

test('#5948: a signed-out row carries the folder\'s chosen name, and a throwing reader does not lose the row', () => {
  const [r] = signedOutRows([card('gm', 'gemini')], { google: [] }, readJob, readName);
  assert.equal(r.name, 'Team key');
  const [t] = signedOutRows([card('gm', 'gemini')], { google: [] }, readJob, () => { throw new Error('x'); });
  assert.equal(t.name, null);
});

test('#5948: kosmos accounts prints the signed-out accounts after the listed ones; with none listed it no longer says none are set up', () => {
  const gone = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName);
  const both = answer(200, { accounts: [{ providerName: 'Claude', email: 'a@example.com', connection: { state: 'connected' } }], unlistedAccounts: gone });
  assert.deepEqual(both.lines, ['Claude: a@example.com: signed in', 'Grok: work: not signed in: its sign-in or key is no longer on this computer, and Gk uses it. To fix it, add the key or sign in again in Settings > AI Models.']);
  const only = answer(200, { accounts: [], unlistedAccounts: gone });
  assert.equal(only.lines.length, 1);
  assert.match(only.lines[0], /^Grok: work: not signed in/);
  // CONTROL: an older board with no unlistedAccounts field answers as before.
  assert.deepEqual(answer(200, { accounts: [] }).lines, ['No provider accounts are set up on this board yet. The person adds one in Settings > AI Models.']);
});

test('#5948: a stopped agent (its card has no runner) is read from its job', () => {
  const rows = signedOutRows([card('stopped', null)], { xai: [] }, readJob, readName);
  assert.deepEqual(rows.map((r) => [r.dir, r.usedBy]), [['/h/.grok-old', ['Old']]]);
});

test('#5948 review 1: a credential file that is there but was not listed reads "could not be checked", never "gone"', () => {
  const there = (f) => f === '/h/.grok-work/.kosmos-grok-apikey';
  const [r] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, there);
  assert.deepEqual([r.signedOut, r.unreadable, r.connection.state, r.connection.badge], [false, true, 'unknown', 'unlisted']);
  assert.match(r.connection.because, /is in its folder, but Kosmos could not read it or does not look in that folder/);
  assert.doesNotMatch(r.connection.because, /no longer/);
  // CONTROL: the same folder with no credential file reads gone.
  const [g] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, () => false);
  assert.deepEqual([g.signedOut, g.connection.badge], [true, 'signed_out']);
});

test('#5948 review 1/3: the provider\'s default folder is skipped; many agents are counted, not all named', () => {
  // The default folder (as the provider module names it) is skipped, named or not: it may run on the computer's own key.
  const pinned = { d: { configDir: '/h/.grok', runner: 'grok' }, e: { configDir: '/h/.grok-e', runner: 'grok' } };
  assert.deepEqual(signedOutRows([card('d', 'grok')], { xai: [] }, (n) => pinned[n], readName, () => false, () => '/h/.grok'), []);
  // CONTROL: a named folder beside it is still reported, so the skip is the default folder's alone.
  assert.equal(signedOutRows([card('e', 'grok')], { xai: [] }, (n) => pinned[n], readName, () => false, () => '/h/.grok').length, 1);
  const many = {};
  const cards = [];
  for (let i = 1; i <= 5; i++) { many['a' + i] = { configDir: '/h/.grok-team', runner: 'grok' }; cards.push(card('a' + i, 'grok')); }
  const [m] = signedOutRows(cards, { xai: [] }, (n) => many[n], readName, () => false);
  assert.equal(m.usedBy.length, 5);
  assert.match(m.connection.because, /and A1, A2, A3 and 2 more use it\./);
});

test('#5948 review 2: each provider\'s credential file names are the ones its own account module reads', () => {
  const { PROVIDER_OF_RUNNER } = require('./signedoutaccounts');
  const path = require('node:path');
  const base = (f) => path.basename(f('/x'));
  assert.deepEqual(PROVIDER_OF_RUNNER.codex.files, [base(require('./openaiaccounts').authFile)]);
  assert.deepEqual(PROVIDER_OF_RUNNER.gemini.files, [base(require('./geminiaccounts').keyFile)]);
  assert.deepEqual(PROVIDER_OF_RUNNER.grok.files, [base(require('./grokaccounts').keyFile), base(require('./grokaccounts').authFile)]);
});

test('#5948 review 3: on a real disk, a folder Kosmos cannot read reads unchecked, never gone; a missing folder reads gone', { skip: process.platform === 'win32' || (process.getuid && process.getuid() === 0) }, () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-so-5948-'));
  const locked = path.join(root, '.grok-locked');
  fs.mkdirSync(locked);
  fs.chmodSync(locked, 0o000);
  try {
    const jobsHere = { l: { configDir: locked, runner: 'grok' }, m: { configDir: path.join(root, '.grok-missing'), runner: 'grok' } };
    const [l] = signedOutRows([card('l', 'grok')], { xai: [] }, (n) => jobsHere[n], () => null);
    assert.deepEqual([l.unreadable, l.connection.badge], [true, 'unlisted'], JSON.stringify(l));
    // review 13: nobody saw a file in a folder Kosmos could not look into, so the words do not say one is there.
    assert.match(l.connection.because, /^Kosmos could not look in its folder/);
    assert.doesNotMatch(l.connection.because, /file is in its folder/);
    const [m] = signedOutRows([card('m', 'grok')], { xai: [] }, (n) => jobsHere[n], () => null);
    assert.deepEqual([m.unreadable, m.connection.badge], [false, 'signed_out'], 'CONTROL: ' + JSON.stringify(m));
  } finally { fs.chmodSync(locked, 0o700); fs.rmSync(root, { recursive: true, force: true }); }
});

test('#5948 review 4: a listed folder named through a symlink is the same folder, not a second unlisted row', { skip: process.platform === 'win32' }, () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-so-link-5948-'));
  try {
    const real = path.join(root, '.grok-real');
    fs.mkdirSync(real);
    const link = path.join(root, 'linked');
    fs.symlinkSync(root, link);
    const viaLink = path.join(link, '.grok-real');
    const jobsHere = { s: { configDir: viaLink, runner: 'grok' } };
    assert.deepEqual(signedOutRows([card('s', 'grok')], { xai: [{ dir: real }] }, (n) => jobsHere[n], () => null), []);
    // CONTROL: with no listed row, the same job does produce one, so the empty answer above is the match.
    assert.equal(signedOutRows([card('s', 'grok')], { xai: [] }, (n) => jobsHere[n], () => null).length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#5948 review 5: kosmos accounts says an unlisted account is not checked by Kosmos, not "just now" (it is not a passing fault)', () => {
  const there = (f) => f === '/h/.grok-work/.kosmos-grok-apikey';
  const rows = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, there);
  const [line] = answer(200, { accounts: [], unlistedAccounts: rows }).lines;
  assert.match(line, /^Grok: work: not checked by Kosmos: a sign-in or key file is in its folder/);
  assert.doesNotMatch(line, /just now/);
});

test('#5948 review 9: a gemini/grok folder whose own key is gone, with a shared key on this computer, is "unlisted", not signed out', () => {
  const asked = [];
  const shared = (v) => { asked.push(v); return v === 'XAI_API_KEY'; };
  const [r] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, () => false, () => null, shared);
  assert.deepEqual([r.signedOut, r.sharedKey, r.connection.badge], [false, true, 'unlisted']);
  assert.match(r.connection.because, /gone from its folder, but this computer's shared Grok key can stand in for it/);
  assert.doesNotMatch(r.connection.because, /To fix it/, 'a row that may be working was told to fix itself');
  assert.deepEqual(asked, ['XAI_API_KEY']);
  // A door that cannot be read is unsure, never "gone".
  const [u] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, () => false, () => null, () => { throw new Error('x'); });
  assert.equal(u.connection.badge, 'unlisted');
  // review 13: an unread door is not said to hold a key.
  assert.match(u.connection.because, /could not read this computer's shared Grok key to tell whether one stands in/);
  assert.doesNotMatch(u.connection.because, /can stand in for it/);
  // CONTROLS: no shared key reads signed out; codex has no shared door (the supervisor's allowlist does not carry
  // OPENAI_API_KEY, review 17), so it is never asked even by a reader that would say yes.
  const [g] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, () => false, () => null, () => false);
  assert.equal(g.connection.badge, 'signed_out');
  const cx = { cxn: { configDir: '/h/.codex-team', runner: 'codex' } };
  const seen = [];
  const [c] = signedOutRows([card('cx', 'codex')], { openai: [] }, (n) => cx[n === 'cx' ? 'cxn' : n], readName, () => false, () => null, (v) => { seen.push(v); return true; });
  assert.deepEqual([c.connection.badge, seen], ['signed_out', []]);
});

test('#5948 review 10: on a real disk, an EMPTY credential file holds no credential and reads signed out; a non-empty one reads unlisted', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-so-empty-5948-'));
  try {
    const empty = path.join(root, '.grok-empty');
    const full = path.join(root, '.grok-full');
    fs.mkdirSync(empty); fs.mkdirSync(full);
    fs.writeFileSync(path.join(empty, 'auth.json'), '');
    const blank = path.join(root, '.grok-blank');
    fs.mkdirSync(blank);
    fs.writeFileSync(path.join(blank, '.kosmos-grok-apikey'), '  \n');
    fs.writeFileSync(path.join(full, 'auth.json'), '{"x":1}');
    const jobsHere = { e: { configDir: empty, runner: 'grok' }, f: { configDir: full, runner: 'grok' }, b: { configDir: blank, runner: 'grok' } };
    const [e] = signedOutRows([card('e', 'grok')], { xai: [] }, (n) => jobsHere[n], () => null);
    assert.equal(e.connection.badge, 'signed_out', JSON.stringify(e));
    // review 11: a key file holding only whitespace is no key either (the launch reads its first line, trimmed).
    const [b] = signedOutRows([card('e', 'grok')], { xai: [] }, (n) => jobsHere[n === 'e' ? 'b' : n], () => null);
    assert.equal(b.connection.badge, 'signed_out', JSON.stringify(b));
    const [f] = signedOutRows([card('e', 'grok')], { xai: [] }, (n) => jobsHere[n === 'e' ? 'f' : n], () => null);
    assert.equal(f.connection.badge, 'unlisted', 'CONTROL: ' + JSON.stringify(f));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('#5948 review 13: when the board could not check its agents\' accounts, kosmos accounts does not say none are set up', () => {
  assert.deepEqual(answer(200, { accounts: [], unlistedAccounts: [], unlistedComplete: false }).lines,
    ['No provider accounts are listed, and Kosmos could not check the accounts its agents use just now. Try again in a minute.']);
  // CONTROL: a completed check with nothing to say keeps the old sentence.
  assert.deepEqual(answer(200, { accounts: [], unlistedAccounts: [], unlistedComplete: true }).lines,
    ['No provider accounts are set up on this board yet. The person adds one in Settings > AI Models.']);
});

test('#5948 review 15: with accounts listed but the unlisted check incomplete, kosmos accounts says the list may be short', () => {
  const lines = answer(200, { accounts: [{ providerName: 'Claude', email: 'a@example.com', connection: { state: 'connected' } }], unlistedAccounts: [], unlistedComplete: false }).lines;
  assert.deepEqual(lines, ['Claude: a@example.com: signed in', 'Kosmos could not check every account its agents use just now, so one may be missing here. Try again in a minute.']);
  // CONTROL: a complete check adds nothing.
  assert.deepEqual(answer(200, { accounts: [{ providerName: 'Claude', email: 'a@example.com', connection: { state: 'connected' } }], unlistedAccounts: [], unlistedComplete: true }).lines, ['Claude: a@example.com: signed in']);
});

test('#5948 review 16: when the provider\'s default folder cannot be asked, a job\'s folder reads unlisted, never signed out', () => {
  const [r] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, () => false, () => { throw new Error('x'); });
  assert.deepEqual([r.signedOut, r.defaultUnsure, r.connection.badge], [false, true, 'unlisted']);
  assert.match(r.connection.because, /could not tell whether that folder is the default account/);
  // CONTROL: a default that answers (and is another folder) leaves it signed out.
  const [g] = signedOutRows([card('gk', 'grok')], { xai: [] }, readJob, readName, () => false, () => '/h/.grok');
  assert.equal(g.connection.badge, 'signed_out');
});

test('#5948 review 17: every provider\'s shared key is a name the supervisor actually hands a pane (its door allowlist)', () => {
  const { PROVIDER_OF_RUNNER } = require('./signedoutaccounts');
  const sup = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'bin', 'agent-supervisor.sh'), 'utf8');
  const line = sup.split('\n').find((l) => /process\.stdout\.write\(\[\.\.\.new Set\(names\)/.test(l));
  assert.ok(line, 'CONTROL: the supervisor\'s allowlist line was not found, so this test checks nothing');
  for (const [runner, p] of Object.entries(PROVIDER_OF_RUNNER)) {
    if (p.sharedKey) assert.ok(line.includes('"' + p.sharedKey + '"'), runner + ': ' + p.sharedKey + ' is not on the supervisor\'s door allowlist');
  }
  assert.ok(!line.includes('"OPENAI_API_KEY"'), 'the allowlist now carries OPENAI_API_KEY: give codex its sharedKey');
});

test('#5948 review 19: a runner named like an Object member is not a provider', () => {
  for (const runner of ['constructor', 'toString', '__proto__']) {
    assert.deepEqual(signedOutRows([card('gk')], { xai: [] }, () => ({ configDir: '/h/.grok-work', runner }), readName), [], runner);
  }
});
