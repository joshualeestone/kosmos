'use strict';

/**
 * Click-to-connect: install Claude Code and sign it in, from the app.
 *
 * The installer deliberately installs no provider (its own comment block says
 * so): choosing a provider inside the app is what installs it, and the same
 * click signs you in. This module is that click.
 *
 * ⚠️ THE RULE, inherited from the rest of this codebase and load-bearing here
 * more than anywhere: THREE ANSWERS, NOT TWO. This module drives a terminal
 * program it does not control, over a network it does not control. A screen it
 * does not recognise is `stuck` -- carried with `because` and the tail of what
 * the terminal actually shows -- never a guess, never silently retried past,
 * and never rendered as success. `stuck` is not `failed`: the manual path
 * (open Terminal, run claude) always remains, and the UI says so.
 *
 * What this module verified before it was written (2026-08-12, claude
 * v2.1.229, this machine -- the fixture texts in connect.test.js are captures
 * from those runs, per the fixture-discipline rule):
 *
 *   - The official install is three HTTPS GETs: `<base>/latest` (a version
 *     string), `<base>/<version>/manifest.json` (a SHA256 per platform), and
 *     `<base>/<version>/<platform>/claude` (a self-contained binary). Then
 *     `<binary> install` sets up the launcher at ~/.local/bin/claude. No sudo,
 *     no Homebrew.
 *   - A fresh `claude` asks for a theme, then a login method (option 1 is the
 *     subscription login), then OPENS THE BROWSER ITSELF, prints the OAuth URL
 *     as a fallback, and waits at "Paste code here if prompted >". The one
 *     thing the person must do is paste one code, which `send-keys` delivers.
 *
 * ⚠️ WHAT "CONNECTED" MEANS IS NOT THIS MODULE'S OPINION. The finish line is
 * `subscription.check()` flipping to `connected` -- the same reader the rest
 * of the product trusts -- not any sentence scraped off the terminal. The TUI
 * text is used to know what to press, never to declare victory.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const store = require('./store');
const subscription = require('./subscription');


const PHASE = {
  IDLE: 'idle',
  DOWNLOADING: 'downloading',
  INSTALLING: 'installing',
  SIGNIN_LAUNCHING: 'signin-launching',
  SIGNIN_BROWSER_OPEN: 'signin-browser-open',
  SIGNIN_AWAITING_CODE: 'signin-awaiting-code',
  SIGNIN_COMPLETING: 'signin-completing',
  CONNECTED: 'connected',
  STUCK: 'stuck',
  INTERRUPTED: 'interrupted',
};

/**
 * Everything with a side effect is overridable, same convention as `create`
 * and `subscription`: tests and the sandboxed live-verify never touch the
 * operator's real machine.
 */
function downloadBase() {
  return process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE
    || 'https://downloads.claude.ai/claude-code-releases';
}

/**
 * Where Claude Code lives. ONE definition, in engine/runners.js.
 *
 * ⚠️ THIS USED TO BE A THIRD COPY. `engine/runners.js`, `engine/connect.js`
 * and `engine/subscription.js` each spelled out
 * `AGENT_WORKFORCE_CLAUDE_BIN || ~/.local/bin/claude`, and when #979 gave
 * the resolver an AGENT_WORKFORCE_HOME rung the copies silently disagreed
 * with it about exactly that rung -- the drift pair the resolver exists to
 * end, one file over.
 *
 * 📌 Required lazily as a HABIT, not a necessity: `engine/runners.js` imports
 * only node builtins, so there is no cycle here for a top-level require to
 * create. An earlier version of this line said the lazy require was what kept
 * the graph acyclic, which credited it with work it is not doing. It stays
 * because it costs nothing and survives runners.js gaining an engine import.
 */
function claudeBinPath() {
  return require('./runners').resolveBin('claude').bin;
}

function tmuxBinPath() {
  return process.env.AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux';
}

const STATE_FILE = () => path.join(store.ROOT, 'connect.json');

/**
 * The tmux session the sign-in runs in. Ours, disposable, and RESERVED at
 * both ends by this one exported constant: create.js refuses the exact name
 * to agents, and status.parsePanes excludes the exact session from the
 * roster (#603 -- the first wording here claimed the roster "can never
 * mistake it for an agent" while nothing enforced that, and Josh met the
 * mystery card live).
 */
const SESSION = 'kosmos-connect';
/**
 * ⚠️ EVERY `-t` USES THE `=` EXACT-MATCH PREFIX, the same rule remove.js and
 * the README already treat as mandatory. Without it, tmux resolves a target by
 * PREFIX when no exact session exists -- so after our session dies, a
 * kill/capture/send aimed at `kosmos-connect` could land on an agent somebody
 * named `kosmos-connect2`, typing Enter into a Claude running with permissions
 * bypassed. `create.js` also refuses the name outright, but the exact-match
 * pin must not depend on that gate holding forever.
 *
 * ⚠️ TWO SPELLINGS, MEASURED ON tmux 3.6a, because they are not
 * interchangeable: session-targeted commands (kill-session) take `=name`,
 * but PANE-targeted commands (capture-pane, send-keys) REFUSE the bare form
 * with "can't find pane: =name" -- the exact-match pin needs the trailing
 * colon (`=name:`, the session's active window) to resolve. The bare form
 * shipped on the pane commands for one iteration and the LIVE check caught
 * it: every capture failed and the driver reported the window closed while
 * Claude sat there running.
 */
const TARGET = '=' + SESSION;          // session-targeted commands
const PANE_TARGET = '=' + SESSION + ':'; // pane-targeted commands

/* ── the runner seam ─────────────────────────────────────────────────────── */

/**
 * ⚠️ THE SAME BIDIRECTIONAL INTERLOCK AS `engine/create.js`, for the same
 * reason: `setDryRun(false)` refuses unless a runner is installed, and
 * `setRunner(null)` re-arms dry-run, so no ordering of test teardowns leaves a
 * suite able to spawn a real tmux session or execute a real binary.
 */
let DRY_RUN = process.env.AGENT_WORKFORCE_DRY_RUN === '1';
let runner = null;

function setRunner(fn) {
  runner = fn || null;
  if (!runner) DRY_RUN = true;
  /* Changing what a probe RETURNS must not leave the previous answer cached. */
  probeGeneration += 1;
  probeCache = null;
  probeInFlight = null;
}
function setDryRun(on) {
  if (!on && !runner) {
    throw new Error('refusing to leave dry-run with no injected runner: this would run real programs');
  }
  DRY_RUN = Boolean(on);
  /* Same reason as setRunner: dry-run changes the verdict, so the cache is void. */
  probeGeneration += 1;
  probeCache = null;
  probeInFlight = null;
}

/** async execFile, promisified by hand so the seam stays one function. */
function run(file, args, opts) {
  if (runner) return Promise.resolve(runner(file, args, opts));
  if (DRY_RUN) return Promise.resolve({ ok: true, stdout: '', dryRun: true });
  return new Promise((resolve) => {
    const child = execFile(file, args, {
      encoding: 'utf8',
      timeout: (opts && opts.timeout) || 20000,
      env: { ...process.env, ...(opts && opts.env) },
      maxBuffer: 4 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (activeChild === child) activeChild = null;
      if (err) resolve({ ok: false, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err });
      else resolve({ ok: true, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
    // ⚠️ Held so cancel can KILL it. Without this, cancelling during
    // `claude install` had no handle: the install finished in the background
    // and put a launcher on the machine of somebody who had said stop.
    if (opts && opts.cancellable) activeChild = child;
  });
}

let activeChild = null;

/* ── persisted state ─────────────────────────────────────────────────────── */

/**
 * One JSON file under app data, written atomically like every other record
 * here. It exists for exactly two readers: the UI polling mid-flight, and a
 * server that restarted mid-flight and needs to say "this was interrupted"
 * instead of resuming a driver it no longer has.
 */
let mem = { phase: PHASE.IDLE };

/**
 * Which account directory the CURRENT flow is for (#248/#324), null for
 * the global one. Module-level like the driver singleton and for the same
 * reason: one flow at a time by design, and every record that flow writes
 * must say which account it is about, so an interrupted record and the
 * terminal CONNECTED/STUCK verdicts carry their account with them.
 */
let flowDir = null;

function writeState(next) {
  /* ⚠️ THE OWNING DRIVER OUTRANKS THE MODULE VARIABLE. Two rapid starts
     both assign flowDir before either claims the driver, and the loser's
     assignment survives the probe await; every write from a claimed flow
     therefore reads the driver's OWN dir, identity-safe like every other
     arm, and flowDir only speaks for the pre-claim and teardown writes
     (their setters re-aim it at the owning flow's dir first). */
  const dirNow = driver ? (driver.configDir || null) : flowDir;
  mem = { ...next, configDir: dirNow, pid: process.pid, updatedAt: new Date().toISOString() };
  try {
    fs.mkdirSync(path.dirname(STATE_FILE()), { recursive: true });
    const tmp = `${STATE_FILE()}.${process.pid}.new`;
    fs.writeFileSync(tmp, JSON.stringify(mem, null, 2));
    fs.renameSync(tmp, STATE_FILE());
  } catch { /* the in-memory copy still answers; persistence is for restarts */ }
  return mem;
}

function readPersisted() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE(), 'utf8')); }
  catch { return null; }
}

// ⚠️ Hand-copied into web/index.html frConnActive (the page ships as one file
// with no import mechanism). A phase added here must be added there too.
const ACTIVE_PHASES = [
  PHASE.DOWNLOADING, PHASE.INSTALLING, PHASE.SIGNIN_LAUNCHING,
  PHASE.SIGNIN_BROWSER_OPEN, PHASE.SIGNIN_AWAITING_CODE, PHASE.SIGNIN_COMPLETING,
];

/**
 * What the UI should paint. Never throws; not knowing is an answer.
 *
 * ⚠️ A persisted mid-flight phase from ANOTHER pid is `interrupted`, not the
 * phase itself: the driver that owned it died with its process, so reporting
 * `downloading` would be a progress bar nobody is moving -- a screen asserting
 * a state nobody is producing, the exact shape this codebase is built against.
 */
/**
 * Is this persisted record a LIVE flow belonging to another process?
 *
 * ⚠️ Two rules, both earned. "Another pid" is not "a dead pid": a second
 * server sharing this data dir writes live, progressing records, and
 * declaring its flow interrupted from pid inequality alone asserts a death
 * nobody checked -- signal 0 asks the kernel (EPERM = exists, not ours =
 * alive). And a live pid is not proof of a live FLOW: pids get recycled, so
 * "alive" only counts while the record is also FRESH. Freshness is safe to
 * demand because the owning driver heartbeats its record (see tickBody), so
 * even a person dawdling at the paste prompt keeps their record stamped.
 * One helper, because `state()` (reporting) and `cancel()`/`start()`
 * (refusing to destroy) must agree about whose flow it is.
 */
