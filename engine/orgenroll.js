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
 *   - mayReport() is the gate every later sender (E0.3 telemetry, E0.6 backup) must pass: this world is the enrolled
 *     one (isEnrolledHere: its record names its own id; refresh() clears the record the moment the coordinator names a
 *     different world or says this account is no longer a member) AND the consent was accepted on this computer.
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
/* A join's outcome is settled as NOT made only once the marker is this old: a status read sooner can come before the
   company saved the join (review 29). A join found made here is recorded at once. */
const SETTLE_AFTER_MS = 2 * 60 * 1000;
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
/* The small marker files are written whole too (review 35): a torn pending leave would still count as pending but
   lose its undo flag and the consent it carries. */
function writeWhole(file, text) {
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try { fs.writeFileSync(tmp, text, { mode: 0o600 }); fs.renameSync(tmp, file); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ } throw e; }
}
const policyMod = (opts) => (opts && opts.orgpolicy) || require('./orgpolicy');

function clearEnrollment(opts) {
  try { fs.rmSync(path.join(storeRoot(opts), ENROLLMENT_FILE), { force: true }); } catch { /* already gone */ }
  // #5534 review 1: every end of an enrollment comes through here, so the company's policy ends with it.
  try { policyMod(opts).clear(); } catch { /* best effort */ }
}

/* This world's id if it was ever minted; never mints (the gate and a page read must not write). */
function readWorldId(opts) {
  try { const have = fs.readFileSync(path.join(storeRoot(opts), WORLD_ID_FILE), 'utf8').trim(); return WORLD_ID.test(have) ? have : null; } catch { return null; }
}
/* "Is this the work Kosmos": true only for the world whose own record names its own id. NOT the sender gate (that is
   mayReport, below, which also needs the consent recorded here). As fresh as the last refresh (daily), so the
   coordinator must also refuse a report from a world it no longer names (E0.3, E0.6). */
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
/* #5532 (contract v1.5): the salt the company serves for the computer print, from redeem or status, echoed on enroll.
   Hex, 16 to 64 whole bytes (engine/computerprint.js checks it again). */
function servedSalt(d) {
  const s0 = d && typeof d.computerSalt === 'string' ? d.computerSalt : '';
  return /^(?:[0-9a-fA-F]{2}){16,64}$/.test(s0) ? s0 : null;
}
/* The computer print for one request to the company, as fields to add to its body. `orgId` is the company this
   board's OWN record names (or, at enroll, the company whose consent the person accepted, which becomes the record's;
   review 39 refuses an answer naming any other). Never logged: only printFor's `because`, which holds no print or id.
   The read is synchronous and can block the board for up to five seconds while ioreg hangs; it runs on a join, a
   leave and the rollup tick, at most once a minute while reads fail and once an hour after giving up (accepted). */
const PRINT_ERR_SAID = new Set();
function printFields(salt, orgId) {
  if (typeof salt !== 'string' || !salt) return { send: 'none', fields: {} };   // no salt: an older company side; no print, nothing pinned
  const p = require('./computerprint').printFor(salt, orgId);
  if (p.send === 'print') return { send: 'print', fields: { computerPrint: p.print } };
  if (p.send === 'none' || p.send === 'later') return { send: p.send, fields: {} };
  // Once per salt and company in this process (rollup review 21): the rollup asks every five minutes.
  const key = salt + '|' + orgId;
  if (!PRINT_ERR_SAID.has(key)) { PRINT_ERR_SAID.add(key); console.error('orgenroll: no computer print: ' + p.because); }
  return { send: 'error', fields: {} };
}
/* The print for the rollup: from this world's record only. */
function reportPrint(opts) {
  const rec = readEnrollment(opts);
  return pinnedWait(rec && rec.computerSalt && rec.org ? printFields(rec.computerSalt, rec.org.id) : { send: 'none', fields: {} }, rec && rec.printPinned === true);
}
/* `none` (no reader, a block with no id, or a reader that gave up) is "send without a print" only when no print was
   pinned. Once one was, the company counts a missing print as a copy's and logs it against this computer, so the
   request WAITS for a read instead (rollup review 14). */
function pinnedWait(pf, pinned) { return pf.send === 'none' && pinned ? { send: 'later', fields: {} } : pf; }
/* The hash the COMPANY served with its words (contract v1.4): boards echo it, never recompute it, and the company
   compares the one an enroll sends with the one its rollup expects. Null from a company that serves none. */
function servedHash(d) {
  const h = d && typeof d.consentHash === 'string' ? d.consentHash : '';
  if (!/^[0-9a-f]{64}$/.test(h)) return null;
  /* The hash names the RAW words; the person is shown the CLEANED ones. Echoed only when cleaning changed nothing (same
     lists, same lines): otherwise it would vouch for words the person was not shown, and the join records none, so
     nothing is sent on them (consenthash review 4). */
  const raw = d.consent && typeof d.consent === 'object' ? d.consent : null;
  const shown = cleanConsent(raw);
  if (!raw || !shown) return null;
  for (const k of ['reports', 'backsUp', 'readers', 'never']) {
    if (!Array.isArray(raw[k])) return null;   // a non-list cleans to [] on both sides and would compare equal (review 5)
    const a = raw[k];
    if (a.length !== shown[k].length || a.some((line, i) => line !== shown[k][i])) return null;
  }
  return h;
}
/* A hash of the consent words as cleaned and shown (key order fixed). Not sent and not recorded by the board since
   contract v1.4 (the served hash is); kept for tests only. */
