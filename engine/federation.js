'use strict';
/**
 * Federation on the board (#3311): the three calls the Add Project screen makes
 * (#3312), and the record of which local project is linked to which connection.
 *
 * 🔑 THE BOARD HOLDS NO ACCOUNT SESSION (#874), so it reaches the coordinator's
 * federation control plane only through this Mac's signature: remote.macRequest,
 * which runs the connector's `mac-request` verb against /v1/mac/federation/*.
 * The Mac acts for its own account; the coordinator applies the Kosmos+ gate.
 *
 * The link record lives in federation.json beside projects.json, keyed by the
 * local project id, so the projects schema is untouched:
 *   owner:  { role: 'owner',  ref, selfShared? }   ref = the project_ref invites were minted with;
 *           selfShared = an own code was made, so the owner sits in its own room with no guest (#4649)
 *   member: { role: 'member', edge_id, owner_handle, project_name, project_desc }
 *   self:   { role: 'self',   ref, project_name, project_created }   another computer of the same
 *           account, joined by own code; its seat is `fed-room --own-project <ref>` (#4649)
 * The owner's ref is what lets the owner's board find the project's room later
 * (the coordinator derives the room from owner account + ref).
 */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const fedseal = require('./fedseal');

const FILE = 'federation.json';
const MAC_INVITE = '/v1/mac/federation/invite';
const MAC_VERIFY = '/v1/mac/federation/verify';
// kosmos#4648's route, shared with the switcher's reader so a rename cannot split them (#4699).
const MAC_ACCOUNT_COMPUTERS = require('./account-computers').ROUTE;

function file() {
  return path.join(store.ROOT, FILE);
}

/* ENOENT alone means "no links yet"; any other failure is refused, never read as
   empty, so a damaged file is not silently replaced by the next write (the
   projects.json rule). */
let lastReadOk = true;
function readLinks() {
  let raw;
  try {
    raw = fs.readFileSync(file(), 'utf8');
  } catch (err) {
    lastReadOk = !!(err && err.code === 'ENOENT');
    if (lastReadOk) return {};
    const e = new Error('we cannot read the connected-projects record on this computer right now');
    e.code = 'UNREADABLE';
    throw e;
  }
  try {
    const parsed = JSON.parse(raw);
    lastReadOk = !!parsed && typeof parsed === 'object' && !Array.isArray(parsed);
    if (lastReadOk) return parsed;
  } catch {
    lastReadOk = false;
  }
  const e = new Error('the connected-projects record is there but we cannot make sense of it');
  e.code = 'UNREADABLE';
  throw e;
}

