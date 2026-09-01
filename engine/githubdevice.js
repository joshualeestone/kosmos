'use strict';
/**
 * GitHub, connected with nothing installed (#620): Kosmos runs GitHub's own
 * device flow itself. The gh door (github.js) stays the best road where gh
 * exists; this is the road for everyone else, which on a clean Mac is
 * everyone -- the bundle ships tmux and node and nothing else.
 *
 * 🛑 THE JOSH-LINE, built to and stopped at (Splinter's brief): the flow
 * needs a registered GitHub OAuth App's client_id, and registering one is
 * Josh's decision on Josh's account, not code. The client_id is
 * CONFIGURATION (env override, or a value pasted once); until it exists
 * every entry point answers Ice Cream Kitty's ruled sentence for the
 * unconfigured state, and start() answers { ...state, refused } rather
 * than throwing (her interface: promises here never reject).
 *
 * 🔑 THE ANSWER IS DEVICEDOOR'S OBJECT, exactly (her ruling, so the door
 * reads one language for both roads): { gh, connected, login, phase, code,
 * url, because } with the same closed phase list, PLUS the two fields her
 * door's copy needs to tell the truth about who holds the key:
 * held (a token file exists, whatever GitHub says of it) and
 * holder: 'kosmos' (the gh road would say 'gh'). `code` keeps its dash and
 * `url` is GitHub's own verification_uri, so the door's existing
 * code-and-link block draws this road unchanged.
 *
 * What is different from the gh door, said plainly (the Cloudflare rule):
 * KOSMOS HOLDS THIS TOKEN. One file, mode 600, under secrets/ beside
 * Cloudflare's; the supervisor hands it into each agent's pane as GH_TOKEN
 * at launch; it is never answered by a route and never logged; "connected"
 * is READ from GitHub (GET /user) on every state(), never assumed from the
 * file's existence -- a revoked token shows here as revoked.
 *
 * The flow is GitHub's own (the same device flow gh drives): POST
 * login/device/code, show the person the code and github.com/login/device,
 * poll login/oauth/access_token honouring the interval (slow_down adds
 * five seconds, their rule) until the token arrives, the code expires, or
 * the person declines.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
/* 🛑 MODULE SCOPE, AND THE REASON IS NOT devicedoor's REASON.
   `ghPresent()` is reached from `async function state()`, which wraps its whole body
   in try/catch. A call-time require failure here is therefore NOT a rejection, it is
   SWALLOWED and served as `gh: 'missing'` -- a WRONG ANSWER rather than a loud one.
   Hoisting makes the same failure die at import instead of degrading into a
   plausible-looking verdict. Safe for the reason `devicedoor.js` states in full:
   `runners.js` requires only node builtins, so there is no cycle. Anyone adding a
   non-builtin require there invalidates this.

   🛑 THIS FILE CARRIES THE OPPOSITE RULE AT THE ghCandidateList LOAD CHECK, DELIBERATELY.
   That cycle detector WARNS rather than throws, because throwing at import bricks the
   board: `server.js` requires this module with no try. Both are correct, because they
   are about DIFFERENT FAILURES:
     a `runners` LOAD failure  -> a corrupt install. Nothing works anyway, and `server.js`
                                  already requires `./engine/runners` at top level with no
                                  try, so it kills boot on main too. Dying loudly costs
                                  nothing that was not already lost.
     a require CYCLE           -> a code-structure mistake in an otherwise working install.
                                  Bricking the board over one door's verdict is the wrong
                                  trade; degrade and stay visible.
   ⚠️ Stated because a reader can otherwise apply either rule to the other site and be told
   by this file that they are following it.
   📌 The history of how this paragraph was got wrong (a verbatim copy from devicedoor.js
   whose every mechanism was false here, two withdrawn counts, a control that shared its
   subject's blindness) is on kosmos#1730. It is not needed to read the code. */
const { isRunnable } = require('./runners');

const DIR = path.join(store.ROOT, 'secrets');
const FILE = path.join(DIR, 'github.token');
const APP_FILE = path.join(store.ROOT, 'github-app.json');