function consentHash(consent) {
  const c = consent || {};
  const parts = ['reports', 'backsUp', 'readers', 'never'].map((k) => [k, Array.isArray(c[k]) ? c[k] : []]);
  /* "Nothing is backed up." is shown words too: a stated empty list hashes apart from a hidden group. Added only when
     true, so every consent with a backed-up list (and every hash recorded before it) keeps its hash. */
  if (c.backsUpNone === true) parts.push(['backsUpNone', true]);
  const canon = JSON.stringify(parts);
  return crypto.createHash('sha256').update(canon).digest('hex');
}
function cleanConsent(c) {
  if (!c || typeof c !== 'object') return null;
  const out = { reports: cleanList(c.reports), backsUp: cleanList(c.backsUp), readers: cleanList(c.readers), never: cleanList(c.never) };
  /* The company SAID it backs up nothing: an explicit empty list. A missing field, a non-list, or lines that cleaned away
     to nothing are not that statement, and the page must not make it for the company (#5531 follow-up, review 1). */
  out.backsUpNone = Array.isArray(c.backsUp) && c.backsUp.length === 0;
  // A consent with nothing in it is no consent: the page must never offer Join on an empty statement.
  return (out.reports.length || out.backsUp.length) && out.readers.length ? out : null;
}
/* #5532: what the person accepted, kept BY ITS HASH in its own file, so every path that carries the hash (a lost answer
   settled later, an undo refused and rebuilt, the daily refresh) finds the same words without carrying them. The
   rollup sends only report lines found here for the hash on the enrollment record; no file, or another hash, sends
   nothing. Written before the enroll is sent, from the words the screen showed (the server's ticket). */
const CONSENT_FILE = 'org-consent.json';
/* Whether the accepted words name token usage. The coordinator refuses usage rows until its own words do
   (CONSENT_NAMES_USAGE, pinned on token/usage/cost), so the board keys on the same words: no line naming them, no
   usage leaves, whatever a reader could read.
   It is whole words, deliberately NARROWER than the coordinator's substring match, so a disagreement only withholds; it
   cannot see negation ("never your token usage"), since report lines describe what IS sent and the coordinator's own
   rule decides what it takes. */
const NAMES_USAGE = /\b(tokens?|usage|costs?)\b/i;
/* #5534 (slice 2): whether the accepted words name the company policy, so the rollup may carry the version this Kosmos
   applied and whether it refused one. The coordinator keeps the version exactly while its own words name "policy"
   (CONSENT_NAMES_POLICY); the same whole word here. Read from the words each time, so words accepted before this
   existed answer for themselves. */
const NAMES_POLICY = /\bpolicy\b/i;
/* Keyed BY HASH, a few kept (rollup review 10): a join that fails, or one from a stale page, must not overwrite the
   words held for the hash an existing record carries. */
const CONSENT_KEEP = 8;
function readConsents(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), CONSENT_FILE), 'utf8')); return j && typeof j.byHash === 'object' && j.byHash ? j : { byHash: {}, order: [] }; } catch { return { byHash: {}, order: [] }; }
}
function rememberConsent(hash, consent, opts) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || !consent || !Array.isArray(consent.reports)) return false;
  const reports = consent.reports.filter((l) => typeof l === 'string' && l);
  const all = readConsents(opts);
  const order = (Array.isArray(all.order) ? all.order : []).filter((h) => h !== hash && all.byHash[h]);
  order.push(hash);
  // The record's own hash is never dropped to make room.
  const held = readEnrollment(opts);
  const keep = held && held.consentHash;
  while (order.length > CONSENT_KEEP) { const i = order.findIndex((h) => h !== keep && h !== hash); if (i < 0) break; order.splice(i, 1); }
  const byHash = {};
  for (const h of order) byHash[h] = h === hash ? { reports, usageConsented: reports.some((l) => NAMES_USAGE.test(l)) } : all.byHash[h];
  try { writeWhole(path.join(storeRoot(opts), CONSENT_FILE), JSON.stringify({ byHash, order }) + '\n'); return true; } catch { return false; }
}
/* The accepted words for the hash on this world's record, or null: only while it may report (mayReport), and only when
   the remembered words are for exactly that hash. */
function acceptedConsent(opts) {
  if (!mayReport(opts)) return null;
  const rec = readEnrollment(opts);
  if (!rec) return null;
  const j = readConsents(opts).byHash[rec.consentHash];
  if (!j || !Array.isArray(j.reports)) return null;
  const reports = j.reports.filter((l) => typeof l === 'string' && l);
  return { reports, usageConsented: j.usageConsented === true, policyConsented: reports.some((l) => NAMES_POLICY.test(l)) };
}
/* The company refused a report because the words it holds for this member changed (rollup 409 org_consent_changed):
   the words on record here are no longer accepted words, so this Kosmos stops reporting until the person accepts the
   new ones (the joined view then says it sends nothing). The membership is untouched. */
