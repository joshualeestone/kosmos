'use strict';

/**
 * Where the platform keeps what it creates.
 *
 * The rule from the storage split: **the user's project folder holds their
 * work and nothing of ours.** Everything the platform generates lives in app
 * data, keyed by agent. That is what makes it safe to point an agent at a
 * folder someone already has — including one under version control — without
 * quietly adding our files to their repo.
 *
 * macOS convention, so backup, Time Machine and cleanup behave the way people
 * already expect.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const securewrite = require('./securewrite');   // #5434 slice 4: the store's saves flush before they rename
const os = require('node:os');
const path = require('node:path');
// ⚠️ `ping.js` requires THIS module at its top (for ROOT), so the identity
// stamp below requires ping at CALL time, never at load: a top-level
// require here would hand ping a half-built exports object and ROOT would
// be undefined at its BASE line. Same pattern discover.js uses for create.

/* #2439: the on-disk store leaf. Renamed AgentWorkforce -> Kosmos for branding
   (Josh, 2026-09-07). `engine/commitments.js` and every other consumer route
   through `store.ROOT` (the ONE data-root derivation, #1848/#1856), so renaming
   this constant moves them all; there is no second copy to keep in sync.
   LEGACY_APP is the old leaf, kept so an existing install's data can be migrated
   to the new leaf rather than orphaned (see maybeMigrateLegacyStore below). */
const APP = 'Kosmos';
const LEGACY_APP = 'AgentWorkforce';
/**
 * The per-user application-data directory for ONE platform, as a pure function
 * of the things that decide it (#570).
 *
 * 🛑 THIS WAS A HARDCODED MAC PATH AND IT DOES NOT FAIL ON WINDOWS, WHICH IS
 * WHY IT NEEDED FINDING RATHER THAN WAITING FOR IT TO BREAK.
 * `path.join(homedir(), 'Library', 'Application Support', APP)` on Windows
 * happily creates `C:\\Users\\x\\Library\\Application Support\\AgentWorkforce`.
 * Nothing throws. The person's agents, profiles and avatars simply live somewhere
 * Windows does not consider application data: not roaming, not where an
 * uninstaller looks, not anywhere they would think to look themselves.
 *
 * ⚠️ AND IT IS EXPENSIVE TO FIX LATER, which is the argument for doing it before
 * a single Windows install exists rather than after. Once somebody's store is at
 * the wrong path, changing this is a data migration on a machine we cannot see.
 *
 * 🔑 A PURE FUNCTION OF (platform, homedir, env) SO A TEST CAN ASK ABOUT WINDOWS
 * FROM A MAC. `process.platform` cannot be set, so a module that reads it
 * directly is a module whose Windows behaviour is unassertable from here, and
 * unassertable is how this defect survived in the first place.
 *
 * 📌 LINUX IS KNOWINGLY UNHANDLED and falls through to the mac path, exactly as
 * it did before this change. That is wrong (XDG says
 * `$XDG_DATA_HOME` or `~/.local/share`) and it is not a regression, and this
 * card is Windows. Stated rather than left for somebody to discover in a switch
 * with no default comment.
 */
/**
 * The joiner for the platform being ASKED ABOUT, not the one we are running on.
 *
 * 🛑 THE PARAMETERISATION WAS NOT ENOUGH, AND THIS IS THE HALF THAT WAS MISSING
 * (#1510, Renet Tilley). `dataRootFor` takes a platform precisely so a Mac can ask
 * it about Windows. It then joined with the AMBIENT `path`, which off Windows IS
 * `path.posix`, so the win32 branch answered with forward slashes:
 *
 *   dataRootFor('win32', 'C:\\Users\\jo', {})
 *     ->  C:\Users\jo/AppData/Roaming/AgentWorkforce    <- what a Mac produced
 *         C:\Users\jo\AppData\Roaming\AgentWorkforce   <- what Windows produces
 *
 * ⚠️ THE RUNTIME WAS NEVER WRONG. On Windows the ambient `path` is `path.win32`,
 * so a real Windows machine always got the right answer. What was wrong was the
 * EVIDENCE: a function built to make Windows assertable from here returned a value
 * Windows never produces, and fifteen substring assertions could not tell.
 *
 * ⭐ A SUBSTRING MATCHER CANNOT DISTINGUISH THE RIGHT ANSWER FROM A NEARBY WRONG
 * ONE, WHICH IS PRECISELY THE DISTINCTION A GUARD EXISTS TO MAKE. The test now
 * pins whole strings.
 *
 * 📌 This is identical to the ambient `path` on the platform it names, so nothing
 * about a running install changes. It only makes the other platform's answer
 * truthful when asked from here.
 */
function joinerFor(platform) { return platform === 'win32' ? path.win32 : path.posix; }

/* #2439: `app` defaults to APP (the live leaf) so every existing caller is
   unchanged; the migration passes LEGACY_APP to compute the OLD leaf with the
   exact same platform logic, so the two roots can never drift in how they are
   derived (only in the leaf name). */
