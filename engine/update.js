/**
 * Update awareness: is there a newer Kosmos published than the one running?
 *
 * The published truth is one tiny file, `latest.json` on the release host
 * (`{ "version": "0.1.1" }`), written by the same publish step that uploads
 * the bundle. This module fetches it RARELY (once per TTL window), NEVER on the
 * request path (the status route calls `poke()`, which returns immediately
 * and refreshes in the background), and fails soft in every direction: no
 * network, bad JSON, a weird shape -- all of them mean "no update showing"
 * ON THE TOAST, never an error thrown at anyone. The Settings card DOES
 * name failures (lastLook's reached/readable exist for it), which is a
 * different posture for a surface the person deliberately visits. An
 * update notice is the one feature whose absence must cost nothing.
 *
 * ⚠️ The comparison is strictly numeric dotted-triple, and UNKNOWN LOSES:
 * a malformed remote version compares as older than anything, so a corrupted
 * manifest cannot pop a toast asking somebody to install it.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const liveExec = require('./live-execution');
const { version: RUNNING } = require('../package.json');

const DEFAULT_BASE = 'https://installkosmos.com/dist';
// 15 minutes, down from 6 hours (2026-08-18): latest.json is ~25 bytes
// behind a CDN, so a fast pull is indistinguishable from push at this
// scale, and Josh's test hour showed what a 6-hour memory feels like: a
// release nobody's running app would admit existed.
const TTL = 15 * 60 * 1000;
const FETCH_TIMEOUT = 3000;

let base = process.env.AGENT_WORKFORCE_RELEASE_BASE || DEFAULT_BASE;
let fetcher = null;            // tests inject; null means global fetch
// reached: did the LAST look actually get an answer from the host?
// "could not reach the update server" must never render as "up to date",
// so the cache carries the distinction rather than flattening both into
// latest: null. at 0 means we have never looked.
let cache = { at: 0, latest: null, reached: false, readable: false };
let inFlight = null;
let installRunner = null;   // tests inject; production spawns the real installer
// Read lazily through a function rather than required at the top, so a test can
// answer the question without writing a preference file, and so this module
// keeps working if the preference file is not readable at load time.
let autoPrefFn = null;      // tests inject; production reads the real setting
let installedRootFn = null; // tests inject; production checks the real layout

function parts(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a is strictly newer than b; unknown on either side is never newer. */
function newer(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

/**
 * The cached verdict, synchronously: `{ version }` when something newer is
 * published, else null. Never touches the network.
 */
function available() {
  return (cache.latest && newer(cache.latest, RUNNING)) ? { version: cache.latest } : null;
}

/** Refresh the cache if stale. Returns immediately; errors stay internal. */
function poke() {
  if (Date.now() - cache.at < TTL) return;
  if (inFlight) return;
  inFlight = refresh().catch(() => { /* fail soft: no update showing */ })
    .finally(() => { inFlight = null; });
}

async function refresh() {
  const doFetch = fetcher || fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT);
  const started = Date.now();
  let landed = false;
  try {
    const res = await doFetch(`${base}/latest.json`, { signal: ctl.signal, cache: 'no-store' });
    if (res) {
      // ANY response object means the host was reached; reached false is
      // reserved for silence (throws, timeouts, DNS). readable means the
      // answer carried a usable version: a captive portal's 200 splash
      // page, a CDN 404, and a parse failure are all "reached, could not
      // read the answer" -- never "could not reach" (wrong leg), and
      // never "up to date" (the false sentence this module exists to
      // prevent).
      const body = res.ok ? await res.json().catch(() => null) : null;
      const v = body && typeof body.version === 'string' && parts(body.version) ? body.version : null;
      cache = { at: Date.now(), latest: v, reached: true, readable: v !== null };
      landed = true;
    }
  } finally {
    clearTimeout(timer);
    // ⚠️ A MISS IS AN ANSWER, INCLUDING A THROWN ONE. This stamp used to sit
    // after the await, so a rejecting fetch (offline, DNS, the abort) never
    // stamped, and the five-second status poll asked a down host forever.
    // Keyed on the attempt itself, not a timestamp comparison: two
    // refreshes inside one millisecond made `cache.at < started` skip the
    // stamp, and checkNow (TTL-bypassing) makes back-to-back refreshes a
    // real path, not a test artifact.
    // The miss stamp WITHDRAWS a previously known offer (latest: null):
    // an offer we could not re-confirm is not served stale for up to a
    // TTL window; the next successful look restores it. Deliberate, and
    // 24x more visible now that the TTL is 15 minutes and checkNow can
    // hit this stamp from a button press while offline.
    if (!landed) cache = { at: started, latest: null, reached: false, readable: false };
  }
  maybeAutoInstall();
}

