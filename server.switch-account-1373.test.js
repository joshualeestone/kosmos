/**
 * THE PROVIDER ROUTE, DRIVEN OVER HTTP. #1373.
 *
 * 🛑 WHY THIS FILE EXISTS, AND WHY IT IS NOT IN `server.test.js`.
 *
 * Every other layer of #1373 has an arm that RUNS: the engine is driven directly
 * by `engine/create.switch-account-1373.test.js`, and the page is rendered by
 * `docs/browser-checks/render-model-change.js`. The route between them was pinned
 * only by regexes matching `server.js` against itself, and a review proved what
 * that misses: DELETING `+ landedOn` FROM THE OK-BRANCH SENTENCE LEFT EVERY
 * ASSERTION GREEN, because a source regex inspects the `const landedOn = ...`
 * expression and never its use.
 *
 * ⚠️ THE REASON THIS WAS DEFERRED FOR A LONG TIME WAS REFUTED AND I KEPT CITING IT.
 * The stated blocker was that `AGENT_WORKFORCE_DRY_RUN` is the only thing making
 * the route safe to drive, and it also disables the account block, so any test
 * would measure a world where the feature never ran. That is false: `run()` in
 * `engine/create.js` checks `runner` BEFORE `DRY_RUN`, so `setRunner(fake)`
 * intercepts every external call while the feature stays live. Verified in this
 * file by the control at the bottom, which asserts the account block really did
 * execute rather than trusting that it did.
 *
 * 🛑 AND WHY NOT IN `server.test.js`: that suite states plainly that it NEVER SETS
 * `AGENT_WORKFORCE_HOME`, and at least one of its arms reasons from that fact.
 * `openaiaccounts.homeDir()` is `AGENT_WORKFORCE_HOME || os.homedir()`, so a route
 * test added there would enumerate THE OPERATOR'S REAL `~/.codex-*` SIGN-INS.
 * On a machine with none it would pass vacuously; on a machine with some it reads
 * private accounts into a test fixture. Sealing that root there would change an
 * invariant another test depends on, so this file seals its own instead.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

/* Sealed BEFORE anything is required, because `openaiaccounts` resolves its home
   lazily but the surrounding modules read theirs per call, and the suite rule is
   to seal first rather than depend on which is which. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'srv-switch-1373-'));
const HOME = nodePath.join(SANDBOX, 'home');
const BIN = nodePath.join(SANDBOX, 'bin');
for (const d of [HOME, BIN, nodePath.join(SANDBOX, 'data'), nodePath.join(SANDBOX, 'workers'),
  nodePath.join(SANDBOX, 'launch'), nodePath.join(SANDBOX, 'projects')]) {
  fs.mkdirSync(d, { recursive: true });
}
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = nodePath.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = nodePath.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = nodePath.join(SANDBOX, 'projects');
/* 🛑 ALL THREE ROOTS, NOT ONE. `defaultHome()` reads
   `AGENT_WORKFORCE_CODEX_HOME || CODEX_HOME || AGENT_WORKFORCE_HOME/.codex`, so
   sealing only the third lets an ambient value on a developer's machine walk
   straight through. Sealing one root of three is the half-seal defect two
   directories over, and it fails toward reading real accounts. */
delete process.env.AGENT_WORKFORCE_CODEX_HOME;
delete process.env.CODEX_HOME;

