'use strict';
/**
 * The win32 ownership record: which Claude sessions did KOSMOS create.
 *
 * 🛑 WHY THIS EXISTS, AND WHY IT IS SAFETY-CRITICAL (#570). On a Mac the tmux
 * user option `@kosmos_agent` marks a session Kosmos created, and it dies with
 * the session, so a stranger cannot inherit it. Windows has no tmux and no such
 * per-session option. Meanwhile `claude agents --json` lists EVERY Claude
 * session on the machine -- every `kind: "interactive"` one, INCLUDING the
 * operator's OWN Claude sessions. Without a Kosmos-owned record of which of
 * those Kosmos started, the board would treat the operator's personal sessions
 * as agents it may write to and deliver into. This record is that ownership
 * authority, and it MUST FAIL CLOSED: a session we have no record of is NOT
 * ours, never the other way.
 *
 * 🔑 KEYED ON sessionId, NOT name. The sessionId from `claude agents --json` is
 * a UUID: unique, minted per session, never reused. Keying on it gives the
 * "dies with the session" property the tmux option had -- a new session gets a
 * new id, and a stranger cannot present Kosmos's recorded id -- which a
 * name-keyed record (a stranger opens a session with a Kosmos agent's name)
 * would not. The claim we later EMIT is the name (status.isNamedOurs matches the
 * claim against the pane's name), but the DECISION to emit is keyed on the id.
 *
 * ⚠️ FAIL-SAFE READS. Any read error (missing file, unparseable, permissions)
 * returns an EMPTY record. Empty means nothing is ours, which shows no agents --
 * the safe direction. It never means "trust everything".
 */
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');

/* #1443: DERIVED LIVE, not frozen at require. store.ROOT is a getter so a later
   AGENT_WORKFORCE_DATA/AGENT_WORKFORCE_HOME change is honoured; baking DIR/FILE
   into module-level consts at first load would re-lie the sandbox seam, and this
   is the safety-critical ownership record, so it matches the live style
   (chat.js/connect.js) rather than the frozen-const majority. */
function dir() { return path.join(store.ROOT, 'win32-sessions'); }
function file() { return path.join(dir(), 'record.json'); }
/* 0o600 is a POSIX bit and models the Mac path; on native Windows it maps to
   NTFS ACLs, so the real protection here is that the per-user AppData\Roaming
   tree is private by default, not the mode bit. Kept for the Mac path and as a
   floor, same "single local user" trust model as the rest of the store. */
const FILE_MODE = 0o600;

/* A session id is a UUID from `claude agents --json`. The charset gate keeps a
   malformed id out of the store key and out of any later shelling; we do not
   invent our own ids, so anything not matching is not one of ours anyway.

   The RESERVED set is a second gate the charset alone does not give: the string
   "__proto__" passes the charset, but `record[id] = {...}` on a plain object is
   a [[Set]] that hits Object.prototype's __proto__ ACCESSOR rather than writing
   an own key -- so the entry vanishes at JSON.stringify (an empty "{}"), and
   record() would return ok:true on a write that did nothing. isOurs stays safe
   either way (hasOwnProperty is false), but "ok:true on a no-op" is a lie a
   caller acts on, so refuse the reserved keys honestly instead. "constructor"
   and "prototype" are included for the same class though only __proto__ is
   actually special under bracket-assignment; a UUID is never any of these, so
   rejecting them costs nothing real. */
const RESERVED_ID = new Set(['__proto__', 'constructor', 'prototype']);
function validId(id) {
  return typeof id === 'string'
    && /^[A-Za-z0-9._-]{1,200}$/.test(id)
    && !RESERVED_ID.has(id);
}

/** The whole record, sessionId -> { name, runner, at }. Empty on any read fault. */
function read() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); }
  catch { return {}; }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  return parsed;
}

/**
 * Mark a session Kosmos created. Called by create.js at launch, the win32
 * analog of setting the tmux `@kosmos_agent` option. Never throws at a caller.
 * Returns { ok:true } or { ok:false, because }.
 *
 * ⚠️ The write is atomic (temp + rename) because the roster reads this on every
 * board tick while create writes it, and a half-written record read mid-write
 * would be a parse fault -- which fails safe here (empty), but a torn read that
 * happened to parse is the hazard rename removes.
 */
function record(sessionId, meta) {
  if (!validId(sessionId)) return { ok: false, because: 'that is not a session id we can key a record under' };
  const name = meta && typeof meta.name === 'string' ? meta.name : '';
  const runner = meta && typeof meta.runner === 'string' ? meta.runner : '';
  if (!name) return { ok: false, because: 'a Kosmos-created session must record the name it runs under' };
  let current = read();
  current[sessionId] = { name, runner, at: new Date().toISOString() };
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = file() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(current) + '\n', { mode: FILE_MODE });
    fs.renameSync(tmp, file());
  } catch (e) {
    return { ok: false, because: 'we could not write the ownership record (' + (e && e.code || 'unknown') + ')' };
  }
  return { ok: true };
}

/**
 * Drop a session from the record (agent removed / session gone for good). A
 * dead session simply stops appearing in `claude agents --json`, so a stale
 * entry is harmless for the roster (nothing live matches it); forget keeps the
 * file from growing without bound and is the correct step on a real removal.
 */
function forget(sessionId) {
  if (!validId(sessionId)) return { ok: false, because: 'not a session id we hold' };
  const current = read();
  if (!(sessionId in current)) return { ok: true };
  delete current[sessionId];
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const tmp = file() + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(current) + '\n', { mode: FILE_MODE });
    fs.renameSync(tmp, file());
  } catch (e) {
    return { ok: false, because: 'we could not update the ownership record (' + (e && e.code || 'unknown') + ')' };
  }
  return { ok: true };
}

/** Is this exact session one Kosmos created? The fail-closed ownership question. */
function isOurs(sessionId) {
  if (!validId(sessionId)) return false;
  const rec = read();
  return Object.prototype.hasOwnProperty.call(rec, sessionId);
}

module.exports = { get DIR() { return dir(); }, get FILE() { return file(); }, read, record, forget, isOurs, validId };
