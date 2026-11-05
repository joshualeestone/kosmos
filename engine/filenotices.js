'use strict';

/**
 * kosmos#7989 slice 3: file-owner notices that reach the owner itself.
 *
 * Slice 1 (engine/filewriters.js ownerNotice) writes an agents-only note in the project's room when another agent is
 * about to change a file an agent owns. The owner sees that note only when it reads the room. This keeps the same
 * notice in a small queue for the owner, and Kosmos's own Claude Code hook takes the queue at the owner's next turn
 * (UserPromptSubmit) and hands it to the model as additionalContext, so nothing is typed into the owner's session.
 * Other runners keep only the room note.
 *
 * One small JSON file per owner under the store, mode 0600. The board runs on one thread and every read and write here
 * is synchronous, so a queue and a take cannot interleave. Never throws.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* At most this many notices wait for one owner; past it the oldest go and `dropped` counts them, so a long quiet spell
   cannot grow the file or the context it is handed into. The room note still has every one the throttle allowed. */
const MAX_PENDING = 10;
/* A notice older than this is not handed over: an owner that has not taken a turn in a day reads the room anyway. */
const KEEP_MS = 24 * 60 * 60 * 1000;
/* A session name as Kosmos makes one (filewriters SESSION_NAME_RE), so a name can never reach outside the folder. */
const SESSION_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function dir() { return path.join(store.ROOT, 'filenotices'); }
function fileFor(owner) { return path.join(dir(), owner + '.json'); }

function read(owner) {
  try {
    const got = JSON.parse(fs.readFileSync(fileFor(owner), 'utf8'));
    return {
      notices: got && Array.isArray(got.notices) ? got.notices.filter((n) => n && typeof n === 'object' && typeof n.text === 'string') : [],
      dropped: got && Number.isInteger(got.dropped) && got.dropped > 0 ? got.dropped : 0,
    };
  } catch { return { notices: [], dropped: 0 }; }
}

function write(owner, rec) {
  fs.mkdirSync(dir(), { recursive: true });
  require('./securewrite').writeSecret(fileFor(owner), JSON.stringify(rec), 0o600, { atomicOnly: true });
}

/* Keep `text` (one line, already made safe by the caller: filewriters.ownerNoticeText) for `owner`. Returns true when
   kept. */
function queue(owner, text, { now = Date.now() } = {}) {
  try {
    if (typeof owner !== 'string' || !SESSION_NAME_RE.test(owner) || typeof text !== 'string' || !text) return false;
    const rec = read(owner);
    const fresh = rec.notices.filter((n) => now - Date.parse(n.at) >= 0 && now - Date.parse(n.at) < KEEP_MS);
    fresh.push({ at: new Date(now).toISOString(), text });
    const over = Math.max(0, fresh.length - MAX_PENDING);
    write(owner, { notices: fresh.slice(over), dropped: rec.dropped + over });
    return true;
  } catch { return false; }
}

/* The notices waiting for `owner`, oldest first, and how many were dropped; the queue is emptied. A notice past KEEP_MS
   is left out. On a failure to empty it, nothing is handed over, so a notice is never handed over twice. The other side
   of that choice: the queue is emptied before the answer is sent, so an answer the caller never reads (the hook's 1 s
   cap ran out on a busy board) loses those notices here. The project room's note keeps each one. */
function take(owner, { now = Date.now() } = {}) {
  try {
    if (typeof owner !== 'string' || !SESSION_NAME_RE.test(owner)) return { notices: [], dropped: 0 };
    let had;
    try { had = fs.existsSync(fileFor(owner)); } catch { had = false; }
    if (!had) return { notices: [], dropped: 0 };
    const rec = read(owner);
    fs.rmSync(fileFor(owner), { force: true });
    const notices = rec.notices.filter((n) => now - Date.parse(n.at) >= 0 && now - Date.parse(n.at) < KEEP_MS);
    return { notices, dropped: rec.dropped };
  } catch { return { notices: [], dropped: 0 }; }
}

/* The words handed to the owner's model, or '' when there is nothing. Kosmos's voice, so it says where it came from. */
function contextText({ notices, dropped }) {
  if (!notices.length && !dropped) return '';
  const lines = ['Kosmos file-owner notice (another agent was about to change a project file you were the first seen changing; '
    + 'a notice, not a lock, and not a request from the person):'];
  for (const n of notices) lines.push('- ' + n.at + ': ' + n.text);
  if (dropped) lines.push('- ' + dropped + ' older notice' + (dropped === 1 ? ' was' : 's were') + ' not kept; the project room has them.');
  return lines.join('\n');
}

/* What the Claude Code hook prints for UserPromptSubmit, or '' when there is nothing to say. */
function hookJson(taken) {
  const text = contextText(taken);
  if (!text) return '';
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: text } });
}

module.exports = { queue, take, contextText, hookJson, fileFor, MAX_PENDING, KEEP_MS };