/**
 * The freshness policy, injectable so tests can drive it instead of reading
 * comments about it. The bound is three missed heartbeats: the owning driver
 * stamps its record every HEARTBEAT_MS while alive (including a person
 * dawdling at the paste prompt), so a record older than FRESH_BOUND_MS
 * belongs to a flow whose driver stopped -- whatever its recycled pid says.
 */
/**
 * ⚠️ ONE NUMBER, NOT TWO COINCIDENTALLY EQUAL ONES. `FRESH_BOUND_MS` below
 * and `ABANDONED_SIGNIN_MS` further down answer different questions (is the
 * owning process still alive vs. has the browser leg been abandoned), but
 * both are this codebase's definition of "dead" for a parked flow -- shared
 * from one constant so that stays true in code, not just in a comment two
 * hundred lines apart. Each still has its own setter, so a test (or a future
 * tuning pass) can move one without moving the other.
 */
const DEAD_BOUND_MS = 15 * 60 * 1000;
let HEARTBEAT_MS = 5 * 60 * 1000;
let FRESH_BOUND_MS = DEAD_BOUND_MS;
function setFreshnessForTests(boundMs, heartbeatMs) {
  FRESH_BOUND_MS = boundMs || DEAD_BOUND_MS;
  HEARTBEAT_MS = heartbeatMs || 5 * 60 * 1000;
}

function foreignLiveFlow(disk) {
  if (!disk || !ACTIVE_PHASES.includes(disk.phase) || disk.pid === process.pid) return false;
  // A hand-edited record carrying pid 0 or a negative pid would probe the
  // whole process GROUP and answer "alive"; only a real positive pid counts.
  if (!Number.isInteger(disk.pid) || disk.pid <= 0) return false;
  let alive = false;
  try { process.kill(disk.pid, 0); alive = true; }
  catch (err) { alive = Boolean(err && err.code === 'EPERM'); }
  // ⚠️ Said explicitly, not through coercion: no timestamp means NOT fresh.
  // The first version leaned on Date.parse(0) happening to read as ancient;
  // an unparseable stamp would have failed OPEN into "live forever".
  if (!disk.updatedAt) return false;
  const ageMs = Date.now() - Date.parse(disk.updatedAt);
  if (!Number.isFinite(ageMs)) return false;
  return alive && ageMs <= FRESH_BOUND_MS;
}

function state() {
  /**
   * A terminal local verdict (STUCK/CONNECTED in mem) outranks the disk on
   * purpose -- it is this server's own answer -- which also means a foreign
   * flow is only surfaced while WE are idle. Accepted asymmetry: the next
   * start() click consults the disk and repaints reality either way.
   */
  if (mem.phase !== PHASE.IDLE) return publicView(mem);
  /**
   * ⚠️ The disk check runs whenever WE are idle, including after a local
   * flow came and went (`startedOnce`): short-circuiting on that flag hid a
   * foreign live flow behind our stale idle -- the board said idle over a
   * sign-in that exists.
   */
  const disk = readPersisted();
  if (disk && ACTIVE_PHASES.includes(disk.phase) && disk.pid !== process.pid) {
    if (foreignLiveFlow(disk)) return publicView(disk);
    return publicView({ ...disk, phase: PHASE.INTERRUPTED, before: disk.phase });
  }
  if (mem.startedOnce) return publicView(mem);
  if (disk && disk.pid !== process.pid
    && (disk.phase === PHASE.CONNECTED || disk.phase === PHASE.STUCK)) {
    return publicView(disk);
  }
  return publicView(mem);
}

/**
 * Would connecting Claude have to DOWNLOAD it first? (#1556)
 *
 * 🛑 THE CLIENT ALREADY ASKS THIS AND THE SERVER NEVER ANSWERED.
 * `web/index.html`'s `frClaudeInstallNeeded()` reads `FR.connect.willInstall` and,
 * finding nothing, FAILS OPEN and assumes an install is needed. So the download
 * prompt was shown to everybody, including people who already have a working Claude
 * Code. The consumer was correct all along; this field is what was unbuilt.
 *
 * ⚠️ READ THAT PATH PRECISELY, BECAUSE I DID NOT. It is `FR.connect.willInstall`,
 * and `FR` is assigned WHOLESALE from `/api/first-run`. I first served this field
 * on `/api/connect`, verified it answered correctly on three boards, and shipped a
 * screen that did not change by one character. The producer is `firstrun.state()`;
 * this function only computes the value.
 *
 * ⭐ THE SAME TWO-STEP `start()` ALREADY USES, and it was here before either #1560
 * or this card: a cheap `accessSync` decides whether the expensive probe is worth
 * running. A truncated or half-written launcher passes `X_OK` forever, so "a file is
 * there" is not "it runs", and only `--version` can tell them apart.
 *
 * 🛑 THE CACHE IS DELIBERATELY ONE-SIDED, BECAUSE THE TWO ERRORS ARE NOT EQUAL:
 *
 *   we say willInstall TRUE  and it was false  -> one needless confirm dialog
 *   we say willInstall FALSE and it was true   -> AN UNANNOUNCED 281MB DOWNLOAD
 *
 * The second is the harm this card exists to prevent, and Josh asked for the confirm
 * step by name. So the cheap check runs EVERY time: if the binary has GONE, that is
 * known instantly and no probe runs. Only the expensive PROBE result is cached.
 *
 * ⚠️ AND HERE IS THE WINDOW THAT LEAVES, STATED RATHER THAN GLOSSED. `accessSync`
 * catches REMOVAL, not corruption in place. A launcher that was present and working,
 * cached `ok: true`, and is then overwritten with something broken AT THE SAME PATH
 * reads as installed for up to the TTL. That is the harmful direction, and no cheap
 * check can see it: telling a good binary from a broken one is exactly what costs a
 * subprocess. The TTL is the bound on it.
 *
 * 📌 AND THE TTL BOUNDS THE SERVER, NOT THE SCREEN. The client holds this answer in
 * its `FR` snapshot, which is refreshed only at page boot and on Check again, so on
 * a board left open the stale window is however long that page has been sitting
 * there. Benign in the same way and for the same reason, and named for the same
 * reason: the bound people will assume from "60s" is not the one they get.
 *
 * 📌 An earlier draft of this block said the cheap check "can only ever move the
 * answer toward yes" and offered the newly-INSTALLED case as the stale one. Both
 * were wrong: the install case never reaches the cache at all (the missing-binary
 * path returns before it), and the real stale window is the one above, which points
 * the other way. Corrected rather than dropped.
 *
 * ⚠️ AND IT NEVER THROWS. A failure here must leave the caller free to fall back to
 * today's behaviour, because the whole defect was a missing answer being read as a
 * definite one.
 */
let probeCache = null;
/* ⚠️ BUMPED BY EVERY RESET AND EVERY SEAM CHANGE, and a probe writes the cache only
   if the generation it started in is still current. Without it two holes stay open,
   both in the harmful direction:

     resetForTests() while a probe is in flight -> that probe still lands afterwards
     setRunner()/setDryRun() -> the PREVIOUS runner's verdict is served to the next arm

   The comment on the reset seam argues a partial reset is worse than none, because
   the stale verdict it carries can be the harmful `false`. That argument applies to
   these two windows exactly, so it should not be left as an argument. */
let probeGeneration = 0;
/* ⚠️ COALESCED, BECAUSE A CACHE WRITTEN AFTER AN AWAIT IS NOT A CACHE YET.
   Every caller arriving while the first probe is still running would miss
   `probeCache` and start its own `claude --version`. That is not hypothetical
   for a caller on a timer, and with a 15s timeout it is a pile of concurrent
   subprocesses rather than one. Sharing the in-flight promise makes N callers
   cost exactly one probe, and changes no verdict. */
let probeInFlight = null;
const PROBE_TTL_MS = 60000;

async function willInstall() {
  /* ⚠️ `claudeBinPath()` IS INSIDE THE GUARD, and it was not. It calls into the
     runner resolver, which can throw, and the doc block above promises this
     function never does. A resolver failure is an unknown like any other here, so
     it resolves the same way: an install is needed. */
  let bin;
  try {
    bin = claudeBinPath();
    /* The cheap half, every time. It cannot produce the harmful answer on its own:
       a missing or non-executable file means an install IS needed, full stop. */
    fs.accessSync(bin, fs.constants.X_OK);
  } catch { return true; }
  if (probeCache && probeCache.bin === bin && Date.now() - probeCache.at < PROBE_TTL_MS) {
    return !probeCache.ok;
  }
  /* Keyed on `bin` so a changed path starts a fresh probe rather than joining a
     probe of the old one. */
  if (probeInFlight && probeInFlight.bin === bin) return !(await probeInFlight.promise);
  const startedIn = probeGeneration;
  const probing = (async () => {
    let ok = false;
    try {
      /* ⚠️ 5s, NOT the 15s `start()` uses. That number is right there because a
         person just clicked Install and is watching; this probe runs on a PAGE
         LOAD, on the route that decides whether the onboarding overlay opens. A
         `--version` that has not answered in five seconds is not going to, and a
         HANGING launcher is precisely the broken-binary class this card exists to
         catch, so it is the case that would pay the 15s. Timing out gives
         `ok: false`, which resolves to "an install is needed": the safe direction. */
      const probe = await run(bin, ['--version'], { timeout: 5000 });
      /* 🛑 A DRY-RUN RESULT IS NOT A PASS, AND MY UNIT TESTS COULD NOT SEE THIS.
       `run()` returns `{ ok: true, dryRun: true }` WITHOUT EXECUTING ANYTHING when
       dry-run is on (this file, in `run` itself), so a probe that never ran reported
       success and a broken launcher came back "installed" through the real route.

       📌 I first wrote `create.js:240` here. WRONG FILE: connect.js has its own
       `run`, its own DRY_RUN and its own setDryRun, and never requires create.js.
       The behaviour was measured; the cause I named for it was not. Corrected
       rather than quietly dropped, because a wrong citation reads as checked.

       ⇒ MEASURED, both arms, same broken binary: dry-run OFF gives willInstall
       true, dry-run ON gave FALSE. That is the unannounced-download answer,
       produced by the safety mechanism meant to make things safe.

       ⭐ `dryRun` MEANS "WE DID NOT CHECK", WHICH IS UNKNOWN, NOT YES. Every other
       unknown in this function resolves toward "an install is needed", because that
       costs a confirm dialog and the other direction costs 281MB nobody asked for.
       This one now does too.

       📌 Found by querying the real route on three boards, not by the six unit
       tests, which never set dry-run. The units and the route disagreed and the
       route was right. */
      ok = !!(probe && probe.ok && !probe.dryRun);
    } catch { ok = false; }
    /* Stamped at COMPLETION, not at start, so a slow probe does not hand back a
       result that is already most of the way through its own TTL. */
    if (startedIn === probeGeneration) probeCache = { bin, ok, at: Date.now() };
    return ok;
  })();
  probeInFlight = { bin, promise: probing };
  try {
    return !(await probing);
  } finally {
    /* Only clear if it is still OURS: a probe for a different bin may have
       replaced it while this one was running. */
    if (probeInFlight && probeInFlight.promise === probing) probeInFlight = null;
  }
}

