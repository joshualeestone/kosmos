'use strict';

// ⚠️ SANDBOX BEFORE REQUIRING, because these modules resolve their roots at load.
// This file's own first draft set the environment per test, AFTER the requires,
// and every adoption was refused with "Kosmos already looks after an agent by
// that name" -- the launch directory had been resolved once, to the real one.
// Same warning create.test.js opens with, learned again the hard way.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'pete-adoptroot-'));
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
process.env.AGENT_WORKFORCE_HOME = path.join(SANDBOX, 'home');
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'support');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'claude');
for (const d of ['workers', 'LaunchAgents', 'home/.codex', 'support', 'bin']) {
  fs.mkdirSync(path.join(SANDBOX, d), { recursive: true });
}
fs.writeFileSync(path.join(SANDBOX, 'bin', 'claude'), '#!/bin/sh\nexit 0\n');
fs.chmodSync(path.join(SANDBOX, 'bin', 'claude'), 0o755);

const discover = require('./discover');
const create = require('./create');
const status = require('./status');

/**
 * 🛑 REFUSE TO RUN IF THE SANDBOX DID NOT TAKE. This file writes launchd jobs and
 * worker folders, and `create.js` resolves `AGENTS_DIR` AT MODULE LOAD:
 *
 *     const AGENTS_DIR = process.env.AGENT_WORKFORCE_LAUNCH || <real LaunchAgents>
 *
 * In a multi-file `node --test` run the files share a process, so whichever file
 * requires `create.js` FIRST decides that constant. This file sets its
 * environment before its own requires - and that is not enough, because an
 * earlier file may already have loaded the module against the real paths.
 *
 * ⚠️ MEASURED, NOT HYPOTHETICAL: running the full suite put four real plists into
 * the operator's `~/Library/LaunchAgents` -- com.kosmos.agent.scoutboth,
 * .scoutclaude, .scoutcodex, .scoutsetup -- named for the fixtures below and
 * pointing at temp directories that no longer exist. They were never loaded, so
 * nothing ran, and that was luck rather than design.
 *
 * ⇒ SILENT POLLUTION BECOMES A LOUD FAILURE HERE. A test that cannot isolate
 * itself must not run at all, and it must say why rather than skipping quietly.
 */
const resolvedJobPath = create.plistPath('sandboxprobe');
if (!resolvedJobPath.startsWith(SANDBOX)) {
  throw new Error(
    'discover.adopt.test.js refuses to run: engine/create.js was loaded before this '
    + `file's sandbox was set, so it would write to ${resolvedJobPath} on the real `
    + 'machine. Run this file on its own, or set AGENT_WORKFORCE_LAUNCH before the '
    + 'first require of engine/create.js in the process.',
  );
}

test.beforeEach(() => {
  status.setPaneSource(() => '');
  create.setRunner(() => ({ ok: true, stdout: '' }));
  create.setDryRun(false);
  fs.writeFileSync(path.join(SANDBOX, 'home/.codex/version.json'),
    JSON.stringify({ latest_version: '0.150.1', dismissed_version: null }));
});
test.afterEach(() => { create.setRunner(null); status.setPaneSource(null); });

const agentFolder = (name, file, text) => {
  const d = path.join(SANDBOX, 'workers', name);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, file), text);
  return d;
};
const plistOf = (name) =>
  fs.readFileSync(path.join(SANDBOX, 'LaunchAgents', `com.kosmos.agent.${name}.plist`), 'utf8');
const codexState = () => ({
  version: JSON.parse(fs.readFileSync(path.join(SANDBOX, 'home/.codex/version.json'), 'utf8')),
  toml: (() => { try { return fs.readFileSync(path.join(SANDBOX, 'home/.codex/config.toml'), 'utf8'); } catch { return ''; } })(),
});

test('#1159: a discovered Codex agent can be ADOPTED, and gets a codex job', () => {
  const dir = agentFolder('scoutcodex', 'AGENTS.md', '# You are Scout Codex\n');
  const r = discover.connect(dir);
  assert.equal(r.ok, true, `a Codex agent was refused: ${r.because}`);
  const p = plistOf('scoutcodex');
  assert.match(p, /<string>codex<\/string>/, 'the adopted agent was written as a Claude job');
  assert.match(p, /codex<\/string>/, 'the job does not point at the codex binary');
});

test('#1159 CONTROL: a Claude agent is still adopted as Claude', () => {
  /* Without this the assertion above is satisfied by a change that makes
     EVERYTHING a codex job, which would be a far worse bug. */
  const dir = agentFolder('scoutclaude', 'CLAUDE.md', '# You are Scout Claude\n');
  const r = discover.connect(dir);
  assert.equal(r.ok, true, r.because);
  const p = plistOf('scoutclaude');
  assert.doesNotMatch(p, /<string>codex<\/string>/, 'a Claude agent was adopted as a Codex one');
});

