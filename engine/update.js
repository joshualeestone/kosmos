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
const liveExec = require('./live-execution');
const path = require('node:path');
const { spawn } = require('node:child_process');
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
  /* 🛑 NO REAL NETWORK IN A DRY RUN, AND THE INJECTED SEAM WINS OVER THIS CHECK.
     The DRY_RUN gate was on the interval callback ONLY, and the /api/status route
     calls poke() directly (server.js:1778), so every test that boots the server
     walked straight past it: measured, a full suite run made a real request to
     https://installkosmos.com/dist/latest.json, our own tests hitting a
     production host on every run. The guard whose stated purpose was "so none can
     reach the release host" was checked in the one place the traffic did not come
     from.

     Ordered deliberately, the same way engine/create.js:266 consults its runner
     before reading DRY_RUN: an injected fetcher is a test that has SAID what it
     wants, so it still gets called and nothing that stubs the seam changes
     behaviour. Only the un-stubbed case, which is the one that reaches the real
     host, is refused. AGENT_WORKFORCE_DRY_RUN is never '1' in production, so this
     cannot affect a person's machine. */
  /* TWO LOCKS, BECAUSE THEY COVER DIFFERENT HALVES AND NEITHER COVERS BOTH.

     (a) inTestProcess() keys on `process.execArgv` containing `--test`, which is
     PER-PROCESS AND NOT INHERITED (see its docblock). So it is true in the
     test process itself and false in production BY CONSTRUCTION, with no reliance
     on an environment variable a person might set on a real machine. It throws
     rather than returning, the same posture as refuseOrWarn: a test that
     genuinely wants an update answer must say so by injecting a fetcher. refresh()
     is fail-soft at every call site, so a throw costs a status tick.

     (b) The DRY_RUN check covers what (a) cannot: the seven files that boot the
     server as a CHILD process. `--test` is not inherited, so inTestProcess() is
     FALSE in that child, and those are exactly the boots that reach /api/status.
     A reviewer proposed (a) alone and named this limit themselves.

     ⚠️ (b) does have a product effect and it is small and coherent: a person who
     sets AGENT_WORKFORCE_DRY_RUN=1 on a real machine already gets no automatic
     installs, because the tick returns on the same variable, and now also gets no
     update CHECK. Not surprising for a variable that means dry run. (a) alone
     would avoid even that, which is why (a) is the one doing the work in the
     normal case.

     An injected fetcher beats both, the same ordering engine/create.js:266 uses
     for its runner: a test that stubbed the seam has said what it wants. */
  if (!fetcher) {
    if (liveExec.inTestProcess()) {
      throw new Error('engine/update.js: refresh() reached the real release host in a test '
        + 'process with no fetcher injected. Inject one with setFetcher(fn).');
    }
    if (process.env.AGENT_WORKFORCE_DRY_RUN === '1') return;
  }
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
      /* TRIMMED on assignment. `parts()` trims only to VALIDATE, so a manifest
         carrying whitespace left it in `cache.latest`, while `seedFromStatusFile`
         reads fields split on `\s+` and therefore returns a trimmed version. The
         same-version comparison in maybeAutoInstall then compared " 1.2.3 "
         against "1.2.3" and was false forever, which silently disables the
         attempt brake. */
      const v = body && typeof body.version === 'string' && parts(body.version) ? body.version.trim() : null;
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
/* 🛑 A TIME WINDOW CANNOT CLOSE THIS, IT ONLY DELAYS IT. The launchd job is
   RunAtLoad with no KeepAlive, so a board that stops itself for a failing
   install comes back only at the NEXT LOGIN, and by then the previous failure
   is hours old and any window has expired. Traced: login, boot, poll a minute
   later, install, stop, fail, dead until the next login. The board is up about
   sixty seconds per login and the window never once applies.
   A COUNT survives that, because it does not decay. After this many recorded
   automatic failures for the SAME version, stop offering to install it; a new
   version resets the count on its own, because the count is per version. */
const MAX_AUTO_ATTEMPTS = 3;
/* 🛑 A SECOND CAP THAT A NEW RELEASE DOES NOT RESET, AND IT COUNTS DISTINCT
   VERSIONS RATHER THAN ATTEMPTS. MAX_AUTO_ATTEMPTS is keyed on the offered
   version, which is right for a bad TARBALL and a hole for a bad MACHINE: a
   record carrying 99 failed attempts on one version still installed the next one.

   ⚠️ MY FIRST VERSION OF THIS COUNTED ATTEMPTS, WITH A CAP OF 6, AND ITS OWN
   COMMENT SAID IT WAS "set higher than the per-version cap because it must not
   fire on a run of genuinely bad releases". 6 is exactly 2 x 3, so it fired on
   exactly two of them. Measured: three failures on 1.0.0 plus three on 1.1.0,
   then a GOOD 1.2.0 offered, installs 0, permanently, on every machine that saw
   both. Control at streak 5 installed. The comment asserted the property the
   arithmetic denied, and the stderr line went on to blame "this machine", which
   was false in precisely the case the cap was most likely to hit fleet-wide.

   Counting DISTINCT VERSIONS fixes the arithmetic and the diagnosis together: if
   three different releases have each failed here, the common factor really is the
   machine, and that is the sentence the log is allowed to print. Two bad releases
   now reach 2 and do not brake. A single version failing repeatedly reaches 1 and
   is the per-version cap's job, which is exactly the separation that was missing. */