function dataRootFor(platform, home, env, app = APP) {
  const e = env || {};
  const p = joinerFor(platform);
  let root;
  if (e.AGENT_WORKFORCE_DATA) {
    root = p.join(e.AGENT_WORKFORCE_DATA, app);
  } else if (platform === 'win32') {
    /* ROAMING, not Local: this is a person's own configuration and it should
       follow them to another machine on a domain. `APPDATA` is set on every
       supported Windows, and the fallback is its documented location rather
       than a guess.

       🛑 BUT AN EXPLICIT `AGENT_WORKFORCE_HOME` BEATS THE AMBIENT `APPDATA`, AND
       WITHOUT THIS LINE THE ISOLATION SEAM IS INERT ON WINDOWS. `root()` passes
       `AGENT_WORKFORCE_HOME || os.homedir()` as `home`, and #1780's whole claim --
       stated in root()'s comment as "one var (HOME) isolates BOTH this store and
       the workers root" -- depends on `home` deciding. It does on the Mac branch
       below, which joins `home` directly. Here `e.APPDATA` came FIRST, and APPDATA
       is set on every real Windows box, so the override was read and then thrown
       away: a harness that redirected AGENT_WORKFORCE_HOME and believed it was
       sandboxed was writing to the operator's real %APPDATA%\AgentWorkforce.

       MEASURED on Windows 2026-09-05 by engine/firstrun-isolation-1780.test.js,
       which asserts exactly this and could not previously run here at all -- its
       own safety guard refused, because os.homedir() reads %USERPROFILE% rather
       than $HOME on win32. Turning that arm on is what exposed this.

       ⚠️ ORDER IS THE WHOLE FIX. AGENT_WORKFORCE_DATA still wins above (an explicit
       data root beats an explicit home), and with no override APPDATA still wins
       over the derived path, so nothing changes for a normal Windows install. */
    root = e.AGENT_WORKFORCE_HOME
      ? p.join(home, 'AppData', 'Roaming', app)
      : p.join(e.APPDATA || p.join(home, 'AppData', 'Roaming'), app);
  } else {
    root = p.join(home, 'Library', 'Application Support', app);
  }
  /* #1820: the same posture #1798 took shell-side on the uninstall (DELETE) path,
     here on the READ/WRITE path. A non-absolute final answer means the store
     resolves relative to the process cwd -- a different, wrong directory per
     invocation, so profiles/avatars/settings are written where nothing will look
     for them next run. Three inputs produce a relative root: an empty `home`
     (`home===''` -> `Library/Application Support/AgentWorkforce` on the Mac branch,
     and `AppData/Roaming/AgentWorkforce` on the win32 branch when APPDATA is also
     unset), and a relative `AGENT_WORKFORCE_DATA` on any platform.

     🛑 GUARD THE RESULT, NOT EACH BRANCH (#1798's "the refusals are on the
     result"). Checking each branch would have to be repeated three times and
     would miss the next branch someone adds; one check on `root` catches every
     way of producing a relative path at a single point. `p.isAbsolute` uses the
     joiner for the platform ASKED ABOUT, so `dataRootFor('win32', ...)` is judged
     by Windows's notion of absolute (a drive or UNC), not the host's.

     ⚠️ REFUSE, do not silently absolutize. A misplaced read/write is invisible;
     a thrown error names both offending inputs. Normal operation never trips
     this: `root()` passes `AGENT_WORKFORCE_HOME || os.homedir()`, which is always
     absolute, and every fixture sets AGENT_WORKFORCE_DATA to an absolute sandbox
     path. It fires only on a broken login env or a relative override, exactly
     the two the shell helper refuses. */
  if (!p.isAbsolute(root)) {
    throw new Error(
      `dataRootFor: refusing a non-absolute data root ${JSON.stringify(root)} for platform ${platform} `
      + `(it would resolve relative to the process cwd and scatter the store). `
      + `Check HOME/AGENT_WORKFORCE_HOME (${JSON.stringify(home)}) and `
      + `AGENT_WORKFORCE_DATA (${JSON.stringify(e.AGENT_WORKFORCE_DATA || '')}).`
    );
  }
  return root;
}

// ⚠️ Honours `AGENT_WORKFORCE_DATA` so tests can sandbox it, which they could
// not before: `status.test.js` set that variable, commented that it stopped
// `readProfile` and `avatarPath` reaching the operator's real store, and was
// wrong -- this module read no environment at all, so those calls went to the
// live store and the gates that depend on them could not be pinned against
// seeded data.
/**
 * The three paths, RESOLVED PER CALL rather than at require time (#1443).
 *
 * 🛑 THEY WERE CONSTANTS AND THAT MADE THE SANDBOX SEAM A LIE. Measured, both
 * arms: with `AGENT_WORKFORCE_DATA` set AFTER this module was required,
 * `store.ROOT` still answered the operator's real Application Support
 * directory. Every fixture that sets the variable at the top of its file was
 * fine; every one that sets it inside a `before`, a helper, or after any other
 * module had already pulled `store` in, was writing to the real machine while
 * believing it was sandboxed.
 *
 * ⚠️ AND THE DERIVED TWO ARE THE HALF THAT IS EASY TO MISS. Making `ROOT` lazy
 * and leaving `AVATARS`/`PROFILES` as `path.join(ROOT, ...)` at module level
 * would re-freeze it one line down, and the fix would LOOK done.
 */
/* #1780: the home base honours `AGENT_WORKFORCE_HOME` (the general engine seam
   accounts.js/openaiaccounts.js/runners.js already carry), below `AGENT_WORKFORCE_DATA`
   which still wins inside dataRootFor. So one var (HOME) isolates BOTH this store and
   the workers root (create.homeDir), which are the two roots the first-run About-you write
   resolves through, redirected with one setting instead of AGENT_WORKFORCE_DATA plus
   AGENT_WORKFORCE_WORKERS. (Not every root: projectsRoot has its own var,
   AGENT_WORKFORCE_PROJECTS.) Resolved per call (#1443), so the seam after require still takes. */
/* #2439: one-time move of an existing install's data from the old leaf
   (LEGACY_APP) to the new one (APP), so the rename never orphans a person's
   agents / profiles / avatars. Attempted lazily on first store access and at
   most once PER RESOLVED ROOT (not once per process): keying on `newRoot` keeps
   production at a single attempt while letting each test sandbox re-attempt, so
   no test-only reset hook is needed.

   🛑 IT NEVER CLOBBERS AND NEVER THROWS. It moves ONLY when the new leaf does
   not yet exist, and every failure is swallowed and left non-destructive:
     - new leaf already exists     -> keep it, migrate nothing (dual-existing:
                                      the new one wins, the legacy one is left
                                      untouched, never merged/deleted)
     - legacy leaf does not exist  -> fresh install, nothing to move
     - ENOENT / EEXIST / ENOTEMPTY -> another process migrated first, or the new
                                      leaf appeared between the check and rename
     - EXDEV (cross-device rename) -> the one real limit: the legacy store is
                                      LEFT in place and the app reads the new
                                      (empty) leaf, so the person re-signs-in.
                                      A move is preferred, but never at the cost
                                      of a destructive cross-device copy.
   A bad env (dataRootFor's non-absolute guard) is caught here and ignored; the
   real error still surfaces from root()'s own dataRootFor call below. */
