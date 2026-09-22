'use strict';

/**
 * Reading a launched Gemini agent's session transcript (#3296, the runner path).
 *
 * 🔑 THE FIXTURE IS THE REAL FORMAT, captured from an actual Gemini CLI
 * 0.61.0-preview.0 session on 2026-09-21 (renettilley), not invented from
 * documentation -- which does not describe this file at all. Every field
 * asserted below was observed: the session_meta header, the mix of `$set`
 * snapshot/bookkeeping ops and bare message lines, content as EITHER a string
 * or a [{text}] array, and the per-turn `tokens` object whose `input` is the
 * window occupancy.
 *
 * ⚠️ A SANDBOXED GEMINI HOME, set before the module loads, exactly as the codex
 * reader test does. The real ~/.gemini holds the operator's own conversations;
 * a test that walked it would be reading them to check a path join.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-'));
process.env.AGENT_WORKFORCE_GEMINI_HOME = SANDBOX;
const gemini = require('./geminisession');

/* realpathSync so a fixture launch folder matches the canonicalOnDisk() forWorkdir
   does on both sides -- macOS tmpdir is /var -> /private/var, the twin #2417
   folds. Without this the WORKDIR key in projects.json (raw /var) and the
   canonical `dir` (/private/var) would not match, which is itself worth a test. */
const WORKDIR_RAW = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-wd-'));
const WORKDIR = fs.realpathSync(WORKDIR_RAW);
const SLUG = 'aw-gemini-wd-slug';

/* The real captured session, exact shape (2026-09-21). The session_context text
   is truncated -- only its SHAPE (content as a [{text}] array) is under test. */
const HEADER = {
  sessionId: '32c93101-7e18-49fd-8a79-c2f544bb50cf',
  projectHash: '378dc5967c731b4648a20660a7bef0d0d142ea3d26504b78a00c679c5694d437',
  startTime: '2026-09-22T02:37:08.325Z',
  lastUpdated: '2026-09-22T02:37:08.325Z',
  kind: 'main',
};
const SET_SEED = {
  $set: {
    messages: [{
      id: 'd04923d38bb0f6017037e74183378ef4',
      timestamp: '2026-09-22T02:37:08.325Z',
      type: 'user',
      content: [{ text: '<session_context>\nThis is the Gemini CLI...' }],
    }],
    lastUpdated: '2026-09-22T02:37:08.325Z',
  },
};
const USER_BARE = {
  id: '6e04070e-0b4d-4cc0-b9f8-a5e20ef41025',
  timestamp: '2026-09-22T02:37:08.330Z',
  type: 'user',
  content: [{ text: 'Reply with exactly: CLI-GEMINI-OK' }],
};
const SET_TICK1 = { $set: { lastUpdated: '2026-09-22T02:37:08.330Z' } };
const GEMINI_BARE = {
  id: 'af871fff-b203-44f8-acad-6e287d13412b',
  timestamp: '2026-09-22T02:37:10.586Z',
  type: 'gemini',
  content: 'CLI-GEMINI-OK',
  thoughts: [{ subject: 'Acknowledge and Respond', description: 'done', timestamp: '2026-09-22T02:37:10.586Z' }],
  tokens: { input: 6937, output: 5, cached: 0, thoughts: 29, tool: 0, total: 6971 },
  model: 'gemini-2.5-flash',
};
const SET_TICK2 = { $set: { lastUpdated: '2026-09-22T02:37:10.586Z' } };

const REAL_ROWS = [HEADER, SET_SEED, USER_BARE, SET_TICK1, GEMINI_BARE, SET_TICK2];

