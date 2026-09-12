'use strict';
/**
 * A durable home for the two things a Scheduled Task must still find next year.
 *
 * 🛑 THE DEFECT THIS EXISTS FOR. A Scheduled Task is DURABLE. The Windows bundle
 * is a PORTABLE ZIP the person extracts wherever they like, into a versioned
 * folder (`kosmos-0.6.24-win-x64`). Both halves of the task's command line
 * resolve under that extract root:
 *
 *     <extract-root>/runtime/node.exe      process.execPath
 *     <extract-root>/app/engine/           __dirname
 *
 * So an update -- extract the new zip, delete the old folder -- leaves every
 * registered task pointing at paths that no longer exist, and the entire fleet
 * silently fails to come back at the next logon. Nothing reports this: the task
 * is still registered, still enabled, and simply never starts anything.
 *
 * ⚠️ PINNING NODE ALONE FIXES NOTHING, which is the trap worth naming because
 * node is the half people think of. The supervisor script lives under the same
 * root and dies with it. Both have to leave the extract tree, or neither does.
 *
 * 🔑 THIS IS THE MAC'S OWN PATTERN, not a Windows invention. `install/setup.sh`
 * copies `bin app runtime` out of the bundle into a durable KOSMOS_HOME, and
 * kosmos#1139 taught `bin/agent-supervisor.sh` where the engine lives through an
 * `engine-path` POINTER FILE rather than a derived path. Windows has no installer
 * doing the first half, so this module does both halves at once:
 *
 *     <LOCALAPPDATA>/AgentWorkforce/runtime/
 *         node.exe            a copy, so the task's interpreter is durable
 *         engine-path         a pointer to the CURRENT app engine directory
 *         supervisor-boot.js  a durable shim: read the pointer, run the supervisor
 *         node.exe.staged-* / node.exe.retired-*
 *                             transient, only while a new Node version replaces
 *                             a running one (see win32swap.js replaceInterpreter)
 *
 * 🔑 ONE POINTER FILE, EVERY TASK, and that is the property that makes this scale.
 * The pointer is shared, so refreshing it ONCE moves every registered agent onto
 * the new app -- rather than re-registering N tasks per update, which is N chances
 * to half-succeed and leave a split fleet.
 *
 * ⚠️ LOCAL APPDATA, NOT ROAMING -- a deliberate split from `store.js`, which roams
 * on purpose so a person's config follows them to another machine on a domain.
 * `node.exe` is 92 MB and machine-specific (it is an x64 binary; a roaming profile
 * can land on a different architecture). Roaming it would be a real harm to a
 * domain user for no benefit. Config roams; the runtime does not.
 *
 * 📌 THE STALENESS WINDOW, stated rather than hidden. The pointer is refreshed
 * when a job is installed. If the app moves and no agent is created afterwards,
 * the pointer names a directory that is gone until the next install. Refreshing
 * at server start on win32 closes this; it is the next follow-up, not this slice.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const store = require('./store');
const worlds = require('./worlds');
const launchidentity = require('./launchidentity');
/* The rename-swap primitives live in ONE place, shared with the Windows updater,
   so the two cannot drift apart. The side-file infixes and the sweep margin are
   re-exported below, so this module's surface is unchanged. */
const win32swap = require('./win32swap');
const { STAGED_INFIX, RETIRED_INFIX, RETIRED_SWEEP_MIN_AGE_MS } = win32swap;

/**
 * 🛑 ONE SOURCE FOR THE APP DIRECTORY NAME, NEVER A SECOND COPY -- the lesson
 * `supportdir-win32-2039` paid for. create.js once carried its own copy of the
 * data-root formula and it drifted into a literal Mac path on NTFS; the fix there
 * was explicitly "delegate, do not add a branch to the copy", because fixing the
 * instance leaves the class open.
 *
 * ⚠️ AND THE CLASS BIT THIS FILE ALREADY. #2439 renamed the store directory
 * `AgentWorkforce` -> `Kosmos` (with a migration) while this branch was in
 * flight. A hardcoded constant here would have survived the merge silently and
 * left the anchor as the ONE tree still under the old name -- pointing every
 * registered Scheduled Task at a directory nothing else maintains.
 *
 * 📌 The fallback covers only the window before this branch merges #2439: this
 * branch's `store.js` predates the rename and does not export `APP` yet. It is
 * deliberately the OLD name, so behaviour on this base is unchanged, and it
 * becomes dead the moment main is merged.
 */
const APP = store.APP || 'AgentWorkforce';

/* The three files, named once so the writer and the shim cannot disagree about a
   spelling. `supervisor-boot.js` is the only one whose CONTENT we own. */
const NODE_NAME = 'node.exe';
const POINTER_NAME = 'engine-path';
const BOOT_NAME = 'supervisor-boot.js';

