'use strict';

/**
 * #1372: the DELETE /api/accounts/openai route.
 *
 * 🛑 THIS FILE EXISTS BECAUSE THE ROUTE HAD NO TESTS, AND THAT IS WHY A
 * FAIL-OPEN WAS INVISIBLE. Renet Tilley, reviewing #1447: the enumeration
 * answered "no agents are on this account" when it could not READ the fleet,
 * and an empty list is permission to proceed. ⭐ His sentence: AMBIGUITY WAS
 * SILENTLY NONE.
 *
 * The refusal exists to make a rename safe: it moves a directory a running
 * agent's launch file points at by absolute path. A safety check that cannot
 * tell "nobody" from "I could not look" is not one.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

/** One sandbox, seeded in THIS process, then one DELETE driven in a child. */
function board(seed) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-forget-1372-'));
  const home = nodePath.join(sb, 'home');
  const launch = nodePath.join(sb, 'launch');
  const workers = nodePath.join(sb, 'workers');
  const bin = nodePath.join(sb, 'bin');
  for (const d of [home, launch, workers, bin]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const ctx = { sb, home, launch, workers, bin };
  const target = seed(ctx);          // seeded BEFORE the child starts

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      const body = JSON.stringify({ dir: process.env.FORGET_DIR });
      const req = http.request({
        host: '127.0.0.1', port: srv.address().port,
        path: '/api/accounts/openai', method: 'DELETE',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          process.stdout.write(JSON.stringify({ code: res.statusCode, body: s.slice(0, 900) }));
          srv.close(); process.exit(0);
        });
      });
      req.on('error', (e) => { process.stdout.write(JSON.stringify({ code: null, body: String(e.message) })); process.exit(0); });
      req.end(body);
    });
  `;

  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FORGET_DIR: target,
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_HOME: home,
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: workers,
      AGENT_WORKFORCE_LAUNCH: launch,
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
      /* ⚠️ FAKE_PANES IS A FILE PATH, not the content, and it is read by
         test-support/fake-tmux.sh, which must BE the tmux binary. My first
         version passed the content and a stub that exits 0, so no agent ever
         reached the roster and the fail-closed arm passed against nothing. */
      ...(ctx.panesFile ? {
        AGENT_WORKFORCE_FAKE_PANES: ctx.panesFile,
        AGENT_WORKFORCE_TMUX_BIN: nodePath.join(REPO, 'test-support', 'fake-tmux.sh'),
      } : {}),
    },
  });
  const parsed = JSON.parse(out);
  let json = null;
  try { json = JSON.parse(parsed.body); } catch { json = null; }
  return { ...ctx, code: parsed.code, json, target };
}

function account(home, label) {
  const dir = nodePath.join(home, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-FAKE-' + label }));
  return dir;
}

test('#1372 route: an unused account is forgotten, and the answer says nothing was deleted', () => {
  const r = board(({ home }) => account(home, 'lonely'));
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
  assert.match(r.json.because, /still on this computer/,
    'the sentence must say the credential was NOT deleted');
  assert.ok(!fs.existsSync(r.target), 'the account directory moved');
  assert.ok(fs.existsSync(nodePath.join(r.home, '.removed-codex-lonely', 'auth.json')),
    'and its credential survived the move');
});

test('#1372 route CONTROL: a path that is not an account is refused, and nothing moves', () => {
  /* Without this, the arm above could pass on a route that forgets anything
     it is handed, including a directory that is not ours. */
  const r = board(({ home }) => {
    account(home, 'bystander');
    const outside = nodePath.join(home, 'not-an-account');
    fs.mkdirSync(outside, { recursive: true });
    return outside;
  });
  assert.equal(r.code, 400);
  assert.match(String(r.json.error), /not an OpenAI account/);
  assert.ok(fs.existsSync(r.target), 'it left the directory alone');
  assert.ok(fs.existsSync(nodePath.join(r.home, '.codex-bystander')),
    'and the real account beside it is untouched');
});

test('#1372 route: a missing account is a quiet success, not an error', () => {
  const r = board(({ home }) => nodePath.join(home, '.codex-neverexisted'));
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, false);
  assert.match(r.json.because, /already gone/);
});

test('#1372 route FAIL-CLOSED: an unreadable launch file REFUSES instead of proceeding', () => {
  /* 🛑 THE ARM THIS REVIEW BOUGHT, and the reason the file exists.
     Renet Tilley on the first version: the enumeration answered "no agents"
     when it could not READ one, and an empty list is permission to proceed.

     A plist path that is a DIRECTORY makes `readJob` throw. That is IGNORANCE,
     not an answer, and the route must now refuse rather than rename a
     directory that a running agent may point at.

     📌 The agent has to be ON THE ROSTER for the branch to be reached at all,
     which is what the fake-pane seam is for. Without it the loop never runs
     and this arm would pass against nothing. */
  const fleet = require('./test-support/fleet');
  const r = board((ctx) => {
    const dir = account(ctx.home, 'guarded');
    ctx.panesFile = nodePath.join(ctx.sb, 'panes.txt');
    fs.writeFileSync(ctx.panesFile, fleet.line({ session: 'ghost' }) + '\n');
    fs.mkdirSync(nodePath.join(ctx.workers, 'ghost'), { recursive: true });
    // a DIRECTORY where the launch file belongs: readFileSync throws on it
    fs.mkdirSync(nodePath.join(ctx.launch, 'com.kosmos.agent.ghost.plist'), { recursive: true });
    return dir;
  });

  assert.equal(r.code, 400, 'it must REFUSE, not proceed. body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not check which agents/,
    'and it must say it could not LOOK, not that nobody was there');
  assert.ok(fs.existsSync(r.target),
    'THE ACCOUNT MUST STILL BE THERE: refusing means nothing moved');
});

test('#1372 route FAIL-CLOSED: a MALFORMED plist also refuses, not just an unreadable one', () => {
  /* 🛑 RENET TILLEY'S RESIDUAL POINT, TESTED RATHER THAN ASSUMED. He struck his
     "throw" mechanism when I showed readJob catches its own error, and then
     named a MORE reachable one: readJob returns null on four ordinary
     conditions, and a plist that cannot be PARSED is far likelier than one
     that cannot be read.

     ✅ The fix covers it, and the reason is that `jobMissing` keys on whether
     the FILE EXISTS rather than on why readJob failed. A malformed plist is a
     real file, so it is not ENOENT-absent, so it is ignorance, so it refuses.
     But that is an argument until it is run, which is what this arm is. */
  const fleet = require('./test-support/fleet');
  const r = board((ctx) => {
    const dir = account(ctx.home, 'malformed');
    ctx.panesFile = nodePath.join(ctx.sb, 'panes.txt');
    fs.writeFileSync(ctx.panesFile, fleet.line({ session: 'ghost' }) + '\n');
    fs.mkdirSync(nodePath.join(ctx.workers, 'ghost'), { recursive: true });
    // A REAL, READABLE file that is not a plist Kosmos can parse.
    fs.writeFileSync(nodePath.join(ctx.launch, 'com.kosmos.agent.ghost.plist'),
      '<?xml version="1.0"?>\n<plist><dict></dict></plist>\n');
    return dir;
  });

  assert.equal(r.code, 400, 'a plist it cannot parse is IGNORANCE, not "no agent here". body: '
    + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not check which agents/);
  assert.ok(fs.existsSync(r.target), 'and nothing moved');
});