/**
 * The automatic half of the update switch: a look that FOUND something newer
 * installs it, if the person has left that switch on.
 *
 * 🔑 IT HANGS OFF `refresh()`, NOT OFF A TIMER OF ITS OWN. The 15-minute look
 * is the only clock in this module, and a second one would drift out of step
 * with the cache it reads -- so "we just learned there is a newer version" is
 * exactly the moment to act, and it is already a moment this file owns.
 *
 * Every gate here is a refusal, and each is load-bearing:
 *   - `available()`  the same comparison the toast uses, so nothing installs
 *                    that the screen would not have offered. Unknown loses.
 *   - `installedRoot()` a from-source checkout is never auto-installed over;
 *                    that would point the installer at a working tree.
 *   - `autoPref().on` an unreadable preference reads OFF (see autoupdate.js).
 * `beginInstall()` is single-flight on its own, so a burst of refreshes
 * cannot stack installers.
 *
 * ⚠️ IT MUST NOT THROW INTO `refresh()`. This runs inside the one code path
 * whose whole contract is failing soft; a preference file on a bad mount
 * must cost no update notice at all.
 */
/**
 * 🛑 A FAILED AUTOMATIC INSTALL DOES NOT RETRY EVERY FIFTEEN MINUTES. Without
 * this, a machine that CANNOT install -- no write permission, a full disk, a
 * blocked release host, a checksum that keeps failing -- spawns a fresh
 * `curl | sh` on every look, forever, with nobody watching. `beginInstall`
 * releases its single-flight flag on a non-zero exit precisely so a person can
 * press Install again, and that release is what hands the automatic path an
 * unbounded loop.
 *
 * ⚠️ THE DIRECTION THIS FAILS IN IS DELIBERATE. Backing off means a broken
 * machine can be up to an hour behind; not backing off means it hammers itself
 * and the release host all day. And the cost is bounded and visible either way,
 * because the Settings card still shows the version and the Install button
 * still works IMMEDIATELY -- the backoff is on the UNATTENDED path only, where
 * nobody is there to see it failing.
 */
const AUTO_RETRY_AFTER = 60 * 60 * 1000;
let autoFailedAt = 0;

function maybeAutoInstall() {
  try {
    if (!available()) return;
    if (!installedRoot()) return;
    if (!(autoPref() || {}).on) return;
    if (autoFailedAt && Date.now() - autoFailedAt < AUTO_RETRY_AFTER) return;
    beginInstall({ auto: true });
  } catch { /* an update that cannot start must not break the one that shows */ }
}

/** What the last look established: for the screen's could-not-reach state.
    looked distinguishes "the first look is still in flight" (at 0) from
    "we looked and could not reach": at boot the screen must say Checking,
    not claim a failure that has not happened. */
function lastLook() {
  return {
    reached: cache.reached === true,
    readable: cache.readable === true,
    at: cache.at,
    looked: cache.at > 0,
  };
}

/**
 * Ask the host RIGHT NOW, TTL be damned: the person pressed Check now,
 * and a button that silently serves a 14-minute-old answer is the Later
 * trap wearing a new coat. Coalesces with an in-flight background
 * refresh rather than racing it.
 */
async function checkNow() {
  if (!inFlight) {
    inFlight = refresh().catch(() => { /* reached:false is the record */ })
      .finally(() => { inFlight = null; });
  }
  await inFlight;
  return { running: RUNNING, latest: cache.latest, reached: cache.reached === true, readable: cache.readable === true };
}