function writeSession(slug, rows, name) {
  const dir = nodePath.join(SANDBOX, 'tmp', slug, 'chats');
  fs.mkdirSync(dir, { recursive: true });
  const file = nodePath.join(dir, name || 'session-2026-09-22T02-37-32c93101.jsonl');
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function writeProjects(map) {
  fs.writeFileSync(nodePath.join(SANDBOX, 'projects.json'), JSON.stringify({ projects: map }));
}

test('read() returns codex-shaped fields from the real captured session', () => {
  writeProjects({ [WORKDIR]: SLUG });
  const file = writeSession(SLUG, REAL_ROWS);
  const r = gemini.read(WORKDIR);
  assert.equal(r.found, true, r.because);
  assert.equal(r.file, file);
  assert.equal(r.sessionId, '32c93101-7e18-49fd-8a79-c2f544bb50cf');
  /* provider is KNOWN, not unknown -- we are reading a gemini session dir. */
  assert.equal(r.provider, 'gemini');
  /* Gemini does not state its window in the transcript (the Claude case): null. */
  assert.equal(r.contextWindow, null);
  /* The header carries no CLI version: null, not guessed. */
  assert.equal(r.cliVersion, null);
  /* contextUsed = the last gemini turn's tokens.input (window occupancy). */
  assert.equal(r.contextUsed, 6937);
  assert.equal(r.contextUsedAt, Date.parse('2026-09-22T02:37:10.586Z'));
  /* 3 conversation messages: the $set seed user + the bare user + the bare gemini. */
  assert.equal(r.messages, 3);
  assert.equal(r.lastAt, '2026-09-22T02:37:10.586Z');
  assert.equal(r.lastAgentMessage, 'CLI-GEMINI-OK');
  assert.equal(r.model, 'gemini-2.5-flash');
});

test('the launch folder is matched through the /private canonical twin (#2417)', () => {
  writeProjects({ [WORKDIR]: SLUG });
  writeSession(SLUG, REAL_ROWS);
  /* Query with the /var raw spelling: canonicalOnDisk folds it to /private/var
     to match the projects.json key, so a symlink-twin launch folder still reads. */
  const r = gemini.read(WORKDIR_RAW);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, HEADER.sessionId);
});

test('a message re-listed in a later $set snapshot de-dupes by id', () => {
  const slug = 'dedupe';
  const wd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-dd-')));
  writeProjects({ [wd]: slug });
  /* The bare gemini message ALSO appears inside a trailing $set.messages full
     snapshot -- the count must stay 3, not double. */
  const snapshot = { $set: { messages: [SET_SEED.$set.messages[0], USER_BARE, GEMINI_BARE], lastUpdated: GEMINI_BARE.timestamp } };
  writeSession(slug, REAL_ROWS.concat([snapshot]));
  const r = gemini.read(wd);
  assert.equal(r.found, true, r.because);
  assert.equal(r.messages, 3);
  assert.equal(r.contextUsed, 6937);
  assert.equal(r.lastAgentMessage, 'CLI-GEMINI-OK');
});

test('content flattens a [{text}] array and passes a bare string through', () => {
  assert.equal(gemini.contentText('hi'), 'hi');
  assert.equal(gemini.contentText([{ text: 'a' }, { text: 'b' }]), 'ab');
  /* A part with no text contributes nothing; an all-empty array is null. */
  assert.equal(gemini.contentText([{ functionCall: {} }]), null);
  assert.equal(gemini.contentText(null), null);
});

test('a workdir with no recorded session reads NO_TRANSCRIPT', () => {
  const wd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-none-')));
  writeProjects({ [WORKDIR]: SLUG });
  writeSession(SLUG, REAL_ROWS);
  const r = gemini.read(wd);
  assert.equal(r.found, false);
  assert.ok(r.because, 'a not-found read states a reason');
});

test('a slug in projects.json with an empty chats dir is not found', () => {
  const slug = 'launched-no-session';
  const wd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-empty-')));
  writeProjects({ [wd]: slug });
  fs.mkdirSync(nodePath.join(SANDBOX, 'tmp', slug, 'chats'), { recursive: true });
  const r = gemini.read(wd);
  assert.equal(r.found, false);
});

test('contextUsed/contextWindow are null before any completed gemini turn', () => {
  const slug = 'no-turn';
  const wd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-noturn-')));
  writeProjects({ [wd]: slug });
  writeSession(slug, [HEADER, SET_SEED, USER_BARE, SET_TICK1]); // user asked, no gemini reply yet
  const r = gemini.read(wd);
  assert.equal(r.found, true, r.because);
  assert.equal(r.contextUsed, null);
  assert.equal(r.contextWindow, null);
  assert.equal(r.lastAgentMessage, null);
  assert.equal(r.model, null);
  assert.equal(r.messages, 2);
});

