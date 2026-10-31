'use strict';
/**
 * kosmos#7404 (personalswitch-7404): turning a personal backup on, and off, on this computer. Settings calls it through
 * server.js; the board starts its follow-up timer and its backup tick, both idle while nothing is here.
 *
 * A personal backup is an account's own org of one on Kosmos+ (kosmos-relay #691). Turning it on is three steps:
 *   1. preview(): POST /v1/mac/personal-backup makes the account's personal org and membership and answers the words to
 *      show, their hash and the computer salt. It binds nothing.
 *   2. switchOn(ticket, true): the existing codeless enroll binds THIS computer as the org's enrolled computer, through
 *      engine/orgenroll.js, then engine/personalbackupkey.js makes the backup key and the recovery code to show.
 *   3. the backup job: mayBackUp and runJob below, driven hourly by engine/backuptick.js startPersonal. Its keys and its
 *      state are files per (org, member) beside the company path's, under its own pointer.
 *
 * Kept apart from the company enrollment ON PURPOSE (the plan's option C). Every orgenroll call here runs under this
 * module's own data root but one: mayBackUp reads store.ROOT to ask whether a company is enrolled. So the company readers
 * (rollups, agent events, company policy, the hourly refresh), which read store.ROOT, never see a personal backup. The
 * conditions that make that hold (design review 1):
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

/* #7681 item 1: the price the screen shows must be the price Kosmos+ bills. The screen's comes from this board's
   setting (personalbackupoffer.js); Kosmos+'s own preview answer must carry the same figure (`price`, in the shape
   Stripe prices come in), or nothing goes past the preview. Kosmos+ bills no personal backup today and sends no price,
   so with a price set here nothing can be turned on: true, since nothing would charge it. The price itself is Josh's
   (#7404). A screen with no price is refused before this by the server (design review 1), so null meets null only on
   paths that never reach a person. */
function priceOf(d) {
  const { PRICE_SHAPE } = require('./remote');
  const p = d && typeof d.price === 'string' ? d.price.trim() : '';
  return p && PRICE_SHAPE.test(p) ? p : null;
}
function shownPrice(opts) {
  if (Object.prototype.hasOwnProperty.call(opts, 'shownPrice')) return opts.shownPrice;
  try { return require('./personalbackupoffer').offer().price; } catch { return null; }
}
const PRICE_UNCONFIRMED = 'Kosmos+ did not confirm the price shown here, so nothing was turned on. Open personal backup again later.';

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

const ELSEWHERE = 'Personal backup is on for another of your computers. Turn it off there first (if you just did, try again in a few minutes), or remove that computer from your Kosmos+ account if it is lost; nothing changed here.';
const SAY = {
  personal_backup_off: 'Personal backup is not available on Kosmos+ yet. Nothing was turned on.',
  personal_backup_in_org: 'This account is in a company or a family on Kosmos+, so a personal backup cannot be turned on. Nothing changed.',
  personal_backup_raced: 'Something else changed this account on Kosmos+ at the same moment. Nothing was turned on; try again.',
  org_other_org: 'This account joined a company or a family on Kosmos+ meanwhile, so a personal backup was not turned on. Nothing changed here.',
  org_consent_changed: 'What a personal backup does changed on Kosmos+ just now. Nothing was turned on; open it again to read the new words.',
  personal_backup_words_unseen: 'Kosmos+ did not take the words as shown. Nothing was turned on; open it again.',
  // The membership the preview made was ended meanwhile (turned off elsewhere, or ended at a company or family join).
  org_not_member: 'Personal backup was closed on Kosmos+ while it was open here. Nothing was turned on; open it again.',
  personal_on_elsewhere: ELSEWHERE,
  // kosmos#7661: Kosmos+ refused the bind itself (onlyIfFree): the status read before it cannot see a bind made after it,
  // and Kosmos+ refuses that one in the move's own transaction.
  org_bound_elsewhere: ELSEWHERE,
  org_bound_other_world: 'Personal backup is on for another Kosmos on this computer. Turn it off there first; nothing changed here.',
};
const UNREACHED = 'Kosmos+ could not be reached just now. Nothing was turned on; try again in a minute.';