function consentWithdrawn(opts, hash) {
  return oneAtATime(async () => {
    const rec = readEnrollment(opts);
    // Only the words the refused report was sent under: a join made while it was out keeps its own (rollup review 11).
    if (!rec || !rec.consentHash || rec.consentHash !== hash) return false;
    const next = Object.assign({}, rec); delete next.consentHash;
    try { writeEnrollment(next, opts); return true; } catch { return false; }
  });
}
// The coordinator's org.rs ROLES. reviewer (#5685, #5529) may view this work Kosmos's content, each view logged.
const ROLES = new Set(['member', 'recovery', 'reviewer', 'admin']);
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
  // v1.4: the words changed after this screen showed them (the enroll carried the hash of the old ones). Nothing joined.
  org_consent_changed: 'Your company changed what it would see since you checked. Nothing was joined. Check the code again to read the new words.',
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
    if (org && role && consent) return { ok: true, move: true, org, role, consent, served: servedHash(d), salt: servedSalt(d) };
    return { ok: false, code: 'org_already_member', because: SAY.org_already_member };
  }
  if (!r.ok) return { ok: false, code: codeOf(r.because), because: sayFor(r.because, 'The code could not be checked through Kosmos+ just now. Nothing was joined; try again in a minute.', code.trim()) };
  const org = cleanOrg(r.data && r.data.org);
  const role = cleanRole(r.data && r.data.role);
  const consent = cleanConsent(r.data && r.data.consent);
  if (!org || !role || !consent) return { ok: false, because: 'Your company\'s answer was not complete, so nothing was joined.' };
  return { ok: true, org, role, consent, served: servedHash(r.data), salt: servedSalt(r.data) };
}

/* #5531 follow-up: the consent words for the company this Kosmos is ALREADY the work Kosmos for, so a record with no
   consent recorded here (one re-adopted by refresh, or rebuilt after an undo) can accept them without leaving. Binds
   nothing: accepting goes through enroll with no code, which the coordinator records as a re-acceptance of the same
   world. Answered only while the company names THIS world here, for the company on this board's own record. */
async function reviewHere(opts) {
  const rec = readEnrollment(opts);
  if (!rec || !isEnrolledHere(opts)) return { ok: false, because: 'This Kosmos is not your work Kosmos, so there is nothing to review here.' };
  // Only for a Kosmos that sends nothing (orgreview review 3): one that reports has its words on record, and the plan
  // rejects a second path to the same state. The page hides the button too; this is the engine's own refusal.
  /* #5532 review 31: "already reports" by the SAME test /api/org uses (accepted words with report lines on record here),
     never by a consent hash alone: a Kosmos joined before its words were kept here, or whose words were withdrawn, has
     a hash and no words, and Review is its way back. */
  const acc = acceptedConsent(opts);
  if (acc && acc.reports.length > 0) return { ok: false, because: 'This Kosmos already has its company\'s words accepted here.' };
  const st = await signed('POST', ROUTES.status, {}, opts);
  if (!st.ok) return { ok: false, because: 'Your company could not be asked through Kosmos+ just now. Try again in a minute.' };
  const d = st.data;
  const org = d && d.member === true ? cleanOrg(d.org) : null;
  const role = d ? cleanRole(d.role) : null;
  const consent = d ? cleanConsent(d.consent) : null;
  // The words must be this record's company's, for this world: never another company's consent shown as this one's.
  if (!org || !rec.org || org.id !== rec.org.id || statusVerdict(d, readWorldId(opts)) !== 'here') {
    return { ok: false, because: 'Your company does not name this Kosmos as your work Kosmos right now, so there is nothing to accept here.' };
  }
  if (!role || !consent) return { ok: false, because: 'Your company\'s answer was not complete. Try again in a minute.' };
  /* Accepting records the words on the company's side only when the enroll carries the hash it served (contract v1.4;
     a codeless enroll records exactly the hash sent). With none to echo, Accept could not make this Kosmos report, so
     it is not offered (review 1). */
  const served = servedHash(d);
  if (!served) return { ok: false, because: 'Your company\'s words could not be confirmed on this computer, so they cannot be accepted here yet. Try again later.' };
  // #5532: the salt the company serves for the computer print rides the review too, so an Accept pins a print as a join does.
  return { ok: true, move: true, review: true, org, role, consent, served, salt: servedSalt(d) };
}

/* enroll, leave and refresh read and write the same record: one at a time, so the daily pass can never act on a
   record a leave has just cleared and is about to restore (or the reverse). */
let queue = Promise.resolve();
function oneAtATime(fn) { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; }

/* A first join the company made but this Kosmos will not keep (it cannot record it, or the company did not confirm this
   Kosmos) is undone with a leave, and each says only what happened (reviews 12, 19). */
async function undoFirstJoin(lead, opts) {
  // The print was pinned with this join's salt (#5532): a leave without it would be refused as a copy (org_device_changed).
  // Pinned only if the join actually sent a print (review 17): a computer with no readable id sent none, and waiting for
  // one would leave the undo pending forever.
  const pf = opts && opts.computerSalt && opts.orgId ? pinnedWait(printFields(opts.computerSalt, opts.orgId), opts.printSent === true) : { send: 'none', fields: {} };
  const undo = pf.send === 'later' || pf.send === 'error' ? { ok: false, because: 'no print yet' } : await signed('POST', ROUTES.leave, pf.fields, opts);
  // org_code_used: the code is spent, so the route keeps no ticket for it and the page goes back to the code field.
  if (undo.ok || codeOf(undo.because) === 'org_not_member') { retireWorldId(opts); return { ok: false, code: 'org_code_used', because: lead + ' Joining was undone, so nothing was joined. That code is used up: ask your company for a new one.' }; }
  setLeavePending(true, opts, null, true, opts && opts.consentHash);   // an undo, retried on the next pass if this file, at least, can be written
  // A code: the code may be spent, so no ticket is kept for it and the page goes back to the code field (review 25).
  return { ok: false, code: 'org_undo_pending', because: lead + ' Joining could not be undone yet, so your company may still list this Kosmos. It is not reporting.' };
}

/* Enroll THIS world. Sends nothing unless the person accepted. `code` is required for a first join and omitted when an
   existing member moves the enrollment to this world. */
