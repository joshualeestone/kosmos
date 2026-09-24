'use strict';

/*
 * kosmos#3296 observability follow-on -- snapshot() records the last observed real Gemini
 * turn completion as a GOOGLE observation, so the account badge can positively confirm a
 * working gemini sign-in that checkLive can only ever leave grey. The exact sibling of the
 * #2413 codex/OpenAI arm (engine/status.codex-observed-2413.test.js), and it pins the same
 * two guarantees:
 *
 *   1. The observation is PROVIDER-QUALIFIED (PROVIDER.GOOGLE), never ANTHROPIC/OPENAI. A
 *      gemini pane scrapes WORKING the same way a claude one does; without the provider tag
 *      (and the `!isGeminiPane` guard on the ANTHROPIC arm) its `ok` would green an unrelated
 *      account.
 *
 *   2. The `ok` is recorded from a WITNESSED SESSION COMPLETION (`sess.contextUsedAt`, set
 *      from the newest token-reporting gemini turn), NOT from pane WORKING -- a dead-credential
 *      reconnect scrapes as WORKING too. A stale completion greys again on its own.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gemini-observed-3296-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_GEMINI_HOME = path.join(SANDBOX, 'gemini-home');
// #3011: keep fleet.install's plist writes out of the operator's real ~/Library/LaunchAgents.
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'LaunchAgents');
for (const d of [process.env.AGENT_WORKFORCE_DATA, process.env.AGENT_WORKFORCE_WORKERS,
  process.env.AGENT_WORKFORCE_GEMINI_HOME, process.env.AGENT_WORKFORCE_LAUNCH]) fs.mkdirSync(d, { recursive: true });

const test = require('node:test');
const assert = require('node:assert/strict');
const fleet = require('../test-support/fleet');
const status = require('./status');
const create = require('./create');
const observed = require('./observed');
const subscription = require('./subscription');

// Belt-and-braces: our panes are gemini + working, so the claude authprobe never fires,
// but neutralise its real subprocess anyway (mirrors the codex-observed test).
subscription.setRunner(async () => ({ stdout: JSON.stringify({ loggedIn: false }), err: null }));

test.beforeEach(() => observed._clearForTest());
test.after(() => {
  fleet.restore();
  subscription.setRunner(null);
  observed._clearForTest();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

/* Write a gemini session for `name`'s launch folder whose newest token-reporting turn (the
   one geminisession.read derives contextUsedAt from) completed at `completedAt` (epoch ms).
   projects.json maps the REALPATH'd workerDir to a slug, and the session lives under
   <GEMINI_HOME>/tmp/<slug>/chats -- the exact layout geminisession.read expects (matched
   against geminisession.runner-3296.test.js). A default-account gemini plist (null configDir)
   is written so readJob resolves runner 'gemini' and geminiStorageHome(null) == GEMINI_HOME. */
