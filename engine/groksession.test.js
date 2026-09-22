'use strict';

/**
 * Reading a Grok Build session (#3391).
 *
 * 🔑 THE FIXTURE USES THE VERIFIED WIRE SHAPE from the open-source grok-build serde
 * structs (xai-org/grok-build): summary.json is SNAKE_CASE (no rename_all), signals.json
 * is CAMELCASE (#[serde(rename_all="camelCase")]), timestamps are RFC3339. That casing
 * split is the whole point of these fixtures -- a reader that read signals in snake_case
 * would return null on every real file while a snake_case fixture passed, so the fixture
 * MUST match the real wire names. Not yet cross-checked against a live captured session
 * (gated on an xAI key); these tests pin the reader against the authoritative struct shape.
 *
 * ⚠️ A SANDBOXED GROK HOME, set before the module loads, exactly as the codex/gemini
 * reader tests do -- the real ~/.grok holds the operator's own sessions.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.realpathSync.native(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-')));
process.env.AGENT_WORKFORCE_GROK_HOME = SANDBOX;
const grok = require('./groksession');
const { NO_READING } = require('./status');

const WORKDIR = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-wd-')));

/* Write a session under sessions/<encDir>/<sessionId>/ with a real-shaped summary.json
   (snake) + optional signals.json (camel). `encDir` is normally the url-encoded cwd, but
   the reader matches on summary.info.cwd, so the test can use ANY dir name -- which is
   exactly the long-path slug case, exercised by `test('a slug dir name ...')`. */
function writeSession({ encDir, sessionId, cwd, model, numMessages, lastActive, lastTurn, tokensUsed, windowTokens }) {
  const dir = nodePath.join(SANDBOX, 'sessions', encDir, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const summary = {
    info: { id: sessionId, cwd },
    created_at: '2026-09-22T02:00:00.000Z',
    updated_at: lastActive,
    last_active_at: lastActive,
    num_messages: numMessages,
    num_chat_messages: numMessages,
    current_model_id: model,
    chat_format_version: 1,
    generated_title: 'a session',
    last_turn_summary: lastTurn,
  };
  fs.writeFileSync(nodePath.join(dir, 'summary.json'), JSON.stringify(summary));
  if (tokensUsed != null || windowTokens != null) {
    const signals = {
      contextTokensUsed: tokensUsed,
      contextWindowTokens: windowTokens,
      contextWindowUsage: (tokensUsed != null && windowTokens) ? Math.round(tokensUsed / windowTokens * 100) : 0,
      turnCount: 1,
      userMessageCount: 1,
      assistantMessageCount: 1,
      toolCallCount: 0,
      toolsUsed: [],
    };
    fs.writeFileSync(nodePath.join(dir, 'signals.json'), JSON.stringify(signals));
  }
  return dir;
}

function reset() {
  fs.rmSync(nodePath.join(SANDBOX, 'sessions'), { recursive: true, force: true });
}

test('read() returns the codex-shaped contract, with BOTH context halves measured', () => {
  reset();
  writeSession({
    encDir: 'enc-cwd', sessionId: 'sess-abc', cwd: WORKDIR, model: 'grok-4.6',
    numMessages: 4, lastActive: '2026-09-22T02:05:10.000Z', lastTurn: 'did the thing',
    tokensUsed: 12000, windowTokens: 256000,
  });
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, 'sess-abc');
  assert.equal(r.provider, 'xai');
  assert.equal(r.cliVersion, null);
  /* MEASURED both halves, from signals.json's camelCase keys. */
  assert.equal(r.contextUsed, 12000, 'contextTokensUsed');
  assert.equal(r.contextWindow, 256000, 'contextWindowTokens -- measured, not assumed');
  /* contextUsedAt anchors on signals.json's mtime (when usage was written), not
     last_active_at -- so assert it is a real timestamp near the file's mtime rather
     than a fixed value. */
  assert.equal(typeof r.contextUsedAt, 'number', 'usage known -> a numeric measured-at anchor');
  const sigMtime = fs.statSync(nodePath.join(SANDBOX, 'sessions', 'enc-cwd', 'sess-abc', 'signals.json')).mtimeMs;
  assert.equal(r.contextUsedAt, sigMtime, 'contextUsedAt is signals.json mtime');
  assert.equal(r.messages, 4);
  assert.equal(r.lastAt, '2026-09-22T02:05:10.000Z');
  assert.equal(r.lastAgentMessage, 'did the thing');
  assert.equal(r.model, 'grok-4.6');
});

