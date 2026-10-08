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
 *     can be personal), and only by the world being enrolled. Every request is ALSO signed by this Kosmos's Kosmos+
 *     identity (engine/remote.js, its key in <world root>/remote), which is stable across a retired world id;
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
const JOIN_UNKNOWN_FILE = 'org-join-unknown.json';   // { at, consentHash, move }: a join whose outcome is not known yet (review 25)
const LEAVE_REFUSED_FILE = 'org-leave-refused.json';   // { at, name }: a retried leave was refused as the last admin (the screen says so once)
const STOPPED_FILE = 'org-stopped.json';   // { at, name }: the company stopped naming this world (the screen says so once)
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
    try { fs.writeFileSync(tmp, id + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
    catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ } throw e; }
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
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(rec) + '\n', { mode: 0o600 }); fs.renameSync(tmp, file); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ } throw e; }
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
/* 🛑 THE GATE FOR EVERY SENDER (E0.3 rollup, E0.6 backup): mayReport, NOT isEnrolledHere. A record can be enrolled here
   with no consent recorded on this side: one re-adopted by refresh after a move that could not be written, or rebuilt
   from the company's answer after a last-admin refusal. Those carry no consentHash, and nothing is sent under them
   until the person has seen and accepted the words here (review 27). isEnrolledHere answers "is this the work Kosmos";
   mayReport answers "may it send". */