const migrationAttempted = new Set();
function maybeMigrateLegacyStore() {
  try {
    // #2439 fleet-safety opt-out. This migration is triggered by store.root(), so ANY
    // un-sandboxed store.root() call migrates the REAL operator store. On a shared dev
    // box that runs this branch's tests, that renamed the live fleet store out from under
    // the running board (measured: it split the live store, and a re-merge was undone by
    // the next test run). An explicit opt-out lets a shared box / the test harness
    // (tools/run-tests.sh sets it) skip the destructive rename. A real end-user install
    // never sets it, so it still migrates. The migration test clears it per-arm (see
    // store.migrate-2439.test.js) so its sandboxed arms still exercise the rename. This
    // does NOT weaken the never-clobber / never-throw guarantees below; it only lets a
    // shared test environment stay put.
    if (process.env.KOSMOS_NO_LEGACY_MIGRATION === '1') return;
    const platform = process.platform;
    const home = process.env.AGENT_WORKFORCE_HOME || os.homedir();
    const env = process.env;
    const newRoot = dataRootFor(platform, home, env, APP);
    if (migrationAttempted.has(newRoot)) return;
    migrationAttempted.add(newRoot);
    const legacyRoot = dataRootFor(platform, home, env, LEGACY_APP);
    if (newRoot === legacyRoot) return;      // APP === LEGACY_APP: nothing to do
    if (fs.existsSync(newRoot)) return;      // new store present: never clobber
    if (!fs.existsSync(legacyRoot)) return;  // fresh install: nothing to move
    fs.mkdirSync(path.dirname(newRoot), { recursive: true });
    fs.renameSync(legacyRoot, newRoot);      // atomic when target absent + same fs
  } catch {
    /* Never crash the app and never destroy data over a migration; the block
       above enumerates why each failure is safe to swallow. */
  }
}

/* #5418: a test process never gets this machine's real data root. Test runs wrote fixture
   records (sender tokens and more) into a fleet Mac's real store and left them there for
   weeks, through a module that froze `store.ROOT` at require time before its test set the
   sandbox (38 module-level captures in 35 files, measured 2026-10-06 by a git grep for
   `const|let|var X = ...store.ROOT|AVATARS|PROFILES` in engine/, server.js, lib/, cli*.js,
   leaving out per-call arrow functions). So the rule is HERE, on the derivation every one of them
   reads, not in each of them.

   A test process is one `node --test` started (NODE_TEST_CONTEXT, or --test in execArgv) or
   one tools/run-tests.sh started (KOSMOS_TEST_RUN naming that run's own temp folder, which also
   reaches its shell tests; see inThisTestRun). "Real" is the root this user would get with no override at all, from the
   account's home in the user database (os.userInfo), NOT os.homedir(): that follows $HOME,
   which a test may point at a sandbox, and comparing against it would refuse exactly the
   tests that sandboxed correctly. KOSMOS_ALLOW_REAL_ROOT=1 is the explicit way out for a
   process that must read the real store under a test runner.

   Two outcomes, measured on the full suite before choosing them (about 60 test files set no
   sandbox at all and only load modules that freeze the root):
   - NO sandbox variable set: the store answers ONE throwaway root of this process's own, which is
     what a CI runner's empty real root already gives those tests. The store sets no environment
     variable, so nothing else in the process (agystatus, accounts, the workers root) changes, and
     a test that sets HOME later is honoured from then on. (worlds.applyWorldEnv, given a named
     world, does export that world's path under the throwaway, as it would under any root.) A child
     process the test starts is a test process too when it inherits a marker (NODE_TEST_CONTEXT, or
     KOSMOS_TEST_RUN), and then gets a throwaway of its own; under a direct
     `node --test --test-isolation=none` the parent is known only by its own execArgv, which a
     child does not inherit, so that child is NOT covered. Removed at
     exit, best effort; a process that was killed leaves it, and the next test process to make a
     throwaway removes the ones whose process is gone (sweepDeadTestHomes, any platform). The
     legacy migration is skipped for it, since its own target would be the real store
     (maybeMigrateLegacyStore derives both roots itself and is safe only because root() is its one
     caller and returns before it for a throwaway).
   - A sandbox variable that still resolves to the real root or inside it (a symlink to the real
     home, a named world's DATA an agent inherits from its world) gets the same throwaway. It is
     not refused: an inherited world variable cannot be told from a test's own, and a refusal
     would fail every unsandboxed test an agent in a named world runs.
   Every caller that derives the current or legacy root to READ or WRITE it goes through
   resolveDataRoot below (create.supportDir, worlds.baseRoot, boardauth's legacy token, the
   silence monitor, and win32anchor's runtime anchor off Windows, where it sits inside the data
   root). Not routed: setup-assistant's deny-rule paths (named, never read), win32uninstall (its
   delete is behind liveExecutionAllowed, which a test does not grant), install/setup.sh's consult
   (an installer) and win32anchor on Windows (AppData\Local, not the store).
   Protected is this account's OS-default root (the user database's home), equal or inside; a
   store a shell's inherited non-default AGENT_WORKFORCE_DATA/HOME names is not (the shell side
   is #5428). With no user-database home (os.userInfo throws) the rule is off. */
