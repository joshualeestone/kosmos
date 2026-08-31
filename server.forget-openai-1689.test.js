'use strict';

/**
 * Account removal must count STOPPED agents, not only running ones (#1689).
 *
 * 🛑 THE GUARD IS WHAT MAKES THE RENAME SAFE. `forgetAccount` refuses while agents
 * are on the account, because the rename moves a path their launch file names by
 * ABSOLUTE PATH. An agent missed by the enumeration comes back pointed at a
 * directory that is not there.
 *
 * ⚠️ THE ENUMERATION WAS THE ONLY BLIND PART. `safeRoster()` is
 * `status.snapshot()`, whose `panelessKeys` does
 * `if (liveness.alive(key) !== true) continue;`, so an agent that exists and is
 * not running never reached the loop. The per-agent check already read the plist
 * from disk and was always correct.
 *
 * 📌 Harness lifted from Angel's `server.forget-claude-1659.test.js` with her
 * offer, including the fail-closed arm. Two of her hard-won details are kept
 * deliberately: `runner` is passed THROUGH rather than defaulted (a `|| 'claude'`
 * made a null fixture byte-identical to a claude one and silently duplicated a
 * test), and every seeded plist is asserted to exist, or the arms below would be
 * right for the wrong reason.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

/** An OpenAI account on this computer: `.codex-<label>` directly inside home. */
function codexAccount(home, label) {
  const dir = nodePath.join(home, label === 'default' ? '.codex' : '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify({ label }));
  return dir;
}

/** The profile IS Kosmos's record that an agent exists, independent of any process. */
function profileFor(ctx, name) {
  const dir = nodePath.join(ctx.sb, 'data', 'AgentWorkforce', 'profiles');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, name + '.json'), JSON.stringify({ displayName: name }));
}

/**
 * An agent whose launch file names `configDir`. `running` decides whether it also
 * gets a pane.
 *
 * 🛑 THE PANE IS THE WHOLE VARIABLE OF THIS FILE. With one, the agent reaches
 * `safeRoster` and the old code saw it. WITHOUT one it is invisible to liveness,
 * and only the profile union finds it. A stopped fixture that accidentally got a
 * pane would pass against the old code too and prove nothing.
 */
function agentOn(ctx, name, configDir, runner, running) {
  const fleet = require('./test-support/fleet');
  const create = require('./engine/create');
  process.env.AGENT_WORKFORCE_LAUNCH = ctx.launch;
  fs.mkdirSync(nodePath.join(ctx.workers, name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    /* passed THROUGH, not defaulted: see the header note */
    create.plistFor(name, '/bin/claude', '/bin/tmux', null, configDir, runner), 'utf8');
  profileFor(ctx, name);
  ctx.panesFile = ctx.panesFile || nodePath.join(ctx.sb, 'panes.txt');
  if (running) fs.appendFileSync(ctx.panesFile, fleet.line({ session: name }) + '\n');
  else if (!fs.existsSync(ctx.panesFile)) fs.writeFileSync(ctx.panesFile, '');
  assert.ok(fs.existsSync(create.plistPath(name)),
    'the seeded launch file is missing, so every assertion below would be right for the wrong reason');
}

function board(seed) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-forget-1689-'));
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
      ...(ctx.panesFile ? {
        AGENT_WORKFORCE_TMUX_BIN: nodePath.join(REPO, 'test-support', 'fake-tmux.sh'),
        AGENT_WORKFORCE_FAKE_PANES: ctx.panesFile,
      } : {}),
    },
  });
  const parsed = JSON.parse(out);
  let json = {};
  try { json = JSON.parse(parsed.body); } catch { json = { raw: parsed.body }; }
  return { code: parsed.code, json, target, ctx };
}