test('#1159: CLAUDE.md wins when a folder has both', () => {
  /* A person with both has a Claude agent that also carries codex notes.
     Starting the runner named after this product is the safer read. */
  const dir = agentFolder('scoutboth', 'CLAUDE.md', '# You are Scout Both\n');
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# You are Scout Both\n');
  const r = discover.connect(dir);
  assert.equal(r.ok, true, r.because);
  assert.doesNotMatch(plistOf('scoutboth'), /<string>codex<\/string>/);
});

test('#1159: an adopted Codex agent gets the same first-run setup as a created one', () => {
  /* 🛑 Otherwise it meets a trust prompt and an update prompt that nothing will
     answer, and the board reads both panes as `unknown` (#1315). */
  const dir = agentFolder('scoutsetup', 'AGENTS.md', '# You are Scout Setup\n');
  discover.connect(dir);
  const v = codexState().version;
  assert.equal(v.dismissed_version, '0.150.1', 'the adopted agent will stop at the update prompt');
  assert.match(codexState().toml, /trust_level = "trusted"/,
    'the adopted agent will stop at the trust prompt');
});

test('#1159: a folder with NEITHER file is still refused', () => {
  /* The refusal is real and must survive: an empty folder is not an agent. */
  const dir = path.join(SANDBOX, 'workers', 'nothinghere');
  fs.mkdirSync(dir, { recursive: true });
  const r = discover.connect(dir);
  assert.equal(r.ok, false);
  assert.match(r.because, /no instructions in it/);
});

test('#1159: a Codex agent is adopted on a machine with NO Claude installed', () => {
  /* 🛑 THIS IS JOSH'S 2x2 CELL, "OpenAI + pre-existing agents", on the machine
     that cell describes: somebody who runs Codex and has never installed Claude.

     `installJob` checked `claudeBin` unconditionally, so adopting a Codex agent
     was refused there with a message about a program that agent does not use.

     ⚠️ AND THE REST OF THIS FILE CANNOT SEE IT, which is why this test exists
     separately: the shared sandbox ships a working `claude` stub, so a
     perturbation reverting the binary check to `claudeBin` stayed GREEN. Found
     by perturbation, and the fix was a test that removes the stub. */
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'no-claude-here');
  try {
    const dir = agentFolder('scoutnoclaude', 'AGENTS.md', '# You are Scout NoClaude\n');
    const r = discover.connect(dir);
    assert.equal(r.ok, true,
      `a Codex agent was refused on a machine with no Claude: ${r.because}`);
    assert.match(plistOf('scoutnoclaude'), /<string>codex<\/string>/);
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev; }
});

test('#1159 CONTROL: a CLAUDE agent is still refused when Claude is missing', () => {
  /* The claude check must survive for the runner that needs it, or the fix above
     has simply removed a real guard. */
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'bin', 'no-claude-here');
  try {
    const dir = agentFolder('scoutneedsclaude', 'CLAUDE.md', '# You are Scout NeedsClaude\n');
    const r = discover.connect(dir);
    assert.equal(r.ok, false, 'a Claude agent was adopted with no Claude on the machine');
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev; }
});

test('#1159: adoption records the PROVIDER, not only the job', () => {
  /* 🛑 #1347 made adoption write a codex JOB and left the profile silent.
     `server.js` derives a card's runner from `profile.provider` whenever the
     pane is not the source, so a stopped adopted Codex agent read as `claude`.

     ⚠️ NOT COSMETIC. `chat.js` pauses before Enter only for a codex card (#571),
     because codex swallows an Enter that rides the paste burst. A codex agent
     labelled claude gets a message that sits in its composer unsent -- which
     looks exactly like an agent ignoring you. */
  const store = require('./store');
  const dir = agentFolder('provcodex', 'AGENTS.md', '# You are Prov Codex\n');
  assert.equal(discover.connect(dir).ok, true);
  assert.equal((store.readProfile('provcodex') || {}).provider, 'openai',
    'the board will call this adopted Codex agent a Claude one');
});

test('#1159 CONTROL: adopting a Claude agent does NOT stamp a provider', () => {
  /* Without this, the assertion above is satisfied by stamping openai on
     everything, which would mislabel every adopted Claude agent. An absent
     provider is what "claude" has always meant here, and #1332's own comment
     says an absent key must keep meaning what it already means. */
  const store = require('./store');
  const dir = agentFolder('provclaude', 'CLAUDE.md', '# You are Prov Claude\n');
  assert.equal(discover.connect(dir).ok, true);
  assert.equal((store.readProfile('provclaude') || {}).provider, undefined,
    'an adopted Claude agent was stamped with a provider it does not have');
});
