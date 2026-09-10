'use strict';

/**
 * #2570: DISCONNECT AND STOP. Option 2 from #1659.
 *
 * #1659 shipped the safe half: an account with agents on it REFUSES to
 * disconnect, and names them. This adds the useful half behind an explicit
 * `stopAgents` flag, so one press stops those agents and disconnects the
 * account instead of sending the person off to stop each one by hand.
 *
 * 🛑 THE FIRST ARM IS A CONTROL, AND IT IS THE MOST IMPORTANT ONE. The whole
 * design rests on the default request being unchanged. An arm that only proved
 * the new flag works would pass just as happily on a route that had started
 * stopping agents whether or not anyone asked.
 *
 * 🔑 WHY THIS FILE RUNS THE SERVER IN-PROCESS AND INJECTS A RUNNER, unlike its
 * #1659 sibling which spawns a sandboxed subprocess. Under `DRY_RUN` alone,
 * `engine/remove.js` short-circuits EVERY command (`run()` returns success
 * without executing) and `recordRemoval` returns true without writing. So a
 * subprocess suite can never produce a real stop: every outcome is PARTIAL,
 * the tmux fake's kill and look-again branches are never reached, and the
 * "you can restore them" promise can only be asserted as a substring of a
 * sentence rather than as the removal record that makes it true.
 *
 * `removal.setRunner` intercepts at the same seam production uses, so the stop
 * is real: `removed.json` is written, and the arms below assert it. DRY_RUN
 * stays armed underneath as the fail-safe -- with a runner installed `run()`
 * never reaches it, but if the runner were ever missing the suite dry-runs
 * instead of stopping the operator's own agents.
 *
 *   node --test server.disconnect-stop-2570.test.js
 */

const os = require('node:os');
const fs = require('node:fs');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-stop-2570-'));
const HOME = nodePath.join(SANDBOX, 'home');
const LAUNCH = nodePath.join(SANDBOX, 'launch');
const WORKERS = nodePath.join(SANDBOX, 'workers');
const DATA = nodePath.join(SANDBOX, 'data');
const PANES = nodePath.join(SANDBOX, 'panes.txt');
for (const d of [HOME, LAUNCH, WORKERS, DATA]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(PANES, '');

/* Every root sandboxed BEFORE any require, the same discipline server.connect.test.js
   states: several engines fix their paths at load, and one unsandboxed root makes the
   suite decide from the operator's real fleet. */
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = DATA;
process.env.AGENT_WORKFORCE_WORKERS = WORKERS;
process.env.AGENT_WORKFORCE_LAUNCH = LAUNCH;
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = nodePath.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = nodePath.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const store = require('./engine/store');
const { start, server } = require('./server');
const removal = require('./engine/remove');
const create = require('./engine/create');

const REMOVED_JSON = nodePath.join(SANDBOX, 'data', store.APP, 'removed.json');

let base;
test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  /* Clearing the runner re-arms dry-run (remove.js:96), so the process cannot
     end up in a state where a stray call reaches a real launchctl. */
  removal.setRunner(null);
  try { server.close(); } catch { /* already down */ }
});

/* The injected runner. It answers the four commands a removal actually makes.
   `sessionsStillAlive` is what makes a PARTIAL producible on purpose: the
   look-again after the kill is the check that decides REMOVED versus PARTIAL,
   and a route that skipped the kill would leave the session alive here. */
let sessionsStillAlive = new Set();
let calls = [];
function installRunner() {
  sessionsStillAlive = new Set();
  calls = [];
  /* 🛑 THE PANE LIST IS TRUNCATED PER ARM, NOT APPENDED TO. Appending made every
     arm inherit every earlier arm's agents, and the enumeration is fail-closed:
     ONE undiagnosable agent anywhere makes `complete` false for every account,
     so the fail-closed fixture silently turned all seven arms after it into the
     same "could not check" answer. They failed loudly here, which is luck; an
     arm asserting a 400 would have passed for the wrong reason. */
  fs.writeFileSync(PANES, '');
  removal.setRunner((file, args) => {
    calls.push([file, ...(args || [])].join(' '));
    const verb = (args || [])[0];
    if (verb === 'has-session') {
      const target = String((args || [])[2] || '').replace(/^=/, '');
      return sessionsStillAlive.has(target)
        ? { ok: true, stdout: '' }               // still there: the stop is a PARTIAL
        : { ok: false, code: 1 };                // gone: tmux answers 1, which is success here
    }
    return { ok: true, stdout: '' };
  });
}