const MAX_FAILED_VERSIONS = 3;
/* The version this board has already announced it is giving up on, so the
   sentence is said once rather than once per TTL forever. */
let gaveUpOn = null;
let autoFailedAt = 0;

function maybeAutoInstall() {
  try {
    if (!available()) return;
    if (!installedRoot()) return;
    if (!(autoPref() || {}).on) return;
    if (autoFailedAt && Date.now() - autoFailedAt < AUTO_RETRY_AFTER) return;
    /* 🛑 THE IN-MEMORY BRAKE IS DESTROYED BY THE FAILURE IT GUARDS, so read the
       DURABLE one too. `install/setup.sh` runs `kosmos stop` before it downloads
       a byte, so a 404, a dropped download or a checksum refusal kills THIS
       process, and `autoFailedAt` dies with it. The launchd job is RunAtLoad
       with no KeepAlive, deliberately, so the board then stays down until the
       next login.

       ⚠️ WITHOUT THIS, #1277 TURNS "STALE BUT UP" INTO "DOWN" on exactly the
       machines it exists for: an unattended board with a persistently failing
       installer would boot, poll about a minute later, stop itself to install,
       fail, and stay stopped. Before this branch it never reached that path at
       all, because nothing polled with nobody watching.

       Same version and same window as the in-memory brake, and the manual
       Install button is unaffected because it does not come through here. */
    const durable = lastAttemptView();
    const offer = available();
    /* ⚠️ `durable.code !== 0` is TRUE for `code: null`, which is what an IN-FLIGHT
       attempt carries: started, not finished, might yet succeed. Without
       `durable.endedAt` the board could announce it was giving up after three
       failed attempts while the third was still running.

       🛑 THIS CONDITION USED TO CARRY A SECOND CLAUSE, `durable.code !== null`,
       AND IT IS GONE ON PURPOSE. A reviewer measured that removing EITHER clause
       alone left the whole suite green, because an in-flight record satisfies
       both, so the guard could not fail for the clause its own comment named. I
       tried to give the second clause an arm of its own, aimed at the spawn-error
       state (wireChild's 'error' handler ends the record with a null code at
       (wireChild's 'error' handler), so endedAt IS set and the code is null, which is genuinely a
       different state). The arm passed with the clause removed too, so it did not
       pin it either.

       I could not construct a case where that clause changes behaviour: after a
       spawn error the in-memory hour window holds the automatic path back
       anyway, and beginInstall's own carry-forward reads `prior.code !== 0`
       independently of this line. Rather than keep a clause nobody can pin, which
       is an invitation for a later refactor to delete it and see green, it is
       removed and `durable.endedAt` carries the meaning alone. If someone finds a
       distinguishing case, add the clause back WITH the arm that shows it. */

    /* 🛑 NOT GATED ON `durable.auto`, AND THAT WAS THE HOLE. A previous fix made
       a manual press CARRY the automatic failure count forward instead of
       zeroing it, which was necessary and not sufficient: the count survived and
       nothing read it, because this predicate skipped any record whose last
       attempt was manual. Measured, with the record at the cap of 3:

         auto-record   (auto=1, attempts=3) -> installs 0, brake holds
         manual-record (auto=0, attempts=3) -> installs 1, attempts climbs to 4

       So the realistic sequence still ended in an unattended shutdown: three
       automatic failures reach the cap, a person logs in, sees the board dying,
       presses Install, that fails too, and walking away lets the automatic path
       take the machine down again. Fixing the STORAGE and leaving the READER is
       a whole class of my own errors on this branch.

       Widening it is safe because this entire block is inside maybeAutoInstall,
       which only the timer calls. A person pressing Install goes to beginInstall
       directly and is never gated here, so the brake still cannot lock somebody
       out of their own machine. The retry window now also applies after a manual
       failure, which is the behaviour you want: a version that failed by hand
       five minutes ago is not a good candidate for an unattended retry. */
    /* 🛑 THE CROSS-VERSION BRAKE, AND IT DELIBERATELY SITS OUTSIDE THE
       SAME-VERSION BLOCK BELOW. That block asks "has THIS version failed three
       times", which is the right question for a bad tarball and the wrong one
       for a machine that cannot install anything: no write permission on the
       install root, a full disk, a proxy blocking the release host. Those
       persist across releases, so every new release handed such a machine three
       more unattended shutdowns. Measured before this existed: a record carrying
       99 failures on 9.9.9 still installed when 9.9.10 was offered.

       No version comparison and no retry window here on purpose. The window
       paces retries WITHIN a version; this is a floor that a version bump must
       not lift. A person pressing Install is never gated, because this whole
       function is only reached from the timer. */
    /* 🛑 A FAILURE RECORD IS SUPERSEDED ONCE THE BOARD IS RUNNING THAT VERSION OR
       NEWER, AND WITHOUT THIS THE STREAK CAP IS A ONE-WAY DOOR. install.status is
       written ONLY by the wrapper this module spawns: measured, `install.status`
       appears zero times in install/setup.sh, with `install.log` present there as
       a control. So the recovery the product itself prescribes, the hand-pasted
       `curl -fsSL .../setup | sh` that `die()` prints and that "install it by
       hand" means to any reader, leaves `code 1, streak 6` on disk FOREVER.

       A person whose machine was broken, who fixed it and reinstalled by hand,
       would then never receive another unattended update, including a security
       one, and the only signal was one stderr line per process into a log nothing
       rotates and nothing surfaces. My own arm proved the consequence and I read
       it as the feature working.

       Being on this version IS the evidence that an install succeeded, whoever
       ran it. So a record naming a version we are not behind is history, not a
       verdict. Waiting for a `code 0` written by our own spawn was the mistake:
       our spawn is not the only way software gets installed. */
    /* 🛑 NO `durable.code !== 0` CLAUSE, AND IT IS NOT AN OVERSIGHT. It was DEAD,
       not merely unpinned: durable.code can never be 0. Traced all three writers,
       measured rather than read: the exit handler calls noteAttemptEnd only when
       `code !== 0` (:749), the spawn-error path passes null (:733), and
       seedFromStatusFile returns early on `code === 0` (:690). So the clause was
       always true. Same decision as `durable.code !== null` earlier on this
       branch, for a stronger reason: that one merely could not be pinned, this one
       cannot change any outcome.

       ⚠️ Deleting dead code silently transfers a load-bearing invariant into
       nobody's care, so the invariant now has an arm of its own: a status file
       recording success must never produce a durable failure record. */
    const superseded = durable && durable.version && !newer(durable.version, RUNNING);
    if (durable && !superseded && durable.endedAt
        /* 🛑 READS THE SET, NOT THE COUNT, AND THE COUNT WOULD HAVE RE-CREATED
           THE ONE-WAY DOOR. An OLD six-field record carries a number produced by
           the increment logic, which an oscillation could inflate. Measured: such
           a record reports streak 6 with an empty set, so braking on the number
           would stop the machine immediately, the attempt would never run, the
           record would never update, and it would be stuck forever on a count that
           may never have been true.

           My own comment two screens up already claimed the old count is "not
           inherited"; it was not, at the WRITE end, and the brake was still
           reading it at the READ end. Same read-end/write-end split as the
           supersede bug, in the same function, one commit later.

           So an old record cannot trip THIS cap, which is the fresh budget the
           comment promises. The per-version cap still holds every release to
           three, so the machine is not unprotected while its set fills in. */
        && (durable.failedVersions || []).length >= MAX_FAILED_VERSIONS) {
      if (gaveUpOn !== 'ALL') {
        gaveUpOn = 'ALL';
        try {
          process.stderr.write(`update: giving up on automatic installs after ${durable.streak} `
            + 'DIFFERENT versions failed to install here, so a new release will not be tried '
            + 'unattended until one succeeds by hand\n');
        } catch { /* a log line must never break the board */ }
      }
      return;
    }
    /* No `durable.code !== 0` here either, for the same measured reason as the
       streak brake above: durable.code is never 0. */
    if (durable && durable.endedAt
        && offer && durable.version && durable.version === offer.version) {
      /* The window still helps inside one process life. */
      const endedMs = Date.parse(durable.endedAt || '');
      if (Number.isFinite(endedMs) && Date.now() - endedMs < AUTO_RETRY_AFTER) return;
      /* And the COUNT is what actually closes the boot loop, because it does
         not expire between logins the way the window does. */
      if ((durable.attempts || 0) >= MAX_AUTO_ATTEMPTS) {
        /* 🛑 SAY SO. Starting an automatic install writes a line; giving up on
           one wrote nothing, and the update overlay renders only a record
           belonging to a press the viewer just made, so the TERMINAL state of
           this whole mechanism reached no human anywhere. */
        /* LATCHED PER VERSION. refresh() runs once per TTL for as long as the
           offer stands, so an unlatched line wrote the same sentence about 96
           times a day, forever, into logs/board.log, which nothing rotates. The
           start line is one per attempt and bounded; this one is not, and the
           plan called it "mirroring the start line", which it was not. */
        if (gaveUpOn !== offer.version) {
          gaveUpOn = offer.version;
          try {
            process.stderr.write(`update: giving up on automatic install of ${offer.version} after `
              + `${durable.attempts} failed attempts; install it by hand or wait for a newer release\n`);
          } catch { /* a log line must never break the board */ }
        }
        return;
      }
    }
    beginInstall({ auto: true });
  } catch { /* an update that cannot start must not break the one that shows */ }
}