function writeLinks(links) {
  if (!lastReadOk && fs.existsSync(file())) {
    const e = new Error('we will not overwrite the connected-projects record while we cannot read it');
    e.code = 'UNREADABLE';
    throw e;
  }
  fs.mkdirSync(store.ROOT, { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(links, null, 2));
  fs.renameSync(tmp, file());
}

/* The last good read, so `linkFor` costs a stat rather than a read and parse.
   Every room post asks it (fedseats.post: is this room federated?), and almost
   none are. The copy is used only while the file's mtime and size are what
   they were when it was read: any change on disk, a damaged file included, is
   read again, so a damaged record is still reported and never hidden behind
   the copy. A failed read is never cached. */
let cached = null;
let cachedKey = null;
function diskKey() {
  try {
    const st = fs.statSync(file());
    return st.mtimeMs + ':' + st.size;
  } catch (err) {
    return (err && err.code === 'ENOENT') ? 'absent' : null;
  }
}
function links() {
  const key = diskKey();
  if (cached && key !== null && key === cachedKey) return cached;
  const read = readLinks();
  cached = read;
  cachedKey = key;
  return read;
}

function linkFor(projectId) {
  const all = links();
  return Object.prototype.hasOwnProperty.call(all, projectId) ? all[projectId] : null;
}

function recordLink(projectId, link) {
  const next = Object.assign({}, readLinks(), { [projectId]: link });
  writeLinks(next);
  cached = null;
  return link;
}

/** Drop a removed project's link, so nothing keeps looking for its seat. */
function forgetLink(projectId) {
  const all = readLinks();
  if (!Object.prototype.hasOwnProperty.call(all, projectId)) return false;
  delete all[projectId];
  writeLinks(all);
  cached = null;
  return true;
}

/* The snapshot the coordinator returned on verify, per edge, so `join` names the
   joined project from what the coordinator said rather than from the page. Held
   in memory: a restart between verify and join means verifying again, which is
   refused (the code is single-use) -- see joinSnapshot's caller for the answer. */
const verified = new Map();
/* A verify that is never followed by a join (the person walked away, or typed
   the code again) must not stay forever: a snapshot lasts this long, and at
   most this many are held, oldest dropped first. */
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;
const SNAPSHOT_MAX = 32;

/* The page (pjFedMessage) turns a fixed `reason` into its own sentence and shows a
   generic line for anything else, so the coordinator's refusals are mapped to those
   reasons here. The patterns are the coordinator's own sentences
   (kosmos-relay coordinator/src/fed.rs verify_for); federation.test.js pins each
   one, and an unrecognised sentence keeps the page's safe fallback. */
const REASONS = [
  [/code is not valid/i, 'not-found'],
  [/code has expired/i, 'expired'],
  [/code has already been used/i, 'already-used'],
  [/already joined that project/i, 'double-join'],
  [/your own project/i, 'self-join'],
];
function reasonFor(sentence) {
  if (typeof sentence !== 'string') return null;
  for (const [re, reason] of REASONS) if (re.test(sentence)) return reason;
  return null;
}

const { externalName, INVISIBLE, byCodePoint } = require('./externalname');
const DESC_MAX = 1000;
// A project name is bounded by nameOk (200), and an owner handle is a Kosmos+ name
// (3 to 32 characters at the coordinator), kept with room to spare.
const NAME_MAX = 200;
const HANDLE_MAX = 64;

/* The coordinator caps a project_ref at 128 BYTES (invite and own-room-ticket alike,
   kosmos#4649), so the same bound here: a ref this board would accept but the
   coordinator refuse would make a project nobody can join. */
function refOk(v) {
  return typeof v === 'string' && v.length > 0 && Buffer.byteLength(v, 'utf8') <= 128;
}
/* A project NAME keeps the bound it had before refs were capped in bytes: a legal
   project name of 43 CJK characters is over 128 bytes and must still be invitable. */
function nameOk(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= NAME_MAX;
}

/* kosmos#4649: a code that lets ANOTHER computer of the same account join this project's
   shared room. It carries only the project's ref and name, and needs no secret: a seat in
   an own room is only ever minted for the caller's OWN account, so this code pasted on
   someone else's computer opens that account's own (empty) room, never this one. */
const OWN_PREFIX = 'kosmos-own:';
const OWN_CODE_MAX = 1024;
/* An own code's ref reaches the connector's command line (`--own-project <ref>`), and a pasted
   code is written by whoever made it, so it must look like a ref this board mints (a UUID):
   letters, digits, _ and -, never starting with -. */
const OWN_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
/* kosmos#4699: an own code names the computer that made it (`from`, its Kosmos+ name: the first
   label of its address), so the computer it is pasted on can check that name against the computers
   of ITS OWN account. Without it, a code pasted on another account's computer was accepted: that
   computer got a project sitting alone in its own account's room, under a note saying it was shared.
   A name, not a secret: a code gets pasted around, and the name is already that computer's public
   address. */
const OWN_FROM_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** The Kosmos+ name of the computer at `address` (its first label), or null. */
function ownFromOf(address) {
  const label = typeof address === 'string' ? address.trim().toLowerCase().split('.')[0] : '';
  return OWN_FROM_RE.test(label) ? label : null;
}
/* The key an own-account join is held under between verify and join (never an edge id,
   which the coordinator mints as 32 hex characters). */
const OWN_KEY_PREFIX = 'own:';
/* Why no own code can be made for this project, or null when one can: 'guest' for a
   project joined from someone else, 'sealed' for an owner project that has handed out a
   sealing invite (its room is sealed, and a computer joined by own code has no seal
   state, so it could neither read nor post there; #4658). */
function ownCodeRefusal(projectId) {
  const link = linkFor(projectId);
  if (!link) return null;
  if (link.role !== 'owner' && link.role !== 'self') return 'guest';
  if (link.role === 'owner' && refOk(link.ref) && fedseal.isSealedRef(link.ref)) return 'sealed';
  return null;
}
function ownCode(projectId, projectName, from) {
  // Before anything is recorded: a code that cannot name its maker is never made.
  if (typeof from !== 'string' || !OWN_FROM_RE.test(from)) return null;
  if (ownCodeRefusal(projectId)) return null;
  const link = linkFor(projectId);
  let ref = link && (link.role === 'owner' || link.role === 'self') && OWN_REF_RE.test(String(link.ref)) ? link.ref : null;
  if (!ref) {
    if (link) return null;   // a member of someone else's project: not ours to add computers to
    ref = require('crypto').randomUUID();
    recordLink(projectId, { role: 'owner', ref, selfShared: true });
  } else if (link.role === 'owner' && link.selfShared !== true) {
    // Shared with the person's other computers from now on: the owner seats its own room
    // even before a guest joins (fedseats.ensure).
    recordLink(projectId, Object.assign({}, link, { selfShared: true }));
  }
  // parseOwnCode refuses a code over OWN_CODE_MAX; the name is cut, by whole characters, to fit.
  let chars = Array.from(String(projectName || '').slice(0, NAME_MAX));
  const make = () => OWN_PREFIX + Buffer.from(JSON.stringify({ v: 2, ref, from, name: chars.join('') }), 'utf8').toString('base64url');
  let code = make();
  while (code.length > OWN_CODE_MAX && chars.length > 1) { chars = chars.slice(0, Math.floor(chars.length / 2)); code = make(); }
  return code;
}
/** Whether `ref` is a room this account's other computers sit in (an owner shared by own code,
    or a project joined by one). Throws on an unreadable links record. */
function selfSharedRef(ref) {
  return Object.values(links()).some((l) => l && ((l.role === 'owner' && l.selfShared === true) || l.role === 'self') && l.ref === ref);
}
/** Whether a project on this computer already sits in the own room `ref` (as owner or self). Throws on an unreadable links record. */
function ownRefHere(ref) {
  return Object.values(links()).some((l) => l && (l.role === 'self' || l.role === 'owner') && l.ref === ref);
}
/** The {ref, name, from} an own-account code carries, or null for anything else. `from` is null for a
    code in the first format (v 1, before #4699), which named no computer; verify refuses those. */
function parseOwnCode(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t.startsWith(OWN_PREFIX) || t.length > OWN_CODE_MAX) return null;
  let o;
  try { o = JSON.parse(Buffer.from(t.slice(OWN_PREFIX.length), 'base64url').toString('utf8')); } catch { return null; }
  if (!o || (o.v !== 1 && o.v !== 2) || typeof o.ref !== 'string' || !OWN_REF_RE.test(o.ref) || typeof o.name !== 'string') return null;
  if (o.v === 2 && (typeof o.from !== 'string' || !OWN_FROM_RE.test(o.from))) return null;
  const name = o.name.trim().slice(0, NAME_MAX);
  return name ? { ref: o.ref, name, from: o.v === 2 ? o.from : null } : null;
}

