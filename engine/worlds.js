'use strict';
/*
 * #1704: multiple Kosmos "worlds" on one install. A world is a self-contained
 * workspace with its own store data, projects, and workers. Today there is
 * exactly one, implicit, living at the legacy roots (store.dataRootFor,
 * projectsRoot, workersDir). This module adds a REGISTRY + create + switch-active,
 * and computes the per-world AGENT_WORKFORCE_* env overrides that the existing
 * per-call root functions already read -- so a world switch needs no edits to the
 * ~8 modules that resolve roots.
 *
 * 🛑 THE RELEASE GATE: an existing single-Kosmos install MUST survive untouched.
 * This is guaranteed structurally, not by care:
 *   - An install with NO worlds.json is the single DEFAULT world (readRegistry
 *     synthesizes it). Existing installs have no registry, so they are the default.
 *   - The default world sets NO env overrides (envOverridesFor returns {}), so
 *     every root resolves EXACTLY as today. No data is ever moved, renamed, or
 *     re-indexed -- the one dangerous operation is simply never performed.
 * A malformed or unreadable registry FAILS SAFE to the default world, so a broken
 * file can never lock an install out of its own data.
 *
 * SCOPE (v1, this module): the DATA layer -- the registry and the store/projects/
 * workers roots. The agent-process layer (launchd services, AGENT_WORKFORCE_LAUNCH)
 * is a shared system resource that a switch must stop-and-relaunch; that lifecycle
 * rides the board restart on switch (a later slice), so this module does NOT
 * override AGENT_WORKFORCE_LAUNCH -- named-world agents are out of v1 scope and
 * the default world (the only one that runs agents in v1) keeps the legacy path.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store'); // dataRootFor, safeKey

const DEFAULT_ID = 'default';
// #1704 item 14.2 (Josh, 2026-09-05): the first/default world is called "Kosmos 1"
// so a person understands it is the first one, sitting alongside "Add a new Kosmos".
// This is a display constant, not user data: the default world's id stays 'default'
// and its data still lives at the legacy roots (base:null), so the label change moves
// nothing and renames nothing. readRegistry re-applies it to a persisted default entry
// too, so every install shows it -- not only fresh ones (the DEFAULT_ID name-force in
// readRegistry, below).
const DEFAULT_NAME = 'Kosmos 1';
const REGISTRY_FILE = 'worlds.json';
const WORLDS_SUBDIR = 'worlds';
/* The character class store.safeKey produces. A world id must match this to be a
   safe path component; readRegistry enforces it on the READ path (see below). */
const CLEAN_ID = /^[a-z0-9_-]+$/;

/*
 * The base store root, resolved from the ORIGINAL env. The registry and every
 * named world hang off this, so it MUST be captured before applyActiveWorldEnv
 * sets any AGENT_WORKFORCE_DATA override (otherwise the base would move with the
 * active world). Callers at board startup capture it once, up front.
 */
function baseRoot(env, platform, home) {
  const e = env || process.env;
  return store.dataRootFor(
    platform || process.platform,
    home || e.AGENT_WORKFORCE_HOME || os.homedir(),
    e
  );
}

function registryPath(base) { return path.join(base, REGISTRY_FILE); }

/* The implicit default world -- what an install with no registry IS. `base:null`
   is the signal for "legacy roots, no override": the migration state where the
   default world reads the existing data in place and nothing moves. */
function defaultWorld() {
  return { id: DEFAULT_ID, name: DEFAULT_NAME, createdAt: null, base: null };
}

function synthDefaultRegistry() {
  return { version: 1, activeWorldId: DEFAULT_ID, worlds: [defaultWorld()] };
}

/*
 * Read the registry, or synthesize the single-default registry when absent or
 * unusable. Every failure path returns the default so an install is never locked
 * out of its data. Also self-heals two invariants a hand-edited or partial file
 * could violate: the default world must always be present (dropping it would
 * orphan the legacy data), and activeWorldId must name a world that exists.
 */
