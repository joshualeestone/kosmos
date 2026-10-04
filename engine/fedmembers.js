'use strict';
/**
 * #4649: the people and agents an owner invited into a project from outside, for the Members list (Mona Lisa's
 * design on #4649, the board API in the card's contract comment).
 *
 * The coordinator keeps no names (by design) and never lists an invite nobody has redeemed: its edges are joined
 * connections only. So this board keeps its OWN record of the invites it made: the invite id, the kind, the
 * owner's label for the invitee (never sent anywhere), when it was made and when it lapses, and whether the owner
 * withdrew it. The Members list joins that record with the coordinator's connections for this account, by
 * invite id. Nothing secret is kept here: an invite's sealing half lives in fedseal (and is spent when a member
 * joins), which is why this is a separate file.
 *
 * Owner side only. A project this board joined (a `member` link) or shares only with its own other computers (a
 * `self` link) has no invites to list and cannot invite.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const federation = require('./federation');

const FILE = 'fed-invites.json';
const MAC_EDGES = '/v1/mac/federation/edges';
const MAC_REVOKE = '/v1/mac/federation/revoke';
const MAC_WITHDRAW = '/v1/mac/federation/invite/withdraw';
const LABEL_MAX = 80;
const KEEP_PER_PROJECT = 64;        // rows kept per project, newest; an older row only ever reads as expired

function file() { return path.join(store.ROOT, FILE); }

/* ENOENT alone is "no invites yet"; anything else is refused, never read as empty, so a damaged record is not
   silently replaced by the next write (the federation.json rule). */
let lastReadOk = true;
function readAll() {
  let raw;
  try { raw = fs.readFileSync(file(), 'utf8'); } catch (err) {
    lastReadOk = !!(err && err.code === 'ENOENT');
    if (lastReadOk) return {};
    throw unreadable('we cannot read the invites record on this computer right now');
  }
  try {
    const j = JSON.parse(raw);
    lastReadOk = !!j && typeof j === 'object' && !Array.isArray(j);
    if (lastReadOk) return j;
  } catch { lastReadOk = false; }
  throw unreadable('the invites record is there but we cannot make sense of it');
}
function unreadable(msg) { const e = new Error(msg); e.code = 'UNREADABLE'; return e; }
function writeAll(all) {
  if (!lastReadOk && fs.existsSync(file())) throw unreadable('we will not overwrite the invites record while we cannot read it');
  fs.mkdirSync(store.ROOT, { recursive: true });
  const tmp = file() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, file());
}
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** A label as the owner typed it, trimmed, or null. Control characters out; at most LABEL_MAX characters. */
function cleanLabel(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, LABEL_MAX) : null;
}

/* Cut to at most n UTF-16 units (the unit federation.invite counts in) by whole CHARACTERS, never inside an emoji
   (review round 5): half a surrogate pair is not valid text to send. */
function cut(v, n) { let o = ''; for (const ch of v) { if (o.length + ch.length > n) break; o += ch; } return o; }

function rowsFor(projectId) {
  const all = readAll();
  return own(all, projectId) && Array.isArray(all[projectId]) ? all[projectId] : [];
}
function recordInvite(projectId, row) {
  const all = readAll();
  const list = (own(all, projectId) && Array.isArray(all[projectId]) ? all[projectId] : []).concat([row]);
  all[projectId] = list.slice(-KEEP_PER_PROJECT);
  writeAll(all);
}
function markWithdrawn(projectId, inviteId, at) {
  const all = readAll();
  const list = own(all, projectId) && Array.isArray(all[projectId]) ? all[projectId] : [];
  const row = list.find((r) => r && r.invite_id === inviteId);
  if (!row) return false;
  row.withdrawn_at = Math.floor(at / 1000);
  writeAll(all);
  return true;
}

/** Forget a removed project's invite rows, so a later project of the same id (ids are name slugs and are reused)
    starts with none: its Members list must never show another project's invites or the owner's labels for them. */
function forget(projectId) {
  const all = readAll();
  if (!own(all, projectId)) return false;
  delete all[projectId];
  writeAll(all);
  return true;
}