async function enroll(code, accepted, opts) { return oneAtATime(() => enrollNow(code, accepted, opts)); }
async function enrollNow(code, accepted, opts) {
  if (accepted !== true) return { ok: false, declined: true, because: 'Not accepted, so nothing was sent.' };
  /* A review's Accept is for a Kosmos already enrolled HERE. If its record went while the words were open (another
     Kosmos took the enrollment and a refresh cleared it), the person read review words, never move words: refuse
     BEFORE anything is sent or any id is made (reviews 4 and 5), never fall through into a move. */
  const held = readEnrollment(opts);
  const asReview = !!(opts && opts.review === true && code == null);
  if (asReview && !(held && held.world === readWorldId(opts))) return { ok: false, code: 'org_not_here', because: 'This Kosmos is no longer your work Kosmos, so nothing was sent.' };
  const world = worldId(opts);
  if (!world) return { ok: false, because: "This Kosmos's data folder cannot be written, so nothing was sent." };
  const body = { world, accepted: true };
  /* v1.4: opts.consentHash is the hash the COMPANY served with the words the person accepted. It is the one option for
     that fact: sent here and recorded below, so what is recorded is always what was sent (consenthash review 3). The
     contract says boards echo it and never recompute it (the two encodings could drift). */
  if (opts && typeof opts.consentHash === 'string' && /^[0-9a-f]{64}$/.test(opts.consentHash)) body.consentHash = opts.consentHash;
  // The code first (review 10): a malformed one costs no hardware read.
  if (code != null) {
    if (typeof code !== 'string' || !CODE.test(code.trim())) return { ok: false, because: 'That is not a join code. Check it and try again.' };
    body.code = code.trim();
  }
  // The words go on disk before anything is sent, so whichever path later records this hash finds them (#5532).
  if (body.consentHash && !rememberConsent(body.consentHash, opts.consent, opts)) console.error('orgenroll: the accepted words could not be kept on disk; this Kosmos will not report until they are accepted again');
  /* #5532 (v1.5): the computer print, made with the salt the company served and the company being joined. A read that
     failed and is waiting to retry sends nothing yet (a join without the print would pin none, and a copy could then
     report); a malformed salt or company is a bug, said and not sent. */
  const salt = opts && typeof opts.computerSalt === 'string' ? opts.computerSalt : null;
  if (salt && opts.orgId) {
    const pf = printFields(salt, opts.orgId);
    // In a review the button is Accept (rollup review 33), as the no-confirm answer below already says.
    if (pf.send === 'later') return { ok: false, because: 'This Kosmos could not read this computer just now. Nothing was sent; press ' + (asReview ? 'Accept' : 'Join') + ' again in a minute.' };
    if (pf.send === 'error') return { ok: false, because: 'This Kosmos could not make its computer print, so nothing was sent.' };
    Object.assign(body, pf.fields, { computerSalt: salt });
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
  /* A review's Accept (this world already named here before it was pressed) is never a join, so none of the join words
     below fit it (orgreview reviews 1 and 2): every refusal is said in review words, and points at Accept or at the
     Review button, never at a code. A lost answer: a status read cannot tell whether the re-acceptance landed, because
     "here" was true either way, so nothing is recorded; accepting again is harmless. */
  const review = asReview;   // no code, so always a move; checked against this world's record before sending (above)
  if (!r.ok && review) {
    const c = codeOf(r.because);
    if (c === 'org_consent_changed') return { ok: false, code: c, because: 'Your company changed what it asks of this Kosmos since you read it. Nothing changed here. Press Review what your company sees to read the new words.' };
    // No longer in that company: a Review would be refused too, so do not send the person there (review 3).
    if (c === 'org_not_member' || c === 'org_other_org') return { ok: false, code: c, because: 'Your company says this account is no longer in it. Nothing changed on this computer.' };
    if (c) return { ok: false, code: c, because: 'Your company did not take the acceptance. Nothing changed on this computer. Press Review what your company sees to try again.' };
    if (r.notSent) return { ok: false, because: 'This Kosmos could not reach your company through Kosmos+ just now. Nothing was sent; press Accept again in a minute.' };
    return { ok: false, because: 'It is not known whether accepting reached your company. Nothing changed on this computer; press Accept again in a minute.' };
  }
  const secretCode = typeof code === 'string' ? code.trim() : null;
  // A move refused because the words changed: no code was typed, so say how to see them again (consenthash review 2).
  if (!r.ok && move && codeOf(r.because) === 'org_consent_changed') return { ok: false, code: 'org_consent_changed', because: 'Your company changed what it would see since you checked. Nothing moved. Type your join code again to read the new words.' };
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
    const d0 = st.ok ? st.data : null;
    /* "Here" counts as THIS join only for the company whose consent was accepted. A pending leave keeps this world's
       id, so the company can still name it here through the OLD membership: that is not this join landing, and taking
       it as one would record the old company on the new company's words and drop the leave asked for (review 37). */
    const wantOrg = opts && typeof opts.orgId === 'string' && opts.orgId ? opts.orgId : null;
    const sameOrg = !wantOrg || !!(d0 && d0.org && d0.org.id === wantOrg);
    const verdict = sameOrg ? statusVerdict(d0, world) : 'unclear';
    if (verdict === 'notHere' && !move && namesThisWorld(d0, world)) return undoFirstJoin('Your company did not confirm this Kosmos, so it is not your work Kosmos.', Object.assign({}, opts, { printSent: !!body.computerPrint }));
    if (verdict !== 'here') {
      const hash = opts && typeof opts.consentHash === 'string' && /^[0-9a-f]{64}$/.test(opts.consentHash) ? opts.consentHash : null;
      setJoinUnknown({ consentHash: hash, move, orgId: wantOrg, computerSalt: body.computerSalt || null, printPinned: !!body.computerPrint }, opts);
      return { ok: false, unknown: true, code: 'org_join_unknown', because: 'It is not known yet whether joining went through. This Kosmos will ask your company again in a few minutes; if joining went through, this screen will show it.' };
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
  /* The answer must also be for the company whose consent was accepted (review 39, as review 37 for a lost answer):
     another company's name on a yes is not this join, and its record would carry the wrong company's words. */
  const otherOrg = !!(org && opts && typeof opts.orgId === 'string' && opts.orgId && org.id !== opts.orgId);
  if (!org || !role || !en || en.world !== world || en.thisComputer !== true || otherOrg) {
    const NOCONFIRM = 'Your company did not confirm this Kosmos, so it is not your work Kosmos.';
    if (review) return { ok: false, because: 'Your company did not confirm this Kosmos, so nothing changed. Press Accept again in a minute.' };
    if (move) return { ok: false, because: NOCONFIRM + ' Press Join again in a minute.' };
    return undoFirstJoin(NOCONFIRM, Object.assign({}, opts, { printSent: !!body.computerPrint }));
  }
  // A review's Accept is not a new enrollment: it keeps the date this Kosmos joined (orgreview review 1).
  const prior = review ? held : null;
  const rec = { org, role, world, enrolledAt: prior && prior.world === world && typeof prior.enrolledAt === 'string' ? prior.enrolledAt : new Date().toISOString() };
  // The consent the person was shown, as a hash: what they accepted is then a checkable fact on this side (#5531 review 10).
  /* A print sent and NOT pinned (rollup review 16): the company says the salt is not the one on record, or its binding
     write failed, so this computer's reports would not match whatever print it holds. The join stands, but its words
     are not recorded as accepted here: it sends nothing (the joined view says so) until the person accepts again,
     which enrolls again with a fresh salt. */
  const printNotTaken = !!body.computerPrint && r.data && r.data.printPinned === false;
  if (printNotTaken) console.error('orgenroll: the company did not pin the computer print; not reporting until the words are accepted again');
  if (!printNotTaken && opts && typeof opts.consentHash === 'string' && /^[0-9a-f]{64}$/.test(opts.consentHash)) rec.consentHash = opts.consentHash;
  if (body.computerSalt) rec.computerSalt = body.computerSalt;   // the salt the pinned print was made with (#5532): leave and rollup use it
  /* Whether this join pinned a print: the company's own answer when it gives one (review 15: a print made with a salt
     it does not hold is not pinned, and waiting for one would stop reporting for nothing), else "a print was sent", the
     safe direction. Each enroll pins exactly what it sends (v1.5). */
  rec.printPinned = typeof (r.data && r.data.printPinned) === 'boolean' ? (r.data.printPinned && !!body.computerPrint) : !!body.computerPrint;
  try { writeEnrollment(rec, opts); } catch {
    try { writeEnrollment(rec, opts); } catch {   // once more: a passing error (a full disk freeing up)
      /* The company now enrolls this world, but this Kosmos cannot record it, so it would never report and never show
         Leave (review 12). A FIRST join is undone with a leave. A MOVE is not: the person was a member before, and a
         leave would end that membership too (review 13). Each says only what actually happened. */
      const NOWRITE = "This Kosmos's data folder could not be written.";
      if (review) return { ok: false, because: NOWRITE + ' Your company has your acceptance, but this Kosmos could not record it, so it is still not reporting. Fix the folder, then press Accept again.' };
      if (move) return { ok: false, because: NOWRITE + ' Your company now names this Kosmos as your work Kosmos, but it is not reporting. Fix the folder, then press Join again.' };
      return undoFirstJoin(NOWRITE, Object.assign({}, opts, { printSent: !!body.computerPrint }));
    }
  }
  setLeavePending(false, opts);   // joined again after an unconfirmed leave: that old leave must never be sent now
  setStopped(null, opts); setLeaveRefused(null, opts); setJoinUnknown(null, opts);
  /* #5534 review 3: joined to another company than the policy in force here (a move by code): the old company's policy
     ends now, whether or not the follow-up refresh reaches the new company. */
  if (org && org.id) endForeignPolicy(opts, org.id);
  return { ok: true, ...rec };
}

/* The pending leave keeps the record it cleared, so a retry the company refuses (the last admin) can put it back.
   Owner-only, read by this module alone: no route hands it, or the org id and world id inside it, to the page.
   `undo` marks the leave that takes back this Kosmos's OWN first join (one it could not keep): that one is sent while the
   account is a member at all, not only when the company names this world, since the company's not naming it here is
   exactly why it is being undone (#5531 review 21). */
function setLeavePending(on, opts, rec, undo, consentHash) {
  const file = path.join(storeRoot(opts), LEAVE_PENDING_FILE);
  // An undo keeps the consent the person accepted, so a join that cannot be undone is recorded WITH it (review 31).
  // A rewrite without a hash keeps the one already there (review 33): one unanswered retry must not drop it.
  const given = typeof consentHash === 'string' && /^[0-9a-f]{64}$/.test(consentHash) ? consentHash : null;
  const hash = given || (on && undo === true && pendingUndo(opts) ? pendingConsentHash(opts) : null);   // only an undo's own, carried forward
  /* #5532: where this leave's print comes from: the record's salt and company, else (an undo, with no record) the join's
     own, else the one this file already holds, so a rewrite never drops it. */
  const prior = on ? pendingPrintFrom(opts) : null;
  const printFrom = rec && rec.computerSalt && rec.org ? { salt: rec.computerSalt, orgId: rec.org.id, pinned: rec.printPinned === true }
    // an undo: pinned only when the join sent its print (review 17)
    : opts && typeof opts.computerSalt === 'string' && typeof opts.orgId === 'string' ? { salt: opts.computerSalt, orgId: opts.orgId, pinned: opts.printSent === true } : prior;
  try { if (on) writeWhole(file, JSON.stringify({ at: new Date().toISOString(), rec: rec || null, undo: undo === true, consentHash: hash, world: readWorldId(opts), printFrom: printFrom || null }) + '\n'); else fs.rmSync(file, { force: true }); } catch { /* best effort */ }
}
function pendingPrintFrom(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')); return j && j.printFrom && typeof j.printFrom.salt === 'string' && j.world === readWorldId(opts) ? j.printFrom : null; } catch { return null; }
}
function pendingConsentHash(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')); return j && j.consentHash && j.world === readWorldId(opts) ? j.consentHash : null; } catch { return null; }
}
function pendingUndo(opts) {
  try { return JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')).undo === true; } catch { return false; }
}
/* A join that got no answer, and a status that could not say: the company may hold this world while nothing here
   follows it up. This marker makes the next start or daily pass ask once more (#5531 review 25). */
function setJoinUnknown(info, opts) {
  const file = path.join(storeRoot(opts), JOIN_UNKNOWN_FILE);
  try {
    if (!info) { fs.rmSync(file, { force: true }); return; }
    writeWhole(file, JSON.stringify({ at: new Date().toISOString(), consentHash: info.consentHash || null, move: info.move === true, orgId: typeof info.orgId === 'string' ? info.orgId : null, computerSalt: typeof info.computerSalt === 'string' ? info.computerSalt : null, printPinned: info.printPinned === true }) + '\n');
  } catch { /* best effort */ }
}
function joinUnknownAge(opts) { const j = joinUnknown(opts); const t = j ? Date.parse(j.at || '') : NaN; return Number.isFinite(t) && t <= Date.now() ? Date.now() - t : null; }
function joinUnknown(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), JOIN_UNKNOWN_FILE), 'utf8')); return j && typeof j === 'object' ? j : null; }
  catch { return null; }
}
/* A retried leave the company refused as the last admin puts the enrollment back, so this Kosmos reports again. The
   person was told it had stopped, so the screen's next read says once that it did not (#5531 review 21). */
