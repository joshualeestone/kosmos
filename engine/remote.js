'use strict';
/**
 * The tunnel supervisor: the engine side of "Use Kosmos from anywhere"
 * (the relay plan, Josh-Brain 2026-08-23). The board process owns one
 * kosmos-tunnel child; this module is the only thing that starts it, stops
 * it, restarts it after a crash, and says honestly what it is doing.
 *
 * ⚠️ OFF BY DEFAULT, AND THE SWITCH IS THE ONLY THING THAT STARTS IT -- and
 * the reason is COMMERCIAL, not security (Josh, 2026-09-03). The Kosmos Plus
 * relay this tunnel connects to is a PAID service, and you do not auto-enable
 * something the customer has to pay for. That is the COMMERCIAL exception to
 * the on-by-default product rule, and it generalises to any future paid
 * feature without re-arguing the security question. (notify and ping are also
 * off today, but for a DIFFERENT reason: held pending an opt-out decision,
 * kosmos#2020, not flipped by #2013. remote's reason is commercial, theirs is
 * the missing control.) Do NOT delete this carve-out on an on-by-default
 * sweep -- an exception with no stated reason gets swept back on.
 *
 * 🔑 NO CRYPTO HERE, ON PURPOSE. Enrolment (the keypair, the pin, the CSR)
 * and the connection itself live in the kosmos-tunnel binary, which is
 * tested against the coordinator's signed contracts in its own repo. This
 * module shells out to it and reads its status file, so the app never
 * grows a second implementation of any of that. The binary writes the
 * status file atomically on every state change; absence or a dead pid in
 * it means the process, not the connection, is the problem.
 *   (The ONE use of node:crypto here is a random device *label* --
 *   crypto.randomUUID() in signinDeviceId (#3149) -- which is an opaque,
 *   non-secret id, no key material, so it is not the enrolment crypto this
 *   note keeps out. The identity keypair the binary mints at register time
 *   still stays the binary's job.)
 *
 * States a caller sees, each with a because sentence when not up:
 *   off         the switch is off (or the board is missing what it needs)
 *   connecting  a child is running (or setup is mid-flight) and not up yet
 *   up          the tunnel holds, with the address a phone can use
 *   restarting  the child died and comes back with backoff
 * Unknown never renders as fine: every path that cannot prove "up" says
 * which sentence applies.
 *
 * Env seams, each so tests can run a fake through this module:
 *   AGENT_WORKFORCE_TUNNEL_BIN          the kosmos-tunnel binary
 *   AGENT_WORKFORCE_TUNNEL_RELAY        relay host:port. Default: the real
 *                                       relay, relay.kosmosplus.com:8443
 *                                       (migrated from relay.plus.installkosmos.com
 *                                       under kosmos#2550, for naming consistency
 *                                       with the coordinator; the relay serves a
 *                                       SAN cert covering both names, so installed
 *                                       clients on the old name keep working)
 *   AGENT_WORKFORCE_TUNNEL_COORDINATOR  coordinator URL for setup. Default: the
 *                                       real one, https://login.kosmosplus.com
 *                                       (flipped from coordinator.plus.installkosmos.com to the
 *                                       kosmosplus.com domain 2026-08-30, #1565, then from
 *                                       coordinator.kosmosplus.com to login.kosmosplus.com
 *                                       2026-09-01 per Josh's ask; login.* and coordinator.* are
 *                                       the SAME box with the same pinned pubkey, so the flip is
 *                                       transparent, and coordinator.* stays up for
 *                                       already-installed clients until it is retired last)
 *   AGENT_WORKFORCE_TUNNEL_STATE        the state dir (keys, certs)
 *   AGENT_WORKFORCE_TUNNEL_CA           extra CA for a dev/self-host relay
 *                                       ONLY. The real relay serves a
 *                                       Let's Encrypt cert that system roots
 *                                       trust (proven with a stock dial, no
 *                                       CA, #578/#648); nothing must bake
 *                                       this for the production relay, and
 *                                       a stale path here breaks the dial
 *                                       for a reason nobody would suspect.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const store = require('./store');

// #1848: route through store.ROOT (= store.dataRootFor(platform, home, env)) rather
// than reading AGENT_WORKFORCE_DATA directly. The direct read bypassed both #1820's
// p.isAbsolute refusal (a relative override scattered this file's state to a
// cwd-relative path) and the `Kosmos` leaf the rest of the store appends, so
// under an override remote.json landed in a DIFFERENT directory than avatars/profiles.
// It is also the #1704 prerequisite: under a multi-Kosmos switcher AGENT_WORKFORCE_DATA
// is the switch, and every data-root read must go through the one derivation, not
// read the variable at its own moment.
const BASE = store.ROOT;
const FILE = path.join(BASE, 'remote.json');
const STATE_DIR = () => process.env.AGENT_WORKFORCE_TUNNEL_STATE || path.join(BASE, 'remote');
const STATUS_FILE = () => path.join(BASE, 'remote-status.json');
/* Where the connector lives. An explicit AGENT_WORKFORCE_TUNNEL_BIN wins (the
 * test seam, and any operator override). Otherwise prefer the copy this app
 * ships beside itself -- installed, remote.js sits at
 * $KOSMOS_HOME/app/engine/remote.js and the tunnel at
 * $KOSMOS_HOME/app/bin/kosmos-tunnel (#583), and the board runs under launchd
 * with a minimal PATH that a bare name would not resolve. Fall back to the
 * bare name (PATH) only when no bundled copy is present, which is the source
 * checkout: there the tunnel is not staged, so a developer sets the env var
 * or puts it on PATH, exactly as before. */
const BIN = () => {
  if (process.env.AGENT_WORKFORCE_TUNNEL_BIN) return process.env.AGENT_WORKFORCE_TUNNEL_BIN;
  const bundled = path.join(__dirname, '..', 'bin', 'kosmos-tunnel');
  try { if (fs.existsSync(bundled)) return bundled; } catch { /* fall through to PATH */ }
  return 'kosmos-tunnel';
};
/* The production addresses are the defaults (#648): a bundle needs nothing
 * baked for a Mac to reach the real relay and coordinator. Precedence: env
 * (tests, self-host), then the relay saved in remote.json, then production. */
const DEFAULT_RELAY = 'relay.kosmosplus.com:8443';
const DEFAULT_COORDINATOR = 'https://login.kosmosplus.com';
const RELAY = () => process.env.AGENT_WORKFORCE_TUNNEL_RELAY || read().relay || DEFAULT_RELAY;
/* The ONE answer to "is a relay configured on this machine" (#790). The
 * server's Plus route once re-derived it from the raw parts (saved relay or
 * env) and missed the default this module had just learned (#722), so on
 * served 0.5.24 the connector dialed the real relay while the Plus tab told
 * every stranger "Sign-up is not open yet". Two derivations of one fact
 * disagree the moment one of them learns something; there is one now. */
const configured = () => Boolean(RELAY());
const COORDINATOR = () =>
  process.env.AGENT_WORKFORCE_TUNNEL_COORDINATOR || DEFAULT_COORDINATOR;

/* The coordinator's two input shapes, ONE derivation each (repo convention:
   two derivations of one rule drift the moment the coordinator changes one).
   Both the setup flow and the sign-in flow (#3149) check these, so they live
   here rather than inline in each function. CODE_RULE: the six-digit email/phone
   code. NAME_RULE: the address label (the "hers" in hers.<domain>). */
const CODE_RULE = /^[0-9]{6}$/;
const NAME_RULE = /^[a-z0-9-]{3,32}$/;

let child = null;
let restartTimer = null;
let restartBecause = null;
let backoffMs = 1000;
let localPort = null;

/** Ensure the state dir exists and is owner-only. It holds the identity key
    and the TLS key; the binary writes those 0600, but the directory around
    them must be 0700 or a group/other could enumerate them. The binary
    creates the dir, so this states and enforces the assumption on our side
    rather than relying on it unsaid. Best-effort: a perms failure must not
    block the switch. */
function secureStateDir() {
  try {
    fs.mkdirSync(STATE_DIR(), { recursive: true, mode: 0o700 });
    fs.chmodSync(STATE_DIR(), 0o700);
  } catch { /* best-effort; the binary still writes its files 0600 */ }
}

/** Off until somebody turns it on. `relay` may be stored here so a
    self-hoster can point at their own relay without an env var. */