test('the newest session (by mtime) wins among two for one workdir', () => {
  const slug = 'two-sessions';
  const wd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-two-')));
  writeProjects({ [wd]: slug });
  const older = writeSession(slug, [HEADER, SET_SEED, GEMINI_BARE], 'session-2026-09-22T02-30-aaaaaaaa.jsonl');
  const newerGemini = { ...GEMINI_BARE, id: 'newer', content: 'NEWER-REPLY', tokens: { ...GEMINI_BARE.tokens, input: 12345 } };
  const newer = writeSession(slug, [{ ...HEADER, sessionId: 'newer-session' }, newerGemini], 'session-2026-09-22T02-40-bbbbbbbb.jsonl');
  /* Force mtimes so the assertion is about mtime order, not creation order. */
  const t0 = Date.now();
  fs.utimesSync(older, new Date(t0 - 60000), new Date(t0 - 60000));
  fs.utimesSync(newer, new Date(t0), new Date(t0));
  const r = gemini.read(wd);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, 'newer-session');
  assert.equal(r.contextUsed, 12345);
  assert.equal(r.lastAgentMessage, 'NEWER-REPLY');
});

test('HOME() resolves each override to the .gemini storage dir (#3296 fix)', () => {
  const saved = {
    a: process.env.AGENT_WORKFORCE_GEMINI_HOME,
    c: process.env.GEMINI_CLI_HOME,
    h: process.env.AGENT_WORKFORCE_HOME,
  };
  try {
    /* AGENT_WORKFORCE_GEMINI_HOME: verbatim (points straight at the .gemini dir). */
    process.env.AGENT_WORKFORCE_GEMINI_HOME = '/x/.gemini';
    delete process.env.GEMINI_CLI_HOME;
    delete process.env.AGENT_WORKFORCE_HOME;
    assert.equal(gemini.HOME(), '/x/.gemini');

    /* GEMINI_CLI_HOME: the real CLI's ROOT -- append .gemini (the #3296 fix). */
    delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
    process.env.GEMINI_CLI_HOME = '/srv/agent';
    assert.equal(gemini.HOME(), nodePath.join('/srv/agent', '.gemini'));

    /* default: <home>/.gemini. */
    delete process.env.GEMINI_CLI_HOME;
    process.env.AGENT_WORKFORCE_HOME = '/home/bot';
    assert.equal(gemini.HOME(), nodePath.join('/home/bot', '.gemini'));
  } finally {
    if (saved.a === undefined) delete process.env.AGENT_WORKFORCE_GEMINI_HOME;
    else process.env.AGENT_WORKFORCE_GEMINI_HOME = saved.a;
    if (saved.c === undefined) delete process.env.GEMINI_CLI_HOME;
    else process.env.GEMINI_CLI_HOME = saved.c;
    if (saved.h === undefined) delete process.env.AGENT_WORKFORCE_HOME;
    else process.env.AGENT_WORKFORCE_HOME = saved.h;
  }
});

test('an explicit home arg reads that home, not the process default', () => {
  const altRoot = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-alt-'));
  const altHome = nodePath.join(altRoot, '.gemini');
  const wd = fs.realpathSync(fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-gemini-altwd-')));
  fs.mkdirSync(altHome, { recursive: true });
  fs.writeFileSync(nodePath.join(altHome, 'projects.json'), JSON.stringify({ projects: { [wd]: 'altslug' } }));
  const dir = nodePath.join(altHome, 'tmp', 'altslug', 'chats');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'session-2026-09-22T03-00-cccccccc.jsonl'),
    [HEADER, GEMINI_BARE].map((r) => JSON.stringify(r)).join('\n') + '\n');
  const r = gemini.read(wd, altHome);
  assert.equal(r.found, true, r.because);
  assert.equal(r.sessionId, HEADER.sessionId);
});