function leaveRefusedFor(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_REFUSED_FILE), 'utf8')); return j && typeof j.name === 'string' ? j.name : null; }
  catch { return null; }
}
function setLeaveRefused(name, opts, kind) {
  const file = path.join(storeRoot(opts), LEAVE_REFUSED_FILE);
  try { if (name == null) fs.rmSync(file, { force: true }); else writeWhole(file, JSON.stringify({ at: new Date().toISOString(), name, kind: kind === 'undo' ? 'undo' : 'leave' }) + '\n'); } catch { /* the screen just does not say it */ }
}
function leaveRefusedKind(opts) {
  try { return JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_REFUSED_FILE), 'utf8')).kind === 'undo' ? 'undo' : 'leave'; } catch { return null; }
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
    writeWhole(file, JSON.stringify({ at: new Date().toISOString(), name }) + '\n');
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
  // One age for both "not made" settles. An unreadable time, or one in the future (a clock set back), counts as old
  // (reviews 30, 33, 39).
  const t0 = Date.parse(unsure.at || '');
  const old = !(Number.isFinite(t0) && t0 <= Date.now()) || Date.now() - t0 >= SETTLE_AFTER_MS;
  /* Another company named here is not this join (review 37): the account is still in the old one. Settled only once the
     marker is old enough, like any "not made" (review 38): a read too soon can still show the old company before the
     new join is saved. Until then the marker stays, and a pending leave older than it waits. */
  if (unsure.orgId && d && d.member === true && d.org && typeof d.org.id === 'string' && d.org.id !== unsure.orgId) {
    if (!old) return { ok: false, enrolled: false, because: 'Too soon to say the join was not made.' };
    setJoinUnknown(null, opts);
    return { ok: true, enrolled: false };
  }
  const verdict = statusVerdict(d, world);
  if (verdict === 'unclear') return { ok: false, enrolled: false, because: "Your company's answer was not complete." };
  if (verdict !== 'here' && !old) return { ok: false, enrolled: false, because: 'Too soon to say the join was not made.' };   // kept
  setJoinUnknown(null, opts);
  if (verdict === 'here') {
    const org = cleanOrg(d.org), role = cleanRole(d.role);
    if (!org || !role) return { ok: false, enrolled: false, because: "Your company's answer was not complete." };
    const rec = { org, role, world, enrolledAt: new Date().toISOString() };
    if (unsure.consentHash) rec.consentHash = unsure.consentHash;
    if (unsure.computerSalt) rec.computerSalt = unsure.computerSalt;   // #5532: the salt the join's print was made with
    if (unsure.printPinned === true) rec.printPinned = true;
    try { writeEnrollment(rec, opts); } catch { setJoinUnknown(unsure, opts); return { ok: false, enrolled: false, because: "This Kosmos's data folder could not be written." }; }
    setStopped(null, opts);
    setLeavePending(false, opts);   // joined again after an unconfirmed leave: that old leave must never be sent now (review 35)
    const policy = takePolicy(d, opts, org.id);   // #5534 review 1: the settled join's answer carries the policy too
    return { ok: true, enrolled: true, member: true, ...rec, ...(policy ? { policy } : {}) };
  }
  if (verdict === 'notHere' && !unsure.move && namesThisWorld(d, world)) {
    // The join's own salt, company and whether it sent a print, from the marker (review 17), so the undo carries the print.
    const joinPrint = { computerSalt: unsure.computerSalt || undefined, orgId: unsure.orgId || undefined, printSent: unsure.printPinned === true };
    setLeavePending(true, Object.assign({}, opts, joinPrint), null, true, unsure.consentHash);   // bound elsewhere: the undo is sent by the pending-leave path
    return leaveNow(opts, true);
  }
  return { ok: true, enrolled: false };
}
/* The company names THIS world's id (on this computer or another): what a join of this world left. NOT "no world at all":
   that is also what the company shows while the same account's join from another computer is still landing, and an
   undo sent then would end that membership (review 28). */