function mayReport(opts) {
  if (!isEnrolledHere(opts)) return false;
  const rec = readEnrollment(opts);
  return !!rec && typeof rec.consentHash === 'string' && /^[0-9a-f]{64}$/.test(rec.consentHash);
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
/* A stable hash of the consent words exactly as cleaned and shown (key order fixed). */
function consentHash(consent) {
  const c = consent || {};
  const canon = JSON.stringify(['reports', 'backsUp', 'readers', 'never'].map((k) => [k, Array.isArray(c[k]) ? c[k] : []]));
  return crypto.createHash('sha256').update(canon).digest('hex');
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
  org_already_member: 'You are already in this company. Check the code again to see what moving your work Kosmos here means.',
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
function sayFor(because, fallback, secret) {
  const c = codeOf(because);
  if (c && SAY[c]) return SAY[c];
  if (because) {
    const { externalName } = require('./externalname');
    let line = String(because);
    line = line.replace(/[0-9a-f]{32,}/gi, '[id]').replace(/[^\s@"'<>]+@[^\s@"'<>]+\.[A-Za-z]{2,}/g, '[email]');   // hex ids and email addresses too
    if (typeof secret === 'string' && secret.length >= 6) {   // a code is single-use: never in a log, in any case
      line = line.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[join code]');
    }
    console.error('orgenroll: ' + externalName(line, LINE_MAX));
  }
  return fallback;
}

async function signed(method, route, body, opts) {
  const remote = remoteFor(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, notSent: true, because: 'Kosmos+ is not available here' };
  try {
    const r = await remote.macRequest(method, route, body);
    return r && typeof r === 'object' ? r : { ok: false, because: 'no answer' };
  } catch (e) { return { ok: false, because: String(e && e.message || e) }; }
}

/* What a code is for: the company, the role, and the consent words. Binds nothing. */
async function preview(code, opts) {
  if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'That is not a join code. Check it and try again.' };
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
  if (!r.ok) return { ok: false, code: codeOf(r.because), because: sayFor(r.because, 'The code could not be checked through Kosmos+ just now. Nothing was joined; try again in a minute.', code.trim()) };
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const consent = cleanConsent(r.data && r.data.consent);
  if (!org || !role || !consent) return { ok: false, because: 'Your company\'s answer was not complete, so nothing was joined.' };
  return { ok: true, org, role, consent };
}

/* enroll, leave and refresh read and write the same record: one at a time, so the daily pass can never act on a
   record a leave has just cleared and is about to restore (or the reverse). */
let queue = Promise.resolve();
function oneAtATime(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

/* A first join the company made but this Kosmos will not keep (it cannot record it, or the company did not confirm this
   Kosmos) is undone with a leave, and each says only what happened (reviews 12, 19). */
async function undoFirstJoin(lead, opts) {
  const undo = await signed('POST', ROUTES.leave, {}, opts);
  // org_code_used: the code is spent, so the route keeps no ticket for it and the page goes back to the code field.
  if (undo.ok || codeOf(undo.because) === 'org_not_member') return { ok: false, code: 'org_code_used', because: lead + ' Joining was undone, so nothing was joined. That code is used up: ask your company for a new one.' };
  setLeavePending(true, opts, null, true);   // an undo, retried on the next pass if this file, at least, can be written
  // A code: the code may be spent, so no ticket is kept for it and the page goes back to the code field (review 25).
  return { ok: false, code: 'org_undo_pending', because: lead + ' Joining could not be undone yet, so your company may still list this Kosmos. It is not reporting.' };
}

/* Enroll THIS world. Sends nothing unless the person accepted. `code` is required for a first join and omitted when an
   existing member moves the enrollment to this world. */
async function enroll(code, accepted, opts) { return oneAtATime(() => enrollNow(code, accepted, opts)); }
async function enrollNow(code, accepted, opts) {
  if (accepted !== true) return { ok: false, declined: true, because: 'Not accepted, so nothing was sent.' };
  const world = worldId(opts);
  if (!world) return { ok: false, because: "This Kosmos's data folder cannot be written, so nothing was sent." };
  const body = { world, accepted: true };
  if (code != null) {
    if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'That is not a join code. Check it and try again.' };
    body.code = code.trim();
  }
  let r = await signed('POST', ROUTES.enroll, body, opts);
  /* #5530 review 1: already in that company, a code is refused (409 org_already_member) and NOT spent, since it may be
     someone else's. The person has just accepted, so move the enrollment to this world the member's way: no code. */
  const move = !body.code;   // no code: a member moving the enrollment here, not a first join
  /* Already a member (they joined from another Kosmos since the preview): the code is refused and not spent. NOT moved
     on these words: the person read a first-join consent, not "make this Kosmos your work Kosmos, and your other work
     Kosmos stops". The page checks the code again, and the preview then shows the move wording (review 15). */
  if (!r.ok && body.code && codeOf(r.because) === 'org_already_member') {
    return { ok: false, code: 'org_already_member', because: SAY.org_already_member };
  }
  const secretCode = typeof code === 'string' ? code.trim() : null;
  if (!r.ok && codeOf(r.because)) return { ok: false, code: codeOf(r.because), because: sayFor(r.because, 'Joining did not go through Kosmos+ just now. Nothing was joined; try again in a minute.', secretCode) };   // refused with a reason: nothing bound
  /* Refused on this computer before anything was sent (not connected to Kosmos+, a register or Forget out, no
     Kosmos+ here): certainly nothing was joined, and the ticket stays (review 27). */
  if (!r.ok && r.notSent) return { ok: false, because: 'This Kosmos could not reach your company through Kosmos+ just now. Nothing was sent, so nothing was joined; try again in a minute.' };
  if (!r.ok) {
    /* #5531 review 19: no reason (a tunnel timeout) says nothing about whether the company already bound this world.
       Ask once. Bound here: the person accepted, so it is recorded as a join. Bound to this world elsewhere: undone.
       Anything else stays UNKNOWN, kept on disk for the follow-up (every two minutes while it lasts): a status read
       straight after a timeout can come before the company saved the join, so "not bound" now is not "not bound"
       (reviews 25, 27). */
    sayFor(r.because, '', secretCode);   // the raw line goes to the log, cleaned
    const st = await signed('POST', ROUTES.status, {}, opts);
    const verdict = statusVerdict(st.ok ? st.data : null, world);
    if (verdict === 'notHere' && !move && namesThisWorld(st.ok ? st.data : null, world)) return undoFirstJoin('Your company did not confirm this Kosmos, so it is not your work Kosmos.', opts);
    if (verdict !== 'here') {
      const hash = opts && typeof opts.consentHash === 'string' && /^[0-9a-f]{64}$/.test(opts.consentHash) ? opts.consentHash : null;
      setJoinUnknown({ consentHash: hash, move }, opts);
      return { ok: false, unknown: true, code: 'org_join_unknown', because: 'It is not known yet whether joining went through. This Kosmos will ask your company again in a few minutes, and this screen will show what it learns.' };
    }
    r = { ok: true, data: st.data };
  }
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const en = r.data && r.data.enrolled;
  /* #5530 review 2: thisComputer says the CALLING signer is the enrolled one. It catches a world id copied WITHOUT the
     Kosmos+ key, or a computer that registered its own key. A full copy of the data folder also carries the key
     (<world root>/remote), and is then the same signer to the company: this check cannot tell it apart (review 13). */
  /* The company said yes but did not confirm THIS Kosmos, so it is not recorded. The code is spent, so a first join is
     undone exactly as an unrecordable one is (review 19); a move is not (it would end the existing membership). */
  if (!org || !role || !en || en.world !== world || en.thisComputer !== true) {
    const NOCONFIRM = 'Your company did not confirm this Kosmos, so it is not your work Kosmos.';
    if (move) return { ok: false, because: NOCONFIRM + ' Check the code again in a minute.' };
    return undoFirstJoin(NOCONFIRM, opts);
  }
  const rec = { org, role, world, enrolledAt: new Date().toISOString() };
  // The consent the person was shown, as a hash: what they accepted is then a checkable fact on this side (#5531 review 10).
  if (opts && typeof opts.consentHash === 'string' && /^[0-9a-f]{64}$/.test(opts.consentHash)) rec.consentHash = opts.consentHash;
  try { writeEnrollment(rec, opts); } catch {
    try { writeEnrollment(rec, opts); } catch {   // once more: a passing error (a full disk freeing up)
      /* The company now enrolls this world, but this Kosmos cannot record it, so it would never report and never show
         Leave (review 12). A FIRST join is undone with a leave. A MOVE is not: the person was a member before, and a
         leave would end that membership too (review 13). Each says only what actually happened. */
      const NOWRITE = "This Kosmos's data folder could not be written.";
      if (move) return { ok: false, because: NOWRITE + ' Your company now names this Kosmos as your work Kosmos, but it is not reporting. Fix the folder, then check the code again.' };
      return undoFirstJoin(NOWRITE, opts);
    }
  }
  setLeavePending(false, opts);   // joined again after an unconfirmed leave: that old leave must never be sent now
  setStopped(null, opts); setLeaveRefused(null, opts); setJoinUnknown(null, opts);
  return { ok: true, ...rec };
}

/* The pending leave keeps the record it cleared, so a retry the company refuses (the last admin) can put it back.
   Owner-only, read by this module alone: no route hands it, or the org id and world id inside it, to the page. */
/* `undo` marks the leave that takes back this Kosmos's OWN first join (one it could not keep): that one is sent while the
   account is a member at all, not only when the company names this world, since the company's not naming it here is
   exactly why it is being undone (#5531 review 21). */
function setLeavePending(on, opts, rec, undo) {
  const file = path.join(storeRoot(opts), LEAVE_PENDING_FILE);
  try { if (on) fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), rec: rec || null, undo: undo === true }) + '\n', { mode: 0o600 }); else fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}
