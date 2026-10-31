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
// The statuses whose items a build may ship. An allowlist, so a status added later (held's cousins) stays out until
// someone decides it ships: the filter fails closed.
const SHIPS = ['shown', 'pending'];

function parseVersion(v) {
  const m = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v || ''));
  return m ? m.slice(1).map(Number) : null;
}
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

// The build platforms. A pool item tagged `platforms` (engine/whatsnew.js: mac, windows) is for those only; Linux is
// never a tag, so a Linux build keeps only the untagged items.
const BUILD_PLATFORMS = ['mac', 'windows', 'linux'];

/** The notes a build of `version` for `platform` contains: every pool item not held, shipped at or before it, and
 *  for that platform (an untagged item is for all), oldest first (rank within a version). Only the fields a reader
 *  needs; nothing about status, shownIn or rank leaves. */
function notesFor(pool, version, platform) {
  if (!parseVersion(version)) throw new Error('not a version: ' + JSON.stringify(version));
  if (!BUILD_PLATFORMS.includes(platform)) throw new Error('not a build platform: ' + JSON.stringify(platform) + ' (' + BUILD_PLATFORMS.join(', ') + ')');
  const items = (pool && Array.isArray(pool.items)) ? pool.items : [];
  const forPlatform = (it) => !(Array.isArray(it.platforms) && it.platforms.length) || it.platforms.includes(platform);
  return items
    .filter((it) => it && SHIPS.includes(it.status) && parseVersion(it.since) && compareVersions(it.since, version) <= 0 && forPlatform(it))
    .sort((a, b) => compareVersions(a.since, b.since) || ((a.rank || 0) - (b.rank || 0)))
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
    if (!d || !Array.isArray(d.notes) || !parseVersion(d.version)
      || !d.notes.every((n) => n && typeof n.title === 'string' && parseVersion(n.version) && typeof n.line === 'string'
        && (n.restart === undefined || RESTART.includes(n.restart))
        && (n.platforms === undefined || (Array.isArray(n.platforms) && n.platforms.every((x) => typeof x === 'string'))))) {
      throw new Error('its release notes file is damaged (every note needs a title, a version and a line)');
    }
    // A notes file left beside a newer app would answer for the wrong version: refuse it rather than mislead. (A
    // layout with no package.json beside the notes has nothing to compare with, so the check is skipped there.)
    const pkg = path.join(appRoot, 'package.json');
    const installed = fs.existsSync(pkg) ? JSON.parse(fs.readFileSync(pkg, 'utf8')).version : null;
    if (installed && installed !== d.version) throw new Error('its release notes are for ' + d.version + ', but this install is ' + installed);
    return d;
  }
  const poolFile = path.join(appRoot, 'release', 'whats-new-pool.json');
  if (!fs.existsSync(poolFile)) throw new Error('this install has no release notes file');
  const pool = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  const version = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8')).version;
  const platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux';
  return { version, notes: notesFor(pool, version, platform) };
}

/** The newest version's own notes: the default view, whatever number came before it (Mac and Windows share one
 *  numbering, so the previous release is not always the patch before). */
function latest(notes) {
  if (!notes.length) return [];
  const top = notes.reduce((m, n) => (compareVersions(n.version, m) > 0 ? n.version : m), notes[0].version);
  return notes.filter((n) => n.version === top);
}

/** The notes newer than `sinceVersion`. A `sinceVersion` that is not a version (empty included) is refused. */
function since(notes, sinceVersion) {
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

/** What `kosmos whats-new` answers, for both CLIs (install/kosmos and the Windows one), so they cannot drift.
 *  opts: { since: string|null (null: the newest version's own notes), json: bool }. -> { code, out, err }. */
function render(appRoot, opts) {
  let d;
  try { d = readNotes(appRoot); } catch (e) { return { code: 1, out: '', err: 'Kosmos could not read its release notes: ' + e.message }; }
  let notes;
  if (opts.since === null || opts.since === undefined) notes = latest(d.notes);
  else { try { notes = since(d.notes, opts.since); } catch (e) { return { code: 1, out: '', err: e.message }; } }
  if (opts.json) return { code: 0, out: JSON.stringify({ installed: d.version, since: opts.since == null ? null : opts.since, notes }, null, 2) + '\n', err: '' };
  // The default view, when the installed version added no notes of its own: say so, so an older block is not read as
  // this update's.
  const older = (opts.since == null && notes.length && notes[0].version !== d.version)
    ? 'Kosmos ' + d.version + ' added no notes of its own; the newest are from ' + notes[0].version + '.\n\n' : '';
  return { code: 0, out: older + format(notes, d.version), err: '' };
}

module.exports = { notesFor, readNotes, latest, since, format, render, compareVersions, parseVersion, RESTART, BUILD_PLATFORMS };