/**
 * #1277: THE UPDATER'S OWN TIMER, so a Kosmos nobody looks at still updates.
 *
 * `poke()` had exactly one caller in the whole product: the status route.
 * That route only runs when a browser is polling it, so a board with nobody
 * watching never poked, never refreshed, and never reached
 * `maybeAutoInstall()` -- frozen at its installed version with its own
 * `autoupdate.on` reading true. Measured on this machine's one standing
 * install: alive, auto-update on, every install gate passing, and four
 * releases behind after thirteen hours because nobody had opened its page.
 *
 * ⚠️ AN AGENT MACHINE IS EXACTLY THAT SHAPE. A Mac running agents with
 * nobody sitting at its board is the normal case, not the odd one, and
 * every one of them stopped taking updates silently, security fixes
 * included. The screen that would have told you is the screen nobody is
 * looking at.
 *
 * Same posture as #185's nudge sweep two files over: its own timer, never
 * the status GET, because a read must stay a read. Polling the status
 * endpoint to trigger an update is not a read -- it installs.
 *
 * WHY THE INTERVAL IS WELL UNDER TTL. `poke()` already rate-limits itself
 * to one fetch per TTL window, so this timer does not decide how often the
 * host is asked; it decides how promptly the TTL is noticed. Firing AT TTL
 * would be subtly wrong: `cache.at` is stamped when a refresh COMPLETES,
 * always a little after the tick that caused it, so the next tick lands
 * fractionally inside the window, the gate skips it, and the real cadence
 * silently doubles to 2*TTL. Firing well inside TTL makes the gate the only
 * thing that decides, which is what the rest of this module already assumes.
 *
 * Gated on `installedRoot()` per tick: a from-source checkout cannot install
 * (see that function), so polling from one would be network traffic that can
 * never lead anywhere. Checked per tick rather than at start so there is no
 * boot-order dependency.
 *
 * unref'd, so it never holds the process open -- `kosmos start` must still
 * exit, and the suite must still finish.
 */