/* Code review 2, blocker 1, as finally decided (code review 5): preview MAKES the membership (org.rs
   mac_personal_backup), and a decline, an expired ticket or an off with no record leaves it, bound to no computer. The
   board does NOT end it. kosmos#7658 (relay) ends an unbound personal membership inside a company or family join, the
   one moment it would get in the way, in the join's own transaction. Rounds 3 to 5 showed that ending it from here
   cannot be made safe: the status read and the leave are two requests, the personal org is REUSED across the account's
   computers (so neither an org id nor "unbound" read a moment earlier says the membership is still this preview's), and
   an older relay ignores any guard field the leave carries. Rejected: a board-side leave behind a relay capability flag
   (all of that machinery, for nothing #7658 does not already do). Weakest premise: the personal backup switch
   (KOSMOS_PERSONAL_BACKUP) goes on before #7658 is deployed; then an abandoned preview blocks a company join until the
   person turns personal backup on and off. Recorded on #7404. */
/* Code review 3, blocker 1: a personal backup another computer of this account runs. A codeless enroll here is a MOVE
   to orgenroll and would take its binding: that computer would stop and this one could only restore. Refused, at the
   preview and again just before the enroll; turning it off there (or a retired computer, which reads as none) frees it.
   Status is read every time, even with a record here (code review 5: a stale record, another computer having taken the
   binding since the last refresh, must not let this one move it back), and no answer means nothing is sent (code review
   5, warning 1: a preview made with no status read could not be checked). */
/* Code review 8, warning 2: `thisComputer` means this MAC (org.rs enrolled_json), not this Kosmos; two Kosmoses can run
   on one computer (orgenroll.js), so a binding is this one's only when its world is this root's world id too. */
function localWorld(opts) {
  const oe = opts.orgenroll || require('./orgenroll');
  try { const w = fs.readFileSync(path.join(root(opts), oe.WORLD_ID_FILE), 'utf8').trim(); return /^[0-9a-f]{32}$/.test(w) ? w : null; } catch { return null; }
}
function boundHere(d, opts) {
  return !!(d && d.enrolled && d.enrolled.thisComputer === true && localWorld(opts) && d.enrolled.world === localWorld(opts));
}
function elsewhere(st, opts) {
  const d = st && st.ok && st.data;
  return !!(d && d.member === true && d.org && d.org.kind === 'personal' && d.enrolled && !boundHere(d, opts));
}
/* kosmos#7661 review NIT 3: the refusal for a binding held elsewhere, said as Kosmos+ says it after the move (another
   Kosmos on this computer has its own sentence), so the read before and the refusal at the move never disagree. */
function elsewhereRefusal(st) {
  const sameMac = !!(st && st.data && st.data.enrolled && st.data.enrolled.thisComputer === true);
  return sameMac ? { ok: false, code: 'org_bound_other_world', because: SAY.org_bound_other_world }
    : { ok: false, code: 'personal_on_elsewhere', because: ELSEWHERE };
}
const STATUS = '/v1/mac/org/status';
async function readStatus(remote) {
  let st = null;
  try { st = await remote.macRequest('POST', STATUS, {}); } catch { /* unanswered */ }
  return st && st.ok && st.data && typeof st.data === 'object' ? st : null;
}

