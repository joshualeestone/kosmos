'use strict';

/* #7212 slice 3, review 6: the AI Models badge's request evidence (server.js claudeObservationsFor) is ONE join, read by
   the accounts route and by a stuck card. Tested here on real job files and real observations, so a change in its
   shape cannot pass behind the stallsignin unit tests' hand-made evidence. */

const test = require('node:test');
const jobfix = require('./test-support/jobfixture');   // the agent's job as this platform writes it (plist / systemd unit)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-stallsignin-7212-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_SYSTEMD_DIR = nodePath.join(process.env.AGENT_WORKFORCE_LAUNCH, 'systemd', 'user');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_TMUX_BIN = TMUX_BIN;

const create = require('./engine/create');
const accounts = require('./engine/accounts');
const observed = require('./engine/observed');
const stallsignin = require('./engine/stallsignin');
const { STATE } = require('./engine/subscription');

/* One labelled Claude account with two agents on it, and a second account with one. */
const B_DIR = nodePath.join(HOME, '.claude-b');
const C_DIR = nodePath.join(HOME, '.claude-c');
for (const [dir, email] of [[B_DIR, 'b@example.com'], [C_DIR, 'c@example.com']]) {
  fs.mkdirSync(nodePath.join(dir, 'projects'), { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }));
}
function born(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(jobfix.jobPath(name), jobfix.jobFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'claude'), 'utf8');
}
born('stuck', B_DIR);
born('sibling', B_DIR);
born('other', C_DIR);

const { claudeObservationsFor } = require('./server');

test.beforeEach(() => { observed._clearForTest(); stallsignin.resetForTests(); });
test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('a sibling agent\'s 401 is the account\'s evidence; another account\'s is not', () => {
  const known = accounts.list();
  assert.ok(known.some((r) => r.dir === B_DIR), 'control: the sandboxed account is listed');
  const now = Date.now();
  observed.saw(observed.PROVIDER.ANTHROPIC, 'sibling', observed.OUTCOME.REJECTED, now - 1000);
  observed.saw(observed.PROVIDER.ANTHROPIC, 'other', observed.OUTCOME.OK, now - 500);
  const of = claudeObservationsFor(known);
  const b = of(B_DIR);
  assert.equal(b.obs && b.obs.outcome, observed.OUTCOME.REJECTED, 'the sibling\'s 401 did not count for its account');
  assert.equal(b.checkObs, null);
  assert.equal(of(C_DIR).obs.outcome, observed.OUTCOME.OK, 'CONTROL: the other account has its own evidence');
  assert.deepEqual(of(null), { obs: null, checkObs: null });
});

test('a newer Check now decides, and is told apart by identity, as the badge\'s observedFrom reads it', () => {
  const known = accounts.list();
  const now = Date.now();
  observed.saw(observed.PROVIDER.ANTHROPIC, 'sibling', observed.OUTCOME.REJECTED, now - 2000);
  observed.sawDir(observed.PROVIDER.ANTHROPIC, B_DIR, observed.OUTCOME.OK, now - 1000);
  const b = claudeObservationsFor(known)(B_DIR);
  assert.equal(b.obs.outcome, observed.OUTCOME.OK);
  assert.ok(b.obs === b.checkObs, 'the badge could no longer tell a Check now from an agent\'s request');
  observed.saw(observed.PROVIDER.ANTHROPIC, 'sibling', observed.OUTCOME.REJECTED, now);
  const b2 = claudeObservationsFor(known)(B_DIR);
  assert.ok(b2.obs !== b2.checkObs && b2.obs.outcome === observed.OUTCOME.REJECTED, 'CONTROL: a newer agent request decides');
});

test('the stuck card, fed this join, says what the badge says: a sibling\'s 401 is "signed out"', async () => {
  const known = accounts.list();
  stallsignin.setDepsForTests({ list: () => known, checkRow: (row) => ({ ...row, connection: { state: STATE.CONNECTED } }) });
  const stall = { since: new Date(Date.now() - 40 * 60000).toISOString(), count: 4, lastWhy: 'unconfirmed', words: 'x', next: 'y' };
  // A real card from test-support/fleet (fixture discipline), with the fields this slice reads.
  const fleet = require('./test-support/fleet');
  const board = fleet.install([fleet.agent('stuck', { state: 'idle' })]);
  let real;
  try { real = { ...board.agents[0] }; } finally { board.restore(); }
  const card = { ...real, runner: '', account: { dir: B_DIR, isDefault: false }, deliveryStall: stall };
  stallsignin.overlay(card);
  await new Promise((r) => setImmediate(r));
  observed.saw(observed.PROVIDER.ANTHROPIC, 'sibling', observed.OUTCOME.REJECTED, Date.now());
  const obsFor = claudeObservationsFor(known);
  assert.equal(stallsignin.overlay(card, Date.now(), { obsFor }).deliveryStall.words, 'Its Claude account is signed out');
  observed._clearForTest();
  assert.equal(stallsignin.overlay(card, Date.now(), { obsFor: claudeObservationsFor(known) }).deliveryStall.words, 'x', 'CONTROL: no evidence, a connected check, slice 2\'s words');
});
