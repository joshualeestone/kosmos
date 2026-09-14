'use strict';

/**
 * #2225: the agent-detail "runs on" parenthetical showed the path slug (`label`)
 * for a named OpenAI account, not the human-chosen name the pickers and the
 * Settings row have shown since #2095. The name lives in the `.kosmos-name`
 * sidecar (`engine/openaiaccounts.readName`), but the board's per-agent
 * `a.account` -- built by `accountForAgent` -- did not carry it, so the display
 * had nothing to lead with.
 *
 * The fix is one field on the record: `accountForAgent` now reads the sidecar
 * off the launch dir and returns `name`. Because the display reads the BOARD's
 * `a.account` (openDetail's `a` is the poll's agent object, rendered
 * synchronously), the name is present at render time with no cross-module lookup
 * and no cold-open timing hole -- which is why the clean fix is here and not a
 * client-side ACCOUNTS-by-dir lookup (Mona Lisa's investigation on #2225).
 *
 * These pin `accountForAgent` DIRECTLY (it is exported for this), driving a real
 * launch job + sidecar so each control can return the dangerous answer: a named
 * codex account whose name is dropped, and an unnamed one whose `name` is null.
 * The last test is the parity control -- the whoami route hand-picks fields off
 * this same record and deliberately drops `name`, so its shape must not change.
 *
 *   node --test server.runson-name-2225.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-runson-2225-'));
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
const openaiAccounts = require('./engine/openaiaccounts');
const fleet = require('./test-support/fleet');

/* The DEFAULT Claude account, so accounts.list() is never empty. */
fs.writeFileSync(nodePath.join(HOME, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'boss@example.com' } }));
fs.mkdirSync(nodePath.join(HOME, '.claude', 'projects'), { recursive: true });

/* A labelled CLAUDE account, so `accountForAgent` can hit its FOUND branch (dir
   matched in `known`). Claude accounts do not carry a chosen name in practice,
   but writing a sidecar here proves the found branch reads it too -- both
   branches carry `name`, so the field cannot silently exist on only one. */
const LEAD_DIR = nodePath.join(HOME, '.claude-lead');
fs.mkdirSync(nodePath.join(LEAD_DIR, 'projects'), { recursive: true });
fs.writeFileSync(nodePath.join(LEAD_DIR, '.claude.json'),
  JSON.stringify({ oauthAccount: { emailAddress: 'lead@example.com' } }));
openaiAccounts.writeName(LEAD_DIR, 'Lead Squad');

/* Two OpenAI/codex accounts (CODEX_HOME dirs, never in the Claude `known` list,
   so `accountForAgent` hits its FALLBACK branch for them -- the card's exact
   case). One is named, one is not. */
const CODEX_NAMED_DIR = nodePath.join(HOME, '.codex-design');
const CODEX_PLAIN_DIR = nodePath.join(HOME, '.codex-plain');
for (const d of [CODEX_NAMED_DIR, CODEX_PLAIN_DIR]) fs.mkdirSync(d, { recursive: true });
openaiAccounts.writeName(CODEX_NAMED_DIR, 'Design Team');
// CODEX_PLAIN_DIR deliberately gets NO sidecar.

function bornClaude(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'claude'), 'utf8');
  return name;
}
function bornCodex(name, configDir) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, configDir, 'codex'), 'utf8');
  return name;
}
bornClaude('leadagent', LEAD_DIR);
bornCodex('codexnamed', CODEX_NAMED_DIR);
bornCodex('codexplain', CODEX_PLAIN_DIR);

const { accountForAgent, whoamiFor } = require('./server');

test.after(() => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ } });

test('#2225 CONTROL: the fixtures really exist, or nothing below means anything', () => {
  const dirs = accounts.list().map((a) => a.dir);
  assert.ok(dirs.some((d) => d.indexOf('.claude-lead') !== -1),
    'the labelled Claude account is not listed: ' + JSON.stringify(dirs));
  // The codex dirs must NOT be in the Claude list, or the "fallback branch" claim is false.
  assert.ok(!dirs.some((d) => d.indexOf('.codex-') !== -1),
    'a codex dir leaked into the Claude accounts list: ' + JSON.stringify(dirs));
  assert.equal(openaiAccounts.readName(CODEX_NAMED_DIR), 'Design Team', 'the named sidecar did not write');
  assert.equal(openaiAccounts.readName(CODEX_PLAIN_DIR), null, 'the plain dir should have no sidecar');
});