function pendingUndo(opts) {
  try { return JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')).undo === true; } catch { return false; }
}
/* A retried leave the company refused as the last admin puts the enrollment back, so this Kosmos reports again. The
   person was told it had stopped, so the screen's next read says once that it did not (#5531 review 21). */
/* A join that got no answer, and a status that could not say: the company may hold this world while nothing here
   follows it up. This marker makes the next start or daily pass ask once more (#5531 review 25). */
function setJoinUnknown(info, opts) {
  const file = path.join(storeRoot(opts), JOIN_UNKNOWN_FILE);
  try {
    if (!info) { fs.rmSync(file, { force: true }); return; }
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), consentHash: info.consentHash || null, move: info.move === true }) + '\n', { mode: 0o600 });
  } catch { /* best effort */ }
}
function joinUnknown(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), JOIN_UNKNOWN_FILE), 'utf8')); return j && typeof j === 'object' ? j : null; }
  catch { return null; }
}
function leaveRefusedFor(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_REFUSED_FILE), 'utf8')); return j && typeof j.name === 'string' ? j.name : null; }
  catch { return null; }
}
function setLeaveRefused(name, opts) {
  const file = path.join(storeRoot(opts), LEAVE_REFUSED_FILE);
  try { if (name == null) fs.rmSync(file, { force: true }); else fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), name }) + '\n', { mode: 0o600 }); } catch { /* the screen just does not say it */ }
}
function clearLeaveRefused(opts) { setLeaveRefused(null, opts); }
function pendingRecord(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')); return j && j.rec && j.rec.org ? j.rec : null; } catch { return null; }
}
/* Why this world stopped without the person leaving here: the company no longer names it. The screen's next read of
   GET /api/org shows it once and clears it; a join or a leave also clears it. */