test('the launch folder is matched by summary.info.cwd through the /private canonical twin (#2417)', () => {
  reset();
  writeSession({ encDir: 'enc', sessionId: 's1', cwd: WORKDIR, model: 'grok-4.6', numMessages: 1, lastActive: '2026-09-22T02:05:00.000Z', lastTurn: 'x', tokensUsed: 5, windowTokens: 100 });
  /* Query with the /var raw spelling: canonicalOnDisk folds it to /private/var to match
     the info.cwd Grok stored. macOS-specific (tmpdir under /private/var); on a platform
     where it is not, the replace is a no-op and this degrades to a plain re-check --
     acceptable, and it mirrors the sibling readers' test style. */
  const raw = WORKDIR.replace('/private/var/', '/var/');
  const r = grok.read(raw === WORKDIR ? WORKDIR : raw);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, 's1');
});

test('a SLUG/hash dir name (the long-path case) is still matched, because keying is on info.cwd', () => {
  reset();
  /* When the url-encoded cwd exceeds the dir-name byte cap Grok uses a slug+hash dir and
     records the real path in info.cwd -- the reader keys on info.cwd, so the dir name is
     irrelevant. A dir name that is NOT the encoded cwd proves the match is by info.cwd. */
  writeSession({ encDir: 'slug-9f8a7b6c', sessionId: 's-long', cwd: WORKDIR, model: 'grok-4.6', numMessages: 2, lastActive: '2026-09-22T02:06:00.000Z', lastTurn: 'y', tokensUsed: 9, windowTokens: 200 });
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, 's-long');
});

test('signals.json absent (early first turn) -> both context halves null, still found', () => {
  reset();
  writeSession({ encDir: 'enc', sessionId: 's-noturn', cwd: WORKDIR, model: 'grok-4.6', numMessages: 1, lastActive: '2026-09-22T02:05:00.000Z', lastTurn: null });
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.contextUsed, null);
  assert.equal(r.contextWindow, null);
  assert.equal(r.contextUsedAt, null, 'no usage -> no completion time');
  assert.equal(r.lastAgentMessage, null);
});

test('a workdir with no recorded session reads NO_TRANSCRIPT', () => {
  reset();
  const other = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-grok-none-')));
  writeSession({ encDir: 'enc', sessionId: 's1', cwd: other, model: 'grok-4.6', numMessages: 1, lastActive: '2026-09-22T02:05:00.000Z', lastTurn: 'x', tokensUsed: 5, windowTokens: 100 });
  const r = grok.read(WORKDIR);
  assert.equal(r.found, false);
  /* the exact shared constant, not just truthy -- so a reader that invents its own
     wording for a condition status.js already names would be caught. */
  assert.equal(r.because, NO_READING.NO_TRANSCRIPT);
});

test('messages is null (not 0) when num_messages is absent -- null-when-unknown', () => {
  reset();
  const dir = nodePath.join(SANDBOX, 'sessions', 'enc', 'no-count');
  fs.mkdirSync(dir, { recursive: true });
  /* a summary with info.cwd but NO num_messages field. */
  fs.writeFileSync(nodePath.join(dir, 'summary.json'), JSON.stringify({
    info: { id: 'nc', cwd: WORKDIR }, last_active_at: '2026-09-22T02:05:00.000Z', current_model_id: 'grok-4.6',
  }));
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.messages, null, 'num_messages absent -> null, never a fabricated 0');
});

