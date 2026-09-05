'use strict';
/**
 * The created-never-run roster source (#1078): Kosmos agents that exist on this
 * computer -- a launchd job + a worker dir -- but have NEVER RUN, so they have
 * no tmux pane and no self-report beat, and were invisible to the board. The
 * empty state (`boardEmpty()`) then told a person holding unrun agents to
 * "create your first".
 *
 * 🔑 THE ROSTER ANALOG OF THE win32 OWNERSHIP RECORD (engine/win32sessions +
 * engine/win32roster, #2174/#570): list an agent because WE created it (a job we
 * wrote), never because a folder was parsed as one. An earlier fix for #1078
 * attempted the same detection through discover (a `found()`-based source), but
 * every consumer of `found()`/`/api/found-agents` filters `already !== true`
 * (they are ADOPT-external screens) and a Kosmos-created agent is `already:true`,
 * so those rows were correctly dropped -- that approach was merged-but-inert. The
 * BOARD empty state is driven by `status.snapshot()`, not `found()`, so the
 * created-never-run source belongs HERE, as a third roster source `snapshot()`
 * merges, complementary to the two it already has:
 *   1. tmux `list-panes`      -- agents with a live pane.
 *   2. `status.panelessKeys`  -- token-known agents beating with no pane (the
 *                                win32/remote path). It requires a sender token
 *                                AND `liveness.alive()===true`.
 *   3. THIS                   -- a Kosmos job + worker dir on disk, no pane, no
 *                                live beat. Source (2) requires alive===true, so a
 *                                never-run agent (never alive) is correctly
 *                                excluded there; this is the gap it leaves.
 *
 * 🛑 THREE FAIL-CLOSED PROPERTIES, because this source ADMITS agents to the board
 * and the board must manage only ours:
 *   1. A KOSMOS-OWNED KEY. A row is produced only for a plist under
 *      `create.AGENTS_DIR` matching the `com.kosmos.agent.` prefix that
 *      `create.readJob` validates as a real Kosmos job (name charset + the
 *      ProgramArguments shape). A foreign or malformed plist returns null and is
 *      skipped. We list an agent because WE created it, never because a folder was
 *      parsed as one -- the "wrong list is used" danger the card names.
 *   2. THE WORKER DIR MUST EXIST. A job whose folder is gone is a stale leftover,
 *      not an agent to show; acting on it needs the folder.
 *   3. REMOVED AGENTS ARE SKIPPED, FAIL CLOSED. `remove()` deliberately LEAVES the
 *      plist and worker dir on disk (its Restore button depends on that), so a
 *      created-never-run-then-removed agent has EXACTLY this shape. We read
 *      `remove.removedNames()` (which surfaces an unreadable removed.json as
 *      `ok:false`) and return NOTHING on `!ok` rather than risk RESURRECTING a
 *      removed agent onto the board -- remove.js's own doctrine that a caller about
 *      to ACT must get the failure and refuse.
 *
 * ⚠️ The `status.sandboxIsInconsistent()` guard is kept (mirrors
 * discover.foundCodex): this reads `AGENTS_DIR` (launchd) via a non-configRoots
 * path, so a declared fixture that forgot the launch override could otherwise read
 * the real machine's LaunchAgents. In an inconsistent sandbox it returns nothing.
 *
 * ⚠️ Returns KEYS (safeKey'd names), not cards. `status.panelessCard` builds the
 * card from a key (identity + profile + reconciled report); listing keys keeps the
 * card shape in ONE place rather than growing a second card builder here -- the
 * two-definitions-of-the-fleet habit this file family exists to avoid.
 *
 * ⚠️ Plist enumeration is a launchd (Mac) concept, so this source is Mac-scoped.
 * The win32 never-run analog is a `win32sessions`-record source (a created agent
 * recorded but not yet in `claude agents --json`); a separate follow-up, not this.
 */
const fs = require('node:fs');