function read() {
  let raw;
  try { raw = fs.readFileSync(FILE, 'utf8'); } catch (err) {
    if (err && err.code === 'ENOENT') return { on: false, relay: '', email: '', denied: {}, device_id: '', ok: true };
    return { on: false, relay: '', email: '', denied: {}, device_id: '', ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, relay: '', email: '', denied: {}, device_id: '', ok: false }; }
  // A JSON array passes `typeof === 'object'`, but that is harmless HERE, unlike
  // in heartbeat-setting: `on` below is read as `parsed.on === true` (an explicit
  // true test), never defaulted to true, so an array reads off -- the safe value
  // for a relay that is off until turned on. #2013 fixed heartbeat's twin of this
  // guard because heartbeat DID default true; this copy needs no Array.isArray.
  if (!parsed || typeof parsed !== 'object') return { on: false, relay: '', email: '', denied: {}, device_id: '', ok: false };
  return {
    on: parsed.on === true,
    relay: typeof parsed.relay === 'string' ? parsed.relay : '',
    email: typeof parsed.email === 'string' ? parsed.email : '',
    /* #567: ids this Mac said no to, with when. A re-ask from one of them
       gets a sentence on the card; nothing else reads this. */
    denied: parsed.denied && typeof parsed.denied === 'object' && !Array.isArray(parsed.denied) ? parsed.denied : {},
    /* #3149: this computer's stable sign-in device id. Preserved as-is so a
       later write() (which reconstructs the file from read()) does not drop it;
       shape is checked where it is minted/used (signinDeviceId), not here, the
       same way relay/email carry through unvalidated. */
    device_id: typeof parsed.device_id === 'string' ? parsed.device_id : '',
    /* Federation Kosmos+ gate: the account's last-known coordinator standing,
       cached from the sign-in flow (the only place the coordinator surfaces it,
       per ICK's contract). '' means unknown -> kosmosPlus() is false (fail-safe:
       an unknown standing never opens the paid fed UI). The live server-side
       backstop (fed routes 403 a non-member) covers any staleness between
       sign-ins; this cache only drives which UI the board shows. */
    standing: typeof parsed.standing === 'string' ? parsed.standing : '',
    /* Federation Kosmos+ gate, W1 refresh: the client-clock ms when `standing` was
       last written. Drives the TTL re-fetch -- an enrolled board re-checks standing
       from the coordinator once this is older than STANDING_TTL_MS, so an UPGRADE
       (paid after enrolment) takes effect within ~one TTL, no re-sign-in. 0 = never
       stamped -> immediately stale. */
    standing_at: typeof parsed.standing_at === 'number' ? parsed.standing_at : 0,
    /* Federation launch flag (option 2, the CUSTOMER un-hide): the last-known GLOBAL
       "federation is live" bool from the coordinator. UNLIKE `standing` this is not
       per-account -- it gates the whole fed UI (members AND the non-member signup
       prompt), so every board reads it and it is not gated on enrolment. Absent/unknown
       -> federationLive() is false (fail-safe: the fed UI stays hidden until the
       coordinator says live). The env override (AGENT_WORKFORCE_FEDERATION_LIVE) is
       ORed on top in server.federationLiveNow() for operator/dev boards. */
    fedLive: parsed.fedLive === true,
    /* client-clock ms when fedLive was last written; drives the TTL refresh. 0 = never
       stamped -> immediately stale. */
    fedLive_at: typeof parsed.fedLive_at === 'number' ? parsed.fedLive_at : 0,
    ok: true,
  };
}
/* SET the cached coordinator standing from a FRESH enrolment/register response
   (setupComplete / signinRegister's register path). SET-OR-CLEAR, never inherit: a
   fresh enrolment writes the coordinator's value, or '' when it is absent/non-string
   -- so a stale 'good' from a prior life (e.g. a state dir wiped without a full
   forget()) can NEVER survive into a new account and leak the paid fed UI. The
   already-set-up SHORT-CIRCUIT paths do NOT call this: there the account is
   unchanged, so the existing cache is kept. forget() clears it outright. */
function fedSetStanding(standing) {
  // Stamp standing_at on every write so the TTL refresh (below) can tell a fresh
  // cache from a stale one, and a definite coordinator answer resets the clock.
  write({ standing: typeof standing === 'string' ? standing : '', standing_at: Date.now() });
}
/* Federation Kosmos+ gate, W1 refresh (ICK's v1 ruling, 2026-09-21). An enrolled
   board's `standing` is otherwise frozen at enrolment time, so a member who UPGRADES
   after enrolling could not see the feature until re-sign-in. This TTL re-fetch keeps
   the cached standing current: the /api/status poll serves the CACHED kosmos_plus
   immediately (never blocks) and, when the cache is older than the TTL, fires this
   lazy refresh so the next poll reflects reality within ~one TTL. A LAPSE is also
   caught within a TTL (UI off), but the fed-route 403 stays the hard security gate --
   this only keeps the UI honest. */
const STANDING_TTL_MS = 60 * 1000;   // ICK's ~60s; deliberately not per-poll (5s) to spare the coordinator
let standingRefreshInFlight = false;
const FED_LIVE_TTL_MS = 60 * 1000;   // mirrors STANDING_TTL_MS; a launch flag changes rarely, but a lapse/rollback should still reach a board within ~one TTL
let fedLiveRefreshInFlight = false;
/* The isolated coordinator read: the CURRENT standing string, or null when it could
   not be determined. A null NEVER changes the cache, so a transient failure keeps the
   last-known standing (no flicker) and the 403 backstop remains the hard gate. */
async function fetchStanding() {
  // Lives in engine/mac-standing.js. Lazy require breaks the remote<->mac-standing cycle.
  try { return await require('./mac-standing').fetchStanding(); } catch { return null; }
}
/* Lazily refresh the cached standing when it is older than `ttlMs`. NON-BLOCKING by
   contract: callers do NOT await it; the poll serves the cached value and this updates
   it for next time. A no-op unless enrolled, single-flighted so concurrent polls do
   not stack fetches, and best-effort (never throws into the status tick). */
async function refreshStandingIfStale(opts) {
  opts = opts || {};
  const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : STANDING_TTL_MS;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const fetcher = typeof opts.fetcher === 'function' ? opts.fetcher : fetchStanding;
  if (standingRefreshInFlight) return;
  if (!enrolled()) return;                  // no account on this board -> nothing to refresh
  const s = read();
  if (s.ok !== true) return;
  if (now - (s.standing_at || 0) < ttl) return;   // still fresh
  standingRefreshInFlight = true;
  try {
    const standing = await fetcher();
    if (typeof standing === 'string') {
      fedSetStanding(standing);             // a definite answer: update the value + reset the clock
    } else {
      write({ standing_at: Date.now() });   // could not determine: KEEP the last-known value, back the retry off to the next TTL
    }
  } catch { /* refresh is best-effort; a poll must never see this throw */ }
  finally { standingRefreshInFlight = false; }
}
/* Federation Kosmos+ gate: is THIS account an authenticated Kosmos+ member?
   True iff the cached coordinator standing is exactly "good" (ICK's contract:
   kosmos_plus == standing=="good"). Fail-safe: any other/unknown value is false,
   so the board never shows the paid federation UI to a non-member. */
function kosmosPlus() {
  const s = read();
  return s.ok === true && s.standing === 'good';
}
/* The isolated coordinator read for the GLOBAL federation-live flag: true/false, or
   null when it could not be determined (offline, or -- today -- the source is not wired
   yet). A null NEVER changes the cache, so a transient failure keeps the last-known
   value (no flicker) and the default stays FALSE (hidden).
   🛑 PENDING ICK/Baron's coordinator field (routed after their wire-proof): the exact
   endpoint/shape is theirs to confirm. Proposal: an unauthenticated global
   `GET /v1/meta` carrying a `federation_live` bool (it already returns 200, and this is
   a PUBLIC launch flag, so a per-account mac-signed path is wrong for it). Until that is
   confirmed and wired here, this returns null -> refreshFederationLiveIfStale is a safe
   no-op and federationLive() keeps the default false, so the producer behaves EXACTLY as
   the merged #3353 env-only producer. Wiring the real fetch is then a one-function change.
   This mirrors how fetchStanding() shipped a null stub pending ICK's standing mechanism. */
async function fetchFederationLive() {
  return null;
}
/* Lazily refresh the cached federation-live flag when it is older than `ttlMs`.
   NON-BLOCKING by contract (callers do NOT await it), single-flighted, best-effort.
   UNLIKE refreshStandingIfStale this is NOT gated on enrolled(): the flag is global and
   a non-member board needs it to show the signup prompt. A definite bool updates the
   cache + resets the clock; a null KEEPS the last-known value and backs the retry off to
   the next TTL. */
async function refreshFederationLiveIfStale(opts) {
  opts = opts || {};
  const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : FED_LIVE_TTL_MS;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const fetcher = typeof opts.fetcher === 'function' ? opts.fetcher : fetchFederationLive;
  if (fedLiveRefreshInFlight) return;
  const s = read();
  if (s.ok !== true) return;                       // state file unreadable -> keep default (false), do not stamp
  if (now - (s.fedLive_at || 0) < ttl) return;     // still fresh
  fedLiveRefreshInFlight = true;
  try {
    const live = await fetcher();
    if (typeof live === 'boolean') {
      write({ fedLive: live, fedLive_at: Date.now() });   // a definite answer: update the value + reset the clock
    } else {
      write({ fedLive_at: Date.now() });                  // could not determine: KEEP the last-known value, back off to the next TTL
    }
  } catch { /* refresh is best-effort; a poll must never see this throw */ }
  finally { fedLiveRefreshInFlight = false; }
}
/* The GLOBAL federation-live flag as the board last knew it. Fail-safe: unknown/unreadable
   -> false, so the fed UI stays hidden until the coordinator says live. server.js ORs the
   AGENT_WORKFORCE_FEDERATION_LIVE env override on top for operator/dev boards. */
