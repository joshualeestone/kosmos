'use strict';

/**
 * The runner routes (#979), driven against the real server.
 *
 * A separate file from `server.test.js` for the same reason as
 * `server.connect.test.js`: that file's blocks are a standing merge hazard,
 * and this feature can add a file instead of a conflict.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (the server fixes paths at
 * load), plus the two this feature adds: the managed runners dir, and the
 * codex override -- which resolveBin treats as AUTHORITATIVE, so pointing
 * it at a sandbox path is what makes present/absent deterministic here
 * (this Mac genuinely has a hand-installed codex at the legacy path).
 *
 *   node --test server.runners.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-runner-routes-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_RUNNERS_DIR = path.join(SANDBOX, 'runners');
const MISSING_CODEX = path.join(SANDBOX, 'no-such-codex');
process.env.AGENT_WORKFORCE_CODEX_BIN = MISSING_CODEX; // absent by default; tests flip it

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');

let base;
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  require('./engine/agystatus').resetForTests();   // #3568: no agy stub outlives this file
  server.closeAllConnections();
  server.close();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
});

async function req(p, options) {
  const res = await fetch(base + p, options);
  return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text() };
}
const json = (r) => JSON.parse(r.body);

async function post(p, body, origin) {
  return req(p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: origin || base },
    body: JSON.stringify(body || {}),
  });
}

test('#979: GET /api/runners answers the documented shape, absent runner and honest numbers', async () => {
  const got = await req('/api/runners');
  assert.equal(got.status, 200);
  assert.match(got.type, /application\/json/);
  const r = json(got).runners;
  assert.ok(r.openai, 'the openai runner is listed');
  assert.equal(r.openai.present, false, 'the sandboxed override names a missing path, so absent');
  assert.equal(r.openai.bin, MISSING_CODEX, 'and the bin is the path the operator set, not a fallback');
  assert.equal(typeof r.openai.pinnedVersion, 'string');
  assert.ok(r.openai.downloadBytes === null || typeof r.openai.downloadBytes === 'number');
  assert.equal(r.openai.job, null, 'no install has run');
});

test('#979: a prototype-chain provider name in the URL is a refusal, not a job', async () => {
  const got = await post('/api/runners/constructor/install');
  assert.equal(got.status, 400);
  const j = json(got).job;
  assert.equal(j.phase, 'failed');
  assert.match(j.because, /do not know/);
  // The reason ALSO rides at top-level `error`, the field every screen's fetch
  // wrapper reads first. Without it the first-run GPT card said only "We could not
  // start that install." while the real reason sat unread at job.because.
  assert.equal(json(got).error, j.because);
});

test('#979: install on an already-present runner answers installed without a job or a download', async () => {
  process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo'; // exists on every Mac
  try {
    const got = await post('/api/runners/openai/install');
    assert.equal(got.status, 200);
    assert.equal(json(got).job.phase, 'installed');
  } finally {
    process.env.AGENT_WORKFORCE_CODEX_BIN = MISSING_CODEX;
  }
});

test('#979: Add with the runner missing is a STRUCTURED refusal the screen can act on, never a silent no-op', async () => {
  const got = await post('/api/accounts/openai', { key: 'sk-test-not-a-real-key' });
  assert.equal(got.status, 400);
  const j = json(got);
  // The exact legacy sentence is load-bearing: the UI displays it
  // verbatim, so the on-screen wording must not change out from under
  // people until the flow binds the richer shape.
  assert.equal(j.error, 'we could not find the OpenAI runner on this computer, so there is nothing to sign in to');
  assert.equal(j.needsRunner, true);
  assert.equal(j.provider, 'openai');
});

test('#979: Add with the runner present passes the runner gate (no needsRunner in the answer)', async () => {
  process.env.AGENT_WORKFORCE_CODEX_BIN = '/bin/echo';
  try {
    const got = await post('/api/accounts/openai', { key: 'sk-test-not-a-real-key' });
    // /bin/echo is not a real codex, so the add itself may still fail
    // downstream -- the assertion here is ONLY that the runner gate
    // opened: whatever came back, it is not the needs-install shape.
    const j = json(got);
    assert.equal(j.needsRunner, undefined, 'a present runner must never answer needsRunner');
  } finally {
    process.env.AGENT_WORKFORCE_CODEX_BIN = MISSING_CODEX;
  }
});

test('#979: POST /api/runners/claude/install is reachable and answers a refusal over HTTP', async () => {
  /* ⚠️ THE ROUTE IS NEWLY REACHABLE FOR claude (the path regex matches any
     lowercase name) and nothing exercised it: every other POST test uses
     openai or a bogus provider.

     🛑 AND THE OBVIOUS VERSION OF THIS TEST IS UNSAFE. Clearing the override
     so the vendor-external branch runs reaches the DEFAULT findElsewhere,
     which probes absolute machine paths and then `which claude` -- on any
     machine that has Claude installed (every fleet Mac) that answers with the
     OPERATOR'S REAL BINARY, which is not equal to the sandbox's canonical
     path, so the self-exclusion does not fire and the job LINKS the sandbox
     at the operator's live install and runs it. I wrote that version first
     and it returned 200 instead of the expected refusal, which is exactly how
     it announced itself.

     So this pins the route through the OVERRIDE arm instead: an override
     naming a path that does not exist. Same HTTP contract, same job shape,
     and it cannot touch anything outside the sandbox. The default probe stays
     covered by nothing, deliberately, and the plan says so. */
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SANDBOX, 'no-such-claude');
  try {
    const got = await req('/api/runners/claude/install', { method: 'POST' });
    assert.equal(got.status, 400, 'a refusal is an HTTP refusal, not a success a screen could read as started');
    const body = json(got);
    assert.equal(body.job.phase, 'failed');
    assert.match(body.job.because, /AGENT_WORKFORCE_CLAUDE_BIN/, 'it names the variable a person must unset');
    assert.equal(body.job.receivedBytes, null, 'no invented byte count crosses the wire');
  } finally {
    if (prev === undefined) delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
    else process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev;
  }
});