const DEVICE_URL = () => process.env.AGENT_WORKFORCE_GITHUB_DEVICE_URL || 'https://github.com/login/device/code';
const TOKEN_URL = () => process.env.AGENT_WORKFORCE_GITHUB_TOKEN_URL || 'https://github.com/login/oauth/access_token';
const VERIFY_URL = () => process.env.AGENT_WORKFORCE_GITHUB_VERIFY_URL || 'https://api.github.com/user';
/* `repo` is what the card's close condition needs (an agent reading a
   private repo); read:org so gh on a pane can answer org questions. */
const SCOPE = 'repo read:org';

const PHASE = Object.freeze({
  IDLE: 'idle', STARTING: 'starting', AWAITING: 'awaiting', COMPLETING: 'completing', FAILED: 'failed',
});

/* Ice Cream Kitty's ruled sentence for the unconfigured state: it is what
   the door prints under the install-the-CLI road until the id exists. */
// Person-facing (Mona Lisa, #620): no "OAuth" here; it is true and it is jargon. The log line may say OAuth.
const NO_APP = 'The no-install way is not switched on yet. It needs a GitHub app id that only Josh can make.';

let fetcher = null; // test seam: (url, opts) => Promise<{ok, status, body}>
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

/* 🔑 KOSMOS'S OWN APP, SHIPPED IN THE BUILD. The client id identifies the
   APP, not the person -- public by design (GitHub sends it in the device-flow
   URL a person visits) and the same for every install, which is why it is a
   constant here rather than a per-install value. Without it every single
   install needed this pasted in by hand before the no-install road existed at
   all, which made the door's advice worse than "install the CLI" for anyone
   who is not Josh. Josh registered it 2026-08-24 (device flow on, token
   expiry OFF -- this module stores only access_token and has no refresh, so
   expiring tokens would have silently killed every connection in hours).
   There is deliberately NO client secret anywhere: the device flow does not
   use one, and the one Josh generated anyway is revoked. */
const SHIPPED_CLIENT_ID = 'Ov23liHg5dCNgoNsIOWh';

function clientId() {
  /* Overrides first, in the order a person reaches for them: the env var
     (one shell, one test), then the per-install paste (the door's road,
     kept for anyone running their own GitHub app), then the build's own. */
  if (process.env.KOSMOS_GITHUB_CLIENT_ID) return process.env.KOSMOS_GITHUB_CLIENT_ID;
  try {
    const got = JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
    const pasted = got && typeof got.clientId === 'string' && got.clientId.trim();
    if (pasted) return pasted;
  } catch { /* fall through to the shipped id */ }
  return SHIPPED_CLIENT_ID;
}

/** The one value Josh hands over. Not a secret (a device-flow client_id is
    public by design), so it lives beside the store's records, not in
    secrets/. */
function setClientId(id) {
  const v = String(id == null ? '' : id).trim();
  if (!v) return { ok: false, because: 'paste the client id first' };
  if (/\s/.test(v)) return { ok: false, because: 'a client id has no spaces in it' };
  try {
    fs.writeFileSync(APP_FILE, JSON.stringify({ clientId: v }) + '\n');
    return { ok: true };
  } catch { return { ok: false, because: 'we could not save that' }; }
}