/** Step 1: the words to show. { ok, ticket, words } (words: reports, backsUp, readers, never), or { ok: false }. */
async function preview(opts = {}) {
  const remote = remoteOf(opts);
  if (!remote || typeof remote.macRequest !== 'function') return { ok: false, because: UNREACHED };
  const st = await readStatus(remote);
  if (!st) return { ok: false, because: UNREACHED };
  if (elsewhere(st, opts)) return elsewhereRefusal(st);
  let r;
  try { r = await remote.macRequest('POST', ROUTE, {}); } catch { return { ok: false, because: UNREACHED }; }
  if (!r || !r.ok) {
    const c = codeOf(r);
    if (c && SAY[c]) return { ok: false, code: c, because: SAY[c] };
    // Code review 7, NIT 5: an answer with no code is a refusal, not an unreachable Kosmos+.
    return { ok: false, because: r && r.refusal ? 'Kosmos+ refused this just now. Nothing was turned on; try again in a minute.' : UNREACHED };
  }
  const served = cleanPreview(r.data);
  if (!served) return { ok: false, because: 'Kosmos+ answered in a form this Kosmos does not read. Nothing was turned on.' };
  // #7681 item 1: the ticket carries the price Kosmos+ confirmed, so switchOn can refuse one the screen no longer shows.
  // Review: the request above already made the (unbound) membership, so a price_unconfirmed press leaves one, as a
  // decline does; #7658 ends it at a later join. While Kosmos+ sends no price, every press on a priced board does this.
  const shown = shownPrice(opts);
  if (priceOf(r.data) !== shown) return { ok: false, code: 'price_unconfirmed', because: PRICE_UNCONFIRMED };
  served.price = shown;
  const now = (opts.now || Date.now)();
  // Review: the confirmed price goes to the screen too, so the words screen shows what the ticket holds, never an
  // earlier read of this board's setting (a tab left open across a restart that changed it).
  return { ok: true, ticket: issue(served, now), words: served.words, price: shown };
}

/** Step 2: the person accepted the words on `ticket`. Binds this computer, then makes the key and the recovery code.
    { ok: true, code, epoch } with the recovery code to show once, or { ok: false, because, code?, unknown? }. */
