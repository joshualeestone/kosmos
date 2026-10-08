'use strict';
/**
 * kosmos#5531 (Enterprise E0.2, umbrella #5529): enroll ONE Kosmos (a world) on this computer into a company, with
 * the consent stated before anything binds. The coordinator side is #5530 (E0.1); its routes and shapes are contract
 * v1.3, agreed 2026-10-07 with the coordinator's owner (orgs-5530.md on kosmos-relay).
 *
 * 🔑 THE UNIT IS THE WORK KOSMOS, NOT THE PERSON (#5529 decision 1). Only the enrolled world ever reports or backs up;
 * the person's other Kosmoses on this computer never do. That holds three ways:
 *   - each world keeps its own data root (engine/worlds.js), so its id file and enrollment record live inside it and
 *     no other world can read or write them;
 *   - the world is named to the coordinator only by an OPAQUE id minted here (random, never the world's name, which
 *     can be personal), and only by the world being enrolled;
 *   - isEnrolledHere() is the gate every later sender (E0.3 telemetry, E0.6 backup) must pass: it is true only when
 *     this world's record names this world's id, and refresh() clears the record the moment the coordinator names a
 *     different world or says this account is no longer a member.
 *
 * 🔑 NOTHING BINDS BEFORE CONSENT. preview(code) asks the coordinator what the code is for and returns the consent
 * words it sends (so every board shows the same words, changed without an app release). It uses no code and makes no
 * membership. enroll(code, accepted) sends nothing at all unless `accepted === true`: declining is no request.
 *
 * Best-effort by contract: nothing here throws. Each call resolves to { ok: true, ... } or { ok: false, because }.
 * Signed through the tunnel's mac-request verb (engine/remote.js macRequest); the board holds no key.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROUTES = Object.freeze({
  redeem: '/v1/mac/org/redeem',
  enroll: '/v1/mac/org/enroll',
  leave: '/v1/mac/org/leave',
  status: '/v1/mac/org/status',   // a POST read with {}: the tunnel signs only POSTs with a JSON body (contract v1.2)
});
const WORLD_ID_FILE = 'org-world-id';
const ENROLLMENT_FILE = 'org-enrollment.json';
const LEAVE_PENDING_FILE = 'org-leave-pending';   // a leave the company has not confirmed yet; retried on start and daily
const NAME_MAX = 120;      // a company name or slug, as the page shows it
const LINE_MAX = 300;      // one consent line
const LINES_MAX = 12;      // lines in one consent list
const WORLD_ID = /^[0-9a-f]{32}$/;
/* A code is typed or pasted by a person (or comes from the join link's #code=). Kept to a bounded, plain shape so
   nothing else is ever signed and sent in its place. */
const CODE = /^[A-Za-z0-9_-]{6,128}$/;

function storeRoot(opts) {
  if (opts && opts.root) return opts.root;
  return require('./store').ROOT;
}
function remoteFor(opts) {
  if (opts && opts.remote) return opts.remote;
  try { return require('./remote'); } catch { return null; }
}

/* This world's opaque id: read, or minted once and kept in this world's own data root. Written whole (temp, then
   rename) with owner-only permission. Null when the root cannot be written (then nothing is sent). */
function worldId(opts) {
  const root = storeRoot(opts);
  const file = path.join(root, WORLD_ID_FILE);
  try {
    const have = fs.readFileSync(file, 'utf8').trim();
    if (WORLD_ID.test(have)) return have;
  } catch { /* not minted yet */ }
  const id = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(root, { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, id + '\n', { mode: 0o600 });
    fs.renameSync(tmp, file);
    return id;
  } catch { return null; }
}