function writeGeminiSession(name, completedAt) {
  const wd = create.workerDir(name);
  assert.ok(wd, 'workerDir refused the name ' + name);
  fs.mkdirSync(wd, { recursive: true });
  const wdKey = fs.realpathSync(wd);   // #2417 fold: projects.json key must match the canonical read
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.writeFileSync(
    create.plistPath(name),
    create.plistFor(name, path.join(SANDBOX, 'claude'), path.join(SANDBOX, 'tmux'), null, null, 'gemini'),
    'utf8',
  );
  const home = process.env.AGENT_WORKFORCE_GEMINI_HOME;
  const slug = 'slug-' + name;
  fs.writeFileSync(path.join(home, 'projects.json'), JSON.stringify({ projects: { [wdKey]: slug } }));
  const ts = new Date(completedAt).toISOString();
  const rows = [
    { sessionId: 'sid-' + name, projectHash: 'ph-' + name, startTime: ts, lastUpdated: ts, kind: 'main' },
    { $set: { messages: [{ id: 'm1', timestamp: ts, type: 'user', content: [{ text: '<session_context>\nseed' }] }], lastUpdated: ts } },
    { id: 'u1', timestamp: ts, type: 'user', content: [{ text: 'Reply with exactly: OK' }] },
    { $set: { lastUpdated: ts } },
    { id: 'g1', timestamp: ts, type: 'gemini', content: 'OK',
      thoughts: [{ subject: 'Respond', description: 'done', timestamp: ts }],
      tokens: { input: 6937, output: 5, cached: 0, thoughts: 29, tool: 0, total: 6971 },
      model: 'gemini-2.5-flash' },
    { $set: { lastUpdated: ts } },
  ];
  const chats = path.join(home, 'tmp', slug, 'chats');
  fs.mkdirSync(chats, { recursive: true });
  fs.writeFileSync(path.join(chats, 'session-2026-09-22T02-37-' + name.slice(0, 8) + '.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return wd;
}

test('geminiLastCompletionAt returns the completion timestamp, and null when a folder has no completed turn', () => {
  const at = Date.now() - 30 * 1000;
  writeGeminiSession('geminiresolve', at);
  const got = status.geminiLastCompletionAt('geminiresolve');
  assert.equal(got, at,
    'the completion timestamp did not resolve through create.workerDir -> geminisession.read (got ' + got + ')');
  assert.equal(status.geminiLastCompletionAt('gemininever'), null);
});

test('a gemini WORKING pane with a FRESH session completion records a GOOGLE ok (never a Claude/OpenAI one)', () => {
  writeGeminiSession('geminiok', Date.now() - 30 * 1000); // 30s ago: inside the 5-min freshness window
  const board = fleet.install([fleet.agent('geminiok', { runner: 'gemini', state: 'working' })]);
  assert.equal(board.card('geminiok').state, 'working', 'fixture is not WORKING, so the assertion is vacuous');
  assert.equal((observed.read(observed.PROVIDER.GOOGLE, 'geminiok') || {}).outcome, observed.OUTCOME.OK,
    'a working gemini agent with a fresh witnessed completion did not record a GOOGLE ok: ' + JSON.stringify(observed.all()));
  assert.equal(observed.read(observed.PROVIDER.ANTHROPIC, 'geminiok'), null,
    'the gemini ok leaked onto ANTHROPIC -- the cross-provider false-green the !isGeminiPane guard removes');
  assert.equal(observed.read(observed.PROVIDER.OPENAI, 'geminiok'), null,
    'the gemini ok leaked onto OPENAI');
  const rec = observed.read(observed.PROVIDER.GOOGLE, 'geminiok');
  assert.ok(rec.at <= Date.now() && Date.now() - rec.at < 5 * 60 * 1000, 'stamped outside the fresh window');
});

test('recording is DECOUPLED from the scraped state: a NON-WORKING gemini pane with a fresh completion still records a GOOGLE ok', () => {
  writeGeminiSession('geminiidle', Date.now() - 30 * 1000);
  const board = fleet.install([fleet.agent('geminiidle', { runner: 'gemini', state: 'unknown' })]);
  assert.notEqual(board.card('geminiidle').state, 'working', 'fixture is WORKING, so the decoupling assertion is vacuous');
  assert.equal((observed.read(observed.PROVIDER.GOOGLE, 'geminiidle') || {}).outcome, observed.OUTCOME.OK,
    'a non-working gemini pane with a fresh witnessed completion did not record a GOOGLE ok -- recording is wrongly coupled to the WORKING scrape: ' + JSON.stringify(observed.all()));
});

test('a gemini WORKING pane with a STALE session completion records NOTHING (self-heals, no permanent green)', () => {
  writeGeminiSession('geministale', Date.now() - 10 * 60 * 1000); // 10 min ago: past the 5-min window
  const board = fleet.install([fleet.agent('geministale', { runner: 'gemini', state: 'working' })]);
  assert.equal(board.card('geministale').state, 'working', 'fixture is not WORKING, so the assertion is vacuous');
  assert.equal(observed.read(observed.PROVIDER.GOOGLE, 'geministale'), null,
    'a stale completion kept greening the sign-in -- the permanent green over a possibly-dead credential this arm avoids: ' + JSON.stringify(observed.all()));
});