test('#2225: a named OpenAI account carries its chosen name (fallback branch, the card case)', () => {
  const known = accounts.list();
  const rec = accountForAgent('codexnamed', known);
  assert.ok(rec, 'no record for the codex agent');
  assert.equal(rec.dir, CODEX_NAMED_DIR, 'wrong dir resolved: ' + JSON.stringify(rec));
  assert.equal(rec.name, 'Design Team', 'the chosen name is not on the record: ' + JSON.stringify(rec));
});

test('#2225: an UNNAMED account has name null (the sidecar read can return null -- not a vacuous pass)', () => {
  const known = accounts.list();
  const rec = accountForAgent('codexplain', known);
  assert.ok(rec, 'no record for the unnamed codex agent');
  assert.equal(rec.dir, CODEX_PLAIN_DIR, 'wrong dir resolved: ' + JSON.stringify(rec));
  assert.equal(rec.name, null, 'an account with no sidecar should carry name null: ' + JSON.stringify(rec));
});

test('#2225: the FOUND branch reads the sidecar too, so the field is on both branches', () => {
  const known = accounts.list();
  const rec = accountForAgent('leadagent', known);
  assert.ok(rec, 'no record for the labelled Claude agent');
  assert.equal(rec.dir, LEAD_DIR, 'wrong dir resolved: ' + JSON.stringify(rec));
  assert.equal(rec.email, 'lead@example.com', 'the found branch dropped the email: ' + JSON.stringify(rec));
  assert.equal(rec.name, 'Lead Squad', 'the found branch did not read the sidecar: ' + JSON.stringify(rec));
});

test('#2225 PARITY CONTROL: the whoami RECORD path exposes name (the live branches are pinned elsewhere)', () => {
  /* A REAL card from test-support/fleet (the fixture-discipline test refuses a
     hand-built one). The fleet agent `codexnamed` gives a card whose sessionName
     is `codexnamed`, which resolves to the codex job + sidecar `bornCodex` wrote
     above -- so whoamiFor's RECORD path runs `accountForAgent` on the very
     account that DOES carry `name`. */
  let board;
  try {
    board = fleet.install([fleet.agent('codexnamed', { state: 'idle' })]);
    const card = board.agents.find((a) => a && a.name === 'codexnamed');
    assert.ok(card && card.sessionName, 'the fixture produced no card, so nothing below is about an agent');
    // Force the record path: live not ok -> whoamiFor falls to accountForAgent.
    const out = whoamiFor(card, accounts.list(), { ok: false, because: 'no pane on this computer' });
    assert.ok(out.account, 'the record path returned no account for the named codex agent');
    assert.equal(out.account.dir, CODEX_NAMED_DIR, 'wrong account resolved via whoami: ' + JSON.stringify(out.account));
    /* 🔑 THIS CONTROL WAS WRITTEN INVERTED, AND IT TOLD ITS OWN SUCCESSOR WHAT TO
       DO. It used to assert `!('name' in out.account)` under the note: "the board
       carries `name`; this route deliberately drops it. If a future change wants
       the whoami sentence to show the name, it must add `name` to ALL of this
       route's account branches (parity), not just this one -- and this control is
       where that intent is stated."
       #2811 IS THAT CHANGE. A NAMED codex account was being told "an account we
       cannot identify (<dir>)" by `kosmos whoami` while every other surface called
       it by name -- the card's own literal complaint. The name now leads the
       sentence's fallback chain, so the route must carry it.
       ⚠️ AND THE CONDITION THAT CONTROL SET IS THE ONE THAT MATTERED: my first
       attempt added `name` to ONE live branch and `#1304`'s field-set parity test
       went red immediately. All THREE constructions carry it now (both live
       branches and the record projection), which is what makes flipping this
       assertion legitimate rather than convenient.
       ⇒ So this stays a PARITY control; only the direction changed.
       🛑 AND THE TITLE NAMES THE BRANCH THIS BODY ACTUALLY DRIVES. My first flip
       called it "EVERY account branch, or none" while the body exercises only the
       RECORD path (`{ ok: false, … }`). Round 35 measured the consequence: deleting
       `name` from the `seen.account` live branch left the whole suite GREEN, because
       `#1304`'s sibling parity builds its live answer as `{ ok: true, account: null }`
       -- the OTHER live branch. A title claiming a scope its body does not drive is
       the same defect this card has been finding in comments all week, in a test
       name. The live branches are pinned by `#1304` (configDir branch) and by
       `#2811 PARITY: the live branch that HAS an account` (the account branch). */
    assert.ok('name' in out.account,
      'the whoami route dropped `name`, so a NAMED codex account is told we cannot identify it: ' + JSON.stringify(out.account));
    assert.equal(out.account.name, 'Design Team',
      'the route carries a `name` key but not the sidecar the person typed: ' + JSON.stringify(out.account));
  } finally {
    fleet.restore();
  }
});
