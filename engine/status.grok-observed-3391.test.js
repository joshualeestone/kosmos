'use strict';

/*
 * kosmos#3391 observability follow-on -- snapshot() records the last observed real Grok turn
 * completion as an XAI observation, so the account badge can positively confirm a working grok
 * sign-in that checkLive can only ever leave grey. The exact sibling of the #2413 codex arm and
 * the #3296 gemini arm; it pins the same two guarantees:
 *
 *   1. The observation is PROVIDER-QUALIFIED (PROVIDER.XAI), never ANTHROPIC/OPENAI/GOOGLE.
 *   2. The `ok` is recorded from a WITNESSED SESSION COMPLETION (`sess.contextUsedAt`, which
 *      groksession.read anchors on signals.json's mtime -- written once per completed turn),
 *      NOT from pane WORKING. A stale completion greys again on its own.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-grok-observed-3391-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_GROK_HOME = path.join(SANDBOX, 'grok-home');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
for (const d of [process.env.AGENT_WORKFORCE_DATA, process.env.AGENT_WORKFORCE_WORKERS,
  process.env.AGENT_WORKFORCE_GROK_HOME, process.env.AGENT_WORKFORCE_LAUNCH]) fs.mkdirSync(d, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const create = require('./create');
const observed = require('./observed');
const subscription = require('./subscription');

subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));

test.beforeEach(() => observed._clearForTest());
test.after(() => {
  fleet.restore();
  subscription.setRunner(null);
  observed._clearForTest();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* Write a grok session for `name`'s launch folder whose signals.json was last written at
   `completedAt` (epoch ms) -- groksession.read anchors contextUsedAt on that file's MTIME, so
   this fixture sets it via utimesSync. summary.json is SNAKE_CASE (info.cwd matched by
   forWorkdir), signals.json is camelCase (contextTokensUsed/contextWindowTokens). A
   default-account grok plist (null configDir) is written so readGrokSession resolves runner
   'grok' and defaultAgentGrokHome() == GROK_HOME. */
function writeGrokSession(name, completedAt) {
  const wd = create.workerDir(name);
  assert.ok(wd, 'workerDir refused the name ' + name);
  fs.mkdirSync(wd, { recursive: true });
  const wdKey = fs.realpathSync(wd);
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(
    create.plistPath(name),
    create.plistFor(name, path.join(SANDBOX, 'claude'), path.join(SANDBOX, 'tmux'), null, null, 'grok'),
    'utf8',
  );
  const sessDir = path.join(process.env.AGENT_WORKFORCE_GROK_HOME, 'sessions', 'enc-' + name, 'sess-' + name);
  fs.mkdirSync(sessDir, { recursive: true });
  fs.writeFileSync(path.join(sessDir, 'summary.json'), JSON.stringify({
    info: { id: 'sess-' + name, cwd: wdKey },
    model: 'grok-4.6',
    num_messages: 17,
    last_active_at: new Date(completedAt).toISOString(),
    last_turn_summary: 'DONE after echo hi succeeded',
    generated_title: 'a session',
  }));
  const signalsPath = path.join(sessDir, 'signals.json');
  fs.writeFileSync(signalsPath, JSON.stringify({ contextTokensUsed: 41163, contextWindowTokens: 500000 }));
  const secs = completedAt / 1000;
  fs.utimesSync(signalsPath, secs, secs);   // contextUsedAt anchors on this mtime
  return wd;
}

test('grokLastCompletionAt returns the completion timestamp (signals.json mtime), and null when a folder has no session', () => {
  const at = Date.now() - 30 * 1000;
  writeGrokSession('grokresolve', at);
  const got = status.grokLastCompletionAt('grokresolve');
  // mtime resolution can lose sub-ms; assert within a small tolerance rather than exact.
  assert.ok(typeof got === 'number' && Math.abs(got - at) < 2000,
    'the completion timestamp did not resolve through create.workerDir -> groksession.read (got ' + got + ', expected ~' + at + ')');
  assert.equal(status.grokLastCompletionAt('groknever'), null);
});

test('a grok WORKING pane with a FRESH session completion records an XAI ok (never claude/openai/google)', () => {
  writeGrokSession('grokok', Date.now() - 30 * 1000);
  const board = fleet.install([fleet.agent('grokok', { runner: 'grok', command: 'grok-native', state: 'working' })]);
  assert.equal(board.card('grokok').state, 'working', 'fixture is not WORKING, so the assertion is vacuous');
  assert.equal((observed.read(observed.PROVIDER.XAI, 'grokok') || {}).outcome, observed.OUTCOME.OK,
    'a working grok agent with a fresh witnessed completion did not record an XAI ok: ' + JSON.stringify(observed.all()));
  assert.equal(observed.read(observed.PROVIDER.ANTHROPIC, 'grokok'), null,
    'the grok ok leaked onto ANTHROPIC -- the !isGrokPane guard removes this');
  assert.equal(observed.read(observed.PROVIDER.OPENAI, 'grokok'), null, 'the grok ok leaked onto OPENAI');
  assert.equal(observed.read(observed.PROVIDER.GOOGLE, 'grokok'), null, 'the grok ok leaked onto GOOGLE');
  const rec = observed.read(observed.PROVIDER.XAI, 'grokok');
  assert.ok(rec.at <= Date.now() && Date.now() - rec.at < 5 * 60 * 1000, 'stamped outside the fresh window');
});

test('recording is DECOUPLED from the scraped state: a NON-WORKING grok pane with a fresh completion still records an XAI ok', () => {
  writeGrokSession('grokidle', Date.now() - 30 * 1000);
  const board = fleet.install([fleet.agent('grokidle', { runner: 'grok', command: 'grok-native', state: 'unknown' })]);
  assert.notEqual(board.card('grokidle').state, 'working', 'fixture is WORKING, so the decoupling assertion is vacuous');
  assert.equal((observed.read(observed.PROVIDER.XAI, 'grokidle') || {}).outcome, observed.OUTCOME.OK,
    'a non-working grok pane with a fresh witnessed completion did not record an XAI ok -- recording is wrongly coupled to the WORKING scrape: ' + JSON.stringify(observed.all()));
});

test('a grok WORKING pane with a STALE session completion records NOTHING (self-heals, no permanent green)', () => {
  writeGrokSession('grokstale', Date.now() - 10 * 60 * 1000); // 10 min ago: past the 5-min window
  const board = fleet.install([fleet.agent('grokstale', { runner: 'grok', command: 'grok-native', state: 'working' })]);
  assert.equal(board.card('grokstale').state, 'working', 'fixture is not WORKING, so the assertion is vacuous');
  assert.equal(observed.read(observed.PROVIDER.XAI, 'grokstale'), null,
    'a stale completion kept greening the sign-in -- the permanent green over a possibly-dead credential this arm avoids: ' + JSON.stringify(observed.all()));
});