function federationLive() {
  const s = read();
  return s.ok === true && s.fedLive === true;
}
function write(patch) {
  const next = { ...read(), ...patch };
  delete next.ok;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next) + '\n');
    fs.renameSync(tmp, FILE);
    return { ok: true };
  } catch {
    return { ok: false, because: 'we could not save that setting' };
  }
}

/** Enrolled means setup finished: the state dir holds the identity and the
    certificate. Half a state dir is not enrolled. */
/* mac_key is deliberately not listed: enrolled() asks whether the Mac can serve,
   halfRegistered() whether it holds a key the coordinator knows (#3827). */
function enrolled() {
  const dir = STATE_DIR();
  return ['mac_id', 'address', 'tls.crt', 'tls.key'].every((f) =>
    fs.existsSync(path.join(dir, f)));
}

function address() {
  try { return fs.readFileSync(path.join(STATE_DIR(), 'address'), 'utf8').trim() || null; }
  catch { return null; }
}

/** The switch. Turning on does not start anything by itself unless setup
    already happened; the Settings flow calls setupStart/setupComplete and
    then ensure() brings the tunnel up. Turning off stops it now. */
function setOn(on) {
  if (typeof on !== 'boolean') return { ok: false, because: 'that has to be on or off' };
  // #3827: Forget stops the tunnel, then waits on the retire; turning on in that
  // wait would start one from the key it is about to delete.
  if (on && forgetting) return busy();
  const wrote = write({ on });
  if (!wrote.ok) return wrote;
  ensure(localPort);
  return { ok: true };
}

function setRelay(relay) {
  if (typeof relay !== 'string') return { ok: false, because: 'the relay has to be host:port' };
  const v = relay.trim();
  /* Refuse garbage at set time rather than letting it become a spawn-crash
     loop later: empty clears it, otherwise require host:port. */
  if (v !== '' && !/^[^\s:]+:\d{1,5}$/.test(v)) {
    return { ok: false, because: 'the relay has to be host:port' };
  }
  const wrote = write({ relay: v });
  if (!wrote.ok) return wrote;
  ensure(localPort);
  return { ok: true };
}

/** Reconcile reality with the switch. Idempotent; the server calls it at
    boot with the board's port and after every toggle. Never throws. */
function ensure(port) {
  try {
    if (typeof port === 'number') localPort = port;
    const wanted = read().on && enrolled() && !!RELAY() && typeof localPort === 'number';
    if (!wanted) { stopChild(); return; }
    if (child || restartTimer) return;
    startChild();
  } catch (err) {
    process.stderr.write('remote: ensure failed: ' + (err && err.message) + '\n');
  }
}

function startChild() {
  const args = [
    'run',
    '--relay', RELAY(),
    '--state-dir', STATE_DIR(),
    '--local', '127.0.0.1:' + localPort,
    '--status-file', STATUS_FILE(),
    '--coordinator', COORDINATOR(),
  ];
  if (process.env.AGENT_WORKFORCE_TUNNEL_CA) {
    args.push('--tunnel-ca', process.env.AGENT_WORKFORCE_TUNNEL_CA);
  }
  secureStateDir();
  try { fs.rmSync(STATUS_FILE(), { force: true }); } catch { /* stale is worse than absent */ }
  let spawned;
  try {
    /* stdout is dropped (the status file is the interface); stderr joins the
       board's log, which launchd keeps, so a refused ticket is findable. */
    spawned = spawn(BIN(), args, { stdio: ['ignore', 'ignore', 'inherit'] });
  } catch (err) {
    restartBecause = 'the tunnel program could not be started: ' + (err && err.message);
    process.stderr.write('remote: ' + restartBecause + '\n');
    scheduleRestart();
    return;
  }
  child = spawned;
  restartBecause = null;
  child.on('error', (err) => {
    /* spawn() does not throw on ENOENT (a missing or non-executable binary):
       the error event fires and exit NEVER does, so the child never runs and
       never exits. If we only set the reason here, child stays non-null,
       ensure() early-returns on the dead handle forever, and status() renders
       a permanent false "connecting" -- exactly the shrug the plan forbids.
       Null the child and schedule the restart here, as the exit handler would;
       scheduleRestart's guard keeps it safe if an exit somehow also fires. */
    restartBecause = 'the tunnel program could not be started: ' + (err && err.message);
    process.stderr.write('remote: ' + restartBecause + '\n');
    child = null;
    if (read().on) scheduleRestart();
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (!read().on) return; // stopped on purpose
    if (!restartBecause) {
      restartBecause = signal
        ? 'restarting after the tunnel was killed (' + signal + ')'
        : 'restarting after a crash (exit ' + code + ')';
    }
    process.stderr.write('remote: ' + restartBecause + '\n');
    scheduleRestart();
  });
}

function scheduleRestart() {
  if (restartTimer) return;
  restartTimer = setTimeout(() => {
    restartTimer = null;
    backoffMs = Math.min(backoffMs * 2, 60000);
    ensure(localPort);
  }, backoffMs);
  /* A pending restart must not hold the board open on shutdown. */
  if (typeof restartTimer.unref === 'function') restartTimer.unref();
}

function stopChild() {
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  backoffMs = 1000;
  restartBecause = null;
  if (child) {
    /* An intentional stop must not look like a crash: the exit handler
       belongs to the supervised life of this child, and a kill we chose
       would otherwise race a later toggle and schedule a ghost restart. */
    child.removeAllListeners('exit');
    try { child.kill(); } catch { /* already gone */ }
    child = null;
  }
}

/* ⚠️ The child must never outlive the board (#156 is the recorded incident
   for orphans). launchd stopping the board sends SIGTERM; killing the child
   on our way out covers that and plain exit. SIGKILL leaves an orphan whose
   own reconnect loop keeps running; accepted and documented: the next board
   start spawns a replacement whose relay connection REPLACES the orphan's
   (newest wins at the relay), so the orphan idles until reaped. */
function reap() { try { if (child) child.kill(); } catch { /* going down anyway */ } }
process.on('exit', reap);
/* On a termination signal, reap the child then RE-RAISE rather than
   process.exit(0): a library module must not seize the exit code or cut off
   the board's own async graceful shutdown. Removing our handler and
   re-sending the signal lets the real owner (or the default action) proceed,
   and yields the conventional signal exit status instead of a forged 0. */
for (const sig of ['SIGTERM', 'SIGINT']) {
  const handler = () => {
    reap();
    process.removeListener(sig, handler);
    process.kill(process.pid, sig);
  };
  process.on(sig, handler);
}

/** What the board paints. Every not-up state carries its because. */
function status() {
  try {
    const settings = read();
    /* A corrupt settings file reads as off, but saying "the switch is off"
       would be untrue. Fail toward off AND say the file is unreadable, so a
       person is not told they turned something off that they did not. */
    if (!settings.ok) {
      return {
        state: 'off',
        address: null,
        because: 'your remote-access settings could not be read',
      };
    }
    if (!settings.on) return { state: 'off', address: null, because: 'the switch is off' };
    if (!enrolled()) {
      return {
        state: 'connecting',
        address: null,
        because: settings.email
          ? 'waiting for the code sent to ' + settings.email
          : 'waiting for the sign-in in Settings',
      };
    }
    if (!RELAY()) {
      return { state: 'off', address: null, because: 'no relay address is set yet' };
    }
    if (!child) {
      return restartTimer || restartBecause
        ? { state: 'restarting', address: null, because: restartBecause || 'restarting' }
        : { state: 'off', address: null, because: 'the board has not started the tunnel' };
    }
    let raw;
    try { raw = JSON.parse(fs.readFileSync(STATUS_FILE(), 'utf8')); } catch { raw = null; }
    if (!raw || raw.pid !== child.pid) {
      return { state: 'connecting', address: null, because: 'starting the connection' };
    }
    if (raw.state === 'up') {
      /* A healthy run earns a fresh backoff: without this the window only
         ever grows (stopChild is the sole other reset), so a board that has
         been up for days would reconnect on a 60s delay after one blip. */
      backoffMs = 1000;
      return { state: 'up', address: raw.address || address(), because: null };
    }
    return {
      state: raw.state === 'restarting' ? 'restarting' : 'connecting',
      address: null,
      because: raw.because || 'connecting to the relay',
    };
  } catch (err) {
    return { state: 'off', address: null, because: 'status unreadable: ' + (err && err.message) };
  }
}

/** Run a setup subcommand; resolve {ok, because} and never reject. The
    binary owns the crypto and the wire; we own turning its exit into a
    sentence a person reads next to the switch. When `stdin` is a string it is
    written to the child's stdin and the stream closed (the #3149 `signin
    register` path pipes the session token in this way, so the 30-day credential
    never sits on argv); when it is null the child gets no stdin, exactly as
    before -- so every existing caller is unaffected. */
