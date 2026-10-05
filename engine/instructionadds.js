'use strict';

/**
 * kosmos#5293: an agent PROPOSES an addition to another agent's instructions, and the PERSON applies it on that
 * agent's page. Day-one report: a manager agent drafted an addition, the person said "apply it", and no command
 * could; the person pasted it in by hand.
 *
 * 🛑 THE APPROVAL IS THE PERSON'S PRESS, NEVER A FLAG. An agent runs the CLI, so anything the CLI can say ("approved")
 * an agent could say. So the CLI only proposes (held here), and apply / dismiss / undo are reached only through the
 * page's person-only routes (server.js, isViaScreen). See the card and the plan for the reasoning.
 *
 * One pending addition per target (Splinter 10-05): a second proposal is REFUSED, naming the waiting one, never a
 * silent replacement. Apply appends a line saying who asked and when, then the text, through instructions.write with
 * the version just read (in one synchronous call, so this guards against another PROCESS editing the file, not against
 * this board). It keeps the text from just before and the version it wrote; Undo puts that text back only while the
 * file is still that version.
 *
 * Keyed by the agent's SESSION name: the route resolves whatever spelling it was given to the one agent first (review
 * 1: a case variant was stored apart and never shown). Removing an agent forgets its entry (engine/remove.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const instructions = require('./instructions');

const MAX_TEXT_BYTES = 16 * 1024;
/* Resolved per call, not frozen at require (the #1443 shape): a later AGENT_WORKFORCE_DATA is honoured. */
function file() { return path.join(store.ROOT, 'instruction-adds.json'); }
const UNREADABLE = Symbol('unreadable');
const UNREADABLE_SAID = 'the file that holds waiting additions could not be read, so nothing was changed';

/* Review 1: a file that is there but cannot be parsed is UNREADABLE, never silently treated as empty and overwritten
   (that would drop every other agent's waiting addition and Undo record). Review 2: and never a dead end either. A
   write that finds it unreadable first MOVES it aside (instruction-adds.json.unreadable-<time>, kept for a person to
   look at, never deleted) and carries on from empty, and the page's read says that happened. A missing file, an empty
   one, and `{}` are just empty. Entries live in a null-prototype map, so 'constructor' is just a key. */
function readAll() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { agents: Object.create(null) } : UNREADABLE; }
  if (!raw.trim()) return { agents: Object.create(null) };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return UNREADABLE;
    if (parsed.agents === undefined) return { agents: Object.create(null) };
    if (!parsed.agents || typeof parsed.agents !== 'object' || Array.isArray(parsed.agents)) return UNREADABLE;
    return { agents: Object.assign(Object.create(null), parsed.agents) };
  } catch { return UNREADABLE; }
}
/* Review 2: the store a WRITE may use. An unreadable one is moved aside (kept), then the write starts from empty. */
function readForWrite() {
  const all = readAll();
  if (all !== UNREADABLE) return all;
  try {
    const aside = file() + '.unreadable-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(file(), aside);
    return { agents: Object.create(null) };
  } catch { return UNREADABLE; }
}
/** True when the store is there and cannot be read (the page says so, and the next write moves it aside). */
function unreadable() { return readAll() === UNREADABLE; }
function recOf(all, k) { return all !== UNREADABLE && Object.prototype.hasOwnProperty.call(all.agents, k) ? all.agents[k] : null; }

/* Mode 0600: the Undo record holds the agent's full earlier instructions, which instructions.js keeps private too. */
function writeAll(all) {
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all) + '\n', { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch { /* best effort: a filesystem without modes */ }
  fs.renameSync(tmp, f);
}

function keyFor(agent) { return instructions.registryKey(agent); }

/** The line Apply writes above the added text: who asked and when, in the instructions themselves. */
function headingLine(askedBy, askedAt) {
  const d = new Date(askedAt);
  const day = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : 'an unknown date';
  return `## Added on ${day}, asked by ${askedBy}`;
}

/** The pending addition for this agent, or null. */
function pending(agent) {
  const k = keyFor(agent);
  if (!k) return null;
  const rec = recOf(readAll(), k);
  return rec && rec.pending ? rec.pending : null;
}

/**
 * Hold a proposal. { ok:true, pending } or { ok:false, code, because, pending? }.
 * code 'pending' means one is already waiting (refused, never replaced); 'bad' a text or name we cannot take.
 */
function propose(agent, text, askedBy, now) {
  const k = keyFor(agent);
  if (!k) return { ok: false, code: 'bad', because: 'that is not a name we can look up' };
  const body = String(text == null ? '' : text);
  if (!body.trim()) return { ok: false, code: 'bad', because: 'the addition is empty' };
  if (Buffer.byteLength(body, 'utf8') > MAX_TEXT_BYTES) {
    return { ok: false, code: 'bad', because: `the addition is too long (at most ${MAX_TEXT_BYTES / 1024} KB)` };
  }
  const who = String(askedBy == null ? '' : askedBy).trim();
  if (!who) return { ok: false, code: 'bad', because: 'we could not tell which agent is asking' };
  const all = readForWrite();
  if (all === UNREADABLE) return { ok: false, code: 'bad', because: UNREADABLE_SAID };
  const rec = recOf(all, k) || {};
  if (rec.pending) return { ok: false, code: 'pending', pending: rec.pending, because: 'an addition is already waiting' };
  rec.pending = { text: body, askedBy: who, askedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString() };
  all.agents[k] = rec;
  writeAll(all);
  return { ok: true, pending: rec.pending };
}

