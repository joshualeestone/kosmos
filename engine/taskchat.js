'use strict';

/**
 * A task's own conversation, recorded. (#992)
 *
 * Josh, 2026-08-26: "record those conversations by storing all the text and
 * information that goes into those [tasks]... I just want all the dialog stored
 * and then I want to be able to get to it as a user."
 *
 * ⚠️ WHAT THIS CARD ASSUMED, AND WHAT IS ACTUALLY TRUE. The ask assumed a task
 * already HAS a conversation to record. It does not: a task (engine/tasks.js) is
 * a kanban item -- number, sentence, detail, parts, who -- with no message
 * concept. Operator<->agent dialogue goes through the PROJECT ROOM
 * (engine/chat.js / engine/messages.js), addressed to an agent, never associated
 * with a task. The assigned agent's real working transcript lives in its OWN
 * Claude/Codex session directory (~/.claude/projects, ~/.codex/sessions), which
 * Kosmos reads but does not own; the tmux pane is captured live and never stored.
 * So there was nothing to persist -- this module gives a task a transcript at
 * all, out of the text Kosmos itself controls and, until now, threw away: the
 * task's lifecycle (created / assigned / closed / reopened). The assignment line
 * currently typed into the assignee's pane and the pointer to that agent's
 * external session are the next things to fold in (a task can carry them because
 * this record exists to carry them).
 *
 * 🔑 STORAGE SHAPE, DECIDED ONCE (the card's central open question). Josh ruled
 * the store.js rule is NOT reversed: the user's project folder holds their work
 * and nothing of ours, so nothing lands in the project directory. The transcript
 * lives under app data (store.ROOT), and the requirement is REACHABILITY, not
 * location -- a reveal button opens it. Each task gets its OWN file, keyed by the
 * only thing that names a task uniquely: (projectId, number). A task's number is
 * issued by its project and unique only there, so the project id is part of the
 * key.
 *
 * ✅ RETENTION-SAFE BY CONSTRUCTION -- the one thing Josh left undecided. The
 * project ledger (engine/messages.js:133-134,319) re-reads the whole install-wide
 * file on every send and never rotates ("written, forever"), and the card warned
 * that adding task transcripts to that log DOUBLES the debt. A per-task file does
 * not inherit it: recording APPENDS one line and never reads the file back
 * (fs.appendFileSync, no read-modify-write), and reading loads exactly one task's
 * own small file, never a shared log. Each file grows only with its own task's
 * handful of lifecycle events.
 *
 * The log is the engine's record, not a boundary. Recording is BEST-EFFORT: a
 * failed append must never break the task operation that triggered it (the task
 * is the source of truth; the transcript is a record of it), so record() catches
 * its own failures and returns false rather than throwing. The read side
 * validates shape rather than trusting whatever parses, exactly as
 * engine/messages.js does, because a same-user process can append to the file
 * directly.
 *
 * Paths are computed at CALL time, never cached at module load: store.ROOT is a
 * lazy getter, so a caller (or a test via AGENT_WORKFORCE_DATA) that sets the
 * data root after this module is required still writes to the right place.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

const DIRNAME = 'task-chats';

/* Cap a recorded string so a pathological detail cannot write an unbounded line;
   generous, since detail is already capped at 2000 upstream (tasks.js). Control
   characters (C0 + DEL) are flattened to spaces so one JSONL line stays one
   physical line, and JSON.stringify independently escapes them on write.
   ⚠️ THIS IS LINE INTEGRITY, NOT DISPLAY SAFETY. The store keeps raw text, so
   `<`, `&`, U+2028/U+2029 and the like pass through unchanged; whoever renders a
   transcript (the follow-up reveal surface) still owns escaping for its display
   layer. Do not read stored text as render-safe. */
const FIELD_MAX = 4000;
function clean(v) {
  if (v == null) return null;
  // Numbers and booleans carry no control characters and JSON.stringify emits
  // them safely, so preserve their type -- a partId stays a number, not "1".
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v).replace(/[\x00-\x1F\x7F]/g, ' ');
  return s.length > FIELD_MAX ? s.slice(0, FIELD_MAX) : s;
}

/* A task number is a positive integer issued by its project. Anything else is a
   caller bug, and recording under a mangled key would scatter a task's events
   across files; refuse rather than guess. */
function validNumber(n) {
  return Number.isInteger(n) && n > 0;
}

/* A project id must resolve to a single, safe path segment. store.safeKey is the
   same sanitiser the profile store uses; safeKey THROWS on an id that sanitises to
   nothing (a string of only disallowed characters), so this catches it and returns
   null -- read() and taskChatFile() must answer "no such task" rather than throw,
   the module's fail-soft contract.
   🔑 COLLISION SAFETY for two DISTINCT ids rests upstream, not here: safeKey
   lowercases and strips, so `Proj-A` and `proj-a` would collapse onto one file --
   but real project ids are minted by projects.idFor already in `[a-z0-9_-]` and
   deduped, so two distinct live ids never sanitise to the same key. This function
   only defends the empty-sanitising case; it does not re-establish uniqueness. */