function setupRun(args, stdin = null, timeoutMs = 0) {
  return new Promise((resolve) => {
    let spawned;
    let timer = null;
    try {
      spawned = spawn(BIN(), args, { stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, because: 'the tunnel program could not be started: ' + (err && err.message) });
      return;
    }
    let out = '';
    let errOut = '';
    spawned.stdout.on('data', (d) => { out += d; });
    spawned.stderr.on('data', (d) => { errOut += d; });
    spawned.on('error', (err) => {
      resolve({ ok: false, because: 'the tunnel program could not be started: ' + (err && err.message) });
    });
    if (stdin !== null && spawned.stdin) {
      // A child that exits before reading breaks the pipe with EPIPE; that is
      // the child's exit code's story, not an error to surface here, so swallow it.
      spawned.stdin.on('error', () => {});
      try { spawned.stdin.end(String(stdin)); } catch { /* the exit handler reports the real outcome */ }
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        try { spawned.kill('SIGKILL'); } catch { /* already gone */ }
        resolve({ ok: false, because: 'the tunnel program did not answer in time', timedOut: true });
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    }
    spawned.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) { resolve({ ok: true, because: null, said: out.trim() }); return; }
      const lines = (errOut.trim() || out.trim()).split('\n').filter(Boolean);
      /* `stderr` is the WHOLE of it: a caller that must recognise a message clap prints
         across several lines (an unknown subcommand, #3660) cannot use the last line. */
      resolve({ ok: false, because: lines[lines.length - 1] || ('setup failed (exit ' + code + ')'), stderr: errOut, code });
    });
  });
}

/** One signed request to a coordinator /v1/mac/ route, through the tunnel's
    `mac-request` verb (#718): the key stays in the tunnel binary, never here.
    A POST body goes on stdin, never argv. Resolves to
    { ok: true, data } with the coordinator's parsed JSON, or
    { ok: false, because }. */
// A signed request is one round trip; 20 s covers a slow network and still
// frees a caller (a Settings turn-on) stuck on a hung tunnel.
const MAC_REQUEST_TIMEOUT_MS = 20 * 1000;
async function macRequest(method, routePath, body) {
  if (!enrolled()) return { ok: false, because: 'this computer is not connected to Kosmos+' };
  const args = ['mac-request', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR(),
    '--method', method, '--path', routePath];
  // AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS is a test seam (a hung tunnel in a test).
  const timeout = Number(process.env.AGENT_WORKFORCE_MAC_REQUEST_TIMEOUT_MS) || MAC_REQUEST_TIMEOUT_MS;
  const r = await setupRun(args, method === 'GET' ? null : JSON.stringify(body || {}), timeout);
  if (!r.ok) return { ok: false, because: r.because };
  try { return { ok: true, data: JSON.parse(r.said) }; }
  catch { return { ok: false, because: 'the tunnel program answered in a shape we could not read' }; }
}

/* A model answer, not a single signed round trip: capped output, but a slow provider.
   AGENT_WORKFORCE_ASSISTANT_TIMEOUT_MS is its own test seam, apart from mac-request's. */
const ASSISTANT_TIMEOUT_MS = 45 * 1000;

/* Whether the hosted setup assistant can be asked from here at all (#3660, the bubble): a connector at a
 * real path, the copy this app ships (an installed Kosmos) or an explicit override. A source checkout
 * falls back to a bare name on PATH, which counts as NO here on purpose: a developer's board, and every
 * browser-check sandbox, must never offer a chat that goes to the production coordinator unasked. It says
 * nothing about whether that connector knows the verb; an old one answers 501 and the bubble steps aside. */
function hostedAvailable() {
  const b = BIN();
  try { return path.isAbsolute(b) && fs.statSync(b).isFile(); } catch { return false; }
}

/**
 * One message to the hosted setup assistant (#3660), through the tunnel's
 * `assistant-chat` verb. NO CRYPTO HERE, as above: the verb picks the key (this
 * Mac's own when enrolled, else the install key it registers on first use), signs
 * afresh on every run, and prints `{"status": <http status>, "body": <json>}` for
 * ANY answer from the coordinator, refusals included. A non-zero exit means the
 * coordinator could not be reached or the request could not be signed.
 * Resolves to one of:
 *   { ok: true, status, body }                       the coordinator answered
 *   { ok: false, unsupported: true, because }        this tunnel predates the verb
 *   { ok: false, because }                           no answer (network, signing)
 * The body goes on stdin, never argv. Never throws.
 */
async function assistantChat(body) {
  /* 🛑 SUITE GUARD, the one engine/mac-standing.js uses: under the test runner never
     run the real bundled tunnel, which would send a sandbox's message to the
     production coordinator on our key. A test that supplies a fake tunnel still runs. */
  if (process.env.NODE_TEST_CONTEXT && !process.env.AGENT_WORKFORCE_TUNNEL_BIN) {
    return { ok: false, because: 'the tunnel is not available under test' };
  }
  const args = ['assistant-chat', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()];
  const timeout = Number(process.env.AGENT_WORKFORCE_ASSISTANT_TIMEOUT_MS) || ASSISTANT_TIMEOUT_MS;
  let r;
  try { r = await setupRun(args, JSON.stringify(body || {}), timeout); }
  catch (err) { return { ok: false, because: String((err && err.message) || err) }; }
  if (!r.ok) {
    const because = String(r.because || 'the tunnel program failed');
    /* clap prints "error: unrecognized subcommand 'assistant-chat'" FIRST and the usage
       after it, so the last line alone never says so (measured on the shipped tunnel). */
    if (/unrecognized subcommand|invalid subcommand/i.test(String(r.stderr || '') + '\n' + because)) {
      return { ok: false, unsupported: true, because };
    }
    return r.timedOut ? { ok: false, timedOut: true, because } : { ok: false, because };
  }
  let said;
  try { said = JSON.parse(r.said); } catch { return { ok: false, because: 'the tunnel program answered in a shape we could not read' }; }
  if (!said || typeof said !== 'object' || !Number.isInteger(said.status) || !said.body || typeof said.body !== 'object') {
    return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
  }
  return { ok: true, status: said.status, body: said.body };
}

/** Forget this Mac (#793): retire it at the coordinator while its key still
 * exists, THEN destroy the key. Order is the whole point: after the state
 * dir is gone the Mac cannot speak for itself and only a signed-in phone
 * can retire it (a dead sandbox, a wiped laptop). Retire is best-effort and
 * its outcome is reported, never hidden: a coordinator that could not be
 * reached still leaves the Mac forgotten HERE, and the answer says the
 * address may still show on the account page until it is removed there. */
async function forget() {
  // #3827: a sign-in in flight ends with the Mac's identity. Cancel it (its register
  // must not turn the switch back on), and WAIT for a register already out, so what
  // is retired and wiped below includes it; otherwise it writes a fresh identity
  // into the directory this empties. The wait is bounded: the register itself is
  // (registerTimeoutMs). Worst case, three bounds in a row, about fifteen minutes:
  // the register first retiring a half identity, the register itself, then this
  // retire. Only when something is already broken.
  //
  // One forget at a time: a second (a double click, two tabs, a retried request)
  // gets the first one's answer instead of retiring the same Mac beside it.
  if (forgetInFlight) return forgetInFlight;
  signinEpoch += 1;
  signinSession = null;
  forgetting = true;
  forgetInFlight = (async () => {
    try {
      if (registerInFlight) await registerInFlight;
      return await forgetNow();
    } finally {
      forgetting = false;
      forgetInFlight = null;
    }
  })();
  return forgetInFlight;
}
let forgetInFlight = null;

async function forgetNow() {
  const was = { enrolled: enrolled(), address: address() };
  // A register killed mid-certificate (or any partial one) has registered the Mac
  // at the coordinator and left its key and id here, without the certificate
  // enrolled() needs. It can still sign a retire, so it is retired too.
  const canRetire = was.enrolled || halfRegistered();
  stopChild();
  let retired = false;
  let because = null;
  if (canRetire) {
    const r = await setupRun(['retire', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()], null, registerTimeoutMs());
    retired = r.ok === true;
    because = r.ok ? null : r.because;
  }
  try { fs.rmSync(STATE_DIR(), { recursive: true, force: true }); } catch { /* best effort; enrolled() re-reads */ }
  try { fs.rmSync(STATUS_FILE(), { force: true }); } catch { /* stale is worse than absent */ }
  const r = read();
  /* Fed gate: CLEAR the cached standing on forget. This account is gone from this
     Mac; leaving a 'good' standing behind would make kosmosPlus() (and so the paid
     federation UI) true for the NEXT account that has not signed in yet -- a leak
     of a member-only feature to a non-member. A real sign-in re-caches the new
     account's standing; until then, unknown -> not a member. */
  write({ ...r, on: false, standing: '' });
  // Anything started during the retire wait (it can be minutes) goes too.
  stopChild();
  return {
    ok: true,
    retired,
    address: was.address,
    // Keyed on what was ATTEMPTED (canRetire), not on enrolled(): a half-registered
    // Mac is retired too, and its result must be reported as it is.
    because: !canRetire ? 'this computer was not set up for Plus, so there was nothing to retire'
      : retired ? null
      : 'this computer is forgotten here, but your Kosmos+ account could not be updated (' + because + '); its address may still show on your account page until you remove it there',
  };
}

