'use strict';
/**
 * kosmos#7411 step 4: after an update, tell the person which running agents need a restart to get a fix, and never
 * restart them for the person. A restart drops what an agent is doing, and only the person can see whether that is
 * all right now (Mona Lisa's design review, 2026-10-28, on the card).
 *
 * A fix "needs a restart" when its release note carries `restart: "agents"` (engine/releasenotes.js): a running agent
 * keeps the old behaviour (an instruction section, a hook, its launch command) until its session starts again.
 *
 * WHEN. The board records the version it runs and when it first started on it (version-start.json). When it starts on
 * a different version it keeps the one before as `previous`, so the notes that matter are the marked ones newer than
 * `previous`, up to the version running now. The first version a computer is ever seen on has no `previous`: an
 * install is not an update, and nothing is said.
 *
 * WHO. Only agents that are running (a live session; a stopped agent gets the fix when it next starts, so naming it
 * asks for a restart nobody needs), and only those whose session started before this version's first board start.
 * tmux reads session starts in whole seconds, so this version's start is compared in whole seconds too: an agent
 * started in the same second as the board counts as started after it. A session start that could not be read is left
 * out rather than guessed.
 *
 * NOT NOW hides the line until the next update (it is recorded against this version). The line also goes by itself
 * once no named agent is still on its old session. Every read and write is best effort: this is a courtesy, never a
 * gate.
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const file = () => path.join(store.ROOT, 'version-start.json');
const VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;

function cmp(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
function read() {
  try {
    const v = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (!v || typeof v !== 'object' || !VERSION.test(v.version) || !Number.isFinite(v.at)) return null;
    return {
      version: v.version,
      previous: VERSION.test(v.previous) ? v.previous : null,
      at: v.at,
      notNow: v.notNow === v.version,
    };
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
 * At board start: record `version` and when it was first started on, keeping the version before as `previous`.
 * A start on the version already recorded changes nothing, so `at` stays this version's FIRST start. Returns the record.
 */
function atStart(version, now = Date.now()) {
  if (!VERSION.test(String(version || ''))) return null;
  const was = read();
  if (was && was.version === version) return was;
  const rec = { version, previous: was ? was.version : null, at: now };
  write(rec);
  return { ...rec, notNow: false };
}

/**
 * The line to show, or null. Pure, so the rule is tested without a disk or tmux.
 *   record  what atStart recorded ({ version, previous, at, notNow })
 *   notes   this install's release notes (releasenotes.readNotes(...).notes)
 *   agents  the running agents: [{ name, label, startedAt }], startedAt in ms or null when it could not be read
 * Answers { version, notes: [{ version, title }], agents: [{ name, label }] }.
 */
function lineFor({ record, notes, agents }) {
  if (!record || !record.previous || record.notNow || !Number.isFinite(record.at)) return null;
  const marked = (Array.isArray(notes) ? notes : []).filter((n) => n && n.restart === 'agents'
    && VERSION.test(n.version) && cmp(n.version, record.previous) > 0 && cmp(n.version, record.version) <= 0
    && typeof n.title === 'string' && n.title.trim());
  if (!marked.length) return null;
  const startSec = Math.floor(record.at / 1000) * 1000;
  const named = (Array.isArray(agents) ? agents : [])
    .filter((a) => a && typeof a.name === 'string' && a.name && Number.isFinite(a.startedAt) && a.startedAt < startSec)
    .map((a) => ({ name: a.name, label: typeof a.label === 'string' && a.label.trim() ? a.label.trim() : a.name }));
  if (!named.length) return null;
  return { version: record.version, notes: marked.map((n) => ({ version: n.version, title: n.title.trim() })), agents: named };
}

/** Not now: hide the line until the next update. Only for the version recorded now, so an old page cannot hide a
 *  newer update's line. Returns true when recorded (or when there is nothing to hide). */
function notNow(version) {
  const rec = read();
  if (!rec) return true;
  if (rec.version !== version) return false;
  return write({ version: rec.version, previous: rec.previous, at: rec.at, notNow: rec.version });
}

module.exports = { atStart, lineFor, notNow, read, _file: file };