/**
 * Where the anchor lives.
 *
 * ⚠️ THE OVERRIDE ORDER MIRRORS `store.dataRootFor` DELIBERATELY, so a sandboxed
 * test isolates this the same way it isolates the store and nobody has to learn a
 * second convention: an explicit data root wins, then the ambient LOCALAPPDATA,
 * then the documented derivation from home. The joiner is chosen for the platform
 * ASKED ABOUT (store.js's #1510 lesson) so a Mac can assert the win32 answer --
 * which matters here more than usual, because the fleet's Macs are where this
 * branch would otherwise go unexercised.
 */
function anchorDir(platform, home, env) {
  /* 🛑 #1704: ONE ANCHOR FOR EVERY WORLD. A board serving a named Kosmos has that
     world's AGENT_WORKFORCE_DATA in its environment, and honouring it here would
     put a second 92 MB interpreter and a second engine pointer under the world,
     which the next update would not refresh. preWorldEnv takes a WORLD override
     back out (it carries the marker) and leaves a sandbox's own root alone (it
     does not), so tests still isolate this exactly as before. */
  const e = worlds.preWorldEnv(env || {});
  const p = platform === 'win32' ? path.win32 : path.posix;
  let base;
  if (e.AGENT_WORKFORCE_DATA) {
    base = p.join(e.AGENT_WORKFORCE_DATA, APP);
  } else if (platform === 'win32') {
    base = e.AGENT_WORKFORCE_HOME
      ? p.join(home, 'AppData', 'Local', APP)
      : p.join(e.LOCALAPPDATA || p.join(home, 'AppData', 'Local'), APP);
  } else {
    base = p.join(home, 'Library', 'Application Support', APP);
  }
  const dir = p.join(base, 'runtime');
  /* store.js's #1820 guard, for store.js's reason: a relative answer resolves
     against the process cwd, so the task would be registered pointing at a
     different directory per invocation. Refuse loudly, do not absolutize. */
  if (!p.isAbsolute(dir)) {
    throw new Error(`win32anchor: refusing a non-absolute anchor ${JSON.stringify(dir)} for platform ${platform}`);
  }
  return dir;
}

/**
 * The durable shim the task actually runs.
 *
 * 🔑 IT RESOLVES THE ENGINE AT RUN TIME, NEVER AT REGISTER TIME. That indirection
 * is the entire point: the task command is fixed forever, and the pointer beside
 * this file decides which app it runs. Held as a string constant rather than
 * copied from a source file because it must not acquire a dependency -- anything
 * it required would have to be anchored too, and the anchor would grow into a
 * second copy of the engine.
 *
 * ⚠️ IT EXITS NON-ZERO WITH A SENTENCE when the pointer is stale. A shim that
 * exited 0 on a missing engine would look to Task Scheduler like an agent that
 * ran and finished, which is the one reading that hides a dead fleet.
 */
const BOOT_JS = [
  "'use strict';",
  '/* Written by engine/win32anchor.js. Do not edit: it is rewritten on every job',
  '   install. It reads the pointer beside it and runs THAT engine\'s supervisor,',
  '   so an app that moved does not strand a registered task. */',
  "const fs = require('node:fs');",
  "const path = require('node:path');",
  'const pointer = path.join(__dirname, ' + JSON.stringify(POINTER_NAME) + ');',
  "let engine = '';",
  "try { engine = String(fs.readFileSync(pointer, 'utf8')).trim(); } catch {}",
  'if (!engine) {',
  "  process.stderr.write('kosmos: no engine pointer beside ' + __dirname + '\\n');",
  '  process.exit(3);',
  '}',
  "const entry = path.join(engine, 'win32supervisor.js');",
  'if (!fs.existsSync(entry)) {',
  "  process.stderr.write('kosmos: the app this agent was registered against is gone (' + entry + ')\\n');",
  '  process.exit(3);',
  '}',
  '/* #1704: the agent\'s Kosmos rides on the task line (win32argv, field 7). Its',
  '   roots must be in the environment BEFORE the supervisor loads anything that',
  '   freezes the store root, or it would read the default world\'s store. A',
  '   default-world task on an engine too old to know about worlds is left alone;',
  '   a NAMED-world one refuses, because that engine would run it silently in the',
  '   default world. (Field 7 is checked by hand only for that case: without',
  '   win32argv.js there is no parser to ask.) */',
  'const args = process.argv.slice(2);',
  "const argvAt = path.join(engine, 'win32argv.js');",
  "const worldsAt = path.join(engine, 'worlds.js');",
  "const namedWorld = typeof args[6] === 'string' && args[6] !== '' && args[6] !== '-';",
  'if (namedWorld && !(fs.existsSync(argvAt) && fs.existsSync(worldsAt))) {',
  "  process.stderr.write('kosmos: this agent belongs to Kosmos ' + JSON.stringify(args[6]) + ', and the app it points at is too old to run it there (' + engine + ')\\n');",
  '  process.exit(3);',
  '}',
  'if (namedWorld) {',
  '  const world = require(argvAt).specFromArgv(args).world;',
  '  process.env[' + JSON.stringify(launchidentity.WORLD_ENV_VAR) + '] = world;',
  '  try { require(worldsAt).applyAgentWorldEnv(process.env); }',
  "  catch (e) { process.stderr.write('kosmos: this agent could not enter its Kosmos ' + JSON.stringify(world) + ' (' + ((e && e.message) || e) + ')\\n'); process.exit(3); }",
  '}',
  'require(entry).main(args);',
  '',
].join('\n');