test('#1689: a STOPPED agent on the account blocks removal', () => {
  const r = board((ctx) => {
    const dir = codexAccount(ctx.home, 'busy');
    agentOn(ctx, 'sleeper', dir, 'codex', false);   // no pane: invisible to liveness
    return dir;
  });
  assert.equal(r.code, 400, 'it must REFUSE. body: ' + JSON.stringify(r.json));
  assert.ok(fs.existsSync(r.target), 'refusing means the account directory did not move');
  assert.ok(Array.isArray(r.json.usedBy) && r.json.usedBy.includes('sleeper'),
    'and it must NAME the stopped agent, or the person cannot act on the refusal: '
    + JSON.stringify(r.json));
});

test('#1689 CONTROL: a RUNNING agent still blocks, so the fix did not trade one arm for the other', () => {
  const r = board((ctx) => {
    const dir = codexAccount(ctx.home, 'busy2');
    agentOn(ctx, 'awake', dir, 'codex', true);
    return dir;
  });
  assert.equal(r.code, 400, 'the pre-existing behaviour must survive. body: ' + JSON.stringify(r.json));
  assert.ok(Array.isArray(r.json.usedBy) && r.json.usedBy.includes('awake'), JSON.stringify(r.json));
});

test('#1689 CONTROL: an account with NO agents is still removable', () => {
  /* Without this the refusals above could be a gate that refuses everything, which
     would be a worse product than the bug. */
  const r = board((ctx) => codexAccount(ctx.home, 'empty'));
  assert.equal(r.code, 200, 'an unused account must still be removable. body: ' + JSON.stringify(r.json));
});

test('#1689 CONTROL: a REMOVED agent does NOT block, so the union cannot resurrect one', () => {
  /**
   * 🛑 THE ARM FOR A DEFECT I INTRODUCED. My first version unioned the profile
   * names RAW. `safeRoster` drops agents the person has removed, and a profile
   * file outlives that removal, so the raw union would have refused the account
   * because of an agent the person was already told was gone.
   */
  const remove = require('./engine/remove');
  const r = board((ctx) => {
    const dir = codexAccount(ctx.home, 'ghosted');
    agentOn(ctx, 'departed', dir, 'codex', false);
    /* Record it as removed, the way the product does. */
    const dataDir = nodePath.join(ctx.sb, 'data', 'AgentWorkforce');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(nodePath.join(dataDir, 'removed.json'),
      JSON.stringify([{ name: 'departed', removedAt: new Date().toISOString(), stopped: true }]));
    return dir;
  });
  assert.equal(r.code, 200,
    'a removed agent must not block: the person was already told it was gone. body: '
    + JSON.stringify(r.json));
  assert.ok(remove, 'engine/remove is the module whose record this arm depends on');
});

test('#1689 FAIL-CLOSED: an unreadable launch file REFUSES instead of proceeding', () => {
  /**
   * ⚠️ THE ARM THE FIX MOST NEEDS, and Angel named it. `jobMissing` separates "no
   * launch file" from "could not READ one" (#1447). A version that enumerates
   * launch files but treats an unreadable one as ABSENCE is that bug arriving
   * from the other side: it would look like a better check and be a worse one.
   */
  const fleet = require('./test-support/fleet');
  const r = board((ctx) => {
    const dir = codexAccount(ctx.home, 'guarded');
    ctx.panesFile = nodePath.join(ctx.sb, 'panes.txt');
    fs.writeFileSync(ctx.panesFile, fleet.line({ session: 'ghost' }) + '\n');
    fs.mkdirSync(nodePath.join(ctx.workers, 'ghost'), { recursive: true });
    /* A DIRECTORY where the plist belongs: readJob throws rather than answering. */
    fs.mkdirSync(nodePath.join(ctx.launch, 'com.kosmos.agent.ghost.plist'), { recursive: true });
    return dir;
  });
  assert.equal(r.code, 400, 'it must REFUSE, not proceed. body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not check which agents/,
    'and it must say it could not LOOK, not that nobody was there');
  assert.ok(fs.existsSync(r.target), 'refusing means nothing moved');
});
