'use strict';
/* kosmos#7365 slice 3: which part of a project room is archived.

   Nothing moves and nothing is deleted: the room keeps its one append-only log, and its rows keep their seq numbers.
   Archiving is a READ-side split. A room's rows, oldest first, split into an archived stretch at the start and the live
   rest, and this module says where that split falls.

   A row is archived when either rule picks it:
   - the automatic rule: older than ARCHIVE_AGE_MS AND outside the newest ARCHIVE_KEEP rows (Mona's settled design,
     comment 6449440652: the age keeps a busy week-old conversation live, the count keeps the room small);
   - the person's own marker: "Archive older messages" stores a time, and every row older than it is archived.
   Each rule picks a run from the START of the room's rows, in the order the room read sorts them, so the two combine as
   the longer run and the archive is always one stretch with one boundary. The run ends at the first row the rule does
   not pick: a row whose time does not parse, or one stored in another time format that sorts out of place, ends it
   early, so more stays live.

   The marker is one small file (ROOT/roomarchive.json, { [projectId]: { before, setAt } }). Undo removes the room's
   entry; that undoes only the person's marker, because rows the automatic rule picks would be picked again on the next
   read anyway. */
const fs = require('fs');
const path = require('path');
const store = require('./store');

const ARCHIVE_KEEP = 1000;
const ARCHIVE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function fileFor() { return path.join(store.ROOT, 'roomarchive.json'); }

/* Null-prototype, so a project id such as "__proto__" is an own key like any other. A file that cannot be read or
   parsed reads as no markers: the room then shows only what the automatic rule archives, the safe direction (more
   live, never less). With { strict: true } (the writers) a file that is there but cannot be read or parsed throws
   instead, so a write never replaces every other room's marker with an empty table. */
function readAll({ strict = false } = {}) {
  const out = Object.create(null);
  try {
    let raw;
    try { raw = fs.readFileSync(fileFor(), 'utf8'); } catch (err) { if (err && err.code === 'ENOENT') return out; throw err; }
    const got = JSON.parse(raw);
    if (!got || typeof got !== 'object' || Array.isArray(got)) throw new Error('roomarchive.json is not a table');
    for (const k of Object.keys(got)) {
      const m = got[k];
      if (m && typeof m === 'object' && typeof m.before === 'string' && Number.isFinite(Date.parse(m.before))) out[k] = m;
    }
  } catch (err) { if (strict) throw err; }
  return out;
}

function writeAll(all) {
  const file = fileFor();
  const keys = Object.keys(all);
  if (!keys.length) { fs.rmSync(file, { force: true }); return; }
  const kept = Object.create(null);
  for (const k of keys) kept[k] = all[k];
  fs.mkdirSync(path.dirname(file), { recursive: true });
  require('./securewrite').writeSecret(file, JSON.stringify(kept), 0o600, { atomicOnly: true });
}

function markerFor(projectId) {
  const m = readAll()[String(projectId)];
  return m ? { before: m.before, setAt: typeof m.setAt === 'string' ? m.setAt : null } : null;
}

/* The person archives every row older than `before` (an ISO time with a zone, not in the future; up to SKEW_MS ahead is
   read as now, for a page whose clock runs a little fast). Returns { ok, marker } or { ok: false, because }. A marker
   earlier than the room's current one is kept as asked: the person chose it. Throws when the file is there but cannot
   be read (the route answers 503, nothing changed). */
const SKEW_MS = 60 * 1000;
function setMarker(projectId, before, now = Date.now()) {
  // An ISO time with Z or an offset only: Date.parse alone reads '1' as a date, and a time with no zone as local time.
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;
  const parsed = typeof before === 'string' && iso.test(before) ? Date.parse(before) : NaN;
  if (!Number.isFinite(parsed)) return { ok: false, because: 'that is not a time we can read' };
  if (parsed > now + SKEW_MS) return { ok: false, because: 'that time has not happened yet, so nothing is older than it' };
  const t = Math.min(parsed, now);
  const marker = { before: new Date(t).toISOString(), setAt: new Date(now).toISOString() };
  const all = readAll({ strict: true });
  all[String(projectId)] = marker;
  writeAll(all);
  return { ok: true, marker };
}

/* Undo: the room's own marker goes; the automatic rule still applies. */
function clearMarker(projectId) {
  const all = readAll({ strict: true });
  const had = Object.prototype.hasOwnProperty.call(all, String(projectId));
  if (had) { delete all[String(projectId)]; writeAll(all); }
  return { ok: true, cleared: had };
}

/* How many rows at the start of `rows` (oldest first, each with an ISO `at`) are archived. A row with no readable time
   is never picked by a time rule, and it stops the run there, so a row Kosmos cannot date stays live. */
function archivedCount(rows, marker, now = Date.now()) {
  const n = Array.isArray(rows) ? rows.length : 0;
  const ageCut = now - ARCHIVE_AGE_MS;
  const before = marker && typeof marker.before === 'string' ? Date.parse(marker.before) : NaN;
  const pastKeep = Math.max(0, n - ARCHIVE_KEEP);
  let byAge = 0;
  while (byAge < pastKeep) {
    const t = Date.parse(rows[byAge] && rows[byAge].at);
    if (!(t < ageCut)) break;
    byAge += 1;
  }
  let byMarker = 0;
  if (Number.isFinite(before)) {
    while (byMarker < n) {
      const t = Date.parse(rows[byMarker] && rows[byMarker].at);
      if (!(t < before)) break;
      byMarker += 1;
    }
  }
  return Math.max(byAge, byMarker);
}

module.exports = { ARCHIVE_KEEP, ARCHIVE_AGE_MS, fileFor, readAll, markerFor, setMarker, clearMarker, archivedCount };
