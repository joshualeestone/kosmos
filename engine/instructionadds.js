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
 * this board). It keeps the exact span it wrote; the page and Undo read where that span stands from the file itself
 * (whereIs), and Undo takes out just that span while it is there exactly as written.
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

/* Two different failures, kept apart (review 3). A READ ERROR (EMFILE, EACCES, EIO...) is BUSY: probably passing, and
   the file may be fine, so a write refuses ("try again") and nothing is moved. A file that reads but cannot be PARSED is
   UNREADABLE (corrupt): never silently overwritten (review 1), and not a dead end either (review 2): the next write moves
   it aside (instruction-adds.json.unreadable-<time>, kept, never deleted) and records that in the fresh store, so the
   page can name the kept file. A missing file, an empty one, and `{}` are just empty. Entries live in a null-prototype
   map, so 'constructor' is just a key. */
const BUSY = Symbol('busy');
const BUSY_SAID = 'Kosmos could not read the file that holds waiting additions just now, so nothing was changed. Try again in a moment';
function readAll() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (e) { return e && e.code === 'ENOENT' ? { agents: Object.create(null) } : BUSY; }
  if (!raw.trim()) return { agents: Object.create(null) };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return UNREADABLE;
    const moved = typeof parsed.movedAside === 'string' ? { movedAside: parsed.movedAside, movedAt: typeof parsed.movedAt === 'string' ? parsed.movedAt : null } : {};
    if (parsed.agents === undefined) return Object.assign({ agents: Object.create(null) }, moved);
    if (!parsed.agents || typeof parsed.agents !== 'object' || Array.isArray(parsed.agents)) return UNREADABLE;
    return Object.assign({ agents: Object.assign(Object.create(null), parsed.agents) }, moved);
  } catch { return UNREADABLE; }
}
/* The store a WRITE may use: BUSY refuses (nothing moved); a CORRUPT one is moved aside (kept) and the fresh store
   remembers the kept file's name. */
function readForWrite() {
  const all = readAll();
  if (all !== UNREADABLE) return all;
  try {
    const aside = file() + '.unreadable-' + new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(file(), aside);
    /* Review 4: record the move at once, whatever the calling write goes on to do, so the page can always name it. */
    const fresh = { agents: Object.create(null), movedAside: path.basename(aside), movedAt: new Date().toISOString() };
    try { writeAll(fresh); } catch { /* not recorded: if no later write succeeds either, the kept file goes unnamed */ }
    return fresh;
  } catch { return BUSY; }
}
function failedRead(all) { return all === BUSY || all === UNREADABLE; }
function failSaid(all) { return all === BUSY ? BUSY_SAID : UNREADABLE_SAID; }
function recOf(all, k) { return all !== UNREADABLE && all !== BUSY && Object.prototype.hasOwnProperty.call(all.agents, k) ? all.agents[k] : null; }

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
function headingLine(askedBy, askedAt, id) {
  const d = new Date(askedAt);
  const day = Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : 'an unknown date';
  /* Review 4: the proposal's own id, in a comment line (an agent sees it, but it is not a rule), so "this exact addition
     is already at the end" can only ever mean THIS proposal (a re-proposal of the same words the same day is a different
     one). Proposals themselves may not hold comments (propose refuses them), so this line is always Kosmos's own. */
  return `## Added on ${day}, asked by ${askerWords(askedBy)}` + (id ? `\n<!-- kosmos addition ${id} -->` : '');
}
/* Review 10 (BLOCKER): the asker's name is an agent's own display name, read from ITS instructions, so it could carry a
   newline or Kosmos's comment markers into ANOTHER agent's file (a second managed block, or a forged id line). Written
   on one line, with no comment markers, at most 80 characters. */
