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