test('a malformed (present but invalid-JSON) signals.json -> null halves, still found, never throws', () => {
  reset();
  const dir = writeSession({ encDir: 'enc', sessionId: 's-badsig', cwd: WORKDIR, model: 'grok-4.6', numMessages: 2, lastActive: '2026-09-22T02:05:00.000Z', lastTurn: 'x' });
  fs.writeFileSync(nodePath.join(dir, 'signals.json'), '{ not valid json');
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.contextUsed, null, 'malformed signals -> null, not a throw');
  assert.equal(r.contextWindow, null);
  assert.equal(r.contextUsedAt, null);
});

test('the newest session (by summary mtime) wins among two for one workdir', () => {
  reset();
  const older = writeSession({ encDir: 'enc', sessionId: 's-older', cwd: WORKDIR, model: 'grok-4.6', numMessages: 1, lastActive: '2026-09-22T02:00:00.000Z', lastTurn: 'old', tokensUsed: 100, windowTokens: 256000 });
  const newer = writeSession({ encDir: 'enc2', sessionId: 's-newer', cwd: WORKDIR, model: 'grok-4.6', numMessages: 5, lastActive: '2026-09-22T02:10:00.000Z', lastTurn: 'new', tokensUsed: 200, windowTokens: 256000 });
  const t0 = Date.now();
  fs.utimesSync(nodePath.join(older, 'summary.json'), new Date(t0 - 60000), new Date(t0 - 60000));
  fs.utimesSync(nodePath.join(newer, 'summary.json'), new Date(t0), new Date(t0));
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, 's-newer');
  assert.equal(r.contextUsed, 200);
  assert.equal(r.lastAgentMessage, 'new');
});

test('a malformed / non-object summary.json is skipped, never throws', () => {
  reset();
  const dir = nodePath.join(SANDBOX, 'sessions', 'enc', 'bad');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'summary.json'), '{ not valid json');
  // plus a good one for the SAME workdir, so a bad sibling must not hide it
  writeSession({ encDir: 'enc', sessionId: 'good', cwd: WORKDIR, model: 'grok-4.6', numMessages: 1, lastActive: '2026-09-22T02:05:00.000Z', lastTurn: 'ok', tokensUsed: 5, windowTokens: 100 });
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, 'good');
});

test('a non-string current_model_id (unexpected ModelId shape) yields model null, not "[object Object]"', () => {
  reset();
  writeSession({ encDir: 'enc', sessionId: 's-objmodel', cwd: WORKDIR, model: { id: 'grok-4.6' }, numMessages: 1, lastActive: '2026-09-22T02:05:00.000Z', lastTurn: 'x', tokensUsed: 5, windowTokens: 100 });
  const r = grok.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.model, null, 'never String(obj) a struct into a bogus model string');
});

test('HOME() resolves each override; GROK_HOME is the storage root, NOT parent-appended', () => {
  const saved = {
    a: process.env.AGENT_WORKFORCE_GROK_HOME,
    g: process.env.GROK_HOME,
    h: process.env.AGENT_WORKFORCE_HOME,
  };
  try {
    process.env.AGENT_WORKFORCE_GROK_HOME = '/x/.grok';
    delete process.env.GROK_HOME; delete process.env.AGENT_WORKFORCE_HOME;
    assert.equal(grok.HOME(), '/x/.grok', 'our override is verbatim');

    /* GROK_HOME IS the storage root (sessions/ directly under it) -- unlike
       GEMINI_CLI_HOME, it is NOT the parent of a .grok dir, so nothing is appended. */
    delete process.env.AGENT_WORKFORCE_GROK_HOME;
    process.env.GROK_HOME = '/srv/grokhome';
    assert.equal(grok.HOME(), '/srv/grokhome');

    delete process.env.GROK_HOME;
    process.env.AGENT_WORKFORCE_HOME = '/home/bot';
    assert.equal(grok.HOME(), nodePath.join('/home/bot', '.grok'));
  } finally {
    if (saved.a === undefined) delete process.env.AGENT_WORKFORCE_GROK_HOME; else process.env.AGENT_WORKFORCE_GROK_HOME = saved.a;
    if (saved.g === undefined) delete process.env.GROK_HOME; else process.env.GROK_HOME = saved.g;
    if (saved.h === undefined) delete process.env.AGENT_WORKFORCE_HOME; else process.env.AGENT_WORKFORCE_HOME = saved.h;
  }
});