/** Reset the account's second factor from this Mac (#733 recovery). A person
 * at this keyboard already holds what the factor protects, so the Mac's own
 * signed request clears it and nothing else can; the coordinator refuses it
 * unsigned and for a stranger key. Only an enrolled Mac can ask. */
async function secondReset() {
  if (!enrolled()) {
    return { ok: false, because: 'this computer is not set up for Plus, so it cannot reset a second factor' };
  }
  const r = await setupRun(['second', 'reset', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()]);
  if (!r.ok) return { ok: false, because: r.because };
  return { ok: true, because: null };
}

/** The email step: ask the coordinator to send the code. */
async function setupStart(email) {
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  const result = await setupRun(['setup', 'start', '--coordinator', COORDINATOR(), '--email', email]);
  if (result.ok) write({ email });
  return result;
}

/** The code step: finish enrolment, then bring the tunnel up if the switch
    is on. `name` is the address label the person asked for. */
async function setupComplete(code, name) {
  // #3827: the older Settings setup writes the same state directory as the in-app
  // register, so it takes the same guards.
  { const b = busy(); if (b) return b; }
  const settings = read();
  if (!settings.email) return { ok: false, because: 'start with the email step' };
  // #1010: a reinstall whose state SURVIVED is already set up -- do not re-enrol.
  // install/setup.sh never removes Application Support, so mac_id / address /
  // tls.crt / tls.key survive an install-over-the-top and enrolled() reads true.
  // Re-running enrolment here would mint a NEW identity key (crates/tunnel
  // setup.rs generates a fresh one by design, #1003), spend a scarce certificate
  // (#1003), and hit the coordinator's 409 about "a Mac on this account" -- for
  // THIS same Mac's own previous life, with no other Mac in sight. So when we are
  // already enrolled at the address this name maps to, recognise the Mac as
  // itself and just bring the tunnel up. A DIFFERENT name is a rename (a real
  // address change) and deliberately falls through to the setup path below.
  //
  // ACCOUNT-SWITCH EDGE (by design, not a defect): if the surviving state is for
  // account A at name X and someone runs the flow with a DIFFERENT account's
  // email and that account's valid code but the SAME name X, this recognises the
  // Mac and keeps account A's enrolment -- the new code is never used. Switching
  // the account on a Mac is what `forget()` (which wipes the state dir) is for;
  // once the state is gone, enrolled() is false and this guard does not fire.
  /* #3796 addendum 6 (Josh: "support either capital or lowercase"): the coordinator lowercases a
     name anyway, so only this app refused "MacbookPro". Lowercase (and trim) FIRST, before the
     recognition below as well as the rule: "Hers" on a Mac enrolled as hers is this Mac (review). */
  if (typeof name === 'string') name = name.trim().toLowerCase();
  if (enrolled()) {
    const have = address();
    if (have && have.split('.')[0] === name) {
      ensure(localPort);
      return { ok: true, because: null, alreadySetUp: true, address: have };
    }
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  if (typeof name !== 'string' || !NAME_RULE.test(name)) {
    return { ok: false, because: 'the name is 3 to 32 letters, digits or hyphens' };
  }
  secureStateDir();
  // Tracked like the in-app register (Forget waits for it; nothing else starts
  // beside it), bounded the same, and a half identity is retired first.
  const running = (async () => {
    const half = await clearHalfIdentity();
    if (half && half.kept) return KEPT_HALF(half.kept);
    return explainStranded(await setupRun([
      'setup', 'complete',
      '--coordinator', COORDINATOR(),
      '--email', settings.email,
      '--code', String(code),
      '--name', name,
      '--state-dir', STATE_DIR(),
    ], null, registerTimeoutMs()), half);
  })();
  registerInFlight = running;
  // A Forget or Sign out that lands while this waits: the Settings page must not
  // be told it is set up, and nothing here may bring the tunnel up.
  const epoch = signinEpoch;
  let result;
  try { result = await running; } finally { if (registerInFlight === running) registerInFlight = null; }
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (result.ok) ensure(localPort);
  // fed gate: cache the coordinator standing if this setup response carried one.
  if (result.ok && result.data && typeof result.data === 'object') fedSetStanding(result.data.standing);
  return result;
}


/* ---- Devices (#567): the Allow moment. The tunnel binary is the ONLY
   writer of this Mac's allow_list; this module asks it in the shape setup
   already uses, and reads the pending snapshot the running tunnel refreshes
   every five seconds, so every open board can poll without spawning. ---- */
const DEVICE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const DEVICE_NAME = /^[^\n\r]{1,60}$/;
function pendingFile() { return path.join(STATE_DIR(), 'pending.json'); }
/** What is waiting for this Mac's Allow. A missing snapshot is an empty
    list, not an error: the tunnel writes it only once it is up, and a
    board with Plus off has nothing waiting. `snapshot` says which. */
function pendingDevices() {
  const settings = read();
  if (!settings.on || !enrolled()) return { devices: [], snapshot: false, email: settings.email || '' };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8')); } catch { raw = null; }
  const list = raw && Array.isArray(raw.devices) ? raw.devices : [];
  const devices = list
    .filter((d) => d && DEVICE_ID.test(String(d.device_id || '')))
    .map((d) => ({
      device_id: String(d.device_id),
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 60) : null,
      first_seen: Number(d.first_seen) || 0,
      code: typeof d.code === 'string' ? d.code : '',
      /* When this Mac last said no to this id, or 0: the re-ask sentence. */
      denied_at: Number(settings.denied[String(d.device_id)]) || 0,
    }));
  return { devices, snapshot: raw !== null, email: settings.email || '' };
}
/** The binary answers JSON on stdout for every devices verb; a non-JSON
    answer is reported as such rather than guessed at. */
function parseSaid(result) {
  if (!result.ok) return result;
  try { return { ok: true, because: null, data: JSON.parse(result.said) }; }
  catch { return { ok: false, because: 'the tunnel program answered in a shape we could not read' }; }
}
function deviceArgs(verb, id, withCoordinator) {
  const args = ['devices', verb];
  if (withCoordinator) args.push('--coordinator', COORDINATOR());
  args.push('--state-dir', STATE_DIR());
  if (id !== null) args.push('--device-id', id);
  return args;
}
function checkId(id) {
  return typeof id === 'string' && DEVICE_ID.test(id) ? null : { ok: false, because: 'that is not a device we know' };
}
/** The devices this Mac lets in, joined with the sidecar (name, when let
    in, last used). Not enrolled means none, without asking the binary. */
async function devicesList() {
  if (!enrolled()) return { ok: true, because: null, data: { devices: [] } };
  const r = parseSaid(await setupRun(deviceArgs('list', null, false)));
  if (!r.ok) return r;
  const list = r.data && Array.isArray(r.data.devices) ? r.data.devices : [];
  return { ok: true, because: null, data: { devices: list
    .filter((d) => d && DEVICE_ID.test(String(d.device_id || '')))
    .map((d) => ({
      device_id: String(d.device_id),
      name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 60) : null,
      allowed_at: Number(d.allowed_at) || 0,
      last_seen: Number(d.last_seen) || 0,
      code: typeof d.code === 'string' ? d.code : '',
    })) } };
}
/** Let a device in: the binary writes this Mac's list FIRST, then tells the
    coordinator; a failed ack heals on the tunnel's next poll and the allow
    stands. `name` is the kind the phone gave, recorded for the list. */
async function deviceAllow(id, name) {
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  const args = deviceArgs('allow', id, true);
  if (typeof name === 'string' && DEVICE_NAME.test(name.trim())) args.push('--name', name.trim());
  return parseSaid(await setupRun(args));
}
/** Say no: the coordinator drops the request and the phone is told. Writes
    nothing on this Mac; a fresh sign-in may ask again. */
async function deviceDeny(id) {
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  const r = parseSaid(await setupRun(deviceArgs('deny', id, true)));
  if (r.ok) {
    const denied = { ...read().denied, [id]: Math.floor(Date.now() / 1000) };
    /* Bounded: the newest 50, so a file cannot grow without limit. */
    const keep = Object.entries(denied).sort((a, b) => b[1] - a[1]).slice(0, 50);
    write({ denied: Object.fromEntries(keep) });
  }
  return r;
}
/** Take it back: off this Mac's list at once, and the tunnel drops any live
    session for it on the next request. */
async function deviceRemove(id) {
  const bad = checkId(id); if (bad) return bad;
  if (!enrolled()) return { ok: false, because: 'finish the Plus sign-up first' };
  return parseSaid(await setupRun(deviceArgs('remove', id, false)));
}

