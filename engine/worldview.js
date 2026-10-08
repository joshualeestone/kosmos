'use strict';

/**
 * #5393: one view across worlds. For every Kosmos on this computer, how many tasks nobody is on, and for the
 * Kosmos this board is running, each provider's state.
 *
 * 🔑 TASKS ARE READ FROM DISK, PER WORLD, AND ONLY READ. A board serves one world at a time (#1704), so another
 * world has no board to ask. Its projects sit in its own projects.json, under worlds.worldStoreRoot, so this
 * reads that file directly. It never goes through projects.readAll(): that sets the flag (LAST_READ_OK) that
 * gates every projects write in the world this board is running, and a read of ANOTHER world's file must not be
 * able to switch writes off here. An unreadable or damaged file is said, never counted as zero.
 *
 * 🔑 "NOBODY IS ON IT": open, no part given to anyone (a finished part's person counts, as on the board's columns
 * and in the Assigner: tasks.whoOf, so a half-done task is in that person's column, not here), not marked built, in a live (not archived) project. Of
 * those, a task on hold or in a paused project is `held`; the rest are `waiting`. This is wider than what the
 * Assigner hands out (engine/assigner.js pick also skips webhook tasks, tasks with no number, and projects
 * with no agents or a paused swarm): those tasks still have nobody on them, so they are counted as waiting.
 *
 * 🔑 PROVIDER STATE IS ONLY KNOWN FOR THE WORLD THIS BOARD IS RUNNING. It comes from the live agent cards. A
 * world that is not open has no cards, so its providers are reported as not known, never guessed.
 *
 * ⚠️ NO QUOTA FIGURE. No provider tells Kosmos how much is left, so nothing here reports a remaining amount.
 * A paused provider carries the time it resumes only when a card states one (quotaUntil / poolUntil, which
 * today only Antigravity sets), and only when EVERY paused agent on it states one: one agent with no stated time
 * makes `until` null, meaning "paused, reset time not known", because a provider-wide time would be wrong for it.
 *
 * A time already past is not a resume time either: an agent whose only stated time has passed counts as stating
 * none, so `until` is only ever a future time that every paused agent on the provider has stated (the latest).
 *
 * ⚠️ AN AGENT WITH NO KNOWN PROVIDER IS SAID, NOT DROPPED. A paneless card (every Windows and remote agent) carries
 * no runner, so it cannot go in a provider row; `agentsWithoutProvider` on the running world's row counts the ones
 * not stopped, so a fleet of them never reads as "no providers, nothing paused".
 *
 * ⚠️ A DEAD SIGN-IN IS NOT A PAUSE. `signInFailed` counts the agents whose card reads auth_failed, so a provider
 * whose every agent lost its sign-in still says so beside 'not_paused'. A STOPPED AGENT IS NOT ON THE PROVIDER:
 * stopped cards are counted in `stopped`, never in `agents`, and a provider with only stopped agents reads
 * 'stopped'.
 */

const fs = require('node:fs');
const path = require('node:path');
const worlds = require('./worlds');
const tasks = require('./tasks');

const PROJECTS_FILE = 'projects.json';

/* Count the tasks nobody is on, in records already read. Pure. */
function unassignedIn(records) {
  let waiting = 0;
  let held = 0;
  for (const p of Array.isArray(records) ? records : []) {
    if (!p || typeof p !== 'object' || p.archived === true) continue;
    const paused = p.paused === true;
    for (const t of Array.isArray(p.tasks) ? p.tasks : []) {
      if (!t || typeof t !== 'object') continue;
      if (tasks.progressOf(t).closed || tasks.whoOf(t).length || t.builtAt) continue;
      if (paused || tasks.isOnHold(t)) held += 1;
      else waiting += 1;
    }
  }
  return { waiting, held };
}

/* Read one world's projects.json without touching the projects module's state. Absent is no projects (a world
   that never had one), which is a real zero; unreadable or not a list is said. */
function readProjectsAt(root) {
  let raw;
  try { raw = fs.readFileSync(path.join(root, PROJECTS_FILE), 'utf8'); }
  catch (err) {
    if (err && err.code === 'ENOENT') return { ok: true, records: [] };
    return { ok: false, because: 'we cannot read the projects in this Kosmos right now' };
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { ok: true, records: parsed };
  } catch { /* falls through to the damaged sentence */ }
  return { ok: false, because: 'the projects file in this Kosmos is there but we cannot make sense of it' };
}

/* Each provider's state from the running world's cards. Pure. Paneless cards carry no runner and are left out
   (they are not running on any provider). A provider is paused when every agent on it is rate limited; `paused`
   counts the agents that are. `until` is the latest stated resume time among its paused agents, and null when
   any paused agent states none. 'not_paused' says only that no card on it reads rate limited, never that its
   agents are working: an idle, unknown or signed-out card counts too, which is why `signInFailed` is beside it. */
function providersFrom(cards, now = Date.now()) {
  const by = new Map();
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || c.paneless === true || typeof c.runner !== 'string' || !c.runner) continue;
    const row = by.get(c.runner) || { provider: c.runner, agents: 0, stopped: 0, paused: 0, signInFailed: 0, until: null, untimed: 0 };
    if (c.state === 'stopped') { row.stopped += 1; by.set(c.runner, row); continue; }
    row.agents += 1;
    if (c.state === 'auth_failed') row.signInFailed += 1;
    if (c.state === 'rate_limited') {
      row.paused += 1;
      let stated = false;
      for (const at of [c.quotaUntil, c.poolUntil]) {
        if (typeof at !== 'string' || !Number.isFinite(Date.parse(at)) || Date.parse(at) <= now) continue;
        stated = true;
        if (row.until === null || Date.parse(at) > Date.parse(row.until)) row.until = at;
      }
      if (!stated) row.untimed += 1;
    }
    by.set(c.runner, row);
  }
  return [...by.values()]
    .map(({ untimed, ...r }) => ({ ...r, until: untimed > 0 ? null : r.until,
      state: r.agents === 0 ? 'stopped' : r.paused === 0 ? 'not_paused' : r.paused === r.agents ? 'paused' : 'some_paused' }))
    .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
}

/* How many live (not stopped) cards carry no runner, so cannot be placed under a provider. Pure. */
function withoutProvider(cards) {
  let n = 0;
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || c.state === 'stopped') continue;
    if (c.paneless === true || typeof c.runner !== 'string' || !c.runner) n += 1;
  }
  return n;
}

/* The whole view. `base` is the registry base (server.js worldBase()), `runningId` the world this board booted
   into, `cards` its live cards (null when they could not be read, which is said, never shown as no providers). */
function overview({ base, runningId, cards, now }) {
  return worlds.listWorlds(base).map((w) => {
    let count = null;
    let because = null;
    try {
      const read = readProjectsAt(worlds.worldStoreRoot(base, w));
      if (read.ok) count = unassignedIn(read.records);
      else because = read.because;
    } catch (_e) {
      because = 'we cannot read the projects in this Kosmos right now';
    }
    const running = w.id === runningId;
    return {
      id: w.id,
      name: w.name,
      running,
      unassigned: count,
      unassignedBecause: because,
      providers: running && Array.isArray(cards) ? providersFrom(cards, now === undefined ? Date.now() : now) : null,
      agentsWithoutProvider: running && Array.isArray(cards) ? withoutProvider(cards) : null,
      providersBecause: !running ? 'known only while this Kosmos is open'
        : Array.isArray(cards) ? null : 'we cannot read the agents in this Kosmos right now',
    };
  });
}

module.exports = { unassignedIn, readProjectsAt, providersFrom, overview, PROJECTS_FILE, withoutProvider };