/** The person dismisses the waiting addition. */
function dismiss(agent) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readForWrite();
  if (all === UNREADABLE) return { ok: false, because: UNREADABLE_SAID };
  const rec = recOf(all, k);
  if (!rec || !rec.pending) return { ok: false, code: 'none', because: 'there is no addition waiting' };
  delete rec.pending;
  all.agents[k] = rec;
  writeAll(all);
  return { ok: true };
}

/** Review 1: removing an agent forgets its entry, so a new agent with that name inherits nothing. */
function forget(agent) {
  const k = keyFor(agent);
  if (!k) return { ok: false };
  const all = readForWrite();
  if (all === UNREADABLE) return { ok: false };
  /* Review 2: the removal may be handed another capitalisation of the name; every matching key goes. */
  const gone = Object.keys(all.agents).filter((key) => key === k || key.toLowerCase() === k.toLowerCase());
  if (!gone.length) return { ok: true };
  for (const key of gone) delete all.agents[key];
  writeAll(all);
  return { ok: true };
}

/** The person applies the waiting addition: appended at the end, under who asked and when. */
function apply(agent, now) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readForWrite();
  if (all === UNREADABLE) return { ok: false, because: UNREADABLE_SAID };
  const rec = recOf(all, k);
  if (!rec || !rec.pending) return { ok: false, code: 'none', because: 'there is no addition waiting' };
  const cur = instructions.read(agent);
  if (!cur || !cur.exists) return { ok: false, because: (cur && cur.because) || 'these instructions could not be read' };
  const before = String(cur.text == null ? '' : cur.text);
  const p = rec.pending;
  const after = before.replace(/\s*$/, '') + '\n\n' + headingLine(p.askedBy, p.askedAt) + '\n\n' + p.text.replace(/\s*$/, '') + '\n';
  let res;
  try {
    res = instructions.write(agent, after, cur.version, undefined, { who: 'person', because: `You added a section ${p.askedBy} asked for` });
  } catch (e) {
    return { ok: false, because: (e && e.message) || 'the instructions could not be saved' };
  }
  const version = res && res.version ? res.version : instructions.read(agent).version;
  rec.last = { appliedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(), askedBy: p.askedBy, before, version };
  delete rec.pending;
  all.agents[k] = rec;
  try {
    writeAll(all);
  } catch {
    /* Review 2: the instructions changed but the record of it did not, so the addition is still "waiting" and a retry
       would add it twice, with no Undo. Take it back out (only if nothing else wrote since), and say so. */
    try { instructions.write(agent, before, version, undefined, { who: 'person', because: 'Kosmos took back an addition it could not record' }); } catch { /* reported below */ }
    return { ok: false, because: 'Kosmos could not record the addition, so it was taken back out; nothing changed. Try again' };
  }
  return { ok: true, last: publicLast(agent, rec.last) };
}

/** What the page shows about the last applied addition: when, who asked, and whether Undo is still possible. */
function publicLast(agent, last) {
  if (!last) return null;
  let undoable = false;
  // Review 1: an earlier text below the instructions' minimum could never be written back, so Undo is not offered.
  const restorable = typeof last.before === 'string' && last.before.trim().length >= instructions.MIN_CHARS;
  try { undoable = restorable && !last.undoneAt && instructions.read(agent).version === last.version; } catch { undoable = false; }
  return { appliedAt: last.appliedAt, askedBy: last.askedBy, undoable, undone: Boolean(last.undoneAt) };
}

/** The person undoes the last addition: the text from just before it, only if nothing was edited since. */
function undo(agent) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readForWrite();
  if (all === UNREADABLE) return { ok: false, because: UNREADABLE_SAID };
  const rec = recOf(all, k);
  const last = rec && rec.last;
  if (!last || last.undoneAt) return { ok: false, code: 'none', because: 'there is no addition to undo' };
  const cur = instructions.read(agent);
  if (!cur || cur.version !== last.version) {
    return { ok: false, code: 'edited', because: 'the instructions were edited after the addition, so it cannot be undone here' };
  }
  try {
    instructions.write(agent, last.before, last.version, undefined, { who: 'person', because: `You took out the section ${last.askedBy} asked for` });
  } catch (e) {
    return { ok: false, because: (e && e.message) || 'the instructions could not be saved' };
  }
  last.undoneAt = new Date().toISOString();
  rec.last = last;
  all.agents[k] = rec;
  writeAll(all);
  return { ok: true };
}

/** The page's read: the waiting addition and the last applied one. */
function state(agent) {
  const k = keyFor(agent);
  if (!k) return { pending: null, last: null };
  const all = readAll();
  if (all === UNREADABLE) return { pending: null, last: null, unreadable: true };
  const rec = recOf(all, k) || {};
  return { pending: rec.pending || null, last: publicLast(agent, rec.last) };
}

module.exports = { get FILE() { return file(); }, MAX_TEXT_BYTES, headingLine, pending, propose, dismiss, apply, undo, state, forget, unreadable };