/** The owner link for a project, or a refusal: { link } | { status, body }. A link left by an EARLIER project of the
    same id (#3851's stamp: fedseats.linkFor says no, federation.linkFor says yes) is not this project's. It is
    forgotten here, with that room's keys and invite rows, as the own-code route does, so a new invite can never put
    a guest into the old project's room. */
function ownerLinkOf(projectId) {
  let link;
  try {
    const raw = federation.linkFor(projectId);
    if (raw && !require('./fedseats').linkFor(projectId)) {
      federation.forgetLink(projectId);
      try { require('./fedseal').forgetRoom(projectId); } catch { /* an unreadable record keeps every post here */ }
      try { forget(projectId); } catch { /* the list says it could not read its record */ }
    }
    link = federation.linkFor(projectId);
  } catch (err) {
    return { status: 500, body: { error: (err && err.message) || 'we cannot read the connected-projects record on this computer right now' } };
  }
  if (link && link.role === 'member') return { status: 409, body: { reason: 'not-owner', error: 'Only the owner of this project can invite people to it.' } };
  if (link && link.role === 'self') return { status: 409, body: { reason: 'self-shared', error: 'This project is shared with your other computers, so it cannot be shared with other people yet.' } };
  return { link: link && link.role === 'owner' ? link : null };
}

/**
 * Invite from a project. A body naming `project` (an existing project's id) uses that project's owner ref, making
 * and recording one when the project was never shared; a body with `project_ref` is the create screen's path, as
 * today. Only the first is recorded here (the create screen invites before the project exists, so it has no id
 * to file the row under); Members still lists anyone who joined through such a code, from the coordinator's
 * connections, with no label. `projectExists(id)` answers whether the
 * project is on this board, and `projectName(id)` its name.
 */
/* Invites for one project run one at a time: two at once on a never-shared project would each mint a ref, and the
   code whose ref lost the race would open a room this board never sits in (review round 1). */