/* Where gh lives when nothing overrides it. ONE LITERAL, in `engine/github.js`,
   which this file requires.

   🛑 THE SEAM CHOOSES DATA, NEVER A PREDICATE. The first shape was an exported
   `setGhCandidatesForTests(list)`, a SUBSTITUTING seam: the test drove the list it
   set while production's own default list was driven by nothing, so a reviewer could
   weaken only the production side and every arm stayed green. That is the defeat
   `engine.runnable-not-directory.test.js` points here for.
   ✅ The override is instead an env var carrying PATHS, the same shape the rest of this
   file uses for its test seams, and there is exactly one unconditional scan below. The
   test drives real code with real data rather than swapping a list in, and no test-only
   function is exported from production. `GH_CANDIDATES` is not exported; it had zero
   consumers outside `github.js`. Anybody who re-adds that export re-opens the divergence
   hazard, and no source arm would detect that.

   ✅ SCOPE IS CLOSED: `github.js` reads its door candidates through a GETTER calling
   `ghCandidateList()`, so `AGENT_WORKFORCE_GH_CANDIDATES` is a machine-wide "where is
   gh" switch and the door cannot disagree with `ghPresent`. Pinned by an arm on the
   REAL door (`engine.runnable-not-directory.test.js`, "the REAL gh door honours the
   candidates override"): a real executable returns it, a DIRECTORY returns null.
   Verified to redden when the getter is reverted to the bare literal.

   ✅ NO TEST REACHES THE OPERATOR'S REAL gh through the door: `github.test.js` pins
   `AGENT_WORKFORCE_GH_BIN = '/bin/echo'` in `beforeEach`, so `ghBin()` returns before
   the candidate scan is consulted.
   🛑 SO DO NOT ADD THE OBVIOUS CONTROL ARM. "With no override the control still finds
   the real gh" would EXEC THE OPERATOR'S OWN gh, which is exactly what the sentence
   above promises no test does. It is deliberately not written.

   🛑 IT LIVES IN `github.js` BECAUSE THE MOVE CLOSED A CONTRACT BREACH, not to tidy.
   When this file defined it and `github.js`'s door reached BACK through a getter, the
   two modules were mutually dependent and `door.state()` gained a REJECT PATH:
   `devicedoor.status()` calls `ghBin()` synchronously inside `state()`'s promise
   executor, and `devicedoor`'s `state()` docblock promises "Never rejects". Measured,
   both arms: with this module's exports replaced by `{}` (the shape a failed load
   gives) `github.state()` REJECTED; control, module whole, resolved.
   ⇒ The dependency is now one-directional (this file -> `github.js`) and the door
   calls a function defined in its own module, so no load failure can reach it.
   ⚠️ NOT re-exported here. `module.exports` below carries neither `ghCandidateList`
   nor `ghPresent`, and neither was exported on main, so no caller is affected.

   📌 LEFT UNDONE DELIBERATELY: the genuinely closed form is devicedoor's, passing the
   candidates in as a parameter production callers already supply, so there is no
   default to diverge from. It is available here (`ghPresent` has exactly one caller)
   and costs a parameter on the exported `state()`. That is an API change for a hazard
   nobody has hit, and it is Josh's product surface.
   📌 The history of how these paragraphs were got wrong (a claim of four arms that did
   not exist, an asymmetry documented at three sites and believed unfixable until three
   reviewers closed it, and two corrections bolted onto sentences instead of rewriting
   them) is on kosmos#1730. It is not needed to read the code. */
const { ghCandidateList } = require('./github');
/* ⚠️ DETECTED, NOT FATAL. If a require cycle is introduced the destructured name is
   `undefined` during a partial load, the TypeError inside `ghPresent()` is swallowed by
   `state()`'s outer catch, and the route answers `gh: 'missing'`. Not silently: that
   catch also returns `phase: PHASE.FAILED` and `because: String(err.message)`, both of
   which the board renders. What is wrong is the `gh` FIELD specifically, which is the
   field the door's consumers read. This warns so the failure is visible.

   🛑 IT USED TO THROW, AND THAT WAS THE WRONG TRADE. `server.js` requires this module at
   top level with NO try (`github` and `githubdevice` both), so a throw means the BOARD
   DOES NOT BOOT AT ALL, with a raw TypeError and no UI, where the same degradation
   otherwise stays confined to one door answering `gh: 'missing'`. Measured: with the
   binding stubbed, requiring `github.js` gave BOOT FAILS. `main` carried no such guard
   at all. ⇒ Warning keeps the detection and returns the blast radius to one door. */
if (typeof ghCandidateList !== 'function') {
  console.warn('githubdevice: ghCandidateList did not load from ./github; a require cycle would answer gh:"missing" with a FAILED phase but a wrong gh field');
}

/* gh presence, so ONE writer can branch on this object alone.

   📌 THIS COMMENT WAS DRAGGED INTO `engine/github.js` when `ghCandidateList` moved
   there, and it sat above that file's door spec, documenting a function in THIS
   file. Its own closing note claimed it had been "MOVED BACK DOWN ONTO THE FUNCTION
   IT DOCUMENTS", which was false in the file it had landed in. A comment that
   asserts its own position is wrong the moment somebody moves it, and a move is
   exactly when nobody re-reads it. Returned here, and the self-describing sentence
   is gone rather than re-asserted. */
