'use strict';

/**
 * #2570: DISCONNECT AND STOP. Option 2 from #1659.
 *
 * #1659 shipped the safe half: an account with agents on it REFUSES, and names
 * them. This adds the useful half behind an explicit `stopAgents` flag, so one
 * press stops those agents and disconnects the account instead of sending the
 * person off to stop each one by hand.
 *
 * 🛑 THE FIRST ARM IN THIS FILE IS A CONTROL, AND IT IS THE MOST IMPORTANT ONE.
 * The whole design rests on the default request being unchanged. An arm that
 * only proves the new flag works would pass just as happily on a route that had
 * started stopping agents whether or not anyone asked.
 *
 *   node --test server.disconnect-stop-2570.test.js
 */

const test = require('node:test');
const store = require('./engine/store');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO = __dirname;

/* The #1659 harness, with the request body opened up. `extra` is spread into
   the DELETE body so an arm can send `stopAgents`, `remove`, or neither. */
function board(seed, extra, provider) {
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-stop-2570-'));
  const home = nodePath.join(sb, 'home');
  const launch = nodePath.join(sb, 'launch');
  const workers = nodePath.join(sb, 'workers');
  const bin = nodePath.join(sb, 'bin');
  for (const d of [home, launch, workers, bin]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(nodePath.join(bin, 'tmux'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  /* 🛑 A tmux THAT ACTUALLY KILLS, which `test-support/fake-tmux.sh` deliberately
     does not. That stub answers reads from fixtures and echoes every write, so
     `has-session` exits 0 forever: the removal's look-again always finds the
     session alive and every outcome here is PARTIAL. A stop that can never
     succeed cannot test a route whose whole subject is a successful stop.

     ⭐ IT IS NOT "ALWAYS GONE" EITHER, WHICH WOULD BE THE EASY VERSION AND WOULD
     MAKE THE ARMS VACUOUS. `kill-session` writes the session name into a file;
     `has-session` exits 1 only for a name in that file. So a route that skipped
     the kill gets exit 0, the look-again finds the session alive, and the arm
     goes red -- which is what makes a green one mean something. */
  const killed = nodePath.join(sb, 'killed.txt');
  fs.writeFileSync(nodePath.join(bin, 'tmux-stop'), [
    '#!/bin/sh',
    'KILLED=' + JSON.stringify(killed),
    'case "$1" in',
    '  list-panes)    [ -n "$AGENT_WORKFORCE_FAKE_PANES" ] && [ -f "$AGENT_WORKFORCE_FAKE_PANES" ] && cat "$AGENT_WORKFORCE_FAKE_PANES"; exit 0 ;;',
    '  list-sessions) exit 0 ;;',
    '  capture-pane)  exit 0 ;;',
    '  display-message) printf "2.1.212\t\t0\n"; exit 0 ;;',
    '  kill-session)  echo "$3" >> "$KILLED"; exit 0 ;;',
    '  has-session)   grep -qxF "$3" "$KILLED" 2>/dev/null && exit 1; exit 0 ;;',
    '  *) echo "$@"; exit 0 ;;',
    'esac',
  ].join('\n') + '\n', { mode: 0o755 });

  const ctx = { sb, home, launch, workers, bin };
  const target = seed(ctx);

  const script = `
    const http = require('node:http');
    const app = require(${JSON.stringify(nodePath.join(REPO, 'server.js'))});
    const srv = app.server || app;
    srv.listen(0, '127.0.0.1', () => {
      const body = JSON.stringify(Object.assign(
        { dir: process.env.FORGET_DIR },
        JSON.parse(process.env.FORGET_EXTRA || '{}'),
      ));
      const req = http.request({
        host: '127.0.0.1', port: srv.address().port,
        path: '/api/accounts/' + (process.env.FORGET_PROVIDER || 'claude'), method: 'DELETE',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (res) => {
        let s = ''; res.on('data', (d) => { s += d; }); res.on('end', () => {
          process.stdout.write(JSON.stringify({ code: res.statusCode, body: s.slice(0, 1400) }));
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
      FORGET_EXTRA: JSON.stringify(extra || {}),
      FORGET_PROVIDER: provider || 'claude',
      AGENT_WORKFORCE_DRY_RUN: '1',
      AGENT_WORKFORCE_HOME: home,
      AGENT_WORKFORCE_DATA: nodePath.join(sb, 'data'),
      AGENT_WORKFORCE_WORKERS: workers,
      AGENT_WORKFORCE_LAUNCH: launch,
      AGENT_WORKFORCE_PROJECTS: nodePath.join(sb, 'projects'),
      AGENT_WORKFORCE_TMUX_BIN: ctx.panesFile
        ? nodePath.join(bin, 'tmux-stop')
        : nodePath.join(bin, 'tmux'),
      ...(ctx.panesFile ? { AGENT_WORKFORCE_FAKE_PANES: ctx.panesFile } : {}),
    },
  });
  const parsed = JSON.parse(out);
  let json = null;
  try { json = JSON.parse(parsed.body); } catch { json = null; }
  return { ...ctx, code: parsed.code, json, target };
}

function account(home, label) {
  const dir = nodePath.join(home, '.claude-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: label + '@example.com' } }));
  return dir;
}

function codexAccount(home, label) {
  const dir = nodePath.join(home, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test-' + label }));
  return dir;
}

/* An agent with a readable launch file and a live pane, on a named account.
   `claim` lets an arm build a pane this machine does NOT own, which is what
   makes the removal primitive refuse. */
function agentOn(ctx, name, configDir, runner, claim) {
  const fleet = require('./test-support/fleet');
  const create = require('./engine/create');
  process.env.AGENT_WORKFORCE_LAUNCH = ctx.launch;
  fs.mkdirSync(nodePath.join(ctx.workers, name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, '/bin/claude', '/bin/tmux', null, configDir, runner), 'utf8');
  ctx.panesFile = ctx.panesFile || nodePath.join(ctx.sb, 'panes.txt');
  /* 🛑 THE CLAIM DEFAULTS TO THE SESSION'S OWN NAME, WHICH IS WHAT MAKES THE
     PANE OURS. `isNamedOurs` is true only when the tmux claim equals the pane's
     name; a pane with an EMPTY claim is a stranger's, and the removal primitive
     correctly refuses to stop it. The #1659 fixtures leave it empty because they
     only ever need the agent ENUMERATED, never stopped, so copying that helper
     verbatim made every happy-path arm here refuse. */
  fs.appendFileSync(ctx.panesFile,
    fleet.line({ session: name, claim: claim === undefined ? name : claim }) + '\n');
  assert.ok(fs.existsSync(create.plistPath(name)),
    'the seeded launch file is missing, so every assertion below would be right for the wrong reason');
}

/* 🔑 REGISTERED BUT NOT RUNNING: a launch file and a profile, and NO pane.
   This is the fixture every happy-path arm below uses, and the reason is worth
   stating rather than discovering.

   A dry-run board cannot produce a full stop of a RUNNING agent, by
   construction. `run()` returns `{ok:true}` for everything in dry-run, and the
   session-end check demands `has-session` exit 1 to prove the session has gone,
   so the look-again can never be satisfied and every running agent comes back
   PARTIAL. That is not a defect in either the product or the harness: it is the
   removal refusing to claim a kill it could not verify.

   An agent with no session has no session to end, so the launchd half is the
   whole act and the outcome is a real REMOVED. It is also the honest case for
   this card: the #1693/#1697 union means a registered-but-stopped agent BLOCKS
   the disconnect just as a running one does, so it is exactly the agent a
   person hits this refusal on. */
function registeredNotRunning(ctx, name, configDir, runner) {
  const create = require('./engine/create');
  process.env.AGENT_WORKFORCE_LAUNCH = ctx.launch;
  fs.mkdirSync(nodePath.join(ctx.workers, name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, '/bin/claude', '/bin/tmux', null, configDir, runner), 'utf8');
  const profiles = nodePath.join(ctx.sb, 'data', store.APP, 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, name + '.json'), JSON.stringify({ name }));
  assert.ok(fs.existsSync(create.plistPath(name)), 'the launch file is missing, so the arm proves nothing');
  assert.ok(!ctx.panesFile, 'this fixture must not write a pane, or the stop can never complete');
}

/* ── the control ─────────────────────────────────────────────────────────── */

test('#2570 CONTROL: with no stopAgents the route still REFUSES and names the agent, exactly as #1659 shipped', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'busy');
    agentOn(ctx, 'marlowe', dir, 'claude');
    return dir;
  });
  assert.equal(r.code, 400, 'the default must be unchanged. body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.usedBy, ['marlowe']);
  assert.match(String(r.json.error), /marlowe is set up to run on this account/);
  assert.ok(!('stopped' in r.json), 'nothing may report a stop when nobody asked for one');
  /* 🔑 AND NOT `notStopped` EITHER, which is the half that discriminates. A route
     that ignored the flag and always stopped would still answer 400 here, and
     still name `usedBy`, because the stop of a running agent cannot complete in
     this harness. Only the presence of a stop REPORT tells the two apart. */
  assert.ok(!('notStopped' in r.json), 'the stop loop ran without being asked');
  assert.ok(fs.existsSync(r.target), 'and the account is still there');
});

/* ── the feature ─────────────────────────────────────────────────────────── */

test('#2570: with stopAgents the agent is stopped and the account IS disconnected', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'busy');
    registeredNotRunning(ctx, 'marlowe', dir, 'claude');
    return dir;
  }, { stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
  assert.deepEqual(r.json.stopped, ['marlowe'], 'the answer must name who was stopped');
  assert.ok(!fs.existsSync(r.target), 'the account directory did not move, so the stop bought nothing');
});

/* 🔑 THE SENTENCE IS PART OF THE FEATURE. A stop the person cannot undo is a
   different product from a stop they can, and the only thing that tells them
   which one they got is this sentence. */
test('#2570: the answer says the agents can be restored, because the removal record makes that true', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'busy');
    registeredNotRunning(ctx, 'marlowe', dir, 'claude');
    return dir;
  }, { stopAgents: true });
  assert.match(String(r.json.because), /marlowe was stopped first/);
  assert.match(String(r.json.because), /restore it from the removed list/);
  /* And the original disconnect sentence survives: the stop note is APPENDED,
     never a replacement. Losing "nothing was deleted" would be the more
     alarming half going missing. */
  assert.match(String(r.json.because), /nothing was deleted/);
});

test('#2570: two agents are both stopped, and both are named', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'crowded');
    registeredNotRunning(ctx, 'marlowe', dir, 'claude');
    registeredNotRunning(ctx, 'spade', dir, 'claude');
    return dir;
  }, { stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual([...r.json.stopped].sort(), ['marlowe', 'spade']);
  assert.match(String(r.json.because), /2 agents were stopped first \(/);
  assert.match(String(r.json.because), /restore them from the removed list/);
});

/* ── the guards ──────────────────────────────────────────────────────────── */

/* 🛑 THE LOAD-BEARING ONE. `complete === false` means we do not know which
   agents are on this account. Stopping a GUESSED set is worse than refusing:
   the agent we missed goes on running against a directory that has been renamed
   out from under it, which is the #1659 hazard the refusal exists to prevent. */
test('#2570 FAIL-CLOSED: an unreadable launch file refuses and stops NOBODY, even with stopAgents', () => {
  const fleet = require('./test-support/fleet');
  const r = board((ctx) => {
    const dir = account(ctx.home, 'guarded');
    ctx.panesFile = nodePath.join(ctx.sb, 'panes.txt');
    fs.writeFileSync(ctx.panesFile, fleet.line({ session: 'ghost' }) + '\n');
    fs.mkdirSync(nodePath.join(ctx.workers, 'ghost'), { recursive: true });
    fs.mkdirSync(nodePath.join(ctx.launch, 'com.kosmos.agent.ghost.plist'), { recursive: true });
    return dir;
  }, { stopAgents: true });
  assert.equal(r.code, 400, 'it must REFUSE. body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not check which agents/,
    'and it must say it could not LOOK, not that a stop failed');
  assert.ok(!('stopped' in r.json), 'no stop may be reported from an uncertain enumeration');
  assert.ok(fs.existsSync(r.target), 'refusing means nothing moved');
  assert.ok(!fs.existsSync(nodePath.join(r.sb, 'data', store.APP, 'removed.json')),
    'an agent was recorded as removed on the path that must not act at all');
});

/* A stop that did not work must not be followed by a rename: that leaves a live
   agent pointing at a directory that no longer exists under that name. */
test('#2570 REFUSED: an agent the primitive refuses to stop leaves the account CONNECTED, and is named', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'stubborn');
    // A pane whose claim names somebody else: `isNamedOurs` is false, so the
    // removal plan refuses rather than killing a stranger's session.
    agentOn(ctx, 'borrowed', dir, 'claude', 'some-other-machine');
    return dir;
  }, { stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, [], 'nothing stopped, so nothing may be claimed as stopped');
  assert.deepEqual(r.json.notStopped.map((x) => x.name), ['borrowed'], 'the person needs the NAME');
  assert.match(String(r.json.error), /could not stop borrowed/);
  assert.ok(fs.existsSync(r.target), 'THE ACCOUNT MUST STILL BE CONNECTED: an agent is still live on it');
});

/* 🛑 THE OTHER HALF OF THE SAME RULE, AND IT IS THE ONE THAT WOULD HURT.
   A PARTIAL means the launchd job was disabled but the shut-down could not be
   CONFIRMED, so the agent may still be live. Renaming its account out from
   under it is the exact #1659 hazard, so the route must treat a PARTIAL as a
   failure and not as "mostly stopped".

   ⚠️ HOW THIS FIXTURE PRODUCES ONE, STATED PLAINLY BECAUSE IT IS A PROPERTY OF
   THE HARNESS RATHER THAN OF THE PRODUCT: a dry-run board answers every command
   with success, including the `has-session` look-again, and the removal will not
   claim a kill it cannot verify. So a RUNNING agent always comes back PARTIAL
   here. That is a faithful instance of "the boot-out could not be confirmed",
   which is the state this arm is about, and it is the reason every other arm in
   this file uses an agent with no session. */
test('#2570 PARTIAL: a stop that could not be confirmed also leaves the account CONNECTED', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'halfway');
    agentOn(ctx, 'marlowe', dir, 'claude');
    return dir;
  }, { stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.notStopped.map((x) => x.outcome), ['partial'],
    'the fixture stopped producing a PARTIAL, so this arm is no longer about what it says');
  assert.deepEqual(r.json.stopped, []);
  assert.ok(fs.existsSync(r.target), 'THE ACCOUNT MUST STILL BE CONNECTED while an agent may be live on it');
});

test('#2570: stopAgents is inert when no agent is on the account', () => {
  const r = board((ctx) => account(ctx.home, 'lonely'), { stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
  assert.ok(!('stopped' in r.json),
    'an empty stop list must not add a sentence about agents to an account that had none');
});

/* ── the other three doors ───────────────────────────────────────────────── */

/* #2264 put DELETE behind the same route. It is strictly more dangerous than a
   disconnect, so if the flag reached one and not the other, the more dangerous
   door would be the one still refusing (safe) or, worse, the one acting without
   the guard. Assert the pairing rather than assuming the shared code path. */
test('#2570: the DELETE door (remove:true) honours stopAgents too', () => {
  const r = board((ctx) => {
    const dir = account(ctx.home, 'busy');
    registeredNotRunning(ctx, 'marlowe', dir, 'claude');
    return dir;
  }, { stopAgents: true, remove: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.removed, true);
  assert.deepEqual(r.json.stopped, ['marlowe']);
  assert.ok(!fs.existsSync(r.target), 'the account was not deleted');
});

test('#2570: the OpenAI route stops its own agents the same way', () => {
  const r = board((ctx) => {
    const dir = codexAccount(ctx.home, 'busy');
    registeredNotRunning(ctx, 'codexer', dir, 'codex');
    return dir;
  }, { stopAgents: true }, 'openai');
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, ['codexer'], 'the OpenAI door must not be the one that still refuses');
  assert.match(String(r.json.because), /restore it from the removed list/);
});

test('#2570 CONTROL: the OpenAI route with no flag still refuses and names the agent', () => {
  const r = board((ctx) => {
    const dir = codexAccount(ctx.home, 'busy');
    agentOn(ctx, 'codexer', dir, 'codex');
    return dir;
  }, {}, 'openai');
  assert.equal(r.code, 400, 'the OpenAI default must be unchanged too. body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.usedBy, ['codexer']);
  assert.ok(!('notStopped' in r.json), 'the stop loop ran on the OpenAI route without being asked');
  assert.ok(fs.existsSync(r.target));
});