const inviteChains = new Map();
function invite(remote, body, deps = {}) {
  const key = body && typeof body.project === 'string' ? body.project : null;
  if (!key) return inviteNow(remote, body, deps);
  const prev = inviteChains.get(key) || Promise.resolve();
  const next = prev.then(() => inviteNow(remote, body, deps), () => inviteNow(remote, body, deps));
  inviteChains.set(key, next);
  next.finally(() => { if (inviteChains.get(key) === next) inviteChains.delete(key); }).catch(() => {});
  return next;
}
async function inviteNow(remote, body, { projectExists, projectName, projectDesc, projectCreated, now = Date.now() } = {}) {
  const label = cleanLabel(body && body.label);
  let projectId = null;
  let req = body;
  let linkToRecord = null;
  if (body && typeof body.project === 'string' && body.project) {
    projectId = body.project;
    if (!projectExists || !projectExists(projectId)) return { status: 404, body: { error: 'That project is not on this computer.' } };
    const o = ownerLinkOf(projectId);
    if (!o.link && o.status) return o;
    const ref = o.link ? o.link.ref : crypto.randomUUID();
    if (!o.link) {
      /* Stamped with the PROJECT's createdAt, as the create path stamps it (fedseats.stampOf compares the two): any
         other value reads as a link left by an earlier project, and the seat check forgets it (review round 1). A
         never-shared project also starts with no room keys, whatever an earlier project of its id left. */
      const born = projectCreated ? projectCreated(projectId) : null;
      linkToRecord = { role: 'owner', ref };
      if (typeof born === 'string' && born) linkToRecord.project_created = born;
      try { require('./fedseal').forgetRoom(projectId); } catch { /* an unreadable record keeps every post here */ }
    }
    // The project's name on this board, never one the request supplied (the coordinator shows it to the invitee).
    /* Its name and description on this board, never the request's (review round 3), cut to the bounds
       federation.invite enforces: a long description the owner never typed into the invite must not refuse it
       (review round 4). */
    const name = cut(String((projectName && projectName(projectId)) || projectId), federation.NAME_MAX);
    req = Object.assign({}, body, { project_ref: ref, project_name: name });
    const desc = projectDesc ? projectDesc(projectId) : null;
    if (typeof desc === 'string' && desc.trim()) req.project_desc = cut(desc, federation.DESC_MAX); else delete req.project_desc;
    delete req.project;
  }
  const out = await federation.invite(remote, req);
  if (out.status !== 200) return out;
  /* The link is recorded only once the coordinator made the invite, so a refused invite leaves a never-shared
     project exactly as it was. A link that cannot be written means the code would open a room this board never
     seats: no code is handed out. */
  if (linkToRecord) {
    /* Review round 2: another path can record a link for this project while the coordinator answered (the own-code
       route sharing it with this account's other computers is synchronous and not in the invite chain). Writing ours
       over it would orphan the computers already joined by that code, so this invite hands out no code instead; the
       coordinator's invite lapses unused. */
    /* Every refusal from here on is after federation.invite stashed this code's sealing half under the new ref; that
       half is dropped, so no secret is kept for a room nothing will ever name (review round 5). */
    const unstash = () => {
      const dot = String(out.body.code || '').lastIndexOf('.');
      if (dot > 0) { try { require('./fedseal').spendInvite(linkToRecord.ref, out.body.code.slice(dot + 1)); } catch { /* best effort */ } }
    };
    if (projectExists && !projectExists(projectId)) {
      unstash();
      return { status: 404, body: { error: 'That project was removed while the code was being made, so no code was made.' } };
    }
    let now2;
    try { now2 = federation.linkFor(projectId); } catch (err) {
      unstash();
      return { status: 500, body: { error: (err && err.message) || 'we cannot read the connected-projects record on this computer right now' } };
    }
    if (now2 !== null) {
      unstash();
      return { status: 409, body: { reason: 'changed', error: 'This project\'s sharing changed while the code was being made, so no code was made. Try again.' } };
    }
    try { federation.recordLink(projectId, linkToRecord); } catch (err) {
      unstash();
      return { status: 500, body: { error: 'We could not record this shared project on this computer, so no code was made. Try again. (' + String((err && err.message) || 'unknown') + ')' } };
    }
  }
  if (projectId) {
    try {
      // Every time here is in unix SECONDS, as the coordinator's expires_at is (review round 3).
      recordInvite(projectId, { invite_id: out.body.invite_id, label, kind: req.invited_kind, made_at: Math.floor(now / 1000), expires_at: out.body.expires_at });
    } catch (err) {
      /* The code works whether or not it is listed here; the Members list says the record could not be kept. */
      console.error('#4649: an invite was made but not recorded on this computer: ' + String((err && err.message) || 'unknown').slice(0, 200));
      return { status: 200, body: Object.assign({}, out.body, { recorded: false }) };
    }
  }
  return out;
}

/** The project's Members rows from outside, newest first (the contract's GET /api/federation/members). */
/* Note: ownerLinkOf can forget a STALE link (an earlier project's, #3851) on this read, after which the list reads as
   a project that invited nobody yet. That is the truth for this project: the stale rows were the earlier one's. */
