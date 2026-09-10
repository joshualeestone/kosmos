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
  /* 🛑 AND IT MUST NOT SAY "nothing was changed", WHICH IS WHAT IT USED TO SAY.
     On a PARTIAL the launchd job IS disabled and the removed-list record IS
     written before the look-again fails, so the agent's card has left the board
     and it is on the removed list. This arm asserted the code and the arrays and
     never the sentence, which is how that claim survived.
     ⚠️ The engine's own per-agent reason is what reaches the screen, because the
     page renders `error` and never reads `notStopped[].because`. */
  assert.doesNotMatch(String(r.json.error), /nothing was changed/,
    'a PARTIAL disabled the job and wrote a removal record, so nothing-was-changed is false');
  assert.match(String(r.json.error), /^This account was left connected\. quirke: /,
    'the engine per-agent reason did not reach the sentence the page renders');
  assert.match(String(r.json.error), /put it back from the removed list/,
    'the person is not told the agent is on the removed list, which it is');
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

/* ⚠️ THE QUIET-SUCCESS BRANCH, which is the one place a real stop could go
   unmentioned. Both engines answer `{ok: true, forgotten: false}` for an account
   that is not there, and the page renders `because` and never reads the
   `stopped` array, so a person whose agents were really just stopped would see
   only "That account was already gone from this computer." Reachable exactly as
   documented: a launch file naming a directory that has since gone. */