/**
 * Where this Kosmos lives, IF it is an installed copy: the bundle layout is
 * $KOSMOS_HOME/{app,runtime,bin,tmux}, and this file runs from app/engine.
 * A from-source checkout has no private runtime beside it, and for that world
 * the answer is null: source updates with git, and the installer must never
 * be pointed at a developer's working tree.
 */
function autoPref() {
  if (autoPrefFn) return autoPrefFn();
  return require('./autoupdate').read();
}

function installedRoot() {
  if (installedRootFn) return installedRootFn();
  const home = path.resolve(__dirname, '..', '..');
  return (fs.existsSync(path.join(home, 'runtime', 'bin', 'node'))
       && fs.existsSync(path.join(home, 'app', 'server.js'))) ? home : null;
}

/** The installer URL, derived from the release base (its sibling /setup).
    ⚠️ Assumes the base ends in /dist, which both the default and the
    installer's own KOSMOS_RELEASE_BASE convention do; an override without
    that suffix yields <base>/setup, so a nonstandard staging base must
    keep the /dist shape. */
function setupUrl() {
  /* The version rides as a cache-buster (#the 0.5.13 wedge): /setup is
     one URL across releases, so an edge cache can hand an updating
     machine the PREVIOUS release's installer, which then fetches the
     previous release's bytes and reports success. Keyed on the version
     the update is FOR, so the same update retried hits the same cache
     entry rather than minting one per attempt. Harmless to any origin:
     a query on a static file is ignored where there is no cache. */
  const v = cache && cache.latest && cache.latest.version ? String(cache.latest.version) : '';
  return base.replace(/\/dist\/?$/, '') + '/setup' + (v ? '?v=' + encodeURIComponent(v) : '');
}

/**
 * Start the update and return immediately. The updater is the SAME hardened
 * installer every install runs (staged download, checksum verification,
 * atomic rename, board restart) -- not a second, lesser copy of that logic
 * here. Detached and unref'd: the child must outlive this server, because
 * finishing the job is what kills and restarts it. Agents are untouched
 * throughout; only the board restarts (their launchd jobs and tmux sessions
 * are separate process trees).
 */
let installStarted = false;
/* #553: the last install ATTEMPT this server saw end, so the page can say
   a true sentence instead of spinning. A failed install never kills this
   server, so the child's non-zero exit (or a spawn error) is observable
   here and nowhere else; a SUCCESSFUL install kills us before it could be
   recorded, which is the right shape: success is the server coming back
   changed, and only failure needs a record. Cleared at the next press so
   an old failure can never fail a new attempt. */
let lastAttempt = null;
function installLog() { return installedRoot() ? path.join(installedRoot(), 'logs', 'install.log') : null; }
/* 🛑 THE DURABLE CHANNEL. On an UPDATE the installer runs `kosmos stop`
   before it downloads a byte, so this server is dead for every real
   failure (a 404, a dropped download, a checksum refusal, a failed
   swap): the in-memory exit listener below only ever sees preflight
   refusals and spawn errors. So the spawned shell writes the installer's
   exit code and the attempt's start stamp to logs/install.status when
   it finishes, and whichever server answers next (the reopened old
   board after a failure, or the new board after a success) reads it.
   A successful install rewrites the file with code 0, which seeds
   nothing: success is the board coming back changed. */
function installStatusFile() { return installedRoot() ? path.join(installedRoot(), 'logs', 'install.status') : null; }
/* 🛑 #1728: THE DURABLE IN-FLIGHT WITNESS. install.status above is written by
   the spawned shell only WHEN AN ATTEMPT FINISHES. But this installer is
   detached, unref'd and stdio-ignored, so the exact failure it cannot survive
   to record -- a board killed, a Ctrl-C, a crash MID-INSTALL -- leaves no trace
   at all: no exit listener (the process is gone) and no status file (the shell
   never reached its printf). This marker closes that gap. THIS process writes
   it the moment a child exists (wireChild), and the SAME shell removes it when
   the attempt finishes (success or clean failure). Its survival is the whole
   signal: a finished attempt has no marker, so a marker still on disk means the
   attempt was interrupted before it could restart the board.
   📌 Add-only. It never touches detached/unref/stdio (that is the recall design
   left for Josh, kosmos#1728); it only makes an interruption OBSERVABLE. */