/**
 * The anchor's rule for "would copying `srcNode` over `nodeAt` change the interpreter": the sizes
 * differ, or either file cannot be read. Size alone, for the reason ensureAnchored gives (a
 * released node.exe changes size between versions, and hashing 92 MB on every agent create is not
 * worth it). engine/win32update.js's runtimeChanged starts from this same rule and adds a sha-256
 * only for the equal-size case, so the two can disagree only in the direction of the updater
 * swapping in an interpreter the anchor would have kept.
 */
function interpreterSizeDiffers(srcNode, nodeAt) {
  try { return fs.statSync(nodeAt).size !== fs.statSync(srcNode).size; } catch { return true; }
}

/**
 * Put the anchor in place, and answer with the paths a task should be built from.
 *
 * Returns { ok, node, boot, dir, pointer } or { ok:false, because } -- never
 * throws, so a caller can refuse a job with a sentence instead of unwinding.
 */
function ensureAnchored(opts) {
  const o = opts || {};
  const platform = o.platform || process.platform;
  const home = o.home || os.homedir();
  const env = o.env || process.env;
  const srcNode = o.node || process.execPath;
  const engineDir = o.engineDir || __dirname;
  /* The clock side files are stamped and aged by. `o.now` is injectable so a
     test can age them without sleeping: it sets where the clock starts, and it
     still advances in real time from there. */
  const startedAt = Date.now();
  const clock = () => (typeof o.now === 'number' ? o.now : startedAt) + (Date.now() - startedAt);

  let dir;
  try {
    dir = anchorDir(platform, home, env);
  } catch (e) {
    return { ok: false, because: 'we could not work out where to keep the startup files (' + (e && e.message) + ')' };
  }

  const nodeAt = path.join(dir, NODE_NAME);
  const pointerAt = path.join(dir, POINTER_NAME);
  const bootAt = path.join(dir, BOOT_NAME);

  try {
    fs.mkdirSync(dir, { recursive: true });

    /* 🔑 COPY ONLY WHEN IT WOULD DIFFER. This runs on every job install and the
       file is 92 MB; re-copying each time would make creating an agent feel
       broken. Size is the cheap discriminator and it is sufficient here: the
       source is a released node.exe, so a version change moves the size. An equal
       size over a corrupt copy is a case this does not detect, and the remedy is
       deleting the anchored node.exe once the fleet is stopped (Windows refuses
       while it runs) -- noted rather than defended against by hashing 92 MB on
       every create.

       ⚠️ AND NEVER WHEN THE SOURCE IS ALREADY THE ANCHOR. A supervisor started by
       the task runs the anchored node, so `process.execPath` IS `nodeAt` --
       copying a file onto itself truncates it, which would destroy the fleet's
       interpreter from inside the process running on it. Compared
       case-insensitively because Windows paths are. */
    if (path.resolve(srcNode).toLowerCase() !== path.resolve(nodeAt).toLowerCase()) {
      if (interpreterSizeDiffers(srcNode, nodeAt)) win32swap.replaceInterpreter(srcNode, nodeAt, clock);
    }
    win32swap.retireLeftoverInterpreters(nodeAt, clock);

    /* The pointer and the shim are small and rewritten unconditionally: this is
       how an app that moved takes effect, and it is the cheap half.
       🛑 THE POINTER IS REPLACED ATOMICALLY. Every boot shim reads it at logon,
       and a plain write truncates it first: a crash in between left it empty,
       and the board and every agent then exited 3 at the next logon. A reader
       now sees the old engine or the new one, complete. */
    win32swap.writeFileAtomic(pointerAt, String(engineDir));
    /* The shim too: every agent's task runs it at logon, and a torn one is a
       syntax error there, which stops every agent exactly as a torn pointer does. */
    win32swap.writeFileAtomic(bootAt, BOOT_JS);
  } catch (e) {
    return { ok: false, because: 'we could not set up the files an agent needs to start at login (' + (e && e.message) + ')' };
  }

  return { ok: true, node: nodeAt, boot: bootAt, dir, pointer: pointerAt };
}

/** Where the anchor thinks the engine is, or null. Read for diagnosis. */
function readPointer(platform, home, env) {
  try {
    const at = path.join(anchorDir(platform, home, env), POINTER_NAME);
    const v = String(fs.readFileSync(at, 'utf8')).trim();
    return v || null;
  } catch { return null; }
}

module.exports = {
  APP, NODE_NAME, POINTER_NAME, BOOT_NAME, BOOT_JS, STAGED_INFIX, RETIRED_INFIX,
  RETIRED_SWEEP_MIN_AGE_MS,
  anchorDir, ensureAnchored, readPointer, interpreterSizeDiffers,
};