test('#2570: an account that was already gone still SAYS the agents were stopped', async () => {
  installRunner();
  const dir = nodePath.join(HOME, '.claude-ghosted');   // never created
  registeredNotRunning('sherlock', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.forgotten, false, 'this arm is about the quiet-success branch');
  assert.deepEqual(r.json.stopped, ['sherlock']);
  assert.match(String(r.json.because), /already gone from this computer/, 'the engine sentence must survive');
  assert.match(String(r.json.because), /sherlock was stopped first/,
    'the page renders `because` only, so a stop the sentence omits is a stop nobody is told about');
  /* And NOT the re-add condition, which is what was nonsense here: there is no
     account to add again under the same name. */
  assert.doesNotMatch(String(r.json.because), /under the same name/,
    'it promises a way back that names re-adding an account that was never there');
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

/* 🛑 THE REFUSAL THE PRE-FLIGHT STRUCTURALLY CANNOT SEE. The engine's identity
   guard ("that is not a Claude account on this computer") sits AFTER its agents
   guard in all four functions, and cannot be hoisted: `identityOf` answers null
   for a missing directory too, so moving it above the existence check would turn
   "already gone" into "not an account". So a directory that exists with an
   account-shaped name but no credential would have had every agent on it stopped
   before the refusal arrived. Reachable when a credential is removed out from
   under still-registered agents. The route asks `list()` instead, which is the
   engine's own answer to the same question. */
test('#2570: a directory that is not an account stops NOBODY, even with stopAgents', async () => {
  installRunner();
  // Account-shaped name, real directory, NO credential file: `list()` omits it
  // and the engine's identity guard refuses it, but only after its agents guard.
  const dir = nodePath.join(HOME, '.claude-hollow');
  fs.mkdirSync(dir, { recursive: true });
  registeredNotRunning('adler', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(calls, [],
    'AGENTS WERE STOPPED FOR A DIRECTORY THAT WAS NEVER AN ACCOUNT');
  assert.ok(!removedNames().includes('adler'), 'and none was written to the removed list');
  assert.ok(!('stopped' in r.json), 'no stop may be reported');
  assert.ok(fs.existsSync(dir), 'nothing was renamed or deleted');
  /* The sentence is the AGENTS refusal, not the identity one, and that is the
     documented trade: clearing `usedBy` to get the better sentence would rely on
     guard ordering that has been wrong three times on this branch, and the
     failure mode there is a real rename under live agents. Pinned so the trade is
     visible rather than assumed. */
  assert.match(String(r.json.error), /adler is set up to run on this account/,
    'if this is now the identity sentence, the route started clearing usedBy: re-read the trade');
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
  assert.deepEqual(r.json.stopped, ['lestrade'],
    'the answer does not say which agents are already stopped, so the person cannot act on it');
  /* 🛑 THE WHOLE SENTENCE, NOT TWO SUBSTRINGS. This arm used to match
     /could not find a free name/ and /lestrade was already stopped/ separately,
     and both matched while the text BETWEEN them was a run-on: the engine's
     reason has no trailing stop, so the join read "...to move that account to
     lestrade was already stopped", which sounds like the account was being moved
     TO an agent. Two passing substring matches cannot see the sentence they sit
     in; only reading it whole can. */
  assert.equal(String(r.json.error),
    'we could not find a free name to move that account to. lestrade was already stopped, '
    + 'and it is still stopped. You can put it back from the removed list.',
    'the joined sentence is not what a person would read');
  assert.ok(fs.existsSync(dir), 'the account is still connected, which is what the refusal says');
});

/* 🛑 THE MIXED CASE, which is the only shape the failure sentence has when one
   agent stops and one does not, and it was the one sentence of the four with no
   test at all. It also read "Put the stopped ones back ... or stop the rest
   yourself" with exactly one agent on each side. */
test('#2570: one stopped and one not names BOTH agents, singular', async () => {
  installRunner();
  const dir = claudeAccount('mixed');
  registeredNotRunning('watson', dir, 'claude');        // stops cleanly
  agentOn('mycroft', dir, 'claude', 'another-machine'); // not ours: the primitive refuses
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, ['watson']);
  assert.deepEqual(r.json.notStopped.map((x) => x.name), ['mycroft']);
  assert.equal(String(r.json.error),
    'We stopped watson but could not stop mycroft, so this account was left connected. '
    + 'Put watson back from the removed list, or stop mycroft yourself and try again.',
    'the mixed-case sentence is not what a person would read');
  assert.ok(fs.existsSync(dir), 'an agent may still be live on it, so it stays connected');
});

/* 🔑 A PIN ON AN ORDERING THE ROUTE DEPENDS ON, IN ANOTHER MODULE. The
   disconnect-and-stop pre-flight learns the engine's non-agents refusals by
   calling it with a NON-EMPTY `usedBy`, which means it can only ever see checks
   that run BEFORE the agents guard. The OpenAI reauth refusal used to sit after
   it, so a stopAgents request against an account with a sign-in in flight
   stopped every agent and only then refused.

   ⚠️ ASSERTED ON THE SOURCE, and the reason is worth stating rather than hiding:
   reserving a reauth dir means driving `startChatgptLogin`, which launches a real
   sign-in. A behavioural arm is the better test and is not worth a live login in
   this suite, so this pins the ORDER instead and says so. It goes red if anybody
   moves either guard back. */
test('#2570: every OpenAI refusal that ignores the agents runs BEFORE the agents guard', () => {
  const src = fs.readFileSync(nodePath.join(__dirname, 'engine', 'openaiaccounts.js'), 'utf8');
  for (const fn of ['function forgetAccount(dir, usedBy) {', 'function removeAccount(dir, usedBy) {']) {
    const start = src.indexOf(fn);
    assert.ok(start > 0, `${fn} moved or was renamed; restate this pin`);
    const body = src.slice(start, start + 6000);
    const reauth = body.indexOf('activeChatgptDirs.has(clean)');
    const agents = body.indexOf('const agents = (Array.isArray(usedBy)');
    assert.ok(reauth > 0 && agents > 0, `${fn}: could not find both guards, so this pin proves nothing`);
    assert.ok(reauth < agents,
      `${fn}: the sign-in-in-progress refusal sits AFTER the agents guard, so #2570's `
      + 'pre-flight cannot see it and will stop every agent on the account before learning '
      + 'the operation was refused');
  }
});

/* 🛑 CONSENT: THE SET NAMED AND THE SET ACTED ON MUST MATCH. The confirm names
   the agents from the first refusal; the route re-enumerates at press time. An
   agent created on the account in between would otherwise be stopped having
   never been shown to anybody. */
test('#2570: an agent the confirm never named is REFUSED, not swept along', async () => {
  installRunner();
  const dir = claudeAccount('newcomer');
  registeredNotRunning('hastings', dir, 'claude');
  registeredNotRunning('japp', dir, 'claude');       // appeared after the confirm
  // The page would have named only `hastings` on the first refusal.
  const r = await del('claude', { dir, stopAgents: true, stopNames: ['hastings'] });
  assert.equal(r.code, 400, 'body: ' + JSON.stringify(r.json));
  assert.equal(r.json.consentStale, true, 'the page needs a flag to know it may re-offer');
  assert.match(String(r.json.error), /japp is also set up to run on this account now/);
  assert.match(String(r.json.error), /you were not asked about it/);
  assert.deepEqual([...r.json.usedBy].sort(), ['hastings', 'japp'],
    'the answer must carry the CURRENT set, or the re-offer names the stale one again');
  assert.deepEqual(calls, [], 'NOBODY may be stopped on a consent mismatch, including the named one');
  assert.ok(fs.existsSync(dir));
});

test('#2570: naming the whole set proceeds, so the consent check is not just a wall', async () => {
  installRunner();
  const dir = claudeAccount('agreed');
  registeredNotRunning('poirot2', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true, stopNames: ['poirot2'] });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, ['poirot2']);
});

/* A board API caller that sends no names is unchanged, deliberately: `stopAgents`
   alone is a complete request and demanding a list would break every caller that
   is not this page. */
test('#2570 CONTROL: a caller that sends no stopNames is not held to a consent set', async () => {
  installRunner();
  const dir = claudeAccount('nonames');
  registeredNotRunning('lecoq', dir, 'claude');
  const r = await del('claude', { dir, stopAgents: true });
  assert.equal(r.code, 200, 'body: ' + JSON.stringify(r.json));
  assert.deepEqual(r.json.stopped, ['lecoq']);
  assert.ok(!('consentStale' in r.json));
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
