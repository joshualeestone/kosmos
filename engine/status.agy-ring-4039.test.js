'use strict';

/**
 * #4039: an Antigravity (agy) agent's context ring said "Kosmos cannot read how much of its memory
 * an Antigravity agent has used yet" by design (#3568 left it for later). agysession.read now reads
 * agy's conversation db, and readAgyContext maps it into the standard ring shape. These tests drive
 * the STATUS WIRING: the mapping by injection, then one end-to-end read through the plist, the
 * profile and a synthesized conversation. The on-disk decoding is agysession.test.js's.
 *
 * ⚠️ Sandboxed agy home, launch dir and store, set before the modules load, so nothing reads the
 * operator's real ~/.gemini/antigravity-cli or writes a real LaunchAgent.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SB = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'agyring4039-')));
const AGY_HOME = path.join(SB, '.gemini', 'antigravity-cli');
fs.mkdirSync(AGY_HOME, { recursive: true });
const CONFIG_ROOT = path.join(SB, '.claude');
fs.mkdirSync(path.join(CONFIG_ROOT, 'projects'), { recursive: true });
const STORE = path.join(SB, 'Library', 'Application Support', 'AgentWorkforce');
fs.mkdirSync(STORE, { recursive: true });
process.env.AGENT_WORKFORCE_AGY_HOME = AGY_HOME;
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG_ROOT;
process.env.AGENT_WORKFORCE_HOME = SB;
process.env.AGENT_WORKFORCE_DATA = STORE;
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SB, 'LaunchAgents');
fs.mkdirSync(process.env.AGENT_WORKFORCE_LAUNCH, { recursive: true });
process.on('exit', () => { try { fs.rmSync(SB, { recursive: true, force: true }); } catch { /* best effort */ } });

const store = require('./store');
const status = require('./status');
const create = require('./create');
const { generation, writeConversation } = require('../test-support/agyfixture');

const NAME = 'gemini-sub-4039';
const WORKDIR = path.join(SB, 'work', 'gemini-sub');
fs.mkdirSync(WORKDIR, { recursive: true });

function writePlist(runner) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(create.plistPath(NAME),
    create.plistFor(NAME, path.join(SB, 'claude'), path.join(SB, 'tmux'), null, null, runner), 'utf8');
}

test('#4039: a conversation that DID record a window (a future agy) is measured against it, not assumed', () => {
  const ctx = status.readAgyContext(NAME, { found: true, contextUsed: 14071, contextWindow: 1048576, model: 'gemini-3.8-flash' });
  assert.equal(ctx.tokens, 14071);
  assert.equal(ctx.ceiling, 1048576);
  assert.equal(ctx.ceilingAssumed, false, 'agy states its window in the conversation, so it is not assumed');
  assert.equal(ctx.percent, 1, '14071 / 1048576 rounds to 1 percent');
  assert.equal(ctx.notYet, false);
});

test('#4039: no recorded window falls back to the known model\'s window, assumed; an unknown model stays no-ceiling', () => {
  const known = status.readAgyContext(NAME, { found: true, contextUsed: 900, contextWindow: null, model: 'gemini-3.8-flash' });
  assert.equal(known.ceiling, 1048576);
  assert.equal(known.ceilingAssumed, true, 'not recorded in this conversation, so assumed, and said so');
  const unknown = status.readAgyContext(NAME, { found: true, contextUsed: 900, contextWindow: null, model: 'some-new-model' });
  assert.equal(unknown.noCeiling, true);
  assert.equal(unknown.percent, null, 'never a made-up percent');
  assert.match(unknown.because, /some-new-model/);
});

test('#4039: a conversation with no usage yet is "not yet", and an unreadable one is admitted', () => {
  assert.equal(status.readAgyContext(NAME, { found: true, contextUsed: null, contextWindow: null, model: null }).notYet, true);
  const bad = status.readAgyContext(NAME, { found: false, because: status.NO_READING.UNREADABLE });
  assert.equal(bad.notYet, false);
  assert.equal(bad.because, status.NO_READING.UNREADABLE);
});

test('#4039: end to end, an antigravity agent reads its conversation through the plist and profile', () => {
  writePlist('antigravity');
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  writeConversation(AGY_HOME, WORKDIR, [
    generation({ prompt: 12561, reply: 149, thoughts: 3 }),
    generation({ prompt: 13896, reply: 175, thoughts: 93 }),
  ], { wal: true });
  const ctx = status.readAgyContext(NAME);
  assert.equal(ctx.tokens, 13896, 'workerDir -> last_conversations.json -> the db -> the newest prompt');
  assert.equal(ctx.ceiling, 1048576, 'gemini-3.8-flash\'s published window');
  assert.equal(ctx.ceilingAssumed, true, 'agy records no window, so it is assumed, and marked assumed');
  assert.equal(ctx.percent, 1);
});

test('#4039 control: a non-antigravity agent is not read through the agy arm', () => {
  /* Self-contained: its own conversation on disk, so the gate is what stops the read. */
  store.writeProfile(NAME, { dir: WORKDIR, provider: 'google' });
  writeConversation(AGY_HOME, WORKDIR, [generation({ prompt: 4242, reply: 1 })]);
  writePlist('antigravity');
  assert.equal(status.readAgyContext(NAME).tokens, 4242, 'control: with the agy runner the conversation IS read');
  writePlist('gemini');
  assert.notEqual(status.readAgyContext(NAME).tokens, 4242, 'the runner gate let a gemini agent read an agy conversation');
});

test('#4039: the pane sweep routes an agy pane to readAgyContext and its model to the conversation (SOURCE pin)', () => {
  /* The sweep needs a live pane to drive, which no fixture here provides, so the routing is pinned
     in source: the ring arm, the once-per-tick read, and the model. */
  const src = fs.readFileSync(path.join(__dirname, 'status.js'), 'utf8');
  assert.match(src, /: isAgyPane \? readAgyContext\(pane\.name, agySess\)/, 'an agy pane no longer reaches readAgyContext');
  assert.match(src, /const agySess = \(isNamedOurs\(pane\) && isAgyPane\) \? readAgySession\(pane\.name\) : null;/);
  // #4416: the model is chosen per runner; the agy arm reads its own conversation (sessModel requires found).
  assert.match(src, /: isAgyPane \? \{ model: sessModel\(agySess\) \}/);
  assert.match(src, /const sessModel = \(x\) => \(x && x\.found && typeof x\.model === 'string' && x\.model\) \|\| null;/);
  assert.doesNotMatch(src, /Kosmos cannot read how much of its memory an Antigravity agent has used yet/, 'the old refusal is back');
});