async function switchOn(ticket, accepted, opts = {}) {
  const now = (opts.now || Date.now)();
  if (accepted !== true) {
    // Code review 6, NIT 1: an accept on this ticket is already under way, so "nothing was turned on" may be false.
    if (typeof ticket === 'string' && CLAIMED.has(ticket)) return { ok: false, code: 'busy', because: 'Personal backup is already being turned on. Wait a moment.' };
    // Declined: the ticket is spent. The membership the preview made is left for #7658 to end at a join (see above).
    if (typeof ticket === 'string') TICKETS.delete(ticket);
    return { ok: false, declined: true, because: 'Not accepted, so nothing was turned on.' };
  }
  /* Code review 2 NIT: claimed synchronously, so two switchOn calls on one ticket (a double press) cannot both enroll;
     the second is told it is under way. Released in every outcome below. */
  if (typeof ticket === 'string' && CLAIMED.has(ticket)) return { ok: false, code: 'busy', because: 'Personal backup is already being turned on. Wait a moment.' };
  const t = peek(ticket, now);
  if (!t) {
    // Code review 6, NIT 3: expired, used, or from before a restart; the sentence must be true of all three.
    return { ok: false, code: 'ticket', because: 'These words are no longer open here. Open personal backup again to read them.' };
  }
  CLAIMED.add(ticket);
  try { return await bindAndKey(ticket, t, opts); } finally { CLAIMED.delete(ticket); }
}
const CLAIMED = new Set();
async function bindAndKey(ticket, t, opts) {
  const oe = opts.orgenroll || require('./orgenroll');
  // #7681 item 1: the price on this board changed since Kosmos+ confirmed it at the preview: read the words again.
  if (t.price !== shownPrice(opts)) { TICKETS.delete(ticket); return { ok: false, code: 'price_unconfirmed', because: PRICE_UNCONFIRMED }; }
  // Bound elsewhere since the preview: refused before anything is sent (blocker 1). Unanswered: nothing sent, ticket kept.
  const remote = remoteOf(opts);
  const st = remote && typeof remote.macRequest === 'function' ? await readStatus(remote) : null;
  if (!st) return { ok: false, because: UNREACHED };
  if (elsewhere(st, opts)) { TICKETS.delete(ticket); return elsewhereRefusal(st); }
  /* Code review 6, warning 3: the account is in another org now (a company or family joined since the preview). An
     enroll would be refused as org_consent_changed against that org's words, a false sentence; nothing is sent. */
  if (st.data.member === true && st.data.org && st.data.org.id !== t.org.id) { TICKETS.delete(ticket); return { ok: false, code: 'org_other_org', because: SAY.org_other_org }; }
  // The hash was checked when the ticket was made (cleanPreview); it is what stops a hashless enroll moving a company's
  // binding here (design review 1, blocker 2).
  /* Code review 7, warning 1: orgenroll writes its lost-join marker only after a failed answer, so a restart between
     Kosmos+ binding this computer and the record being written left nothing on disk: 'off' here, "on for another of
     your computers" everywhere else. This marker is down for the whole enroll and goes once an answer is in. */
  noteEnrolling(t.org.id, opts);
  let r;
  try {
    r = await oe.enroll(null, true, enrollOpts(opts, {
      orgId: t.org.id, consentHash: t.consentHash, wordsShown: true, consent: t.words, computerSalt: t.computerSalt,
      // kosmos#7661: a coordinator that reads onlyIfFree moves nothing another computer holds (an older one ignores it
      // and moves, as before); the status read above cannot close that race alone.
      onlyIfFree: true,
    }));
  } catch { r = null; }
  forgetEnrolling(opts);
  if (!r) return { ok: false, because: UNREACHED };
  /* The ticket is spent once the enroll may have reached Kosmos+: an answer, a refusal with a code, or an unknown. A
     refusal before anything was sent (no connection, a print read to retry) keeps it, so "try again" works (code
     review 1; orgenroll keeps its own ticket the same way, its review 27). */
  // Warning 5: Kosmos+ also answered when it did not confirm this computer, or confirmed one this Kosmos could not record.
  if (r.ok || r.code || r.unknown || codeOf(r) || r.reason === 'not_confirmed' || r.reason === 'not_recorded') TICKETS.delete(ticket);
  if (!r.ok) {
    if (r.declined) return { ok: false, declined: true, because: 'Not accepted, so nothing was sent.' };
    if (r.unknown) return { ok: false, unknown: true, because: 'It is not known yet whether this computer was bound. Kosmos asks Kosmos+ again in a few minutes.' };
    const c = r.code || codeOf(r);
    if (c && SAY[c]) return { ok: false, code: c, because: SAY[c] };
    /* Code review 2, warning 5: orgenroll's own refusals in this module's words, never the generic one. A personal enroll
       sends no code, so orgenroll reads it as a move: nothing is undone (a leave would end the membership). */
    if (r.reason === 'not_confirmed') return { ok: false, because: 'Kosmos+ did not confirm this computer, so nothing was turned on. Open personal backup again.' };
    if (r.reason === 'not_recorded') return { ok: false, because: 'Kosmos+ took this computer, but this Kosmos could not record it, so nothing is backed up. Check that its data folder can be written, then open personal backup again.' };
    if (r.reason === 'no_folder') return { ok: false, because: 'This Kosmos\'s data folder cannot be written, so nothing was turned on. Fix the folder, then try again.' };
    return { ok: false, code: c, because: 'Kosmos+ did not bind this computer just now. Nothing was turned on; try again in a minute.' };
  }
  // A second line only (code review 7, NIT 3): orgenroll already refuses an answer naming another org (opts.orgId) as
  // not_confirmed and writes no record, so this is unreachable with the real orgenroll.
  if (!r.org || r.org.id !== t.org.id) return { ok: false, because: 'Kosmos+ answered for a different backup than the one shown, so its key was not set up here. Turn personal backup off on this computer and open it again.' };
  /* The key-ready marker is NOT removed here (code review 6, NIT 4): state() compares its org and world with the record,
     so a marker from another membership already reads needs-key, and one for this same binding stays true even when
     the key step below fails on a passing error. switchOff removes it. */
  return setUpKey(opts);
}

/* Whether Kosmos+ still names `rec`'s personal org, bound to this computer and this world: null when it does, else the
   refusal to answer. personalbackupkey reads the ACCOUNT's current membership, whatever org that is, so both the key step
   and a restore ask this first (code review 6, warning 4; backupscreens-7404 challenge round 5 for restore). */
