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
function take(id, now) {
  const t = typeof id === 'string' ? TICKETS.get(id) : undefined;
  if (t) TICKETS.delete(id);
  return t && now - t.at <= TICKET_MS ? t : null;
}

const SAY = {
  personal_backup_off: 'Personal backup is not available on Kosmos+ yet. Nothing was turned on.',
  personal_backup_in_org: 'This account is in a company or a family on Kosmos+, which backs it up its own way, so a personal backup cannot be turned on. Nothing changed.',
  personal_backup_raced: 'Something else changed this account on Kosmos+ at the same moment. Nothing was turned on; try again.',
  org_other_org: 'This account joined a company or a family on Kosmos+ meanwhile, so a personal backup was not turned on. Nothing changed here.',
  org_consent_changed: 'What a personal backup does changed on Kosmos+ just now. Nothing was turned on; open it again to read the new words.',
  personal_backup_words_unseen: 'Kosmos+ did not take the words as shown. Nothing was turned on; open it again.',
};
const UNREACHED = 'Kosmos+ could not be reached just now. Nothing was turned on; try again in a minute.';

/** Step 1: the words to show. { ok, ticket, words } (words: reports, backsUp, readers, never), or { ok: false }. */
async function preview(opts = {}) {
  const remote = remoteOf(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, because: UNREACHED };
  let r;
  try { r = await remote.macRequest('POST', ROUTE, {}); } catch { return { ok: false, because: UNREACHED }; }
  if (!r || !r.ok) { const c = codeOf(r); return c && SAY[c] ? { ok: false, code: c, because: SAY[c] } : { ok: false, because: UNREACHED }; }
  const served = cleanPreview(r.data);
  if (!served) return { ok: false, because: 'Kosmos+ answered in a form this Kosmos does not read. Nothing was turned on.' };
  return { ok: true, ticket: issue(served, (opts.now || Date.now)()), words: served.words };
}

/** Step 2: the person accepted the words on `ticket`. Binds this computer, then makes the key and the recovery code.
    { ok: true, code, epoch } with the recovery code to show once, or { ok: false, because, code?, unknown? }. */
async function switchOn(ticket, accepted, opts = {}) {
  if (accepted !== true) return { ok: false, declined: true, because: 'Not accepted, so nothing was sent.' };
  const t = take(ticket, (opts.now || Date.now)());
  if (!t) return { ok: false, code: 'ticket', because: 'These words were shown too long ago. Open personal backup again to read them.' };
  const oe = opts.orgenroll || require('./orgenroll');
  // The hash is required (design review 1, blocker 2): without it a codeless enroll could move a company's binding.
  if (!HASH.test(t.consentHash)) return { ok: false, because: 'Kosmos+ answered in a form this Kosmos does not read. Nothing was turned on.' };
  let r;
  try {
    r = await oe.enroll(null, true, enrollOpts(opts, {
      orgId: t.org.id, consentHash: t.consentHash, wordsShown: true, consent: t.words, computerSalt: t.computerSalt,
    }));
  } catch { r = null; }
  if (!r) return { ok: false, because: UNREACHED };
  if (!r.ok) {
    if (r.declined) return { ok: false, declined: true, because: 'Not accepted, so nothing was sent.' };
    if (r.unknown) return { ok: false, unknown: true, because: 'It is not known yet whether this computer was bound. Kosmos asks Kosmos+ again in a few minutes.' };
    const c = r.code || codeOf(r);
    if (c && SAY[c]) return { ok: false, code: c, because: SAY[c] };
    return { ok: false, code: c, because: 'Kosmos+ did not bind this computer just now. Nothing was turned on; try again in a minute.' };
  }
  if (!r.org || r.org.id !== t.org.id) return { ok: false, because: 'Kosmos+ did not confirm this computer, so nothing was turned on.' };
  const pk = opts.personalbackupkey || require('./personalbackupkey');
  const k = await pk.setUpPersonalKey({ macRequest: opts.macRequest || ((m, rt, b) => remoteOf(opts).macRequest(m, rt, b)) });
  if (!k || !k.ok) return { ok: false, bound: true, code: k && k.code, because: 'This computer is bound, but its backup key could not be set up yet: ' + ((k && k.because) || 'try again') + '.' };
  return { ok: true, code: k.code, epoch: k.epoch };
}

/** Whether this computer holds a personal backup's enrollment, from this module's own record only. */
function isOn(opts = {}) {
  try { const oe = opts.orgenroll || require('./orgenroll'); const rec = oe.readEnrollment(enrollOpts(opts)); return !!(rec && rec.org && rec.world); } catch { return false; }
}

/** A lost join or a pending leave under this root, settled the way orgenroll settles the company's: one refresh. */
// orgenroll.js JOIN_UNKNOWN_FILE (not exported) and LEAVE_PENDING_FILE.
const JOIN_UNKNOWN_FILE = 'org-join-unknown.json';
function hasPending(opts = {}) {
  const oe = opts.orgenroll || require('./orgenroll');
  return [JOIN_UNKNOWN_FILE, oe.LEAVE_PENDING_FILE].some((f) => {
    try { return fs.existsSync(path.join(root(opts), f)); } catch { return false; }
  });
}
async function followUp(opts = {}) {
  if (!hasPending(opts) && !isOn(opts)) return { ok: true, idle: true };
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
  if (r && r.ok) return { ok: true };
  if (r && r.pending) return { ok: false, pending: true, because: 'Turning it off is sent again until Kosmos+ answers.' };
  return { ok: false, because: 'Kosmos+ could not be reached just now. Personal backup is still on; try again in a minute.' };
}

module.exports = { ROUTE, INERT_POLICY, root, cleanPreview, preview, switchOn, isOn, followUp, startFollowUp, switchOff, _TICKETS: TICKETS };