function publicView(s) {
  return {
    configDir: s.configDir || null,
    phase: s.phase,
    before: s.before || null,
    progress: s.progress || null,
    url: s.url || null,
    plan: s.plan || null,
    because: s.because || null,
    tail: s.tail || null,
  };
}

/* ── the download ────────────────────────────────────────────────────────── */

/**
 * Would following this redirect drop from https to http? Pure, so the rule is
 * testable without standing up a TLS server. The manifest these fetches carry
 * holds the checksum everything else is verified against; a downgrade would
 * make "checksum-verified" mean "verified against an attacker-writable value".
 */
function redirectDowngrades(fromUrl, location) {
  try {
    return fromUrl.startsWith('https:') && new URL(location, fromUrl).protocol === 'http:';
  } catch {
    return true; // an unparseable redirect target is not one we follow
  }
}

/** GET a small text/json body, following redirects. */
function fetchText(url, redirects, track) {
  const left = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        if (redirectDowngrades(url, res.headers.location)) {
          reject(new Error('the download service redirected to an insecure address, so we stopped'));
          return;
        }
        resolve(fetchText(new URL(res.headers.location, url).toString(), left - 1, track));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`the download service answered ${res.statusCode}`));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 1024 * 1024) { req.destroy(); reject(new Error('answer too large')); } });
      res.on('end', () => resolve(body));
      res.on('error', reject);
    });
    req.setTimeout(30000, () => { req.destroy(new Error('the download service did not answer in time')); });
    req.on('error', reject);
    // ⚠️ Tracked like the big fetch: a cancel that lands during the /latest or
    // manifest GET must abort it, or download() runs on to fetch 281MB for a
    // flow nobody wants any more. `track` additionally hands the handle to
    // the OWNING FLOW, whose identity the module global cannot carry.
    activeRequest = req;
    if (track) track(req);
  });
}

/** Stream a large file to disk, hashing as it lands, reporting progress. */
function fetchFile(url, dest, onProgress, redirects, track) {
  const left = redirects === undefined ? 5 : redirects;
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('http:') ? http : https;
    let responded = false;
    const req = lib.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && left > 0) {
        res.resume();
        if (redirectDowngrades(url, res.headers.location)) {
          reject(new Error('the download service redirected to an insecure address, so we stopped'));
          return;
        }
        resolve(fetchFile(new URL(res.headers.location, url).toString(), dest, onProgress, left - 1, track));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`the download service answered ${res.statusCode}`));
        return;
      }
      const total = Number(res.headers['content-length']) || null;
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(dest);
      responded = true;
      let settled = false;
      /**
       * ⚠️ A FAILED FETCH DOES NOT REJECT UNTIL THE WRITE STREAM HAS CLOSED,
       * because until then "did a file land on disk" HAS NO ANSWER. The
       * stream's open is an fs-thread-pool operation: under full-suite load
       * it can still be QUEUED while data is already arriving (progress
       * counts network bytes, not written ones) -- and a cancel in that
       * window swept an empty directory, after which the open landed and
       * created the .part POSTHUMOUSLY, with every cleanup already run
       * (#458; the mechanism was reproduced with a saturated thread pool
       * before this was written). Waiting for 'close' also closes the
       * older leak this comment used to record: the rejection path once
       * left the fd open entirely. 'close' fires whether or not the open
       * ever completed, so this cannot hang the rejection.
       */
      const rejectAfterClose = (e) => {
        if (settled) return;
        settled = true;
        try { out.destroy(); } catch { /* already closed */ }
        if (out.closed) { reject(e); return; }
        out.on('close', () => reject(e));
      };
      req.on('error', rejectAfterClose);
      let got = 0;
      res.on('data', (c) => {
        got += c.length;
        // The metadata fetch caps at 1MB; the binary gets a bound too. The
        // checksum already stops execution; this stops a misbehaving service
        // from filling the disk before the verdict ever runs.
        if (got > 1024 * 1024 * 1024) {
          req.destroy(new Error('the download grew past any plausible size, so we stopped'));
          return;
        }
        hash.update(c);
        if (onProgress) onProgress(got, total);
      });
      res.pipe(out);
      out.on('finish', () => {
        if (settled) return;
        settled = true;
        resolve({ sha256: hash.digest('hex'), bytes: got });
      });
      res.on('error', rejectAfterClose);
      out.on('error', rejectAfterClose);
    });
    req.setTimeout(600000, () => { req.destroy(new Error('the download stalled')); });
    // Before the response arrives no write stream exists and no file can
    // have been created, so a connection failure may reject immediately.
    // After it, the delayed path above owns rejection.
    req.on('error', (e) => { if (!responded) reject(e); });
    activeRequest = req;
    if (track) track(req);
  });
}

let activeRequest = null;

function platformKey() {
  const arch = os.arch() === 'arm64' ? 'arm64' : 'x64';
  return `darwin-${arch}`;
}

/**
 * Fetch, verify, and return the path of a runnable Claude Code binary.
 *
 * ⚠️ NOTHING DOWNLOADED IS EXECUTED BEFORE ITS CHECKSUM MATCHES THE MANIFEST.
 * The partial lands beside its final name and is renamed only after the hash
 * agrees; a mismatch deletes it and reports, because "we ran a binary we could
 * not verify" is not a state this product is allowed to reach.
 *
 * A leftover partial from an interrupted attempt is discarded and restarted
 * rather than resumed: a byte-range resume would hash clean or dirty the same
 * way, but restart is simpler to reason about and the file downloads once
 * (measured: 281MB, 9 seconds on this machine's connection).
 */
async function download(onProgress, track) {
  const base = downloadBase();
  const version = (await fetchText(`${base}/latest`, undefined, track)).trim();
  activeRequest = null; // finished; "set" must keep meaning "in flight"
  /**
   * ⚠️ FULLY ANCHORED, because this string is interpolated into URLs and into
   * the ON-DISK FILENAME. Prefix-only matching would accept
   * `1.2.3/../../anywhere` and steer the write path (of a file that ends up
   * chmod 755) wherever the answer pointed. The service is trusted for the
   * bytes it serves, never for where we put them.
   */
  if (!/^\d+\.\d+\.\d+[A-Za-z0-9.-]*$/.test(version)) {
    throw new Error('the download service did not answer with a version');
  }
  let manifest;
  try { manifest = JSON.parse(await fetchText(`${base}/${version}/manifest.json`, undefined, track)); }
  catch { throw new Error('the download service answered with something we could not read'); }
  activeRequest = null;
  const plat = platformKey();
  // Case-normalised: SHA256 hex is hex whichever case the service prints it
  // in, and rejecting uppercase would blame the Mac ("no build for this
  // kind") for what is really a formatting difference.
  const want = String((manifest && manifest.platforms && manifest.platforms[plat]
    && manifest.platforms[plat].checksum) || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(want)) {
    throw new Error(`the download service has no build for this kind of Mac (${plat})`);
  }

  const dir = path.join(store.ROOT, 'downloads');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `claude-${version}-${plat}`);
  const part = `${dest}.part`;
  try { fs.unlinkSync(part); } catch { /* no partial to discard */ }
  /**
   * ⚠️ And every OTHER version's leftovers. A server death between a
   * download's rename and its install strands a verified binary that only a
   * same-version retry or a cancel would clean -- a version bump before the
   * retry stranded ~281MB permanently. Every fresh download owns the dir.
   */
  try {
    for (const f of fs.readdirSync(dir)) {
      if ((f.startsWith('claude-') || f.endsWith('.part')) && f !== path.basename(dest)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  } catch { /* nothing stale to clean */ }

  const got = await fetchFile(`${base}/${version}/${plat}/claude`, part, onProgress, undefined, track);
  activeRequest = null;
  if (got.sha256 !== want) {
    try { fs.unlinkSync(part); } catch { /* already gone */ }
    throw new Error('the downloaded file did not match its checksum, so it was not kept');
  }
  fs.chmodSync(part, 0o755);
  fs.renameSync(part, dest);
  return { path: dest, version };
}

/* ── the sign-in driver ──────────────────────────────────────────────────── */

/**
 * What screen is the terminal showing? Pure text in, one verdict out, so the
 * whole recogniser set is testable against captured pane text.
 *
 * ⚠️ ORDER MATTERS AND IS DELIBERATE. The pane ACCUMULATES: by the time the
 * paste prompt is up, the login-method text has scrolled but "Opening browser"
 * and the URL may share the screen with it. Later screens are checked first,
 * so the verdict is the furthest state the terminal has reached, not the first
 * sentence that ever matched.
 */
function classifyPane(text) {
  const t = String(text || '');
  // The REPL outranks everything, including "Login successful": it IS the
  // furthest state, and when both share a mid-clear capture, classifying as
  // repl routes the unreadable-subscription case to its fast honest exit
  // (8s) instead of the 60s catch-up wait.
  if (/\? for shortcuts/.test(t)) return { kind: 'repl' };
  if (/Login successful|Logged in as/i.test(t)) return { kind: 'login-done' };
  if (/Paste code here/i.test(t)) {
    const url = extractOauthUrl(t);
    return { kind: 'awaiting-code', url };
  }
  if (/Opening browser to sign in|Use the url below to sign in/i.test(t)) {
    return { kind: 'browser-open', url: extractOauthUrl(t) };
  }
  // press-enter outranks the choosing screens: it is the later state when
  // both share an accumulated pane, and its arm runs the subscription check
  // the choosing arms deliberately skip.
  if (/Press Enter to continue/i.test(t)) return { kind: 'press-enter' };
  if (/Select login method/i.test(t)) return { kind: 'login-method' };
  if (/Choose the text style/i.test(t)) return { kind: 'theme' };
  if (!t.trim()) return { kind: 'blank' };
  return { kind: 'unknown', tail: tailOf(t) };
}

/**
 * The pane wraps long lines even with `-J` when the URL exceeds the pane
 * width, so the URL is reassembled from the line that starts it plus any
 * continuation lines that look like more URL and not like prose.
 */
function extractOauthUrl(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/https:\/\/\S*oauth\S*/i);
    if (!m) continue;
    let url = m[0];
    for (let j = i + 1; j < lines.length; j++) {
      const cont = lines[j].trim();
      if (/^[A-Za-z0-9%&=_.~+#?/-]+$/.test(cont) && cont.length > 0 && !/^Paste/i.test(cont)) {
        url += cont;
      } else break;
    }
    return url;
  }
  return null;
}