function installStartedFile() { return installedRoot() ? path.join(installedRoot(), 'logs', 'install.started') : null; }
function markInstallStarted(startedAt) {
  const file = installStartedFile();
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(startedAt || '') + '\n');
  } catch { /* best-effort: a board that cannot write the marker is no worse off
                than before #1728, and must never fail an install to record one. */ }
}
function noteAttemptEnd(owner, code, why) {
  /* ⚠️ IDENTITY, not existence. A child's exit/error listener stays bound
     for that child's life; only the record its OWN press created may be
     ended by it, or a superseded attempt's late exit would overwrite the
     current one (single-flight makes this rare in production; a fake
     timer leaking across tests makes it certain, which is how it was
     found). And the first, more specific sentence for one owner wins. */
  if (owner !== lastAttempt) return;
  if (lastAttempt && lastAttempt.endedAt) return;
  lastAttempt = {
    startedAt: lastAttempt && lastAttempt.startedAt ? lastAttempt.startedAt : new Date().toISOString(),
    endedAt: new Date().toISOString(),
    code: Number.isInteger(code) ? code : null,
    because: why || null,
    log: installLog(),
  };
}
/* The raw last-status record ({code, startedAt, endedAt}) with no code filter,
   so both the failure reader and the marker reader can consult it. */
function readStatusRaw() {
  const file = installStatusFile();
  if (!file) return null;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const m = /^(-?\d+)\s+(\S+)/.exec(raw.trim());
  if (!m) return null;
  let endedAt = null;
  try { endedAt = fs.statSync(file).mtime.toISOString(); } catch { endedAt = new Date().toISOString(); }
  return { code: Number(m[1]), startedAt: m[2], endedAt };
}
function readStatusRecord() {
  const s = readStatusRaw();
  if (!s) return null;
  if (s.code === 0) return null;   // a success seeds nothing: success is the board coming back changed
  return { startedAt: s.startedAt, endedAt: s.endedAt, code: s.code, because: 'the installer stopped before it could restart the board', log: installLog() };
}
/* #1728. A surviving start marker (see markInstallStarted) means the attempt
   never reached its finish line -- the shell removes the marker on finish. The
   code is null because we do not know the outcome, only that it was in flight
   and did not complete.
   🛑 SAME-ATTEMPT SUPPRESSION: if a status record exists for the SAME start stamp,
   the shell reached its status write, so that attempt was NOT interrupted before
   finishing -- the marker is only residue from the tiny window between the status
   write and the `rm -f "$4"` (a board killed there). Suppress it in that case, or
   a successful-then-killed install would falsely read as interrupted. A status for
   a DIFFERENT (earlier) attempt does not suppress: the marker is then a genuine
   later interruption, and seedFromDisk's newest-wins picks it.
   📌 One residual this cannot suppress: a success killed in the microsecond window
   AFTER `curl | sh` returned but BEFORE the shell wrote the status leaves a marker
   with no status to match, so it reads as interrupted. The window is a synchronous
   shell tail after a multi-second pipeline, and the board's separate boot/version
   signals contradict a false "interrupted", so this is an inherent tiny residual
   of the marker approach rather than a defect to fix. */