function stoppedFor(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), STOPPED_FILE), 'utf8')); return j && typeof j.name === 'string' ? j.name : null; }
  catch { return null; }
}
function clearStopped(opts) { setStopped(null, opts); }
function setStopped(name, opts) {
  const file = path.join(storeRoot(opts), STOPPED_FILE);
  try {
    if (name == null) { fs.rmSync(file, { force: true }); return; }
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), name }) + '\n', { mode: 0o600 });
  } catch { /* the screen just does not say it */ }
}
function leavePending(opts) { return fs.existsSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE)); }

/* Leave the company. The record is cleared first, so this world stops reporting at once, whatever the answer.
   - The company refused for good while you are still in it (org_last_admin): the record comes back, and the page
     keeps showing you joined, because you are.
   - Already not a member (org_not_member): left.
   - No answer: a pending leave is kept, and the next start or daily pass sends it again. */
async function leave(opts) { return oneAtATime(() => leaveNow(opts)); }

/* A join whose outcome was unknown (review 25): ask once. Bound here: the person accepted, so it is recorded with the
   consent they were shown. A first join bound to this world elsewhere: undone, as the answered path does. Not bound:
   the marker goes. Unclear: kept for the next pass. */
async function settleUnknownJoin(unsure, opts) {
  const world = readWorldId(opts);
  const st = await signed('POST', ROUTES.status, {}, opts);
  const d = st.ok ? st.data : null;
  const verdict = statusVerdict(d, world);
  if (verdict === 'unclear') return { ok: false, enrolled: false, because: "Your company's answer was not complete." };
  setJoinUnknown(null, opts);
  if (verdict === 'here') {
    const org = cleanOrg(d.org), role = cleanRole(d.role);
    if (!org || !role) return { ok: false, enrolled: false, because: "Your company's answer was not complete." };
    const rec = { org, role, world, enrolledAt: new Date().toISOString() };
    if (unsure.consentHash) rec.consentHash = unsure.consentHash;
    try { writeEnrollment(rec, opts); } catch { setJoinUnknown(unsure, opts); return { ok: false, enrolled: false, because: "This Kosmos's data folder could not be written." }; }
    setStopped(null, opts);
    return { ok: true, enrolled: true, member: true, ...rec };
  }
  if (verdict === 'notHere' && !unsure.move && namesThisWorld(d, world)) {
    setLeavePending(true, opts, null, true);   // bound elsewhere: the undo is sent by the pending-leave path
    return leaveNow(opts, true);
  }
  return { ok: true, enrolled: false };
}
/* What a status answer says about THIS world, in one place (leave and refresh both read it, review 11):
   'here'    the company enrolls this world on this computer;
   'gone'    not a member at all;
   'notHere' a member, but enrolled nowhere, as another world, or as this world on another computer;
   'unclear' anything else (a field missing, an unreadable local id): change nothing. */
/* The company names this world (on this computer or another), or no world at all: what a join of this world left. */
function namesThisWorld(d, world) {
  if (!d || d.member !== true || !world) return false;
  return d.enrolled === null || (!!d.enrolled && typeof d.enrolled === 'object' && d.enrolled.world === world);
}
function statusVerdict(d, world) {
  if (!d || typeof d !== 'object') return 'unclear';
  if (d.member === false) return 'gone';
  if (d.member !== true) return 'unclear';
  const e = d.enrolled;
  if (e === null) return 'notHere';
  if (!e || typeof e !== 'object' || typeof e.world !== 'string' || !world) return 'unclear';
  if (e.world === world && e.thisComputer === true) return 'here';
  if (e.world !== world || e.thisComputer === false) return 'notHere';
  return 'unclear';
}