function ghPresent() {
  // #1592: the byte-identical twin of devicedoor.js's lambda, which is why
  // fixing one file would not have found the other. Both now ask runners.
  /* 🛑 THE WRAPPER IS COSMETIC TODAY AND IS KEPT ANYWAY. `.some(runnable)` and
     `.find(runnable)` hand a callback `(element, index, array)`, and this wrapper makes
     sure only the element arrives.
     MEASURED: `const runnable = isRunnable;` leaves the guard file green, and
     isRunnable(p, 0, [p]) equals isRunnable(p) on a real binary and on a directory. So
     nothing depends on the wrapper right now.
     ✅ KEPT because it stays correct if `isRunnable` gains a second parameter, which this
     branch makes realistic by promoting it to exported public API. An arm in the guard
     file pins exactly that condition, so the day it becomes load-bearing goes red rather
     than passing silently.
     ⚠️ It was once removed for closure-allocation cosmetics while `devicedoor.js`'s
     identical wrapper stayed, so two siblings disagreed about the same lambda. That is
     the class this branch is named for. The history of what this comment previously got
     wrong is on kosmos#1730. */
  const runnable = (p) => isRunnable(p);
  /* Truthiness here, deliberately, and NOT the `typeof override !== 'string'`
     test that `ghCandidateList` uses in `engine/github.js`: an empty
     AGENT_WORKFORCE_GH_BIN means "no override",
     so it falls through to the candidate scan rather than asserting a bin at ''. */
  if (process.env.AGENT_WORKFORCE_GH_BIN) return runnable(process.env.AGENT_WORKFORCE_GH_BIN);
  return ghCandidateList().some(runnable);
}

async function http(url, opts) {
  const f = fetcher || (async (u, o) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 10000);
    try {
      const r = await fetch(u, { ...o, signal: ctl.signal });
      let body = null;
      try { body = await r.json(); } catch { body = null; }
      return { ok: r.ok, status: r.status, body };
    } finally { clearTimeout(t); }
  });
  return f(url, opts);
}
const post = (url, form) => http(url, {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/json' },
  body: JSON.stringify(form),
});
const getUser = (token) => http(VERIFY_URL(), {
  headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + token },
});

function readToken() {
  try { return fs.readFileSync(FILE, 'utf8').trim() || null; } catch { return null; }
}

/* The flow in flight, one at a time, in memory: the server process owns the
   poll the way connect.js owns its watcher. This record NEVER carries the
   token; the token goes straight to the 600 file. */
let FLOW = { phase: PHASE.IDLE, code: null, url: null, because: null, expiresAt: 0 };
let POLL = null;
function stopPolling() { if (POLL) { clearTimeout(POLL); POLL = null; } }

/**
 * Start the device flow. Never rejects: the unconfigured state answers
 * { ...state, refused } (the routes turn refused into a 409), and a
 * GitHub that will not hand out a code becomes a failed phase with a
 * sentence.
 */
async function start() {
  try {
    const id = clientId();
    if (!id) return { ...(await state()), refused: NO_APP };
    stopPolling();
    FLOW = { phase: PHASE.STARTING, code: null, url: null, because: null, expiresAt: 0 };
    let r;
    try { r = await post(DEVICE_URL(), { client_id: id, scope: SCOPE }); }
    catch (err) { r = { ok: false, body: null, because: String((err && err.message) || err) }; }
    const b = r && r.body;
    if (!r || !r.ok || !b || !b.device_code || !b.user_code) {
      FLOW = {
        phase: PHASE.FAILED, code: null, url: null, expiresAt: 0,
        because: 'GitHub did not hand us a sign-in code'
          + (b && b.error_description ? ': ' + b.error_description : r && r.because ? ': ' + r.because : ''),
      };
      return state();
    }
    FLOW = {
      phase: PHASE.AWAITING,
      code: String(b.user_code),
      url: String(b.verification_uri || 'https://github.com/login/device'),
      because: null,
      expiresAt: Date.now() + (Number(b.expires_in) || 900) * 1000,
    };
    /* GitHub's stated interval, honoured as stated: `|| 5` here turned an
       interval of ZERO into five seconds (the falsy-zero trap), which only
       a stub would ever send, but the suite runs on the stub and the bug
       hid every fast test behind a five-second first poll. Absent or
       malformed defaults to GitHub's own 5. */
    const interval = Number(b.interval);
    schedulePoll(id, String(b.device_code), Math.max(0, Number.isFinite(interval) ? interval : 5) * 1000);
    return state();
  } catch (err) {
    FLOW = { phase: PHASE.FAILED, code: null, url: null, because: 'we could not start the sign-in: ' + String((err && err.message) || err), expiresAt: 0 };
    return state();
  }
}

