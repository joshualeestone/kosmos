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
 * the version just read, so a concurrent edit is refused rather than overwritten. It keeps the text from just before
 * and the version it wrote; Undo puts that text back only while the file is still that version.
 */

const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const instructions = require('./instructions');

const FILE = path.join(store.ROOT, 'instruction-adds.json');
const MAX_TEXT_BYTES = 16 * 1024;

function readAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return parsed && typeof parsed === 'object' && parsed.agents && typeof parsed.agents === 'object' ? parsed : { agents: {} };
  } catch { return { agents: {} }; }
}

function writeAll(all) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all) + '\n');
  fs.renameSync(tmp, FILE);
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
  const rec = readAll().agents[k];
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
  const all = readAll();
  const rec = all.agents[k] || {};
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
  const all = readAll();
  const rec = all.agents[k];
  if (!rec || !rec.pending) return { ok: false, code: 'none', because: 'there is no addition waiting' };
  delete rec.pending;
  all.agents[k] = rec;
  writeAll(all);
  return { ok: true };
}

/** The person applies the waiting addition: appended at the end, under who asked and when. */
function apply(agent, now) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readAll();
  const rec = all.agents[k];
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
  writeAll(all);
  return { ok: true, last: publicLast(agent, rec.last) };
}

/** What the page shows about the last applied addition: when, who asked, and whether Undo is still possible. */
function publicLast(agent, last) {
  if (!last) return null;
  let undoable = false;
  try { undoable = instructions.read(agent).version === last.version; } catch { undoable = false; }
  return { appliedAt: last.appliedAt, askedBy: last.askedBy, undoable, undone: Boolean(last.undoneAt) };
}

/** The person undoes the last addition: the text from just before it, only if nothing was edited since. */
function undo(agent) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readAll();
  const rec = all.agents[k];
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
  const rec = readAll().agents[k] || {};
  return { pending: rec.pending || null, last: publicLast(agent, rec.last) };
}

module.exports = { FILE, MAX_TEXT_BYTES, headingLine, pending, propose, dismiss, apply, undo, state };