/* Retire this world's id whenever its enrollment ends for good, so the old id is never sent again. This does NOT make a
   later join unlinkable: every org request is signed by this computer's Kosmos+ identity, under the same account. */
function retireWorldId(opts) {
  try { fs.rmSync(path.join(storeRoot(opts), WORLD_ID_FILE), { force: true }); } catch { /* kept; harmless */ }
}

async function leaveNow(opts, retry) {
  /* Leave ends the whole membership, so only the world the company enrolls (or one whose leave is unconfirmed) sends
     it. A world the company already stopped naming, or a stale record naming another world, clears locally and sends
     NOTHING: the membership may now be another world's or another computer's, and must not be ended from here. */
  if (!isEnrolledHere(opts) && !leavePending(opts)) {
    /* The id goes too, as on every other ending: kept, the next daily pass could find the company naming this world and
       quietly take the enrollment back with no consent shown here (#5531 review 18). */
    clearEnrollment(opts); setStopped(null, opts); retireWorldId(opts);
    return { ok: true, localOnly: true };
  }
  const before = readEnrollment(opts) || pendingRecord(opts);
  const undo = pendingUndo(opts);
  setLeaveRefused(null, opts);
  clearEnrollment(opts);   // stop at once, whatever happens next
  /* Ask first. A leave ends the WHOLE membership (by account, not by computer), so it is sent only when the company
     confirms this world AND this signer. That stops a stale record, a moved enrollment, and a copy whose Kosmos+ key
     was re-registered; a full copy that carries the key is the same signer and is NOT stopped here (review 13). A clear answer
     that this is not the enrolled world clears locally and sends nothing; no answer leaves it pending, asked again. */
  const st = await signed('POST', ROUTES.status, {}, opts);
  const verdict = statusVerdict(st.ok ? st.data : null, readWorldId(opts));
  if (verdict === 'gone') { setLeavePending(false, opts); setStopped(null, opts); retireWorldId(opts); return { ok: true }; }
  /* A pending undo is sent only while the company still names THIS world (on any computer) or no world at all: that
     is the join being undone. Enrolled as ANOTHER world, the membership is one the person set up since, from another
     Kosmos, and must not be ended from here (#5531 review 23). */
  const undoSend = undo && verdict === 'notHere' && namesThisWorld(st.ok ? st.data : null, readWorldId(opts));
  if (verdict === 'notHere' && !undoSend) {   // still a member, enrolled elsewhere: this world stops and forgets its id, nothing is sent
    setLeavePending(false, opts); setStopped(null, opts); retireWorldId(opts);
    return { ok: true, localOnly: true };
  }
  if (verdict !== 'here' && !undoSend) {
    setLeavePending(true, opts, before, undo);
    return { ok: false, pending: true, because: 'Leaving could not be confirmed yet. This Kosmos has stopped reporting, and it will tell your company again.' };
  }
  const r = await signed('POST', ROUTES.leave, {}, opts);
  const code = r.ok ? null : codeOf(r.because);
  if (r.ok || code === 'org_not_member') {
    setLeavePending(false, opts); setStopped(null, opts);
    retireWorldId(opts);   // left for good
    return { ok: true };
  }
  if (code === 'org_last_admin') {
    /* Still enrolled here: the record goes back. With none left (a first join this Kosmos could not record, whose undo
       also failed), it is rebuilt from the status answer that just confirmed this world. If it cannot be written, the
       leave stays pending, so the next pass asks again rather than nothing ever asking (#5531 review 17). */
    const d = st.data || {};
    const org = cleanOrg(d.org), role = cleanRole(d.role);
    // Rebuilt only when the company named this world HERE: an undo's notHere must never become a record (review 23).
    const back = before || (verdict === 'here' && org && role ? { org, role, world: readWorldId(opts), enrolledAt: new Date().toISOString() } : null);
    let kept = false;
    if (back) { try { writeEnrollment(back, opts); kept = true; } catch { /* below */ } }
    setLeavePending(!kept, opts, back, undo);
    // Told "stopped" earlier: say it is not. Only for the person's own leave: an undo is not one they asked for (review 27).
    if (kept && retry && !undo) setLeaveRefused((back.org && back.org.name) || 'your company', opts);
    return { ok: false, still: true, code, because: SAY.org_last_admin };
  }
  setLeavePending(true, opts, before, undo);
  // The person's sentence, whatever the raw reason: they must hear that this Kosmos stopped and the leave will be sent.
  return { ok: false, pending: true, code, because: 'Leaving could not be confirmed yet. This Kosmos has stopped reporting, and it will tell your company again.' };
}