async function members(remote, projectId, now = Date.now(), { projectExists } = {}) {
  if (projectExists && !projectExists(projectId)) return { status: 404, body: { error: 'That project is not on this computer.' } };
  const o = ownerLinkOf(projectId);
  if (o.status && o.body.reason === 'not-owner') return { status: 200, body: memberView(projectId) };
  /* Slice 1b (Pete's Q-K6): a project shared only with this account's other computers is answered, not refused, so the
     screen can leave out "Invite someone outside" (#4658) rather than fail when it makes a code. */
  if (o.status && o.body.reason === 'self-shared') return { status: 200, body: { owner: true, self_shared: true, sealed: false, invites: [], checked_at: null } };
  if (o.status) return o;
  let rows;
  try { rows = rowsFor(projectId); } catch (err) { return { status: 500, body: { error: err.message } }; }
  let edges = null;
  let checkedAt = null;
  if (o.link) {
    const r = await remote.macRequest('POST', MAC_EDGES, {});
    if (r && r.ok && r.data && Array.isArray(r.data.as_owner)) {
      edges = r.data.as_owner.filter((e) => e && e.project_ref === o.link.ref);
      checkedAt = Math.floor(now / 1000);
    }
  }
  const sec = Math.floor(now / 1000);
  const out = rows.slice().reverse().map((row) => {
    const edge = edges ? edges.filter((e) => e.invite_id === row.invite_id).sort((a, b) => b.created_at - a.created_at)[0] : null;
    let state;
    if (edge) state = edge.status === 'active' ? 'joined' : 'removed';
    else if (row.withdrawn_at) state = 'withdrawn';
    else if (Number.isFinite(row.expires_at) && row.expires_at <= sec) state = 'expired';
    else state = 'pending';
    return {
      invite_id: row.invite_id, label: row.label || null, kind: row.kind, made_at: row.made_at, expires_at: row.expires_at,
      state, edge_id: edge ? edge.id : null, joined_at: edge ? edge.created_at : null,
    };
  });
  /* Review round 3: a connection with no row here (its code was made on the create screen, or on another of this
     account's computers) is still someone in the room. It is listed, with no label, so it can be removed. */
  if (edges) {
    const known = new Set(rows.map((r) => r.invite_id));
    const extra = edges.filter((e) => !known.has(e.invite_id))
      .map((e) => ({ invite_id: e.invite_id, label: null, kind: e.member_kind || null, made_at: null, expires_at: null,
        state: e.status === 'active' ? 'joined' : 'removed', edge_id: e.id, joined_at: e.created_at }));
    out.push(...extra);
    /* One order for both kinds of row, newest first (review round 4): by when someone joined, else when the code was
       made; a row with neither sorts last. Rows from codes not recorded here can share an invite_id (several people,
       or one person rejoining): a screen keys a row by edge_id when it has one. */
    const at = (r) => (Number.isFinite(r.joined_at) ? r.joined_at : (Number.isFinite(r.made_at) ? r.made_at : 0));
    out.sort((a, b) => at(b) - at(a));
  }
  let sealed = false;
  try { sealed = !!(o.link && require('./fedseal').isSealedRef(o.link.ref)); } catch { sealed = false; }
  return { status: 200, body: { owner: true, sealed, invites: out, checked_at: checkedAt } };
}

/** Slice 1b (Pete's Q-K4): what a project this board JOINED shows about itself. `owner_name` is the handle the
    coordinator gave at verify (already cut and cleaned there). `sealed` is a room joined with a sealing code (whether
    or not the owner's key has arrived yet). `ended` is the mark fedseats keeps once the connection ended, and
    `removed` is the case where the owner revoked this computer (#5193's reason). */
function memberView(projectId) {
  let link = null;
  try { link = federation.linkFor(projectId); } catch { link = null; }
  // A record that cannot be read answers null ("cannot tell"), never a false "not sealed" (review round 1).
  let sealed = null;
  try { const st = require('./fedseal').roomState(projectId); sealed = !!(st && st.role === 'member'); } catch { sealed = null; }
  const ended = !!(link && link.ended);
  const reason = ended && typeof link.ended === 'string' ? link.ended : '';
  // The connector's own words stay here (they carry an HTTP path); the screen gets the two facts it shows.
  return {
    owner: false, owner_name: (link && typeof link.owner_handle === 'string' && link.owner_handle) || null, sealed,
    ended, removed: /revoked|removed this computer/i.test(reason), invites: [], checked_at: null,
  };
}

/** The owner's room line when a member's computer first arrives (slice 1b, Q-K1): the owner's label for that invite,
    or a plain sentence. Called by fedseats when it pins the member, which is when someone has really joined. */
function joinedLine(projectId, inviteId) {
  let row = null;
  try { row = rowsFor(projectId).find((x) => x && x.invite_id === inviteId) || null; } catch { row = null; }
  return row && row.label ? row.label + ' joined.' : 'Someone joined from outside.';
}

