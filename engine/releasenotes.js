'use strict';
/**
 * kosmos#7411: release notes an agent (or a person) can read for every version, and which fixes need a running agent
 * restarted. `kosmos whats-new [--since <version>] [--json]` prints them.
 *
 * The source is release/whats-new-pool.json, every highlight with the version it shipped in (`since`). The app does
 * NOT ship the pool itself: it also holds `held` items (features Josh held or dropped) and pending ones newer than a
 * build, which must not reach users. Each build writes app/release-notes.json with notesFor(pool, its version), and a
 * source checkout with no such file derives the same list from the pool (the same filter, so the two cannot differ).
 *
 * A pool item may carry `restart: "agents"`: a running agent keeps the old behaviour until it restarts (an instruction
 * section, a hook, its launch command). It is set beside the item's words, by whoever writes the fix.
 */
const fs = require('fs');
const path = require('path');

const RESTART = ['agents'];

function parseVersion(v) {
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The notes a build of `version` contains: every pool item not held, shipped at or before it, oldest first (rank
 *  within a version). Only the fields a reader needs; nothing about status, shownIn or rank leaves. */
function notesFor(pool, version) {
  if (!parseVersion(version)) throw new Error('not a version: ' + JSON.stringify(version));
  const items = (pool && Array.isArray(pool.items)) ? pool.items : [];
  return items
    .filter((it) => it && it.status !== 'held' && parseVersion(it.since) && compareVersions(it.since, version) <= 0)
    .sort((a, b) => compareVersions(a.since, b.since) || (a.rank - b.rank))
    .map((it) => {
      const n = { version: it.since, title: it.title, line: it.line || '' };
      if (Array.isArray(it.platforms) && it.platforms.length) n.platforms = it.platforms.slice();
      if (RESTART.includes(it.restart)) n.restart = it.restart;
      return n;
    });
}

/** The notes this install holds: app/release-notes.json when built, else derived from a source checkout's pool.
 *  `appRoot` is the folder holding engine/ (the installed app, or a checkout). Throws when neither is there. */
function readNotes(appRoot) {
  const built = path.join(appRoot, 'release-notes.json');
  if (fs.existsSync(built)) {
    const d = JSON.parse(fs.readFileSync(built, 'utf8'));
    if (!d || !Array.isArray(d.notes) || !parseVersion(d.version)) throw new Error(built + ' is not a release notes file');
    return d;
  }
  const pool = JSON.parse(fs.readFileSync(path.join(appRoot, 'release', 'whats-new-pool.json'), 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
  return { version, notes: notesFor(pool, version) };
}

/** The notes newer than `since` (all when `since` is empty). A `since` that is not a version is refused. */
function since(notes, sinceVersion) {
  if (!sinceVersion) return notes.slice();
  if (!parseVersion(sinceVersion)) throw new Error('--since needs a version like 0.7.60, not ' + JSON.stringify(sinceVersion));
  return notes.filter((n) => compareVersions(n.version, sinceVersion) > 0);
}

/** The text `kosmos whats-new` prints: one block per version, oldest first, a restart line where one is needed. */
function format(notes, installed) {
  if (!notes.length) return 'Nothing new to show for Kosmos ' + installed + '.\n';
  const out = [];
  let at = null;
  for (const n of notes) {
    if (n.version !== at) { out.push((out.length ? '\n' : '') + 'Kosmos ' + n.version); at = n.version; }
    out.push('  - ' + n.title + (n.line ? ': ' + n.line : ''));
    if (n.restart === 'agents') out.push('    Restart your agents for this: an agent running since before the update keeps the old behaviour.');
  }
  return out.join('\n') + '\n';
}

module.exports = { notesFor, readNotes, since, format, compareVersions, parseVersion, RESTART };