function schedulePoll(id, deviceCode, delayMs) {
  stopPolling();
  POLL = setTimeout(() => { pollOnce(id, deviceCode, delayMs).catch(() => { /* the next state() reads the truth */ }); }, delayMs);
  if (POLL && POLL.unref) POLL.unref();
}

async function pollOnce(id, deviceCode, delayMs) {
  if (FLOW.phase !== PHASE.AWAITING && FLOW.phase !== PHASE.COMPLETING) return;
  if (Date.now() > FLOW.expiresAt) {
    FLOW = { ...FLOW, phase: PHASE.FAILED, because: 'the code expired before it was entered on GitHub; start again for a fresh one' };
    return;
  }
  let r;
  try {
    r = await post(TOKEN_URL(), {
      client_id: id, device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
  } catch { schedulePoll(id, deviceCode, delayMs); return; }
  const b = (r && r.body) || {};
  if (b.access_token) {
    FLOW = { ...FLOW, phase: PHASE.COMPLETING };
    /* Straight to the 600 file, the Cloudflare shape. */
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(FILE, String(b.access_token).trim() + '\n', { mode: 0o600 });
    try { fs.chmodSync(FILE, 0o600); } catch { /* mode set at write */ }
    FLOW = { phase: PHASE.IDLE, code: null, url: null, because: null, expiresAt: 0 };
    return;
  }
  if (b.error === 'authorization_pending') { schedulePoll(id, deviceCode, delayMs); return; }
  if (b.error === 'slow_down') { schedulePoll(id, deviceCode, delayMs + 5000); return; } // GitHub's own rule
  if (b.error === 'expired_token') {
    FLOW = { ...FLOW, phase: PHASE.FAILED, because: 'the code expired before it was entered on GitHub; start again for a fresh one' };
    return;
  }
  if (b.error === 'access_denied') {
    FLOW = { ...FLOW, phase: PHASE.FAILED, because: 'GitHub says you declined the sign-in' };
    return;
  }
  FLOW = { ...FLOW, phase: PHASE.FAILED, because: 'GitHub refused the sign-in' + (b.error_description ? ': ' + b.error_description : b.error ? ' (' + b.error + ')' : '') };
}

/**
 * Devicedoor's object, exactly, plus held/holder. Read, never asserted:
 * a held token is checked with GitHub on every call, and a revoked one
 * shows as revoked. Never rejects; never answers the token.
 */
async function state() {
  try {
    const id = clientId();
    const base = {
      gh: ghPresent() ? 'present' : 'missing',
      holder: 'kosmos',
      ready: Boolean(id),
      phase: FLOW.phase,
      code: FLOW.code,
      url: FLOW.url,
      because: FLOW.because || (id ? null : NO_APP),
    };
    const tok = readToken();
    if (!tok) return { ...base, connected: false, held: false, login: null };
    let v;
    try { v = await getUser(tok); }
    catch (err) { return { ...base, connected: false, held: true, login: null, because: 'we could not reach GitHub: ' + String((err && err.message) || err) }; }
    if (v.ok && v.body && v.body.login) {
      return { ...base, connected: true, held: true, login: String(v.body.login) };
    }
    return {
      ...base, connected: false, held: true, login: null,
      because: v.status === 401 ? 'GitHub no longer accepts the held sign-in; it may have been revoked' : 'GitHub did not confirm the held sign-in',
    };
  } catch (err) {
    return { gh: 'missing', holder: 'kosmos', ready: false, phase: PHASE.FAILED, code: null, url: null, connected: false, held: false, login: null, because: String((err && err.message) || err) };
  }
}

/** Stop a flow in flight; the held token, if any, stays. Never rejects. */
async function cancel() {
  stopPolling();
  FLOW = { phase: PHASE.IDLE, code: null, url: null, because: null, expiresAt: 0 };
  return state();
}

/** Forget the held token (and any flow in flight), Cloudflare's word. */
async function forget() {
  stopPolling();
  FLOW = { phase: PHASE.IDLE, code: null, url: null, because: null, expiresAt: 0 };
  try { fs.unlinkSync(FILE); } catch { /* nothing held */ }
  return state();
}

module.exports = { PHASE, state, start, cancel, forget, setClientId, clientId, setFetcher, FILE, DIR, APP_FILE, NO_APP };