/* `node --test --test-isolation=none` runs the files in this very process and sets no
   NODE_TEST_CONTEXT (measured, node 26.8.1), but its own execArgv carries --test: that half is
   live-execution's inTestProcess, reused rather than re-derived (updating.js's second-derivation
   rule). */
function isTestProcess(env) {
  // live-execution requires nothing, so this lazy require cannot form a cycle with the store.
  return !!env.NODE_TEST_CONTEXT || require('./live-execution').inTestProcess() || inThisTestRun(env);   // cheapest first
}
/* tools/run-tests.sh sets KOSMOS_TEST_RUN to its own private temp folder. It counts only for a
   process whose temp folder is that one or inside it, so the variable alone, left in a shell
   whose temp folder is the usual one, does not turn a real board into a test. */
let runSeen = null;   // [KOSMOS_TEST_RUN, os.tmpdir(), answer]: the walks once per pair
function inThisTestRun(env) {
  const run = env.KOSMOS_TEST_RUN;
  if (!run || !path.isAbsolute(run)) return false;
  const tmp = os.tmpdir();
  if (runSeen && runSeen[0] === run && runSeen[1] === tmp) return runSeen[2];
  const r = realish(run, process.platform, { fresh: true });
  const t = realish(tmp, process.platform, { fresh: true });
  const answer = t === r || t.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
  runSeen = [run, tmp, answer];
  return answer;
}
let accountHome;   // os.userInfo().homedir, looked up once per process ('' when it cannot be)
function realDefaultRoot(platform, app) {
  if (accountHome === undefined) { try { accountHome = os.userInfo().homedir || ''; } catch { accountHome = ''; } }
  const home = accountHome;
  if (!home) return null;
  // No APPDATA from the environment (a test may point it at a sandbox): on Windows the real root is
  // the account home's AppData\Roaming. A machine whose AppData is redirected elsewhere is not seen.
  return dataRootFor(platform, home, {}, app);
}
/* The nearest existing ancestor's realpath with the rest re-attached, so two spellings of one
   directory (a symlinked /var, a home reached through a link) compare equal even before the
   root exists; lower-cased where the default volume ignores case (macOS, Windows). Cached per
   spelling, since store.ROOT is read often (a symlink made later under a cached spelling is not
   seen). Reached in a test process, by inThisTestRun when KOSMOS_TEST_RUN is set, and by
   test-support/data-root-sandbox.js. */
const realishSeen = new Map();
function realish(p, platform, { fresh = false } = {}) {
  const key = platform + '\0' + p;
  if (!fresh && realishSeen.has(key)) return realishSeen.get(key);
  let head = path.resolve(p); const rest = [];
  let out = null;
  for (;;) {
    try { out = path.join(fs.realpathSync(head), ...rest); break; } catch { /* not there yet */ }
    const up = path.dirname(head);
    if (up === head) { out = path.resolve(p); break; }
    rest.unshift(path.basename(head)); head = up;
  }
  if (platform === 'darwin' || platform === 'win32') out = out.toLowerCase();
  if (realishSeen.size > 256) realishSeen.clear();
  realishSeen.set(key, out);
  return out;
}
/* Equal to or inside this account's real root, current leaf or legacy, whichever leaf was asked
   for (a named world hangs off the current one; a sandbox variable can aim into the legacy one). */
function isRealRoot(resolved, platform) {
  const at = realish(resolved, platform);
  for (const leaf of [APP, LEGACY_APP]) {
    const real = realDefaultRoot(platform, leaf);
    if (!real) continue;
    const r = realish(real, platform);
    if (at === r || at.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return true;
  }
  return false;
}
/* Only this machine's own platform: another platform's path (a Mac asking what Windows would use)
   cannot be this machine's real root, and the host's realpath cannot judge it. */
function isRealRootInTests(resolved, platform, env) {
  if (platform !== process.platform) return false;
  if (!isTestProcess(env) || env.KOSMOS_ALLOW_REAL_ROOT === '1') return false;
  return isRealRoot(resolved, platform);
}
const TEST_HOME_PREFIX = 'kosmos-test-home-';
/* Written into every throwaway when it is made: its pid and this machine's host name. The sweep
   removes only a folder carrying one that names a gone pid on this host, so a folder that merely
   matches the name pattern, or another machine's (a container sharing this tmp), is kept. */
const TEST_HOME_MARK = '.kosmos-test-home';
/* Remove throwaway homes in `dir` whose process is gone: kosmos-test-home-<pid>-XXXXXX where
   signalling <pid> says no such process (ESRCH). A live pid, another user's (EPERM), a name with
   no numeric pid and anything without the prefix are kept. */
function sweepDeadTestHomes(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    if (!n.startsWith(TEST_HOME_PREFIX)) continue;
    const m = /^(\d+)-/.exec(n.slice(TEST_HOME_PREFIX.length));
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    const at = path.join(dir, n);
    // Only a real folder this user owns: never a link, a file, or someone else's.
    let st;
    try { st = fs.lstatSync(at); } catch { continue; }
    if (!st.isDirectory() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) continue;
    let mark = null;
    try { mark = JSON.parse(fs.readFileSync(path.join(at, TEST_HOME_MARK), 'utf8')); } catch { continue; }
    if (!mark || mark.pid !== pid || mark.host !== os.hostname()) continue;
    let gone = false;
    try { process.kill(pid, 0); } catch (e) { gone = e && e.code === 'ESRCH'; }
    if (gone) { try { fs.rmSync(at, { recursive: true, force: true }); } catch { /* next time */ } }
  }
}
let testHome = null;            // this process's one throwaway home
// The throwaway roots handed out, so root() can skip migrating them. (Comment on its own line:
// tools/check-frozen-roots.js reads a const up to the first line ending in `;`.)
const testRoots = new Set();
function throwawayRootForThisProcess(platform, app) {
  if (!testHome) {
    // The pid is in the name so sweepDeadTestHomes can remove only the ones whose process is gone.
    sweepDeadTestHomes(os.tmpdir());
    testHome = fs.mkdtempSync(path.join(os.tmpdir(), TEST_HOME_PREFIX + process.pid + '-'));
    try { fs.writeFileSync(path.join(testHome, TEST_HOME_MARK), JSON.stringify({ pid: process.pid, host: os.hostname() })); } catch { /* unmarked: never swept, removed at exit */ }
    const made = testHome;
    process.on('exit', () => { try { fs.rmSync(made, { recursive: true, force: true }); } catch { /* swept later */ } });
  }
  const r = dataRootFor(platform, testHome, {}, app);
  testRoots.add(r);
  return r;
}
/**
 * #5418: the data root with the test-process rule applied and NO migration. Every caller that
 * derives the store's root to read or write it (root() below, create.supportDir, worlds.baseRoot,
 * boardauth's legacy token, the silence monitor, win32anchor off Windows) goes through this, so
 * one process always agrees on one root, throwaway or real.
 * `env` supplies the sandbox variables (worlds passes the launch's original env); whether this
 * is a test process is always read from process.env.
 */
