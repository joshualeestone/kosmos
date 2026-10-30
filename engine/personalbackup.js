'use strict';
/**
 * kosmos#7404 (personalswitch-7404): turning a personal backup on, and off, on this computer. The engine only; nothing
 * calls it yet (the screens are the next slice).
 *
 * A personal backup is an account's own org of one on Kosmos+ (kosmos-relay #691). Turning it on is three steps:
 *   1. preview(): POST /v1/mac/personal-backup makes the account's personal org and membership and answers the words to
 *      show, their hash and the computer salt. It binds nothing.
 *   2. switchOn(ticket, true): the existing codeless enroll binds THIS computer as the org's enrolled computer, through
 *      engine/orgenroll.js, then engine/personalbackupkey.js makes the backup key and the recovery code to show.
 *   3. (later slices) the backup job, and the screens.
 *
 * Kept apart from the company enrollment ON PURPOSE (the plan's option C): every orgenroll call here runs under this
 * module's own data root, so the company readers (rollups, agent events, company policy, the hourly refresh), which read
 * store.ROOT, never see a personal backup. The conditions that make that hold (design review 1):
 *   - orgenroll's policy calls do not follow `root`, so every call passes INERT_POLICY (a personal backup applies no
 *     policy, and must never clear or replace a company's);
 *   - the words and their hash are this module's own: orgenroll's consent helpers refuse words that report nothing, and
 *     an enroll without the personal hash could move a company's binding here if the account joined one meanwhile;
 *   - its own follow-up for a lost join or leave (server.js follows up store.ROOT only), and its own ticket.
 *
 * Never throws: answers { ok: true, ... } or { ok: false, because, code? }, `because` a sentence for the person.
 */

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const store = require('./store');

const ROUTE = '/v1/mac/personal-backup';
const DIR = 'personal-backup';
const HASH = /^[0-9a-f]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const TICKET_MS = 10 * 60 * 1000;
const LINE_MAX = 300;
const LINES_MAX = 20;

/** This module's data root: never store.ROOT itself, so no company reader finds the personal record. */
function root(opts) { return (opts && opts.root) || path.join(store.ROOT, DIR); }

/* A personal backup applies no policy. orgenroll calls these on enroll, refresh and leave (orgenroll.js policyMod);
   each does nothing, and BUNDLE throws, so a policy on a personal status answer is refused before anything is written. */
const INERT_POLICY = Object.freeze({
  clear() {}, snapshot() { return null; }, restore() {}, appliedOrg() { return null; }, bundleOrg() { return null; },
  refresh() { return { applied: null, refused: 'a personal backup applies no policy' }; },
  BUNDLE() { throw new Error('a personal backup applies no policy'); },
});

function enrollOpts(opts, extra) {
  const o = { root: root(opts), orgpolicy: INERT_POLICY, orgKind: 'personal' };
  if (opts && opts.remote) o.remote = opts.remote;
  return Object.assign(o, extra);
}
function remoteOf(opts) {
  if (opts && opts.remote) return opts.remote;
  try { return require('./remote'); } catch { return null; }
}
function codeOf(r) {
  if (r && r.refusal && typeof r.refusal.code === 'string') return r.refusal.code;
  const m = r && typeof r.because === 'string' && r.because.match(/"code":"([a-z0-9_]+)"/);
  return m ? m[1] : undefined;
}