/** Remove a joined member: revoke its connection. The owner's next room check rotates the key (#3728, #5191). */
async function remove(remote, projectId, edgeId) {
  if (typeof edgeId !== 'string' || !edgeId) return { status: 400, body: { error: 'we could not read that request' } };
  const o = ownerLinkOf(projectId);
  if (o.status) return o;
  if (!o.link) return { status: 404, body: { error: 'Nobody from outside is in this project.' } };
  const e = await remote.macRequest('POST', MAC_EDGES, {});
  if (!e || !e.ok || !e.data || !Array.isArray(e.data.as_owner)) return { status: 502, body: { error: 'Kosmos could not check who is in this project just now. Try again in a moment.' } };
  const edge = e.data.as_owner.find((x) => x && x.id === edgeId && x.project_ref === o.link.ref);
  if (!edge) return { status: 404, body: { error: 'That member is not in this project.' } };
  const r = await remote.macRequest('POST', MAC_REVOKE, { edge_id: edgeId });
  if (!r || !r.ok) return { status: 502, body: { error: (r && r.because) || 'Kosmos could not remove them just now. Try again in a moment.' } };
  /* The room line the contract promises, written here (the screen does not): the owner's label when there is one. */
  let label = null;
  try { const row = rowsFor(projectId).find((x) => x && x.invite_id === edge.invite_id); label = row ? row.label : null; } catch { label = null; }
  let sealed = false;
  try { sealed = require('./fedseal').isSealedRef(o.link.ref); } catch { sealed = false; }
  const who = label || 'them';
  const line = sealed
    ? 'You removed ' + who + '. New messages here are sealed with a new key they do not have.'
    : 'You removed ' + who + '. They no longer get new messages from this room.';
  return { status: 200, body: { removed: true }, roomLine: line };
}

/** Withdraw an unused invite (slice 2's coordinator route). */
async function withdraw(remote, projectId, inviteId, now = Date.now()) {
  if (typeof inviteId !== 'string' || !inviteId) return { status: 400, body: { error: 'we could not read that request' } };
  const o = ownerLinkOf(projectId);
  if (o.status) return o;
  let row;
  try { row = rowsFor(projectId).find((x) => x && x.invite_id === inviteId); } catch (err) { return { status: 500, body: { error: err.message } }; }
  if (!row) return { status: 404, body: { error: 'That invite is not one this project made.' } };
  const r = await remote.macRequest('POST', MAC_WITHDRAW, { invite_id: inviteId });
  if (!r || !r.ok) {
    /* The coordinator's own sentences (kosmos-relay fed.rs withdraw_for) first, then the two ways the route can be
       missing: a connector older than it refuses to sign it, and a coordinator older than it has no such path. */
    const b = String((r && r.because) || '');
    if (/already been used/i.test(b)) return { status: 409, body: { reason: 'joined', error: 'Someone already joined with this code. Remove them instead.' } };
    if (/already withdrawn/i.test(b)) { try { markWithdrawn(projectId, inviteId, now); } catch { /* the list reads it next time */ } return { status: 200, body: { withdrawn: true } }; }
    if (/no such invite/i.test(b)) return { status: 404, body: { error: 'Kosmos+ does not know this code any more. It cannot be used.' } };
    if (/does not sign/i.test(b) || /\bHTTP 404\b/.test(b)) return { status: 409, body: { reason: 'unsupported', error: 'Kosmos cannot withdraw a code yet. This one stops working on its own when it lapses.' } };
    return { status: 502, body: { error: b || 'Kosmos could not withdraw this code just now. Try again in a moment.' } };
  }
  try { markWithdrawn(projectId, inviteId, now); } catch (err) { return { status: 500, body: { error: err.message } }; }
  return { status: 200, body: { withdrawn: true } };
}

module.exports = { FILE, LABEL_MAX, MAC_REVOKE, MAC_WITHDRAW, cleanLabel, invite, members, remove, withdraw, rowsFor, forget, memberView, joinedLine };
