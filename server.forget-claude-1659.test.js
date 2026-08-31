'use strict';

/**
 * #1659: the DELETE /api/accounts/claude route.
 *
 * The Claude half of #1372. The enumeration is COPIED from the OpenAI route
 * rather than re-derived, so the arms Renet Tilley's #1447 review bought are
 * re-run here against the new route: a route written from the card alone would
 * have treated an unreadable fleet as "nobody is on it".
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

function board(seed) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-forget-1659-'));
  const home = nodePath.join(sb, 'home');
  const launch = nodePath.join(sb, 'launch');
  const workers = nodePath.join(sb, 'workers');
  const bin = nodePath.join(sb, 'bin');
  for (const d of [home, launch, workers, bin]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const ctx = { sb, home, launch, workers, bin };
  const target = seed(ctx);

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      const body = JSON.stringify({ dir: process.env.FORGET_DIR });
      const req = http.request({
        host: '127.0.0.1', port: srv.address().port,
        path: '/api/accounts/claude', method: 'DELETE',
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
  const isDefault = label === 'default';
  const dir = nodePath.join(home, isDefault ? '.claude' : '.claude-' + label);
  fs.mkdirSync(dir, { recursive: true });
  const cfg = isDefault ? nodePath.join(home, '.claude.json') : nodePath.join(dir, '.claude.json');
  fs.writeFileSync(cfg, JSON.stringify({ oauthAccount: { emailAddress: label + '@example.com' } }));
  return dir;
}

/* An agent whose launch file Kosmos can actually parse, on a named account. */
function agentOn(ctx, name, configDir, runner) {
  const fleet = require('./test-support/fleet');
  const create = require('./engine/create');
  process.env.AGENT_WORKFORCE_LAUNCH = ctx.launch;
  fs.mkdirSync(nodePath.join(ctx.workers, name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    /* `runner` is passed THROUGH, not defaulted. `|| 'claude'` made a null
       fixture byte-identical to a claude one, so the pre-runners test below was
       a duplicate of the test above it and could not fail for its own reason. */
    create.plistFor(name, '/bin/claude', '/bin/tmux', null, configDir, runner), 'utf8');
  ctx.panesFile = ctx.panesFile || nodePath.join(ctx.sb, 'panes.txt');
  fs.appendFileSync(ctx.panesFile, fleet.line({ session: name }) + '\n');
  assert.ok(fs.existsSync(create.plistPath(name)),
    'the seeded launch file is missing, so every assertion below would be right for the wrong reason');
  ctx.seededPlist = fs.readFileSync(create.plistPath(name), 'utf8');
}

test('#1659 route: an unused Claude account is forgotten, and the answer says nothing was deleted', () => {
  const r = board(({ home }) => account(home, 'lonely'));
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
  assert.match(r.json.because, /still on this computer/);
  assert.ok(!fs.existsSync(r.target), 'the account directory moved');
  assert.ok(fs.existsSync(nodePath.join(r.home, '.removed-claude-lonely', '.claude.json')),
    'and its sign-in survived the move');
  /* 🔑 THE SENTENCE MUST NAME WHERE IT WENT. "Still on this computer" is true
     and unactionable alone; the engine computes movedTo and the route used to
     drop it, so the one fact that makes a removal recoverable was withheld from
     the person who might need it. */
  assert.match(r.json.because, /\.removed-claude-lonely/,
    'the answer does not say where the account went, so the removal is not recoverable by anyone reading it');
  /* And it must say what Kosmos stops doing: the rename takes the directory out
     of status.js configRoots (which accepts only .claude and .claude-*), so an
     account with its own projects tree stops being findable. */
  assert.match(r.json.because, /stops looking inside it/,
    'the answer still promises "nothing was deleted" without saying the history stops appearing');
});

test('#1659 route CONTROL: a path that is not a Claude account is refused, and nothing moves', () => {
  const r = board(({ home }) => {
    account(home, 'bystander');
    const outside = nodePath.join(home, 'not-an-account');
    fs.mkdirSync(outside, { recursive: true });
    return outside;
  });
  assert.equal(r.code, 400);
  assert.match(String(r.json.error), /not a Claude account/);
  assert.ok(fs.existsSync(r.target), 'it left the directory alone');
  assert.ok(fs.existsSync(nodePath.join(r.home, '.claude-bystander')),
    'and the real account beside it is untouched');
});

/* 🛑 THE ASYMMETRY WITH THE OPENAI ROUTE, AT THE ROUTE LEVEL. */
test('#1659 route: the DEFAULT account is refused, and it is still there', () => {
  const r = board(({ home }) => account(home, 'default'));
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /main Claude folder/);
  assert.ok(fs.existsSync(r.target), 'THE DEFAULT MUST STILL BE THERE');
});