/* The words, kept to plain bounded lines; the hash is the coordinator's, echoed, never recomputed (orgenroll's rule). */
function lines(v) {
  if (!Array.isArray(v) || v.length > LINES_MAX) return null;
  const out = [];
  for (const l of v) { if (typeof l !== 'string' || !l.trim() || l.length > LINE_MAX) return null; out.push(l.trim()); }
  return out;
}
function cleanWords(c) {
  if (!c || typeof c !== 'object') return null;
  const w = { reports: lines(c.reports), backsUp: lines(c.backsUp), readers: lines(c.readers), never: lines(c.never) };
  if (!w.reports || !w.backsUp || !w.readers || !w.never || !w.readers.length) return null;
  // A personal backup reports to nobody: words that say otherwise are not a personal backup's, and are not shown.
  if (w.reports.length) return null;
  return w;
}
function cleanPreview(d) {
  const org = d && d.org;
  if (!org || !ID.test(String(org.id || '')) || org.kind !== 'personal') return null;
  const words = cleanWords(d.consent);
  if (!words || typeof d.consentHash !== 'string' || !HASH.test(d.consentHash)) return null;
  // orgenroll.js servedSalt's rule: hex, 16 to 64 whole bytes (engine/computerprint.js checks it again).
  if (typeof d.computerSalt !== 'string' || !/^(?:[0-9a-fA-F]{2}){16,64}$/.test(d.computerSalt)) return null;
  return { org: { id: org.id, kind: 'personal' }, words, consentHash: d.consentHash, computerSalt: d.computerSalt };
}

/* Its own ticket (never server.js ORG_TICKET): the exact words, hash, org and salt served to THIS screen, one use, ten
   minutes. switchOn takes only a ticket, so a page cannot send a hash it was not shown. */
const TICKETS = new Map();
function issue(served, now) {
  for (const [k, v] of TICKETS) if (now - v.at > TICKET_MS) TICKETS.delete(k);
  const id = crypto.randomBytes(16).toString('hex');
  TICKETS.set(id, Object.assign({ at: now }, served));
  return id;
}
function peek(id, now) {
  const t = typeof id === 'string' ? TICKETS.get(id) : undefined;
  if (t && now - t.at > TICKET_MS) { TICKETS.delete(id); return null; }
  return t || null;
}

const SAY = {
  personal_backup_off: 'Personal backup is not available on Kosmos+ yet. Nothing was turned on.',
  personal_backup_in_org: 'This account is in a company or a family on Kosmos+, so a personal backup cannot be turned on. Nothing changed.',
  personal_backup_raced: 'Something else changed this account on Kosmos+ at the same moment. Nothing was turned on; try again.',
  org_other_org: 'This account joined a company or a family on Kosmos+ meanwhile, so a personal backup was not turned on. Nothing changed here.',
  org_consent_changed: 'What a personal backup does changed on Kosmos+ just now. Nothing was turned on; open it again to read the new words.',
  personal_backup_words_unseen: 'Kosmos+ did not take the words as shown. Nothing was turned on; open it again.',
};
const UNREACHED = 'Kosmos+ could not be reached just now. Nothing was turned on; try again in a minute.';

/* Code review 2, blocker 1: preview MAKES the membership (org.rs mac_personal_backup), so a decline, an expired ticket,
   or an off with no record would leave the account in its personal org, and every company or family invite would be
   refused org_other_org. A preview leaves a marker here; whatever does not bind this computer ends the membership, but
   only when status names an org of kind 'personal' that no computer is bound to (never a company's or a family's, and
   never a personal backup another computer of this account runs), and the marker's org when there is one. Weakest
   premise: the account joins a company between that status read and the leave, and mac_leave ends whatever membership
   exists; the relay follow-up (end a personal membership with no enrolled computer at a company join) removes it. */
const PREVIEW_OPEN = 'personal-preview-open.json';
const STATUS = '/v1/mac/org/status';
const LEAVE = '/v1/mac/org/leave';
function notePreview(orgId, now, opts) {
  try { fs.mkdirSync(root(opts), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(root(opts), PREVIEW_OPEN), JSON.stringify({ org: orgId, at: now }) + '\n', { mode: 0o600 }); } catch { /* best effort: decline and off still end it */ }
}
function readPreview(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root(opts), PREVIEW_OPEN), 'utf8')); return j && ID.test(String(j.org || '')) && Number.isFinite(j.at) ? j : null; } catch { return null; }
}
function forgetPreview(opts) { try { fs.rmSync(path.join(root(opts), PREVIEW_OPEN), { force: true }); } catch { /* the next pass reads status again: harmless */ } }
function joinPending(opts) {
  const oe = opts.orgenroll || require('./orgenroll');
  try { return fs.existsSync(path.join(root(opts), oe.JOIN_UNKNOWN_FILE)); } catch { return true; }
}
/* End a personal membership this computer previewed and did not bind. { ok: true, left } once settled (left, or
   nothing of ours to end), { ok: true, kept: true } while this computer holds it or a join is unsettled, { ok: false }
   when Kosmos+ did not answer (the marker stays, so the follow-up asks again). */