function readRegistry(base) {
  let raw;
  try { raw = fs.readFileSync(registryPath(base), 'utf8'); }
  catch { return synthDefaultRegistry(); }
  let obj;
  try { obj = JSON.parse(raw); } catch { return synthDefaultRegistry(); }
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.worlds) || obj.worlds.length === 0) {
    return synthDefaultRegistry();
  }
  // Keep only entries whose id is a clean safeKey id. This is a TRAVERSAL GUARD on
  // the READ path: safeKey runs on the WRITE path (createWorld), but a hand-edited
  // or corrupt worlds.json carrying an id like "../../evil" must not be trusted --
  // it would otherwise flow through worldBaseDir into path.join(base,'worlds',id)
  // and escape the store into AGENT_WORKFORCE_DATA/PROJECTS/WORKERS. Dropping a
  // malformed entry orphans its dir (files on disk, no data loss); honoring a
  // traversal is the worse failure. The default must still survive (re-added below).
  const worlds = obj.worlds.filter((w) => w && typeof w.id === 'string' && CLEAN_ID.test(w.id));
  if (!worlds.some((w) => w.id === DEFAULT_ID)) worlds.unshift(defaultWorld());
  // The default world's name is a display constant (DEFAULT_NAME), never user-editable
  // -- the id 'default' is reserved and there is no rename path for it. A registry
  // persisted before item 14.2 froze the old name into worlds.json (createWorld writes
  // the whole registry, default entry included), so force it here rather than leave two
  // installs disagreeing about what the same default world is called.
  for (const w of worlds) if (w.id === DEFAULT_ID) w.name = DEFAULT_NAME;
  let activeWorldId = typeof obj.activeWorldId === 'string' ? obj.activeWorldId : DEFAULT_ID;
  if (!worlds.some((w) => w.id === activeWorldId)) activeWorldId = DEFAULT_ID;
  // The schema is v1 today; a future v2 migration would branch on obj.version here.
  return { version: 1, activeWorldId, worlds };
}

/* Atomic publish: write to a temp in the same dir, then rename over the target,
   so a concurrent reader sees the old file or the new one, never a partial. */