async function boundHereNow(rec, opts, notDone) {
  const remote = remoteOf(opts);
  const st = remote && typeof remote.macRequest === 'function' ? await readStatus(remote) : null;
  if (!st) return { ok: false, code: 'unreached', because: 'Kosmos+ could not be reached just now, so ' + notDone + '. Try again in a minute.' };
  const d = st.data;
  // Code review 7, NIT 1: and this record's world, so another board on this same computer is never set up from here.
  if (!(d.member === true && d.org && d.org.kind === 'personal' && d.org.id === rec.org.id && d.enrolled && d.enrolled.thisComputer === true && d.enrolled.world === rec.world)) {
    return { ok: false, code: 'not_on', because: 'Personal backup is no longer on for this computer on Kosmos+. Open personal backup again.' };
  }
  return null;
}

/* The key step: the backup key and the recovery code to show once. Also what the screen calls when state() says
   'needs-key' (a join settled later by the follow-up, or a key step that failed), so no fresh preview is needed.
   { ok: true, code, epoch } (code null when this computer already holds the keys: turned off and on again here), or
   { ok: false, code, because }. */
const KEY_READY = 'personal-key-ready';
async function setUpKey(opts = {}) {
  const rec = record(opts);
  if (!rec) return { ok: false, code: 'not_on', because: 'Personal backup is not on for this computer yet.' };
  /* Code review 6, warning 4: personalbackupkey reads the ACCOUNT's current membership, whatever org that is, so a stale
     record here (ended elsewhere, a company joined, before the next refresh) would set up or report keys for another
     org. Kosmos+ must still name this record's personal org, bound to this computer. */
  const held = await boundHereNow(rec, opts, 'the backup key was not set up yet');
  if (held) return held;
  const pk = opts.personalbackupkey || require('./personalbackupkey');
  let k;
  try { k = await pk.setUpPersonalKey({ macRequest: opts.macRequest || ((m, rt, b) => remoteOf(opts).macRequest(m, rt, b)) }); } catch { k = null; }
  if (k && (k.ok || k.code === 'already_here')) {
    // Code review 2, warning 4: the marker names the org and world it was made for, so an ending this module did not see
    // (a refresh that finds the membership gone, then a new join) never reads as 'on' for the new one.
    /* Code review 5, warning 2: and the key's own org and member, so state() can see a recovery code still waiting to be
       shown and confirmed (a restart or a closed tab before the screen showed it) and say needs-key; this then runs
       again and personalbackupkey answers the same code (its resume path). org and member are returned for the
       screen's confirmRecoveryCodeSaved. */
    const who = k.ok && typeof k.org === 'string' && typeof k.member === 'string' ? { keyOrg: k.org, member: k.member } : {};
    try { fs.writeFileSync(path.join(root(opts), KEY_READY), JSON.stringify(Object.assign({ at: new Date().toISOString(), org: rec && rec.org.id, world: rec && rec.world }, who)) + '\n', { mode: 0o600 }); } catch { /* state() then says needs-key, and this runs again harmlessly */ }
    return k.ok ? { ok: true, code: k.code, epoch: k.epoch, org: k.org, member: k.member } : { ok: true, code: null, already: true };
  }
  if (k && k.code === 'already_set_up') return { ok: false, code: 'restore', because: 'This backup already has a recovery code from another computer. Restore it here with that code.' };
  return { ok: false, code: k && k.code, because: 'Personal backup is on for this computer, but its backup key could not be made yet: ' + ((k && k.because) || 'try again') + '.' };
}

/* Whether this computer made the key for `rec` and its recovery code is still pending here (a restore would drop it). */
function codeWaitingHere(rec, pk, opts) {
  try {
    const k = JSON.parse(fs.readFileSync(path.join(root(opts), KEY_READY), 'utf8'));
    return !!(k && k.org === rec.org.id && k.world === rec.world && k.keyOrg && k.member && pk.hasPendingCode(k.keyOrg, k.member));
  } catch { return false; }
}
/* Whether the record read before an await is still this computer's record after it: the same org and world. A turn-off
   (or a turn-off and a new turn-on) in that window would otherwise let a restore act on, and mark key-ready, a binding
   that is no longer this one (#7681 item 3). */
function sameRecord(rec, opts) {
  const now = record(opts);
  return !!(now && now.org.id === rec.org.id && now.world === rec.world);
}
const CHANGED = { ok: false, code: 'not_on', because: 'Personal backup changed on this computer while restoring, so nothing was restored here. Open personal backup again.' };