/* The company this world is enrolled to, as last confirmed by the coordinator, or null. */
function readEnrollment(opts) {
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), ENROLLMENT_FILE), 'utf8'));
    if (!rec || typeof rec !== 'object' || !rec.org || typeof rec.org.id !== 'string' || !WORLD_ID.test(rec.world || '')) return null;
    return rec;
  } catch { return null; }
}
function writeEnrollment(rec, opts) {
  const file = path.join(storeRoot(opts), ENROLLMENT_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rec) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function clearEnrollment(opts) {
  try { fs.rmSync(path.join(storeRoot(opts), ENROLLMENT_FILE), { force: true }); } catch { /* already gone */ }
}

/* This world's id if it was ever minted; never mints (the gate and a page read must not write). */
function readWorldId(opts) {
  try { const have = fs.readFileSync(path.join(storeRoot(opts), WORLD_ID_FILE), 'utf8').trim(); return WORLD_ID.test(have) ? have : null; } catch { return null; }
}
/* 🛑 THE GATE for every later sender: true only for the world whose own record names its own id. NECESSARY, NOT
   SUFFICIENT: it is as fresh as the last refresh (daily), so the coordinator must also refuse a report from a world it
   no longer names (E0.3, E0.6). */
function isEnrolledHere(opts) {
  const rec = readEnrollment(opts);
  if (!rec) return false;
  const id = readWorldId(opts);
  return !!id && rec.world === id;
}

/* The coordinator's answers are not trusted for shape: kept to what the page shows, and only plain strings. */
/* A company admin chose these words, and they are shown in a sentence the person decides on ("X invites you to join"):
   cleaned as every outside name is (engine/externalname.js strips format and invisible characters, bidi overrides
   included, and bounds the length), so the screen cannot read differently from what was sent. */
function cleanOrg(o) {
  if (!o || typeof o !== 'object' || typeof o.id !== 'string' || !o.id || o.id.length > 128) return null;
  const { externalName } = require('./externalname');
  return { id: o.id, name: externalName(o.name, NAME_MAX), slug: externalName(o.slug, NAME_MAX) };
}
function cleanList(a) {
  if (!Array.isArray(a)) return [];
  const { externalName } = require('./externalname');
  return a.map((s) => externalName(s, LINE_MAX)).filter(Boolean).slice(0, LINES_MAX);
}
function cleanConsent(c) {
  if (!c || typeof c !== 'object') return null;
  const out = { reports: cleanList(c.reports), backsUp: cleanList(c.backsUp), readers: cleanList(c.readers), never: cleanList(c.never) };
  // A consent with nothing in it is no consent: the page must never offer Join on an empty statement.
  return (out.reports.length || out.backsUp.length) && out.readers.length ? out : null;
}
const ROLES = new Set(['member', 'recovery', 'admin']);
function cleanRole(r) { return ROLES.has(r) ? r : null; }

/* The coordinator's public error codes (#5530), said in plain words. The tunnel passes its answer through on the last
   line of `because`, so the code is found anywhere in it; anything unrecognised keeps its own words. */
const SAY = Object.freeze({
  org_code_unknown: 'That code is not one your company made. Check it, or ask your company for a new one.',
  org_code_used: 'That code has already been used. Ask your company for a new one.',
  org_code_expired: 'That code has expired. Ask your company for a new one.',
  org_other_org: 'This Kosmos+ account is already in another company.',
  org_wrong_domain: "Your company only takes accounts with its own email address, and this account's address is different.",
  org_not_member: 'You are not in a company.',
  org_last_admin: 'You are the last admin of your company, so you cannot leave until someone else is made an admin.',
  org_bad_world: 'This Kosmos could not be named to your company. Try again.',
  org_already_member: 'You are already in this company.',
});
/* Only the PUBLIC codes count: a field such as org_id elsewhere in the line must not be read as the error. */
const CODES = Object.freeze(Object.keys(SAY).concat(['org_not_accepted']));
function codeOf(because) {
  const text = String(because || '');
  for (const c of CODES) if (new RegExp('\\b' + c + '\\b').test(text)) return c;
  return null;
}
/* A public code becomes its sentence. Anything else (a tunnel's stderr line, a spawn error naming a path) goes to the
   log, cleaned and bounded, and the person reads a fixed sentence: raw transport text never reaches the page. */
function sayFor(because, fallback) {
  const c = codeOf(because);
  if (c && SAY[c]) return SAY[c];
  if (because) { const { externalName } = require('./externalname'); console.error('orgenroll: ' + externalName(String(because), LINE_MAX)); }
  return fallback;
}

async function signed(method, route, body, opts) {
  const remote = remoteFor(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, because: 'Kosmos+ is not available here' };
  try {
    const r = await remote.macRequest(method, route, body);
    return r && typeof r === 'object' ? r : { ok: false, because: 'no answer' };
  } catch (e) { return { ok: false, because: String(e && e.message || e) }; }
}

/* What a code is for: the company, the role, and the consent words. Binds nothing. */
async function preview(code, opts) {
  if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'that is not a join code' };
  const r = await signed('POST', ROUTES.redeem, { code: code.trim() }, opts);
  /* Contract v1.3: already in that company, the preview is refused (409 org_already_member) and status carries the
     consent for a member. Moving the enrollment to this world is still a bind, so it gets the same consent first:
     `move: true` tells the page to enroll with no code. */
  if (!r.ok && codeOf(r.because) === 'org_already_member') {
    const st = await signed('POST', ROUTES.status, {}, opts);
    const d = st.ok && st.data;
    const org = d && d.member === true ? cleanOrg(d.org) : null;
    const role = d ? cleanRole(d.role) : null;
    const consent = d ? cleanConsent(d.consent) : null;
    if (org && role && consent) return { ok: true, move: true, org, role, consent };
    return { ok: false, code: 'org_already_member', because: SAY.org_already_member };
  }
  if (!r.ok) return { ok: false, code: codeOf(r.because), because: sayFor(r.because, 'The code could not be checked through Kosmos+ just now. Nothing was joined; try again in a minute.') };
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const consent = cleanConsent(r.data && r.data.consent);
  if (!org || !role || !consent) return { ok: false, because: 'the answer was not complete, so nothing was joined' };
  return { ok: true, org, role, consent };
}

