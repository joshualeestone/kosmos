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
const NO_APP = 'the no-install way is not switched on yet; it needs a GitHub OAuth App id that only Josh can make';

let fetcher = null; // test seam: (url, opts) => Promise<{ok, status, body}>
function setFetcher(fn) { fetcher = typeof fn === 'function' ? fn : null; }

function clientId() {
  if (process.env.KOSMOS_GITHUB_CLIENT_ID) return process.env.KOSMOS_GITHUB_CLIENT_ID;
  try {
    const got = JSON.parse(fs.readFileSync(APP_FILE, 'utf8'));
    return (got && typeof got.clientId === 'string' && got.clientId.trim()) || null;
  } catch { return null; }
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

/* gh presence, so ONE writer can branch on this object alone (her ruling:
   the field keeps its name on this road too). Mirrors github.js's spec
   candidates; the gh DOOR stays the authority on the gh road itself. */
function ghPresent() {
  const runnable = (p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } };
  if (process.env.AGENT_WORKFORCE_GH_BIN) return runnable(process.env.AGENT_WORKFORCE_GH_BIN);
  return ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'].some(runnable);
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
