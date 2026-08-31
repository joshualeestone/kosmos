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

/* Where gh lives when nothing overrides it.

   🛑 THE SEAM CHOOSES DATA, NEVER A PREDICATE, AND THAT DISTINCTION IS THE WHOLE
   HISTORY OF THIS BLOCK (#1592). It began as an exported
   `setGhCandidatesForTests(list)`, which is a SUBSTITUTING seam: the test drove
   the list it set and production's own default list was driven by nothing, so a
   reviewer weakened only the production side and every arm stayed green.

   Reshaping it to one variable removed the natural `||` fallback and did not
   remove the possibility, and a source arm counting scan sites was then defeated
   twice over, by a scan that is not `.some(` and by a scan placed outside the
   region the arm looked at. Both axes belong to whoever writes the code.

   ✅ So the override is an env var carrying PATHS, the same shape the rest of
   this file uses for its test seams, and there is exactly one unconditional scan
   below. The test drives real code with real data rather than swapping a list in.
   It also removes an exported test-only function from production.

   ⚠️ NAMED LIMIT, because overclaiming is the failure this branch keeps finding:
   this does not make divergence impossible. `GH_CANDIDATES_DEFAULT` is still
   separately referenceable, and somebody could scan it a second way. NO SOURCE
   SHAPE PREVENTS THAT AND NO SOURCE ARM DETECTS IT; the arm that tried was
   removed for pretending otherwise.

   📌 The genuinely closed form is devicedoor's: pass the candidates in as a
   parameter production callers already supply, so there is no default to diverge
   from. It is available here (`ghPresent` has exactly one caller) and costs a
   parameter on the exported `state()`. Left undone deliberately: that is an API
   change for a hazard nobody has hit, and it is Josh's product surface. */
/* ⚠️ THIS LIST IS DUPLICATED VERBATIM AT `engine/github.js`'s `candidates:`, AND
   THE OVERRIDE BELOW REACHES ONLY THIS COPY. Setting AGENT_WORKFORCE_GH_CANDIDATES
   changes what `ghPresent` scans and does NOT change what github.js's door scans,
   because that file passes its own literal array to `makeDoor`. Anyone reading the
   env var as global will be wrong about half of it.

   📌 DELIBERATELY NOT UNIFIED, and for the same reason the parameter form above
   was left undone: github.js is not otherwise in this branch's diff, and making it
   read this constant would pull a product-surface file into a branch about one
   definition of runnability, for a hazard nobody has hit. Recording the divergence
   is the part that costs nothing and is what a reader actually needs. */
const GH_CANDIDATES_DEFAULT = Object.freeze(['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']);
function ghCandidateList(override = process.env.AGENT_WORKFORCE_GH_CANDIDATES) {
  /* 🛑 `=== undefined`, NOT TRUTHINESS, AND THE DIFFERENCE IS A REAL LEAK.
     On truthiness an EMPTY STRING means "unset", so a test setting
     AGENT_WORKFORCE_GH_CANDIDATES="" to mean "no candidates" silently scans
     /opt/homebrew/bin/gh and the other REAL paths on the operator's machine.
     Measured: "" gave the three real paths, ":::" gave []. Same leak class as an
     unsandboxed store, which this branch already had once.

     📌 THE OVERRIDE IS A PARAMETER SO THE ARM IS NOT MACHINE LUCK. Its only
     guard used to read the env and could therefore only tell the fixed and broken
     shapes apart on a machine that HAS gh at a default path; on CI, which is the
     environment that gates merges, it skipped and the fix shipped unguarded.
     Taking the value as an argument lets a test drive THIS function directly with
     '' and with undefined. Production still calls `ghCandidateList()` and reads
     the env, so the test exercises production's own branch rather than a
     substitute: that is devicedoor's property, not the substituting seam this
     file removed earlier.

     ⚠️ ASYMMETRY, STATED HERE BECAUSE IT IS ONLY OBVIOUS FROM ONE SIDE: this
     override treats '' as "no candidates", while AGENT_WORKFORCE_GH_BIN below
     treats '' as "unset" (plain truthiness). `export FOO=$UNSET` produces an empty
     string routinely. The directions differ and both are safe: here '' yields an
     empty scan, there '' falls through to the candidate list. Noted at both
     sites rather than only at this one. */
  if (override === undefined) return GH_CANDIDATES_DEFAULT;
  return override.split(':').filter(Boolean);
}

/* gh presence, so ONE writer can branch on this object alone (her ruling:
   the field keeps its name on this road too). Mirrors github.js's spec
   candidates; the gh DOOR stays the authority on the gh road itself.

   📌 MOVED BACK DOWN ONTO THE FUNCTION IT DOCUMENTS. The candidate-list block
   above was inserted BETWEEN this comment and ghPresent, so it read as
   documentation for the constant. That is the doc-comment-binds-by-position
   hazard this branch documents elsewhere, committed by the person documenting
   it. */
function ghPresent() {
  // #1592: the byte-identical twin of devicedoor.js's lambda, which is why
  // fixing one file would not have found the other. Both now ask runners.
  const runnable = (p) => require('./runners').isRunnable(p);
  /* Truthiness here, deliberately, and NOT the `=== undefined` used by
     ghCandidateList above: an empty AGENT_WORKFORCE_GH_BIN means "no override",
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

module.exports = { PHASE, state, start, cancel, forget, setClientId, clientId, setFetcher, ghCandidateList, FILE, DIR, APP_FILE, NO_APP };