test('#979: claude is listed beside openai with the documented shape (vendor-external kind)', async () => {
  const got = await req('/api/runners');
  assert.equal(got.status, 200);
  const r = json(got).runners;
  assert.ok(r.claude, 'the claude runner is listed');
  // The harness sets AGENT_WORKFORCE_CLAUDE_BIN=/bin/echo, the same
  // authoritative override create.js's suites rely on, so present is true
  // and the bin names the operator-set path.
  assert.equal(r.claude.present, true);
  assert.equal(r.claude.bin, '/bin/echo');
  // A vendor-external entry makes NO pinned-version claim and invents no
  // download size: the version and its checksum are discovered from the
  // vendor's own manifest at install time, not frozen into our manifest.
  // Asserted as null, not undefined: an absence that does not survive
  // JSON.stringify cannot be told apart from a missing field by a screen.
  assert.equal(r.claude.pinnedVersion, null);
  assert.ok('pinnedVersion' in r.claude, 'the honest absence SURVIVES serialisation');
  assert.equal(r.claude.downloadBytes, null);
  assert.equal(r.claude.kind, 'vendor-external');
  assert.equal(r.openai.kind, 'tarball');
});

/* #3568: Gemini on a Google subscription (agy). GET says whether it is installed; POST .../check
   asks it one question and answers true / null (never a guessed "signed out"). */
test('#3568: /api/antigravity reports agy missing, and the check says so without running anything', async () => {
  const agystatus = require('./engine/agystatus');
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = path.join(SANDBOX, 'no-agy', 'agy');
  let ran = 0;
  agystatus.setRunnerForTests((b, done) => { ran += 1; done(null, 'ok'); });
  try {
    const g = await req('/api/antigravity');
    assert.equal(g.status, 200);
    assert.equal(json(g).installed, false);
    const c = await req('/api/antigravity/check', { method: 'POST' });
    assert.equal(c.status, 200);
    assert.equal(json(c).installed, false);
    assert.equal(ran, 0);
  } finally { delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; }
});

test('#3568: with agy installed, the check is signed in on "ok" and could-not-confirm otherwise', async () => {
  const agystatus = require('./engine/agystatus');
  const dir = path.join(SANDBOX, 'agybin'); fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'agy'); fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = bin;
  try {
    assert.equal(json(await req('/api/antigravity')).installed, true);
    agystatus.setRunnerForTests((b, done) => done(null, 'ok'));
    assert.equal(json(await req('/api/antigravity/check', { method: 'POST' })).signedIn, true);
    agystatus.setRunnerForTests((b, done) => done(new Error('timed out'), ''));
    const r = json(await req('/api/antigravity/check', { method: 'POST' }));
    assert.equal(r.signedIn, null, 'a failed check must not read as signed out');
    assert.match(r.because, /may need signing in/);
  } finally { delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; }
});

test('#3568: POST /api/antigravity/open and /install answer through the real routes, with their reasons', async () => {
  if (process.platform !== 'darwin') return;
  const agystatus = require('./engine/agystatus');
  const dir = path.join(SANDBOX, 'agyroutes'); fs.mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, 'agy');
  process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN = bin;
  try {
    // Not installed: open refuses with its reason, and install runs the installer.
    let ran = 0;
    agystatus.setInstallerForTests((done) => { ran += 1; fs.writeFileSync(bin, '#!/bin/sh\nexit 0\n', { mode: 0o755 }); done(null); });
    const o1 = await req('/api/antigravity/open', { method: 'POST' });
    assert.equal(o1.status, 400);
    assert.match(json(o1).error, /not installed/);
    const i1 = await req('/api/antigravity/install', { method: 'POST' });
    assert.equal(i1.status, 200, i1.body);
    assert.deepEqual(json(i1), { ok: true, installed: true });
    assert.equal(ran, 1);
    // Installed: open opens it.
    let opened = null;
    agystatus.setOpenerForTests((b, done) => { opened = b; done(null); });
    const o2 = await req('/api/antigravity/open', { method: 'POST' });
    assert.equal(o2.status, 200);
    assert.equal(opened, bin);
    // CONTROL: a failed install is a 400 with its reason, not a 200.
    fs.rmSync(bin, { force: true });
    agystatus.setInstallerForTests((done) => done(new Error('curl: (6)')));
    const i2 = await req('/api/antigravity/install', { method: 'POST' });
    assert.equal(i2.status, 400);
    assert.match(json(i2).error, /did not finish/);
  } finally { delete process.env.AGENT_WORKFORCE_ANTIGRAVITY_BIN; }
});
