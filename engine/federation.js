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
 *   owner:  { role: 'owner',  ref }          ref = the project_ref invites were minted with
 *   member: { role: 'member', edge_id, owner_handle, project_name, project_desc }
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
// A project name is a ref (refOk's 200), and an owner handle is a Kosmos+ name
// (3 to 32 characters at the coordinator), kept with room to spare.
const NAME_MAX = 200;
const HANDLE_MAX = 64;

function refOk(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 200;
}

/** Mint an invite for a project the person is creating or owns. */
async function invite(remote, body) {
  const kind = body && body.invited_kind;
  if (!refOk(body && body.project_ref) || !refOk(body && body.project_name) || (kind !== 'person' && kind !== 'agent')) {
    return { status: 400, body: { error: 'we could not read that request' } };
  }
  // The same bound a project's own description has here (projects.js), so nothing
  // longer than this Mac would keep leaves it.
  if (typeof body.project_desc === 'string' && body.project_desc.length > DESC_MAX) {
    return { status: 400, body: { error: 'that description is longer than ' + DESC_MAX + ' characters' } };
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
  const s = fedseal.randomSecret();
  try { fedseal.stashInvite(body.project_ref, { s, code: r.data.code, invite: r.data.invite_id }); } catch (err) {
    return { status: 500, body: { error: 'We could not keep this invite\'s key on this computer, so no code was made. Try again. (' + String((err && err.message) || 'unknown') + ')' } };
  }
  return { status: 200, body: { code: r.data.code + '.' + s, expires_at: r.data.expires_at } };
}

/** Redeem a code into a connection and show the owner's read-only snapshot. */
async function verify(remote, body) {
  const pasted = body && typeof body.code === 'string' ? body.code.trim() : '';
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
  FILE, MAC_INVITE, MAC_VERIFY,
  invite, verify, joinSnapshot, forgetSnapshot, linkFor, recordLink, forgetLink, readLinks, reasonFor, refOk,
  SNAPSHOT_TTL_MS, SNAPSHOT_MAX, NAME_MAX, DESC_MAX, HANDLE_MAX,
};