function askerWords(askedBy) {
  /* Review 11: well-formed first (a lone surrogate is written to the file as U+FFFD while the record kept it, so the two
     never matched again), every line separator collapsed (U+0085 and U+001C-U+001E too), cut by code point. */
  const flat = String(askedBy == null ? '' : askedBy).toWellFormed().replace(/<!--|-->/g, ' ').replace(/[\s\u0085\u001c-\u001e]+/g, ' ').trim();
  const one = Array.from(flat).slice(0, 80).join('').trim();
  return one || 'another agent';
}
/** The exact text Apply writes for a pending addition (the leading blank lines included). */
function blockOf(p) {
  return '\n\n' + headingLine(p.askedBy, p.askedAt, p.id) + '\n\n' + String(p.text).replace(/\s*$/, '') + '\n';
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
  /* Review 11: well-formed, so the bytes written and the span recorded are the same text (see askerWords). */
  const body = String(text == null ? '' : text).toWellFormed();
  if (!body.trim()) return { ok: false, code: 'bad', because: 'the addition is empty' };
  /* Review 5: never Kosmos's own markers. An addition carrying `<!-- kosmos:projects:start -->` (or any comment) would
     give the target two managed blocks, and the projects / doctrine sync would stop for that agent for good. Refused as
     engine/catalogue.js refuses a role text with a comment, for the same reason. */
  if (body.includes('<!--') || body.includes('-->')) {
    return { ok: false, code: 'bad', because: 'the addition holds an HTML comment (<!-- or -->), which Kosmos uses for its own markers in instructions; take it out and propose again' };
  }
  if (Buffer.byteLength(body, 'utf8') > MAX_TEXT_BYTES) {
    return { ok: false, code: 'bad', because: `the addition is too long (at most ${MAX_TEXT_BYTES / 1024} KB)` };
  }
  const who = String(askedBy == null ? '' : askedBy).trim();
  if (!who) return { ok: false, code: 'bad', because: 'we could not tell which agent is asking' };
  const all = readForWrite();
  if (failedRead(all)) return { ok: false, code: 'bad', because: failSaid(all) };
  const rec = recOf(all, k) || {};
  if (rec.pending) return { ok: false, code: 'pending', pending: rec.pending, because: 'an addition is already waiting' };
  rec.pending = { text: body, askedBy: who, askedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(),
    id: require('node:crypto').randomBytes(6).toString('hex') };
  all.agents[k] = rec;
  writeAll(all);
  return { ok: true, pending: rec.pending };
}

/** The person dismisses the waiting addition. */
function dismiss(agent) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readForWrite();
  if (failedRead(all)) return { ok: false, because: failSaid(all) };
  const rec = recOf(all, k);
  if (!rec || !rec.pending) return { ok: false, code: 'none', because: 'there is no addition waiting' };
  /* Review 10: an Apply that wrote the file but could not record it leaves the addition both waiting and in the file.
     Dismissing then would leave it there with nothing on the page that says so or can take it out. */
  const { text } = readText(agent);
  if (whereIs(text, { block: blockOf(rec.pending) }) === 'here') {
    return { ok: false, code: 'applied', because: 'this addition is already in the instructions (an earlier Apply wrote it but could not record it). Press Apply to finish; Undo can then take it out' };
  }
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
  if (failedRead(all)) return { ok: false };
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
  if (failedRead(all)) return { ok: false, because: failSaid(all) };
  const rec = recOf(all, k);
  if (!rec || !rec.pending) return { ok: false, code: 'none', because: 'there is no addition waiting' };
  const cur = instructions.read(agent);
  if (!cur || !cur.exists) return { ok: false, because: (cur && cur.because) || 'these instructions could not be read' };
  const p = rec.pending;
  const block = blockOf(p);
  const curText = String(cur.text == null ? '' : cur.text);
  /* Review 3: IDEMPOTENT. If the file already holds exactly this addition (an earlier press wrote it but could not record
     it), it is only recorded now, never added a second time. Review 9: where the addition stands is read from the FILE
     (whereIs); if its id line is there but the addition is not there exactly as written (edited, copied), it is neither
     added again nor recorded. */
  const w = whereIs(curText, { block });
  if (w === 'changed') {
    return { ok: false, code: 'edited', because: 'this addition is already in the instructions but was changed or copied there, so Kosmos will not add it again. Remove it by hand if you want it gone, or Dismiss it' };
  }
  if (w !== 'here') {
    try {
      instructions.write(agent, curText.replace(/\s*$/, '') + block, cur.version, undefined, { who: 'person', because: `You added a section ${p.askedBy} asked for` });
    } catch (e) {
      return { ok: false, because: (e && e.message) || 'the instructions could not be saved' };
    }
  }
  /* `block`: the exact span written. Everything the page and Undo say is read from the file against it. */
  rec.last = { appliedAt: new Date(Number.isFinite(now) ? now : Date.now()).toISOString(), askedBy: p.askedBy, block };
  delete rec.pending;
  all.agents[k] = rec;
  try {
    writeAll(all);
  } catch {
    return { ok: false, code: 'unrecorded', because: 'The addition is in the instructions, but Kosmos could not record it. Press Apply again to finish; as long as the instructions are not changed first, it is not added a second time' };
  }
  return { ok: true, last: publicLast(agent, rec.last) };
}