function tailOf(text) {
  const lines = String(text || '').split('\n').map((l) => l.trimEnd()).filter((l) => l.trim());
  return lines.slice(-12).join('\n');
}

/* tmux, through the seam */
async function tmux(args, opts) {
  return run(tmuxBinPath(), args, opts);
}

async function killSession() {
  await tmux(['kill-session', '-t', TARGET]);
}

/**
 * The in-process driver. One at a time; `start` while one is alive reports
 * the live state rather than starting a second.
 */
let driver = null;   // { timer, pendingCode, lastActed, unknownTicks, ... }
let TICK_MS = 700;
let UNKNOWN_GRACE_MS = 10000;
/**
 * ⚠️ #727 item 4: the paste prompt and the browser-wait screen legitimately
 * sit unchanged for as long as a person dawdles -- but an abandoned browser
 * leg (Josh, 2026-08-24: switched Claude account inside the OAuth tab,
 * landed on claude.ai, "I've refreshed several times but I can't get out of
 * this") shows the exact same pane text a genuinely slow person also shows.
 * Only elapsed time can tell them apart. Shares `DEAD_BOUND_MS` (see
 * `FRESH_BOUND_MS` above) -- already this codebase's definition of "dead"
 * for a parked flow -- instead of a second, coincidentally-equal number.
 */
let ABANDONED_SIGNIN_MS = DEAD_BOUND_MS;
function setTickInterval(ms) { TICK_MS = ms; }
function setUnknownGrace(ms) { UNKNOWN_GRACE_MS = ms; }
function setAbandonedSigninMs(ms) { ABANDONED_SIGNIN_MS = ms || DEAD_BOUND_MS; }

/**
 * ⚠️ Codes are typed into a terminal by us on the user's behalf, so they are
 * validated like the untrusted input they are: one token, no whitespace, no
 * control characters. `send-keys -l` sends the text literally (no key-name
 * interpretation), and the charset check is belt on top of that brace.
 */