/* Enroll THIS world. Sends nothing unless the person accepted. `code` is required for a first join and omitted when an
   existing member moves the enrollment to this world. */
/* enroll, leave and refresh read and write the same record: one at a time, so the daily pass can never act on a
   record a leave has just cleared and is about to restore (or the reverse). */
let queue = Promise.resolve();
function oneAtATime(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

async function enroll(code, accepted, opts) { return oneAtATime(() => enrollNow(code, accepted, opts)); }
async function enrollNow(code, accepted, opts) {
  if (accepted !== true) return { ok: false, declined: true, because: 'not accepted, so nothing was sent' };
  const world = worldId(opts);
  if (!world) return { ok: false, because: "this Kosmos's data folder cannot be written" };
  const body = { world, accepted: true };
  if (code != null) {
    if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'that is not a join code' };
    body.code = code.trim();
  }
  let r = await signed('POST', ROUTES.enroll, body, opts);
  /* #5530 review 1: already in that company, a code is refused (409 org_already_member) and NOT spent, since it may be
     someone else's. The person has just accepted, so move the enrollment to this world the member's way: no code. */
  if (!r.ok && body.code && codeOf(r.because) === 'org_already_member') {
    delete body.code;
    r = await signed('POST', ROUTES.enroll, body, opts);
  }
  if (!r.ok) return { ok: false, code: codeOf(r.because), because: sayFor(r.because, 'Joining did not go through Kosmos+ just now. Nothing was joined; try again in a minute.') };
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const en = r.data && r.data.enrolled;
  /* #5530 review 2: thisComputer says the CALLING Mac is the enrolled one. A world's id can be copied to a second Mac
     with its data (a restored backup, Migration Assistant); only the Mac the company names reports. */
  if (!org || !role || !en || en.world !== world || en.thisComputer !== true) return { ok: false, because: 'the company did not confirm this Kosmos, so it is not enrolled' };
  const rec = { org, role, world, enrolledAt: new Date().toISOString() };
  try { writeEnrollment(rec, opts); } catch { return { ok: false, because: 'joined, but this Kosmos could not record it; check again' }; }
  setLeavePending(false, opts);   // joined again after an unconfirmed leave: that old leave must never be sent now
  return { ok: true, ...rec };
}