/* 🛑 KEEP THIS TICK SMALL RELATIVE TO `TTL`. That is the requirement, and it
   is NOT "must not divide TTL", which is what this comment said until the test
   that asserts it proved otherwise.

   A boundary tick is ALWAYS missed by epsilon, because the success path stamps
   `cache.at` after the await. So the cost of landing on the boundary is one
   whole tick, whatever the alignment, and the only thing that matters is how
   big that tick is:

     5 min  ->  15-minute TTL polls every 20 minutes   (+33%)
     60 s   ->  15-minute TTL polls every 16 minutes   (+7%)

   ⚠️ At 5 minutes it also made a REACHABLE host poll LESS often than an
   unreachable one: the miss path stamps `started` BEFORE the fetch, so it has
   no epsilon and kept a clean 15-minute cadence (5, 20, 35, 50) while the
   success path drifted to 5, 25, 45, 65. Both stamps are deliberate and
   documented where they sit, so the fix belongs here.

   📌 60s divides 900s exactly and that is fine. An earlier version of this
   block said it must not, and the constant beneath it divided TTL anyway, so
   the comment was both wrong and self-contradicting. `engine/update.test.js`
   asserts the real invariant. */
const POLL_EVERY = 60 * 1000;
let pollTimer = null;

function startAutoPoll(opts = {}) {
  const envMs = Number(process.env.AGENT_WORKFORCE_UPDATE_POLL_MS);
  /* 🛑 THE FLOOR APPLIES TO THE ENV VAR ONLY, AND THE SCOPE IS THE POINT.
     `AGENT_WORKFORCE_UPDATE_POLL_MS` is a live production variable with no
     validation, and `=1` would spin installedRoot() (two existsSync calls) a
     thousand times a second forever, on exactly the unattended machine this
     card exists for. `opts.every` is an in-process argument no user can reach.

     ⚠️ Flooring both is not a harmless over-application: it silently clamped
     the seam three arms drive at `{ every: 5 }` up to 1000ms, so those arms
     observed a 150ms window in which no tick could occur and passed whether or
     not the thing they guard existed. Measured: gate-null and gate-truthy both
     gave 0 fetches, indistinguishable, while a 1200ms window gave 1. A guard
     that cannot fail is not a guard. */
  /* 🛑 A CEILING TOO, AND IT MATTERS MORE THAN THE FLOOR. `setInterval`
     collapses any delay above 2147483647 to 1ms, so setting this to a year,
     which is the natural way an operator would try to DISABLE the poll, spins
     installedRoot() about 780 times a second forever. Measured: 31536000000
     gave _repeat=1 and 39 ticks in 50ms with a TimeoutOverflowWarning, against
     0 ticks for the 60000 control. The floor's own argument applies verbatim to
     this direction, and I had guarded only one end. Clamped, a year becomes
     ~24.8 days, which is what the operator wanted anyway. */
  const TIMER_MAX = 2147483647;
  /* The ceiling is applied ONCE, on the line below, which clamps this value
   again. Clamping here as well was dead: removing it left the suite green
   INCLUDING the arm named for the ceiling, which is how a reviewer found it. Two
   clamps on one axis means neither is pinned, and the surviving one is the one
   the arm actually reaches. */
  const floored = envMs > 0 ? Math.max(envMs, 1000) : POLL_EVERY;
  /* The FLOOR is scoped to the env path deliberately (an env var a user can
     reach, versus an in-process argument). The CEILING is not: the wrap above
     2147483647 is a property of the VALUE rather than of who supplied it, so
     an in-process `{ every: 1e12 }` would get the same 780-per-second spin. */
  const every = Math.min(Number(opts.every) > 0 ? Number(opts.every) : floored, TIMER_MAX);
  stopAutoPoll();
  pollTimer = setInterval(() => {
    try {
      /* 🛑 THE FETCH IS GATED, THE TIMER IS NOT. Sixteen test files boot the
         real server, so every one of them starts this poll against the real
         fetch and the real release host. The only thing that kept the suite
         off the network was `installedRoot()` returning null because a
         checkout is not an installed layout, which is INCIDENTAL rather than
         declared: run the suite from an installed app directory and that
         guard goes truthy, the default-on preference passes, and a test run
         can spawn a real `curl | sh` installer.

         Gating the timer instead would break the wiring assertion that this
         poll starts at boot, so the gate sits on the fetch. 39 test files
         already set this variable, so it is the established seam rather than
         a new one. */
      /* `=== '1'`, the fleet-wide spelling (remove.js, connect.js, create.js,
         delete-leftover.js, chat.js all read it that way). A truthiness gate
         meant `AGENT_WORKFORCE_DRY_RUN=0`, the natural way to say NOT a dry
         run, left every other subsystem live and silently switched the update
         poll off for good on a production machine, with no signal anywhere. */
      if (process.env.AGENT_WORKFORCE_DRY_RUN === '1') return;
      if (!installedRoot()) return;
      /* 🛑 GATED ON THE PREFERENCE, AND MY FIRST REASON FOR NOT DOING THIS WAS
         FALSE. I argued the tick must run regardless because the Settings card
         needs a fresh answer to show. It does not: opening the board hits
         /api/status, which already calls poke() (server.js:1778), so an
         opted-out machine still gets a fresh answer the moment somebody looks.
         Ungated, this was new unattended outbound traffic from machines whose
         owner had switched auto-update OFF, for no functional gain.

         ⚠️ This does NOT reverse the standing "off means do not install, not do
         not tell me" decision: the status route still pokes on demand. It stops
         only the unattended tick on a machine that opted out. */
      /* `(autoPref() || {})`, matching maybeAutoInstall. ⚠️ NOT because a throw
         would kill the poll: I wrote that and it is false. This tick's catch is
         per-tick, so a throwing preference costs one tick and the interval
         keeps firing. Measured: with the throwing form the poll still runs and
         still does not fetch, which is why an arm asserting those two things
         could not tell the forms apart and was deleted rather than kept.
         The defensive form earns its place for smaller reasons: it matches its
         sibling, and it does not throw once per tick forever on a machine whose
         preference file is unreadable. */
      if (!(autoPref() || {}).on) return;
      poke();
    } catch { /* an update that cannot be checked must not break the board */ }
  }, every);
  if (pollTimer && typeof pollTimer.unref === 'function') pollTimer.unref();
  return pollTimer;
}