/** The Kosmos+ names of the computers on THIS computer's account, asked of the coordinator through
    the tunnel (signed with this computer's key, so it can only be this account's list). Never throws. */
async function ownAccountNames(remote) {
  let r;
  try { r = await remote.macRequest('POST', MAC_ACCOUNT_COMPUTERS, {}); } catch (err) { return { ok: false, because: String((err && err.message) || 'Kosmos+ did not answer') }; }
  if (!r || !r.ok) return { ok: false, because: (r && r.because) || 'Kosmos+ did not answer' };
  const rows = r.data && Array.isArray(r.data.computers) ? r.data.computers : null;
  if (!rows) return { ok: false, because: 'the Kosmos+ answer carried no computers' };
  // The SAME derivation the maker used for `from`: the first label of the computer's address (a row's
  // `name` is a separate field, and the two need not be spelled alike).
  const names = rows.map((c) => ownFromOf(c && c.address)).filter(Boolean);
  return { ok: true, names };
}

/* kosmos#4699: why an own code could not be checked, in words the person can act on. The raw cause is
   never shown: a spawn failure carries a path on this computer, and the tunnel's refusal line carries a
   route and a status code. Only the coordinator's own sentence is kept, and only when it has no path. */
function uncheckedRefusal(because) {
  const b = typeof because === 'string' ? because : '';
  if (/not connected to Kosmos\+/.test(b)) {
    return { status: 409, body: { reason: 'no-remote', error: 'Turn on Kosmos+ remote access on this computer, then paste the code again.' } };
  }
  const m = /^Kosmos\+ refused this Mac: (.+?)(?: \(HTTP \d+ on [^)]*\))?$/.exec(b);
  const said = m && m[1].trim();
  if (said && !/[\/\\]/.test(said)) {
    return { status: 502, body: { reason: 'unchecked', error: 'Kosmos could not check that this code is from one of your computers: Kosmos+ said ' + said.replace(/[.;]\s*$/, '') + '.' } };
  }
  return { status: 502, body: { reason: 'unchecked', error: 'Kosmos could not check that this code is from one of your computers. Try again in a moment.' } };
}