/* On start and daily: ask the coordinator. member:false, or an enrollment naming another world, clears this world's
   record (removed, left, or moved elsewhere). An unreachable coordinator changes nothing. */
async function refresh(opts) { return oneAtATime(() => refreshNow(opts)); }
async function refreshNow(opts) {
  if (leavePending(opts)) {   // a leave the company has not confirmed: send it again, report nothing meanwhile
    const r = await leaveNow(opts, true);
    if (r.still) return { ok: false, still: true, enrolled: isEnrolledHere(opts), code: r.code, because: r.because };   // refused as the last admin: joined again
    return { ok: r.ok, enrolled: false, stopped: true, pending: !!r.pending, because: r.because };
  }
  const before = readEnrollment(opts);
  if (before && joinUnknown(opts)) setJoinUnknown(null, opts);   // a record settles it: no follow-up beside one (review 27)
  const unsure = before ? null : joinUnknown(opts);
  if (unsure) return settleUnknownJoin(unsure, opts);
  /* No local world id: nothing can match, so nothing is asked (review 14). A missing id file means the record is stale
     (cleared here, sent nothing); one that exists but cannot be read is left alone, like any unclear answer. */
  if (!readWorldId(opts)) {
    if (before && !fs.existsSync(path.join(storeRoot(opts), WORLD_ID_FILE))) {
      clearEnrollment(opts);
      setStopped((before.org && before.org.name) || 'your company', opts);   // the screen says once that it stopped (review 22)
    }
    return { ok: false, because: 'This Kosmos has no id of its own.', enrolled: false };
  }
  const r = await signed('POST', ROUTES.status, {}, opts);
  if (!r.ok || !r.data || typeof r.data !== 'object') return { ok: false, because: sayFor(r && r.because, 'not checked'), enrolled: !!before };
  const d = r.data;
  const world = readWorldId(opts);
  /* Stop only on a CLEAR answer (statusVerdict 'gone' or 'notHere'). Any other shape changes nothing, like an
     unreachable coordinator: one odd reply must not end an enrollment the company still holds, with no way back. */
  const verdict = statusVerdict(d, world);
  if (verdict !== 'here') {
    if (verdict === 'unclear') return { ok: false, because: 'Your company\'s answer was not complete.', enrolled: !!before };
    if (before) { clearEnrollment(opts); setStopped((before.org && before.org.name) || 'your company', opts); retireWorldId(opts); }
    return { ok: true, enrolled: false, member: d.member === true, stopped: !!before, org: d.member === true ? cleanOrg(d.org) : null };
  }
  const org = cleanOrg(d.org);
  const role = cleanRole(d.role);
  if (!org || !role) return { ok: false, because: 'Your company\'s answer was not complete.', enrolled: !!before };
  const rec = { org, role, world, enrolledAt: (before && before.enrolledAt) || new Date().toISOString() };
  if (before && before.consentHash) rec.consentHash = before.consentHash;
  try { writeEnrollment(rec, opts); } catch { /* keep the old record; the next refresh tries again */ }
  return { ok: true, enrolled: true, member: true, ...rec };
}

module.exports = {
  ROUTES, WORLD_ID_FILE, ENROLLMENT_FILE, LEAVE_PENDING_FILE, CODE, SAY, codeOf,
  worldId, readEnrollment, leavePending, joinUnknown, mayReport, stoppedFor, clearStopped, leaveRefusedFor, clearLeaveRefused, consentHash, isEnrolledHere, cleanConsent, preview, enroll, leave, refresh,
};