const CLAUDE_BIN = nodePath.join(BIN, 'claude');
const CODEX_BIN = nodePath.join(BIN, 'codex');
const TMUX_BIN = nodePath.join(BIN, 'tmux');
for (const b of [CLAUDE_BIN, CODEX_BIN, TMUX_BIN]) {
  fs.writeFileSync(b, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}
process.env.AGENT_WORKFORCE_CLAUDE_BIN = CLAUDE_BIN;
process.env.AGENT_WORKFORCE_CODEX_BIN = CODEX_BIN;
/* 🔑 THE SHARED FAKE TMUX, NOT MY OWN STUB, AND THE REASON MATTERS. The OK branch of
   the route only runs when the agent reads as RUNNING; with an inert tmux every switch
   lands on the PARTIAL branch and the `landedOn` sentence is never exercised, which is
   exactly the arm a review proved a source regex cannot see. The pane line is built by
   `test-support/fleet`, whose whole purpose is that pane fixtures come from the real
   producers rather than being hand-typed into the wrong column. */
const FAKE_TMUX = nodePath.join(__dirname, 'test-support', 'fake-tmux.sh');
const PANES = nodePath.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_TMUX_BIN = FAKE_TMUX;
process.env.AGENT_WORKFORCE_FAKE_PANES = PANES;

const fleet = require('./test-support/fleet');
const create = require('./engine/create');
const openai = require('./engine/openaiaccounts');
const store = require('./engine/store');

/* Two sign-ins, because a one-account world cannot tell "it honoured the choice"
   from "the default happened to be right". */
function seedAccount(label, tail) {
  const dir = nodePath.join(HOME, '.codex-' + label);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(nodePath.join(dir, 'auth.json'),
    JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-proj-routetestroutetest' + tail }));
  return nodePath.resolve(dir);
}
const ALPHA = seedAccount('alpha', 'ALFA');
const BETA = seedAccount('beta', 'BETA');

function born(name) {
  fs.mkdirSync(create.AGENTS_DIR, { recursive: true });
  fs.mkdirSync(create.workerDir(name), { recursive: true });
  fs.writeFileSync(create.plistPath(name),
    create.plistFor(name, CLAUDE_BIN, TMUX_BIN, null, null, 'claude'), 'utf8');
  store.writeProfile(name, { provider: 'anthropic' });
  /* Make it read as RUNNING, or the route answers on its partial branch and the
     sentence this file exists to pin is never produced. */
  fs.writeFileSync(PANES, fleet.line({ session: name + '-discord', title: 'working' }) + '\n');
  assert.equal(store.readProfile(name).provider, 'anthropic',
    'the seeded agent is not readable as a Claude job, so every assertion below would be right for the wrong reason');
  return name;
}

/* 🔑 THE SEAM THAT MAKES THIS SAFE, AND IT IS NOT DRY_RUN. `run()` consults
   `runner` first, so this intercepts launchctl and tmux while the account block
   below still executes for real. Recorded calls are not asserted on here (the
   engine suite does that); this exists so the route can be driven at all. */
/* ⚠️ NOT A BLANKET `ok: true`, AND THE REASON IS THE CODE BEING CAREFUL RATHER THAN ME
   BEING CLEVER. After killing the window the restart runs `has-session` AGAIN and requires
   it to be GONE, because "the kill's own answer is not evidence the session has gone" and
   it refuses to report a restart over a live agent. A fake that answers `ok: true` to
   everything therefore says the session survived, and every switch lands on the partial
   branch. This fake answers the way a real tmux does once the session is closed. */
const fakeRun = (_file, args) => (Array.isArray(args) && args[0] === 'has-session'
  ? { ok: false, code: 1 }
  : { ok: true, stdout: '' });
create.setRunner(fakeRun);
/* ⚠️ AND `remove` KEEPS ITS OWN RUNNER, which is the half nobody would guess from the
   route's code. The restart the switch performs lives in `engine/remove.js`, so
   intercepting only `create` left the window-close shelling out for real and every
   switch answering on the partial branch. `server.test.js` hints at this by calling
   `remove.setRunner(null)` explicitly rather than assuming create's covers it. */
require('./engine/remove').setRunner(fakeRun);

const { start, server } = require('./server');
let base = '';

test.before(async () => {
  await start(0);
  base = 'http://127.0.0.1:' + server.address().port;
});
test.after(() => {
  try { server.close(); } catch { /* the port is going away anyway */ }
  /* 📌 RESTORED RATHER THAN LEFT SET. `node --test <files>` gives each file its own process
     today, so nothing else can see these. `server.test.js` nevertheless calls
     `setRunner(null)` explicitly rather than assuming that isolation, and a file that only
     works under a process-per-file runner is one runner change away from leaking a fake
     into somebody else's suite. */
  create.setRunner(null);
  require('./engine/remove').setRunner(null);
});

async function switchTo(name, body) {
  const res = await fetch(base + '/api/agent/' + encodeURIComponent(name) + '/provider', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

test('#1373 route: the fixture really offers a choice, or nothing below means anything', () => {
  const dirs = openai.list().map((a) => a.dir);
  assert.ok(dirs.includes(ALPHA) && dirs.includes(BETA),
    'the sandbox does not hold both sign-ins, so every assertion below is about a one-account world: ' + JSON.stringify(dirs));
  /* And the seal held: nothing outside the sandbox leaked in. */
  for (const d of dirs) {
    assert.ok(d.startsWith(SANDBOX),
      'an account outside the sandbox is visible, so this test is reading real sign-ins: ' + d);
  }
});

test('#1373 route: a PICKED account is named back, and the sentence says the person chose it', async () => {
  const name = born('route-1373-picked');
  const r = await switchTo(name, { provider: 'openai', account: BETA, picked: true });
  assert.equal(r.status, 200, 'the route refused a switch it should have made: ' + JSON.stringify(r.body));
  assert.equal(r.body.outcome, 'changed', JSON.stringify(r.body));
  /* THE ASSERTION THE SOURCE REGEX COULD NOT MAKE: the sentence the person reads
     must actually carry the account. Deleting `+ landedOn` from the route leaves
     every source-level assertion green and fails exactly here. */
  assert.match(r.body.because, /It runs on the OpenAI sign-in you picked/,
    'the answer does not say the person picked it, so a real choice is reported as the computer choosing: ' + r.body.because);
  assert.match(r.body.because, /API key ending BETA/,
    'the answer names no account, so the person cannot tell which sign-in they got: ' + r.body.because);
  /* And what the route SAYS must equal what the launch job GOT. */
  const plist = fs.readFileSync(create.plistPath(name), 'utf8');
  assert.ok(plist.includes(BETA),
    'the launch job did not get the account the answer named, so the sentence and the agent disagree');
});

test('#1373 route: an UNPICKED account still travels, and the sentence does NOT claim a choice', async () => {
  const name = born('route-1373-unpicked');
  const r = await switchTo(name, { provider: 'openai', account: ALPHA, picked: false });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(r.body.because, /It runs on your OpenAI sign-in/,
    'the unpicked sentence is missing: ' + r.body.because);
  assert.doesNotMatch(r.body.because, /you picked/,
    'the route claims the person picked an account they never touched: ' + r.body.because);
  const plist = fs.readFileSync(create.plistPath(name), 'utf8');
  assert.ok(plist.includes(ALPHA),
    'the visible row was not the row used, which is the wrong-account bug this card exists to fix');
});

/* 🛑 THE CASE THE CONJUNCTION EXISTS TO CLOSE, AND IT HAD NO EXECUTED ARM. `chosen` is
   `wantDir !== null && pickedByPerson === true`, so it refuses to call a STATED DEFAULT a
   choice. Every arm above passes an account, which means they all exercise the left half
   and none of them the conjunction itself. It was pinned only by a source regex, and the
   reason this file exists is that a regex inspects an expression and never its use. */
test('#1373 route: a pick claimed with NO account is not reported as a choice', async () => {
  const name = born('route-1373-picked-no-account');
  const r = await switchTo(name, { provider: 'openai', picked: true });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.doesNotMatch(r.body.because, /you picked/,
    'a caller claimed a pick without naming an account and the route repeated the claim, so a stated default is reported as the person\'s choice: ' + r.body.because);
  /* Presence beside the absence: the switch still HAPPENED and still named a sign-in, so
     this is not passing because nothing occurred. */
  assert.match(r.body.because, /OpenAI sign-in/,
    'the switch did not report a sign-in at all, so the absence assertion above proves nothing');
});

test('#1373 route: an account that is not on this computer is REFUSED, not silently replaced', async () => {
  const name = born('route-1373-ghost');
  const ghost = nodePath.join(HOME, '.codex-not-here-at-all');
  assert.ok(!fs.existsSync(ghost), 'the ghost must genuinely not exist or this proves nothing');
  const r = await switchTo(name, { provider: 'openai', account: ghost, picked: true });
  assert.notEqual(r.body.outcome, 'changed',
    'a picked account that is not on this computer was accepted: ' + JSON.stringify(r.body));
  /* `outcome !== 'changed'` alone would pass on a 500 or an unrelated refusal. The HTTP
     status and the sentence are the two things only an over-the-wire test can see. */
  assert.equal(r.status, 400, 'the refusal did not come back as a 400: ' + r.status);
  assert.match(String(r.body.because || r.body.error || ''), /not on this computer/,
    'the refusal does not say WHY, so a person cannot act on it: ' + JSON.stringify(r.body));
  /* The control that makes the refusal mean something: the job must be UNCHANGED,
     not merely missing a codex home. A Claude plist has no CODEX_HOME either. */
  const plist = fs.readFileSync(create.plistPath(name), 'utf8');
  assert.ok(plist.includes(CLAUDE_BIN),
    'the refusal still rewrote the launch job, so "nothing was changed" is false');
  assert.equal(store.readProfile(name).provider, 'anthropic',
    'the refusal still moved the profile off anthropic');
});