/** What the page shows about the last applied addition: when, who asked, whether Undo can still work, and if not, why.
 *  Review 3: read from the FILE, not only the record: a file back at the earlier text is undone (even if recording the
 *  undo failed), and each reason Undo is not offered is told apart, so the page never says "edited" when nobody did. */
/* Rebase review: where the applied span sits in the current text, once and exactly; -1 when it is not there exactly
   once (taken out, edited, or duplicated by hand). */
/* Review 7: the span is matched from its heading line on, WITHOUT the blank lines Apply wrote in front of it. When the
   addition sits right after Kosmos's community block, projects.removeBlock (the community switch turned off, or a
   restart while not taking part) takes the blank lines on both sides of the block, so a match that needed them read
   as "edited" though nobody edited. */
function coreOf(block) { return typeof block === 'string' ? block.replace(/^\n+/, '') : ''; }
function spanAt(text, last) {
  const core = coreOf(last && last.block);
  if (!core || typeof text !== 'string') return -1;
  const at = text.indexOf(core);
  if (at === -1 || text.indexOf(core, at + 1) !== -1) return -1;
  return at === 0 || text[at - 1] === '\n' ? at : -1;
}
/* The text with the applied span taken out: the blank lines before it go with it. At the end of the file the end is
   trimmed to one newline (Apply trimmed the end before appending); in the middle, the gap that was in front of the
   addition now joins what was before it to what follows it. */
function withoutSpan(text, last) {
  const at = spanAt(text, last);
  if (at === -1) return null;
  const head = text.slice(0, at).replace(/\n+$/, '');
  const tail = text.slice(at + coreOf(last.block).length);
  if (!tail.trim()) return head.replace(/\s*$/, '') + '\n';
  return head + text.slice(head.length, at) + tail.replace(/^\n+/, '');
}
/* Review 9: where the applied addition stands, read from the file alone (never from the record, which can lag the file:
   a failed record write, or the person restoring an earlier version). 'here': exactly once as written; 'gone': its id
   line is not in the file (Undo, or taken out by hand); 'changed': the id line is there but the addition is not there
   exactly once as written; 'unread': the file could not be read. Proposals cannot hold comments (propose refuses them),
   so the id line is only ever Kosmos's own. */
/* Review 10: a TRACE of the addition is its heading line with its id line under it, or its heading with its text. A
   stray copy of the id line alone (quoted in a note) is not one, and deleting only the id line (it looks like clutter
   in an editor) leaves one. */