function resolveDataRoot(platform, home, env, app = APP) {
  const e = env || process.env;
  const resolved = dataRootFor(platform, home, e, app);
  if (!isRealRootInTests(resolved, platform, process.env)) return resolved;
  return throwawayRootForThisProcess(platform, app);
}

function root() {
  const env = process.env;
  const resolved = resolveDataRoot(process.platform, env.AGENT_WORKFORCE_HOME || os.homedir(), env);
  // #5418: a throwaway root is not migrated (the migration's own target is the real store), and
  // neither is the REAL root when a test process allowed it only to read it (KOSMOS_ALLOW_REAL_ROOT);
  // a sandbox in that same process still migrates as usual.
  if (testRoots.has(resolved)) return resolved;
  if (env.KOSMOS_ALLOW_REAL_ROOT === '1' && isTestProcess(env) && isRealRoot(resolved, process.platform)) return resolved;
  /* Migrate BEFORE returning, so the very first store access (a read as often as
     a write) moves the legacy data before anything reads an empty new root. */
  maybeMigrateLegacyStore();
  return resolved;
}
/* The store's two per-agent folders, named ONCE (#1704 PR4). worlds.js builds the
   same folders for a Kosmos this process is not serving (worldProfilesDir /
   worldAvatarsDir), and a second spelling there would drift from this one. */
const PROFILES_DIRNAME = 'profiles';
const AVATARS_DIRNAME = 'avatars';
function avatarsDir() { return path.join(root(), AVATARS_DIRNAME); }
function profilesDir() { return path.join(root(), PROFILES_DIRNAME); }

/* The folder agents' working folders live under, for a given environment and home.
   ONE formula (#1704 PR4): create.workersDir() asks it for this process, and
   worlds.worldWorkersDir asks it for another Kosmos (that world's env overrides laid
   over the pre-world env). Pure: it reads only what it is handed. Joined with the
   platform's own joiner, like dataRootFor (#1732: never the ambient path.join on a
   home argument); the running platform by default, so it is what it always was. */
function workersRootFor(env, home, platform = process.platform) {
  const e = env || {};
  return e.AGENT_WORKFORCE_WORKERS || joinerFor(platform).join(home, 'work', 'workers');
}

function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Agent names come from tmux session names and end up in file paths, so they
 * are treated as untrusted. A name containing `../` would otherwise write
 * outside the store entirely.
 */
function safeKey(name) {
  const key = String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!key) throw new Error('invalid agent name');
  return key;
}

const ALLOWED_IMAGES = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/* #4885: the one rule for which file in an avatars folder is `key`'s picture: `<key>.<ext>` with an image extension,
   any case, `.jpeg` too (a folder imported from elsewhere may use it). A stray `<key>.png.bak` or `<key>.txt` is not a
   picture. Shared by avatarPathIn and avatarLookup so the page and the community sender never disagree about it. */
const AVATAR_EXTS = new Set([...Object.values(ALLOWED_IMAGES), '.jpeg']);
function avatarFileIn(names, key) {
  return names.find((f) => f.startsWith(key + '.') && AVATAR_EXTS.has(f.slice(key.length).toLowerCase())) || null;
}
/* The avatar file for `name` inside `dir`, or null. The ONE lookup (one file per
   agent, `<safeKey>.<ext>`), so importing an agent from another Kosmos's avatars
   folder finds it the way this store does (#1704 PR4). */
function avatarPathIn(dir, name) {
  const key = safeKey(name);
  try {
    const f = avatarFileIn(fs.readdirSync(dir), key);
    if (f) return path.join(dir, f);
  } catch { /* no avatars yet */ }
  return null;
}
function avatarPath(name) { return avatarPathIn(avatarsDir(), name); }
/* #4885: avatarPath, but telling "no picture" from "could not look": { file } or { file: null } when there is none
   (no folder yet, or no file for this agent), and { error } when the folder could not be read. A sender acting on a
   null from avatarPath would take a picture down because of a permission blip. */
function avatarLookup(name) {
  const key = safeKey(name);
  let names;
  try { names = fs.readdirSync(avatarsDir()); } catch (e) {
    return e && e.code === 'ENOENT' ? { file: null } : { error: (e && e.code) || 'unreadable' };
  }
  const f = avatarFileIn(names, key);
  return { file: f ? path.join(avatarsDir(), f) : null };
}

/* kosmos#5302: before Kosmos fits an older picture in place, the picture as it was is copied to avatar-originals/ beside
   the avatars folder (never a name the avatar lookup reads), one per version and size (`<key>.<version>-<size><ext>`), so a fitted copy
   never costs the person a picture. Read and written through securewrite (flushed, then renamed; #5434), so a copy that
   dies part way never stands as an original. It takes the umask default mode, not the picture's. Throws when it cannot be kept; saveRefitAvatar then writes nothing. */