/* ---- Sign in THIS computer (#3149 journey 2). The in-app wizard replaces the
   old jump-to-the-web: email code -> phone code -> "you're signed in". Unlike
   `setup` (create-or-join enrolment), these verbs never create an account -- a
   missing account is the coordinator's anti-enumeration silence, and the app
   shows a generic "Join Kosmos" nudge from the code screen rather than
   confirming existence. The kosmos-tunnel
   `signin {start,verify,second,enrol,confirm-enrol,register}` verbs each print
   one JSON object with a `stage` field; this module drives them and hands the
   PAGE only page-safe fields: the stage always; on the enrol_second_factor stage,
   sms_available and the why-authenticator copy; and on the enrolment_started stage,
   the kind and the material the enrol screen shows (a totp secret/otpauth, or the
   masked sms sent_to tail) -- never a token, and never the full phone number.

   🔒 The bearer material stays HERE, never the browser. THREE bearer credentials
   pass through, all held the same way: `verify`/`second` return a 30-day session
   token, `verify` a phone-code challenge id, and `verify`'s enrol_second_factor
   branch an enrol-only token (which `enrol`/`confirm-enrol` spend). All are
   sensitive and live in `signinSession` in this process for the seconds between
   steps -- the wizard sees only page-safe fields (never bearer material), and
   `register` spends the session token from here (piped to the CLI over stdin, off
   argv). This is the #874 posture: the page cannot carry, replay, or leak a
   credential it never holds. It is memory-only on purpose -- a board restart mid-flow drops it and
   the person simply starts sign-in again, which is safe and quick.

   ⚠️ ONE SLOT, and the collision edge stated in full (by design, not a defect,
   for the same reason setupComplete's ACCOUNT-SWITCH EDGE is). This is built for
   one person at one board signing in this computer at a time -- the only actor
   who can reach the board's loopback API. A fresh `start` clears the slot, so
   the LAST flow wins. If two flows on the same board interleave and BOTH reach a
   session before either registers, the second overwrites the first, and the
   first tab's `register` then spends whichever session is current. It is not
   fully silent: `register`'s answer carries the `address` the account got, which
   the wizard shows, so a person who somehow drove two accounts in two tabs sees
   which one landed. Per-flow keying would close it, but a single slot is correct
   for the product and per-flow ids would push state into the wizard for a race
   only a split-brain single operator could cause. If concurrent per-board
   sign-ins ever become real, key this by a per-flow id. ---- */
let signinSession = null;

/** This computer's stable sign-in device id. `signin start` and its matching
    `verify` must carry the SAME device id (the coordinator ties the emailed
    code to it), and it should be stable across attempts so the account's device
    list shows one "this computer" row rather than a new one each try -- so the
    app owns and persists it, per the CLI contract. It is a plain opaque label,
    not enrolment crypto (see the NO CRYPTO HERE note at the top). Minted once,
    kept in remote.json, reused forever; a stored value that somehow fails the
    shape check is replaced rather than trusted.

    The in-process memo (`mintedDeviceId`) is what makes start and verify use the
    SAME id even if the write to remote.json fails (disk full, permissions): that
    tie is load-bearing (the coordinator binds the emailed code to the device id
    a `start` presented, and `verify` must present the same one), and a single
    sign-in flow always runs in one board process. A fresh process re-reads the
    file, or mints again if the write never landed. */
let mintedDeviceId = null;
function signinDeviceId() {
  if (mintedDeviceId && DEVICE_ID.test(mintedDeviceId)) return mintedDeviceId;
  const r = read();
  if (typeof r.device_id === 'string' && DEVICE_ID.test(r.device_id)) {
    mintedDeviceId = r.device_id;
    return mintedDeviceId;
  }
  const id = crypto.randomUUID();
  mintedDeviceId = id;      // hold it even if the persist below fails
  write({ device_id: id });
  return id;
}

/** Take the tunnel's `stage` answer, stash any bearer material HERE, and return
    to the caller ONLY page-safe fields (never the session token, never the
    challenge value, never the enrol-only token) -- the stage always, plus on the
    enrol stage the sms_available flag and why-authenticator copy the enrol screen
    renders. Pure-ish: it mutates `signinSession` and returns the page-safe shape.

    FAIL CLOSED: every path sets `signinSession` to exactly this answer's result
    (a session token, a challenge, an enrol-only token, or nothing), so the slot
    never carries a stale value from a PRIOR call across a malformed one. A
    verify/second/confirm-enrol answer whose shape we cannot use clears the slot
    (signinEnrol's own answer does not route through here) -- a
    person who hits an error state
    restarts sign-in rather than silently spending an earlier session. */
function absorbSession(data) {
  const stage = data && typeof data.stage === 'string' ? data.stage : '';
  if (stage === 'session') {
    const token = data && typeof data.token === 'string' ? data.token : '';
    if (!token) { signinSession = null; return { ok: false, because: 'Kosmos+ sign-in did not return a usable session' }; }
    signinSession = { token };
    /* #3796 addendum 8: when the account already has an address, the name step asks for nothing and
       says "This computer will connect as <address>". The coordinator's sign-in answer carries it as
       account_address (a coordinator that predates it sends none, and the page falls back). Passed
       through only in its own shape: a lowercase label and a domain, nothing else. */
    const addr = typeof data.account_address === 'string' && /^[a-z0-9-]{3,32}\.[a-z0-9.-]{3,253}$/.test(data.account_address) ? data.account_address : '';
    return { ok: true, because: null, data: { stage: 'session', account_address: addr } };
  }
  if (stage === 'second') {
    const challenge = data && typeof data.challenge === 'string' ? data.challenge : '';
    if (!challenge) { signinSession = null; return { ok: false, because: 'Kosmos+ sign-in did not return a phone challenge' }; }
    signinSession = { challenge };
    /* #3796 (Josh's live test): the step must name the account's ONE factor. The coordinator
       says which (open_challenge: "second" is the account's kind, "sent_to" the masked phone
       tail for sms); pass exactly those through, and only in the shapes it sends, so the page
       never renders anything else from here. Absent or unknown, the page falls back to
       generic words rather than guessing. */
    const kind = data.second === 'totp' || data.second === 'sms' ? data.second : '';
    const sentTo = kind === 'sms' && typeof data.sent_to === 'string' && /^\u2022{3}( \d{4})?$/.test(data.sent_to) ? data.sent_to : '';
    return { ok: true, because: null, data: { stage: 'second', second_kind: kind, sent_to: sentTo } };
  }
  if (stage === 'enrol_second_factor') {
    // The account has no second factor yet and the coordinator requires one.
    // Hold the ENROL-ONLY token (verify's answer carries it) so signinEnrol /
    // signinConfirmEnrol can spend it; it is a bearer credential and stays HERE,
    // never returned to the page, exactly like the session token. The wizard gets
    // only what it renders: whether SMS is on, and the "why an authenticator" copy.
    const enrolToken = data && typeof data.token === 'string' ? data.token : '';
    if (!enrolToken) { signinSession = null; return { ok: false, because: 'Kosmos+ sign-in did not return an enrolment token' }; }
    signinSession = { enrolToken };
    return { ok: true, because: null, data: {
      stage: 'enrol_second_factor',
      sms_available: data.sms_available === true,
      why_authenticator: typeof data.why_authenticator === 'string' ? data.why_authenticator : '',
    } };
  }
  signinSession = null;
  return { ok: false, because: 'the tunnel program answered in a shape we could not read' };
}

/** Append --device-name only when the label is present and clean (trimmed once,
    no newline, 1-60 chars). A malformed label is dropped rather than surfaced --
    a newline in argv would let it inject a second value. Shared by start/verify
    so the two carry the label identically. */
function pushDeviceName(args, deviceName) {
  if (typeof deviceName !== 'string') return;
  const trimmed = deviceName.trim();
  if (DEVICE_NAME.test(trimmed)) args.push('--device-name', trimmed);
}

/** #3796: the wizard's "Sign out". Drop whatever half-finished sign-in this process holds
    (a session token, a phone challenge, or an enrol-only token), so leaving the wizard
    leaves no bearer material behind. Nothing is sent to the coordinator: an unspent
    token lapses there on its own, and the next signinStart starts clean either way. */
function signinCancel() {
  signinEpoch += 1;
  signinSession = null;
  return { ok: true, because: null, data: { stage: 'cancelled' } };
}
/* #3796 (review): a step still waiting on the tunnel program when Sign out lands must not
   write its answer back afterwards, or a verify in flight resurrects a live session token the
   person believes they signed out of. Every step records the epoch before it awaits and, if a
   cancel moved it meanwhile, returns this instead of absorbing anything. */
let signinEpoch = 0;
const SIGNIN_CANCELLED = { ok: false, because: 'the sign-in was cancelled' };

/** Step one: ask the coordinator to email the six-digit code. Safe to repeat;
    reveals nothing about whether the account exists. A fresh start abandons any
    half-finished flow. */
async function signinStart(email, deviceName) {
  // A register still out would clear this new sign-in's session when it finishes.
  { const b = busy(); if (b) return b; }
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  signinSession = null;
  const args = ['signin', 'start', '--coordinator', COORDINATOR(),
    '--email', email, '--device-id', signinDeviceId()];
  pushDeviceName(args, deviceName);
  const r = parseSaid(await setupRun(args));
  // Deliberately does NOT persist the email. The setup flow writes it because
  // setupComplete reads it back; sign-in carries the email explicitly through
  // verify, so nothing here needs it. Writing it would also make status()'s
  // not-enrolled "waiting for the code sent to <email>" sentence render during
  // sign-in and go stale the moment the flow reaches the phone step, and would
  // leave a stale email behind if the flow is abandoned. The wizard shows the
  // in-flight email itself.
  return r.ok ? { ok: true, because: null, data: { stage: 'code_sent' } } : r;
}