async function endUnbound(opts, orgId) {
  if (isOn(opts) || joinPending(opts)) return { ok: true, kept: true };
  const remote = remoteOf(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false };
  let st;
  try { st = await remote.macRequest('POST', STATUS, {}); } catch { st = null; }
  if (!st || !st.ok || !st.data || typeof st.data !== 'object') return { ok: false };
  const d = st.data;
  const ours = d.member === true && d.org && d.org.kind === 'personal' && d.enrolled == null && (!orgId || d.org.id === orgId);
  if (!ours) { forgetPreview(opts); return { ok: true, left: false }; }
  // No computer is bound, so the relay checks no print (org.rs mac_leave): an empty body.
  let r;
  try { r = await remote.macRequest('POST', LEAVE, {}); } catch { r = null; }
  if (r && (r.ok || codeOf(r) === 'org_not_member')) { forgetPreview(opts); return { ok: true, left: true }; }
  return { ok: false };
}

/** Step 1: the words to show. { ok, ticket, words } (words: reports, backsUp, readers, never), or { ok: false }. */
async function preview(opts = {}) {
  const remote = remoteOf(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, because: UNREACHED };
  let r;
  try { r = await remote.macRequest('POST', ROUTE, {}); } catch { return { ok: false, because: UNREACHED }; }
  if (!r || !r.ok) { const c = codeOf(r); return c && SAY[c] ? { ok: false, code: c, because: SAY[c] } : { ok: false, because: UNREACHED }; }
  const served = cleanPreview(r.data);
  if (!served) return { ok: false, because: 'Kosmos+ answered in a form this Kosmos does not read. Nothing was turned on.' };
  const now = (opts.now || Date.now)();
  if (!isOn(opts)) notePreview(served.org.id, now, opts);
  return { ok: true, ticket: issue(served, now), words: served.words };
}

/** Step 2: the person accepted the words on `ticket`. Binds this computer, then makes the key and the recovery code.
    { ok: true, code, epoch } with the recovery code to show once, or { ok: false, because, code?, unknown? }. */
async function switchOn(ticket, accepted, opts = {}) {
  const now = (opts.now || Date.now)();
  if (accepted !== true) {
    // Declined: the ticket is spent and the membership the preview made is ended (blocker 1).
    const d = peek(ticket, now);
    if (typeof ticket === 'string') TICKETS.delete(ticket);
    const open = readPreview(opts);
    await endUnbound(opts, (d && d.org.id) || (open && open.org) || null);
    return { ok: false, declined: true, because: 'Not accepted, so nothing was turned on.' };
  }
  const t = peek(ticket, now);
  if (!t) {
    const open = readPreview(opts);
    if (open) await endUnbound(opts, open.org);
    return { ok: false, code: 'ticket', because: 'These words were shown too long ago. Open personal backup again to read them.' };
  }
  const oe = opts.orgenroll || require('./orgenroll');
  // The hash was checked when the ticket was made (cleanPreview); it is what stops a hashless enroll moving a company's
  // binding here (design review 1, blocker 2).
  let r;
  try {
    r = await oe.enroll(null, true, enrollOpts(opts, {
      orgId: t.org.id, consentHash: t.consentHash, wordsShown: true, consent: t.words, computerSalt: t.computerSalt,
    }));
  } catch { r = null; }
  if (!r) return { ok: false, because: UNREACHED };
  /* The ticket is spent once the enroll may have reached Kosmos+: an answer, a refusal with a code, or an unknown. A
     refusal before anything was sent (no connection, a print read to retry) keeps it, so "try again" works (code
     review 1; orgenroll keeps its own ticket the same way, its review 27). */
  if (r.ok || r.code || r.unknown || codeOf(r)) TICKETS.delete(ticket);
  if (!r.ok) {
    if (r.declined) return { ok: false, declined: true, because: 'Not accepted, so nothing was sent.' };
    if (r.unknown) return { ok: false, unknown: true, because: 'It is not known yet whether this computer was bound. Kosmos asks Kosmos+ again in a few minutes.' };
    const c = r.code || codeOf(r);
    if (c && SAY[c]) return { ok: false, code: c, because: SAY[c] };
    return { ok: false, code: c, because: 'Kosmos+ did not bind this computer just now. Nothing was turned on; try again in a minute.' };
  }
  if (!r.org || r.org.id !== t.org.id) return { ok: false, because: 'Kosmos+ did not confirm this computer, so nothing was turned on.' };
  forgetPreview(opts);
  return setUpKey(opts);
}

