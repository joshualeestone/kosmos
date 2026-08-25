'use strict';
/**
 * The tunnel supervisor: the engine side of "Use Kosmos from anywhere"
 * (the relay plan, Josh-Brain 2026-08-23). The board process owns one
 * kosmos-tunnel child; this module is the only thing that starts it, stops
 * it, restarts it after a crash, and says honestly what it is doing.
 *
 * ⚠️ OFF BY DEFAULT, AND THE SWITCH IS THE ONLY THING THAT STARTS IT. Same
 * rule as the ping and the notify call: an outbound connection nobody
 * enabled is the one thing this product must never make.
 *
 * 🔑 NO CRYPTO HERE, ON PURPOSE. Enrolment (the keypair, the pin, the CSR)
 * and the connection itself live in the kosmos-tunnel binary, which is
 * tested against the coordinator's signed contracts in its own repo. This
 * module shells out to it and reads its status file, so the app never
 * grows a second implementation of any of that. The binary writes the
 * status file atomically on every state change; absence or a dead pid in
 * it means the process, not the connection, is the problem.
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
 *                                       relay, relay.plus.installkosmos.com:8443
 *                                       (the domain was decided 2026-08-23 and
 *                                       the box has served it since 2026-08-24;
 *                                       until then there was no default, so a
 *                                       wrong baked-in one could not dial
 *                                       somewhere nobody chose)
 *   AGENT_WORKFORCE_TUNNEL_COORDINATOR  coordinator URL for setup. Default: the
 *                                       real one, https://coordinator.plus.installkosmos.com
 *                                       (deployed 2026-08-24, #622)
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
const { spawn } = require('node:child_process');
const store = require('./store');

const BASE = process.env.AGENT_WORKFORCE_DATA || store.ROOT;
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
const DEFAULT_RELAY = 'relay.plus.installkosmos.com:8443';
const DEFAULT_COORDINATOR = 'https://coordinator.plus.installkosmos.com';
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
    if (err && err.code === 'ENOENT') return { on: false, relay: '', email: '', denied: {}, ok: true };
    return { on: false, relay: '', email: '', denied: {}, ok: false };
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { on: false, relay: '', email: '', denied: {}, ok: false }; }
  if (!parsed || typeof parsed !== 'object') return { on: false, relay: '', email: '', denied: {}, ok: false };
  return {
    on: parsed.on === true,
    relay: typeof parsed.relay === 'string' ? parsed.relay : '',
    email: typeof parsed.email === 'string' ? parsed.email : '',
    /* #567: ids this Mac said no to, with when. A re-ask from one of them
       gets a sentence on the card; nothing else reads this. */
    denied: parsed.denied && typeof parsed.denied === 'object' && !Array.isArray(parsed.denied) ? parsed.denied : {},
    ok: true,
  };
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
    sentence a person reads next to the switch. */
function setupRun(args) {
  return new Promise((resolve) => {
    let spawned;
    try { spawned = spawn(BIN(), args, { stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (err) {
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
    spawned.on('exit', (code) => {
      if (code === 0) { resolve({ ok: true, because: null, said: out.trim() }); return; }
      const lines = (errOut.trim() || out.trim()).split('\n').filter(Boolean);
      resolve({ ok: false, because: lines[lines.length - 1] || ('setup failed (exit ' + code + ')') });
    });
  });
}

/** Forget this Mac (#793): retire it at the coordinator while its key still
 * exists, THEN destroy the key. Order is the whole point: after the state
 * dir is gone the Mac cannot speak for itself and only a signed-in phone
 * can retire it (a dead sandbox, a wiped laptop). Retire is best-effort and
 * its outcome is reported, never hidden: a coordinator that could not be
 * reached still leaves the Mac forgotten HERE, and the answer says the
 * address may still show on the account page until it is removed there. */
async function forget() {
  const was = { enrolled: enrolled(), address: address() };
  stopChild();
  let retired = false;
  let because = null;
  if (was.enrolled) {
    const r = await setupRun(['retire', '--coordinator', COORDINATOR(), '--state-dir', STATE_DIR()]);
    retired = r.ok === true;
    because = r.ok ? null : r.because;
  }
  try { fs.rmSync(STATE_DIR(), { recursive: true, force: true }); } catch { /* best effort; enrolled() re-reads */ }
  try { fs.rmSync(STATUS_FILE(), { force: true }); } catch { /* stale is worse than absent */ }
  const r = read();
  write({ ...r, on: false });
  return {
    ok: true,
    retired,
    address: was.address,
    because: !was.enrolled ? 'this Mac was not set up for Plus, so there was nothing to retire'
      : retired ? null
      : 'this Mac is forgotten here, but the coordinator could not be told (' + because + '); its address may still show on your account page until you remove it there',
  };
}

/** Reset the account's second factor from this Mac (#733 recovery). A person
 * at this keyboard already holds what the factor protects, so the Mac's own
 * signed request clears it and nothing else can; the coordinator refuses it
 * unsigned and for a stranger key. Only an enrolled Mac can ask. */
async function secondReset() {
  if (!enrolled()) {
    return { ok: false, because: 'this Mac is not set up for Plus, so it cannot reset a second factor' };
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
  const settings = read();
  if (!settings.email) return { ok: false, because: 'start with the email step' };
  if (!/^[0-9]{6}$/.test(String(code || ''))) {
    return { ok: false, because: 'the code is six digits' };
  }
  if (typeof name !== 'string' || !/^[a-z0-9-]{3,32}$/.test(name)) {
    return { ok: false, because: 'the name is 3 to 32 lowercase letters, digits or hyphens' };
  }
  secureStateDir();
  const result = await setupRun([
    'setup', 'complete',
    '--coordinator', COORDINATOR(),
    '--email', settings.email,
    '--code', String(code),
    '--name', name,
    '--state-dir', STATE_DIR(),
  ]);
  if (result.ok) ensure(localPort);
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

module.exports = { secondReset, forget, DEFAULT_RELAY, DEFAULT_COORDINATOR, configured,
  FILE,
  read,
  setOn,
  setRelay,
  enrolled,
  address,
  ensure,
  status,
  setupStart,
  setupComplete,
  pendingDevices,
  devicesList,
  deviceAllow,
  deviceDeny,
  deviceRemove,
  /* test seam: stops the supervised child between cases (the name is the
     one the reachability sweep excuses for exactly this job) */
  resetForTests: stopChild,
  /* test seam: the live child's pid, or null. spawn() sets the handle
     synchronously, so a test can assert "nothing spawned" deterministically
     right after ensure() instead of waiting a fixed interval and hoping. */
  currentChildPid: () => (child ? child.pid : null),
};