function namesThisWorld(d, world) {
  if (!d || d.member !== true || !world) return false;
  return !!d.enrolled && typeof d.enrolled === 'object' && d.enrolled.world === world;
}
/* What a status answer says about THIS world, in one place (leave and refresh both read it, review 11):
   'here'    the company enrolls this world on this computer;
   'gone'    not a member at all;
   'notHere' a member, but enrolled nowhere, as another world, or as this world on another computer;
   'unclear' anything else (a field missing, an unreadable local id): change nothing. */
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
  // A join marker for the retired id can never settle (no id to match), so it goes with it (review 36).
  setJoinUnknown(null, opts);
  // And the words accepted for it (#5532): a later join remembers its own before it sends.
  try { fs.rmSync(path.join(storeRoot(opts), CONSENT_FILE), { force: true }); } catch { /* unread without a matching record */ }
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
  /* The pending marker goes down BEFORE the record goes, so a restart in between can never leave neither: the next pass
     then sends the leave (review 32). Every clear outcome below removes it. */
  setLeavePending(true, opts, before, undo, pendingConsentHash(opts));
  /* #5534 review 3: what was in force, so a leave the company refuses (last admin) can put it back when its answer
     carries no policy field (an older coordinator). A leave not yet confirmed still drops it at once: the person chose
     to leave, and this Kosmos stops reporting at the same moment (decided on the card). That is a deliberate way for
     the person to lift the policy on their own Mac, as removing the files is; the company sees the reports stop. */
  let heldPolicy = null;
  try { heldPolicy = policyMod(opts).snapshot(); } catch { heldPolicy = null; }
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
  // #5532: the print the company pinned, or the leave is refused as a copy's. A read still retrying keeps it pending.
  // From the pending-leave file, else the record's own (that file is written best-effort; review 13).
  const from = pendingPrintFrom(opts) || (before && before.computerSalt && before.org ? { salt: before.computerSalt, orgId: before.org.id, pinned: before.printPinned === true } : null);
  const pf = from ? pinnedWait(printFields(from.salt, from.orgId), from.pinned === true) : { send: 'none', fields: {} };
  if (pf.send === 'later' || pf.send === 'error') {
    setLeavePending(true, opts, before, undo);
    return { ok: false, pending: true, because: 'Leaving could not be sent yet. This Kosmos has stopped reporting, and it will tell your company again.' };
  }
  const r = await signed('POST', ROUTES.leave, pf.fields, opts);
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
    // An undo refused: the person DID accept the words for this world, so the record carries them (review 31).
    const hashBefore = pendingConsentHash(opts);
    if (back && !before && undo && hashBefore) back.consentHash = hashBefore;
    /* And the salt its print was pinned with (rollup review 12): without it every rollup goes without the print, which
       the company refuses as a copy's and logs against the real computer. Only for the same company. */
    const pf0 = pendingPrintFrom(opts);
    if (back && !back.computerSalt && pf0 && back.org && pf0.orgId === back.org.id) { back.computerSalt = pf0.salt; if (pf0.pinned === true) back.printPinned = true; }
    let kept = false;
    if (back) { try { writeEnrollment(back, opts); kept = true; } catch { /* below */ } }
    /* #5534 reviews 2 and 4: still enrolled, so the policy cleared with the record above comes back first, then this
       answer's is taken over it as on any refresh: a newer one applies, a refused one leaves the restored one in force,
       and one of another company than the record's is ended. Not covered (review 5, decided): a leave left pending
       and retried after a restart snapshots after the first clear, so a later last-admin refusal from a coordinator
       without the field brings nothing back; the next refresh from a current coordinator restores the policy. */
    if (kept && back.org) {
      try { policyMod(opts).restore(heldPolicy); } catch { /* best effort */ }
      takePolicy(d, opts, back.org.id);
    }
    setLeavePending(!kept, opts, back, undo, hashBefore);
    // Told "stopped" (or "not reporting") earlier: say once that it reports again, in words for what was refused (reviews 27, 31).
    if (kept && retry) setLeaveRefused((back.org && back.org.name) || 'your company', opts, undo ? 'undo' : 'leave');
    return { ok: false, still: true, code, because: SAY.org_last_admin };
  }
  setLeavePending(true, opts, before, undo);
  // The person's sentence, whatever the raw reason: they must hear that this Kosmos stopped and the leave will be sent.
  return { ok: false, pending: true, code, because: 'Leaving could not be confirmed yet. This Kosmos has stopped reporting, and it will tell your company again.' };
}

