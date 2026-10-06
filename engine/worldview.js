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
 * 🔑 "NOBODY IS ON IT" IS THE ASSIGNER'S RULE (engine/assigner.js pick): open, no part given to anyone, not
 * marked built, in a live (not archived) project. Of those, a task on hold or in a paused project is `held`:
 * nothing hands it out until a person lifts the hold, so it is counted apart from the work that is `waiting`.
 *
 * 🔑 PROVIDER STATE IS ONLY KNOWN FOR THE WORLD THIS BOARD IS RUNNING. It comes from the live agent cards. A
 * world that is not open has no cards, so its providers are reported as not known, never guessed.
 *
 * ⚠️ NO QUOTA FIGURE. No provider tells Kosmos how much is left, so nothing here reports a remaining amount.
 * A paused provider carries the time it resumes only when a card states one (quotaUntil / poolUntil, which
 * today only Antigravity sets); otherwise `until` is null, meaning "paused, reset time not known".
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
   counts the agents that are. `until` is the latest stated resume time among its paused agents, or null.
   'not_paused' says only that no card on it reads rate limited, never that its agents are working: an idle or
   unknown card counts too. */
function providersFrom(cards) {
  const by = new Map();
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c || c.paneless === true || typeof c.runner !== 'string' || !c.runner) continue;
    const row = by.get(c.runner) || { provider: c.runner, agents: 0, paused: 0, until: null };
    row.agents += 1;
    if (c.state === 'rate_limited') {
      row.paused += 1;
      for (const at of [c.quotaUntil, c.poolUntil]) {
        if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) continue;
        if (row.until === null || Date.parse(at) > Date.parse(row.until)) row.until = at;
      }
    }
    by.set(c.runner, row);
  }
  return [...by.values()]
    .map((r) => ({ ...r, state: r.paused === 0 ? 'not_paused' : r.paused === r.agents ? 'paused' : 'some_paused' }))
    .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
}

/* The whole view. `base` is the registry base (server.js worldBase()), `runningId` the world this board booted
   into, `cards` its live cards (null when they could not be read, which is said, never shown as no providers). A world's read failing is said on that world's row and never stops the others. */
function overview({ base, runningId, cards }) {
  return worlds.listWorlds(base).map((w) => {
    const read = readProjectsAt(worlds.worldStoreRoot(base, w));
    const running = w.id === runningId;
    return {
      id: w.id,
      name: w.name,
      running,
      unassigned: read.ok ? unassignedIn(read.records) : null,
      unassignedBecause: read.ok ? null : read.because,
      providers: running && Array.isArray(cards) ? providersFrom(cards) : null,
      providersBecause: !running ? 'known only while this Kosmos is open'
        : Array.isArray(cards) ? null : 'we cannot read the agents in this Kosmos right now',
    };
  });
}

module.exports = { unassignedIn, readProjectsAt, providersFrom, overview, PROJECTS_FILE };
