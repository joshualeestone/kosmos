'use strict';

/**
 * #5091 (Josh, 2026-10-02 22:10, on Mortals): a switch TO Claude can be told WHICH Claude account. Before, the switch
 * carried no account ("claude carries no account") and always landed on the main one, so a person with four Claude
 * accounts had no list to pick from.
 *
 * 🛑 THE LAUNCH JOB IS THE ASSERTION, as in #1373: CLAUDE_CONFIG_DIR in the plist is what decides which account the
 * agent starts on; the return value only says what the engine believes.
 * ⚠️ The refusals must change NOTHING: the agent stays on its old runner, because a refused pick that still switched
 * would land it on an account nobody chose.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'switch-claude-5091-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'), nodePath.join(SANDBOX, 'launch')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;
delete process.env.CLAUDE_CONFIG_DIR;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
const BINS = { claudeBin: CLAUDE_BIN, codexBin: CODEX_BIN, tmuxBin: TMUX_BIN };

/* The main account (~/.claude beside ~/.claude.json), one account sharing the agents' history (its projects is a link to
   the main one), and one keeping its own (a real projects folder). */
fs.writeFileSync(nodePath.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'main@example.com' } }));
const SHARED_PROJECTS = nodePath.join(HOME, '.claude', 'projects');
fs.mkdirSync(SHARED_PROJECTS, { recursive: true });
function claudeAccount(label, email, shared) {
  const dir = nodePath.join(HOME, `.claude-${label}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: email } }));
  if (shared) fs.symlinkSync(SHARED_PROJECTS, nodePath.join(dir, 'projects'));
  else fs.mkdirSync(nodePath.join(dir, 'projects'), { recursive: true });
  return dir;
}
const ARIA = claudeAccount('aria', 'aria@example.com', true);
const SOLO = claudeAccount('solo', 'solo@example.com', false);

const create = require('./create');
const store = require('./store');
const accounts = require('./accounts');

const plistText = (name) => fs.readFileSync(create.plistPath(name), 'utf8');
const configDirOf = (name) => { const m = plistText(name).match(/<key>CLAUDE_CONFIG_DIR<\/key>\s*<string>([\s\S]*?)<\/string>/); return m ? m[1] : null; };

/* Seeded directly on Codex (the job and the profile, all setProvider reads), as #1373's suite does: createAgent would
   call the real launchctl. */
function bornOnCodex(name) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name), create.plistFor(name, CODEX_BIN, TMUX_BIN, null, null, 'codex'), 'utf8');
  store.writeProfile(name, { provider: 'openai' });
  assert.ok(plistText(name).includes(CODEX_BIN), 'the seed must start on Codex, or "nothing changed" proves nothing');
  return name;
}

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#5091 fixture: three Claude accounts, one sharing the agents\' history and one not', () => {
  const rows = accounts.list();
  const by = (d) => rows.find((a) => a.dir === d);
  assert.ok(rows.find((a) => a.isDefault), JSON.stringify(rows.map((a) => a.dir)));
  assert.equal(by(ARIA) && by(ARIA).memoryShared, true, 'ARIA must share history, or the move arm tests a refusal');
  assert.equal(by(SOLO) && by(SOLO).memoryShared, false, 'SOLO must keep its own, or the refusal arm tests a move');
});

test('#5091: a switch to Claude with no account named lands on the main account, as before', () => {
  const a = bornOnCodex('sw5091-default');
  const r = create.setProvider(a, 'anthropic', { ...BINS });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(configDirOf(a), null, 'no account was named, so the job must not pin one');
  assert.equal(r.account, null);
  assert.ok(plistText(a).includes(CLAUDE_BIN), 'the switch did not reach the launch job');
});

test('#5091: the Claude account the person picked is the one the agent starts on', () => {
  const b = bornOnCodex('sw5091-picked');
  const r = create.setProvider(b, 'anthropic', { ...BINS, accountDir: ARIA, pickedByPerson: true });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(configDirOf(b), ARIA, 'the picked Claude account never reached CLAUDE_CONFIG_DIR');
  assert.equal(r.account && r.account.dir, ARIA);
  assert.equal(r.account.chosen, true);
  assert.equal(r.account.email, 'aria@example.com');
  assert.ok(plistText(b).includes(CLAUDE_BIN));
});

test('#5091: picking the main account is the main account (no pin)', () => {
  const main = accounts.list().find((a) => a.isDefault);
  const c = bornOnCodex('sw5091-main');
  const r = create.setProvider(c, 'anthropic', { ...BINS, accountDir: main.dir, pickedByPerson: true });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(configDirOf(c), null);
});

test('#5091: an account with its own history, or one this computer does not know, refuses and changes NOTHING', () => {
  const d = bornOnCodex('sw5091-solo');
  const before = plistText(d);
  const r = create.setProvider(d, 'anthropic', { ...BINS, accountDir: SOLO, pickedByPerson: true });
  assert.equal(r.outcome, create.OUTCOME.REFUSED);
  assert.match(r.because, /keeps its own separate history/);
  assert.equal(plistText(d), before, 'a refused pick still rewrote the launch job');
  assert.equal(store.readProfile(d).provider, 'openai', 'a refused pick still switched the provider');

  const e = bornOnCodex('sw5091-ghost');
  const before2 = plistText(e);
  const r2 = create.setProvider(e, 'anthropic', { ...BINS, accountDir: nodePath.join(HOME, '.claude-gone'), pickedByPerson: true });
  assert.equal(r2.outcome, create.OUTCOME.REFUSED);
  assert.equal(plistText(e), before2);
});

test('#5091 round 1: the pick goes through setAccount, so the picked account gets its own trust record (#1629)', () => {
  const f = bornOnCodex('sw5091-trust');
  const r = create.setProvider(f, 'anthropic', { ...BINS, accountDir: ARIA, pickedByPerson: true });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  const cfg = JSON.parse(fs.readFileSync(nodePath.join(ARIA, '.claude.json'), 'utf8'));
  const trusted = Object.values(cfg.projects || {}).some((p) => p && p.hasTrustDialogAccepted === true);
  assert.ok(trusted, 'the picked Claude account has no trust record for the worker folder, so the agent would stop on the trust prompt');
});

test('#5091 round 1: picking the main account is named back as a pick, with no pin', () => {
  const main = accounts.list().find((a) => a.isDefault);
  const g = bornOnCodex('sw5091-main-named');
  const r = create.setProvider(g, 'anthropic', { ...BINS, accountDir: main.dir, pickedByPerson: true });
  assert.equal(r.outcome, create.OUTCOME.CREATED, r.because);
  assert.equal(configDirOf(g), null);
  assert.equal(r.account && r.account.isDefault, true);
  assert.equal(r.account.chosen, true);
});

test('#5091 round 1: an account that is gone by the time it is applied is a PARTIAL that says so, never a silent main', () => {
  const h = bornOnCodex('sw5091-partial');
  const real = accounts.list;
  let calls = 0;
  accounts.list = () => { calls += 1; const rows = real(); return calls === 1 ? rows : rows.filter((a) => a.dir !== ARIA); };
  let r;
  try { r = create.setProvider(h, 'anthropic', { ...BINS, accountDir: ARIA, pickedByPerson: true }); }
  finally { accounts.list = real; }
  assert.ok(calls >= 2, 'the seam was not reached twice, so this arm does not test the apply step');
  assert.equal(r.outcome, create.OUTCOME.PARTIAL);
  assert.match(r.because, /is switched to Claude, on your main Claude account: it could not be moved to aria@example\.com/);
  assert.doesNotMatch(r.because, /\.\)\.$/, 'a doubled full stop');
  assert.equal(configDirOf(h), null, 'a partial must leave it on the main account, not half-pinned');
  assert.equal(store.readProfile(h).provider, 'anthropic');
});