/* backupscreens-7404 (challenge round 5): restore this backup's keys here with the person's recovery code. Only for a
   computer personal backup is on for (the move to a new computer: turn on, then setUpKey answers code 'restore'), and
   only while Kosmos+ still names that binding, so a restore never acts on another org's keys. A restore that worked
   writes the key-ready marker, so state() reads 'on' rather than asking for a code it will never show.
   #7681 item 3: the record is read again after each await (Kosmos+'s check, then the restore itself), and a restore whose
   record changed meanwhile stops there: no keys restored after the check, no marker written after the restore.
   { ok: true, epochs } or { ok: false, code, because }. */
async function restore(code, opts = {}) {
  const rec = record(opts);
  if (!rec) return { ok: false, code: 'not_on', because: 'Turn on personal backup on this computer first, then restore with your recovery code.' };
  if (state(opts) !== 'needs-key') return { ok: false, code: 'not_needed', because: 'This computer already has its backup key, so there is nothing to restore.' };
  const pk = opts.personalbackupkey || require('./personalbackupkey');
  if (codeWaitingHere(rec, pk, opts)) return { ok: false, code: 'code_waiting', because: 'A recovery code made on this computer is still waiting to be saved. Press Finish setting up to see it.' };
  const held = await boundHereNow(rec, opts, 'nothing was restored');
  if (held) return held;
  if (!sameRecord(rec, opts)) return CHANGED;
  let r;
  /* Review: the restore re-checks too, from inside personalbackupkey: its own membership read must name this record's
     org (expectOrg), and stillOurs is asked with no await before the keys are written, so no keys land for a binding
     that is gone. */
  try {
    r = await pk.restorePersonalKey(code, { macRequest: opts.macRequest || ((m, rt, b) => remoteOf(opts).macRequest(m, rt, b)),
      expectOrg: rec.org.id, stillOurs: () => sameRecord(rec, opts) });
  } catch { r = null; }
  if (!(r && r.ok)) return r && typeof r === 'object' ? r : { ok: false, because: 'restoring the backup keys failed on this computer' };
  // A turn-off after the keys were written: they were restored (true), but no key-ready marker is written for a
  // binding that is gone (review: the CHANGED sentence, "nothing was restored", would be false here).
  if (!sameRecord(rec, opts)) return { ok: false, code: 'not_on', because: 'The backup keys were restored here, but personal backup changed on this computer meanwhile. Open personal backup again.' };
  try { fs.writeFileSync(path.join(root(opts), KEY_READY), JSON.stringify({ at: new Date().toISOString(), org: rec.org.id, world: rec.world }) + '\n', { mode: 0o600 }); } catch { /* state() then says needs-key, and the key step settles it (already_here): the screen says so (#7681 item 4) */ }
  return { ok: true, epochs: r.epochs };
}

/** 'off', 'pending' (a join's answer was lost; the follow-up settles it), 'needs-key' (on, the key step not finished
    here, or its recovery code not yet confirmed), or 'on'; from this computer's own files only. */
function joinUnsettled(opts) {
  const oe = opts.orgenroll || require('./orgenroll');
  try { if (fs.existsSync(path.join(root(opts), oe.JOIN_UNKNOWN_FILE))) return true; } catch { return true; }
  return !!readEnrolling(opts);
}
const ENROLLING = 'personal-enrolling.json';
function noteEnrolling(orgId, opts) {
  try { fs.mkdirSync(root(opts), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(root(opts), ENROLLING), JSON.stringify({ org: orgId, at: Date.now() }) + '\n', { mode: 0o600 }); } catch { /* best effort */ }
}
function readEnrolling(opts) {
  try { const j = JSON.parse(fs.readFileSync(path.join(root(opts), ENROLLING), 'utf8')); return j && ID.test(String(j.org || '')) ? j : { org: null }; } catch (e) { return e && e.code === 'ENOENT' ? null : { org: null }; }
}
function forgetEnrolling(opts) { try { fs.rmSync(path.join(root(opts), ENROLLING), { force: true }); } catch { /* read as pending until it goes */ } }
/* An in-flight marker left by a restart: once no switch-on here is running, status says whether Kosmos+ bound this
   computer. Not bound: it goes ('off'). Bound with no record here: it stays ('pending'), and switchOff says how out. */