/** Mint an invite for a project the person is creating or owns. */
async function invite(remote, body) {
  const kind = body && body.invited_kind;
  if (!refOk(body && body.project_ref) || !nameOk(body && body.project_name) || (kind !== 'person' && kind !== 'agent')) {
    return { status: 400, body: { error: 'we could not read that request' } };
  }
  // The same bound a project's own description has here (projects.js), so nothing
  // longer than this Mac would keep leaves it.
  if (typeof body.project_desc === 'string' && body.project_desc.length > DESC_MAX) {
    return { status: 400, body: { error: 'that description is longer than ' + DESC_MAX + ' characters' } };
  }
  /* A sealing invite seals the room, and this account's other computers joined by own code
     hold no seal state, so they could no longer read or post there (#4658). An unreadable
     links record does not block an invite; the paths that read links report it. */
  let selfShared = false;
  try { selfShared = selfSharedRef(body.project_ref); } catch { selfShared = false; }
  if (selfShared) {
    return { status: 409, body: { reason: 'self-shared', error: 'This project is shared with your other computers, so it cannot be shared with other people yet.' } };
  }
  const req = { project_ref: body.project_ref, project_name: body.project_name, invited_kind: kind };
  if (typeof body.project_desc === 'string' && body.project_desc.trim()) req.project_desc = body.project_desc;
  const r = await remote.macRequest('POST', MAC_INVITE, req);
  if (!r.ok) return { status: 502, body: { error: r.because } };
  if (!r.data || typeof r.data.code !== 'string') return { status: 502, body: { error: 'the connection service answered in a shape we could not read' } };
  /* #3728: the code's second half. The coordinator minted (and so has seen) the first
     half; `s` is made here, kept here, and travels only person to person. It is what
     lets the two boards pin each other's sealing keys without trusting us. An invite
     whose half cannot be kept is not handed out: it could never seal. */
  /* The invite's id ties a member's sealing key to the edge that member redeemed, so
     a revoke rotates exactly that member out. A coordinator that does not name it is
     older than this board: no sealing code is handed out rather than one whose
     member could never be revoked. */
  if (typeof r.data.invite_id !== 'string' || !r.data.invite_id) {
    return { status: 502, body: { error: 'The connection service is older than this Kosmos, so a sealed invite cannot be made yet. Try again later.' } };
  }
  // Checked again after the coordinator answered: an own code made meanwhile must not be sealed out.
  let sharedNow = false;
  try { sharedNow = selfSharedRef(body.project_ref); } catch { sharedNow = false; }
  if (sharedNow) {
    return { status: 409, body: { reason: 'self-shared', error: 'This project is shared with your other computers, so it cannot be shared with other people yet.' } };
  }
  const s = fedseal.randomSecret();
  try { fedseal.stashInvite(body.project_ref, { s, code: r.data.code, invite: r.data.invite_id }); } catch (err) {
    return { status: 500, body: { error: 'We could not keep this invite\'s key on this computer, so no code was made. Try again. (' + String((err && err.message) || 'unknown') + ')' } };
  }
  return { status: 200, body: { code: r.data.code + '.' + s, expires_at: r.data.expires_at } };
}