function originalsDir() { return path.join(path.dirname(avatarsDir()), 'avatar-originals'); }
function keepAvatarOriginal(name) {
  const file = avatarPath(name);
  if (!file) throw new Error('there is no picture to keep');
  ensure(originalsDir());
  const size = fs.statSync(file).size;
  const dest = path.join(originalsDir(), safeKey(name) + '.' + avatarVersion(name) + '-' + size + path.extname(file).toLowerCase());
  if (fs.existsSync(dest)) return dest;
  saveFlushed(dest, fs.readFileSync(file));   // #5434: flushed before the rename, so a crash never leaves a zeroed original
  return dest;
}
/* kosmos#5302: the page's refit of an older picture. Refused (code CHANGED) when the picture is not the version the page
   read; otherwise the original is kept first and only then the fitted picture saved. */
function saveRefitAvatar(name, contentType, buffer, version) {
  const now = avatarVersion(name);
  // Version 0 is "no picture, or one that could not be read": never fitted over.
  if (!now || String(now) !== String(version)) { const e = new Error('that picture changed since it was read'); e.code = 'CHANGED'; throw e; }
  keepAvatarOriginal(name);
  return saveAvatar(name, contentType, buffer);
}

/**
 * A version that CHANGES whenever this agent's stored avatar changes (#2698).
 *
 * 🔑 WHY THIS EXISTS. The board serves the avatar with `cache-control: no-store`,
 * so a freshly-drawn `<img>` always refetches the current picture. But the
 * org-chart view skips a repaint when its generated HTML is byte-identical (to
 * preserve keyboard focus), and a BARE `/api/agent/<name>/avatar` URL is identical
 * before and after a picture change -- so the org node's `<img>` was never
 * recreated and kept showing the old image while grid and list (which rebuild
 * their imgs every poll) updated. Carrying this value in the URL as `?v=` makes
 * the HTML change when the picture changes, so the org view repaints and refetches.
 * It mirrors the operator's own `?v=YOU_PIC_V` treatment.
 *
 * The file mtime is the version: `saveAvatar` rewrites the file on every update,
 * so the mtime moves with it, and no counter has to be persisted across restarts.
 * Returns 0 when there is no avatar or the file cannot be stat'd, which is a
 * stable, harmless `?v=0` for the no-picture (initials) case.
 */
function avatarVersion(name) {
  const file = avatarPath(name);
  if (!file) return 0;
  try { return Math.round(fs.statSync(file).mtimeMs); } catch { return 0; }
}

/**
 * What an image ACTUALLY is, read from its first bytes.
 *
 * 🛑 THE TYPE USED TO COME FROM THE BROWSER AND THAT FAILED BOTH WAYS. The page
 * sends `file.type`, which a browser derives from the FILENAME, so a perfectly
 * good PNG with no extension or one the OS does not recognise arrives with an
 * empty content-type and was refused: "unsupported image type: unknown", on a
 * file that would have rendered fine. That is the whole of #12, and it is what
 * makes #181 look broken the first time somebody sets their own picture.
 *
 * 🔑 AND IT IS THE SAME RULE AS EVERY OTHER TRUST DECISION IN HERE: prefer the
 * thing over a claim about the thing. The bytes cannot be wrong about what they
 * are; a header supplied by the caller can be wrong in either direction, and
 * one of those directions is refusing something valid while the other is
 * accepting something that is not an image at all.
 *
 * ⚠️ SIGNATURES ONLY, NOT A DECODER. This says "these bytes begin like a PNG",
 * which is exactly enough to choose a file extension and to refuse a text file
 * claiming to be one. It does not say the image is well formed, and it is not
 * trying to: a truncated PNG is still a PNG, and the page showing a broken
 * image is a better outcome than this file pretending to validate one.
 *
 * @returns {string|null} one of the ALLOWED_IMAGES keys, or null
 */