function readRemoved() {
  try { return JSON.parse(fs.readFileSync(REMOVED_JSON, 'utf8')); } catch { return []; }
}
function removedNames() {
  const list = readRemoved();
  return (Array.isArray(list) ? list : []).map((r) => r && r.name).filter(Boolean);
}

async function del(provider, body) {
  const res = await fetch(`${base}/api/accounts/${provider}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { code: res.status, json };
}

function claudeAccount(label) {
  const dir = nodePath.join(HOME, '.claude-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: label + '@example.com' } }));
  return dir;
}
function codexAccount(label) {
  const dir = nodePath.join(HOME, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'sk-test-' + label }));
  return dir;
}

/* A running agent: a launch file naming the account, and a live pane.
   🛑 THE CLAIM DEFAULTS TO THE SESSION'S OWN NAME, WHICH IS WHAT MAKES THE PANE
   OURS. `isNamedOurs` is true only when the tmux claim equals the pane's name; a
   pane with an EMPTY claim belongs to a stranger and the removal correctly
   refuses to touch it. The #1659 fixtures leave it empty because they only need
   the agent ENUMERATED, never stopped. */
function agentOn(name, configDir, runner, claim) {
  const fleet = require('./test-support/fleet');
  fs.mkdirSync(nodePath.join(WORKERS, name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, '/bin/claude', '/bin/tmux', null, configDir, runner), 'utf8');
  fs.appendFileSync(PANES,
    fleet.line({ session: name, claim: claim === undefined ? name : claim }) + '\n');
  assert.ok(fs.existsSync(create.plistPath(name)),
    'the seeded launch file is missing, so every assertion below would be right for the wrong reason');
}

/* Registered but NOT running: a launch file and a profile, no pane. The
   #1693/#1697 union means these block a disconnect exactly as a running agent
   does, so they are a real case rather than a convenience. */
function registeredNotRunning(name, configDir, runner) {
  fs.mkdirSync(nodePath.join(WORKERS, name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, '/bin/claude', '/bin/tmux', null, configDir, runner), 'utf8');
  const profiles = nodePath.join(DATA, store.APP, 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  fs.writeFileSync(nodePath.join(profiles, name + '.json'), JSON.stringify({ name }));
}

/* ── the control ─────────────────────────────────────────────────────────── */

test('#2570 CONTROL: with no stopAgents the route still REFUSES and names the agent, exactly as #1659 shipped', async () => {
  installRunner();
  const dir = claudeAccount('busy');
  agentOn('marlowe', dir, 'claude');
  const r = await del('claude', { dir });
  assert.equal(r.code, 400, 'the default must be unchanged. body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.usedBy, ['marlowe']);
  assert.match(String(r.json.error), /marlowe is set up to run on this account/);
  assert.ok(!('stopped' in r.json), 'nothing may report a stop when nobody asked for one');
  /* 🔑 AND NOT `notStopped` EITHER, which is the half that discriminates. A route
     that ignored the flag and always stopped could still answer 400 and still
     name `usedBy`; only the presence of a stop REPORT tells the two apart. */
  assert.ok(!('notStopped' in r.json), 'the stop loop ran without being asked');
  assert.deepEqual(calls, [], 'the runner was called, so something tried to stop an agent unasked');
  assert.ok(fs.existsSync(dir), 'and the account is still there');
});

/* ── the feature ─────────────────────────────────────────────────────────── */

test('#2570: with stopAgents the agent is really stopped and the account IS disconnected', async () => {
  installRunner();
  const dir = claudeAccount('busy2');
  agentOn('spade', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
  assert.deepEqual(r.json.stopped, ['spade'], 'the answer must name who was stopped');
  assert.ok(!fs.existsSync(dir), 'the account directory did not move, so the stop bought nothing');
  /* THE STOP IS REAL, not a reported one. Both halves of the primitive ran. */
  assert.ok(calls.some((c) => /launchctl disable .*spade/.test(c)), 'the launchd job was never disabled');
  assert.ok(calls.some((c) => /launchctl bootout .*spade/.test(c)), 'the launchd job was never booted out');
  assert.ok(calls.some((c) => /kill-session -t =spade/.test(c)), 'the session was never killed');
  assert.ok(calls.some((c) => /has-session -t =spade/.test(c)),
    'nothing looked again after the kill, so a reported stop was never verified');
  const disableAt = calls.findIndex((c) => /launchctl disable/.test(c));
  const bootoutAt = calls.findIndex((c) => /launchctl bootout/.test(c));
  assert.ok(disableAt >= 0 && disableAt < bootoutAt,
    'bootout ran before disable, so KeepAlive can revive the job it just stopped');
});

/* 🔑 THE SENTENCE IS PART OF THE FEATURE, AND THE RECORD IS WHAT MAKES IT TRUE.
   A stop the person cannot undo is a different product from one they can. */
test('#2570: the stopped agent is on the removed list, which is what the answer promises', async () => {
  installRunner();
  const dir = claudeAccount('busy3');
  agentOn('archer', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.because), /archer was stopped first/);
  assert.match(String(r.json.because), /put it back from the removed list once you add this account again under the same name/);
  assert.ok(removedNames().includes('archer'),
    'the answer says the agent can be restored, and no removal record was written, so it cannot be');
  /* And the original disconnect sentence survives: the stop note is APPENDED,
     never a replacement. Losing "nothing was deleted" would be the more
     alarming half going missing. */
  assert.match(String(r.json.because), /nothing was deleted/);
});

test('#2570: two agents are both stopped, and both are named', async () => {
  installRunner();
  const dir = claudeAccount('crowded');
  registeredNotRunning('wolfe', dir, 'claude');
  registeredNotRunning('goodwin', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual([...r.json.stopped].sort(), ['goodwin', 'wolfe']);
  assert.match(String(r.json.because), /2 agents were stopped first \(/);
  assert.match(String(r.json.because), /put them back from the removed list once you add this account again under the same name/);
});

/* ── the guards ──────────────────────────────────────────────────────────── */

/* 🛑 THE LOAD-BEARING ONE. `complete === false` means we do not know which
   agents are on this account. Stopping a GUESSED set is worse than refusing:
   the agent we missed goes on running against a directory renamed out from
   under it, which is the #1659 hazard the refusal exists to prevent. */
test('#2570 FAIL-CLOSED: an unreadable launch file refuses and stops NOBODY, even with stopAgents', async () => {
  installRunner();
  const fleet = require('./test-support/fleet');
  const dir = claudeAccount('guarded');
  fs.appendFileSync(PANES, fleet.line({ session: 'ghost', claim: 'ghost' }) + '\n');
  fs.mkdirSync(nodePath.join(WORKERS, 'ghost'), { recursive: true });
  // A DIRECTORY where the launch file should be: readJob throws, jobMissing says
  // it is not simply absent, so `complete` goes false.
  fs.mkdirSync(create.plistPath('ghost'), { recursive: true });
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'it must REFUSE. body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not check which agents/,
    'and it must say it could not LOOK, not that a stop failed');
  assert.ok(!('stopped' in r.json), 'no stop may be reported from an uncertain enumeration');
  assert.deepEqual(calls, [], 'the stop loop ran on a set we could not enumerate');
  assert.ok(!removedNames().includes('ghost'), 'an agent was recorded as removed on the path that must not act');
  assert.ok(fs.existsSync(dir), 'refusing means nothing moved');
  /* Undo the undiagnosable agent. It is not scoped to this account: `complete`
     is a property of the whole enumeration, so leaving it behind would make
     every later arm answer "could not check" no matter what it was testing. */
  fs.rmSync(create.plistPath('ghost'), { recursive: true, force: true });
});

/* 🛑 A PARTIAL means the launchd job was disabled but the shut-down could not be
   CONFIRMED, so the agent may still be live. Renaming its account out from under
   it is the exact #1659 hazard, so a PARTIAL is a failure and not "mostly
   stopped". Produced deliberately here: the injected runner reports the session
   still alive when the removal looks again after the kill. */
test('#2570 PARTIAL: a stop that could not be confirmed leaves the account CONNECTED', async () => {
  installRunner();
  const dir = claudeAccount('halfway');
  agentOn('quirke', dir, 'claude');
  sessionsStillAlive.add('quirke');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.notStopped.map((x) => x.outcome), ['partial'],
    'the fixture stopped producing a PARTIAL, so this arm is no longer about what it says');
  assert.deepEqual(r.json.stopped, []);
  assert.ok(fs.existsSync(dir), 'THE ACCOUNT MUST STILL BE CONNECTED while an agent may be live on it');
});

test('#2570 REFUSED: an agent the primitive will not touch leaves the account CONNECTED, and is named', async () => {
  installRunner();
  const dir = claudeAccount('stubborn');
  // A pane whose claim names somebody else: `isNamedOurs` is false, so the
  // removal plan refuses rather than killing a stranger's session.
  agentOn('borrowed', dir, 'claude', 'some-other-machine');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, [], 'nothing stopped, so nothing may be claimed as stopped');
  assert.deepEqual(r.json.notStopped.map((x) => x.name), ['borrowed'], 'the person needs the NAME');
  assert.match(String(r.json.error), /could not stop borrowed/);
  assert.ok(fs.existsSync(dir), 'THE ACCOUNT MUST STILL BE CONNECTED: an agent is still live on it');
});

/* 🛑 THE DRY-RUN ARM, and it is the reason this file injects a runner at all.
   With no runner, `remove()` answers REMOVED having executed nothing and
   written no record. A route that trusted that outcome would clear `usedBy` and
   go on to a REAL rename, taking the account out from under agents that are
   still running, and then tell the person they can restore them. */
test('#2570: a "removed" from commands that never ran is not a stop, and the account is left alone', async () => {
  removal.setRunner(null);          // re-arms dry-run (remove.js:96)
  calls = [];
  fs.writeFileSync(PANES, '');
  const dir = claudeAccount('dryrun');
  /* 🛑 REGISTERED-BUT-NOT-RUNNING, AND THE CHOICE IS THE WHOLE ARM. A RUNNING
     agent under dry-run comes back PARTIAL, because the look-again after the
     kill answers "still there" and the removal will not claim an unverified
     kill. PARTIAL is refused by the outcome check one line up, so this arm
     would go green with the dry-run guard DELETED, and its `/dry-run/` match
     would be satisfied by markDryRun's own appended sentence rather than by
     the guard's. Measured: with `agentOn` here, removing the guard left all
     twelve arms green. An agent with no session has no session to end, so
     dry-run produces a real REMOVED, which is the one outcome that lies and
     the only one that reaches the guard. */
  registeredNotRunning('lamb', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'a dry-run stop was accepted as real. body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, []);
  assert.deepEqual(r.json.notStopped.map((x) => x.name), ['lamb']);
  /* 🔑 WHICH HALF OF THE GUARD THIS ARM PROVES, stated rather than blurred.
     `removal.commandsAreReal()` is false here for the SECOND reason, not the
     first: no runner is installed, and live execution is not armed in this
     process because server.js arms it inside `if (require.main === module)` and
     the suite REQUIRES the module. That is the path a top-level `dryRun` marker
     never covers (`markDryRun` marks only the DRY_RUN-flag path), and it is
     therefore the one a route could not otherwise see.

     ⚠️ THE OTHER HALF IS NOT COVERED HERE AND CANNOT BE. `markDryRun` marks only
     when no runner is installed, and with no runner `commandsAreReal()` already
     answers false, so the two conditions are mutually exclusive in this harness.
     Both are reachable in production (a real board arms live execution, and an
     operator can still set AGENT_WORKFORCE_DRY_RUN in its environment), which is
     why the guard tests both. */
  assert.equal(removal.commandsAreReal(), false,
    'commands would really run here, so this arm is not about a stop that never happened');
  assert.equal(String(r.json.notStopped[0].because),
    'no command actually ran, so nothing was stopped',
    'the reason is not the guard\'s, so this arm may be passing on an adjacent string');
  assert.equal(r.json.notStopped[0].outcome, removal.OUTCOME.REMOVED,
    'the underlying outcome must be the lying REMOVED; anything else and the guard was never reached');
  assert.equal(r.json.notStopped[0].verified, false, 'the verdict field must be the thing that refused it');
  assert.ok(fs.existsSync(dir), 'THE ACCOUNT MUST STILL BE THERE: nothing was actually stopped');
});

test('#2570: stopAgents is inert when no agent is on the account', async () => {
  installRunner();
  const dir = claudeAccount('lonely');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, true);
  assert.ok(!('stopped' in r.json),
    'an empty stop list must not add a sentence about agents to an account that had none');
  assert.deepEqual(calls, [], 'nothing should have been stopped');
});

/* 🛑 THE ENGINE'S OTHER REFUSALS DO NOT CARE ABOUT THE AGENTS, AND THIS IS THE
   ARM FOR IT. `forgetAccount` and `removeAccount` both refuse the DEFAULT folder
   outright, and that check runs BEFORE their agents check. So without a
   pre-flight, a request naming the default account stopped every agent on it,
   for real, recorded each one, and then answered 400 with a refusal that never
   mentioned the stop. Deterministic. Not reachable from the page (the default
   row renders no control) and fully reachable from the board API and the CLI. */
test('#2570 PRE-FLIGHT: a refusal that has nothing to do with the agents stops NOBODY', async () => {
  installRunner();
  const dir = nodePath.join(HOME, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, '.claude.json'),
    JSON.stringify({ oauthAccount: { emailAddress: 'main@example.com' } }));
  agentOn('holmes', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /main Claude folder/,
    'the answer must be the engine\'s own refusal, not a stop report');
  assert.deepEqual(calls, [],
    'AGENTS WERE STOPPED FOR AN ACCOUNT THAT WAS NEVER GOING TO BE DISCONNECTED');
  assert.ok(!removedNames().includes('holmes'), 'and none was written to the removed list');
  assert.ok(fs.existsSync(dir), 'the default folder must still be there');
});

/* 🛑 A FAILURE AFTER THE STOP SUCCEEDED. Every one of these four paths used to
   answer with the engine's sentence alone, so the person was told the account
   was untouched while N of their agents had just been stopped, with nothing on
   screen saying so. Forced here by filling every name `forgetAccount` would move
   the account to, which is a real refusal it carries for exactly this reason. */
test('#2570: when the account operation fails AFTER the stop, the answer says the agents are stopped', async () => {
  installRunner();
  const dir = claudeAccount('boxedin');
  registeredNotRunning('lestrade', dir, 'claude');
  // `.removed-claude-boxedin`, then -2 .. -499: the loop gives up at 500.
  fs.mkdirSync(nodePath.join(HOME, '.removed-claude-boxedin'), { recursive: true });
  for (let n = 2; n < 500; n += 1) {
    fs.mkdirSync(nodePath.join(HOME, `.removed-claude-boxedin-${n}`), { recursive: true });
  }
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.match(String(r.json.error), /could not find a free name/, 'the engine refusal must survive');
  assert.deepEqual(r.json.stopped, ['lestrade'],
    'the answer does not say which agents are already stopped, so the person cannot act on it');
  assert.match(String(r.json.error), /lestrade was already stopped, and it is still stopped/);
  assert.match(String(r.json.error), /put it back from the removed list/,
    'a disconnect that failed after stopping must still name the way back');
  assert.ok(fs.existsSync(dir), 'the account is still connected, which is what the refusal says');
});

/* ── the other three doors ───────────────────────────────────────────────── */

/* #2264 put DELETE behind the same route. It is strictly more dangerous than a
   disconnect, so assert the pairing rather than assuming the shared code path. */
test('#2570: the DELETE door honours stopAgents, and does NOT promise a restore', async () => {
  installRunner();
  const dir = claudeAccount('doomed');
  agentOn('maigret', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true, remove: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.removed, true);
  assert.deepEqual(r.json.stopped, ['maigret']);
  assert.ok(!fs.existsSync(dir), 'the account was not deleted');
  /* 🛑 THE SENTENCE MUST DIFFER FROM THE DISCONNECT DOOR'S. The account
     directory is GONE, so restoring the agent would re-enable a launchd job
     whose config dir does not exist, and a fresh sign-in makes a
     differently-named directory anyway. */
  assert.doesNotMatch(String(r.json.because), /restore/i,
    'the delete door promises a restore that cannot work');
  assert.match(String(r.json.because), /needs a different one before it can start again/);
});

test('#2570: the OpenAI route stops its own agents the same way', async () => {
  installRunner();
  const dir = codexAccount('busy');
  agentOn('poirot', dir, 'codex');
  const r = await del('openai', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, ['poirot'], 'the OpenAI door must not be the one that still refuses');
  assert.match(String(r.json.because), /put it back from the removed list once you add this account again under the same name/);
  assert.ok(removedNames().includes('poirot'), 'no removal record, so the restore promise is false here too');
});

/* Delete is the more dangerous door, and it was covered on one provider only.
   The `restorable=false` copy branch and the OpenAI removeAccount pairing are
   what this adds. */
test('#2570: the OpenAI DELETE door honours stopAgents, and does NOT promise a restore', async () => {
  installRunner();
  const dir = codexAccount('doomed');
  registeredNotRunning('lupin', dir, 'codex');
  const r = await del('openai', { dir, stopAgents: true, remove: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.removed, true);
  assert.deepEqual(r.json.stopped, ['lupin']);
  assert.ok(!fs.existsSync(dir), 'the account was not deleted');
  assert.doesNotMatch(String(r.json.because), /put it back|restore/i,
    'the OpenAI delete door promises a way back that cannot work');
  assert.match(String(r.json.because), /needs a different one before it can start again/);
});

test('#2570 CONTROL: the OpenAI route with no flag still refuses and names the agent', async () => {
  installRunner();
  const dir = codexAccount('busy2');
  agentOn('marple', dir, 'codex');
  const r = await del('openai', { dir });
  assert.equal(r.code, 400, 'the OpenAI default must be unchanged too. body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.usedBy, ['marple']);
  assert.ok(!('notStopped' in r.json), 'the stop loop ran on the OpenAI route without being asked');
  assert.deepEqual(calls, [], 'the runner was called, so something tried to stop an agent unasked');
  assert.ok(fs.existsSync(dir));
});