/**
 * Build the created-never-run roster source to hand to `status.setCreatedSource`.
 *
 * @param {object} [opts]
 * @param {object} [opts.create] the create module (default the real one),
 *   injectable for tests. Uses AGENTS_DIR, serviceLabel, readJob, workerDir,
 *   cleanName.
 * @param {object} [opts.remove] the remove module (default the real one). Uses
 *   removedNames.
 * @param {object} [opts.status] the status module (default the real one). Uses
 *   sandboxIsInconsistent.
 * @param {object} [opts.store] the store module (default the real one). Uses
 *   safeKey -- the board's dedup keyspace.
 * @param {typeof fs} [opts.fs] the fs module, injectable for tests.
 * @returns {(excludeKeys?: Set<string>) => string[]} a source: the safeKey'd names
 *   of Kosmos-created-never-run agents NOT already in `excludeKeys`. Never throws;
 *   returns [] on any read failure or in an inconsistent sandbox.
 */
function make(opts) {
  const o = opts || {};
  const fsMod = o.fs || fs;
  const create = o.create || require('./create');
  const remove = o.remove || require('./remove');
  const status = o.status || require('./status');
  const store = o.store || require('./store');
  return function createdRoster(excludeKeys) {
    // A failed look must refuse honestly, exactly like the discover sources. Every
    // external read here is wrapped so the "never throws -> []" contract in the
    // docblock is TRUE for any caller, not merely because today's sole caller
    // (status.snapshot) happens to wrap it -- and a throw returns [] (fail closed:
    // no created rows), the same safe direction as the guards below.
    let inconsistent;
    try { inconsistent = status.sandboxIsInconsistent(); } catch { return []; }
    if (inconsistent) return [];
    // FAIL CLOSED: an unreadable removed list surfaces nothing rather than risk
    // resurrecting a removed agent onto the board.
    let removed;
    try { removed = remove.removedNames(); } catch { return []; }
    if (!removed || !removed.ok) return [];
    // Normalize both sides with create.cleanName -- the SAME transform remove.js keys
    // its own record under (recordRemoval stores cleanName(name); isRemoved compares
    // cleanName(name)), so this skip matches remove.js's own notion of "removed". The
    // plist name is a slugFor slug and cleanName leaves a slug unchanged, so the two
    // sides align today; the invariant to preserve is that cleanName stays the shared
    // key with remove.js, NOT that it equals slugFor.
    const removedSet = new Set(removed.names.map((n) => create.cleanName(n)));
    const exclude = excludeKeys instanceof Set ? excludeKeys : new Set();
    let files;
    try { files = fsMod.readdirSync(create.AGENTS_DIR); } catch { return []; }
    const PREFIX = create.serviceLabel('');   // "com.kosmos.agent."
    const SUFFIX = '.plist';
    const seen = new Set();
    const out = [];
    for (const f of files) {
      if (!f.startsWith(PREFIX) || !f.endsWith(SUFFIX)) continue;
      const name = f.slice(PREFIX.length, f.length - SUFFIX.length);
      // readJob validates the plist is a real Kosmos job; a foreign/malformed
      // plist under the prefix returns null and is not one of ours.
      let job = null;
      try { job = create.readJob(name); } catch { job = null; }
      if (!job) continue;
      if (removedSet.has(create.cleanName(name))) continue;   // explicitly removed
      // The worker dir must exist: a job whose folder is gone is a stale leftover.
      let there = false;
      try { there = fsMod.statSync(create.workerDir(name)).isDirectory(); } catch { there = false; }
      if (!there) continue;
      // safeKey is the board's dedup keyspace (paneKeys and panelessKeys both live
      // in it). An invalid name cannot be keyed and so cannot be on the board.
      let key;
      try { key = store.safeKey(name); } catch { continue; }
      if (exclude.has(key) || seen.has(key)) continue;   // a live pane/beat wins; no dupes within this source
      seen.add(key);
      out.push(key);
    }
    return out;
  };
}

module.exports = { make };
