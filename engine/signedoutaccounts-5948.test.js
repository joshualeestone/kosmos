'use strict';

/**
 * #5948 step 2: an account an agent is set up to use stays listed, as signed out, when its sign-in or key is gone.
 *
 *   node --test engine/signedoutaccounts-5948.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { signedOutRows } = require('./signedoutaccounts');
const { answer } = require('./accountline');

const jobs = { gk: { configDir: '/h/.grok-work', runner: 'grok' }, gk2: { configDir: '/h/.grok-work', runner: 'grok' }, gm: { configDir: '/h/.gemini-x', runner: 'gemini' }, cx: { configDir: null, runner: 'codex' }, cl: { configDir: '/h/.claude-a', runner: 'claude' }, stopped: { configDir: '/h/.grok-old', runner: 'grok' } };
const readJob = (n) => jobs[n] || null;
const readName = (p, d) => (d === '/h/.gemini-x' ? 'Team key' : null);
const card = (sessionName, runner, name) => ({ sessionName, runner, name: name || sessionName });

test('#5948: a named account folder an agent uses, with no listed row, comes back as one signed-out row naming its agents', () => {
  const rows = signedOutRows([card('gk', 'grok', 'Gk'), card('gk2', 'grok', 'Gk Two')], { xai: [] }, readJob, readName);
  assert.equal(rows.length, 1, JSON.stringify(rows));
  const r = rows[0];
  assert.deepEqual([r.provider, r.providerName, r.dir, r.label, r.signedOut], ['xai', 'Grok', '/h/.grok-work', 'work', true]);
  assert.deepEqual(r.usedBy, ['Gk', 'Gk Two']);
  assert.deepEqual([r.connection.state, r.connection.badge], ['none', 'signed_out']);
  assert.match(r.connection.because, /no longer on this computer, and Gk, Gk Two use it$/);
});

test('#5948 CONTROLS: a listed folder, a default-account agent, a Claude agent and an unknown runner add nothing', () => {
  assert.deepEqual(signedOutRows([card('gk', 'grok')], { xai: [{ dir: '/h/.grok-work' }] }, readJob, readName), [],
    'a folder the list already shows was added again');
  assert.deepEqual(signedOutRows([card('cx', 'codex')], { openai: [] }, readJob, readName), [], 'a default-account agent was read as signed out');
  assert.deepEqual(signedOutRows([card('cl', 'claude'), card('cl', 'muse')], {}, readJob, readName), []);
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
  const gone = signedOutRows([card('gk', 'grok', 'Gk')], { xai: [] }, readJob, readName);
  const both = answer(200, { accounts: [{ providerName: 'Claude', email: 'a@example.com', connection: { state: 'connected' } }], signedOutAccounts: gone });
  assert.deepEqual(both.lines, ['Claude: a@example.com: signed in', 'Grok: work: not signed in: its sign-in or key is no longer on this computer, and Gk uses it']);
  const only = answer(200, { accounts: [], signedOutAccounts: gone });
  assert.equal(only.lines.length, 1);
  assert.match(only.lines[0], /^Grok: work: not signed in/);
  // CONTROL: an older board with no signedOutAccounts field answers as before.
  assert.deepEqual(answer(200, { accounts: [] }).lines, ['No provider accounts are set up on this board yet. The person adds one in Settings > AI Models.']);
});

test('#5948: a stopped agent (its card has no runner) is read from its job', () => {
  const rows = signedOutRows([{ sessionName: 'stopped', name: 'Old', runner: null }], { xai: [] }, readJob, readName);
  assert.deepEqual(rows.map((r) => [r.dir, r.usedBy]), [['/h/.grok-old', ['Old']]]);
});

test('#5948 review 1: a credential file that is there but was not listed reads "could not be checked", never "gone"', () => {
  const there = (f) => f === '/h/.grok-work/.kosmos-grok-apikey';
  const [r] = signedOutRows([card('gk', 'grok', 'Gk')], { xai: [] }, readJob, readName, there);
  assert.deepEqual([r.signedOut, r.unreadable, r.connection.state, r.connection.badge], [false, true, 'unknown', 'unchecked']);
  assert.match(r.connection.because, /is in its folder, but Kosmos could not read it or does not look in that folder/);
  assert.doesNotMatch(r.connection.because, /no longer/);
  // CONTROL: the same folder with no credential file reads gone.
  const [g] = signedOutRows([card('gk', 'grok', 'Gk')], { xai: [] }, readJob, readName, () => false);
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
  for (let i = 1; i <= 5; i++) { many['a' + i] = { configDir: '/h/.grok-team', runner: 'grok' }; cards.push(card('a' + i, 'grok', 'A' + i)); }
  const [m] = signedOutRows(cards, { xai: [] }, (n) => many[n], readName, () => false);
  assert.equal(m.usedBy.length, 5);
  assert.match(m.connection.because, /and A1, A2, A3 and 2 more use it$/);
});

test('#5948 review 2: each provider\'s credential file names are the ones its own account module reads', () => {
  const { PROVIDER_OF_RUNNER } = require('./signedoutaccounts');
  const path = require('node:path');
  const base = (f) => path.basename(f('/x'));
  assert.deepEqual(PROVIDER_OF_RUNNER.codex.files, [base(require('./openaiaccounts').authFile)]);
  assert.deepEqual(PROVIDER_OF_RUNNER.gemini.files, [base(require('./geminiaccounts').keyFile)]);
  assert.deepEqual(PROVIDER_OF_RUNNER.grok.files, [base(require('./grokaccounts').keyFile), base(require('./grokaccounts').authFile)]);
});

test('#5948 review 3: on a real disk, a folder Kosmos cannot read reads unchecked, never gone; a missing folder reads gone', { skip: process.getuid && process.getuid() === 0 }, () => {
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
    assert.deepEqual([l.unreadable, l.connection.badge], [true, 'unchecked'], JSON.stringify(l));
    const [m] = signedOutRows([card('m', 'grok')], { xai: [] }, (n) => jobsHere[n], () => null);
    assert.deepEqual([m.unreadable, m.connection.badge], [false, 'signed_out'], 'CONTROL: ' + JSON.stringify(m));
  } finally { fs.chmodSync(locked, 0o700); fs.rmSync(root, { recursive: true, force: true }); }
});