/** Stop the poll. Idempotent, and safe to call when it never started. */
function stopAutoPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

/** Is the poll running? A TEST SEAM, and only that: no route, no CLI verb and
 *  no Settings field exposes it, and engine.reachable excuses it as a seam. The
 *  docstring used to add "and for anyone diagnosing a frozen board", which
 *  named a use nothing supports. It would also answer true in the state a
 *  diagnoser cares about most, since a timer that fires and returns early at
 *  the DRY_RUN or installedRoot gate is still "running". */
function autoPollRunning() { return pollTimer !== null; }

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
     entry rather than minting one per attempt.
     ⚠️ THAT WAS AN ASSERTION AND IS NOW A MEASUREMENT, taken against the real
     origin on 2026-09-01, because the first time this query would have been sent
     for real was on the unattended path with nobody watching. On main it was
     always empty (`.version` read off a string), so no production install has
     ever sent it. If the origin answered a query with anything but the installer,
     EVERY automatic install would fail, each running `kosmos stop` first, on a job
     that is RunAtLoad with no KeepAlive: a board down until the next login, up to
     three times per version.
     
         /setup           200 text/plain  sha256 db404c438a0c31f8...
         /setup?v=9.9.99  200 text/plain  sha256 db404c438a0c31f8...
         bodies byte-identical, 201025 bytes each
     
     🛑 Scope, so nobody over-reads it: that measures THIS origin today, not a law
     about static hosts. A CDN or host change can falsify it, and the failure would
     be silent and unattended. The old wording was "harmless to any origin", and
     the word doing the damage was ANY: it generalised one host's behaviour into a
     property of the web, which is exactly the shape that cannot be checked.
     */
  /* 🛑 `cache.latest` IS A STRING, NOT AN OBJECT, so `.version` was always
     undefined and this buster has never once been appended. Pre-existing, and
     #1277 is what makes it bite: the comment above says the buster exists
     because an edge cache can hand an updating machine the PREVIOUS release's
     installer, which then fetches the previous bytes and reports success. That
     failure now happens on the unattended path, with nobody watching. */
  const v = cache && cache.latest ? String(cache.latest) : '';
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
    /* 🛑 CARRIED, NOT REBUILT. This builds the record from scratch and dropped
       `version` and `auto` in the ONE case where the record survives to be
       read: a successful install kills this server before anything is
       recorded, so an ENDED attempt is always a failure, and that failure
       record is exactly what an operator reads after a machine changed version
       by itself. /api/status ships it to the page, so both fields vanished
       from the API the instant the installer exited. */
    version: lastAttempt && lastAttempt.version ? lastAttempt.version : null,
    auto: !!(lastAttempt && lastAttempt.auto),
    /* ⚠️ AND `attempts`. This rebuild has now dropped a field three separate
       times. Without it the escalation counter REGRESSES on the one path where
       this server survives a failed install: the child wrote attempts=2 to the
       status file, the rebuilt in-memory record says undefined, lastAttemptView
       returns it instead of re-seeding, and the next attempt computes 0+1=1 and
       writes 1 back over the durable 2. */
    attempts: (lastAttempt && lastAttempt.attempts) || 0,
    /* ⚠️ AND `streak`, WHICH IS THE FOURTH FIELD THIS REBUILD WOULD HAVE
       FORGOTTEN. Every field it drops regresses on the one path where this
       server survives a failed install. Dropping the cross-version counter
       here would silently reset the one brake that exists precisely because a
       version change must NOT reset it. */
    streak: (lastAttempt && lastAttempt.streak) || 0,
    /* And the SET, for the same reason as every other field this rebuild has
       forgotten: it regresses on the one path where this server survives a
       failed install, and it is now what the brake actually reads. */
    failedVersions: (lastAttempt && lastAttempt.failedVersions) || [],
  };
}
function seedFromStatusFile() {
  const file = installStatusFile();
  if (!file) return;
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return; }
  /* The trailing pair is OPTIONAL on purpose: a file written by a release
     before this change has two fields, and refusing to parse it would lose the
     failure record entirely rather than lose two of its fields. */
  const m = /^(-?\d+)\s+(\S+)(?:\s+(\S+)\s+(\S+)(?:\s+(\S+)(?:\s+(\S+)(?:\s+(\S+))?)?)?)?/.exec(raw.trim());
  if (!m) return;
  const code = Number(m[1]);
  if (code === 0) return;
  let endedAt = null;
  try { endedAt = fs.statSync(file).mtime.toISOString(); } catch { endedAt = new Date().toISOString(); }
  lastAttempt = {
    startedAt: m[2], endedAt, code,
    because: 'the installer stopped before it could restart the board',
    log: installLog(),
    version: m[3] && m[3] !== '-' ? m[3] : null,
    auto: m[4] === '1',
    /* ⚠️ FLOORED AT 0. A negative value parses fine and makes the cap
   UNREACHABLE: measured with `-9` in the file, the brake never fires and the
   next attempt records -8, counting UP toward a cap it can never reach. Only our
   own installer writes this file, so it needs local tampering rather than
   truncation (every truncation shape was checked and is safe), but the direction
   of the failure is unbounded unattended installs and a floor costs one call. */
    attempts: Math.max(0, Number.isFinite(Number(m[5])) ? Number(m[5]) : 0),
    /* Consecutive failures across ALL versions. Optional like the pair above, so
       a record written before this field existed reads 0 rather than failing to
       parse. 0 is the safe default: it under-counts rather than braking a machine
       that has not earned it. */
    streak: Math.max(0, Number.isFinite(Number(m[6])) ? Number(m[6]) : 0),
    failedVersions: String(m[7] || '').split(',').filter((x) => x && x !== '-'),
    /* 🛑 THE SET, NOT JUST THE COUNT, AND THE COUNT ALONE WAS WRONG. The counter
   incremented whenever the version being attempted DIFFERED from the last
   failure, which is version CHANGE rather than distinct versions. Measured: a
   rollback-then-republish (1.2.0, 1.1.0, 1.2.0) climbed to 3 and braked while
   announcing "3 DIFFERENT versions failed", when there were TWO. Two edge caches
   disagreeing on latest.json produce the same oscillation, and the per-version
   cap never engages because no single version reaches three tries.

   An OLD record has no list, and the list is what decides now. Its numeric count
   is deliberately NOT inherited: it could have been inflated by exactly this
   oscillation, and over-braking costs unbounded time (permanent, silent, security
   fixes included) while under-braking costs a bounded count (the per-version cap
   still holds each release to three). So a machine upgrading into this version
   gets one fresh budget, once. */
  };
}
function lastAttemptView() {
  if (!lastAttempt) seedFromStatusFile();
  if (!lastAttempt) return null;
  /* 🛑 SUPERSEDED IS DERIVED HERE, ONCE, BECAUSE THE PAGE MUST NOT NEED TO KNOW
     `RUNNING`. Both brakes already compute this and neither shared it, so the
     engine knew a record was history and the screen did not.

     What that cost is the advertised recovery itself: three failures of 0.7.0,
     the card says install it by hand, they do, IT SUCCEEDS, and the new board
     boots on 0.7.0. install/setup.sh never writes logs/install.status (measured:
     zero occurrences, with install.log present as a control), so the old failure
     record survives intact, and the card announces PERMANENTLY that Kosmos gave
     up on the version they are now happily running. It clears only if a later
     AUTOMATIC install rewrites the file; a hand reinstall never does.

     Being on this version is the evidence the install worked, whoever ran it,
     which is the same reasoning the brake uses. Derived in one place so the two
     cannot drift. */
  const superseded = !!(lastAttempt.version && !newer(lastAttempt.version, RUNNING));
  return { ...lastAttempt, superseded };
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
  /* 🛑 RECORD WHAT IT IS INSTALLING, AND SAY SO WHEN NOBODY ASKED FOR IT.
     Until #1277 an automatic install could only happen with somebody at the
     board, so "what did it install" was answerable by the person who pressed
     the button. This card makes the unattended path the normal one, and the
     first question after a machine changes version by itself is what it took
     and when. `version` answers the first half; the stderr line below answers
     the second, and it is written ONLY for the automatic path because a person
     who pressed the button already knows. */
  const targetVersion = (cache && cache.latest) || null;
  /* Count consecutive AUTOMATIC failures for this exact version, read from the
     durable record so it survives the restart the installer causes. */
  const prior = lastAttemptView();
  const sameVersionFailure = prior && prior.code !== 0
    && prior.version && targetVersion && prior.version === targetVersion;
  /* 🛑 A MANUAL PRESS MUST NOT ERASE THE AUTOMATIC COUNT. The manual route
     calls beginInstall() with no opts, and zeroing here wrote `0 0` over the
     durable record, so the next boot skipped the brake entirely (it is gated on
     durable.auto) and re-armed three more unattended shutdowns. The realistic
     sequence: three automatic failures reach the cap, a person logs in, sees
     the board dying, presses Install, that fails too, and walking away restarts
     the whole loop. A manual attempt is not evidence that the automatic path
     started working, so it carries the count forward rather than resetting it. */
  const carried = sameVersionFailure ? (prior.attempts || 0) : 0;
  const attempts = (opts && opts.auto) ? carried + 1 : carried;
  /* The cross-version streak, deliberately NOT conditioned on the version. Same
     carry-forward rule as `attempts` (a manual press preserves it rather than
     resetting it) and the same reason: a manual attempt is not evidence that the
     automatic path started working. A SUCCESS clears it, which is handled at the
     read end, because this value is written by the installer wrapper at exit and
     a record with code 0 is never treated as a failure. */
  /* 🛑 DISTINCT VERSIONS, NOT ATTEMPTS, and the supersede rule applies HERE as
     well as at the brake. Two separate defects a reviewer measured:

     (1) Counting attempts made the cap 2 x the per-version cap, so two bad
         releases disabled unattended updates permanently, fleet-wide. It now
         increments only when the version being attempted DIFFERS from the one the
         last failure names, so it answers "how many different releases have failed
         on this machine", which is the question the brake actually asks.

     (2) The supersede rule was applied at the READ end and not here, so a machine
         repaired and reinstalled by hand got exactly ONE unattended attempt and
         then re-locked forever: the brake was skipped, the count was carried
         anyway, and the next failure wrote it straight back over the cap. My own
         comment said a success "clears it, which is handled at the read end"; the
         read end skips the BRAKE, it never cleared the COUNT. */
  const priorFailed = prior && prior.code !== 0;
  const priorSuperseded = prior && prior.version && !newer(prior.version, RUNNING);
  /* 🛑 THE SET, NOT AN INCREMENT. Counting up whenever the version differed from
     the last failure is version CHANGE, not distinct versions. Measured: a
     rollback-then-republish (1.2.0, 1.1.0, 1.2.0) reached the cap and announced
     "3 DIFFERENT versions failed" when there were TWO, and the per-version cap
     never engaged because no single release reached three tries. Two edge caches
     disagreeing on latest.json produce the same oscillation. Third time on this
     branch that a sentence asserted what the arithmetic denied.
  
     Holding the actual set cannot climb on an oscillation, by construction.
     Capped so the record stays one short line, far above the brake so the cap
     cannot mask it. */
  const carriedFailed = (priorFailed && !priorSuperseded && Array.isArray(prior.failedVersions))
    ? prior.failedVersions.slice() : [];
  const failedVersions = (opts && opts.auto && targetVersion && !carriedFailed.includes(targetVersion))
    ? carriedFailed.concat(targetVersion).slice(-8)
    : carriedFailed;
  const streak = (opts && opts.auto) ? Math.max(failedVersions.length, 1) : failedVersions.length;
  lastAttempt = { startedAt: new Date().toISOString(), endedAt: null, code: null, because: null, log: null, version: targetVersion, auto: !!(opts && opts.auto), attempts, streak, failedVersions };
  if (opts && opts.auto) {
    try { process.stderr.write(`update: starting an automatic install of ${targetVersion || 'an unnamed version'} at ${lastAttempt.startedAt}\n`); } catch { /* a log line must never break an install */ }
  }
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
  /* 🛑 `exit "$code"` AT THE END, AND WITHOUT IT THE NON-ZERO EXIT BRANCH WAS
   UNREACHABLE IN PRODUCTION. `sh -c` exits with its LAST command's status, and
   that was the `printf`, which succeeds. So every failed install reported exit 0
   to this process.

   The status FILE was always correct, which is what hid it: the durable path
   recovers on the next boot, and the three arms covering this failure path drove
   wireChild with a hand-made child emitting a non-zero exit the real wrapper could
   never produce. Writer and reader are declared in two places and hand-matched,
   which is exactly where it hid.

   What it cost whenever the board SURVIVES the failure, which is every curl-side
   failure, since `kosmos stop` never ran: single-flight was never released so
   Install was dead for the life of the board, the press overlay spun on a record
   that never ended, and the Settings sentence added for unattended failures
   rendered NOTHING, because it is gated on endedAt.

   Measured both arms offline with a stub curl: 22 stays 22, 0 stays 0. */
  const statusFile = installStatusFile() || '/dev/null';
  /* 🛑 THE STATUS FILE IS THE DURABLE CHANNEL AND IT MUST CARRY THE ANSWER.
     On an update the installer runs `kosmos stop` before downloading a byte, so
     THIS server is dead for every real failure: a 404, a dropped download, a
     checksum refusal, a failed swap. The in-memory noteAttemptEnd path only
     ever sees preflight refusals and spawn errors, which is the RARE branch.
     So the record an operator reads after an unattended machine changed
     version by itself comes from this file, and it used to carry only an exit
     code and a start stamp. Two more fields, and `-` stands in for an unknown
     version so the field count stays fixed. */
  /* 🛑 THE SHARED FAIL-CLOSED LIVE-EXECUTION GATE, AND THIS IS THE PLACE IN THE
     PRODUCT THAT MOST NEEDED IT AND DID NOT HAVE IT. engine/create.js has run
     every agent spawn through this gate since #1598. The line below runs
     `curl -fsSL <url> | sh` detached, as the person, with their real HOME, and
     the served installer stops the board and replaces the installed copy. It was
     the more dangerous of the two spawns and the only ungated one.

     Found by a challenge reviewer on #1277: two arms in this branch's own test
     file opened every gate without injecting a runner, so `node --test` spawned
     the REAL production installer against installkosmos.com twice per run.
     Measured: that endpoint serves a real 201KB installer even for a version
     that does not exist, so it was not a harmless 404. Nothing of OURS stopped
     it; the installer's own refusal to run under a live
     board did. ⚠️ AND THAT BACKSTOP IS NARROWER THAN I CREDITED, WHICH MAKES THE
     INCIDENT WORSE RATHER THAN BETTER. That refusal is FRESH_INSTALL-gated:
     install/setup.sh:1979 sets FRESH_INSTALL=yes unless $KOSMOS_HOME/bin/kosmos
     is executable, and the die at :2297 is on the NOT-fresh path. On a CI runner
     or a clean dev box, where no Kosmos is installed, the fresh path at :2242
     finds nothing on the port and FINISHES THE INSTALL. So the thing that saved
     this machine was that Kosmos happened to be installed and running on it, and
     on a clean machine the suite would have installed Kosmos rather than been
     refused.

     🛑 ORDER. THE PARAGRAPH THAT USED TO BE HERE WAS BACKWARDS, AND IT SAID
     "checked rather than assumed" WHILE BEING NEITHER. I compared LINE NUMBERS
     and called that reading the code: :7462 opens the gate, :7411 starts the
     poll, so I concluded the gate opens after the poll and reasoned about a race.
     Execution order is not line order. `:7462` is inside `if (require.main ===
     module)` at server.js:7454 and runs AT LOAD; `:7411` is inside the
     `listening` callback, and `start()` is not called until :7586. So the gate
     opens STRICTLY BEFORE the poll starts, and the race I described does not
     exist. A reviewer read the enclosing scopes I did not.

     The check still belongs at spawn time rather than at poll start, but for a
     plainer reason than the one I invented: this is the statement that runs the
     installer, and a gate belongs at the thing it guards. Gating startAutoPoll
     would guard the timer instead, which is not the dangerous part.

     In a test process refuseOrWarn THROWS, so this class is loud rather than
     silent. In production it warns and we decline to spawn, which is the right
     direction for the one command in this product that ends in `| sh`. */
  if (!liveExec.liveExecutionAllowed()) {
    /* 🛑 RELEASE SINGLE-FLIGHT *BEFORE* THE REFUSAL. THE ORDER IS THE WHOLE POINT.
       `refuseOrWarn` THROWS in a test process (live-execution.js, in refuseOrWarn), so with the
       release written after the call it was UNREACHABLE on exactly the branch
       that needed it, and the comment here claimed a release that never happened.
       maybeAutoInstall swallows the throw, so the flag stayed set.

       The consequence inverts what this gate is for. refresh() reaches
       beginInstall on its own, so the FIRST refusal in a file stranded the flag,
       and every later beginInstall returned early at the single-flight check
       doing nothing. Arms after the first would then pass SILENTLY, because
       nothing they asked for ever ran. A guard built to be loud made the tests
       after it quietly green. Found by a reviewer, and then reproduced by my own
       new arm failing for this reason rather than the one I wrote it for.

       Not try/finally: a `return` inside `finally` swallows the throw, and the
       throw is the loudness worth keeping. */
    installStarted = false;
    liveExec.refuseOrWarn('engine/update.js', '/bin/sh', ['-c', 'curl -fsSL <setupUrl> | sh']);
    return;
  }
  const child = spawn('/bin/sh', ['-c', 'set -o pipefail; curl -fsSL "$1" | sh; code=$?; printf "%s %s %s %s %s %s %s\n" "$code" "$3" "$4" "$5" "$6" "$7" "$8" > "$2"; exit "$code"', 'sh', setupUrl(), statusFile, lastAttempt.startedAt, lastAttempt.version || '-', lastAttempt.auto ? '1' : '0', String(lastAttempt.attempts || 0), String(lastAttempt.streak || 0), (lastAttempt.failedVersions || []).join(',') || '-'], {
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
/* Clears EVERY piece of module-level state, including the poll timer. It used
   to clear five of six, and the only thing preventing a leaked interval was an
   afterEach in one test file: any future file that started the poll and called
   just resetCache() would leave a live timer hitting the real installedRoot().
   A reset that leaves something running does not mean what its name says. */
function resetCache() {
  cache = { at: 0, latest: null, reached: false, readable: false };
  inFlight = null; installStarted = false; autoFailedAt = 0; lastAttempt = null;
  /* The give-up latch is module state too, and iteration 1 established that a
     reset leaving something behind does not mean what its name says. Left
     uncleared it leaked between tests: one arm announced 99.0.0 and the next
     arm's identical scenario then said nothing. */
  gaveUpOn = null;
  stopAutoPoll();
}

module.exports = {
  available, poke, refresh, newer, installedRoot, setupUrl, beginInstall, lastAttempt: lastAttemptView, installLog,
  alreadyInstalling, setBase, setFetcher, setInstallRunner, setInstalledRoot, setAutoPref,
  resetCache, RUNNING, TTL, lastLook, checkNow,
  startAutoPoll, stopAutoPoll, autoPollRunning,
};