/* On start and daily: ask the coordinator. member:false, or an enrollment naming another world, clears this world's
   record (removed, left, or moved elsewhere). An unreachable coordinator changes nothing. */
async function refresh(opts) { return oneAtATime(() => refreshNow(opts)); }
function pendingAt(opts) {
  try { return Date.parse(JSON.parse(fs.readFileSync(path.join(storeRoot(opts), LEAVE_PENDING_FILE), 'utf8')).at || ''); } catch { return NaN; }
}
async function refreshNow(opts) {
  /* A join whose outcome is unknown and NEWER than a pending leave is settled first: the person joined again after
     that leave, and if the join landed, sending the old leave would end the membership they just accepted (review 35).
     Settled as made: recorded, and the old leave dropped (as a successful join does). Not made: the leave goes on. */
  const later = joinUnknown(opts);
  if (later && leavePending(opts) && !(Date.parse(later.at || '') < pendingAt(opts))) {
    const s = await settleUnknownJoin(later, opts);
    if (s.enrolled) return s;
    if (joinUnknown(opts)) return { ok: false, enrolled: false, because: s.because };   // still unknown: the old leave waits
  }
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
  // The consent belongs to the world it was shown for: never carried onto a record for another world (review 28).
  if (before && before.consentHash && before.world === world) rec.consentHash = before.consentHash;
  // #5532: the salt belongs to the company its print was pinned for; a different company on the answer drops it (review 11).
  if (before && before.computerSalt && before.world === world && before.org && before.org.id === org.id) { rec.computerSalt = before.computerSalt; if (before.printPinned === true) rec.printPinned = true; }
  let saved = true;
  try { writeEnrollment(rec, opts); } catch { saved = false; /* keep the old record; the next refresh tries again */ }
  // Review 1: a policy only once the enrollment it belongs to is on record here, or a later stop would never clear it.
  /* Review 3: a policy of another company than this answer's: it ends BEFORE the new one is applied, so a bundle of
     the new company's that is refused leaves no policy rather than the old company's. Keyed on the policy's own
     company, not the record's, so a move by code that never cleared is caught here too. */
  // Not saved: the old record stands, but a policy of another company than this answer's still ends now (review 7).
  const policy = saved ? takePolicy(d, opts, org.id) : (endForeignPolicy(opts, org.id), null);
  return { ok: true, enrolled: true, member: true, ...rec, ...(policy ? { policy } : {}) };
}