function tracesOf(block) {
  const core = coreOf(block);
  const end = core.indexOf(' -->');
  const pair = end === -1 ? '' : core.slice(0, end + 4);
  const heading = core.split('\n')[0];
  const body = pair ? core.slice(pair.length).trim() : '';
  return { pair, heading, body };
}
function whereIs(text, last) {
  if (typeof text !== 'string') return 'unread';
  if (withoutSpan(text, last) !== null) return 'here';
  const { pair, heading, body } = tracesOf(last && last.block);
  /* The heading and the text with only blank space between them: what deleting only the id line leaves. (Another
     addition with the same heading and words has its own id line between them, so it is not this one's trace.) */
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const traced = (pair && text.includes(pair)) || (heading && body && new RegExp(esc(heading) + '\\s*' + esc(body)).test(text));
  return traced ? 'changed' : 'gone';
}
function readText(agent) {
  let cur = null;
  try { cur = instructions.read(agent); } catch { cur = null; }
  return { cur, text: cur && cur.exists ? String(cur.text == null ? '' : cur.text) : null };
}
function publicLast(agent, last) {
  if (!last) return null;
  const { text } = readText(agent);
  const w = whereIs(text, last);
  let blocked = null;
  /* "short" is judged on the text Undo would actually write. */
  if (w === 'here') blocked = withoutSpan(text, last).trim().length < instructions.MIN_CHARS ? 'short' : null;
  else if (w === 'changed') blocked = 'edited';
  else if (w === 'unread') blocked = 'unknown';
  const undone = w === 'gone';
  return { appliedAt: last.appliedAt, askedBy: last.askedBy, undoable: w === 'here' && !blocked, undone, blocked };
}

/** The person undoes the last addition: takes out just that span, while it is there exactly as written. */
function undo(agent) {
  const k = keyFor(agent);
  if (!k) return { ok: false, because: 'that is not a name we can look up' };
  const all = readForWrite();
  if (failedRead(all)) return { ok: false, because: failSaid(all) };
  const rec = recOf(all, k);
  const last = rec && rec.last;
  if (!last) return { ok: false, code: 'none', because: 'there is no addition to undo' };
  /* Review 9: from the file, as the page reads it: taken out just as written, whatever else changed (Kosmos's own block
     refreshes since #5297, the person's edits elsewhere); refused when the addition itself changed. */
  const { cur, text } = readText(agent);
  const w = whereIs(text, last);
  if (w === 'gone') return { ok: false, code: 'none', because: 'that addition is no longer in the instructions' };
  if (w === 'unread') return { ok: false, because: (cur && cur.because) || 'these instructions could not be read' };
  if (w === 'changed') return { ok: false, code: 'edited', because: 'the addition was edited after it was added, so it cannot be undone here' };
  try {
    instructions.write(agent, withoutSpan(text, last), cur.version, undefined, { who: 'person', because: `You took out the section ${last.askedBy} asked for` });
  } catch (e) {
    return { ok: false, because: (e && e.message) || 'the instructions could not be saved' };
  }
  last.undoneAt = new Date().toISOString();   // a note for the record only; the page reads undone from the file
  rec.last = last;
  all.agents[k] = rec;
  try { writeAll(all); } catch { /* the addition is out of the file; the page reads it as undone from the file */ }
  return { ok: true };
}

/** The page's read: the waiting addition and the last applied one. */
function state(agent) {
  const k = keyFor(agent);
  if (!k) return { pending: null, last: null };
  const all = readAll();
  if (all === UNREADABLE) return { pending: null, last: null, unreadable: true };
  if (all === BUSY) return { pending: null, last: null, busy: true };
  const rec = recOf(all, k) || {};
  return { pending: rec.pending || null, last: publicLast(agent, rec.last), movedAside: all.movedAside || null, movedAt: all.movedAt || null };
}

module.exports = { get FILE() { return file(); }, MAX_TEXT_BYTES, headingLine, pending, propose, dismiss, apply, undo, state, forget };