/* 'bound' (Kosmos+ binds this Kosmos's world: the marker stays), 'unbound' (it goes), or 'unknown' (no answer, or a
   switch-on running: it stays, and nothing is claimed either way; code review 8, warning 1). */
async function settleEnrolling(opts) {
  const e = readEnrolling(opts);
  if (!e) return 'unbound';
  if (isOn(opts)) { forgetEnrolling(opts); return 'unbound'; }
  if (CLAIMED.size) return 'unknown';
  const remote = remoteOf(opts);
  const st = remote && typeof remote.macRequest === 'function' ? await readStatus(remote) : null;
  if (!st) return 'unknown';
  const d = st.data;
  if (d.member === true && d.org && d.org.kind === 'personal' && boundHere(d, opts)) return 'bound';
  // Code review 8, NIT 1: a switch-on that started during the read wrote its own marker; that one is not this read's.
  const now = readEnrolling(opts);
  if (CLAIMED.size || !now || now.at !== e.at) return 'unknown';
  forgetEnrolling(opts);
  return 'unbound';
}
function state(opts = {}) {
  const rec = record(opts);
  // Code review 6, warning 2: a join whose answer was lost may have bound this computer; it is not 'off' until settled.
  if (!rec) return joinUnsettled(opts) ? 'pending' : 'off';
  try {
    const k = JSON.parse(fs.readFileSync(path.join(root(opts), KEY_READY), 'utf8'));
    if (!(k && k.org === rec.org.id && k.world === rec.world)) return 'needs-key';
    const pk = opts.personalbackupkey || require('./personalbackupkey');
    return k.keyOrg && k.member && pk.hasPendingCode(k.keyOrg, k.member) ? 'needs-key' : 'on';
  } catch { return 'needs-key'; }
}

/* pbjob-7404: may the backup job upload now? All of: the board offers it; on, with its key here and its code confirmed;
   the words accepted here, and they name something backed up; and no company enrollment on this world's store.ROOT,
   joined, joining or leaving. Asked when a run starts, as the company's mayBackUp is. */
function mayBackUp(opts = {}) {
  try {
    if (!(opts.offer || require('./personalbackupoffer').offer)().shown) return false;
    if (state(opts) !== 'on') return false;
    const oe = opts.orgenroll || require('./orgenroll');
    const eo = enrollOpts(opts);
    if (oe.mayReport(eo) !== true) return false;
    const words = oe.acceptedConsent(eo);
    if (!words || !Array.isArray(words.backsUp) || !words.backsUp.length) return false;
    return oe.holdsEnrollment() !== true;
  } catch { return false; }
}
/* backuprun's ensureMemberKey for this backup: the key step reads, for this record's org only. */
function jobKey(opts = {}) {
  return (o = {}) => {
    const rec = record(opts);
    if (!rec) return Promise.resolve({ ok: false, because: 'Personal backup is not on for this computer.' });
    const pk = opts.personalbackupkey || require('./personalbackupkey');
    return pk.personalKeyForJob(rec.org.id, { lostEpoch: o.lostEpoch, lostFor: o.lostFor, macRequest: opts.macRequest });
  };
}
const JOB_POINTER = 'current-personal.json';
/* One run under this backup's key. Kosmos+ refusing the words: the hash the run started under goes (read before the run,
   so words accepted during it stay), mayBackUp turns false, and no later run walks every file to be refused the same way. */
async function runJob(input, opts = {}) {
  const run = opts.runBackup || require('./backuprun').runBackup;
  const before = record(opts);
  const hash = before && before.consentHash;
  const r = await run(input, { ensureMemberKey: jobKey(opts), pointerName: JOB_POINTER });
  if (!(r && !r.ok && typeof r.because === 'string' && /\borg_consent_changed\b/.test(r.because))) return r;
  const oe = opts.orgenroll || require('./orgenroll');
  try { if (hash) await oe.consentWithdrawn(enrollOpts(opts), hash); } catch { /* asked again next run */ }
  return Object.assign({}, r, { personActs: true, because: 'what a personal backup does changed, so backups stopped. Turn it off here, then on again, to read the new words' });
}