function writeRegistry(base, reg) {
  fs.mkdirSync(base, { recursive: true });
  const tmp = path.join(base, `.${REGISTRY_FILE}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n');
  fs.renameSync(tmp, registryPath(base));
}

function listWorlds(base) { return readRegistry(base).worlds; }

function activeWorld(base) {
  const reg = readRegistry(base);
  return reg.worlds.find((w) => w.id === reg.activeWorldId) || defaultWorld();
}

/* The on-disk base of a world's subtrees. null (no override) for the default
   world -- its data lives at the legacy roots. Named worlds nest under
   <base>/worlds/<id>/. Resolution is BY ID, deliberately: a world's location is
   derived from its id, never read from the stored `base` field (which is
   informational only, see createWorld), so a hand-edited `base` cannot relocate a
   world. Path safety rests on the ID being a clean safeKey id -- guaranteed on the
   write path (createWorld) AND re-enforced on the read path (readRegistry's
   CLEAN_ID filter), so a traversing id from a hand-edited registry is dropped
   before it ever reaches this join. */
function worldBaseDir(base, world) {
  if (!world || world.id === DEFAULT_ID) return null;
  // The guard travels WITH the join (#1798: guard the result, not each caller).
  // readRegistry already drops non-clean ids, so this only fires if a caller hands
  // in a world from some other source (a request body, a cached pre-filter object);
  // it throws rather than joining an unsafe id into a path that escapes the store.
  if (!CLEAN_ID.test(world.id)) throw new Error(`unsafe world id ${JSON.stringify(world.id)}`);
  return path.join(base, WORLDS_SUBDIR, world.id);
}

/*
 * The AGENT_WORKFORCE_* env overrides for a world. EMPTY for the default world
 * (the migration guarantee -- legacy roots, untouched). For a named world, the
 * three data roots point under its base, matching each root function's own
 * semantics: AGENT_WORKFORCE_DATA has the store leaf (`store.APP`, `Kosmos`
 * since #2439) appended by dataRootFor, while AGENT_WORKFORCE_PROJECTS /
 * _WORKERS are used verbatim.
 * AGENT_WORKFORCE_LAUNCH is deliberately NOT overridden (see SCOPE above).
 */
function envOverridesFor(base, world) {
  const dir = worldBaseDir(base, world);
  if (!dir) return {};
  return {
    AGENT_WORKFORCE_DATA: dir, // dataRootFor appends store.APP -> <dir>/Kosmos (#2439)
    AGENT_WORKFORCE_PROJECTS: path.join(dir, 'projects'),
    AGENT_WORKFORCE_WORKERS: path.join(dir, 'workers'),
  };
}

/*
 * Create a new world. The name is sanitized into an id with store.safeKey (the
 * same untrusted-name posture the store and create.js use, so a name can never
 * traverse out of its base). Refuses a duplicate id (which also catches two names
 * that map to the same safeKey id, e.g. "Acme" and "acme"). Makes the world's
 * subtrees, appends to the registry, persists.
 * Does NOT switch to it -- switching is an explicit, separate act. Returns the
 * new world entry.
 */
/*
 * A fail-fast, cross-process lock around the registry read-modify-write (#1704
 * slice 2). createWorld/setActiveWorld each read the registry, modify it, and write
 * it back; two boards on one machine doing that at once would lost-update (both read
 * the same file, both rename, last writer wins, the other's entry silently dropped
 * with its dir orphaned). mkdir is atomic on POSIX, so it is the lock. This does NOT
 * spin or block the event loop: the critical section is sub-millisecond, so on the
 * vanishingly rare live collision it throws a retryable "in progress" error rather
 * than waiting. A stale lock (a crashed holder, mtime older than 10s) is broken. A
 * within-board race cannot happen: createWorld/setActiveWorld are synchronous, so
 * Node's single thread already serializes them inside one process.
 */
const REGISTRY_LOCK_STALE_MS = 10000;
/* The retryable "someone else holds the registry lock" error. Typed with a code
   so a caller can classify it as a transient/retry condition WITHOUT matching the
   message text (which is a person-facing string free to change). */
function worldLockBusyError() {
  const err = new Error('another Kosmos operation is in progress, try again in a moment');
  err.code = 'EWORLDLOCK';
  return err;
}
function withRegistryLock(base, fn) {
  fs.mkdirSync(base, { recursive: true });
  const lockDir = path.join(base, `.${REGISTRY_FILE}.lock`);
  let held = false;
  try {
    try {
      fs.mkdirSync(lockDir);
      held = true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try { stale = Date.now() - fs.statSync(lockDir).mtimeMs > REGISTRY_LOCK_STALE_MS; }
      catch (_e) { stale = true; } // the holder vanished between EEXIST and stat
      if (!stale) throw worldLockBusyError();
      try { fs.rmdirSync(lockDir); } catch (_e) { /* someone else broke it first */ }
      /* Break-and-acquire. If this mkdir throws EEXIST (another board re-took the
         broken lock first), the outer catch turns it into the retryable error.
         RESIDUAL WINDOW (accepted): if two boards BOTH judged the lock stale, one
         can rmdir the OTHER's freshly-acquired lock and both then run fn -> a
         lost-update. It needs a crashed prior holder AND a sub-millisecond
         two-board collision, so it is vanishingly rare at this single-board-per-
         install app's scale; a token-in-the-lock ("only break a lock whose token
         is unchanged, verify mine after acquiring") is the robust fix if
         multi-board contention ever becomes real. */
      fs.mkdirSync(lockDir);
      held = true;
    }
    return fn();
  } catch (e) {
    if (e && e.code === 'EEXIST') throw worldLockBusyError();
    throw e;
  } finally {
    if (held) { try { fs.rmdirSync(lockDir); } catch (_e) { /* best effort */ } }
  }
}

function createWorld(base, name) {
  const id = store.safeKey(name); // throws on an empty/invalid name
  if (id === DEFAULT_ID) throw new Error(`world id "${DEFAULT_ID}" is reserved`);
  return withRegistryLock(base, () => {
    const reg = readRegistry(base);
    if (reg.worlds.some((w) => w.id === id)) throw new Error(`a world "${id}" already exists`);
    const dir = path.join(base, WORLDS_SUBDIR, id);
    // Make the world's subtrees up front so a switch never lands on a missing dir.
    // #2439: the store leaf MUST match what dataRootFor appends for this world
    // (envOverridesFor sets AGENT_WORKFORCE_DATA=dir -> dataRootFor -> <dir>/store.APP),
    // so derive it from store.APP rather than hardcoding, or create and read drift.
    fs.mkdirSync(path.join(dir, store.APP), { recursive: true });
    fs.mkdirSync(path.join(dir, 'projects'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'workers'), { recursive: true });
    // `base` is INFORMATIONAL (what worldBaseDir derives from the id); it is never
    // read for resolution, so it cannot be a relocation or traversal seam.
    const world = { id, name: String(name), createdAt: new Date().toISOString(), base: path.join(WORLDS_SUBDIR, id) };
    reg.worlds.push(world);
    writeRegistry(base, reg);
    return world;
  });
}

/*
 * Set the active world. Validates the id names a real world (refusing an unknown
 * id rather than silently defaulting -- an unknown id here is a caller bug, not a
 * broken file). Persists the pointer. Does NOT itself re-resolve roots or move
 * processes: the caller (board) applies the new world's env and restarts, because
 * open state (conversations, watchers, agent processes) belongs to the old world.
 */
function setActiveWorld(base, id) {
  return withRegistryLock(base, () => {
    const reg = readRegistry(base);
    if (!reg.worlds.some((w) => w.id === id)) {
      // Typed so a caller (e.g. the /api/worlds/active route) can classify this
      // as not-found WITHOUT matching on the message text -- the message is for a
      // person and is free to change; the code is the contract.
      const err = new Error(`no such world "${id}"`);
      err.code = 'ENOWORLD';
      throw err;
    }
    reg.activeWorldId = id;
    writeRegistry(base, reg);
    // #2528: a deliberate switch to a world gives it a FRESH set of boot attempts.
    // Clear any residual failed-boot count so a retry (after fixing what was wrong, or a
    // switch-back following an auto-fallback) is judged on new tries, never stale ones.
    // Inline require avoids any load-order coupling; worldbootguard pulls in only fs/path.
    // #2528 fast-follow note: the abandon-on-first-failed-boot fast path keys on whether the
    // world has EVER served (the guard's `confirmed` marker, set by server.js onListening),
    // NOT on this switch -- so setActiveWorld deliberately does NO pending bookkeeping here.
    // That avoids the pointer-vs-booted divergence a switch-time marker would have (a no-op
    // or unmanaged-board switch-back must never re-arm the fast path on a healthy world).
    try { require('./worldbootguard').clear(base, id); } catch (_) { /* fail-open */ }
    return activeWorld(base);
  });
}

/*
 * #1704 item 14.1 (Josh, 2026-09-05): rename a Kosmos WITHOUT breaking its
 * file/folder/project/document structure. It changes ONLY the display `name`; the
 * world's id and base are immutable (a world resolves BY id, never by name -- see
 * worldBaseDir), so nothing on disk moves and every project/document keeps its home.
 * That is the whole reason the rename is safe and does not need the fallback Josh
 * offered ("you can't change the name once created").
 *
 * The DEFAULT world is refused: its display name is the fixed "Kosmos 1" constant
 * (item 14.2 / DEFAULT_NAME, re-applied by readRegistry), so a rename could not
 * persist anyway; refusing gives a clear reason instead of a silent no-op. Errors are
 * TYPED (like setActiveWorld) so the route classifies on the code, not the message.
 */
function renameWorld(base, id, newName) {
  if (id === DEFAULT_ID) {
    const err = new Error('the default world cannot be renamed');
    err.code = 'ERESERVED';
    throw err;
  }
  const name = String(newName == null ? '' : newName).trim();
  if (!name) {
    const err = new Error('a world needs a name');
    err.code = 'EBADNAME';
    throw err;
  }
  return withRegistryLock(base, () => {
    const reg = readRegistry(base);
    const world = reg.worlds.find((w) => w.id === id);
    if (!world) {
      const err = new Error(`no such world "${id}"`);
      err.code = 'ENOWORLD';
      throw err;
    }
    world.name = name;
    writeRegistry(base, reg);
    return world;
  });
}

/*
 * At board startup: mutate `env` in place so the active world's roots resolve for
 * the rest of the process. A no-op for the default world (no overrides). Returns
 * the applied overrides (empty for default) so a caller can log what it did.
 * MUST be called before any module resolves a root (roots are per-call, #1443, so
 * "before the first read" is enough; the board calls this at the very top of
 * start()). `base` is the pre-override base the caller captured up front.
 */
function applyActiveWorldEnv(env, base) {
  const e = env || process.env;
  const overrides = envOverridesFor(base, activeWorld(base));
  for (const k of Object.keys(overrides)) e[k] = overrides[k];
  return overrides;
}

/*
 * #2563 (add-agents-from-an-existing-Kosmos, engine slice). The STORE root of a
 * world -- where its profiles/avatars live. The DEFAULT world's store IS `base`
 * (the legacy roots, base:null); a NAMED world's store nests at
 * <worldBaseDir>/<store.APP>, matching exactly the leaf createWorld lays down
 * (`fs.mkdirSync(path.join(dir, store.APP))`) and what dataRootFor appends under
 * the world's AGENT_WORKFORCE_DATA override. Derived by id via worldBaseDir, so a
 * hand-passed id is CLEAN_ID-guarded before it reaches a path join.
 */
function worldStoreRoot(base, world) {
  const dir = worldBaseDir(base, world); // null for the default world; guarded for named
  return dir ? path.join(dir, store.APP) : base;
}

function worldProfilesDir(base, world) {
  return path.join(worldStoreRoot(base, world), 'profiles');
}

/*
 * How many agents a world holds: the count of profile JSONs under its store. A
 * profile is <safeKey(name)>.json; the store writes a `<name>.json.tmp` mid-write,
 * which `.endsWith('.json')` correctly excludes (it ends with .tmp). Read-only and
 * total: a missing or unreadable profiles dir is 0 agents, never a throw -- a world
 * that has never held an agent has no profiles dir, and that is zero, not an error.
 */
function agentCount(base, world) {
  let entries;
  try { entries = fs.readdirSync(worldProfilesDir(base, world)); }
  catch { return 0; }
  return entries.filter((f) => f.endsWith('.json')).length;
}

/*
 * Copy the agents (profiles) of one or more SOURCE worlds into a TARGET world's
 * profiles dir. COPY, never move: a source file is read and never modified, renamed
 * or deleted (Angel's ruled copy-not-move default, kosmos#2563). Semantics:
 *   - A source id is honored only if it names a real registered world; an unknown
 *     or malformed id is counted in `unknownSources` and skipped, never joined into
 *     a path (worldBaseDir re-guards CLEAN_ID regardless).
 *   - FIRST-WINS on collision: a profile whose filename already exists in the target
 *     (because the target already holds it, or an earlier source in the list supplied
 *     it) is left untouched and counted in `skipped`. Source order is the tiebreak.
 *   - Each copy is temp-file + rename, so a concurrent reader of the target never
 *     sees a half-written profile.
 * Returns { copied, skipped, unknownSources }. Does NOT make the imported agents run
 * (named-world agents are out of v1 launch scope, worlds.js SCOPE note) -- it brings
 * the roster/config across; running follows the world-scoped-launch slice.
 */
function importAgents(base, targetWorld, sourceWorldIds) {
  const result = { copied: 0, skipped: 0, unknownSources: 0 };
  if (!targetWorld || !Array.isArray(sourceWorldIds) || sourceWorldIds.length === 0) return result;
  const reg = readRegistry(base);
  const targetDir = worldProfilesDir(base, targetWorld);
  fs.mkdirSync(targetDir, { recursive: true });
  for (const rawId of sourceWorldIds) {
    const src = reg.worlds.find((w) => w.id === rawId);
    if (!src || src.id === targetWorld.id) {
      // Unknown/malformed id -> count it; importing a world from itself is a no-op we
      // do not count as unknown (the id is real), just skip it.
      if (!src) result.unknownSources += 1;
      continue;
    }
    const srcDir = worldProfilesDir(base, src);
    let files;
    try { files = fs.readdirSync(srcDir).filter((f) => f.endsWith('.json')); }
    catch { files = []; } // a source with no profiles dir contributes nothing, not an error
    for (const file of files) {
      const dst = path.join(targetDir, file);
      if (fs.existsSync(dst)) { result.skipped += 1; continue; } // first-wins
      const tmp = dst + `.${process.pid}.tmp`;
      try {
        // A profile copied into a NEW Kosmos is a SEPARATE agent, so strip the
        // identity fields (id/idInstall). store.writeProfile mints a FRESH id on the
        // imported agent's first write when id is absent -- the decided restore
        // convention ("a restored agent is a separate agent with its own fresh id",
        // store.js:404). A byte copy would carry the source id over, and because the
        // import is same-install, store's remint-on-different-install rule would NOT
        // fire, silently conflating the two agents to any future id-based feature.
        // Reading + re-serializing also means a corrupt (unparseable) source profile
        // is skipped rather than copied verbatim.
        const prof = JSON.parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));
        delete prof.id;
        delete prof.idInstall;
        fs.writeFileSync(tmp, JSON.stringify(prof, null, 2));
        fs.renameSync(tmp, dst);
        result.copied += 1;
      } catch (_e) {
        try { fs.unlinkSync(tmp); } catch (_u) { /* best effort */ }
        // A single unreadable/corrupt/unwritable profile must not abort the whole
        // import or orphan the created world; skip it and keep going.
        result.skipped += 1;
      }
    }
  }
  return result;
}

module.exports = {
  DEFAULT_ID,
  baseRoot,
  registryPath,
  defaultWorld,
  readRegistry,
  writeRegistry,
  listWorlds,
  activeWorld,
  worldBaseDir,
  envOverridesFor,
  createWorld,
  renameWorld,
  setActiveWorld,
  applyActiveWorldEnv,
  worldStoreRoot,
  worldProfilesDir,
  agentCount,
  importAgents,
};
