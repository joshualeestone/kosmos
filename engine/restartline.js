'use strict';
/**
 * kosmos#7411 step 4: after an update, tell the person which running agents need a restart to get a fix, and never
 * restart them for the person. A restart drops what an agent is doing, and only the person can see whether that is
 * all right now (Mona Lisa's design review, 2026-10-28, on the card).
 *
 * A fix "needs a restart" when its release note carries `restart: "agents"` (engine/releasenotes.js): a running agent
 * keeps the old behaviour (an instruction section, a hook, its launch command) until its session starts again.
 *
 * WHEN. The board keeps the versions it has run, each with when it first started on it (version-start.json, the last
 * MAX_HISTORY changes). A marked fix shipped in version V reached this computer at the start of the latest run that
 * went from below V to V or above: the first update to carry it, or the update back up after a rollback below it. An
 * agent whose session started before that moment does not have the fix. A fix the computer had from its first
 * recorded version had no such moment: an install is not an update, and nothing is said for it. Because each fix keeps
 * its own moment, a second update before the agents restart does not forget the first update's fix.
 *
 * WHO. Only agents that are running (a live session; a stopped agent gets the fix when it next starts, so naming it
 * asks for a restart nobody needs), and only those whose session started before a fix they lack. tmux reads session
 * starts in whole seconds, so the moment is compared in whole seconds too: an agent started in the same second as the
 * board counts as started after it. A session start that could not be read is left out rather than guessed.
 *
 * NOT NOW hides the line until the next update (it is recorded against the version running now). The line also goes
 * by itself once no named agent is still on an old session. Every read and write is best effort: this is a courtesy,
 * never a gate.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const file = () => path.join(store.ROOT, 'version-start.json');
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const MAX_HISTORY = 50;

function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
function read() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf8'));
    const history = v && Array.isArray(v.history) ? v.history.filter((h) => h && VERSION.test(h.version) && Number.isFinite(h.at)) : [];
    if (!history.length) return null;
    const version = history[history.length - 1].version;
    return { version, history, notNow: v.notNow === version };
  } catch { return null; }
}
function write(rec) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    require('./securewrite').writeSecret(file(), JSON.stringify(rec) + '\n', 0o600, { atomicOnly: true });
    return true;
  } catch { return false; }
}

/**
 * At board start: when `version` differs from the one recorded last, add it with `now` as its first start. A start on
 * the version already recorded changes nothing, so each entry keeps its version's FIRST start. Returns the record.
 * `seenBefore` is the version the page last announced (seen-version.json), read by the caller. With no record yet it
 * says this computer ran that version before, so the first update with this file is an update, not an install.
 */
function atStart(version, now = Date.now(), seenBefore = null) {
  if (!VERSION.test(String(version || ''))) return null;
  const was = read();
  if (was && was.version === version) return was;
  const seeded = !was && VERSION.test(String(seenBefore || '')) && cmp(seenBefore, version) < 0 ? [{ version: seenBefore, at: 0 }] : [];
  const history = (was ? was.history : seeded).concat([{ version, at: now }]).slice(-MAX_HISTORY);
  write({ history });
  return { version, history, notNow: false };
}

/** When a fix shipped in `v` reached this computer: the first start of the latest run that went from below `v` to `v`
 *  or above, or null when the computer had it from its first recorded version (or does not have it now). */
function fixReachedAt(history, v) {
  let at = null;
  for (let i = 0; i < history.length; i++) {
    const has = cmp(history[i].version, v) >= 0;
    if (!has) at = null;
    else if (i > 0 && cmp(history[i - 1].version, v) < 0) at = history[i].at;
  }
  return at;
}

/** The marked notes the running version carries that reached this computer by an update, each with that moment
 *  (`reachedAt`), or [] when there is no line to make (Not now, no record). The route asks this first, so a board with
 *  nothing marked never reads tmux or the roster for the page's once-a-minute check. */
function markedNotes(record, notes) {
  if (!record || record.notNow || !Array.isArray(record.history) || !record.history.length) return [];
  const out = [];
  for (const n of Array.isArray(notes) ? notes : []) {
    if (!n || n.restart !== 'agents' || !VERSION.test(n.version) || cmp(n.version, record.version) > 0) continue;
    if (typeof n.title !== 'string' || !n.title.trim()) continue;
    const reachedAt = fixReachedAt(record.history, n.version);
    if (reachedAt !== null) out.push({ version: n.version, title: n.title.trim(), reachedAt });
  }
  return out;
}

/**
 * The line to show, or null. Pure, so the rule is tested without a disk or tmux.
 *   record  what atStart recorded ({ version, history, notNow })
 *   notes   this install's release notes (releasenotes.readNotes(...).notes)
 *   agents  the running agents: [{ name, label, startedAt }], startedAt in ms or null when it could not be read
 * Answers { version, notes: [{ version, title }], agents: [{ name, label }] }: the agents that lack at least one fix,
 * and the fixes at least one of them lacks.
 */
function lineFor({ record, notes, agents }) {
  const marked = markedNotes(record, notes);
  if (!marked.length) return null;
  const lacks = (a, n) => a.startedAt < Math.floor(n.reachedAt / 1000) * 1000;
  const named = (Array.isArray(agents) ? agents : [])
    .filter((a) => a && typeof a.name === 'string' && a.name && Number.isFinite(a.startedAt) && marked.some((n) => lacks(a, n)));
  if (!named.length) return null;
  return {
    version: record.version,
    notes: marked.filter((n) => named.some((a) => lacks(a, n))).map((n) => ({ version: n.version, title: n.title })),
    agents: named.map((a) => ({ name: a.name, label: typeof a.label === 'string' && a.label.trim() ? a.label.trim() : a.name })),
  };
}

/** Not now: hide the line until the next update. Only for the version recorded now, so an old page cannot hide a
 *  newer update's line. Returns true only when it was recorded. */
function notNow(version) {
  const rec = read();
  if (!rec) return false;
  if (rec.version !== version) return false;
  return write({ history: rec.history, notNow: rec.version });
}

/** Whether `v` is a version as this record keeps them (x.y.z, up to six digits each). */
const isVersion = (v) => VERSION.test(String(v || ''));

module.exports = { atStart, lineFor, markedNotes, notNow, read, isVersion };