/* The pending leave keeps the record it cleared, so a retry the company refuses (the last admin) can put it back. */
function setLeavePending(on, opts, rec) {
  const file = path.join(storeRoot(opts), LEAVE_PENDING_FILE);
  try { if (on) fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), rec: rec || null }) + '\n', { mode: 0o600 }); else fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}
function pendingRecord(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')); return j && j.rec && j.rec.org ? j.rec : null; } catch { return null; }
}
function leavePending(opts) { return fs.existsSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE)); }

/* Leave the company. The record is cleared first, so this world stops reporting at once, whatever the answer.
   - The company refused for good while you are still in it (org_last_admin): the record comes back, and the page
     keeps showing you joined, because you are.
   - Already not a member (org_not_member): left.
   - No answer: a pending leave is kept, and the next start or daily pass sends it again. */
async function leave(opts) { return oneAtATime(() => leaveNow(opts)); }
async function leaveNow(opts) {
  const before = readEnrollment(opts) || pendingRecord(opts);
  clearEnrollment(opts);
  const r = await signed('POST', ROUTES.leave, {}, opts);
  const code = r.ok ? null : codeOf(r.because);
  if (r.ok || code === 'org_not_member') { setLeavePending(false, opts); return { ok: true }; }
  if (code === 'org_last_admin') {
    if (before) { try { writeEnrollment(before, opts); } catch { /* the next refresh restores it */ } }
    setLeavePending(false, opts);
    return { ok: false, still: true, code, because: SAY.org_last_admin };
  }
  setLeavePending(true, opts, before);
  // The person's sentence, whatever the raw reason: they must hear that this Kosmos stopped and the leave will be sent.
  return { ok: false, pending: true, code, because: 'Leaving could not be confirmed yet. This Kosmos has stopped reporting, and it will tell your company again.' };
}

/* On start and daily: ask the coordinator. member:false, or an enrollment naming another world, clears this world's
   record (removed, left, or moved elsewhere). An unreachable coordinator changes nothing. */
async function refresh(opts) { return oneAtATime(() => refreshNow(opts)); }
async function refreshNow(opts) {
  if (leavePending(opts)) {   // a leave the company has not confirmed: send it again, report nothing meanwhile
    const r = await leaveNow(opts);
    if (r.still) return { ok: false, still: true, enrolled: isEnrolledHere(opts), code: r.code, because: r.because };   // refused as the last admin: joined again
    return { ok: r.ok, enrolled: false, stopped: true, pending: !!r.pending, because: r.because };
  }
  const before = readEnrollment(opts);
  const r = await signed('POST', ROUTES.status, {}, opts);
  if (!r.ok || !r.data || typeof r.data !== 'object') return { ok: false, because: sayFor(r && r.because, 'not checked'), enrolled: !!before };
  const d = r.data;
  const world = worldId(opts);
  const here = d.member === true && d.enrolled && world && d.enrolled.world === world && d.enrolled.thisComputer === true;
  if (!here) {
    if (before) clearEnrollment(opts);
    return { ok: true, enrolled: false, member: d.member === true, stopped: !!before, org: d.member === true ? cleanOrg(d.org) : null };
  }
  const org = cleanOrg(d.org);
  const role = cleanRole(d.role);
  if (!org || !role) return { ok: false, because: 'the answer was not complete', enrolled: !!before };
  const rec = { org, role, world, enrolledAt: (before && before.enrolledAt) || new Date().toISOString() };
  try { writeEnrollment(rec, opts); } catch { /* keep the old record; the next refresh tries again */ }
  return { ok: true, enrolled: true, member: true, ...rec };
}

module.exports = {
  ROUTES, WORLD_ID_FILE, ENROLLMENT_FILE, LEAVE_PENDING_FILE, CODE, SAY, codeOf,
  worldId, readEnrollment, leavePending, isEnrolledHere, cleanConsent, preview, enroll, leave, refresh,
};