function readStartedRecord() {
  const file = installStartedFile();
  if (!file) return null;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
  const startedAt = raw.trim();
  if (!startedAt) return null;
  const s = readStatusRaw();
  if (s && String(s.startedAt) === String(startedAt)) return null; // same attempt finished; marker is residue
  let endedAt = null;
  try { endedAt = fs.statSync(file).mtime.toISOString(); } catch { endedAt = new Date().toISOString(); }
  return { startedAt, endedAt, code: null, because: 'the update was interrupted before it could finish', log: installLog() };
}
function seedFromDisk() {
  /* Two durable witnesses; the more recent attempt (by ISO start stamp, which
     sorts lexicographically) wins. In normal operation only one is present -- a
     finished attempt has a status file and no marker, an interrupted one has a
     marker and no fresh status -- but a failed attempt followed by an
     interrupted one can leave both, and the newer marker must not be masked by
     the older status. */
  const fromStatus = readStatusRecord();
  const fromMarker = readStartedRecord();
  const pick = !fromStatus ? fromMarker
             : !fromMarker ? fromStatus
             : (String(fromMarker.startedAt) > String(fromStatus.startedAt) ? fromMarker : fromStatus);
  if (pick) lastAttempt = pick;
}
function lastAttemptView() {
  if (!lastAttempt) seedFromDisk();
  return lastAttempt ? { ...lastAttempt } : null;
}

/**
 * The two things that must happen when an installer child fails, wherever the
 * child came from. Shared so a test double exercises the real wiring rather
 * than a shape that merely resembles it.
 */
function wireChild(child, opts) {
  // ⚠️ 'error' fires ASYNCHRONOUSLY on spawn failure (EMFILE, EAGAIN); with
  // no listener it becomes an uncaught exception, and the failure mode of
  // the one route that runs software would be crashing the board with no
  // installer running to bring it back -- while the single-flight flag,
  // stranded true, answered every retry "already updating". Log, release
  // the flag, and the person's retry gets a real attempt.
  const owner = lastAttempt;
  /* #1728: the moment a child exists, record the durable in-flight marker. This
     is the shared choke point both the real spawn and an injected test runner
     reach, so the witness is written once for both. It is written synchronously
     here, microseconds after spawn; the shell's own `rm -f` of it runs only
     after the (multi-second) curl|sh pipeline, so there is no race. */
  markInstallStarted(owner && owner.startedAt);
  child.on('error', (err) => {
    installStarted = false;
    noteAttemptEnd(owner, null, 'the installer could not be started: ' + String((err && err.message) || err));
    /* Only the unattended path is held back. A person pressing Install is
       present, is watching, and gets an immediate attempt every time. */
    if (opts && opts.auto) autoFailedAt = Date.now();
    process.stderr.write(`Kosmos update could not start: ${String((err && err.message) || err)}\n`);
  });
  // ⚠️ And the PIPELINE failing after a clean spawn (release host 404, a
  // dropped download, the installer's checksum refusal): the child exits
  // non-zero while this server is still alive, and a stranded true flag
  // would answer every retry "already updating" -- each retry costing the
  // person a three-minute overlay that reloads into the same toast --
  // until somebody restarts the board. An exit listener works on an
  // unref'd child while the parent lives; a SUCCESSFUL install kills this
  // server before the listener matters, which is why releasing on any
  // non-zero exit cannot double-run a good update.
  child.on('exit', (code) => {
    if (code !== 0) {
      installStarted = false;
      noteAttemptEnd(owner, code, 'the installer stopped before it could restart the board');
      if (opts && opts.auto) autoFailedAt = Date.now();
      process.stderr.write(`Kosmos update failed before it could restart the board (exit ${code}); Install can be tried again\n`);
    }
  });
}