/* The key step: the backup key and the recovery code to show once. Also what the screen calls when state() says
   'needs-key' (a join settled later by the follow-up, or a key step that failed), so no fresh preview is needed.
   { ok: true, code, epoch } (code null when this computer already holds the keys: turned off and on again here), or
   { ok: false, code, because }. */
const KEY_READY = 'personal-key-ready';
async function setUpKey(opts = {}) {
  if (!isOn(opts)) return { ok: false, code: 'not_on', because: 'Personal backup is not on for this computer yet.' };
  const pk = opts.personalbackupkey || require('./personalbackupkey');
  let k;
  try { k = await pk.setUpPersonalKey({ macRequest: opts.macRequest || ((m, rt, b) => remoteOf(opts).macRequest(m, rt, b)) }); } catch { k = null; }
  if (k && (k.ok || k.code === 'already_here')) {
    try { fs.writeFileSync(path.join(root(opts), KEY_READY), new Date().toISOString() + '\n', { mode: 0o600 }); } catch { /* state() then says needs-key, and this runs again harmlessly */ }
    return k.ok ? { ok: true, code: k.code, epoch: k.epoch } : { ok: true, code: null, already: true };
  }
  if (k && k.code === 'already_set_up') return { ok: false, code: 'restore', because: 'This backup already has a recovery code from another computer. Restore it here with that code.' };
  return { ok: false, code: k && k.code, because: 'Personal backup is on for this computer, but its backup key could not be made yet: ' + ((k && k.because) || 'try again') + '.' };
}

/** 'off', 'needs-key' (on, the key step not finished here), or 'on'; from this module's own record only. */
function state(opts = {}) {
  if (!isOn(opts)) return 'off';
  try { return fs.existsSync(path.join(root(opts), KEY_READY)) ? 'on' : 'needs-key'; } catch { return 'needs-key'; }
}

/** Whether this computer holds a personal backup's enrollment, from this module's own record only. */
function isOn(opts = {}) {
  try { const oe = opts.orgenroll || require('./orgenroll'); const rec = oe.readEnrollment(enrollOpts(opts)); return !!(rec && rec.org && rec.world); } catch { return false; }
}

/** A lost join or a pending leave under this root, settled the way orgenroll settles the company's: one refresh. */
/* The age of the oldest pending step (a lost join or leave), or null. Code review 2, warning 3: never a file's mtime,
   because leaveNow rewrites the pending-leave file on every try, so its mtime never aged and a leave Kosmos+ never
   answered was followed up every two minutes forever. A lost join's age is its own `at` (as server.js reads it; an
   unreadable time counts as a day old, so the hourly pass); a pending leave's is when THIS module first saw it,
   kept in its own file and dropped once no leave is pending. */