/** Step two: hand back the emailed code. The answer is a finished session, a
    phone challenge (`stage: "second"`), or an enrolment prompt. */
async function signinVerify(email, code, deviceName) {
  { const b = busy(); if (b) return b; }
  if (typeof email !== 'string' || !email.includes('@')) {
    return { ok: false, because: 'that does not look like an email address' };
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  const args = ['signin', 'verify', '--coordinator', COORDINATOR(),
    '--email', email, '--device-id', signinDeviceId(), '--code', String(code)];
  pushDeviceName(args, deviceName);
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(args));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  // A CLI error (wrong code, coordinator down) is a TRANSIENT "try again" and
  // deliberately leaves any prior held session intact for a retry -- same as
  // signinSecond keeping the challenge on a wrong phone code. Only an untrusted
  // SHAPE (a well-formed exit whose JSON we cannot use) fails closed, and that
  // clearing lives in absorbSession. So "unsuccessful verify" is not "slot
  // cleared"; "unusable answer" is.
  if (!r.ok) return r;
  return absorbSession(r.data);
}

/** Step three (only after `verify` returned `stage: "second"`): the phone code,
    checked against the challenge held here. On success, a session. */
async function signinSecond(code) {
  { const b = busy(); if (b) return b; }
  if (!signinSession || typeof signinSession.challenge !== 'string') {
    return { ok: false, because: 'start the sign-in again: there is no phone step waiting' };
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(['signin', 'second', '--coordinator', COORDINATOR(),
    '--challenge', signinSession.challenge, '--code', String(code)]));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  return absorbSession(r.data);
}

/** Enrol a second factor (#3149 increment 4), only after `verify` returned
    `enrol_second_factor` -- the account has none and the coordinator requires
    one, so set one up in-app instead of dead-ending. Drives the tunnel `signin
    enrol` verb with the held enrol-only token (piped to stdin, off argv). `kind`
    is "totp" (authenticator app) or "sms" (text message); `phone` is required for
    sms. Returns the coordinator's start-of-enrolment answer for the wizard to
    show: for totp the `secret`/`otpauth` to render as a QR or typed string; for
    sms the masked `sent_to` tail the code went to. The full phone number never
    comes back -- only the masked tail travels. */
async function signinEnrol(kind, phone) {
  { const b = busy(); if (b) return b; }
  if (!signinSession || typeof signinSession.enrolToken !== 'string') {
    return { ok: false, because: 'start the sign-in again: there is no enrolment waiting' };
  }
  if (kind !== 'totp' && kind !== 'sms') {
    return { ok: false, because: 'choose the authenticator app or a text message' };
  }
  const args = ['signin', 'enrol', '--coordinator', COORDINATOR(), '--kind', kind];
  if (kind === 'sms') {
    const trimmedPhone = typeof phone === 'string' ? phone.trim() : '';
    if (!trimmedPhone) {
      return { ok: false, because: 'a phone number is needed for a text message' };
    }
    // We do NOT format-check the number (unlike --device-name's strict regex): the
    // coordinator OWNS phone normalization and accepts the spaced/dashed/+ forms a
    // person types, so a shape guard here would wrongly reject valid input. Two argv
    // concerns are worth keeping distinct because they have different mechanisms:
    //   1. Shell injection cannot arise for ANY character -- spawn takes the ARRAY
    //      form, so a character inside one element (even a newline) can never become a
    //      second argv entry. This is the mechanism the --device-name comment gestures
    //      at; array-form is what actually defeats it, not the newline guard itself.
    //   2. A value that STARTS with '-' could be misread by the tunnel CLI's OWN arg
    //      parser as a flag rather than --phone's value -- a parser concern, not a
    //      shell one, and the one thing worth guarding here. No valid phone starts with
    //      '-' (they start with '+' or a digit), so rejecting a leading '-' rejects no
    //      legitimate input. --phone is also pushed LAST, so even a misparse could not
    //      consume a following argument.
    if (trimmedPhone.startsWith('-')) {
      return { ok: false, because: 'that does not look like a phone number' };
    }
    // The phone rides argv and is therefore visible in the local process list (`ps`)
    // for the child's lifetime -- unlike the bearer tokens, which are kept on stdin.
    // This is an ACCEPTED exposure, not an oversight: the phone is not a bearer
    // credential (it cannot admit or authorise anyone), and every non-credential
    // field in the sibling verbs -- email, code, device name -- rides argv the same
    // way. The #874 boundary is about credentials, and no credential is on argv here.
    args.push('--phone', trimmedPhone);
  }
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(args, signinSession.enrolToken));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  // Fail closed if the coordinator's 200 did not carry the material this kind needs
  // (a totp secret/otpauth to show, or the masked sms tail): a clear error beats a
  // blank enrol screen presented as success. We validate the MATERIAL, not d.stage --
  // the tunnel forces stage: "enrolment_started" on this verb, so a stage check could
  // never fire; a missing field is the failure that can actually reach here.
  //
  // ONE predicate ("a usable material string") drives BOTH the presence guard and the
  // copy into out, so the two can never disagree. An earlier split -- a truthiness
  // guard beside a typeof copy -- let an empty string, then a truthy non-string
  // (secret: 123), slip between "believed present" and "actually returned", each
  // yielding the blank screen as a false success. str() collapses that surface: a
  // field is material iff it is a non-empty string, and exactly those get copied.
  const str = (v) => (typeof v === 'string' && v !== '' ? v : null);
  const secret = str(d.secret), otpauth = str(d.otpauth), sentTo = str(d.sent_to);
  if (kind === 'totp' && !secret && !otpauth) {
    return { ok: false, because: 'Kosmos+ sign-in did not return an authenticator secret to set up' };
  }
  if (kind === 'sms' && !sentTo) {
    return { ok: false, because: 'Kosmos+ sign-in did not confirm where the code was sent' };
  }
  const out = {
    stage: 'enrolment_started',
    kind,  // the locally-validated kind we requested, never the coordinator's echo
    why_authenticator: typeof d.why_authenticator === 'string' ? d.why_authenticator : '',
  };
  // Copy only THIS kind's material, mirroring the kind-scoped guard above: totp gets
  // the secret/otpauth to scan or type, sms gets only the masked tail. Gating by kind
  // (not a flat copy) means a stray wrong-kind field the coordinator happens to send
  // -- a secret on an sms answer, a tail on a totp answer -- cannot bleed into the
  // page; we present exactly the material the guard just accepted, never the other.
  if (kind === 'totp') {
    if (secret) out.secret = secret;
    if (otpauth) out.otpauth = otpauth;
  } else if (kind === 'sms') {
    if (sentTo) out.sent_to = sentTo;
  }
  return { ok: true, because: null, data: out };
}

/** Confirm the enrolment code the new factor now shows (the authenticator app's
    code, or the texted SMS code). Drives `signin confirm-enrol` with the held
    enrol-only token; on success the coordinator sets the factor and issues the
    person's FIRST session, which absorbSession captures exactly like verify /
    second, so the wizard proceeds to `register`. */