test('#1659 route: a missing account is a quiet success, not an error', () => {
  const r = board(({ home }) => nodePath.join(home, '.claude-neverexisted'));
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, false);
  assert.match(r.json.because, /already gone/);
});

test('#1659 route FAIL-CLOSED: an unreadable launch file REFUSES instead of proceeding', () => {
  const fleet = require('./test-support/fleet');
  const r = board((ctx) => {
    const dir = account(ctx.home, 'guarded');
    ctx.panesFile = nodePath.join(ctx.sb, 'panes.txt');
    fs.writeFileSync(ctx.panesFile, fleet.line({ session: 'ghost' }) + '\n');
    fs.mkdirSync(nodePath.join(ctx.workers, 'ghost'), { recursive: true });
    fs.mkdirSync(nodePath.join(ctx.launch, 'com.kosmos.agent.ghost.plist'), { recursive: true });
    return dir;
  });
  assert.equal(r.code, 400, 'it must REFUSE, not proceed. body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not check which agents/,
    'and it must say it could not LOOK, not that nobody was there');
  assert.ok(fs.existsSync(r.target), 'refusing means nothing moved');
});

test('#1659 route: an agent ON the account blocks removal and is NAMED', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'busy');
    agentOn(ctx, 'marlowe', dir, 'claude');
    return dir;
  });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.usedBy, ['marlowe'], 'the person needs to know WHICH agent');
  assert.match(String(r.json.error), /marlowe is running on this account/);
  assert.ok(fs.existsSync(r.target), 'nothing moved');
});

/* Without this the arm above could pass on a route that refuses whenever ANY
   agent exists, which would make the button unpressable on a busy machine. */
/* 🛑 THE RUNNER FILTER, PERTURBED BY DELETION RATHER THAN BY INVERSION.
   Inverting `job.runner !== 'claude'` to `'codex'` goes red because every other
   agent in this file is a Claude one. DELETING the line does NOT: with no
   filter, all runners count, and since nothing here was a codex agent the
   outcome never changed. So the guard was only half covered and the arm below
   is the missing half -- a CODEX agent whose recorded home IS the target
   directory, which the filter must skip. Delete the line and this goes red. */
test('#1659 route: a CODEX agent on this directory does NOT block a Claude removal', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'mixed');
    agentOn(ctx, 'codexer', dir, 'codex');
    return dir;
  });
  assert.equal(r.code, 200, 'a codex agent is not on the Claude account; the filter must skip it. body: '
    + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
});

/* The other half of the same guard, and the route docblock calls it the
   load-bearing one: `readJob` normalises a MISSING ninth argument to 'claude',
   because every plist written before runners existed carries none. If that
   default ever changed, an OLD Claude agent would stop being seen and its
   account could be renamed out from under it. */
test('#1659 route: an agent whose plist PREDATES runners still blocks (absent runner means claude)', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'legacy');
    agentOn(ctx, 'oldtimer', dir, null);
    return dir;
  });
  /* 🔑 ASSERT THE FIXTURE IS ACTUALLY PRE-RUNNERS. Without this the test reads
     as covering the absent-runner default while in fact being indistinguishable
     from the claude case: plistFor writes the ninth argument only for codex, so
     plistFor(...,'claude') and plistFor(...,null) are byte-identical. The
     assertion is what makes this arm about the DEFAULT rather than about a
     spelling. */
  assert.ok(typeof r.seededPlist === 'string' && r.seededPlist.length > 0,
    'the seeded plist did not reach the assertion, so the check below would pass on an empty string');
  assert.ok(!/<string>claude<\/string>\s*<\/array>/.test(r.seededPlist),
    'the fixture wrote a runner argument, so it does not represent a pre-runners plist');
  assert.equal(r.code, 400, 'a pre-runners plist must still read as a Claude agent. body: '
    + JSON.stringify(r.json));
  assert.deepEqual(r.json.usedBy, ['oldtimer']);
});

test('#1659 route DISCRIMINATOR: an agent on a DIFFERENT account does not block', () => {
  const r = board((ctx) => {
    const target = account(ctx.home, 'quiet');
    const other = account(ctx.home, 'elsewhere');
    agentOn(ctx, 'spade', other, 'claude');
    return target;
  });
  assert.equal(r.code, 200, 'it must PROCEED: that agent is on another account. body: '
    + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
});