function validCode(code) {
  return typeof code === 'string' && /^[A-Za-z0-9#_.~/+=-]{6,512}$/.test(code);
}

async function start(opts) {
  const configDir = opts && typeof opts.configDir === 'string' && opts.configDir ? opts.configDir : null;
  /* A relative path here is a caller bug, and quietly resolving it against
     an unknowable cwd would sign somebody in to a directory nobody can
     name. Loud, before any state moves. */
  if (configDir && !path.isAbsolute(configDir)) {
    throw new Error('configDir must be an absolute path');
  }
  if (driver) return state();

  /**
   * ⚠️ THE SAME FOREIGN-FLOW REFUSAL AS `cancel()`, because start is a write
   * path too: without it, a start POSTed to the non-owning server clobbered
   * the owner's live record with IDLE and then killed the shared-named
   * session out from under the owning flow. All three of state/cancel/start
   * now agree about whose flow it is, through one helper.
   */
  const disk = readPersisted();
  if (foreignLiveFlow(disk)) return publicView(disk);
  /* Adopted only after the foreign guard: a refused start must not
     re-label a record that belongs to a flow somebody else is living. */
  flowDir = configDir;
  // (Residual, accepted like cancel's: this is check-then-act, so two
  // servers starting in the SAME instant both pass and one flow's session
  // kill costs the other an honest "the sign-in window closed" -- a failure
  // that names itself, never corruption.)

  /**
   * ⚠️ No "already connected" memo here: the subscription check below IS the
   * guard, and it reads reality. A memoed CONNECTED would refuse to reconnect
   * somebody whose connection broke after the first success -- a long-lived
   * server remembering a state the machine has left.
   */
  writeState({ phase: PHASE.IDLE, startedOnce: true });

  /**
   * Already connected? Then the click's whole job is telling them so. This is
   * also what makes `start` safely idempotent across interruptions: every
   * resume walks the same checks and skips what is already true.
   */
  /* The flow's OWN account decides, never the global one: with the main
     account connected and a fresh directory requested, an unscoped check
     would early-exit every add-another-account attempt as already done. */
  const sub = subscription.check(configDir ? { configDir } : undefined);
  if (sub.state === subscription.STATE.CONNECTED) {
    /**
     * 🛑 THE FILE SAYING CONNECTED IS NOT ENOUGH TO REFUSE TO CONNECT (#1560).
     * `check()` reads `oauthAccount.organizationType` out of a local file and
     * returns CONNECTED whenever it names a paid plan. A LOGGED-OUT person
     * still has that field, so this early exit told them they were already
     * connected and never ran the flow -- while every screen that asks the
     * world disagreed. There is no way out of that from the UI: the one button
     * that would fix it is the one this branch declines to honour.
     *
     * ⚠️ THIS IS #874 ONE FILE OVER, AND THAT IS THE PART WORTH NOTICING.
     * `engine/firstrun.js:140` already made exactly this swap, for exactly this
     * reason, and wrote down why. `engine/accounts.js` already called the live
     * check. Connect was the remaining path still trusting the file alone, so
     * the product had two answers and the louder one was the unverified one.
     *
     * 📌 COST, WEIGHED RATHER THAN WAVED PAST. This adds one `claude auth
     * status` and ONLY on the arm where the file already claims connected --
     * the branch that is about to skip all the work anyway. A logged-out or
     * never-connected person pays nothing, because `check()` short-circuits
     * first. It is deliberately NOT applied to the three in-flow call sites:
     * those run on a 700ms tick (`TICK_MS`), where a per-tick subprocess would
     * be pathological, and they answer "did the login just land" rather than
     * "may I refuse to start", which is the question that locks somebody out.
     */
    const live = await subscription.checkLive(configDir ? { configDir } : undefined);
    if (live.state === subscription.STATE.NONE) {
      /**
       * ⚠️ FALL THROUGH ON DISAGREEMENT, DO NOT REPORT A FAILURE. The file and
       * the world disagreeing is not an error to show somebody: it is the
       * ordinary state of a person whose session expired, and the correct
       * response is to run the sign-in they asked for. Everything below this
       * block is that flow.
       *
       * 🛑 `NONE`, NOT `!== CONNECTED`, AND THE DIFFERENCE IS A THIRD STATE.
       * `checkLive` answers UNKNOWN when it cannot reach Claude Code at all,
       * which is a statement about our instrument rather than about the person.
       * Treating that as "not signed in" would push a genuinely connected
       * customer into a sign-in flow every time the probe was flaky, which is
       * the same harm this card is about, arriving from the other side. So the
       * old behaviour is kept for UNKNOWN: change what we do only where there
       * is POSITIVE evidence the file is wrong.
       */
    } else {
    /**
     * ⚠️ KILL ANY LEFTOVER SIGN-IN SESSION FIRST. A mid-sign-in server death
     * followed by the person finishing the login in their browser lands
     * exactly here on "Start again" -- and without this kill, "connected" is
     * reported while the dead flow's Claude keeps running as an unvouched
     * card forever, making the interrupted panel's "starting again closes
     * it" a false sentence on this one path. Safe: the name is reserved and
     * the target exact-pinned, and the foreign-flow guard above already
     * established no live flow owns it.
     */
    await killSession();
    /* ⚠️ BOTH HALVES OF THE RACE, mirroring finishConnected: a concurrent
       start may have CLAIMED THE DRIVER during the kill (writeState would
       then stamp this verdict with that flow's dir and clobber its live
       record), or may merely have re-aimed flowDir pre-claim. A claimed
       driver wins outright: this call reports the live flow instead of
       writing anything. The driverless half is answered by re-asserting
       flowDir, because this verdict is about THIS call's account. */
    if (driver) return state();
    flowDir = configDir;
    /* ⚠️ THE PLAN NAME STILL COMES FROM THE FILE, and only on the arm the live
       check just confirmed. `checkLive()` returns `plan: null` on purpose,
       because `claude auth status` says "max" where `check()` says "claude_max"
       and that module declined to assert the two vocabularies map 1:1. Taking
       the live answer alone would downgrade every paying customer's plan name
       to nothing. Same split as firstrun.js: WHETHER you are signed in is a
       claim about the world and is verified; WHICH plan the file names is a
       description, shown only where the world already said yes. */
    return publicView(writeState({ phase: PHASE.CONNECTED, plan: sub.plan, startedOnce: true }));
    }
  }

  const bin = claudeBinPath();
  let haveBinary = false;
  try { fs.accessSync(bin, fs.constants.X_OK); haveBinary = true; } catch { /* not installed yet */ }
  /**
   * ⚠️ EXECUTABLE IS NOT WORKING. A cancel or crash mid-`claude install` can
   * leave a truncated launcher that passes X_OK forever -- and trusting it
   * skipped the re-download, so every Try again dead-ended on the same
   * broken binary, and the offered manual path (Terminal, claude) was the
   * SAME broken binary. One --version probe turns "a file is there" into
   * "the thing runs"; a probe failure re-downloads.
   */
  if (haveBinary) {
    const probe = await run(bin, ['--version'], { timeout: 15000 });
    /* 🛑 A DRY-RUN PROBE SCORES A BINARY IT NEVER INVOKED (#1568/#1571). Under
       AGENT_WORKFORCE_DRY_RUN=1 with no injected runner, run() returns
       { ok: true, dryRun: true } WITHOUT executing, so this would trust a
       launcher that may not run and skip the re-download the comment above
       exists for. The sandbox guard (engine/sandbox.js) NAMES that flag as a
       remedy for a live tmux, so a person testing a board the way the product
       instructs got the harmful answer from a path that looked exercised.
       An injected runner is a deliberate test control and its result IS
       trusted (run() returns runner() before it ever consults DRY_RUN); only
       the un-executed dry-run fake is refused. Mirrors willInstall's guard. */
    if (!probe.ok || probe.dryRun) haveBinary = false;
  }

  // ⚠️ The probe was an AWAIT between the top guard and the claim below: two
  // rapid starts could both pass the guard and race the same .part path.
  // Re-check before claiming; the second caller adopts the first's flow.
  if (driver) return state();

  /**
   * ⚠️ EVERY ASYNC ARM OF A FLOW CARRIES ITS OWNING DRIVER, and teardown
   * compares IDENTITY, not existence. The defect this closes: work parked on
   * an await belonged to a flow that was cancelled, a fresh `start` installed
   * a NEW driver during the cancel's own awaits, and the stale work's failure
   * then saw "a driver exists" and tore down the healthy new flow. `!driver`
   * cannot distinguish "cancelled" from "replaced"; `driver !== owner` can.
   */
  flowDir = configDir;
  const owner = { pendingCode: null, lastActed: null, acted: null, unknownTicks: 0, configDir };
  driver = owner;

  runFlow(owner, haveBinary).catch((err) => {
    becomeStuck(owner, 'something went wrong that we did not plan for', String((err && err.message) || err));
  });
  return state();
}

async function runFlow(owner, haveBinary) {
  if (!haveBinary) {
    writeState({ phase: PHASE.DOWNLOADING, progress: { got: 0, total: null }, startedOnce: true });
    let downloaded;
    try {
      let lastProgressWrite = 0;
      /**
       * ⚠️ THE FLOW HOLDS ITS OWN REQUEST HANDLE. The module-global
       * `activeRequest` carries no identity, and a first version of the
       * orphan-abort below destroyed "the active request" -- which, after a
       * cancel-then-restart, was the SUCCESSOR flow's request. Each flow
       * tracks its own handle and only ever destroys that.
       */
      const myReq = { current: null };
      const track = (req) => { myReq.current = req; };
      downloaded = await download((got, total) => {
        /**
         * ⚠️ A CANCELLED FLOW'S DOWNLOAD ABORTS ITSELF AT THE NEXT CHUNK.
         * Cancel can land in the momentary gaps where no request handle is
         * registered globally; without this, the orphaned download ran to
         * completion and its path-based renames could collide with a
         * successor flow's in-progress file. Destroying from inside the
         * progress callback (never throwing -- an exception in a 'data'
         * listener does not reject the promise, it kills the process)
         * closes the window at chunk granularity, and destroying OUR OWN
         * handle can never hit anybody else's. Residual, documented as
         * accepted: the chunkless milliseconds between the metadata GETs.
         */
        if (driver !== owner) {
          if (myReq.current) { try { myReq.current.destroy(new Error('cancelled')); } catch { /* ending anyway */ } }
          return;
        }
        if (mem.phase !== PHASE.DOWNLOADING) return;
        // ⚠️ Throttled: this fires per network chunk, and writeState is a
        // synchronous write+rename. Unthrottled that is thousands of disk
        // writes for one 281MB file, to persist a number the UI polls once a
        // second. The final size still lands: the phase change to INSTALLING
        // writes, and the poll reads the in-memory copy anyway.
        const now = Date.now();
        if (now - lastProgressWrite < 250) {
          mem.progress = { got, total };
          return;
        }
        lastProgressWrite = now;
        writeState({ ...mem, progress: { got, total } });
      }, track);
    } catch (err) {
      // A death mid-stream leaves a .part behind, and a retry only sweeps the
      // SAME version's partial -- a version bump between attempts would
      // strand up to ~281MB that nothing else ever cleans. Sweep them all.
      // ⚠️ ONLY IF NO SUCCESSOR OWNS THE DIR: a stale flow's late network
      // rejection must not delete the .part a successor flow is mid-writing
      // -- the same guard cancel's own sweep carries, for the same reason.
      // (This sweep shipped one iteration without the guard: the fix for the
      // stranded-partial NIT introduced the race, found on the next pass.)
      // ⚠️ `driver === null` sweeps too, and it is load-bearing (#458): a
      // CANCELLED flow's rejection arrives here after cancel's own sweep
      // already ran, and since fetchFile rejects only once its write stream
      // has closed, this is the first point where a .part created by a
      // thread-pool-delayed open is guaranteed observable. With driver null
      // there is no successor to protect, and the read of `driver` and the
      // unlinks share one synchronous block, so none can appear mid-sweep.
      if (driver === owner || driver === null) {
        try {
          const dir = path.join(store.ROOT, 'downloads');
          for (const f of fs.readdirSync(dir)) {
            if (f.endsWith('.part')) fs.unlinkSync(path.join(dir, f));
          }
        } catch { /* nothing partial to clean */ }
      }
      becomeStuck(owner, 'we could not download Claude', String((err && err.message) || err));
      return;
    }
    if (driver !== owner) {
      // Cancelled (or replaced), but the download had already finished: a
      // verified 281MB binary is on disk for a flow nobody wants. Cancel's
      // contract is "own nothing half-claimed", and this is the window its
      // cleanup cannot see. (Residual, documented as accepted like cancel's
      // killSession: this unlinks BY PATH, and a successor downloading the
      // same version renames to the identical path -- a stale unlink landing
      // after that rename costs the successor an honest re-download, never
      // silent corruption.)
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      return;
    }

    writeState({ phase: PHASE.INSTALLING, startedOnce: true });
    /**
     * ⚠️ HOME IS PASSED, and it is not cosmetic. `claudeBinPath()` now
     * resolves through `runners.resolveBin('claude')`, which honours the
     * AGENT_WORKFORCE_HOME sandbox seam. Without passing the same home to
     * the child, WHERE WE LOOK and WHERE THE VENDOR WRITES key on different
     * variables: under a sandbox the install would land in the operator's
     * real home and the `accessSync` below would then report a SUCCESSFUL
     * install as "we cannot find it where it should be". Production is
     * unchanged, and the REASON is checkable rather than remembered: there
     * was no `HOME` constant at this call site. The old call passed only
     * `{ TERM: 'dumb' }`, and `run()` merges `{ ...process.env, ...opts.env }`,
     * so the child inherited `process.env.HOME` -- which the board's launchd
     * plist sets (install/setup.sh), and which `os.homedir()` prefers. With
     * AGENT_WORKFORCE_HOME unset, `homeDir()` returns that same value. An
     * earlier version of this comment said "exactly as the old bare HOME
     * constant did", which described code that was not there.
     */
    const inst = await run(downloaded.path, ['install'], {
      timeout: 180000,
      env: { TERM: 'dumb', HOME: require('./runners').homeDir() },
      cancellable: true,
    });
    if (driver !== owner) {
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      return;
    }
    if (!inst.ok) {
      // ⚠️ The binary goes too: a stuck install otherwise strands 281MB per
      // attempted version in app data, which is exactly what the deletion on
      // the success path below exists to prevent. A retry re-downloads in
      // seconds; the disk does not get the file back on its own.
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      becomeStuck(owner, 'Claude downloaded but did not finish setting itself up',
        tailOf(`${inst.stdout || ''}\n${inst.stderr || ''}`) || 'it stopped without saying why');
      return;
    }
    try { fs.accessSync(claudeBinPath(), fs.constants.X_OK); }
    catch {
      try { fs.unlinkSync(downloaded.path); } catch { /* already gone */ }
      becomeStuck(owner, 'Claude said it set itself up, but we cannot find it where it should be',
        `expected it at ${claudeBinPath()}`);
      return;
    }
    // The verified download did its job; the installed launcher is what runs
    // from here. The official install script deletes its download too, and
    // keeping ours means ~281MB per version quietly accumulating in app data.
    try { fs.unlinkSync(downloaded.path); } catch { /* disk hygiene, not correctness */ }
  }
  if (driver !== owner) return;
  await launchSignin(owner);
}

async function launchSignin(owner) {
  if (driver !== owner) return; // cancelled before the sign-in ever launched
  writeState({ phase: PHASE.SIGNIN_LAUNCHING, startedOnce: true });

  // A leftover session from an interrupted attempt would be showing a stale
  // screen; start clean instead of guessing where it was.
  await killSession();

  /**
   * ⚠️ DELIBERATELY UNQUOTED, and that is a measurement, not an oversight.
   * A review pass argued these needed shell-quoting ("tmux joins with spaces
   * and runs through a shell"); quoting was tried, and the LIVE check caught
   * it killing the launch outright -- with MULTIPLE arguments this tmux
   * (3.6a) executes them as argv, so added quotes become literal characters
   * in the filename, while a space inside a value already survives unquoted
   * (measured: an env value containing "dir with space" launched fine, the
   * quoted form died instantly). Single-argument commands are the form that
   * goes through a shell; keep this multi-arg and keep it bare.
   */
  // ⚠️ The two sandbox seams travel together or not at all: a run with the
  // CONFIG override set but the DIR unset drives the CLI at the REAL config
  // while subscription reads the override, so a successful login would end
  // in "we cannot see the connection yet". Loud, because it is silent.
  if (!owner.configDir && process.env.AGENT_WORKFORCE_CLAUDE_CONFIG && !process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR) {
    console.warn('connect: AGENT_WORKFORCE_CLAUDE_CONFIG is set without AGENT_WORKFORCE_CLAUDE_CONFIG_DIR; '
      + 'the sign-in will write a config the checker is not reading');
  }
  /**
   * ⚠️ ALWAYS MULTI-ARG: tmux runs a SINGLE argument through a shell but
   * executes MULTIPLE arguments as argv (both halves measured on 3.6a) --
   * and without the unconditional `env` prefix, production (no sandbox env)
   * was the single-arg shell form while only the multi-arg argv form had
   * ever been live-verified. `env` with no assignments is a plain exec of
   * what follows, so every launch now takes the one measured form, and a
   * claude path containing a space survives on both.
   */
  const cmd = ['env'];
  /* The flow's own dir outranks the env seam (#248/#324): the env pair is
     the whole-process sandbox, the flow dir is THIS sign-in's account, and
     the CLI must write where the flow's checker reads or a successful
     login ends in "we cannot see the connection yet". */
  const launchDir = owner.configDir || process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR;
  if (launchDir) {
    cmd.push(`CLAUDE_CONFIG_DIR=${launchDir}`);
  }
  cmd.push(claudeBinPath());

  const made = await tmux(['new-session', '-d', '-s', SESSION, '-x', '220', '-y', '50', ...cmd]);
  if (!made.ok) {
    becomeStuck(owner, 'we could not open the window Claude signs in through',
      tailOf(`${made.stdout || ''}\n${made.stderr || ''}`) || 'nothing came back to explain why');
    return;
  }
  if (driver !== owner) { await killSession(); return; }
  owner.timer = setInterval(() => {
    tick(owner).catch(() => {
      /**
       * ⚠️ BOUNDED, like every other silent-failure path. Nothing in
       * tickBody throws today (the seams resolve, writeState catches), so
       * this is purely defensive -- but a future deterministic throw would
       * otherwise loop silently forever with the current phase frozen on
       * screen, the one hang shape the blank/unknown/stalled bounds do not
       * cover.
       */
      owner.tickErrors = (owner.tickErrors || 0) + 1;
      if (owner.tickErrors > 20) {
        becomeStuck(owner, 'something kept going wrong while watching the sign-in',
          'the watcher errored repeatedly; Try again, or use Terminal');
      }
    });
  }, TICK_MS);
}

/**
 * One look at the pane, one decision. The guard on `lastActed` means a screen
 * is acted on ONCE: a second Enter on the theme screen would land on the next
 * screen and pick whatever was under the cursor.
 */
async function tick(owner) {
  if (driver !== owner) return;
  // ⚠️ ONE tick in flight at a time. The interval fires on schedule whether
  // or not the previous capture came back; a slow tmux otherwise stacks
  // concurrent capture children until their 20s timeouts drain.
  if (owner.ticking) return;
  owner.ticking = true;
  try {
    await tickBody(owner);
    owner.tickErrors = 0;
  } finally {
    owner.ticking = false;
  }
}

async function tickBody(owner) {
  /**
   * ⚠️ HEARTBEAT. State is otherwise written only on phase changes, so a
   * flow legitimately parked at the paste prompt for over an hour would go
   * stale under the freshness bound -- and a second server would then treat
   * the LIVE flow as interrupted and cancel could kill it. The owning driver
   * proves it is alive by touching the record every few minutes.
   */
  if (mem.pid === process.pid && ACTIVE_PHASES.includes(mem.phase)) {
    // Explicit like foreignLiveFlow, not through coercion: a record missing
    // its stamp gets one now, and an unparseable stamp is treated as due.
    const age = mem.updatedAt ? Date.now() - Date.parse(mem.updatedAt) : Infinity;
    if (!Number.isFinite(age) || age > HEARTBEAT_MS) writeState({ ...mem });
  }
  const cap = await tmux(['capture-pane', '-p', '-J', '-t', PANE_TARGET]);
  if (driver !== owner) return; // cancelled or replaced while we were looking
  if (!cap.ok) {
    /**
     * ⚠️ ONE FAILED CAPTURE IS NOT A CLOSED WINDOW. `!ok` also covers a
     * spawn failure on a loaded machine and the exec timeout, and declaring
     * "the sign-in window closed" off a single transient error is a settled
     * sentence about a state nobody verified. A session that is truly gone
     * keeps failing, so a short run of failures earns the sentence honestly.
     */
    owner.captureFails = (owner.captureFails || 0) + 1;
    if (owner.captureFails > Math.max(3, Math.ceil(3000 / TICK_MS))) {
      becomeStuck(owner, 'the sign-in window closed before Claude finished',
        tailOf(cap.stderr || '') || 'it is no longer there');
    }
    return;
  }
  owner.captureFails = 0;
  const seen = classifyPane(cap.stdout);

  if (seen.kind === 'unknown') {
    owner.unknownTicks += 1;
    // ⚠️ A grace period, not tolerance: the TUI redraws between screens and a
    // capture can land mid-paint. ~10s of never recognising anything is a
    // different fact, and it is reported rather than waited out forever.
    if (owner.unknownTicks > Math.max(3, Math.ceil(UNKNOWN_GRACE_MS / TICK_MS))) {
      /**
       * ⚠️ THE CONFIG OUTRANKS THE SCREEN IN BOTH DIRECTIONS. A future CLI
       * whose post-login wording drifts from our recognisers classifies as
       * unknown -- and without this check, a login that actually LANDED was
       * reported "we could not finish" while the settings already said
       * connected. Never a false connected (the config decides, as always);
       * this only prevents the false failure.
       */
      const sub = subscription.check(owner.configDir ? { configDir: owner.configDir } : undefined);
      if (sub.state === subscription.STATE.CONNECTED) {
        finishConnected(owner, sub);
        return;
      }
      becomeStuck(owner, 'Claude showed a screen we do not recognise', seen.tail);
    }
    return;
  }
  owner.unknownTicks = 0;
  // ⚠️ NOT reset on blank itself -- the first version of this line ran for
  // every classification including 'blank', so the counter it exists to feed
  // was zeroed on the very tick that incremented it and the escalation could
  // never fire. Caught by the test timing out, not by reading the diff.
  if (seen.kind !== 'blank') {
    owner.blankTicks = 0;
    if (seen.kind !== 'unknown') owner.everSaw = true;
  }
  /**
   * ⚠️ ACTIONS PER CONTINUOUS SCREEN-KIND ARE BOUNDED. The act-once guard is
   * keyed on the pane TEXT, so an animated screen (a spinner frame in the
   * tail) mints a fresh signature every tick and the Enter arms re-fire
   * forever -- typing Enter into the pane every 700ms with no exit. Twenty
   * keypresses without the KIND changing is not progress, whatever the
   * pixels are doing.
   */
  if (seen.kind !== owner.lastKind) { owner.lastKind = seen.kind; owner.kindActions = 0; }
  // The rejection grace resets whenever the paste prompt is NOT on screen: a
  // mid-clear tick between two prompt sightings otherwise resumed the count
  // from its stale value and shortened the grace.
  if (seen.kind !== 'awaiting-code') owner.rejectTicks = 0;

  /**
   * ⚠️ ACT ONCE PER SCREEN, where "screen" is the kind plus the text itself.
   * A guard keyed on kind alone acted once per KIND: the second of two
   * consecutive "Press Enter to continue" screens never got its Enter and the
   * flow sat there. The screens this driver presses keys on are static (no
   * spinner frames), so their text is a stable identity.
   */
  const sig = `${seen.kind}:${crypto.createHash('sha1').update(tailOf(cap.stdout)).digest('hex').slice(0, 12)}`;

  /**
   * ⚠️ A RECOGNISED SCREEN THAT NEVER MOVES IS A THIRD KIND OF HANG. Unknown
   * screens get 10s and blank panes 45s, but a theme screen that we pressed
   * Enter on and that keeps sitting there had NO bound at all -- "Getting
   * the sign-in ready" forever over a wedged CLI. The screens we PRESS KEYS
   * on count (theme, login-method, and press-enter -- a pre-login
   * announcement wedged after its Enter had no other exit); the paste prompt
   * and the browser wait legitimately sit unchanged for as long as a person
   * dawdles.
   */
  if (seen.kind === 'theme' || seen.kind === 'login-method' || seen.kind === 'press-enter') {
    if (sig === owner.lastSig) {
      owner.sameTicks = (owner.sameTicks || 0) + 1;
      if (owner.acted === sig && owner.sameTicks > Math.max(5, Math.ceil((UNKNOWN_GRACE_MS * 6) / TICK_MS))) {
        becomeStuck(owner, 'Claude is not moving past its first screens', tailOf(cap.stdout));
        return;
      }
    } else {
      owner.sameTicks = 0;
    }
  } else {
    owner.sameTicks = 0;
  }
  owner.lastSig = sig;

  /**
   * ⚠️ #727 item 4 / #897: THE CONFIG OUTRANKS THE SCREEN HERE TOO, not just
   * in the unknown-escalation arm above. A completed sign-in whose pane
   * never redraws to a recognised 'login-done'/'repl' screen within this
   * driver's own window (Josh, #897: "the page kept showing 'Enter the code
   * from your email'"... though the account had in fact been added in the
   * background) was invisible to every tick that landed here, because
   * browser-open and awaiting-code were the two screens this outranking
   * check was never wired into. Checked first, on every tick, before
   * anything the switch below does with the pane text and before the
   * abandoned-leg expiry just below it -- so within any ONE tick, a landed
   * sign-in is always seen before its own expiry clock could fire on that
   * same tick. Residual, accepted, and inherent to a poll-based driver: a
   * sign-in that completes in the ~TICK_MS gap between one negative check
   * and the next is not yet visible when the NEXT tick runs its check, the
   * same granularity every other becomeStuck() trigger in this file already
   * accepts. At a 15-minute bound that window is a small fraction of a
   * percent of the whole wait, not eliminated but not worth adding
   * cross-tick bookkeeping to shrink further.
   */
  if (seen.kind === 'browser-open' || seen.kind === 'awaiting-code') {
    const sub = subscription.check(owner.configDir ? { configDir: owner.configDir } : undefined);
    if (sub.state === subscription.STATE.CONNECTED) {
      await finishConnected(owner, sub);
      return;
    }
    /**
     * ⚠️ #727 item 4: AN ABANDONED BROWSER LEG shows the exact same pane
     * text a genuinely slow person also shows, so only elapsed time can
     * tell them apart (see ABANDONED_SIGNIN_MS above). Set the first tick
     * this stage is seen, reset on every code actually submitted
     * (submitCode() clears it) so someone genuinely retrying wrong codes is
     * never punished for staying engaged, and cleared entirely once the
     * flow moves on (the `else` branch below).
     *
     * ⚠️ ONE CLOCK FOR BOTH SCREENS, DELIBERATELY -- this `if` covers
     * browser-open AND awaiting-code together, so the budget is 15 minutes
     * for the WHOLE wait on the browser, not 15 minutes at each stage
     * separately. A fresh review named this directly: someone who spends 10
     * minutes on a slow OAuth/2FA leg has only 5 left once they reach the
     * paste-code screen. Accepted as-is -- the alternative (two independent
     * clocks) would let a person legitimately sit for up to 30 minutes
     * total, and 15 already matches this codebase's own definition of dead
     * for a parked flow (DEAD_BOUND_MS). If that combined budget turns out
     * too tight in practice, ABANDONED_SIGNIN_MS is the one number to raise.
     */
    if (!owner.browserWaitSince) owner.browserWaitSince = Date.now();
    if (Date.now() - owner.browserWaitSince > ABANDONED_SIGNIN_MS) {
      /* ⚠️ TRUE OF THIS WINDOW, NOT OVERCLAIMED ACROSS THE WHOLE FLOW: every
         submitted code resets browserWaitSince (see above), so reaching
         here always means nothing was submitted in the final window -- but
         `owner.codeTyped` (set once a code is ever accepted for typing,
         used identically by the rejection-message logic below) still
         remembers whether an EARLIER code was tried and rejected before the
         person gave up. "No code was entered" would overstate a flow that
         had some real engagement earlier. */
      becomeStuck(owner,
        seen.kind === 'awaiting-code'
          ? (owner.codeTyped
            ? 'the code entered did not work, and no other code was entered before this sign-in expired'
            : 'no code was entered for this sign-in, so it expired')
          : 'this sign-in was not finished in the browser, so it expired',
        tailOf(cap.stdout));
      return;
    }
    /* ⚠️ NOT reset on 'blank' -- a blank capture is a legitimate transient
       between screens (this file's own existing rule for blankTicks just
       below), and browser-open is itself an ANIMATED screen (a spinner
       frame), so a mid-repaint/mid-animation capture landing blank while
       genuinely still parked here must not wipe the clock. 'unknown' never
       reaches this line at all (it returns earlier, above), so only a
       screen that is GENUINELY something else -- real forward progress --
       clears the timer. */
  } else if (seen.kind !== 'blank') {
    owner.browserWaitSince = null;
  }

  switch (seen.kind) {
    case 'blank':
      /**
       * ⚠️ A PERMANENTLY BLANK PANE IS AN ANSWER TOO. Blanks are legitimate
       * between screens, so the grace is generous -- but a Claude that clears
       * the screen and hangs must not leave "Getting the sign-in ready" on
       * screen forever, which is progress nobody is producing.
       */
      owner.blankTicks = (owner.blankTicks || 0) + 1;
      // 4.5x the unknown grace (45s in production): blanks are legitimate
      // between screens, so the bound is generous -- but it exists.
      if (owner.blankTicks > Math.max(5, Math.ceil((UNKNOWN_GRACE_MS * 4.5) / TICK_MS))) {
        // The sentence claims only what THIS flow observed: "never drew" is
        // false once any screen was recognised earlier in the flow.
        becomeStuck(owner, owner.everSaw
          ? 'the sign-in window went blank and stayed blank'
          : 'Claude never drew its sign-in screen', 'the window stayed blank');
      }
      return;
    case 'theme':
      if (owner.acted !== sig) {
        if ((owner.kindActions || 0) >= 20) {
          becomeStuck(owner, 'Claude keeps asking to continue and never moves on', tailOf(cap.stdout));
          return;
        }
        owner.kindActions = (owner.kindActions || 0) + 1;
        owner.acted = sig;
        await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
      }
      return;
    case 'login-method':
      if (owner.acted !== sig) {
        if ((owner.kindActions || 0) >= 20) {
          becomeStuck(owner, 'Claude keeps asking to continue and never moves on', tailOf(cap.stdout));
          return;
        }
        owner.kindActions = (owner.kindActions || 0) + 1;
        owner.acted = sig;
        // Option 1, "Claude account with subscription", is already selected.
        await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
      }
      return;
    case 'browser-open':
      /**
       * ⚠️ NEVER BACKWARDS. The paste screen contains the "Use the url
       * below" line too, so a mid-repaint capture missing only the prompt
       * line classifies as browser-open -- and an unconditional write here
       * regressed the phase from awaiting-code (rebuilding the panel under
       * the person's typing) and from completing (bypassing the one arm that
       * resets the typed-code guard, leaving a later code accepted but never
       * typed: a livelock only Cancel escaped). Forward from launching only;
       * anything else keeps its phase and at most gains the URL.
       */
      if (mem.phase === PHASE.SIGNIN_LAUNCHING) {
        writeState({ phase: PHASE.SIGNIN_BROWSER_OPEN, url: seen.url || null, startedOnce: true });
      } else if (seen.url && !mem.url) {
        writeState({ ...mem, url: seen.url });
      }
      /**
       * ⚠️ COMPLETING IS A PROMISE WITH A DEADLINE whatever the pane shows.
       * The 60s config wait only ticked in the login-text branch, so a CLI
       * wedged on this frame after a code was typed left "Finishing the
       * sign-in" painted forever. Same counter, same honest exit.
       */
      if (mem.phase === PHASE.SIGNIN_COMPLETING) {
        owner.waitTicks = (owner.waitTicks || 0) + 1;
        if (owner.waitTicks > Math.ceil(60000 / TICK_MS)) {
          becomeStuck(owner, 'Claude says it signed in, but we cannot see the connection yet',
            'the settings file has not caught up; Check again in a moment, or try once more');
        }
      }
      return;
    case 'awaiting-code': {
      /**
       * ⚠️ A PASTE PROMPT AFTER A CODE WAS TYPED MEANS THE CODE DID NOT TAKE.
       * Without this arm the phase sat at `signin-completing` forever while
       * the terminal literally asked for another code and `submitCode`
       * refused to accept one -- "Finishing the sign-in…" on a screen nobody
       * was finishing, the exact shape this codebase bans. The grace covers
       * the CLI's processing time (the prompt stays up briefly after Enter).
       */
      if (mem.phase === PHASE.SIGNIN_COMPLETING) {
        owner.rejectTicks = (owner.rejectTicks || 0) + 1;
        if (owner.rejectTicks > Math.max(3, Math.ceil(6000 / TICK_MS))) {
          owner.rejectTicks = 0;
          owner.lastActed = null;   // a new code may be typed
          // ⚠️ The completing-wait counters too: without these, the 60s
          // config wait and the 8s REPL bound were budgets per FLOW, not per
          // attempt, and a retried sign-in could be declared stuck early.
          owner.waitTicks = 0;
          owner.replTicks = 0;
          owner.rejectCount = (owner.rejectCount || 0) + 1;
          writeState({
            phase: PHASE.SIGNIN_AWAITING_CODE,
            url: seen.url || mem.url || null,
            /**
             * ⚠️ Two ways to arrive here, two different true sentences --
             * and a SECOND rejection gets a THIRD, because the page repaints
             * (and a screen reader re-announces) only when the sentence
             * changes: an identical retry failure would otherwise show and
             * say nothing at all.
             */
            because: !owner.codeTyped
              ? 'the sign-in did not finish on its own, so paste the code from your browser here'
              : (owner.rejectCount > 1
                ? 'that code still did not work; make sure you are copying the newest one'
                : 'that code did not work, so check it and paste it again'),
            startedOnce: true,
          });
        }
        return;
      }
      owner.rejectTicks = 0;
      if (mem.phase !== PHASE.SIGNIN_AWAITING_CODE) {
        // Entering the paste prompt fresh: any stale typed-code guard from a
        // path that bypassed the rejection arm must not eat the next code.
        owner.lastActed = null;
        writeState({ phase: PHASE.SIGNIN_AWAITING_CODE, url: seen.url || mem.url || null, startedOnce: true });
      } else if (seen.url && !mem.url) {
        // The URL can render a capture-tick later than the prompt; without
        // this the fallback link never surfaces for the whole phase.
        writeState({ ...mem, url: seen.url });
      }
      if (owner.pendingCode && owner.lastActed !== 'code') {
        owner.lastActed = 'code';
        owner.codeTyped = true;
        const code = owner.pendingCode;
        owner.pendingCode = null;
        // ⚠️ `--` ends option parsing: the allowed charset includes `-`, and a
        // code starting with one would otherwise be read by tmux as flags.
        const typed = await tmux(['send-keys', '-t', PANE_TARGET, '-l', '--', code]);
        const entered = typed.ok ? await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']) : typed;
        // ⚠️ The one post-await write in this module that shipped WITHOUT the
        // owner re-check: a cancel landing between the sends and this line
        // overwrote the person's IDLE with a driverless "completing" record
        // that nothing would ever advance.
        if (driver !== owner) return;
        if (!typed.ok || !entered.ok) {
          becomeStuck(owner, 'we could not type the code into the sign-in',
            tailOf(`${typed.stderr || ''}\n${entered.stderr || ''}`) || 'the sign-in window did not take it');
          return;
        }
        writeState({ phase: PHASE.SIGNIN_COMPLETING, url: mem.url || null, startedOnce: true });
      }
      return;
    }
    case 'login-done':
    case 'press-enter':
    case 'repl': {
      /**
       * ⚠️ THE FINISH LINE IS THE CONFIG, NOT THE TEXT. `check()` fresh, not
       * `checkCached()`: the cache exists for the 5-second status tick, and
       * here a stale `none` would hold the screen at "completing" after the
       * login already landed.
       */
      const sub = subscription.check(owner.configDir ? { configDir: owner.configDir } : undefined);
      /**
       * ⚠️ "ASKS FOR ENTER" IS A PROPERTY OF THE TEXT, NOT OF THE VERDICT.
       * The real post-login screen says BOTH "Login successful" and "Press
       * Enter to continue", and classifies as login-done (the further state)
       * -- so a guard keyed on kind === 'press-enter' never fired on the very
       * screen that asks, and the walk-forward this comment promises never
       * happened.
       */
      const asksEnter = /Press Enter to continue/i.test(cap.stdout);
      if (sub.state === subscription.STATE.CONNECTED) {
        // Claude may still be mid-onboarding in the pane (security notes and
        // the like). Walk it forward so the NEXT run of claude -- an agent's
        // first start -- does not begin at a screen nobody is watching.
        if (asksEnter && owner.acted !== sig) {
          if ((owner.kindActions || 0) >= 20) {
            becomeStuck(owner, 'Claude keeps asking to continue and never moves on', tailOf(cap.stdout));
            return;
          }
          owner.kindActions = (owner.kindActions || 0) + 1;
          owner.acted = sig;
          await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
          return;
        }
        // ⚠️ Its OWN counter: sharing it with the config-catch-up wait meant
        // a late-flipping config finished on the next tick and killed the
        // session mid-onboarding, skipping the walk-forward this comment
        // promises.
        if (seen.kind === 'repl' || (owner.settleTicks || 0) > 4) {
          await finishConnected(owner, sub);
          return;
        }
        owner.settleTicks = (owner.settleTicks || 0) + 1;
        return;
      }
      if (asksEnter && owner.acted !== sig) {
        if ((owner.kindActions || 0) >= 20) {
          becomeStuck(owner, 'Claude keeps asking to continue and never moves on', tailOf(cap.stdout));
          return;
        }
        owner.kindActions = (owner.kindActions || 0) + 1;
        owner.acted = sig;
        await tmux(['send-keys', '-t', PANE_TARGET, 'Enter']);
        return;
      }
      /**
       * ⚠️ LOGIN EVIDENCE CAN ARRIVE FROM ANY SIGN-IN PHASE, not just after a
       * pasted code -- the browser flow can complete on its own. Without
       * this, "Login successful" seen while the phase was still
       * `signin-browser-open` fell into no arm at all and the driver looped
       * forever at "will notice when it is done", noticing nothing.
       *
       * ⚠️ AND "Press Enter to continue" ALONE IS NOT LOGIN EVIDENCE: a
       * pre-login announcement screen carries no login at all, and advancing
       * on it painted "Finishing the sign-in" before sign-in began. Only the
       * screens that SAY logged-in (login-done, or a live REPL) advance.
       */
      if ((seen.kind === 'login-done' || seen.kind === 'repl')
        && (mem.phase === PHASE.SIGNIN_BROWSER_OPEN || mem.phase === PHASE.SIGNIN_AWAITING_CODE
          || mem.phase === PHASE.SIGNIN_LAUNCHING)) {
        // A code accepted moments before the browser finished on its own
        // must not be typed unprompted if the prompt ever comes back.
        owner.pendingCode = null;
        writeState({ phase: PHASE.SIGNIN_COMPLETING, url: mem.url || null, startedOnce: true });
        return;
      }
      if (mem.phase === PHASE.SIGNIN_COMPLETING) {
        /**
         * ⚠️ A REPL WITHOUT A READABLE SUBSCRIPTION IS AN ANSWER, not a wait
         * state: Claude is running and signed in as far as it is concerned,
         * and our reader cannot confirm the plan. Waiting the full minute is
         * for the settings file catching up after a login; a live REPL means
         * it already wrote what it was going to write.
         */
        if (seen.kind === 'repl') {
          owner.replTicks = (owner.replTicks || 0) + 1;
          if (owner.replTicks > Math.max(3, Math.ceil(8000 / TICK_MS))) {
            /**
             * ⚠️ TWO DIFFERENT TRUE SENTENCES. `none` here is POSITIVE
             * knowledge -- a signed-in free plan, likely the most common
             * way a machine with a config reaches this flow at all -- and
             * for that person "we could not confirm" misstates what is
             * known, and "open Terminal and run claude" cannot help (the
             * CLI is already signed in). `unknown` is the genuine
             * cannot-confirm.
             */
            if (sub.state === subscription.STATE.NONE) {
              becomeStuck(owner, 'this computer is signed in to Claude, but on a plan without a subscription',
                'agents need a subscription to think with; upgrade at claude.ai, then press Try again');
            } else {
              becomeStuck(owner, 'Claude looks signed in here, but we could not confirm a subscription',
                sub.because || 'the settings on this computer do not say which plan it is on');
            }
            return;
          }
        }
        // Text says logged in but the config has not flipped yet; give it a
        // bounded wait rather than forever. Its OWN counter, distinct from
        // the post-connected settle above.
        owner.waitTicks = (owner.waitTicks || 0) + 1;
        if (owner.waitTicks > Math.ceil(60000 / TICK_MS)) {
          becomeStuck(owner, 'Claude says it signed in, but we cannot see the connection yet',
            'the settings file has not caught up; Check again in a moment, or try once more');
        }
      }
      return;
    }
    default:
  }
}

async function finishConnected(owner, sub) {
  if (driver !== owner) return;
  const d = driver;
  driver = null;
  /* Same ownership rule as becomeStuck: the verdict names the owner's
     account, whatever the module variable says by now. */
  flowDir = owner.configDir || null;
  if (d && d.timer) clearInterval(d.timer);
  const memBefore = mem;
  await killSession();
  // ⚠️ The one write that crossed an await unguarded: a fresh START owns the
  // record now (driver set), and a CANCEL that landed inside the kill above
  // wrote its own record (mem replaced -- writeState swaps the object, so
  // identity detects it where a null driver cannot). Either way the stale
  // CONNECTED stays unwritten; the reader answers connected on the next ask.
  if (driver || mem !== memBefore) return;
  writeState({ phase: PHASE.CONNECTED, plan: sub.plan || null, startedOnce: true });
}

function becomeStuck(owner, because, tail) {
  /**
   * ⚠️ ONLY THE OWNING FLOW MAY DECLARE ITSELF STUCK. Every path that lands
   * here crossed an `await`, and during it the flow may have been CANCELLED
   * (driver null) or REPLACED by a fresh start (driver is somebody else). A
   * person who deliberately cancelled must not later find a STUCK record
   * written by the very request their cancel aborted, and a stale flow's
   * failure must never tear down the healthy flow that superseded it --
   * existence checks cannot tell those apart; identity can.
   */
  if (!driver || driver !== owner) return;
  const d = driver;
  driver = null;
  /* The STUCK verdict below is about the OWNER's account; the module
     variable may have been re-aimed by a raced start while this flow was
     parked on the await that brought it here. */
  flowDir = owner.configDir || null;
  if (d && d.timer) clearInterval(d.timer);
  if (activeRequest) { try { activeRequest.destroy(); } catch { /* already ended */ } activeRequest = null; }
  if (activeChild) { try { activeChild.kill(); } catch { /* already exited */ } activeChild = null; }
  killSession(); // fire-and-forget: run() resolves {ok:false} and never rejects
  /**
   * 🛑 WHETHER THERE IS ANYTHING TO RUN, ASKED OF THE DISK, RECORDED HERE.
   *
   * The stuck screen offers one way out: *"open Terminal, type `claude`, and
   * follow its sign-in"*. **Three of the five ways to get stuck mean that
   * program was never installed** — the download failed, the binary is not where
   * it should be, or the install step (which IS the PATH step) did not finish.
   * So the screen where somebody is most stuck tells them to run something that
   * answers `command not found` (#205).
   *
   * ⚠️ ASKED OF THE DISK, NEVER INFERRED FROM WHICH CAUSE FIRED. Keying on the
   * branch infers the binary's existence from the code path we happened to take,
   * which is a second derivation of a fact the filesystem already holds — and it
   * would be wrong for the case where a download succeeded and something else
   * broke afterwards.
   *
   * 📌 The failure direction is chosen: any error answering FALSE, so an
   * unreadable machine withholds the suggestion rather than offering one that
   * cannot work. A missing way out is a smaller harm than a way out that fails
   * in front of somebody already stuck.
   */
  let canRunClaude = false;
  try {
    fs.accessSync(claudeBinPath(), fs.constants.X_OK);
    canRunClaude = true;
  } catch { canRunClaude = false; }
  writeState({ phase: PHASE.STUCK, because, tail: tail || null, startedOnce: true, canRunClaude });
}

/**
 * The user pasted a code. Accepted only while the terminal is actually
 * waiting for one; anything else is refused with the reason, because typing
 * into a screen that is not asking is how a driver corrupts a flow.
 */
function submitCode(code) {
  // `kind` lets the route pick the right refusal status: 'state' conflicts
  // are 409s (right code, wrong moment); 'format' is a 400 (bad input).
  if (!driver) {
    /**
     * ⚠️ THE FOREIGN-FLOW SENTENCE MUST BE TRUE. state() on this server
     * reports the other server's live paste prompt, so the UI renders a
     * paste box -- and "the sign-in is not running" is then false. Say what
     * is actually happening and where the code has to go.
     */
    if (foreignLiveFlow(readPersisted())) {
      return {
        ok: false,
        kind: 'state',
        because: 'this sign-in is running under another Kosmos window on this computer, so paste the code there',
      };
    }
    return { ok: false, kind: 'state', because: 'the sign-in is not running, so there is nowhere to put that code' };
  }
  if (mem.phase !== PHASE.SIGNIN_AWAITING_CODE) {
    return { ok: false, kind: 'state', because: 'Claude is not asking for a code right now' };
  }
  if (!validCode(code)) {
    return { ok: false, kind: 'format', because: 'that does not look like a sign-in code' };
  }
  driver.pendingCode = code;
  // #727 item 4: a code actually submitted is evidence the person is still
  // there, so the abandoned-leg clock (see ABANDONED_SIGNIN_MS) re-arms
  // fresh from this moment rather than counting a retry against them.
  driver.browserWaitSince = null;
  return { ok: true };
}

/** Stop everything, clean up everything we made, own nothing half-claimed. */
async function cancel() {
  /**
   * ⚠️ NOT OURS TO CANCEL. `state()` deliberately reports a second server's
   * live flow as it stands; a cancel POSTed to THIS server must then refuse
   * to kill that flow's session, sweep its downloads, and write IDLE over
   * its record -- otherwise the reporting side supports a scenario the
   * destructive side corrupts. With no local driver, a fresh mid-flight
   * record from a live foreign pid stays that flow's property. (A dead or
   * stale record still gets cleaned: that is the orphan case cancel exists
   * for.)
   */
  if (!driver) {
    // Read ONCE: the owning process can replace the file between two reads,
    // and a second read coming back null would throw inside publicView.
    const disk = readPersisted();
    if (foreignLiveFlow(disk)) return publicView(disk);
  }
  const d = driver;
  driver = null;
  /* The idle record cancel writes below is nobody's flow; a lingering
     account name on it would be a label with no referent. (A successor
     start parked pre-claim during the kill below can re-aim flowDir
     before that write lands; the stamp is then transient and the
     successor's own first write corrects it, while a successor that has
     CLAIMED the driver stops the write entirely via the guard below.) */
  flowDir = null;
  if (d && d.timer) clearInterval(d.timer);
  if (activeRequest) { try { activeRequest.destroy(); } catch { /* already ended */ } activeRequest = null; }
  if (activeChild) { try { activeChild.kill(); } catch { /* already exited */ } activeChild = null; }
  await killSession();
  /**
   * ⚠️ A FRESH FLOW MAY HAVE STARTED DURING THE AWAIT ABOVE. Everything past
   * this line belongs to whoever owns `driver` NOW: sweeping the downloads
   * dir would delete the new flow's in-flight .part, and writing IDLE would
   * clobber its live record. The new flow owns the state; this cancel is
   * done. (Residual, documented: the killSession above may have killed a
   * session the new flow just made -- its driver then reports "the sign-in
   * window closed", an honest failure, never silent corruption.)
   */
  if (driver) return state();
  try {
    /**
     * ⚠️ Partials AND finished downloads. A verified binary is only useful to
     * the flow that fetched it; after a cancel it is 281MB of somebody's disk
     * spent on a thing they said no to.
     */
    const dir = path.join(store.ROOT, 'downloads');
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.part') || f.startsWith('claude-')) fs.unlinkSync(path.join(dir, f));
    }
  } catch { /* nothing to clean */ }
  // publicView like every other exit: the raw record carries pid/updatedAt/
  // startedOnce, which no HTTP answer elsewhere leaks.
  return publicView(writeState({ phase: PHASE.IDLE, startedOnce: true }));
}

/** Tests only: forget everything without touching disk records. */
function resetForTests() {
  if (driver && driver.timer) clearInterval(driver.timer);
  driver = null;
  activeRequest = null;
  activeChild = null; // a stale handle must not be killable by the next test's flow
  mem = { phase: PHASE.IDLE };
  /* ⚠️ The probe cache belongs to the ONE documented reset seam, not to a second
     one beside it. A partial reset is worse than none: the stale verdict it would
     carry into the next arm can be the harmful `false`, and the arm would pass.
     The generation bump is what stops an IN-FLIGHT probe landing after this. */
  probeGeneration += 1;
  probeCache = null;
  probeInFlight = null;
}

module.exports = {
  PHASE, SESSION, ACTIVE_PHASES,
  state, start, submitCode, cancel,
  classifyPane, extractOauthUrl, tailOf, validCode, redirectDowngrades,
  download, platformKey,
  setRunner, setDryRun, setTickInterval, setUnknownGrace, setAbandonedSigninMs, setFreshnessForTests, resetForTests,
  STATE_FILE,
  willInstall,
};