async function signinConfirmEnrol(code) {
  { const b = busy(); if (b) return b; }
  if (!signinSession || typeof signinSession.enrolToken !== 'string') {
    return { ok: false, because: 'start the sign-in again: there is no enrolment waiting' };
  }
  if (!CODE_RULE.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  const epoch = signinEpoch;
  const r = parseSaid(await setupRun(['signin', 'confirm-enrol', '--coordinator', COORDINATOR(),
    '--code', String(code)], signinSession.enrolToken));
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  // The confirm answer is a session; absorbSession swaps the held enrol token for
  // the session token (fail-closed on a malformed shape), so register spends it.
  return absorbSession(r.data);
}

/** Last step: register THIS computer with the session held here. The keypair is
    born in the binary (private half never travels); the token is piped in over
    stdin, off argv. On success the state dir is written and the tunnel comes up
    if the switch is on, exactly as `setup complete` does. A failed register
    keeps the session so the person can pick another name without redoing the
    code steps. */
/* #3827: a register in flight (forget() waits for it), and the bound on a register
   or a retire, so neither a hung coordinator nor a hung connector can hang Forget. */
let registerInFlight = null;
let forgetting = false;
// A healthy register includes the certificate, which holds the call open for the
// ACME propagation wait (a minute or two; 65s measured on production 2026-09-25).
// So the bound is generous: it exists only so a HUNG one cannot hang Forget.
const REGISTER_TIMEOUT_MS = 5 * 60 * 1000;
// Env seam for tests, like AGENT_WORKFORCE_TUNNEL_BIN. (0 or unset: the default.)
const registerTimeoutMs = () => {
  const v = Number(process.env.AGENT_WORKFORCE_REGISTER_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : REGISTER_TIMEOUT_MS;   // never "no bound"
};
// A Mac key and id with no certificate: a register that was cut off after the
// coordinator accepted it. It is registered there, so registering again would strand
// it (or meet "already owns the name"); Forget retires it.
const halfRegistered = () => !enrolled() && ['mac_id', 'mac_key'].every((f) => fs.existsSync(path.join(STATE_DIR(), f)));
/* Retires a half identity before a new register. Answers why the retire failed
   (the coordinator may still hold that earlier attempt), or null. */
async function clearHalfIdentity() {
  if (!halfRegistered()) return null;
  const r = await setupRun(['retire', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()], null, registerTimeoutMs());
  // No answer (timed out, unreachable, the program would not start) may work a
  // moment later, and only this key can do it: keep it, and the caller says try
  // again. A retire that worked, or a definite refusal from Kosmos+, wipes it.
  if (!r.ok && !/said no \(4\d\d\)/.test(String(r.because || ''))) {
    process.stderr.write('remote: an unfinished earlier sign-in could not be retired at Kosmos+ yet (' + r.because + '); kept, so a retry can\n');
    return { kept: r.because || 'no reason given' };
  }
  if (!r.ok) process.stderr.write('remote: an unfinished earlier sign-in could not be retired at Kosmos+ (' + r.because + '); its address may show on the account page until it is removed there\n');
  try { fs.rmSync(STATE_DIR(), { recursive: true, force: true }); } catch { /* the register writes it again */ }
  secureStateDir();
  return r.ok ? null : { stranded: r.because || 'no reason given' };
}
/* The register's answer when a half identity was kept for a retry. */
const KEPT_HALF = (why) => ({ ok: false, because: 'an earlier sign-in on this computer could not be removed from your Kosmos+ account yet (' + why + '); try again in a moment' });
/* After a half identity could not be retired, a "name taken" answer is most
   likely this computer's own earlier attempt, not another Mac: say so, and
   what to do, instead of letting it read as someone else's name. */
function explainStranded(result, half) {
  const stranded = half && half.stranded;
  // Only the same-account answer: another account's name ("that name is taken")
  // or this account's own name rule is not this computer's doing.
  if (!stranded || !result || result.ok || !/already in use by a Mac on this account/i.test(String(result.because || ''))) return result;
  return { ...result, because: String(result.because).replace(/[.\s]+$/, '') + '. This computer\'s own earlier sign-in could not be removed from your Kosmos+ account (' + stranded + '), so it may be what holds the name: remove it on your account page, or pick another name' };
}
function busy() {
  // Forgetting first: while a Forget waits on a register both are true, and the
  // Forget is what the person just asked for.
  if (forgetting) return { ok: false, because: 'this computer is being forgotten; try again in a moment' };
  if (registerInFlight) return { ok: false, because: 'this computer is still signing in; give it a minute' };
  return null;
}
/* #3827: signing in IS asking to be reachable, so a successful register switches
   Kosmos+ on. A failed save is logged: the Mac is registered either way, and the
   switch then still says off. */
function turnOnAfterSignin() {
  const wrote = write({ on: true });
  if (!wrote.ok) process.stderr.write('remote: signed in, but could not switch Kosmos+ on: ' + wrote.because + '\n');
}

async function signinRegister(name) {
  // First, before every path (the #1010 shortcut included): one register at a time (the
  // page gives up waiting long before a register with a certificate is done, and a
  // Try again must not start a second into the same directory), and none while
  // this computer is being forgotten.
  { const b = busy(); if (b) return b; }
  /* #3796 addendum 6 (Josh: "support either capital or lowercase"): the coordinator lowercases a
     name anyway, so only this app refused "MacbookPro". Lowercase (and trim) BEFORE the rule. */
  if (typeof name === 'string') name = name.trim().toLowerCase();
  if (typeof name !== 'string' || !NAME_RULE.test(name)) {
    return { ok: false, because: 'the name is 3 to 32 letters, digits or hyphens' };
  }
  // #1010/#1003: a surviving state dir already at this name IS this Mac. Do not
  // re-register -- it would mint a fresh identity key and spend a scarce
  // certificate for this Mac's own previous life. Recognise it, bring the tunnel
  // up, done. A DIFFERENT name is a real move and falls through to register.
  //
  // ACCOUNT-SWITCH EDGE (by design, the same one setupComplete documents, and
  // more reachable here since journey 2 is specifically "sign in an existing
  // account"): if the surviving state is account A at name X and someone signs
  // in as account B but registers at the SAME name X, this recognises the Mac
  // and KEEPS account A's enrolment -- account B's held session is never spent.
  // Switching the account on a Mac is what forget() (which wipes the state dir)
  // is for; once the state is gone, enrolled() is false and this guard does not
  // fire.
  if (enrolled()) {
    const have = address();
    if (have && have.split('.')[0] === name) {
      /* #3827: signing in IS asking to be reachable; ensure() only starts the tunnel when switched on. */
      turnOnAfterSignin();
      ensure(localPort);
      signinSession = null;
      // standing is '' on this path, not omitted: the engine cannot know it
      // without the coordinator round-trip this short-circuit skips, and a
      // uniform shape (always a standing key) is easier for the wizard than a
      // sometimes-absent field. 3b treats '' as "unknown, ask on next check".
      return { ok: true, because: null, data: { stage: 'registered', address: have, name, standing: '', alreadySetUp: true } };
    }
  }
  // After the shortcut: a register the page gave up on (it waits 15s, a
  // certificate takes about a minute) finishes, clears the session and is set up;
  // a Try again at the same name is answered above, not sent to the code steps.
  if (!signinSession || typeof signinSession.token !== 'string') {
    return { ok: false, because: 'finish the code steps first' };
  }
  secureStateDir();
  // Like every other step: a Sign out (or a Forget) that lands while register is
  // waiting on the connector must not be followed by this turning Kosmos+ on.
  const epoch = signinEpoch;
  const token = signinSession.token;
  const running = (async () => {
    // An earlier register that stopped after the coordinator accepted it (key and
    // id, no certificate) is retired first, so this one does not strand it.
    const half = await clearHalfIdentity();
    if (half && half.kept) return KEPT_HALF(half.kept);
    return explainStranded(await setupRun(['signin', 'register', '--coordinator', COORDINATOR(),
      '--name', name, '--state-dir', STATE_DIR()], token, registerTimeoutMs()), half);
  })();
  registerInFlight = running;
  let r;
  try { r = parseSaid(await running); } finally { if (registerInFlight === running) registerInFlight = null; }
  // A cancel after the coordinator accepted the register cannot undo it: the Mac is
  // registered and the next paint shows the switch OFF, which is the truth. What a
  // cancel must never do is let this switch it on.
  if (epoch !== signinEpoch) return SIGNIN_CANCELLED;
  if (!r.ok) return r;
  signinSession = null;   // the token is spent; it must not linger in this process
  /* #3827 (Josh's live test: registered, then the relay never heard from this Mac): ensure() starts the
     tunnel only when switched ON, and nothing set it, so the pane showed "Turn on" and the wizard's
     "connecting" was false. Signing in IS asking to be reachable; turning off stays one press away. */
  turnOnAfterSignin();
  ensure(localPort);
  const d = r.data && typeof r.data === 'object' ? r.data : {};
  fedSetStanding(d.standing);   // fed gate: SET (or clear) standing from this fresh register
  return { ok: true, because: null, data: {
    stage: 'registered',
    address: typeof d.address === 'string' ? d.address : address(),
    name: typeof d.name === 'string' ? d.name : name,
    standing: typeof d.standing === 'string' ? d.standing : '',
  } };
}

module.exports = { secondReset, forget, macRequest, assistantChat, hostedAvailable, DEFAULT_RELAY, DEFAULT_COORDINATOR, configured,
  FILE,
  read,
  kosmosPlus,
  fedSetStanding,
  refreshStandingIfStale,
  federationLive,
  refreshFederationLiveIfStale,
  setOn,
  setRelay,
  enrolled,
  address,
  ensure,
  status,
  setupStart,
  setupComplete,
  signinStart,
  signinVerify,
  signinSecond,
  signinEnrol,
  signinConfirmEnrol,
  signinRegister,
  signinCancel,
  pendingDevices,
  devicesList,
  deviceAllow,
  deviceDeny,
  deviceRemove,
  /* #988: ONE derivation of each of these, for the same reason the #790 comment
     above gives. engine/updating.js speaks to the coordinator directly and must
     not re-derive either, or the two disagree the moment one of them learns
     something. */
  coordinator: COORDINATOR,
  stateDir: STATE_DIR,
  /* test seam: stops the supervised child between cases (the name is the
     one the reachability sweep excuses for exactly this job) AND clears any
     in-flight sign-in and the device-id memo, so neither a held token/challenge
     nor a memoised device id leaks across cases. */
  resetForTests: () => { signinSession = null; mintedDeviceId = null; registerInFlight = null; forgetInFlight = null; forgetting = false; stopChild(); },
  /* test seam: the live child's pid, or null. spawn() sets the handle
     synchronously, so a test can assert "nothing spawned" deterministically
     right after ensure() instead of waiting a fixed interval and hoping. */
  currentChildPid: () => (child ? child.pid : null),
};