function imageTypeOf(buffer) {
  if (!buffer || !buffer.length) return null;
  const b = buffer;
  /* ⚠️ EACH FORMAT IS GUARDED BY THE LENGTH IT ACTUALLY NEEDS. A blanket
     minimum of 12 (WEBP's, the longest) refused an 8-byte PNG signature, which
     is a real thing to be handed: the suite's own fixtures are exactly that,
     and a truncated upload is too. Refusing it is not wrong about the file, it
     is wrong about WHY, and "that has to be a PNG" is a bad sentence to show
     somebody holding a PNG. */
  // PNG: the 8-byte signature, which includes the CRLF/EOF pair that exists to
  // catch exactly the transfer corruption we would otherwise store.
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
      && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  // JPEG: SOI, then any marker.
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  // GIF87a / GIF89a.
  if (b.length >= 6 && (b.slice(0, 6).toString('latin1') === 'GIF87a' || b.slice(0, 6).toString('latin1') === 'GIF89a')) return 'image/gif';
  // WEBP is a RIFF container: "RIFF" then four size bytes then "WEBP". The
  // size bytes are skipped rather than checked, because a wrong length is a
  // broken file rather than a different format.
  if (b.length >= 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function saveAvatar(name, contentType, buffer) {
  if (!buffer || !buffer.length) throw new Error('empty file');
  /* ⚠️ EMPTY AND OVERSIZE FIRST, and the order is the message. Sniffing a 6MB
     PNG says "not an image" only if you sniff junk; sniffing FIRST would tell
     somebody with a large photo that it is not a PNG, which is false and sends
     them looking for the wrong problem. */
  if (buffer.length > 5 * 1024 * 1024) throw new Error('image is larger than 5MB');
  /* 🔑 THE BYTES DECIDE, and `contentType` is now only a hint for the sentence.
     It used to decide, which refused a valid PNG whose browser-guessed type
     was empty and accepted anything at all that claimed to be one. */
  const sniffed = imageTypeOf(buffer);
  const ext = ALLOWED_IMAGES[sniffed];
  if (!ext) {
    /* The message names what we got where we can, because "unsupported image
       type: unknown" tells somebody nothing about what to do next. */
    throw new Error(contentType && !ALLOWED_IMAGES[contentType]
      ? `that has to be a PNG, JPEG, WebP or GIF, and this looks like ${contentType}`
      : 'that has to be a PNG, JPEG, WebP or GIF');
  }

  const key = safeKey(name);
  ensure(avatarsDir());
  const existing = avatarPath(name);
  const dest = path.join(avatarsDir(), key + ext);
  /* #4885: written beside, then renamed into place, so there is never a moment with no picture or half of one (the
     community sender reads this folder every sweep, and "no picture" there takes the public one down). #5434: flushed
     before the rename. The temporary name is `<key>.<ext>.kosmos-...tmp`, which the lookup (`<key>.<ext>` only)
     never takes for a picture. */
  saveFlushed(dest, buffer);
  // Replace rather than accumulate: one avatar per agent, and an old .png
  // left beside a new .jpg would win or lose by directory order.
  // The new picture is already in place, so a failure here is not a failed save. On a disk that ignores case (the
  // default on macOS and Windows) `ava.JPG` and `ava.jpg` are one file, and the rename has just replaced it: removing
  // the old name would remove the new picture. So only a different file is removed.
  if (existing && existing !== dest) {
    try {
      const a = fs.statSync(existing);
      const b = fs.statSync(dest);
      if (a.ino !== b.ino || a.dev !== b.dev) fs.unlinkSync(existing);
    } catch { /* gone already, or left beside it; the lookup takes one */ }
  }
  return dest;
}

function removeAvatar(name) {
  const existing = avatarPath(name);
  if (existing) fs.unlinkSync(existing);
  // kosmos#5302: a removed picture takes the originals kept for it too.
  // A writer's temp (`<key>.<ver>-<size><ext>.kosmos-...tmp`, #5434) is another process's keep in flight: never taken.
  try {
    const key = safeKey(name);
    for (const f of fs.readdirSync(originalsDir())) {
      if (f.startsWith(key + '.') && securewrite.tempWriterGone(f) === null) fs.unlinkSync(path.join(originalsDir(), f));
    }
  } catch { /* none kept */ }
  return Boolean(existing);
}

/**
 * Profile: the things a person sets that the machine cannot derive.
 *
 * Role is the clearest example — nothing on this machine records what an agent
 * *is*. It is new metadata the user supplies, and it is what makes "Project
 * Manager" mean something the product can act on later.
 */
/* A profile's FILE NAME, not its path (#1704 PR4): importing an agent into another
   Kosmos writes this name into THAT Kosmos's profiles folder, so the formula is
   shared rather than spelled twice. The path stays private (see the exports note). */
function profileFileName(name) { return safeKey(name) + '.json'; }
function profilePath(name) {
  return path.join(profilesDir(), profileFileName(name));
}

function readProfile(name) {
  try {
    return JSON.parse(fs.readFileSync(profilePath(name), 'utf8'));
  } catch {
    return {};
  }
}

/* The identity fields (#170): `id` is the random anchor minted on first write, and
   `idInstall` the install it was minted under. Named ONCE here, where identity lives,
   so a consumer that must produce a FRESH identity -- copying an agent into another
   Kosmos (worlds.importAgents), say -- strips exactly the fields writeProfile restores
   and mints, and a future identity field is added in a single place rather than in
   two that can disagree. */
const IDENTITY_KEYS = ['id', 'idInstall'];

/* #1704 PR4 (review round 3): where a copied agent came from, as
   `{ kosmos: <source world id>, id: <the source profile's own id> }`. The source's
   `id` is the stable identity (it survives renames); the copy mints its own fresh
   `id` like any agent, so this is the ONLY link back. It is not an identity field --
   stripIdentity leaves it -- and each import writes it afresh, so a copy of a copy
   points at the Kosmos it was last copied from. Its own key rather than adopt.js's
   flat `origin` tag: `origin` names HOW an agent came to be (created / adopted),
   this names WHICH agent in WHICH Kosmos, and an import leaves `origin` as copied.
   Read by worldimport to keep a manager that was imported earlier. */
const IMPORTED_FROM_KEY = 'importedFrom';

/* Remove the identity fields from a profile object IN PLACE, so the next writeProfile
   MINTS a fresh id instead of carrying an old one over -- the decided restore
   convention (a restored/copied agent is a separate agent, see writeProfile below).
   Returns the same object for chaining. */
function stripIdentity(profile) {
  for (const k of IDENTITY_KEYS) delete profile[k];
  return profile;
}

/* #5434 slice 4: every store.js save goes through securewrite.writeSecret, so the bytes are flushed to disk before
   the rename makes them the file (a crash otherwise can leave it at full length, zero-filled; #5431). An existing
   file keeps its mode; a new one takes the umask default, as writeFileSync gave. atomicOnly: a failed save throws and
   leaves the old file as it was. These folders are Kosmos's own, so any provably dead writer temp there is reaped. */
// (statSync follows a link: a linked file passes its target's mode, and the rename replaces the link with a regular
// file, as the old write-then-rename did)
function modeOf(file) { try { return fs.statSync(file).mode & 0o7777; } catch { return null; } }
function saveFlushed(file, data) {
  securewrite.writeSecret(file, data, modeOf(file), { atomicOnly: true, umaskDefault: true });
}

function writeProfile(name, patch) {
  ensure(profilesDir());
  const had = readProfile(name);
  const next = { ...had, ...patch, updatedAt: new Date().toISOString() };
  /**
   * The agent's identity (#170): a random id minted ON THE FIRST WRITE and
   * never rewritten, so creation and the lazy backfill of existing agents
   * are one code path rather than two that can disagree. Random and not
   * derived, per the card: anything derived rekeys when its source changes,
   * and the whole point is an anchor that survives renames.
   *
   * ⚠️ A PATCH CANNOT TOUCH IDENTITY. `id` and `idInstall` are restored
   * from the existing record before the stamp runs, so no caller can set,
   * clear, or transplant an id through this door.
   *
   * ⚠️ AN ID MINTED UNDER ANOTHER INSTALL IS REMINTED, and this is the
   * decided restore semantics, not housekeeping: a restored agent is a
   * SEPARATE agent with its own fresh id (Josh ruled the screen, 19:26:
   * nobody is ever asked same-or-copy; the mechanism that needs no warning
   * is fresh id). The install id is the created ping's, the same one-Mac-
   * one-install anchor notify.js already reuses. Its known limit rides
   * along: on a machine whose ping file cannot be written, installId is
   * fresh per process and ids would remint per restart -- which degrades
   * in the SAFE direction (a new id is a separate agent, never a warning).
   */
  for (const k of IDENTITY_KEYS) next[k] = had[k];
  const install = require('./ping').installId();
  if (!next.id || next.idInstall !== install) {
    next.id = crypto.randomBytes(6).toString('hex');
    next.idInstall = install;
  }
  // Write-then-rename (flushed first), so an interrupted write cannot leave a half-written or zero-filled
  // file that parses as an empty profile and silently loses someone's edits.
  saveFlushed(profilePath(name), JSON.stringify(next, null, 2));
  return next;
}

/**
 * The id the BOARD may speak (#170): the profile's id, but only when it was
 * minted under THIS install. A profile copied in from another machine
 * carries that machine's agent's id, and answering with it would name a
 * different agent; null here means "no identity yet", which the first
 * local write resolves by minting fresh. Read-only, no side effects: a
 * poll must never write.
 */
function agentId(name) {
  const p = readProfile(name);
  return (p.id && p.idInstall === require('./ping').installId()) ? p.id : null;
}

/**
 * Account-level settings (#1668), NOT keyed by agent: one operator, one install.
 * A single settings.json in the data root, with the same write-then-rename
 * durability as writeProfile so an interrupted write cannot leave a half-file
 * that parses empty and silently drops the operator's choices. The operator's
 * timezone lives here so the engine can READ it when it composes a message,
 * rather than every agent having to carry it as an instruction.
 */
function settingsPath() {
  return path.join(root(), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

/* #3559: an AUTOMATIC writer (not the person's own Settings save) must never replace what it could
   not read. writeSettings merges over readSettings(), which answers {} for an unreadable file, so a
   blind automatic write there would drop the timezone and every other choice. This merges only
   over a file that is absent or parses as an object, from ONE read (no gap between checking and
   writing), and answers null when it refused. The path is this module's own settingsPath. */
function writeSettingsIfReadable(patch) {
  let had = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    had = parsed;
  } catch (err) {
    if (!err || err.code !== 'ENOENT') return null;   // unreadable or unparseable: leave it alone
  }
  return mergeSettingsInto(had, patch);
}

/* The one merge-and-write both settings writers share (write-then-rename, stamped updatedAt); they
   differ only in what they merge OVER. */
function mergeSettingsInto(had, patch) {
  ensure(root());
  const next = { ...had, ...patch, updatedAt: new Date().toISOString() };
  saveFlushed(settingsPath(), JSON.stringify(next, null, 2));
  return next;
}

function writeSettings(patch) {
  return mergeSettingsInto(readSettings(), patch);
}

/**
 * ⚠️ `profilePath` is NOT exported, and the reason belongs here because this
 * branch exported it and then justified it by saying it had no caller.
 *
 * It was needed for an earlier design in which removing an agent DELETED what
 * this module remembers about it. That design is gone: removing an agent now
 * deletes nothing at all, on purpose, which is what makes it reversible — so a
 * profile deliberately survives its agent's removal and is there again when the
 * agent is restored. Nothing outside this file needs the path, so nothing gets
 * it. A symbol whose only justification is symmetry is a symbol somebody will
 * eventually use for the deletion this feature exists not to do.
 *
 * #5418's exports are a deliberate exception to that rule, stated so it is a choice: TEST_HOME_PREFIX,
 * TEST_HOME_MARK, realDefaultRoot and realish are read-only, and sweepDeadTestHomes deletes only
 * what its own guards allow (a real folder this user owns, named with the prefix, carrying a mark
 * that names a gone pid on this host). Its test and test-support/data-root-sandbox.js are the
 * callers; nothing in the product calls it but the store itself.
 */
module.exports = { APP, LEGACY_APP, dataRootFor, resolveDataRoot, TEST_HOME_PREFIX, TEST_HOME_MARK, sweepDeadTestHomes, realDefaultRoot, realish, safeKey, ALLOWED_IMAGES, imageTypeOf, avatarPath, avatarLookup, avatarPathIn, avatarVersion, keepAvatarOriginal, saveRefitAvatar, saveAvatar, removeAvatar, readProfile, writeProfile, stripIdentity, agentId, readSettings, writeSettings, writeSettingsIfReadable, settingsPath, PROFILES_DIRNAME, AVATARS_DIRNAME, workersRootFor, profileFileName, IMPORTED_FROM_KEY };

/* 🔑 GETTERS, SO 94 REFERENCES ACROSS 39 FILES KEEP WORKING UNCHANGED (#1443).
   `store.ROOT` still reads like a constant at every call site and now answers
   the CURRENT environment instead of the one that happened to be set when some
   other module first required this one.
   ⚠️ ENUMERABLE, so `{...store}` and `Object.keys` behave as they did. A
   non-enumerable getter would be a silent behaviour change in whatever spreads
   this object. */
for (const [name, fn] of [['ROOT', root], ['AVATARS', avatarsDir], ['PROFILES', profilesDir]]) {
  Object.defineProperty(module.exports, name, { get: fn, enumerable: true, configurable: true });
}
