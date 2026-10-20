'use strict';

/**
 * kosmos#6717: text Kosmos moved out of an agent's input box, kept as a draft for the person.
 *
 * When text Kosmos did not type sits unsent in an idle Claude Code agent's input box (engine/chat.js
 * recoverStuckInput), the board saves the text here first and only then clears the box, so the agent hears again and
 * the words are not lost. The person sees each draft as one Kosmos line in the agent's conversation (chat.withDraftRows)
 * until they dismiss it.
 *
 * 🛑 NOTHING SENDS FROM HERE. A draft is never typed into any agent and never becomes a message row: nothing that
 * delivers reads this file. Only the conversation route (to draw the line) and the dismiss route touch it.
 *
 * One small file per agent under the store. Never throws.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* Per agent. Full means refused, never the oldest dropped: every kept draft is words the person has not yet seen or
   dismissed, so the box is left as it is instead (chat.recoverStuckInput says so in the board log). */
const MAX_KEPT = 20;
const MAX_TEXT = 64 * 1024;   // the box is read from at most 200 rows, well under this

function dir() { return path.join(store.ROOT, 'unsent-drafts'); }
/* The store key alone can make two names one file (it lowercases and strips); a short hash of the exact name keeps
   every agent its own file, as engine/limitqueue.js does. */
function fileFor(name) {
  const n = String(name);
  return path.join(dir(), store.safeKey(n) + '-' + crypto.createHash('sha256').update(n).digest('hex').slice(0, 12) + '.json');
}

/* { ok, drafts }. A missing file is ok and empty; one that cannot be read or parsed is NOT ok, so nothing built on it
   overwrites it. Only drafts for this exact agent are returned. */
function readDrafts(name) {
  let raw;
  try { raw = fs.readFileSync(fileFor(name), 'utf8'); }
  catch (err) { return { ok: !!err && err.code === 'ENOENT', drafts: [] }; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, drafts: [] }; }
  if (!parsed || parsed.agent !== String(name) || !Array.isArray(parsed.drafts)) return { ok: false, drafts: [] };
  return {
    ok: true,
    drafts: parsed.drafts.filter((d) => d && typeof d.id === 'string' && typeof d.text === 'string' && d.text
      && typeof d.at === 'string' && Number.isFinite(Date.parse(d.at))),
  };
}

function writeDrafts(name, drafts) {
  const file = fileFor(name);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });   // the names of agents, and words that may be secret
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ agent: String(name), drafts }), { mode: 0o600 });
    try { fs.renameSync(tmp, file); } catch (err) { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } throw err; }
    return true;
  } catch { return false; }
}

/**
 * Keep `text` as a draft for `name`. `opts.since` (ISO) is when it was first seen sitting in the box. Answers
 * { ok: true, id } only once the file holding it is written, which is what lets the caller clear the box; anything
 * else is { ok: false, because } (`full: true` when MAX_KEPT are already kept), and the box must then be left as it
 * is. The same text, or a piece of one, already kept for this agent answers its id and adds nothing, so a box that
 * would not clear, or was cleared partway, is never saved twice.
 */
function add(name, text, opts = {}) {
  const t = typeof text === 'string' ? text : '';
  if (!name || !t.trim()) return { ok: false, because: 'there is nothing to keep' };
  if (t.length > MAX_TEXT) return { ok: false, because: 'it is too long to keep' };
  const cur = readDrafts(name);
  if (!cur.ok) return { ok: false, because: 'the drafts kept for this agent cannot be read right now' };
  const squashed = (v) => String(v).replace(/\s+/g, '');   // the box's rows wrap differently after a resize
  /* The same text, or a piece of one already kept (what a clearing stopped partway left in the box): the kept one. */
  const same = cur.drafts.find((d) => squashed(d.text).includes(squashed(t)));
  if (same) return { ok: true, id: same.id, already: true };
  if (cur.drafts.length >= MAX_KEPT) return { ok: false, full: true, because: MAX_KEPT + ' drafts are already kept for this agent' };
  const since = typeof opts.since === 'string' && Number.isFinite(Date.parse(opts.since)) ? opts.since : null;
  const draft = { id: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), text: t, ...(since ? { since } : {}) };
  const drafts = cur.drafts.concat([draft]);
  if (!writeDrafts(name, drafts)) return { ok: false, because: 'the draft could not be written' };
  return { ok: true, id: draft.id };
}

/* The drafts kept for `name`, oldest first ([] when none or unreadable). */
function list(name) {
  return readDrafts(name).drafts;
}

/* Remove one draft by id: true when it was there and the file was written without it. */
function dismiss(name, id) {
  const cur = readDrafts(name);
  if (!cur.ok || typeof id !== 'string' || !id) return false;
  const rest = cur.drafts.filter((d) => d.id !== id);
  if (rest.length === cur.drafts.length) return false;
  return writeDrafts(name, rest);
}

module.exports = { add, list, dismiss, fileFor, MAX_KEPT, MAX_TEXT };