/** Whether this computer holds a personal backup's enrollment, from this module's own record only. */
function isOn(opts = {}) { return !!record(opts); }
function record(opts) {
  try { const oe = opts.orgenroll || require('./orgenroll'); const rec = oe.readEnrollment(enrollOpts(opts)); return rec && rec.org && rec.world ? rec : null; } catch { return null; }
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
let LAST_SETTLE = 0;
async function followUp(opts = {}) {
  const now = (opts.now || Date.now)();
  // Code review 8, NIT 2: as a pending step, every pass for a day after the marker went down, then hourly.
  const e = readEnrolling(opts);
  if (e) {
    const age = Number.isFinite(e.at) && e.at <= now ? now - e.at : 24 * HOUR;
    if (age < 24 * HOUR || now - LAST_SETTLE >= HOUR) { LAST_SETTLE = now; await settleEnrolling(opts); }
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
  /* Code review 2 NITs: it sends to Kosmos+, so it waits for live execution as orgEnrollRefresh does (#5670), and one
     pass at a time (a slow Kosmos+ must not stack passes every two minutes). */
  let running = false;
  const run = () => {
    if (running) return;
    try { if (!require('./live-execution').liveExecutionAllowed()) return; } catch { return; }
    running = true;
    followUp(opts).catch(() => {}).finally(() => { running = false; });
  };
  setTimeout(run, 5000).unref();
  TIMER = setInterval(run, 2 * 60 * 1000); TIMER.unref();
}

/** Turn a personal backup off on this computer: the membership ends on Kosmos+ (orgenroll's leave, this root). */
async function switchOff(opts = {}) {
  const oe = opts.orgenroll || require('./orgenroll');
  /* Code review 6, warning 2: with a lost join and no record, orgenroll's leave clears locally and sends nothing, which
     would strand a binding the join may have made. Settled first (one refresh); still unsettled, nothing is done. */
  if (!isOn(opts) && joinUnsettled(opts)) {
    const v = await settleEnrolling(opts);
    if (v === 'bound') return { ok: false, pending: true, because: 'Kosmos+ has this computer down for personal backup, but this Kosmos lost its record of it. Turn personal backup on again here (it binds again without a new code), then turn it off.' };
    if (v === 'unknown') return { ok: false, pending: true, because: 'It is not known yet whether this computer was bound. Kosmos asks Kosmos+ again in a few minutes; turn it off after that.' };
    try { await oe.refresh(enrollOpts(opts)); } catch { /* still unsettled below */ }
    if (!isOn(opts) && joinUnsettled(opts)) return { ok: false, pending: true, because: 'It is not known yet whether this computer was bound. Kosmos asks Kosmos+ again in a few minutes; turn it off after that.' };
  }
  let r;
  try { r = await oe.leave(enrollOpts(opts)); } catch { r = null; }
  // Stopped here (left, or a leave pending): the key marker goes too, so turning it on again runs the key step again.
  if (r && (r.ok || r.pending)) { try { fs.rmSync(path.join(root(opts), KEY_READY), { force: true }); } catch { /* best effort */ } }
  if (r && r.ok) return { ok: true };
  if (r && r.pending) return { ok: false, pending: true, because: 'Personal backup has stopped on this computer. Kosmos tells Kosmos+ again until it answers.' };
  // Code review 4, NIT 6: a leave that threw after the record was cleared has stopped it here; do not say "still on".
  if (!isOn(opts)) return { ok: false, pending: true, because: 'Personal backup has stopped on this computer. Kosmos tells Kosmos+ again until it answers.' };
  return { ok: false, because: 'Kosmos+ could not be reached just now. Personal backup is still on; try again in a minute.' };
}

module.exports = { ROUTE, INERT_POLICY, root, cleanPreview, preview, switchOn, setUpKey, restore, state, isOn, mayBackUp, runJob, followUp, startFollowUp, switchOff, _TICKETS: TICKETS, _resetFollowUpForTests: () => { LAST_REFRESH = 0; LAST_SETTLE = 0; } };