function alreadyInstalling() { return installStarted; }
function beginInstall(opts) {
  // ⚠️ Single-flight. available() stays truthy until the new server is up,
  // so a double click or a second tab would spawn a SECOND detached
  // installer racing the first through the stage-and-swap. One per server
  // lifetime; the flag dies with the process the installer restarts.
  if (installStarted) return;
  installStarted = true;
  /* A fresh press starts a fresh record: the previous attempt's failure
     is history, not a verdict on this one. */
  lastAttempt = { startedAt: new Date().toISOString(), endedAt: null, code: null, because: null, log: null };
  /* 🛑 AN INJECTED RUNNER GOES THROUGH THE SAME WIRING, and it did not before.
     This returned immediately on `installRunner`, so the two handlers below --
     the ones that release the single-flight flag and stamp the automatic
     backoff -- were unreachable from any test. Both of tonight's mutations
     against that backoff stayed GREEN for exactly that reason: the second look
     was blocked by a flag that had never been released, not by the guard the
     test claimed to be measuring.
     🔑 A test double that skips the code around it is not a double, it is a
     bypass. If the runner hands back something child-shaped, it is treated as
     a child. */
  if (installRunner) {
    const fake = installRunner(setupUrl());
    if (fake && typeof fake.on === 'function') { wireChild(fake, opts); return fake; }
    return fake;
  }
  // The URL travels as a positional parameter, never interpolated into the
  // one command in this product that ends in `| sh`; and KOSMOS_RELEASE_BASE
  // rides along so the installer stages its tarballs from the SAME host the
  // script came from (the app's env override and the installer's default
  // could otherwise split-brain a staging deployment).
  /* The exit code and the start stamp land in install.status whatever
     happens to this server; the file is the only witness a failed update
     leaves for the next board. Positional parameters, never interpolated
     into the one command in this product that ends in `| sh`. */
  const statusFile = installStatusFile() || '/dev/null';
  /* #1728: the shell removes the in-flight marker (written by wireChild) when
     the attempt finishes -- whichever way the pipeline exited, since the tail of
     the command always runs. A surviving marker therefore means an interruption. */
  const startedMarker = installStartedFile() || '/dev/null';
  /* 🛑 #1726: THE GATE GOES HERE, AND THIS CALL SITE NEEDS IT MORE THAN THE ONES
     THAT ALREADY HAD IT. `create.js` (#1598), `remove.js` and `delete-leftover.js`
     all gate an exec whose child this process still holds. THIS ONE IS
     `detached: true` + `unref()` + `stdio: 'ignore'`, so the moment it spawns it
     has LEFT: a killed board, an aborted test or a Ctrl-C stops nothing, and no
     stream records what it did.
     ⇒ Every other gate prevents an action that is merely wrong. This one prevents
     an action THAT CANNOT BE RECALLED, which is why it is fail-closed BEFORE the
     spawn rather than anywhere after it.
     📌 The gate keys on an EXPLICIT production opt-in - `server.js`'s real-start
     path calls `allowLiveExecution()` - not on inferring intent from the
     environment, so a test process cannot satisfy it by accident and a real board
     cannot be refused by one. Verified before writing this: server.js:7452 makes
     that call, and live-execution.js requires nothing, so there is no cycle. */
  if (!liveExec.liveExecutionAllowed()) {
    /* In a test process this THROWS, which is the point: a suite that reaches
       here has spawned the real production installer, and failing loudly is
       better than a green run that curled a remote script into sh. In production
       it WARNS and we return without spawning, leaving the update un-started
       rather than half-started. */
    liveExec.refuseOrWarn('engine/update.js', '/bin/sh', ['-c', 'curl | sh (installer)']);
    return;
  }
  const child = spawn('/bin/sh', ['-c', 'curl -fsSL "$1" | sh; code=$?; printf "%s %s\n" "$code" "$3" > "$2"; rm -f "$4"', 'sh', setupUrl(), statusFile, lastAttempt.startedAt, startedMarker], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, KOSMOS_RELEASE_BASE: base },
  });
  wireChild(child, opts);
  child.unref();
}

/* Test hooks. Production code never calls these. */
function setBase(b) { base = b || (process.env.AGENT_WORKFORCE_RELEASE_BASE || DEFAULT_BASE); }
function setInstallRunner(f) { installRunner = f; }
function setAutoPref(f) { autoPrefFn = f; }
function setInstalledRoot(f) { installedRootFn = f; }
function setFetcher(f) { fetcher = f; }
function resetCache() { cache = { at: 0, latest: null, reached: false, readable: false }; inFlight = null; installStarted = false; autoFailedAt = 0; lastAttempt = null; }

module.exports = {
  available, poke, refresh, newer, installedRoot, setupUrl, beginInstall, lastAttempt: lastAttemptView, installLog,
  installStartedFile, // #1728: the durable in-flight marker path (tests + direct readers)
  alreadyInstalling, setBase, setFetcher, setInstallRunner, setInstalledRoot, setAutoPref,
  resetCache, RUNNING, TTL, lastLook, checkNow,
};