const LEAVE_SEEN = 'personal-leave-seen';
function pendingAge(opts, now) {
  const oe = opts.orgenroll || require('./orgenroll');
  const r = root(opts);
  let age = null;
  const take = (a) => { age = age === null ? a : Math.max(age, a); };
  try {
    const j = JSON.parse(fs.readFileSync(path.join(r, oe.JOIN_UNKNOWN_FILE), 'utf8'));
    const t = Date.parse((j && j.at) || '');
    take(Number.isFinite(t) && t <= now ? now - t : 24 * HOUR);
  } catch (e) { if (!e || e.code !== 'ENOENT') take(24 * HOUR); }
  const seen = path.join(r, LEAVE_SEEN);
  let leaving = false;
  try { leaving = fs.existsSync(path.join(r, oe.LEAVE_PENDING_FILE)); } catch { /* read as none */ }
  if (leaving) {
    let t = NaN;
    try { t = Number(fs.readFileSync(seen, 'utf8').trim()); } catch { /* first sight */ }
    if (!Number.isFinite(t) || t > now) { t = now; try { fs.writeFileSync(seen, String(now) + '\n', { mode: 0o600 }); } catch { /* unwritten: fast again next pass (accepted) */ } }
    take(now - t);
  } else {
    try { fs.rmSync(seen, { force: true }); } catch { /* harmless */ }
  }
  return age;
}
/* As the company's (code review 1): every two minutes while a step is pending and under a day old, else hourly while a
   record or a pending step is here; nothing at all otherwise. */
const HOUR = 60 * 60 * 1000;
let LAST_REFRESH = 0;
let LAST_END = 0;
async function followUp(opts = {}) {
  const now = (opts.now || Date.now)();
  const open = readPreview(opts);
  if (open) {
    if (isOn(opts)) forgetPreview(opts);
    // A preview not bound within its ticket's life (or before a restart lost the ticket) is ended (blocker 1).
    else if (now - open.at > TICKET_MS && (now - open.at < 24 * HOUR || now - LAST_END >= HOUR)) { LAST_END = now; await endUnbound(opts, open.org); }
  }
  const age = pendingAge(opts, now);
  const on = isOn(opts);
  if (age === null && !on) return { ok: true, idle: true };
  if (!(age !== null && age < 24 * HOUR) && now - LAST_REFRESH < HOUR) return { ok: true, idle: true };
  LAST_REFRESH = now;
  const oe = opts.orgenroll || require('./orgenroll');
  try { return await oe.refresh(enrollOpts(opts)); } catch { return { ok: false }; }
}
let TIMER = null;
/** Started once by the board: on start, then every two minutes, only while this root holds a record or a pending step. */
function startFollowUp(opts = {}) {
  if (TIMER) return;
  const run = () => { followUp(opts).catch(() => {}); };
  setTimeout(run, 5000).unref();
  TIMER = setInterval(run, 2 * 60 * 1000); TIMER.unref();
}

/** Turn a personal backup off on this computer: the membership ends on Kosmos+ (orgenroll's leave, this root). */
async function switchOff(opts = {}) {
  const oe = opts.orgenroll || require('./orgenroll');
  let r;
  try { r = await oe.leave(enrollOpts(opts)); } catch { r = null; }
  // No record here: a preview may still hold a membership nothing bound (blocker 1). Ended, or the follow-up does it.
  if (r && r.ok && r.localOnly) { const open = readPreview(opts); await endUnbound(opts, open ? open.org : null); }
  // Stopped here (left, or a leave pending): the key marker goes too, so turning it on again runs the key step again.
  if (r && (r.ok || r.pending)) { try { fs.rmSync(path.join(root(opts), KEY_READY), { force: true }); } catch { /* best effort */ } }
  if (r && r.ok) return { ok: true };
  if (r && r.pending) return { ok: false, pending: true, because: 'Personal backup has stopped on this computer. Kosmos tells Kosmos+ again until it answers.' };
  return { ok: false, because: 'Kosmos+ could not be reached just now. Personal backup is still on; try again in a minute.' };
}

module.exports = { ROUTE, INERT_POLICY, root, cleanPreview, preview, switchOn, setUpKey, state, isOn, followUp, startFollowUp, switchOff, _TICKETS: TICKETS, _resetFollowUpForTests: () => { LAST_REFRESH = 0; LAST_END = 0; }, _PREVIEW_OPEN: PREVIEW_OPEN };