function keyOf(projectId) {
  if (projectId == null) return null;
  try {
    return store.safeKey(String(projectId));
  } catch {
    return null;
  }
}

function taskChatsDir() {
  return path.join(store.ROOT, DIRNAME);
}

function taskChatFile(projectId, number) {
  const k = keyOf(projectId);
  if (!k || !validNumber(number)) return null;
  return path.join(taskChatsDir(), `${k}.task-${number}.jsonl`);
}

/**
 * Append one event to a task's transcript. Returns true on write, false on any
 * refusal or failure (never throws). `event` is `{ kind, ...fields }`; `kind` is
 * required and every value is cleaned to a bounded, single-line string (or null).
 * The `at` timestamp is stamped here so callers cannot forget it and the record
 * orders itself.
 */
function record(projectId, number, event) {
  try {
    const file = taskChatFile(projectId, number);
    if (!file) return false;
    if (!event || typeof event !== 'object' || typeof event.kind !== 'string' || !event.kind.trim()) return false;
    const row = { at: new Date().toISOString(), kind: event.kind.trim() };
    for (const [k, v] of Object.entries(event)) {
      if (k === 'kind' || k === 'at') continue;
      row[k] = clean(v);
    }
    fs.mkdirSync(taskChatsDir(), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(row) + '\n');
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a task's transcript, newest last (append order). Returns [] when there is
 * no file or it cannot be read -- "no transcript" and "unreadable" both render as
 * nothing rather than an error, the same rule the record itself follows. Each
 * returned row is shape-validated (a string `at` and a string `kind`); a
 * malformed or partially-written line is skipped, not fatal.
 */
function read(projectId, number) {
  const file = taskChatFile(projectId, number);
  if (!file) return [];
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    // #992: `at` must be a string AND a parseable date -- parity with
    // engine/messages.js's rowShaped, the sibling this module models itself on.
    // record() always stamps a valid ISO `at`, so this only bites a foreign or
    // torn append carrying a non-date `at`, which read() should drop rather than
    // surface as a bad timestamp.
    if (obj && typeof obj === 'object'
        && typeof obj.at === 'string' && Number.isFinite(Date.parse(obj.at))
        && typeof obj.kind === 'string') {
      out.push(obj);
    }
  }
  return out;
}

/* #4786: the newest time a project's work MOVED FORWARD FOR THE FIRST TIME. The room's back-and-forth valve
   treats this as the room landing, the way a person's post already is, so a pipeline handing work along is not
   held while a loop that only talks still is. Only a first-time step forward counts, because anything that can be
   repeated could be looped (review round 1: passing a part A to B to A, or closing, reopening and closing again):
   - a task created, a part added (each makes something new);
   - a task's FIRST close, a part's FIRST close, a task's FIRST built mark (a later one after a reopen or an
     unbuilt does not count);
   - a part given to someone who has NEVER held it (a handoff down a pipeline; giving it back does not count).
   Talk ('said'), going backwards (reopened, part-reopened, unbuilt), taking someone off, due dates and parents
   do not count. A time later than `now` is clamped to now, so a row dated in the future cannot switch the valve
   off. 0 when there is none or nothing can be read (never throws). Reads only this project's task files; the
   valve calls it only when a room is over its cap. */
const PROGRESS_KINDS = new Set(['created', 'assigned', 'built', 'part-added', 'part-closed', 'closed']);
function lastProgressAt(projectId, now = Date.now()) {
  try {
    const k = keyOf(projectId);
    if (!k) return 0;
    const prefix = `${k}.task-`;
    let newest = 0;
    for (const name of fs.readdirSync(taskChatsDir())) {
      if (!name.startsWith(prefix) || !name.endsWith('.jsonl')) continue;
      const n = Number(name.slice(prefix.length, -'.jsonl'.length));
      const seen = new Set();          // 'closed', 'built', 'part-closed:<id>' already counted once
      const held = new Map();          // partId -> everyone who has held it
      let firstWho = null;             // the task's first holder, from its 'created' row
      for (const row of read(projectId, n)) {
        if (!PROGRESS_KINDS.has(row.kind)) continue;
        let counts = false;
        if (row.kind === 'created') {
          counts = true;
          firstWho = typeof row.who === 'string' && row.who ? row.who : null;
        } else if (row.kind === 'part-added') {
          counts = true;
        } else if (row.kind === 'closed' || row.kind === 'built' || row.kind === 'part-closed') {
          const key = row.kind === 'part-closed' ? `part-closed:${row.partId}` : row.kind;
          counts = !seen.has(key);
          seen.add(key);
        } else if (row.kind === 'assigned') {
          if (typeof row.who === 'string' && row.who) {
            const who = held.get(String(row.partId)) || new Set(firstWho ? [firstWho] : []);
            counts = !who.has(row.who);
            who.add(row.who);
            held.set(String(row.partId), who);
          }
        }
        if (!counts) continue;
        const t = Math.min(Date.parse(row.at), now);
        if (Number.isFinite(t) && t > newest) newest = t;
      }
    }
    return newest;
  } catch {
    return 0;
  }
}

module.exports = { record, read, taskChatsDir, taskChatFile, lastProgressAt, PROGRESS_KINDS };