/** Redeem a code into a connection and show the owner's read-only snapshot. */
async function verify(remote, body) {
  const pasted = body && typeof body.code === 'string' ? body.code.trim() : '';
  /* kosmos#4649: a code from ANOTHER computer of this account ("add your other computer")
     is not an invite: nothing is redeemed with the coordinator. It becomes a `self` link
     at join, whose seat is this account's own room. Checked before the invite length
     bound, since it carries the project's name. */
  const own = parseOwnCode(pasted);
  if (own) {
    // The coordinator seats an own room only for a Kosmos Plus account.
    let plus = false;
    try { plus = remote.kosmosPlus() === true; } catch { plus = false; }
    if (!plus) {
      return { status: 403, body: { reason: 'not-plus', error: 'Joining your other computer\'s project needs Kosmos Plus on this computer.' } };
    }
    let here;
    try { here = ownRefHere(own.ref); } catch { return { status: 500, body: { error: 'Kosmos could not read which projects are shared on this computer. Try again in a moment.' } }; }
    if (here) return { status: 409, body: { reason: 'already_joined', error: 'This project is already on this computer.' } };
    /* kosmos#4699: only a code made on one of THIS account's computers. The own room a seat opens is
       always the caller's own account's, so another account's code leaked nothing, but it made a
       project that sat alone under a note saying it was shared. */
    if (!own.from) {
      return { status: 409, body: { reason: 'old-code', error: 'This code was made by an older Kosmos. Update Kosmos on the computer that has the project, then make a new code there.' } };
    }
    const mine = await ownAccountNames(remote);
    if (!mine.ok) return uncheckedRefusal(mine.because);
    if (!mine.names.includes(own.from)) {
      return { status: 409, body: { reason: 'other-account', error: 'This code is from a computer that is not on this Kosmos+ account, so the project cannot be added here. If it came from your own computer, make a new code there.' } };
    }
    const key = OWN_KEY_PREFIX + own.ref;
    const snap = { edge_id: key, own: true, project_name: externalName(own.name, NAME_MAX), project_desc: null, owner_handle: 'your other computer' };
    verified.delete(key);
    verified.set(key, Object.assign({ at: Date.now(), ref: own.ref }, snap));
    while (verified.size > SNAPSHOT_MAX) verified.delete(verified.keys().next().value);
    return { status: 200, body: snap };
  }
  if (!pasted || pasted.length > 200) return { status: 400, body: { error: 'Paste the code you were given first.' } };
  // #3728: only the coordinator's half goes to the coordinator; `s` stays on this board.
  const { code, s: sealS } = fedseal.splitInviteCode(pasted);
  const r = await remote.macRequest('POST', MAC_VERIFY, { code });
  if (!r.ok) {
    const reason = reasonFor(r.because);
    return { status: reason ? 409 : 502, body: reason ? { reason, error: r.because } : { error: r.because } };
  }
  const d = r.data || {};
  if (typeof d.edge_id !== 'string' || typeof d.project_name !== 'string') {
    return { status: 502, body: { error: 'the connection service answered in a shape we could not read' } };
  }
  // Bounded like everything else that arrives from outside: the name as a ref,
  // the description as a project's own (DESC_MAX), the handle as a name.
  // By code point, like every outside name and body (never half a character).
  const bound = (v, max) => (typeof v === 'string' && v ? byCodePoint(v, max) : null);
  const snap = {
    edge_id: d.edge_id,
    // Shown on the join screen and made this project's name: cleaned as every
    // outside name is, so it cannot display reversed or pass for a local one.
    project_name: externalName(d.project_name, NAME_MAX),
    // Paragraphs are kept (newlines), but format characters and other controls go,
    // as they do from every outside name: bidi overrides and zero-widths could make
    // the join screen show something other than what was sent.
    project_desc: bound(typeof d.project_desc === 'string'
      ? d.project_desc.replace(/\p{Cf}/gu, '').replace(INVISIBLE, '').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
      : d.project_desc, DESC_MAX),
    // Shown as the trusted "Shared by": cleaned like every outside name, not
    // only bounded, so it does not rest on the coordinator's handle rules alone.
    owner_handle: typeof d.owner_handle === 'string' && d.owner_handle ? externalName(d.owner_handle, HANDLE_MAX) || null : null,
  };
  verified.delete(d.edge_id);
  // seal_s is held for the join and never returned to the page.
  verified.set(d.edge_id, Object.assign({ at: Date.now(), seal_s: sealS, seal_code: sealS ? code : null }, snap));
  while (verified.size > SNAPSHOT_MAX) verified.delete(verified.keys().next().value);
  return { status: 200, body: snap };
}

/** The verified snapshot for an edge, or null if this board did not verify it. */
function joinSnapshot(edgeId) {
  if (typeof edgeId !== 'string' || !verified.has(edgeId)) return null;
  const held = verified.get(edgeId);
  if (Date.now() - held.at > SNAPSHOT_TTL_MS) { verified.delete(edgeId); return null; }
  const { at, ...snap } = held;
  return snap;   // includes seal_s and seal_code (#3728): the join route keeps them, and sends them nowhere
}

function forgetSnapshot(edgeId) {
  verified.delete(edgeId);
}

module.exports = {
  ownCode, ownCodeRefusal, ownRefHere, parseOwnCode, ownFromOf, OWN_PREFIX,
  FILE, MAC_INVITE, MAC_VERIFY,
  invite, verify, joinSnapshot, forgetSnapshot, linkFor, recordLink, forgetLink, readLinks, reasonFor, refOk,
  SNAPSHOT_TTL_MS, SNAPSHOT_MAX, NAME_MAX, DESC_MAX, HANDLE_MAX,
};