/* #5534 review 3: a policy of another company than `orgId` ends (a move, or a company change on the answer), so a
   refused or missing bundle of the new company leaves no policy rather than the old company's. */
function endForeignPolicy(opts, orgId) {
  // The applied one, or a bundle on disk not yet applied (review 5: it would apply at the next create).
  try { const m = policyMod(opts); const had = m.appliedOrg(), waiting = m.bundleOrg(); if ((had && had !== orgId) || (waiting && waiting !== orgId)) m.clear(); } catch { /* best effort */ }
}

/* The policy on a status answer `d` that confirmed this Kosmos as `orgId`'s, the same way on every path that has one
   (refresh, a settled join, a refused leave; review 4). Another company's policy ends first (review 3). A bundle is
   applied, or refused with the last good one kept. No bundle (`policy: null`, or no field from an older coordinator)
   changes nothing (review 5): the coordinator keeps every company's newest policy and has no way to delete one, so a
   company lifts its rules by saving an open policy, which is signed; an unsigned null must not lift them. Returns
   what applyPolicy does. */
function takePolicy(d, opts, orgId) {
  endForeignPolicy(opts, orgId);
  return applyPolicy(d && d.policy, opts, orgId);
}

/* #5534 (E0.5): the coordinator serves the company's policy, signed, on this enrolled computer's status answer (null when
   the company has saved none). It is written where engine/orgpolicy.js reads it and applied there, which verifies it
   AGAIN against the pinned coordinator key and refuses a forged, tampered, expired or older one, keeping the last good
   one in force. { version, refused } or null when the answer carried no policy. Never throws: a policy that cannot be
   saved or applied leaves the enrollment as it is, and the next refresh (on start and daily) tries again. */
function applyPolicy(token, opts, orgId) {
  if (typeof token !== 'string' || !token) return null;
  if (token.length > 64 * 1024) return { version: null, refused: 'the policy is larger than this Kosmos accepts' };
  const orgpolicy = policyMod(opts);
  /* Review 1: a bundle for another company than the one this answer names is not saved (a coordinator mix-up). A
     mix-up guard, not a security check: the payload is read before its signature is checked, and orgpolicy.refresh()
     verifies the whole bundle against the pinned key. */
  if (orgId) {
    let named = null;
    try { named = JSON.parse(Buffer.from(token.split('.')[1] || '', 'base64url').toString('utf8')).org; } catch { named = null; }
    if (named !== orgId) return { version: null, refused: 'the policy names another company than this answer' };
  }
  try {
    const file = orgpolicy.BUNDLE();
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = file + '.' + process.pid + '.tmp';
    try { fs.writeFileSync(tmp, token, { mode: 0o600 }); fs.renameSync(tmp, file); } finally { fs.rmSync(tmp, { force: true }); }
    const r = orgpolicy.refresh();
    return { version: r.applied ? r.applied.version : null, refused: r.refused || null };
  } catch (e) {
    return { version: null, refused: 'the policy could not be saved: ' + ((e && e.message) || e) };
  }
}

module.exports = {
  ROUTES, WORLD_ID_FILE, ENROLLMENT_FILE, LEAVE_PENDING_FILE, CODE, SAY, codeOf,
  worldId, readEnrollment, leavePending, joinUnknown, joinUnknownAge, mayReport, SETTLE_AFTER_MS, stoppedFor, clearStopped, leaveRefusedFor, leaveRefusedKind, clearLeaveRefused, consentHash, isEnrolledHere, cleanConsent, preview, enroll, leave, refresh, CONSENT_FILE, acceptedConsent, consentWithdrawn, reportPrint, reviewHere,
};
