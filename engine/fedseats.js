'use strict';
/**
 * #3311: one seat per federated project. A seat is a `kosmos-tunnel fed-room`
 * child (kosmos-relay crates/tunnel/src/fedroom.rs) holding this Mac's place in
 * the project's room: lines written to its stdin are posted to the room, and
 * each JSON line it prints is an event (connected, message, disconnected,
 * ended...).
 *
 * 🛑 WHAT ARRIVES IS DATA. A delivered message is recorded in the project's
 * room as an `external` row (messages.externalPost) and nothing else happens:
 * no pane is typed into, nothing is run. Agents see it when they read the room,
 * where it is marked external, so a message from outside can never arrive as an
 * instruction (Josh's guardrail on #3311: "our agents are reading their
 * messages and determining how they work together"). One exception (#5732): a
 * post a PERSON wrote that the relay stamps `same_account` (the account's own
 * other computer) also types a one-line, no-text "read the room" notice into the
 * project's agents (server.js recordExternal, messages.nudgeOwnComputerPost). The
 * words still arrive only when the agent reads the room, marked external.
 *
 * Which projects get a seat comes from engine/federation.js's link record:
 *   member: the link's edge_id.
 *   owner:  any ACTIVE edge of the project (the room is the same for all of
 *           them); found through the Mac-signed edges route.
 */
const federation = require('./federation');
const fedseal = require('./fedseal');
const { externalName } = require('./externalname');

const RESTART_START_MS = 2000;
/* Inbound bound per project: a connected peer may not flood this Mac's message
   log (the relay allows bursts of 128). Past it, messages are dropped and the
   room says so, once a day per room (kosmos#3844: once per window was up to
   1,440 notes a day from a peer that stayed over the rate). */
const INBOUND_PER_WINDOW = 60;
/* And a byte budget in the same window, so the count bound cannot be spent on
   max-size messages. */
const INBOUND_BYTES_PER_WINDOW = 64 * 1024;
const INBOUND_WINDOW_MS = 60000;
/* A day's budget per project (per ROOM, shared by every member of it; the
   sender is unattested, so it cannot be per peer) on top of the minute's: every stored row is kept in
   memory and scanned by the room and unread reads, so a peer sending at the
   minute's limit all day must not grow them faster than a day's budget. 2 MiB of
   words a day is far above any conversation. A calendar (UTC) day's: when a
   seat's day starts it is seeded from what the log already holds for that room
   today (deps.externalKeptOn), so a restart (an update, a crash) does not start
   a fresh allowance (kosmos#3844). Only RATE is bounded, per day: a total cap on
   stored rows waits on the message log's retention, a recorded decision in
   engine/messages.js (dropping rows there changes the nudge sweep). */
const INBOUND_BYTES_PER_DAY = 2 * 1024 * 1024;
/* And rows a day per room: every row is held in memory and scanned on every
   read, so tiny messages at the minute's limit must not grow it faster than
   this per UTC day (bounded per day, not in total: see the budget above). */
const INBOUND_ROWS_PER_DAY = 2000;
/* The connector's limit on one stdin line (kosmos-relay fedroom MAX_POST, the
   relay's frame bound). */
const MAX_POST_LINE = 16 * 1024;
/* The connector's final refusals that are about this Mac or its account, not
   the connection (kosmos-relay fedroom.rs FINAL_REFUSALS). */
const MAC_LEVEL_REFUSAL = /unknown mac|this (?:mac|computer) was retired|account gone|not set up for kosmos\+/i;   // #4645: either wording of the retired answer (engine/remote.js retiredAlready matches the same sentence with its own regex)
/* #5193: a member's edge revoked by the owner, told in one plain sentence. The connector's own
   reason for it reads "...that connection has been revoked. Ask to be re-invited. (HTTP 409 on
   /v1/mac/federation/room-ticket)", which shows a raw path and says "ask" twice. */
const REVOKED_REFUSAL = /that connection has been revoked/i;   // the connector's FINAL_REFUSALS phrase, not any 'revoked'
const REVOKED_NOTE = 'The owner removed this computer from the project. Ask them for a new code to join again.';
/* #5404: a member learns of its removal only at its next edge check or the connector's refusal, so a post it
   sends in between goes out, and the other boards may refuse it (an old-key post past the grace). Each member seat
   keeps when its posts went, and on the removal the room is told how many went at or after the coordinator's
   revoked_at, less REVOKE_SENT_SKEW_MS for the two clocks and the whole-second stamp. Said as "may not": during the
   grace some can still open (REVOKE_GRACE_MS). */
const SENT_LOG_MAX = 64;
const SENT_LOG_MS = 10 * 60 * 1000;
const REVOKE_SENT_SKEW_MS = 5 * 1000;
function noteSentAfterRevoke(projectId, s, revokedAtSec) {
  if (!Number.isFinite(revokedAtSec) || revokedAtSec <= 0) return;   // nothing says when, so no claim
  const log = s.sentLog || [];
  s.sentLog = [];
  const since = revokedAtSec * 1000 - REVOKE_SENT_SKEW_MS;
  const n = log.filter((t) => t >= since).length;
  if (!n) return;
  say(projectId, (n === 1 ? 'A message this computer sent' : n > SENT_LOG_MAX ? 'More than ' + SENT_LOG_MAX + ' messages this computer sent' : n + ' messages this computer sent')
    + ' around the time it was removed may not have been shown to the others in the shared project.');
}
/** A connector reason fit to show a person: without its HTTP trailer or its own "ask again"
    (the room's sentence says what to do), and without a trailing full stop. The reason comes from
    outside and can be a whole 64 KB line, so only its first REASON_SCAN characters are read, and
    cleaned first (format characters out, whitespace runs collapsed) so neither a hidden character
    nor a run of spaces defeats or slows the patterns; it is cut to its shown length only after,
    so a long one cannot keep half a trailer (round 2). */
const REASON_SCAN = 1000;
function plainReason(why) {
  let raw = typeof why === 'string' ? why.slice(0, REASON_SCAN) : why;
  // Never half a character: a cut on the first half of a surrogate pair drops it (round 3).
  if (typeof raw === 'string' && /[\ud800-\udbff]$/.test(raw)) raw = raw.slice(0, -1);
  const r = clean(clean(raw, REASON_SCAN)
    .replace(/ ?\(HTTP \d{3}[^)]*\)/gi, '')
    .replace(/ ?Ask to be re-invited\.?/gi, ''), 200);
  // Trimmed after the cut, so a long reason cannot end in its own full stop or a space (round 3).
  let end = r.length;
  while (end > 0 && (r[end - 1] === '.' || r[end - 1] === ' ')) end -= 1;
  return r.slice(0, end) || 'the connection ended';
}
/* How long a seat refused for a Mac-level reason waits before trying again. */
const MAC_RETRY_MS = 5 * 60 * 1000;
/* The longest stdout line kept while waiting for its newline. The connector
   prints one event per line, each under its 16 KiB post bound plus framing; a
   longer unterminated run is a broken child, and is dropped rather than held. */
const MAX_LINE = 64 * 1024;
const RESTART_MAX_MS = 60000;
/* A connection that lasted this long resets the restart backoff. */
const STABLE_MS = 30000;
const MAC_EDGES = '/v1/mac/federation/edges';
// kosmos#7028: the account's computers (unretired, unheld), each naming its mac id.
const MAC_COMPUTERS = '/v1/mac/account-computers';

/* projectId -> { child, edge, status, backoff, timer, ended, stopped, starting, inbound, inday }
   inbound: this minute's { since, count, bytes }; inday: this UTC day's { day, bytes, rows, noted, minuteNoted } */
const seats = new Map();

let deps = null;
/**
 * Wire the manager. Everything it touches is injected so a test can drive it:
 *   spawnSeat(edgeId) -> a ChildProcess-like { stdin, stdout, on('exit') }
 *   macRequest(method, route, body) -> { ok, data | because }
 *   recordExternal(projectId, { from, fromKind, text, member?, sameAccount? })
 *   onStatus(projectId, status)   optional
 *   enrolled() -> bool            optional; no seat is started on a Mac that is
 *                                 not connected to Kosmos+ (a dev board, a test)
 *   allowed() -> bool             optional; no seat is started until the board has
 *                                 stated live execution (#5671: the same opt-in the
 *                                 company rollup and the other outward sweeps wait for)
 *   projectExists(projectId)      optional; a removed project gets no seat
 *   externalKeptOn(projectId, day) optional; { rows, bytes } the room already kept
 *                                 from outside on that UTC day, null if unknown
 *   projectCreatedAt(projectId)   optional; the project's createdAt, null when it
 *                                 has none, undefined when it cannot be read. A
 *                                 link stamped for another project of the same id
 *                                 gets no seat (#3851)
 *   note(projectId, text)         optional; Kosmos's own line in the room, used to
 *                                 say a post did not go out or messages were dropped
 *   macId() -> string             optional; this computer's Kosmos+ id (#4658: an own
 *                                 computer names itself in key-own-hello; without it
 *                                 it never asks for a sealed room's key)
 */
function configure(d) {
  deps = d;
  macEdges = null;   // an answer from the previous wiring is not this one's
  macComputers = null;   // kosmos#7028: likewise
}

/** Whether the board wired an optional dependency (a test's check that server.js
    passes it: an optional dep left out fails soft and silently). */
function wired(name) {
  return !!deps && typeof deps[name] === 'function';
}

function statusOf(projectId) {
  const s = seats.get(projectId);
  return s ? s.status : null;
}

/* A one-line label from outside: externalname.js, the one cleaner for a
   name or label that came from another account (format characters, controls and
   line separators out, whitespace collapsed). */
function clean(v, max) {
  return externalName(v, max);
}

/* One event line from a seat. Unknown shapes are ignored; a message is recorded
   only if it carries text, and its `from`/`kind` are taken as the sender's own
   claim about themselves, stored as data. */
function onEvent(projectId, line) {
  handleEvent(projectId, line, 0);
}
/* `heldAt` (#5191): when a post held for an edge check arrived, as it is let through after
   the check. Not exported, so no outside caller can skip the hold. */
function handleEvent(projectId, line, heldAt) {
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (!ev || typeof ev !== 'object') return;
  const s = seats.get(projectId);
  // #5193: a seat ended by the edge check ignores what its dying connector still has in the pipe
  // (a late 'connected' or 'disconnected' would change the status; a message would be recorded).
  if (!s || s.stopped) return;
  // The backoff resets only once a connection has lasted (see the exit handler),
  // so a seat that connects and drops at once still backs off.
  if (ev.event === 'connected') {
    setStatus(projectId, 'connected'); s.connectedAt = Date.now(); s.macNoted = false; s.endedNoted = false;
    // #3728: the room id both ends share (the coordinator derives it per project); it is bound into every seal.
    s.room = typeof ev.room === 'string' && ev.room ? ev.room : null;
    sayHello(projectId, s);
    sendRotates(projectId, s);
    // #5285: someone did join; a post held for that check now waits as any held post does (for the key, the hour).
    for (const h of s.outbox || []) if (h.msg && h.msg.joinWait) h.msg = Object.assign({}, h.msg, { joinWait: false });
    flushHeld(projectId, s);   // a post held for the room id, or for a key that arrived meanwhile
    return;
  }
  if (ev.event === 'disconnected') { setStatus(projectId, 'reconnecting'); return; }
  if (ev.event === 'ended') {
    s.ended = plainReason(ev.because);
    // Some final refusals are about THIS Mac or account, not the edge (the
    // connector's FINAL_REFUSALS). Signing in again fixes those, so nothing about
    // the edge is kept and the person is told the real fix.
    s.macLevel = MAC_LEVEL_REFUSAL.test(s.ended);
    if (s.macLevel) {
      // Said once until the seat connects again, not on every slow retry.
      if (!s.macNoted) {
        s.macNoted = true;
        say(projectId, 'This computer is not connected to Kosmos+ right now (' + s.ended + '). Sign in to Kosmos+ again in Settings, Kosmos+, and this shared project comes back.');
      }
      return;
    }
    // An owner's seat is pinned to one member's edge: that edge ending is not
    // the owner leaving, so the note (and its "ask the owner") is a member's.
    const link = safeLink(projectId);
    if (!link || link.role !== 'member') return;
    // #5193: one ending sentence per seat, whichever path says it first (the edges check, or an
    // earlier 'ended' line on this live seat): never two, never two that disagree (round 2).
    if (s.endedNoted) return;
    s.endedNoted = true;
    if (REVOKED_REFUSAL.test(s.ended)) {
      say(projectId, REVOKED_NOTE);
      // #5404: the refusal carries no time, and it can come before the edge check finds the revoke (a cached
      // answer from before it). So ask once more, refusing any answer asked before now, for revoked_at.
      if (deps && link.edge_id && s.sentLog && s.sentLog.length) {
        sharedEdges(Date.now(), mono()).promise.then((r) => {
          if (seats.get(projectId) !== s) return;
          const e = r && r.ok && r.data && Array.isArray(r.data.as_member) ? r.data.as_member.find((x) => x && x.id === link.edge_id) : null;
          if (e && e.status === 'revoked') noteSentAfterRevoke(projectId, s, e.revoked_at);
        }).catch(() => {});
      }
      return;
    }
    say(projectId, 'This computer is no longer connected to the external project: ' + s.ended + '. To take part again, ask the owner for a new code.');
    return;
  }
  if (ev.event === 'refused_post') { say(projectId, 'A message was not sent to ' + farSide(projectId) + ': ' + clean(ev.because, 200) + '.'); return; }
  if (ev.event === 'message' && ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data)) {
    // #3728: key frames are the room's handshake, never a row.
    if (typeof ev.data.t === 'string' && ev.data.t.startsWith('key-')) { onKeyFrame(projectId, s, ev.data, ev.same_account === true); return; }
    const sealed = roomSeal(projectId);
    const sealedRoom = sealed === undefined ? undefined : isSealedRoom(sealed, sealLink(projectId));
    if (sealedRoom === undefined) { noteOnce(projectId, s, 'sealUnreadable', 'A message from ' + farSide(projectId) + ' was not shown: this computer cannot read its sealed-rooms record right now.'); return; }
    if (fedseal.isSealed(ev.data)) {
      const now = Date.now();
      // #5191: the relay's stamp names a member this owner knows is revoked, on a key that member
      // held: refused, grace or not, before it can take a held place. The epoch is the envelope's,
      // not yet opened, but the stamp is the relay's, so a wrong one refuses only its sender's post.
      // No stamp (an older relay): as before.
      if (sealed && sealed.role === 'owner' && isRevokedPost(sealed, ev.member, ev.data.epoch)) {
        noteOnce(projectId, s, 'revokedPost', 'A message from someone you removed from this shared project was not shown.');
        return;
      }
      // #5191: an owner opens a post only after a recent enough edge check (holdForCheck).
      if (!heldAt && sealed && sealed.role === 'owner' && hasKey(sealed) && holdForCheck(projectId, s, sealed, ev.data, line, now)) return;
      // A member seeing a newer epoch than its own missed a rotation: until the owner's
      // re-send arrives it holds its posts (a revoked member may still hold its key).
      // Any epoch ahead counts (a member may have missed several rotations), but the
      // envelope's epoch is unauthenticated until it opens, so the hold arms AT MOST
      // ONCE per epoch this member holds, for BEHIND_HOLD_MS: forged envelopes, however
      // many and whatever epochs they claim, cannot pause a member for longer than that.
      const ahead = sealed && sealed.role === 'member' && hasKey(sealed) && ev.data.epoch > sealed.epoch;
      // A held post is judged at the later of its arrival and the room's last rotation, so a
      // rotation the check made still applies.
      const rotAt = Number.isFinite(sealed && sealed.rotatedAt) ? sealed.rotatedAt : 0;
      const keysAt = !heldAt ? now : (rotAt > heldAt && rotAt - heldAt <= HELD_ROTATION_LAG_MS ? rotAt : heldAt);
      const opened = hasKey(sealed) && s.room ? fedseal.open(acceptedKeys(sealed, keysAt), s.room, ev.data) : null;
      if (!opened && ahead) {
        if (s.behindArmedAt !== sealed.epoch) {
          s.behindArmedAt = sealed.epoch;
          s.behind = { epoch: ev.data.epoch, until: now + BEHIND_HOLD_MS };
        }
        noteOnce(projectId, s, 'behind', 'This computer is behind on this shared room\'s key, so a message could not be read yet. It is waiting for the owner\'s computer to send the new key, and holds its own posts for a few minutes meanwhile. A post sent after that, before the new key arrives, may not be shown to the others.');
        return;
      }
      if (!opened && !sealed && noteOwnSealed(projectId, s)) return;   // #4658: an own computer asks for the key
      if (!opened && !sealed) {
        // This computer joined before the owner sealed the room: it holds no key and never will from that code.
        noteOnce(projectId, s, 'sealedSince', 'The owner has sealed this shared room since this computer joined, so its messages cannot be read here. Ask the owner to remove you from the shared project and send you a new code.');
        return;
      }
      if (!opened) {
        // #5191: an owner refusing an older epoch's post re-sends the current key now (at most
        // once per EDGE_FRESH_MS), so a remaining member that missed a rotation catches up
        // without waiting for the next pass. The refused post itself is not resent (#5192 holds
        // only posts not yet sent).
        // The epoch is unauthenticated, so a forger can trigger this too: the limit bounds it,
        // and it only re-sends sealed frames, one to each pinned member.
        if (sealed && sealed.role === 'owner' && ev.data.epoch < sealed.epoch && !isFresh(s.rotatesResentAt, now)) {
          s.rotatesResentAt = now;
          sendRotates(projectId, s);
        }
        if (sealed && hasKey(sealed) && ev.data.epoch < sealed.epoch && !Object.prototype.hasOwnProperty.call(acceptedKeys(sealed, keysAt), ev.data.epoch)
          && (sealed.role === 'owner' || Object.prototype.hasOwnProperty.call(sealed.keys, ev.data.epoch))) {   // a member that joined later never held it
          noteOnce(projectId, s, 'retired', 'A message sealed with this room\'s earlier key arrived after that key was retired, so it was not shown. It is from someone removed from the shared project, or from a computer still catching up on the new key' + (sealed.role === 'owner' ? '.' : '. Or this computer\'s clock may be off.'));
          return;
        }
        noteOnce(projectId, s, 'unopened', 'A sealed message arrived that this computer could not open, so it was not shown.');
        return;
      }
      const fresh = freshMessage(s, opened, now);
      if (fresh === 'seen') { noteOnce(projectId, s, 'replay', 'A sealed message arrived a second time, so it was not shown again.'); return; }
      if (fresh === 'time') {
        noteOnce(projectId, s, 'clock', 'A sealed message arrived with a time more than an hour from this computer\'s clock, so it was not shown. If messages keep not showing, check the date and time on this computer and on the other one.');
        return;
      }
      ev.data = opened.m;
    } else if (sealedRoom) {
      // No downgrade: once a room is sealed, words sent in the clear are not shown.
      noteOnce(projectId, s, 'unsealed', 'A message arrived unsealed in this sealed room, so it was not shown. If someone joined before this room was sealed, remove them from the shared project and send them a new code.');
      return;
    }
  }
  if (ev.event === 'message' && ev.data && typeof ev.data === 'object' && typeof ev.data.text === 'string' && ev.data.text.trim()) {
    const now = Date.now();
    if (!s.inbound || now - s.inbound.since >= INBOUND_WINDOW_MS) s.inbound = { since: now, count: 0, bytes: 0 };
    const day = new Date(now).toISOString().slice(0, 10);
    if (!s.inday || s.inday.day !== day) {
      let kept = null;
      try { kept = typeof deps.externalKeptOn === 'function' ? deps.externalKeptOn(projectId, day) : null; } catch { kept = null; }
      s.inday = {
        day,
        bytes: kept && Number.isFinite(kept.bytes) ? kept.bytes : 0,
        rows: kept && Number.isFinite(kept.rows) ? kept.rows : 0,
        noted: false,
        minuteNoted: false,
      };
    }
    // `from` is whatever the other Mac wrote: only a string counts. String() on an
    // object whose toString is not a function throws, here, where nothing catches.
    const fromRaw = typeof ev.data.from === 'string' ? ev.data.from : '';
    // Charged for what is KEPT: the name is cut to 80 before it is stored, so its
    // raw length must not spend the room's budget (a padded name would use up the
    // day while storing nothing).
    const fromKept = clean(fromRaw, 80) || 'someone outside';
    const size = Buffer.byteLength(ev.data.text) + Buffer.byteLength(fromKept);
    s.inbound.count += 1;
    s.inbound.bytes += size;
    if (s.inbound.count > INBOUND_PER_WINDOW || s.inbound.bytes > INBOUND_BYTES_PER_WINDOW) {
      if (!s.inday.minuteNoted && s.heldNotedOn !== s.inday.day) { s.inday.minuteNoted = true; say(projectId, farSide(projectId, true) + ' sent more messages than Kosmos keeps in a minute; some were not kept. Kosmos says this once a day.'); }
      return;
    }
    // Only what is KEPT counts toward the day: a flood the minute bound drops
    // must not spend the room's day for everyone else in it.
    if (s.inday.bytes + size > INBOUND_BYTES_PER_DAY || s.inday.rows + 1 > INBOUND_ROWS_PER_DAY) {
      if (!s.inday.noted) { s.inday.noted = true; say(projectId, farSide(projectId, true) + ' sent more than Kosmos keeps in a day; messages from there are not kept until the day resets (midnight UTC).'); }
      return;
    }
    s.inday.bytes += size;
    s.inday.rows += 1;
    // Runs inside the child's stdout 'data' handler, where a throw (a full disk)
    // has nothing above it to catch it and would take the board down.
    try {
      deps.recordExternal(projectId, Object.assign({
        from: fromKept,
        fromKind: ev.data.kind === 'agent' ? 'agent' : 'person',
        text: ev.data.text,
      /* #4649 slice 3: the poster's room member as the RELAY stamped it, top-level beside `data` (the connector never
         takes it from `data`, as #4657's same_account). Anything the sender wrote inside `data` is ignored;
         messages.externalPost keeps only a well-shaped value. Absent from an older relay, and then no key at all. */
      }, typeof ev.member === 'string' ? { member: ev.member } : {},
      /* #5732: the relay's same_account stamp (kosmos#4657), beside `data` so a sender cannot write it: the poster is
         this account, from another of its computers. Passed only as true; absent otherwise. */
      ev.same_account === true ? { sameAccount: true } : {}));
    } catch {
      say(projectId, 'A message from ' + farSide(projectId) + ' could not be saved on this computer.');
    }
  }
}

/* kosmos#4699: what the far side of a room is called in a note. "The external project" is only true of a
   project joined from someone else, or an owner's project shared with guests alone. A room the person's
   own computers sit in (a `self` link, or an owner project shared by own code) may hold their computers
   only, or a guest's as well, and this computer cannot tell which before its seat is up. So those rooms,
   and a record that cannot be read, get words that are true either way. */
function farSide(projectId, startsSentence) {
  const l = safeLink(projectId);
  const external = l && (l.role === 'member' || (l.role === 'owner' && l.selfShared !== true));
  const words = external ? 'the external project' : 'the other computers in this project';
  return startsSentence === true ? words.charAt(0).toUpperCase() + words.slice(1) : words;
}

/* The room line both sides show once their room has its key (#3728 member; #5195 owner, who decides what to share
   and most needs to know the relay cannot read it). */
const SEALED_LINE = 'This shared room is sealed: only the computers in it can read its messages.';
function say(projectId, text) {
  if (deps && typeof deps.note === 'function') { try { deps.note(projectId, text); } catch { /* a note is furniture */ } }
}

function setStatus(projectId, status) {
  const s = seats.get(projectId);
  if (!s) return;
  s.status = status;
  if (status === 'ended') dropHeld(projectId, s, 'the connection has ended');
  if (deps && typeof deps.onStatus === 'function') {
    try { deps.onStatus(projectId, status); } catch { /* status is furniture */ }
  }
}

/* An active edge of the owner's project, skipping any edge whose seat was
   already refused for good (the seat exited 3), so the owner's seat does not
   spawn, be refused, and spawn again every minute. */
/* { edge } for an active edge, { none: true } when Kosmos+ answered and nobody
   has joined, { failed: why } when the question could not be asked or answered:
   that is NOT "nobody joined", and the room must not say it is. */
async function ownerEdge(link, refused, edges) {
  let r;
  try { r = await (edges ? edges() : deps.macRequest('POST', MAC_EDGES, {})); }
  catch (err) { return { failed: String((err && err.message) || err) }; }
  if (!r || !r.ok || !r.data || !Array.isArray(r.data.as_owner)) return { failed: String((r && r.because) || 'no answer') };
  const edge = r.data.as_owner.find((e) => e && e.project_ref === link.ref && e.status === 'active'
    && !(refused && refused.has(e.id)));
  return edge ? { edge: edge.id } : { none: true };
}

function spawnFor(projectId, edge) {
  const s = seats.get(projectId);
  const child = deps.spawnSeat(edge);
  s.child = child;
  // A connector that cannot start (missing, not executable) emits 'error' and
  // may never 'exit': treat it as an exit so it backs off instead of crashing
  // the board on an unhandled event.
  // Only when it never started (no pid): an 'error' from a failed kill or signal
  // comes from a process that is still running, and a synthetic exit would let a
  // second seat into the same room.
  child.on('error', () => { if (child.pid === undefined) child.emit('exit', null); });
  // A write racing the child's death surfaces as an async EPIPE on stdin; with no
  // listener it would crash the board.
  if (child.stdin && typeof child.stdin.on === 'function') child.stdin.on('error', () => {});
  // The same for a stream error on stdout: unlistened, it would crash the board.
  if (child.stdout && typeof child.stdout.on === 'function') child.stdout.on('error', () => {});
  // Only a real edge id is kept as the seat's edge (it is what a refusal adds to the
  // refused set); an own-room seat has none.
  s.edge = typeof edge === 'string' ? edge : null;
  setStatus(projectId, 'connecting');
  let buf = '';
  child.stdout.setEncoding && child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    // Only the seat's CURRENT child speaks for the project. A stopped child can
    // still flush output while it dies, and a new seat may already hold the same
    // project id (ids are slugs, reused); its words must not land in that room.
    // (The close handler below makes the same check.)
    const cur = seats.get(projectId);
    if (!cur || cur.child !== child) { buf = ''; return; }
    buf += chunk;
    if (buf.length > MAX_LINE && buf.indexOf('\n') < 0) buf = '';
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      // Every field of an event came from outside this Mac: no shape of one may
      // throw out of this listener, which has nothing above it and would take the
      // board down.
      if (line.trim()) {
        try { onEvent(projectId, line); } catch (err) { console.error('#3311: an event from the external project could not be read: ' + String((err && err.message) || err)); }
      }
    }
  });
  // A real child's 'exit' can come before its stdout is read, so its last line
  // (the 'ended' reason) would arrive after the exit is handled. 'close' waits
  // for stdout. A child that never started (no pid) gets only the synthetic
  // 'exit' from the error listener.
  child.on(typeof child.pid === 'number' ? 'close' : 'exit', (code) => {
    const cur = seats.get(projectId);
    if (!cur || cur.child !== child) return;
    cur.child = null;
    if (cur.stopped) return;
    // About this Mac, not the edge: keep nothing, and try again slowly, so signing
    // in again brings the room back without a restart (a Mac that is not signed in
    // does not even try: ensure() waits for enrolled()).
    if (code === 3 && cur.macLevel) {
      cur.macLevel = false;
      setStatus(projectId, 'reconnecting');
      cur.timer = setTimeout(() => { cur.timer = null; ensure(projectId).catch(() => {}); }, MAC_RETRY_MS);
      if (typeof cur.timer.unref === 'function') cur.timer.unref();
      return;
    }
    // 3 = a refusal retrying cannot fix. The Mac-level ones were handled just
    // above; what reaches here is about the edge (revoked, no such connection).
    // A lapsed account is never 3: the connector waits and retries itself. A
    // member's seat ends here; an owner's looks for another active edge.
    const link = code === 3 ? safeLink(projectId) : null;
    // An unreadable link record is not an ending: restart like any other exit.
    if (code === 3 && link) {
      /* A computer joined by own code: its room is its own account's, so a refusal there is
         not the end of someone else's invitation. Stop for this session, say so, and try
         again at the next start rather than ending the project. */
      if (link.role === 'self') {
        cur.ownRefused = true;
        say(projectId, 'This project could not be connected to your other computers. Kosmos will try again the next time it starts.');
        setStatus(projectId, 'waiting');
        return;
      }
      if (link.role === 'owner') {
        /* The owner's OWN room (no edge) refused for good: stop seating it this session,
           and say so once, instead of retrying into the same refusal. */
        if (!cur.edge) {
          cur.ownRefused = true;
          say(projectId, 'Your other computers could not be connected to this project. Kosmos will try again the next time it starts.');
          setStatus(projectId, 'waiting');
          return;
        }
        if (!cur.refused) cur.refused = new Set();
        if (cur.edge) cur.refused.add(cur.edge);
        // Kept on the link, so a restart does not try the refused edge again.
        try { federation.recordLink(projectId, Object.assign({}, link, { refused: [...cur.refused].slice(-64) })); } catch { /* retried once next boot */ }
        setStatus(projectId, 'waiting');
        return;
      }
      // Kept on the link, so a board restart does not start the seat again only
      // to be refused and say so in the room once more.
      try { federation.recordLink(projectId, Object.assign({}, link, { ended: cur.ended || 'the connection ended' })); } catch { /* ends again next boot */ }
      setStatus(projectId, 'ended');
      return;
    }
    // 2 is a usage error: this computer's connector does not know the verb.
    // Restarting cannot fix that; updating Kosmos does.
    if (code === 2) {
      /* An owner's OWN room (no edge) on a connector too old for --own-project: the project
         keeps waiting for guests on its edges; only its own room stops for this session. */
      const l2 = safeLink(projectId);
      if (l2 && ((l2.role === 'owner' && !cur.edge) || l2.role === 'self')) {
        cur.ownRefused = true;
        say(projectId, 'This computer\'s Kosmos connector is too old to connect this project to your other computers. Update Kosmos and it will connect.');
        setStatus(projectId, 'waiting');
        return;
      }
      say(projectId, 'This computer cannot join the external project yet: its Kosmos connector is too old. Update Kosmos and it will connect.');
      setStatus(projectId, 'ended');
      return;
    }
    if (cur.connectedAt && Date.now() - cur.connectedAt >= STABLE_MS) cur.backoff = RESTART_START_MS;
    cur.connectedAt = null;
    setStatus(projectId, 'reconnecting');
    cur.timer = setTimeout(() => { cur.timer = null; ensure(projectId).catch(() => {}); }, cur.backoff);
    if (typeof cur.timer.unref === 'function') cur.timer.unref();
    cur.backoff = Math.min(cur.backoff * 2, RESTART_MAX_MS);
  });
}

/* An unreadable link record makes a shared room act local; say so in the log
   (at most once a minute), never silently. */
let unreadableLoggedAt = 0;
function logUnreadable(err) {
  if (Date.now() - unreadableLoggedAt < 60000) return;
  unreadableLoggedAt = Date.now();
  console.error('#3311: the shared-project record (federation.json) cannot be read, so shared rooms act local until it can: ' + String((err && err.message) || err));
}

/* #3851: a link names its project by id, and ids are reused (a slug). A link
   left behind by a removed project (its forget failed while federation.json was
   unreadable) must not make a NEW local project of the same id act shared: every
   post in it would leave this Mac with no join ever made. So a link carries the
   createdAt of the project it was made for (`project_created`). 'stale' is a
   stamp that names another project; 'unstamped' is a link from before the stamp;
   anything else, including a createdAt that cannot be read, is 'ok'. `born` is
   the one createdAt read the verdict was made on, so a stamp written from it is
   the value that was checked. */
function stampOf(projectId, link) {
  if (!link || !deps || typeof deps.projectCreatedAt !== 'function') return { state: 'ok', born: null };
  const born = deps.projectCreatedAt(projectId);
  if (typeof born !== 'string' || !born) return { state: 'ok', born: null };
  if (typeof link.project_created !== 'string') return { state: 'unstamped', born };
  return { state: link.project_created === born ? 'ok' : 'stale', born };
}

/** The link for a project, or null when there is none or it was left by an
    earlier project of the same id (#3851). Throws, like federation.linkFor,
    when the record cannot be read. Every reader outside this module asks here. */
function linkFor(projectId) {
  const link = federation.linkFor(projectId);
  return stampOf(projectId, link).state === 'stale' ? null : link;
}

/* ---- #3728: sealing ---- */

/* A sealed message older than this, or seen before, is a replay and is not shown
   (the relay carries messages live, so an honest one is seconds old). Seen ids are
   kept per seat run; one hour of ids is at most the minute budget times 60. */
const REPLAY_WINDOW_MS = 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
/* #5191: the grace after a rotation, during which the previous epoch still opens (a
   message sealed just before it, still in flight), then never again. An owner rotates
   only when a member is revoked, and the seal does not say which member sealed a post, so it is
   short: in-flight posts plus the relay's room-ticket life (about 60 s). With no member left it
   is none at all: an old-key post can then only come from the revoked member. With members left,
   an owner refuses an old-key post the relay stamps with a revoked account (revokedAccounts,
   below); a post with no stamp (an older relay), or from a member whose account the rotation
   could not name, can still be shown for about min(this, the ticket life) plus EDGE_FRESH_MS,
   about 75 s, relying on the relay to cut the revoked member at its ticket.
   Owner-side alone it is about 15 s + a 20 s round trip + this grace. While Kosmos+ cannot
   answer, the pass shows held posts unchecked: then only the relay's ticket bounds it (a
   sealed room does not trust the relay, so that is not a guarantee).
   #5197: a member that has received the rotation uses the same grace. A member the relay
   never sends the rotation to stays on the old key (fedseal.js NOT CLAIMED). Members hold nothing for
   an edge check, so on a member's board a revoked member is shown until the owner detects
   the revoke and the rotation reaches the member, plus at most this grace (longer by any amount the
   member's clock runs behind the owner's: fedseal.js NOT CLAIMED). A member's grace runs from the
   owner's rotation time on its own clock: a member clock running ahead shortens it
   (fails closed: in-flight posts refused there). */
const REVOKE_GRACE_MS = 90 * 1000;
/* #5191: a sealed post to an owner whose last edge check is older than this waits for a
   check first, so a revoke is found then rather than at the next 60 s pass. One
   check per room per this long, however many posts arrive (they wait on the same one). */
const EDGE_FRESH_MS = 15 * 1000;
/* A held post gets the grace of a rotation made after it arrived only when that rotation
   came within one 60 s pass plus a request's round trip of its arrival (its own check may
   fail; the pass is the next). Held longer (an unreadable record for minutes), it is judged
   at its arrival, so posts held across a long gap do not all open in one burst under the
   grace after the revoke is found; an honest one held that long is refused with them. */
const HELD_ROTATION_LAG_MS = 60 * 1000 + 20 * 1000;
/* Posts held per room while a check is out: the room's minute COUNT budget
   (INBOUND_PER_WINDOW), so past it a post is treated as over that budget. */
const HELD_MAX = INBOUND_PER_WINDOW;
/* How long a member holds its posts after seeing a message sealed one epoch ahead of
   its own (it missed a rotation; the owner re-sends each pass). The epoch on an
   envelope cannot be checked before it opens, so a forged one must cost no more than
   this pause, which is no more than a relay can do anyway by dropping frames. Longer than
   the 90 s grace (#5197), and armed no earlier than the rotation, so a post sent after it,
   still under the old key, is past the grace and refused on the other boards (those whose
   clock is not behind the owner's). It arms once per epoch this member holds, so a forged
   envelope that armed it leaves a real miss of the next rotation, at that epoch, unheld
   (nothing resends a refused post). Holding until the key arrives would let a forger pause
   a member indefinitely. */
const BEHIND_HOLD_MS = 3 * 60 * 1000;

/** This room's seal state, null for a room with none, undefined when the record
    cannot be read (then nothing is sent or shown: we cannot tell). */
function roomSeal(projectId) {
  try { return fedseal.roomState(projectId); } catch { return undefined; }
}
/* #5191 (residual of #5228): an owner room's `revokedAccounts` record, account -> the newest epoch
   that account held. The relay stamps every post with the poster's ticket member (#4649 slice 3),
   which for an outside member is the edge's member_account_id and which the sender cannot write.
   A stamped post from a recorded account sealed at that epoch or older is refused, even inside the
   grace the remaining members' in-flight posts get. Written only in the same save as a rotation,
   from the pinned peers it dropped; a forgotten room's record goes with it. */
/** Whether a post the relay stamped `member`, opened under `epoch`, is a revoked member's. */
function isRevokedPost(st, member, epoch) {
  const m = st && st.revokedAccounts;
  return !!m && typeof m === 'object' && typeof member === 'string' && Object.prototype.hasOwnProperty.call(m, member)
    && Number.isInteger(m[member]) && Number.isInteger(epoch) && epoch <= m[member];
}
/** #5191: this board's own screen removed a member (the coordinator answered the revoke). The room
    is checked now, with an answer asked after the remove, instead of at the next edge check; and
    until a check like that succeeds, no check or shared answer asked before the remove lets a post
    through (holdForCheck, checkRoom). Resolves true when the room rotated; never rejects. */
function afterRemove(projectId) {
  let link = null;
  try { link = linkFor(projectId); } catch { link = null; }
  if (!link || link.role !== 'owner') return Promise.resolve(false);
  const s = seats.get(projectId);
  // The remove's moment is kept on the seat until the next remove: once a later check succeeds,
  // checkedBeforeRemove is false again. With no seat there is nowhere to keep it; the check below
  // still runs (plan: Not covered).
  if (s) {
    // Strictly after the previous remove's token, so an earlier remove's own check (token + 1) never
    // counts as after this one on a timer too coarse to separate them.
    const m = mono();
    s.removedMono = typeof s.removedMono === 'bigint' && m <= s.removedMono + 1n ? s.removedMono + 1n : m;
    s.removedAt = Date.now();
    s.edgeAskedAt = 0;
  }
  // An ordering token, not a measured time: this check is asked after the remove in program order,
  // whatever a coarse timer reads.
  const removedMono = s ? s.removedMono : undefined;   // this remove's moment, not a later remove's
  const after = s ? () => removedMono + 1n : undefined;
  return checkRoom(projectId, link, null, false, null, s, after).then((r) => !!(r && r.rotated), () => false);
}
function hasKey(st) {
  return !!st && !!st.keys && Number.isInteger(st.epoch) && typeof st.keys[st.epoch] === 'string';
}
/** Sealed: a member's room from the join (it holds s); an owner's from the first
    sealing invite for its project, key or no key yet, so an owner whose members'
    hellos never arrive (a relay dropping them) still never speaks in the clear.
    undefined when that cannot be read. */
function isSealedRoom(st, link) {
  if (st && st.role === 'member') return true;
  if (hasKey(st)) return true;
  // The link record could not be read: we cannot tell whether an owner has sealed this
  // room, so the answer is "cannot tell" (nothing sent, nothing shown), never "clear".
  if (link === undefined) return undefined;
  if (link && link.role === 'owner' && typeof link.ref === 'string') {
    try { return fedseal.isSealedRef(link.ref); } catch { return undefined; }
  }
  return false;
}
/** The epochs this board opens now: the current one, and the one before it for a
    grace after a rotation (graceAfter). */
function acceptedKeys(st, now) {
  const keys = { [st.epoch]: st.keys[st.epoch] };
  const prev = st.epoch - 1;
  if (prev >= 0 && typeof st.keys[prev] === 'string' && Number.isFinite(st.rotatedAt) && now - st.rotatedAt >= 0 && now - st.rotatedAt < graceAfter(st)) keys[prev] = st.keys[prev];
  return keys;
}
/** #5191: how long the previous epoch opens after this room's last rotation. An owner
    rotates only on a revoke (rotateForRevoked), so every rotation gets the revoke grace,
    a member's too (#5197), read from the rooms file alone. kosmos#4658: an owner's own computer allowed into
    the room (st.own) posts from another machine and learns a rotation late, as a member does, so it keeps the
    grace too. */
function graceAfter(st) {
  if (st.role !== 'owner') return REVOKE_GRACE_MS;
  return Object.keys(st.peers || {}).length || Object.keys(st.own || {}).length ? REVOKE_GRACE_MS : 0;
}
/** The link for the seal decisions: null when there is none, undefined when the record
    cannot be read (safeLink turns that into null, which would read as "not sealed"). */
function sealLink(projectId) {
  try { return linkFor(projectId); } catch { return undefined; }
}
/** Whether an opened message is fresh: 'ok', 'seen' (a replay of one already shown),
    or 'time' (sealed too long ago or too far ahead of this computer's clock: a replay,
    or one of the two clocks is wrong, which the room's note says). */
function freshMessage(s, opened, now) {
  if (now - opened.at > REPLAY_WINDOW_MS || opened.at - now > FUTURE_SKEW_MS) return 'time';
  s.seen = s.seen || new Map();
  if (s.seen.has(opened.id)) return 'seen';
  s.seen.set(opened.id, opened.at);
  if (s.seen.size > 4096) for (const [id, at] of s.seen) if (now - at > REPLAY_WINDOW_MS) s.seen.delete(id);
  return 'ok';
}
function noteOnce(projectId, s, key, text) {
  s.sealNoted = s.sealNoted || {};
  if (s.sealNoted[key]) return;
  s.sealNoted[key] = true;
  say(projectId, text);
}
function sendFrame(s, frame) {
  if (!s || !s.child || !s.child.stdin || s.status !== 'connected') return false;
  const line = JSON.stringify(frame);
  if (Buffer.byteLength(line) > MAX_POST_LINE) return false;
  try { s.child.stdin.write(line + '\n'); return true; } catch { return false; }
}
/** One sealing step at a time per project: a hello and a rotation both read, await and
    write the room's state, and neither may overwrite the other's pin or key. */
const sealChains = new Map();
function sealStep(projectId, fn) {
  const prev = sealChains.get(projectId) || Promise.resolve();
  const next = prev.then(fn, fn).catch((err) => {
    console.error('#3728: a sealing step for ' + JSON.stringify(projectId) + ' did not finish: ' + String((err && err.message) || err));
  });
  sealChains.set(projectId, next);
  return next;
}
/** Member, until it holds the room key: say hello with this board's key (on each
    connect and on each ensureAll pass, so a hello the relay dropped is said again). */
function sayHello(projectId, s) {
  const st = roomSeal(projectId);
  if (!st || st.role !== 'member' || hasKey(st) || !s.room) return;
  if (st.ownComputer === true) { sayOwnHello(projectId, s); return; }
  try { sendFrame(s, fedseal.helloFrame(st.s, st.code, fedseal.sealingKey(), s.room)); } catch (err) {
    noteOnce(projectId, s, 'noKey', 'This computer could not use its sealing key, so this shared room cannot open yet: ' + String((err && err.message) || err));
  }
}
/** Owner: the current epoch's key to every pinned member, sealed to each one's key.
    Sent on each connect as well as on a rotation, so a member that missed one catches
    up; a member ignores an epoch it already holds. Epoch 0 travels in the key-share. */
function sendRotates(projectId, s) {
  const st = roomSeal(projectId);
  if (!hasKey(st) || st.role !== 'owner' || st.epoch < 1 || !s.room) return;
  let me;
  try { me = fedseal.sealingKey(); } catch { return; }
  // #4658: the owner's own allowed computers too (kept apart from the guest peers, see ownWaiting).
  for (const pub of Object.keys(st.peers || {}).concat(Object.keys(st.own || {}))) {
    try { sendFrame(s, fedseal.rotateFrame(me, pub, st.keys[st.epoch], st.epoch, s.room, Number.isSafeInteger(st.rotatedAt) ? st.rotatedAt : 0)); } catch { /* the next connect sends it again */ }
  }
}

/* ---- #4658: the owner's own computers in a sealed room ----
   Decided on the card 10-24 (comments 6381074916, 6381275649, and 6381388572 for the exchange itself):
   - An own computer (a `self` link) that sees its room sealed records member seal state marked own, with no key,
     so it holds its posts rather than speaking in the clear, and runs the exchange in fedseal.js (hello with a
     commitment, the owner's offer, its reveal) on each connect until it holds the key.
   - Only the board holding the room's seal-OWNER state answers, and lists a computer once its reveal opens its
     commitment. Allow there sends key-own-share and pins the computer in `st.own`, never in `st.peers` (every
     peers reader means a guest). The new computer adopts that share only once its OWN person has confirmed the
     same code (confirmOwn), and only from the owner key of the offer they confirmed.
   - Every own frame must carry the relay's same_account stamp (kosmos#4657, written beside `data` where a sender
     cannot reach it), so a guest in the room cannot take part; frames from an older relay without it are ignored.
   - The member-side flag is `ownComputer: true`; `st.own` exists only on the seal owner, as the pinned map. */

/** This computer's Kosmos+ id, or null (never throws into the seat's handlers). */
function myMacId() {
  try { return deps && typeof deps.macId === 'function' ? deps.macId() : null; } catch { return null; }
}
/** Own computer: the room is sealed and this computer has no key yet. */
function sayOwnHello(projectId, s) {
  const macId = myMacId();
  let me;
  try { me = fedseal.sealingKey(); } catch { return; }
  if (typeof macId !== 'string' || !macId) {
    noteOnce(projectId, s, 'ownNoId', 'This shared room is sealed, and this computer is not signed in to Kosmos+, so it cannot ask for the room\'s key yet. Its messages wait here until it can.');
    return;
  }
  if (!s.room) return;
  if (!s.ownRun || s.ownRun.room !== s.room || s.ownRun.mac !== macId) {
    const nW = fedseal.randomSecret();
    s.ownRun = { room: s.room, mac: macId, nW, commit: fedseal.ownCommit(nW), offer: null, confirmed: false, got: null };
  }
  try { sendFrame(s, fedseal.ownHelloFrame(me, macId, s.ownRun.nW)); } catch { /* the next connect says it again */ }
  noteOnce(projectId, s, 'ownWaiting', 'This shared room is sealed. To read it on this computer, open this project on the computer that first shared it: a code appears on both screens, and once they match, press Allow there and "It matches" here.');
}
/** Own computer: the first sealed message tells it the room is sealed. True when it recorded so. */
function noteOwnSealed(projectId, s) {
  const link = safeLink(projectId);
  if (!link || link.role !== 'self') return false;
  try { fedseal.setRoomState(projectId, { role: 'member', ownComputer: true, keys: {} }); } catch {
    noteOnce(projectId, s, 'ownSealUnsaved', 'This shared room is sealed, and this computer could not record that, so it cannot ask for the room\'s key yet. Kosmos tries again with the next message.');
    return true;   // handled: the guest's "ask the owner for a new code" line is not this computer's
  }
  sayOwnHello(projectId, s);
  checkNeverSealed(projectId, s, link);
  return true;
}
/** kosmos#7028: after Kosmos+ says a room was never sealed, how long the own computer waits for the owner's offer
    before clearing; and the least time between two asks for one room. */
const OWNER_OFFER_WAIT_MS = 10 * 1000;
/** kosmos#7028: anyone in the room can send a sealed-looking frame, and noteOwnSealed then holds this computer's posts
    for a key that will never come. The owner board seals a room only for a hello matched to an active edge for its
    project, and the account's edges are listed with every status (revoked ones too), so a fresh answer with no edge
    for this project says the room was never sealed. Asked fresh (notBeforeMono): an answer from before the frame can
    miss an edge made since.
    That answer is not enough alone: an edge goes when its guest deletes their account, so a room sealed for that
    guest reads the same. The owner's offer settles it. Only this account's computers can send a key-own offer (the
    relay stamps same_account, onKeyFrame refuses any other), and the owner board sends one only for a sealed room
    it holds, so once one arrives the room is never cleared (s.ownerOffered). Without one, the record is cleared only
    after OWNER_OFFER_WAIT_MS more with none, so an owner board that is online answers the hello first. An owner that
    is offline then leaves the room cleared until its next sealed frame, which records the seal again: recording is the
    safe side, so every sealed-looking frame records it, and only the asking is limited (one per room per
    OWNER_OFFER_WAIT_MS; a frame inside that is checked once the window ends). Any other answer (failed, unreadable,
    an edge of any status) keeps the record. */
function checkNeverSealed(projectId, s, link) {
  if (!deps || typeof deps.macRequest !== 'function' || s.ownerOffered) return;
  const now = Date.now();
  if (Number.isFinite(s.neverSealedAskedAt) && now >= s.neverSealedAskedAt && now - s.neverSealedAskedAt < OWNER_OFFER_WAIT_MS) {
    if (!s.neverSealedTimer) {
      s.neverSealedTimer = setTimeout(() => {
        s.neverSealedTimer = null;
        if (seats.get(projectId) === s && !s.stopped) checkNeverSealed(projectId, s, link);
      }, OWNER_OFFER_WAIT_MS - (now - s.neverSealedAskedAt));
      if (s.neverSealedTimer.unref) s.neverSealedTimer.unref();
    }
    return;
  }
  s.neverSealedAskedAt = now;
  let ask;
  try { ask = sharedEdges(now, mono()); } catch { return; }
  ask.promise.then((r) => {
    if (!r || !r.ok || !r.data || !Array.isArray(r.data.as_owner)) return;
    if (r.data.as_owner.some((e) => e && e.project_ref === link.ref)) return;
    const t = setTimeout(() => { forgetOwnSealed(projectId, s); }, OWNER_OFFER_WAIT_MS);
    if (t.unref) t.unref();
  }).catch(() => {});
}
/** kosmos#7028: clear an own computer's keyless sealed record (noteOwnSealed's), under the room's sealing step, unless
    the owner's offer has arrived. It holds no key and changes no epoch, so it is no rotation (#5191 WRITERS). Only
    that record: one holding a key is kept. New posts then go as in any unsealed room; one held meanwhile was written
    for a sealed room, so it is told and not sent in the clear (sendPost's sealedHeld rule). */
function forgetOwnSealed(projectId, s) {
  return sealStep(projectId, () => {
    if (seats.get(projectId) !== s || s.stopped || s.ownerOffered) return;
    const link = safeLink(projectId);
    const st = roomSeal(projectId);
    if (!link || link.role !== 'self' || !st || st.role !== 'member' || st.ownComputer !== true || hasKey(st)) return;
    try { fedseal.forgetRoom(projectId); } catch { return; }
    s.ownRun = null;
    flushHeld(projectId, s);
  });
}
/** Own computer: the owner's offer for this run's commitment. nW is revealed to ONE offer only. The same offer
    again (the owner answering a repeated hello) gets the same reveal again, in case the first was lost. A
    different offer after the reveal (the owner's board restarted, or someone else answering) ends an unconfirmed
    run and starts a new one with a new nonce, never a second reveal of this one. */
function waitingOffer(projectId, s, frame) {
  const run = s.ownRun;
  const st = roomSeal(projectId);
  if (!run || run.room !== s.room || !st || st.ownComputer !== true || hasKey(st)) return;
  let me;
  try { me = fedseal.sealingKey(); } catch { return; }
  const offer = fedseal.checkOwnOffer(frame, run.mac, run.commit, me.pub);
  if (!offer) return;
  s.ownerOffered = true;   // kosmos#7028: the owner holds this room sealed, so it is never cleared as forged
  if (run.offer && (run.offer.ownerPub !== offer.ownerPub || run.offer.nO !== offer.nO)) {
    // Confirmed or not: a run still waiting for its share ends (the owner's board may have restarted and lost it),
    // and the new run's code needs a new confirm. A run holding a genuine share keeps it.
    if (run.got) return;
    if (!underRunLimit(s, 'ownResets')) {
      noteOnce(projectId, s, 'ownRunsPaused', 'The code on this screen has had to start over too many times this hour, so it stays as it is for now. If it does not match the other computer, press "Does not match" to start again.');
      return;
    }
    if (run.confirmed) say(projectId, 'The other computer started over, so the code on this screen changed. Compare the new code with the one on the other computer, and confirm again.');
    s.ownRun = null;
    sayOwnHello(projectId, s);
    return;
  }
  run.offer = offer;
  try { sendFrame(s, fedseal.ownRevealFrame(run.mac, offer.ownerPub, run.nW, me.pub)); } catch { /* sent again when the offer repeats */ }
}
/** Own computer: the code this computer shows for its current run, or null. */
function ownCode(projectId) {
  const s = seats.get(projectId);
  const run = s && s.ownRun;
  if (!run || !run.offer) return null;
  let me;
  try { me = fedseal.sealingKey(); } catch { return null; }
  return fedseal.compareCode(run.room, run.mac, me.pub, run.offer.ownerPub, run.nW, run.offer.nO);
}
/** Own computer: its person says the two codes match. Resolves { ok, because }. */
function confirmOwn(projectId, confirmedCode) {
  return sealStep(projectId, async () => {
    const s = seats.get(projectId);
    const code = ownCode(projectId);
    if (!s || !code) return { ok: false, because: 'this computer is not waiting for a code right now' };
    if (!fedseal.sameCompareCode(confirmedCode, code)) return { ok: false, because: 'that is not the code this computer shows' };
    s.ownRun.confirmed = true;
    adoptOwnShare(projectId, s);
    return { ok: true, because: null };
  }).then((r) => r || { ok: false, because: 'the room\'s records could not be read' });
}
/** Own computer: the person said the codes do not match. The run ends and a new one starts with a new code. */
function ownStartOver(projectId) {
  const s = seats.get(projectId);
  if (!s || !s.ownRun) return false;
  s.ownRun = null;
  sayOwnHello(projectId, s);
  return true;
}
/** Own computer: a share is opened as it arrives (it is sealed to this computer) and only one that opens, from the
    offer's owner key for this run, is kept: a forged share cannot displace a genuine one. */
function waitingShare(projectId, s, frame) {
  const run = s.ownRun;
  if (!run || !run.offer || run.got) return;
  let me;
  try { me = fedseal.sealingKey(); } catch { return; }
  const got = fedseal.openOwnShare(me, run.mac, run.offer.ownerPub, run.nW, run.offer.nO, frame, run.room);
  if (!got) return;
  run.got = got;
  adoptOwnShare(projectId, s);
}
/** Own computer: take the key once BOTH hold: the person confirmed, and a genuine share arrived. Either can come
    first. */
function adoptOwnShare(projectId, s) {
  const run = s.ownRun;
  const st = roomSeal(projectId);
  if (!run || !run.confirmed || !run.got || !st || st.ownComputer !== true || hasKey(st)) return;
  const got = run.got;
  fedseal.setRoomState(projectId, Object.assign({}, st, { peer: got.ownerPub, epoch: got.epoch, keys: { [got.epoch]: got.roomKey } }));
  s.ownRun = null;
  // A rotation that came between the Allow and this confirm (a guest removed meanwhile) is applied BEFORE the held
  // posts go, so none of them is sent under a key the removed guest still holds.
  const rot = run.rotates || {};
  // Every kept rotation goes into the record first, and the held posts go once, under the newest key: a flush after
  // each would send them under a middle key that a guest removed at a later rotation still holds.
  for (const ep of Object.keys(rot).map(Number).sort((a, b) => a - b)) onKeyFrame(projectId, s, rot[ep], true, true);
  say(projectId, SEALED_LINE);
  flushHeld(projectId, s);
}
const OWN_WAITING_MAX = 16;
/* A run a man in the middle abandons costs it nothing, so the number of runs bounds its guesses at the code: the
   seal owner starts at most this many new runs (fresh commitments) in a room an hour, and a waiting computer restarts
   its own run without its person at most this many times an hour. Past it, new commitments and different offers are
   ignored until the hour has room again. */
const OWN_RUNS_PER_HOUR = 12;
/** Count one run against the seat's hourly limit for `key`. False (nothing counted) when the limit is reached. */
function underRunLimit(s, key, now = Date.now()) {
  const kept = (s[key] || []).filter((t) => now - t < 60 * 60 * 1000);
  if (kept.length >= OWN_RUNS_PER_HOUR) { s[key] = kept; return false; }
  s[key] = kept.concat([now]);
  return true;
}
/** Seal owner: a hello from one of this account's computers. Answered with an offer (a fresh nonce for each new
    commitment, the same offer again for a hello repeated on reconnect). A computer already pinned that says hello
    lost its key, or came back under a new id: it runs the whole exchange again, Allow included. */
function ownerOwnHello(projectId, s, frame, me) {
  const st = roomSeal(projectId);
  const h = fedseal.checkOwnHello(frame);
  if (!h || !hasKey(st) || st.role !== 'owner') return;
  if (st.peers && Object.prototype.hasOwnProperty.call(st.peers, h.pub)) return;   // a guest's key is never an own computer
  if (h.pub === me.pub) return;   // nor this board's own key
  if (!s.ownWaiting) s.ownWaiting = new Map();
  let w = s.ownWaiting.get(h.pub);
  if (!w || w.commit !== h.commit || w.mac !== h.mac) {
    if (!underRunLimit(s, 'ownOffers')) return;
    w = { mac: h.mac, commit: h.commit, nO: fedseal.randomSecret(), nW: null, at: Date.now() };
    s.ownWaiting.delete(h.pub);
    s.ownWaiting.set(h.pub, w);
    while (s.ownWaiting.size > OWN_WAITING_MAX) s.ownWaiting.delete(s.ownWaiting.keys().next().value);
  }
  try { sendFrame(s, fedseal.ownOfferFrame(me, h, w.nO)); } catch { /* the next hello */ }
}
/** Seal owner: the waiting computer's reveal opens its commitment, so its code can be shown. */
function ownerOwnReveal(projectId, s, frame, me) {
  if (!s.ownWaiting || !frame || typeof frame.pub !== 'string') return;
  const w = s.ownWaiting.get(frame.pub);   // the reveal names its computer's key, so a copied commitment cannot take it
  if (!w || w.nW) return;
  const nW = fedseal.checkOwnReveal(frame, w.mac, me.pub, w.commit, frame.pub);
  if (nW) w.nW = nW;
}
/** Seal owner: the computers waiting for this room's key whose code can be shown, newest last. Empty when this
    board does not hold the room's seal-owner state. */
function ownWaiting(projectId) {
  const s = seats.get(projectId);
  const st = roomSeal(projectId);
  if (!s || !s.room || !s.ownWaiting || !hasKey(st) || st.role !== 'owner') return [];
  let me;
  try { me = fedseal.sealingKey(); } catch { return []; }
  return [...s.ownWaiting].filter(([, w]) => w.nW).map(([pub, w]) => ({ pub, mac: w.mac, at: w.at, code: fedseal.compareCode(s.room, w.mac, pub, me.pub, w.nW, w.nO) }));
}
/** kosmos#7028, seal owner: the own computers that hold this room's key, oldest first. Empty when this board
    does not hold the room's seal-owner state. */
function ownAllowed(projectId) {
  const st = roomSeal(projectId);
  if (!hasKey(st) || st.role !== 'owner' || !st.own || typeof st.own !== 'object') return [];
  return Object.keys(st.own).filter((pub) => st.own[pub] && typeof st.own[pub].mac === 'string')
    .map((pub) => ({ pub, mac: st.own[pub].mac, at: st.own[pub].at }))
    .sort((x, y) => (Number(x.at) || 0) - (Number(y.at) || 0));
}
/** kosmos#7028, seal owner: a person removed one of their computers from a sealed room. The room moves to a new
    key that computer is not sent (revokeCheck, the step a revoked guest gets). Resolves { ok, because }. */
async function ownRemove(projectId, pub) {
  const st = roomSeal(projectId);
  if (!hasKey(st) || st.role !== 'owner') return { ok: false, because: 'only the computer that first shared this room can take another computer out of it' };
  if (!st.own || !Object.prototype.hasOwnProperty.call(st.own, pub)) return { ok: false, because: 'that computer does not hold this room\'s key' };
  const link = safeLink(projectId);
  if (!link) return { ok: false, because: 'this project is not shared' };
  let r;
  try { r = await revokeCheck(projectId, link, undefined, [pub]); } catch { r = undefined; }
  const after = roomSeal(projectId);
  if (after && after.own && Object.prototype.hasOwnProperty.call(after.own, pub)) return { ok: false, because: r && r.unreadable ? 'the room\'s records could not be written' : 'the room\'s key could not be changed right now; try again' };
  return { ok: true, because: null };
}
/** Seal owner: a person compared the codes and pressed Allow. Resolves { ok, because }. */
function allowOwn(projectId, pub, confirmedCode) {
  return sealStep(projectId, async () => {
    const s = seats.get(projectId);
    const w = s && s.ownWaiting ? s.ownWaiting.get(pub) : null;
    if (!s || !s.room || !w || !w.nW) return { ok: false, because: 'that computer is no longer waiting for this room\'s key' };
    const st = roomSeal(projectId);
    if (!hasKey(st) || st.role !== 'owner') return { ok: false, because: 'only the computer that first shared this room can let another computer read it' };
    if (st.peers && Object.prototype.hasOwnProperty.call(st.peers, pub)) return { ok: false, because: 'that key belongs to someone you invited, not to one of your computers' };
    let me;
    try { me = fedseal.sealingKey(); } catch { return { ok: false, because: 'this computer could not use its sealing key' }; }
    if (pub === me.pub) return { ok: false, because: 'that is this computer\'s own key' };
    let frame;
    try { frame = fedseal.ownShareFrame(me, { mac: w.mac, pub, nW: w.nW, nO: w.nO }, confirmedCode, st.keys[st.epoch], st.epoch, s.room); } catch (err) {
      return { ok: false, because: String((err && err.message) || err) };
    }
    if (!sendFrame(s, frame)) return { ok: false, because: 'the key could not be sent to the room right now, so nothing changed; try again' };
    fedseal.setRoomState(projectId, Object.assign({}, st, { own: Object.assign({}, st.own || {}, { [pub]: { mac: w.mac, at: Date.now() } }) }));
    s.ownWaiting.delete(pub);
    return { ok: true, because: null };
  }).then((r) => r || { ok: false, because: 'the room\'s records could not be written' });
}
/** Owner: a pinned member whose edge the coordinator reports as not active has been
    revoked. The room moves to a new key only the remaining members get, so the revoked
    member cannot read anything posted after (it keeps what it read). The edge was
    bound at pin time from the coordinator's own list (the invite the member redeemed),
    never from anything the member said. */
function rotateForRevoked(projectId, link, edges) {
  return revokeCheck(projectId, link, edges).then((r) => !!(r && r.rotated));
}
/** rotateForRevoked's step, also saying whether the edges were checked at all:
    { checked, rotated, unreadable? } (unreadable: the rooms record could not be read), or
    undefined when the step threw. A room with no pinned member
    has nothing to revoke, so it counts as checked without asking. */
function revokeCheck(projectId, link, edges, dropOwn) {
  const drop = Array.isArray(dropOwn) ? dropOwn.filter((p) => typeof p === 'string' && p) : [];
  return sealStep(projectId, async () => {
    const first = roomSeal(projectId);
    // A record that cannot be read is not a check (nothing could have been rotated).
    if (first === undefined) return { checked: false, rotated: false, unreadable: true };
    // A rotation time ahead of the clock (it was fast, then corrected) would reopen the old
    // key later: closed now instead.
    if (hasKey(first) && first.role === 'owner' && Number.isFinite(first.rotatedAt) && first.rotatedAt > Date.now()) {
      try { fedseal.setRoomState(projectId, Object.assign({}, first, { rotatedAt: Date.now() - REVOKE_GRACE_MS })); } catch { /* next check */ }
    }
    const hasPeers = !!Object.keys(first.peers || {}).length;
    const hasOwn = !!Object.keys(first.own || {}).length;
    if (!hasKey(first) || first.role !== 'owner' || (!hasPeers && !hasOwn)) return { checked: true, rotated: false };
    // kosmos#7028: the account's computers are asked only when an own computer is pinned, and their
    // answer never decides whether the room counts as checked: a failed one would otherwise hold
    // every guest's post for it. A failed or incomplete answer drops no own computer.
    const macsAsk = hasOwn ? sharedComputers(Date.now()).promise.catch(() => null) : Promise.resolve(null);
    let r = null;
    if (hasPeers) {
      try { r = await (edges ? edges() : deps.macRequest('POST', MAC_EDGES, {})); } catch { r = null; }
      if (!r || !r.ok || !r.data || !Array.isArray(r.data.as_owner)) r = null;
    }
    // An own computer the screen removes goes even when the edges could not be read; the room is then
    // still not checked for its guests.
    const checked = !hasPeers || !!r;
    if (!checked && !drop.length && !hasOwn) return { checked: false, rotated: false };
    const onAccount = accountMacs(await macsAsk);
    const status = new Map(r ? r.data.as_owner.filter((e) => e && e.project_ref === link.ref).map((e) => [e.id, e.status]) : []);
    const st = roomSeal(projectId);   // re-read: a hello may have pinned someone during the await
    if (st === undefined) return { checked: false, rotated: false, unreadable: true };
    if (!hasKey(st) || st.role !== 'owner') return { checked: true, rotated: false };
    const peers = st.peers || {};
    const own = st.own || {};
    // Only an edge the coordinator names as no longer active counts; an edge it does not
    // list is not taken as revoked (a partial answer must not lock a member out).
    const gone = Object.keys(peers).filter((pub) => peers[pub] && status.has(peers[pub].edge) && status.get(peers[pub].edge) !== 'active');
    // kosmos#7028: an own computer leaves the key when the screen removes it, or when a complete list of
    // the account's computers no longer has its mac (retired, held, moved to another account).
    const ownGone = Object.keys(own).filter((pub) => drop.includes(pub) || (onAccount && !(own[pub] && onAccount.has(own[pub].mac))));
    if (!gone.length && !ownGone.length) return { checked, rotated: false };
    const epoch = st.epoch + 1;
    const keep = {};
    for (const pub of Object.keys(peers)) if (!gone.includes(pub)) keep[pub] = peers[pub];
    const ownKeep = {};
    for (const pub of Object.keys(own)) if (!ownGone.includes(pub)) ownKeep[pub] = own[pub];
    const keys = Object.assign({}, st.keys, { [epoch]: fedseal.randomSecret() });
    // #5191: with nobody left, the revoked key is dropped from the record, so a member pinned
    // later (which brings graceAfter back to REVOKE_GRACE_MS) cannot reopen it. kosmos#4658: an allowed own
    // computer is somebody left.
    if (!Object.keys(keep).length && !Object.keys(ownKeep).length) delete keys[st.epoch];
    // #5191: the accounts dropped, each from the peer's own record (pinned with its edge) or, for a
    // peer pinned before that was kept, from this answer by its edge id; recorded at the epoch they
    // held. An account a kept peer also has (one account, two edges) is not recorded.
    const accountOf = new Map((r ? r.data.as_owner : []).filter((e) => e && e.project_ref === link.ref && typeof e.member_account_id === 'string' && e.member_account_id).map((e) => [e.id, e.member_account_id]));
    const accountOfPeer = (p) => (p && typeof p.account === 'string' && p.account) || (p && accountOf.get(p.edge)) || null;
    const keptList = Object.values(keep).map(accountOfPeer);
    const keptAccounts = new Set(keptList.filter(Boolean));
    // A Map, written out with Object.fromEntries, so any account id is an own key of the record.
    const prior = st.revokedAccounts && typeof st.revokedAccounts === 'object' ? st.revokedAccounts : {};
    const revoked = new Map(Object.keys(prior).filter((a) => Number.isInteger(prior[a]) && prior[a] >= 0).map((a) => [a, prior[a]]));
    // A kept peer whose account cannot be named might share a dropped one's: then nothing is recorded,
    // and the grace bounds this revoke as before, rather than refusing that peer's in-flight posts.
    if (!keptList.includes(null)) for (const pub of gone) {
      const account = accountOfPeer(peers[pub]);
      if (account && !keptAccounts.has(account)) revoked.set(account, Math.max(revoked.has(account) ? revoked.get(account) : st.epoch, st.epoch));
    }
    // A revoke found but not saved is not a check: the posts it holds stay held (the pass must
    // not show them unchecked under the key the revoked member still holds).
    try { fedseal.setRoomState(projectId, Object.assign({}, st, { peers: keep, own: ownKeep, epoch, rotatedAt: Date.now(), keys, revokedAccounts: Object.fromEntries(revoked) })); } catch {
      return { checked: false, rotated: false, unreadable: true };
    }
    const s = seats.get(projectId);
    if (s) sendRotates(projectId, s);
    return { checked, rotated: true };
  });
}
/** #5191: one edges answer for the whole Mac, shared by every owner room's post-triggered
    check while it is younger than EDGE_FRESH_MS (the answer lists every project's edges),
    so the number of busy rooms does not set how often this Mac asks Kosmos+. A failed
    answer is shared too, for the same 15 s: an outage must not turn every busy room into
    its own request. Exception (kosmos#5285): an owner room's join check passes notBeforeMono, so it
    never reuses an answer asked before it started; it is bounded per room instead (one per
    JOIN_CHECK_MS, and only while someone's post waits), so in an outage N waiting rooms ask up to
    N times per JOIN_CHECK_MS, each for at most the hour a post is held. */
let macEdges = null;
/** Whether something done at `at` is less than EDGE_FRESH_MS old. A time ahead of the
    clock (the clock stepped back) is not fresh, so the hold cannot be switched off by it. */
function isFresh(at, now) {
  const age = now - (Number.isFinite(at) ? at : 0);
  return age >= 0 && age < EDGE_FRESH_MS;
}
/** #5193: end a member's seat whose edge the owner revoked, at once, as the connector's own
    refusal (code 3) would about two minutes later: the room is told once, the link keeps the
    ending across a restart, and held posts go with it (setStatus 'ended'). #5404: `revokedAtSec` is the
    coordinator's revoked_at; noteSentAfterRevoke uses it to name the posts sent after the revoke. */
function endRevokedMember(projectId, s, link, revokedAtSec) {
  if (!s || s.stopped || s.status === 'ended') return;
  // An ending already told keeps its own words on the link, so the room and the record agree (round 3).
  if (!s.endedNoted) {
    s.endedNoted = true;
    s.ended = 'the owner removed this computer from the project';
    say(projectId, REVOKED_NOTE);
  }
  noteSentAfterRevoke(projectId, s, revokedAtSec);
  try { federation.recordLink(projectId, Object.assign({}, link, { ended: s.ended || 'the connection ended' })); } catch { /* ends again at its next ticket ask */ }
  setStatus(projectId, 'ended');
  s.stopped = true;   // the child's close then neither restarts it nor tells the room again, and
                      // handleEvent ignores lines still in its pipe
  if (s.timer) { clearTimeout(s.timer); s.timer = null; }
  if (s.child) letGo(s.child);
}
/** #5193: a member reads its own edge in the edges answer (the coordinator lists a revoked edge
    with status 'revoked'). Only an edge listed as revoked ends the seat: a missing one or a
    failed answer changes nothing (a partial answer must not lock a member out). */
async function memberEdgeCheck(projectId, ask, seat) {
  let r;
  try { r = await ask; } catch { return; }
  const s = seats.get(projectId);
  if (!s || (seat && s !== seat)) return;
  const link = safeLink(projectId);
  if (!link || link.role !== 'member' || !link.edge_id) return;
  if (!r || !r.ok || !r.data || !Array.isArray(r.data.as_member)) return;
  const e = r.data.as_member.find((x) => x && x.id === link.edge_id);
  if (e && e.status === 'revoked') endRevokedMember(projectId, s, link, e.revoked_at);
}
/** kosmos#7028: the mac ids in an account-computers answer, or null when the answer is not complete:
    not ok, no list, a row without a mac id (a coordinator too old to name them), or no row for this
    computer (every real answer has one). Null drops nothing. */
function accountMacs(r) {
  if (!r || !r.ok || !r.data || !Array.isArray(r.data.computers) || !r.data.computers.length) return null;
  const rows = r.data.computers;
  if (!rows.every((c) => c && typeof c.mac_id === 'string' && c.mac_id)) return null;
  if (!rows.some((c) => c.this === true)) return null;
  return new Set(rows.map((c) => c.mac_id));
}
/** kosmos#7028: one account-computers answer for the whole Mac per EDGE_FRESH_MS, as sharedEdges. */
let macComputers = null;
function sharedComputers(now) {
  if (macComputers && isFresh(macComputers.askedAt, now)) return macComputers;
  const ask = { askedAt: now, promise: null };
  try { ask.promise = Promise.resolve(deps.macRequest('POST', MAC_COMPUTERS, {})); } catch (err) { ask.promise = Promise.reject(err); }
  ask.promise.catch(() => {});
  macComputers = ask;
  return ask;
}
function sharedEdges(now, notBeforeMono) {
  // #5285: `notBeforeMono` refuses a cached answer asked before then (it cannot know of a later join).
  if (macEdges && isFresh(macEdges.askedAt, now) && (notBeforeMono === undefined || macEdges.mono > notBeforeMono)) return macEdges;
  const ask = { askedAt: now, mono: mono(), promise: null };
  try { ask.promise = Promise.resolve(deps.macRequest('POST', MAC_EDGES, {})); } catch (err) { ask.promise = Promise.reject(err); }
  ask.promise.catch(() => {});   // each caller sees the failure as "not checked"
  macEdges = ask;
  return ask;
}
/** #5191: check an owner room's edges, then let the posts held for that check through,
    opened under the keys the check leaves. When the check could not be made they stay
    held, except on the 60 s pass (`pass`), which shows them unchecked. `askedAt()` is when
    the answer used was asked for; the room counts as checked from then, not from when the
    answer arrived. */
async function checkRoom(projectId, link, edges, pass, askedAt, seat, askedMono) {
  const started = Date.now();
  const startedMono = mono();
  const r = await revokeCheck(projectId, link, edges);
  const s = seats.get(projectId);
  // A seat replaced while the check was out (an id reused) is not credited with it.
  if (!s || (seat && s !== seat)) return r;
  if (r && r.checked) {
    const at = typeof askedAt === 'function' ? askedAt() : 0;
    s.edgesCheckedAt = at > 0 ? Math.min(at, started) : started;
    // #5191: the same moment on the monotonic clock when the caller knows it (a remove compares on it).
    // Set on every check, undefined included, so an older check's value never outlives this one. A lower
    // bound: the request itself may go out later, behind the room's sealing step.
    const am = typeof askedMono === 'function' ? askedMono() : undefined;
    s.edgesCheckedMono = typeof am === 'bigint' ? am : (at > 0 ? undefined : startedMono);
  }
  // The pass shows them unchecked, but not while the rooms record is unreadable: then every
  // one would be refused for that, so they wait for a pass that can read it.
  // r undefined: the step threw, nothing is known, and nothing is released.
  if (s.held && s.held.length && ((r && r.checked) || (pass && r && !r.unreadable))) {
    // A checked answer covers only posts that arrived within EDGE_FRESH_MS of when it was
    // asked for: a later one (the answer was old by the time this step ran, behind a slow
    // sealing step) stays held for its own check or the next pass. The unchecked pass
    // release (Kosmos+ cannot answer) shows them all, as before.
    let coversUntil = r && r.checked ? s.edgesCheckedAt + EDGE_FRESH_MS : Infinity;
    // An answer asked before this screen removed someone covers only posts that arrived before it.
    // Posts that arrived after the remove, judged on the monotonic clock where the post has it.
    const capped = !!(r && r.checked && checkedBeforeRemove(s));
    const after = (h) => (typeof h.mono === 'bigint' ? h.mono > s.removedMono : h.at >= s.removedAt);
    const keep = (h) => h.at > coversUntil || (capped && after(h));
    const held = s.held.filter((h) => !keep(h));
    s.held = s.held.filter(keep);
    s.heldIds = new Set(s.held.map((h) => h.id));
    for (const { line, at } of held) {
      try { handleEvent(projectId, line, at); } catch (err) {
        console.error('#5191: a held post for ' + JSON.stringify(projectId) + ' could not be handled: ' + String((err && err.message) || err));
      }
    }
  }
  return r;
}
/** #5191: whether this room's last check was asked before this screen last removed someone. On the
    monotonic clock when the check's moment is known there, since a remove and its own check share a
    millisecond; otherwise by wall time, counting the same millisecond as before (the safe side). */
function checkedBeforeRemove(s) {
  if (typeof s.removedMono !== 'bigint') return false;
  if (typeof s.edgesCheckedMono === 'bigint') return s.edgesCheckedMono <= s.removedMono;
  return s.edgesCheckedAt <= s.removedAt;
}
/** #5191: hold a sealed post to an owner whose edges were not checked in the last
    EDGE_FRESH_MS, and ask (once per room per EDGE_FRESH_MS). True when the post was taken.
    A post is held only if it would be shown now: it opens, is inside the time window and
    has not been shown, and is not already held (by its sealed id). Anything else goes
    straight to the usual refusal and takes no place. Held posts live in this seat's
    memory: a board restart while they wait loses them. */
function holdForCheck(projectId, s, sealed, env, line, now) {
  if (!Object.keys(sealed.peers || {}).length) return false;   // nobody pinned: no revoke to wait for
  if (isFresh(s.edgesCheckedAt, now) && !checkedBeforeRemove(s)) return false;
  const opened = s.room ? fedseal.open(acceptedKeys(sealed, now), s.room, env) : null;
  if (!opened || now - opened.at > REPLAY_WINDOW_MS || opened.at - now > FUTURE_SKEW_MS || (s.seen && s.seen.has(opened.id))) return false;
  // An unreadable link record still holds the post (failing open would show a revoked
  // member's post with no bound), but no check can start: the first pass that can read the
  // record checks and releases it. A link that reads as no owner link takes the usual path.
  const link = sealLink(projectId);
  if (link !== undefined && (!link || link.role !== 'owner')) return false;
  s.held = s.held || [];
  s.heldIds = s.heldIds || new Set();
  if (s.heldIds.has(opened.id)) return true;   // a copy of a held post: it would be refused as seen
  if (s.held.length >= HELD_MAX) {
    const day = new Date(now).toISOString().slice(0, 10);
    // One note a day between this and the minute budget's: they say the same thing.
    if (s.heldNotedOn !== day && !(s.inday && s.inday.day === day && s.inday.minuteNoted)) {
      s.heldNotedOn = day;
      say(projectId, farSide(projectId, true) + ' sent more messages than Kosmos keeps in a minute; some were not kept. Kosmos says this once a day.');
    }
    return true;
  }
  s.heldIds.add(opened.id);
  s.held.push({ line, at: now, mono: mono(), id: opened.id });
  if (link && !s.edgeAsk && !isFresh(s.edgeAskedAt, now)) {
    const ask = sharedEdges(now, s.removedMono);
    // The answer's own ask time: one joined from another room may be older than this post.
    s.edgeAskedAt = ask.askedAt;
    s.edgeAsk = checkRoom(projectId, link, () => ask.promise, false, () => ask.askedAt, s, () => ask.mono).catch(() => {}).then(() => { s.edgeAsk = null; });
  }
  return true;
}
/** Owner: a member's hello. A pinned member is answered again from its own invite. A
    new one is pinned only when its hello checks against an invite this board made AND
    the coordinator lists an active edge redeemed from that invite; that edge (not one
    the member names) is what a later revoke is matched on. One key per invite. */
async function ownerHello(projectId, s, link, frame, me) {
  let st = roomSeal(projectId);
  if (st === undefined) return;
  const pinned = (st && st.peers) || {};
  if (typeof frame.pub === 'string' && Object.prototype.hasOwnProperty.call(pinned, frame.pub)) {
    const p = pinned[frame.pub];
    if (!hasKey(st) || !fedseal.checkHello(p.s, p.code, frame, s.room)) return;
    sendFrame(s, fedseal.shareFrame(p.s, p.code, me, frame.pub, st.keys[st.epoch], st.epoch, s.room));
    return;
  }
  const inv = fedseal.pendingInvites(link.ref).find((c) => fedseal.checkHello(c.s, c.code, frame, s.room));
  if (!inv || Object.values(pinned).some((p) => p && p.invite === inv.invite)) return;
  let r;
  try { r = await deps.macRequest('POST', MAC_EDGES, {}); } catch { return; }
  if (!r || !r.ok || !r.data || !Array.isArray(r.data.as_owner)) return;
  const edge = r.data.as_owner.find((e) => e && e.project_ref === link.ref && e.invite_id === inv.invite && e.status === 'active');
  if (!edge) return;
  st = roomSeal(projectId);   // re-read after the await
  if (st === undefined) return;
  const peers = (st && st.peers) || {};
  if (Object.prototype.hasOwnProperty.call(peers, frame.pub) || Object.values(peers).some((p) => p && p.invite === inv.invite)) return;
  const firstKey = !hasKey(st);
  if (firstKey) st = { role: 'owner', peers: {}, epoch: 0, keys: { 0: fedseal.randomSecret() } };
  // #5191: the account too, so a later rotation names it without needing the revoke's answer to.
  const pin = Object.assign({ s: inv.s, code: inv.code, invite: inv.invite, edge: edge.id }, typeof edge.member_account_id === 'string' && edge.member_account_id ? { account: edge.member_account_id } : {});
  st = Object.assign({}, st, { peers: Object.assign({}, peers, { [frame.pub]: pin }) });
  fedseal.setRoomState(projectId, st);
  fedseal.spendInvite(link.ref, inv.s);
  sendFrame(s, fedseal.shareFrame(inv.s, inv.code, me, frame.pub, st.keys[st.epoch], st.epoch, s.room));
  // #4649 slice 1b: the owner's room says who joined, by the owner's own label for that invite.
  try { say(projectId, require('./fedmembers').joinedLine(projectId, inv.invite)); } catch { /* the line is furniture */ }
  // #4649 slice 3: and remembers which account that is, so its posts can carry the owner's label.
  try { require('./fedmembers').noteMember(projectId, inv.invite, edge.member_account_id); } catch { /* the label is furniture */ }
  if (firstKey) say(projectId, SEALED_LINE);   // #5195: the owner's side too, once, when the room first has its key
  flushHeld(projectId, s);
}
function onKeyFrame(projectId, s, frame, sameAccount, noFlush) {
  const link = safeLink(projectId);
  if (!link || !s.room) return;
  let me;
  try { me = fedseal.sealingKey(); } catch { return; }
  if (frame.t === 'key-hello' && link.role === 'owner') { sealStep(projectId, () => ownerHello(projectId, s, link, frame, me)); return; }
  if (frame.t.startsWith('key-own-') && !sameAccount) return;   // #4658: only this account's own computers take part
  if (frame.t === 'key-own-hello' && link.role === 'owner') { sealStep(projectId, () => ownerOwnHello(projectId, s, frame, me)); return; }
  if (frame.t === 'key-own-reveal' && link.role === 'owner') { sealStep(projectId, () => ownerOwnReveal(projectId, s, frame, me)); return; }
  if (frame.t === 'key-own-offer' && link.role === 'self') { sealStep(projectId, () => waitingOffer(projectId, s, frame)); return; }
  if (frame.t === 'key-own-share' && link.role === 'self') { sealStep(projectId, () => waitingShare(projectId, s, frame)); return; }
  try {
    if (frame.t === 'key-share' && link.role === 'member') {
      const st = roomSeal(projectId);
      if (!st || st.role !== 'member' || hasKey(st)) return;
      const got = fedseal.openShare(st.s, st.code, me, frame, s.room);
      if (!got) return;   // another member's share, or not genuine
      fedseal.setRoomState(projectId, Object.assign({}, st, { peer: got.ownerPub, epoch: got.epoch, keys: { [got.epoch]: got.roomKey } }));
      say(projectId, SEALED_LINE);
      flushHeld(projectId, s);
      return;
    }
    if (frame.t === 'key-rotate' && (link.role === 'member' || link.role === 'self')) {
      const st = roomSeal(projectId);
      // #4658: an own computer still waiting to adopt keeps a rotation for adoptOwnShare, but only one that opens
      // under the owner key of its run's offer (the key adoption pins), one per epoch: a frame from anyone else
      // takes no place.
      if (link.role === 'self' && st && st.ownComputer === true && !hasKey(st) && s.ownRun) {
        const run = s.ownRun;
        const got = run.offer ? fedseal.openRotate(me, run.offer.ownerPub, frame, s.room) : null;
        if (got) {
          const kept = Object.assign({}, run.rotates || {}, { [got.epoch]: frame });
          // The newest 8 epochs: a run's owner key may be a man in the middle's until the person compares.
          run.rotates = Object.fromEntries(Object.keys(kept).map(Number).sort((a, b) => a - b).slice(-8).map((e) => [e, kept[e]]));
        }
        return;
      }
      if (!hasKey(st) || !st.peer) return;
      const got = fedseal.openRotate(me, st.peer, frame, s.room);
      if (!got || Object.prototype.hasOwnProperty.call(st.keys, got.epoch) || got.epoch <= st.epoch) return;
      const keys = Object.assign({}, st.keys, { [got.epoch]: got.roomKey });
      // The grace runs from the owner's rotation (sealed in the frame), so a member catching
      // up late does not reopen the old key. A time ahead of this clock counts as now, so on
      // a member whose clock runs behind the owner's it runs from receipt (fedseal.js NOT
      // CLAIMED).
      fedseal.setRoomState(projectId, Object.assign({}, st, { keys, epoch: got.epoch, rotatedAt: Math.min(got.rotatedAt, Date.now()) }));
      if (!noFlush) flushHeld(projectId, s);
    }
  } catch (err) {
    // A record that cannot be written: the handshake is retried on the next connect.
    console.error('#3728: a sealing step for ' + JSON.stringify(projectId) + ' did not finish: ' + String((err && err.message) || err));
  }
}

function safeLink(projectId) {
  try { return linkFor(projectId); } catch { return null; }
}

/** Make sure a linked project has a live seat. Safe to call repeatedly and
    concurrently: `starting` is set before the edge lookup's await, so two
    overlapping calls cannot both spawn a seat. */
async function ensure(projectId, edges) {
  if (!deps) return null;
  const link = federation.linkFor(projectId);
  // No link, no seat: one still running would carry another project's room.
  if (!link) { if (seats.has(projectId)) stop(projectId); return null; }
  /* #3851: checked before anything else, enrolled or not, so a stale link is
     dropped on sight. A link from before the stamp is stamped on first sight
     (weakest point: a reuse that happened before this shipped is stamped as if
     it were the original). */
  const stamp = stampOf(projectId, link);
  if (stamp.state === 'stale') {
    stop(projectId);
    try { federation.forgetLink(projectId); } catch { /* retried on the next check */ }
    console.error('#3851: a shared-project link was left from an earlier project with the id ' + JSON.stringify(projectId) + '; it is dropped, and the project here stays local');
    return null;
  }
  if (stamp.state === 'unstamped') {
    try { federation.recordLink(projectId, Object.assign({}, link, { project_created: stamp.born })); } catch { /* stamped on the next check */ }
  }
  /* kosmos#4318: federation calls gate on enrollment plus the per-project link,
     independent of Remote access (remote.read().on). An enrolled board with
     Remote access turned off continues seating linked shared projects. */
  if (typeof deps.enrolled === 'function' && !deps.enrolled()) return null;
  if (typeof deps.projectExists === 'function' && !deps.projectExists(projectId)) {
    stop(projectId);
    try { federation.forgetLink(projectId); } catch { /* retried on the next check */ }
    return null;
  }
  /* #5671: and only once the board has stated live execution (server.js's real-start path). Enrollment already keeps a
     test's sandbox out (it has none); this is the same stated opt-in the board's other outward sweeps wait for, so a
     test that fakes an enrollment still reaches no room. After every local check above (review 1), before the seat. */
  if (typeof deps.allowed === 'function' && !deps.allowed()) return null;
  /* kosmos#6239: a policy that stops outside contact keeps every shared room closed: a running seat is let go and none
     is started. The link stays, so the room comes back on the first pass after the policy allows it again. */
  if (contactStopped()) { stop(projectId); return null; }
  let s = seats.get(projectId);
  if (link.ended) {
    if (!s) { s = { child: null, edge: null, status: null, backoff: RESTART_START_MS, timer: null, ended: link.ended, stopped: false, starting: false }; seats.set(projectId, s); }
    if (s.status !== 'ended') setStatus(projectId, 'ended');
    return 'ended';
  }
  if (!s) { s = { child: null, edge: null, status: null, backoff: RESTART_START_MS, timer: null, ended: null, stopped: false, starting: false }; seats.set(projectId, s); }
  if (s.child || s.starting || s.timer || s.stopped || s.status === 'ended') return s.status;
  s.starting = true;
  try {
    if (link.role === 'owner' && !s.refused && Array.isArray(link.refused)) s.refused = new Set(link.refused);
    let edge;
    if (link.role === 'member') edge = link.edge_id;
    /* kosmos#4649: another computer of the SAME account (a `self` link) sits in the
       account's own room: `fed-room --own-project`, no edge. */
    else if (link.role === 'self') {
      if (s.ownRefused) { setStatus(projectId, 'waiting'); return 'waiting'; }
      edge = { own: link.ref };
    }
    else {
      const got = await ownerEdge(link, s.refused, edges);
      if (got.failed) {
        // An old connector that does not know the route can never answer it.
        if (/does not sign/.test(got.failed) && !s.oldNoted) {
          s.oldNoted = true;
          say(projectId, 'This computer cannot run the shared project yet: its Kosmos connector is too old. Update Kosmos and it will connect.');
        }
        setStatus(projectId, 'reconnecting');
        return 'reconnecting';
      }
      /* kosmos#4649: an owner the person has shared with their OTHER computers (an own
         code was made: `selfShared`) sits in its own room even with no guest, so those
         computers have it to talk to; the room is the one an edge would open. An owner
         never shared that way keeps waiting for a guest, as before, so a post there
         still says nobody has joined instead of going to an empty room. */
      if (got.none && (!link.selfShared || s.ownRefused)) { setStatus(projectId, 'waiting'); return 'waiting'; }
      edge = got.none ? { own: link.ref } : got.edge;
    }
    if (s.stopped || s.child) return s.status;
    // kosmos#6239 (round 2): the policy may have arrived during the awaits above.
    if (contactStopped()) { stop(projectId); return null; }
    spawnFor(projectId, edge);
    return statusOf(projectId);
  } finally {
    s.starting = false;
  }
}

/* Let a seat go: closing its stdin is how it is told to end. One still running
   STOP_KILL_MS later is sent SIGTERM, and one that ignores that is sent SIGKILL
   STOP_KILL_MS after, so a hung connector is never left running for a project
   that is gone. */
const STOP_KILL_MS = 5000;
function letGo(child, ms = STOP_KILL_MS) {
  try { child.stdin.end(); } catch { /* gone */ }
  let hard = null;
  const t = setTimeout(() => {
    try { child.kill('SIGTERM'); } catch { /* gone */ }
    hard = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, ms);
    if (typeof hard.unref === 'function') hard.unref();
  }, ms);
  if (typeof t.unref === 'function') t.unref();
  child.once('exit', () => { clearTimeout(t); if (hard) clearTimeout(hard); });
}

function stop(projectId) {
  const s = seats.get(projectId);
  if (!s) return;
  // Held posts go with the seat, silently: stop() also runs for an id that now names another
  // project (a stale link, a reused id), where a note would land in the wrong room.
  s.outbox = [];
  s.staleHeld = 0;
  s.stopped = true;
  if (s.timer) clearTimeout(s.timer);
  if (s.joinCheckTimer) clearTimeout(s.joinCheckTimer);   // #5285
  if (s.child) letGo(s.child);
  seats.delete(projectId);
}

/* kosmos#6239: whether the policy set for this Kosmos stops outside contact (orgpolicy.contactAllows). A read that
   throws counts as stopped: a room missed for one pass comes back on the next, a room left open cannot be taken back. */
function contactStopped() { return contactState() !== 'open'; }
/* 'open' | 'policy' | 'unreadable' (round 4: a fault is worded as one, not as the policy). */
function contactState() {
  try { return require('./orgpolicy').contactAllows().ok === true ? 'open' : 'policy'; } catch { return 'unreadable'; }
}
/* kosmos#6870: why outside contact is closed, said after contactState() gave 'policy': the policy's sentence, or the
   family default's (orgpolicy.FAMILY_CONTACT_STOPS) where no policy said off. The state stays 'policy' for both, on
   purpose: readers branch on open | policy | unreadable, and a new value would fall through to their open sentence.
   A second read, worth it only for the family's words; one that throws or now allows gives the policy's sentence
   (review 1: the choice is the `family` flag contactAllows sets, never a comparison of the text). Never throws. */
function contactReason() {
  const op = require('./orgpolicy');
  try {
    const c = op.contactAllows();
    if (c && c.ok !== true && c.family === true && typeof c.because === 'string') return { family: true, text: c.because };
  } catch { /* the policy's sentence */ }
  return { family: false, text: op.CONTACT_STOPS };
}
const contactStops = () => contactReason().text;

/** Try an own room refused earlier this session again, on the person's explicit ask. */
function retryOwn(projectId) {
  const s = seats.get(projectId);
  if (s && s.ownRefused) s.ownRefused = false;
}

/** Seat every linked project (called at boot and after a join or a link). */
async function ensureAll() {
  if (!deps) return;
  /* #5671 review 1: the whole pass waits for live execution, as the company rollup's tick does: its owner-room check
     (checkRoom -> revokeCheck) asks Kosmos+ for edges without going through ensure(). */
  if (typeof deps.allowed === 'function' && !deps.allowed()) return;
  let links;
  try { links = federation.readLinks(); } catch (err) { logUnreadable(err); return; }
  // One edges request per pass, shared by every owner project: the number of
  // linked projects must not set how often this Mac calls Kosmos+.
  let pending = null;
  let pendingAt = 0;
  let pendingMono = 0n;
  const edges = () => pending || (pendingAt = Date.now(), pendingMono = mono(), pending = deps.macRequest('POST', MAC_EDGES, {}));
  // A seat whose link is gone (its project removed some other way) stops.
  for (const id of [...seats.keys()]) if (!Object.prototype.hasOwnProperty.call(links, id)) stop(id);
  for (const id of Object.keys(links)) {
    try {
      let askedHere = false;
      const st = await ensure(id, () => { askedHere = true; return edges(); });
      // #5285: a check that could not ask is settled here, but only by an answer this pass asked for, and only
      // for posts held before it was asked (a later one may have been joined since).
      if (st === 'waiting' && askedHere) dropJoinWait(id, seats.get(id), pendingMono);
    } catch { /* one project's seat never blocks another's */ }
  }
  // #3728: a member still waiting for the room key says hello again (a dropped hello is
  // not a lost room), and a revoked member of a sealed room is rotated out (the same
  // one edges request).
  // An owner re-sends the current epoch to its members on the same pass: the relay does
  // not queue, so a member that was offline at a rotation catches up within a pass of
  // coming back (it already holds a key, so it does not say hello again).
  for (const id of Object.keys(links)) {
    const seat = seats.get(id);
    if (seat && seat.status === 'connected') { try { sayHello(id, seat); sendRotates(id, seat); } catch { /* next pass */ } }
    if (seat) { try { ageHeld(id, seat); } catch { /* next pass */ } }   // connected or not
  }
  for (const id of Object.keys(links)) {
    const link = links[id];
    // #5193: a member checks its own edge on the same one edges request.
    if (link && link.role === 'member' && link.edge_id && !link.ended) {
      const seat = seats.get(id);
      if (seat) { try { await memberEdgeCheck(id, edges(), seat); } catch { /* next pass */ } }
      continue;
    }
    if (!link || link.role !== 'owner') continue;
    try { await checkRoom(id, link, edges, true, () => pendingAt, seats.get(id), () => (pendingMono > 0n ? pendingMono : undefined)); } catch { /* retried on the next pass */ }
  }
  // #5192: the pass flushes after its own revoke check (a connect or a pin flushes at once, as a
  // live post would go at once).
  for (const id of Object.keys(links)) {
    const seat = seats.get(id);
    if (seat && seat.status === 'connected') { try { flushHeld(id, seat); } catch { /* next pass */ } }
  }
}

/* #5192: posts held because the room's key has not arrived (or this member is behind on it)
   are kept, in order, and sent when the key arrives, instead of staying on this computer
   for good. Bounded: at most HELD_POSTS_MAX per seat, and one held longer than
   HELD_POSTS_AGE_MS is not sent (the room says how many). Kept in this seat's memory:
   a board restart loses them, and the room's own copy of each stays where it was.
   Half the receiving board's minute COUNT budget for the room (INBOUND_PER_WINDOW), since a
   flush sends them in one go and other members' posts in that minute share the same budget. */
const HELD_POSTS_MAX = INBOUND_PER_WINDOW / 2;
/* And bytes: a flush sends them in one go, and the receiving board keeps at most
   INBOUND_BYTES_PER_WINDOW a minute for the whole room, so what is held stays well inside
   it. Not a guarantee: other posts in that same minute share the receiver's budget. */
const HELD_POSTS_BYTES = INBOUND_BYTES_PER_WINDOW * 3 / 4;
const heldSize = (m) => Buffer.byteLength(String(m.text || '')) + Buffer.byteLength(String(m.from || ''));
const HELD_POSTS_AGE_MS = 60 * 60 * 1000;

/**
 * Post one local message out to the project's room. Returns true if a live seat
 * took it. Only the words and who said them leave this Mac.
 */
function post(projectId, msg) {
  const m = msg || {};
  // #5193: a member that posts asks whether it is still in the room (the shared answer, so at
  // most one request per EDGE_FRESH_MS for the whole Mac), and a revoke is told within seconds.
  const s = seats.get(projectId);
  const l = s && s.status === 'connected' ? safeLink(projectId) : null;
  if (l && l.role === 'member' && l.edge_id && deps) {
    memberEdgeCheck(projectId, sharedEdges(Date.now()).promise, s).catch(() => {});
  }
  // Only the public fields: the hold's own (invites, sealedHeld...) cannot be set from outside.
  return sendPost(projectId, { from: m.from, kind: m.kind, text: m.text, files: m.files }, 0);
}
/** Whether a post could ever go out: its line, sealed, within the connector's limit. Sealed
    with a throwaway key, so the measure is the real one (the key changes no length; a large
    epoch stands in for any epoch). */
function fitsSealed(payload) {
  try { return Buffer.byteLength(JSON.stringify(fedseal.seal(fedseal.randomSecret(), 999999, 'room', payload))) <= MAX_POST_LINE; } catch { return false; }
}
/** Hold one post until the room's key arrives. `why` finishes "That message is held on
    this computer: ..."; `when` says when it goes. `heldAt`: when a post being flushed was
    first held (its age carries over, so re-holding never resets the hour); 0 for a new one.
    False, as post() returns for a post that did not go now. */
function holdPost(projectId, s, msg, why, when, heldAt) {
  // One that could never go is refused now, as it would be once the key arrived, and takes no place.
  // Measured sealed only when the room is known sealed; otherwise in the clear (an unreadable
  // record may turn out to be an unsealed room), and the exact check is made again at send.
  const plain = { from: clean(msg.from, 80) || 'someone', kind: msg.kind === 'agent' ? 'agent' : 'person', text: String(msg.text || '') };
  if (msg.sealedHeld ? !fitsSealed(plain) : Buffer.byteLength(JSON.stringify(plain)) > MAX_POST_LINE) {
    if (!heldAt) say(projectId, 'That post stayed on this computer: it is too long to send to ' + farSide(projectId) + '. Shorter posts go out.');
    else s.lostHeld = (s.lostHeld || 0) + 1;   // a re-hold refused: the flush says so
    return false;
  }
  // Posts held past the hour no longer count against the cap; the next flush says so.
  const fresh = [];
  for (const h of s.outbox || []) {
    if (!heldStale(h)) fresh.push(h);
    else s.staleHeld = (s.staleHeld || 0) + 1;
  }
  s.outbox = fresh;
  if (s.outbox.length >= HELD_POSTS_MAX || s.outbox.reduce((n, h) => n + heldSize(h.msg), heldSize(msg)) > HELD_POSTS_BYTES) {
    if (!heldAt) say(projectId, 'That message stayed on this computer: ' + why + ', and as many messages as Kosmos sends at once are already waiting for it.');
    else s.lostHeld = (s.lostHeld || 0) + 1;   // a re-hold refused: the flush says so
    return false;
  }
  // Who may read it: for an owner, the invite limit below (every edge of an owner's project
  // opens the same room, so the edge says nothing). A member's held post, like any live post,
  // goes to whoever is in the room when it is sent (within the hour).
  // An owner's held post records the invites of the members already in plus those still
  // waiting, and goes only while every pinned member came from one of them: never to someone
  // invited afterwards. When the records cannot be read it is refused now (it cannot tell).
  if (msg.invites === undefined) {
    const l = sealLink(projectId);
    const st = roomSeal(projectId);
    let inv = null;
    // Cannot tell whose room it is, or who an owner's room includes: nothing it could be held
    // for is knowable, so it is refused now rather than promised and dropped later.
    if (l === undefined || (st === undefined && l && l.role === 'owner')) {
      if (!heldAt) say(projectId, 'That message stayed on this computer: it cannot read its shared-project records right now, so it cannot tell who this room includes.');
      return false;
    }
    if (st === undefined) inv = null;   // a member's room: nobody to limit it to
    else if (l && l.role === 'owner') {
      // The members already in, and the invites still waiting: every computer pinned when it
      // goes must have come from one of these.
      const inRoom = st && st.peers ? Object.values(st.peers).map((p) => p && p.invite).filter(Boolean) : [];
      try { inv = inRoom.concat(fedseal.pendingInvites(l.ref).map((p) => p.invite)); } catch {
        if (!heldAt) say(projectId, 'That message stayed on this computer: it cannot read its shared-project records right now, so it cannot tell who this room includes.');
        else s.lostHeld = (s.lostHeld || 0) + 1;
        return false;
      }
    }
    msg = Object.assign({}, msg, { invites: inv });
  }
  s.outbox.push({ msg, at: heldAt || Date.now(), mono: mono() });
  s.reheld = true;   // flushHeld's signal that this post is waiting again (not refused for good)
  // #5285: a post waiting on a join check is held quietly; the check's outcome says one line (sent, or nobody joined).
  if (!heldAt && !msg.joinWait) say(projectId, 'That message is held on this computer: ' + why + '. It is sent ' + when + ', while Kosmos keeps running.');
  return false;
}
/** Held more than HELD_POSTS_AGE_MS, or held more than FUTURE_SKEW_MS 'in the future' (the
    clock stepped back that far): not sent, as #5191 treats a time that far ahead of the clock
    as not fresh. A smaller step back (a wake or a time sync) keeps them, so a post can be held
    up to the hour plus that step. */
function heldStale(h) {
  const age = Date.now() - h.at;
  return age < -FUTURE_SKEW_MS || age > HELD_POSTS_AGE_MS;
}
/** #5192: on every pass the hour runs out on held posts, whether or not the seat is connected
    (one connected but unable to flush still ages them), and the room is told. */
function ageHeld(projectId, s) {
  if (!s.outbox) return;
  const before = s.outbox.length;
  s.outbox = s.outbox.filter((h) => !heldStale(h));
  const n = before - s.outbox.length + (s.staleHeld || 0);
  s.staleHeld = 0;
  if (n) say(projectId, n + (n === 1 ? ' held message was' : ' held messages were') + ' not sent: held for more than an hour, or this computer\'s clock was set back.');
}
/** #5192: a seat that ends with posts still held says so, once, instead of losing them
    silently after its hold note promised they would go. */
function dropHeld(projectId, s, why) {
  const n = (s.outbox ? s.outbox.length : 0) + (s.staleHeld || 0);
  s.outbox = [];
  s.staleHeld = 0;
  if (n) say(projectId, n + (n === 1 ? ' held message was' : ' held messages were') + ' not sent: ' + why + '.');
}
/** Send the posts held for the key, oldest first, now that it may have arrived. One that
    still cannot go is held again, with everything after it, in order. */
function flushHeld(projectId, s) {
  if (!s || s.flushing || ((!s.outbox || !s.outbox.length) && !s.staleHeld)) return;
  s.outbox = s.outbox || [];
  // Only through this seat while it is the project's live, connected seat: a seat replaced
  // (an id reused) or not up keeps its posts held rather than sending or dropping them.
  if (seats.get(projectId) !== s || s.stopped || s.status !== 'connected' || !s.child || !s.child.stdin) return;
  // A project no longer linked (unshared, not yet stopped) sends nothing held.
  if (!safeLink(projectId)) return;
  const held = s.outbox;
  s.outbox = [];
  s.flushing = true;
  let sent = 0;
  let files = 0;
  let stale = s.staleHeld || 0;
  s.staleHeld = 0;
  let unmeant = 0;
  let keyless = 0;
  let i = 0;
  try {
    for (; i < held.length; i++) {
      if (heldStale(held[i])) { stale += 1; continue; }
      if (Array.isArray(held[i].msg.invites) && !pinnedFrom(projectId, held[i].msg.invites)) {
        // Pinned members exist and not all came from an invite live when it was written.
        if (pinnedAny(projectId)) { unmeant += 1; continue; }
      }
      s.reheld = false;
      if (sendPost(projectId, held[i].msg, held[i].at) === true) { sent += 1; if (held[i].msg.files) files += 1; continue; }
      // Held again (it is now at the end of the outbox): everything after it waits too, in
      // order. Not held again: refused for good (its own line said why); carry on.
      if (!s.reheld) continue;
      const rest = held.slice(i + 1).filter((h) => !heldStale(h));
      stale += held.length - i - 1 - rest.length;
      s.outbox = s.outbox.concat(rest);
      break;
    }
  } catch (err) {
    // Whatever was not yet handled stays held, ahead of anything held during this flush.
    s.outbox = held.slice(i).concat(s.outbox);
    console.error('#5192: a flush of held posts for ' + JSON.stringify(projectId) + ' stopped: ' + String((err && err.message) || err));
  } finally {
    s.flushing = false;
  }
  stale += s.staleHeld || 0;   // pruned by a re-hold during this flush
  s.staleHeld = 0;
  const oldKey = s.oldKeySent || 0;   // counted per post where each was sealed (sendPost)
  s.oldKeySent = 0;
  if (sent) say(projectId, (sent === 1 ? 'The message held on this computer was sent' : sent + ' messages held on this computer were sent')
    + (oldKey ? (oldKey === sent ? ' under the key this computer has; the others may not show ' + (sent === 1 ? 'it.' : 'them.') : '; ' + oldKey + ' of them under the key this computer has, which the others may not show.') : '.')
    + (files ? (sent === 1 ? ' Its attached file stayed on this computer.' : ' ' + files + ' of them had an attached file, which stayed on this computer.') : ''));
  if (stale) say(projectId, stale + (stale === 1 ? ' held message was' : ' held messages were') + ' not sent: held for more than an hour, or this computer\'s clock was set back.');
  const lost = s.lostHeld || 0;
  s.lostHeld = 0;
  if (lost) say(projectId, lost + (lost === 1 ? ' held message was' : ' held messages were') + ' not sent: ' + (lost === 1 ? 'it' : 'they') + ' no longer fit what this room can send, or who it includes could not be read.');
  keyless += s.keylessHeld || 0;
  s.keylessHeld = 0;
  if (keyless) say(projectId, keyless + (keyless === 1 ? ' held message was' : ' held messages were') + ' not sent: this computer could not confirm it had the newest key in time, so ' + (keyless === 1 ? 'it was' : 'they were') + ' not sent under the key it has.');
  if (unmeant) say(projectId, unmeant + (unmeant === 1 ? ' held message was' : ' held messages were') + ' not sent: the computer that joined came from an invite made after ' + (unmeant === 1 ? 'it was' : 'they were') + ' written.');
}
/** Owner: whether any pinned member was pinned from one of these invites. */
function pinnedFrom(projectId, invites) {
  // EVERY pinned member, since a post goes to the whole room under its one key.
  const st = roomSeal(projectId);
  const peers = st && st.peers ? Object.values(st.peers) : [];
  return peers.length > 0 && peers.every((p) => p && invites.includes(p.invite));
}
function pinnedAny(projectId) {
  const st = roomSeal(projectId);
  return !!(st && st.peers && Object.keys(st.peers).length);
}
/* #5285: an owner's post in the gap between a join and the seat noticing it. */
const NOBODY_JOINED = 'That message stayed on this computer: nobody outside has joined this shared project yet.';
const JOIN_CHECK_MS = 10 * 1000;   // at most one check per seat this often, however many posts wait on it
/** #5285: ordering "held before this answer was asked" on a clock that never steps back (a time sync cannot
    make a post look older than an ask) and that does not tie within a millisecond. */
const mono = () => process.hrtime.bigint();
const hasJoinWait = (s) => !!(s && s.outbox && s.outbox.some((h) => h.msg && h.msg.joinWait));
/** Ask now, or when the last check's window ends; a check already out asks again when it ends. Never refuses: a
    post that waits is answered by the next check, so a member who joins inside the window still gets it. */
function scheduleJoinCheck(projectId, s) {
  if (s.joinCheck) { s.joinCheckAgain = true; return; }
  if (s.joinCheckTimer) return;
  // Capped at the window: a clock set back cannot stretch it.
  const wait = s.joinCheckAskedAt ? Math.min(JOIN_CHECK_MS, s.joinCheckAskedAt + JOIN_CHECK_MS - Date.now()) : 0;
  if (wait <= 0) { kickJoinCheck(projectId, s); return; }
  s.joinCheckTimer = setTimeout(() => {
    s.joinCheckTimer = null;
    if (seats.get(projectId) === s && !s.stopped && hasJoinWait(s)) kickJoinCheck(projectId, s);
  }, wait);
  if (typeof s.joinCheckTimer.unref === 'function') s.joinCheckTimer.unref();
}
/** Release only the posts held for a join that did not come, with the sentence a refusal would have had.
    `askedMono`: when the answer that found nobody was ASKED for; a post held after that is not answered by it.
    `why`: the sentence, when it is not "nobody has joined" (the seat could not be checked at all). */
function dropJoinWait(projectId, s, askedMono, why) {
  if (!s || !s.outbox) return;
  const keep = s.outbox.filter((h) => !(h.msg && h.msg.joinWait && (askedMono === Infinity || (h.mono !== undefined && h.mono < askedMono))));
  const n = s.outbox.length - keep.length;
  s.outbox = keep;
  if (!n) return;
  if (why) say(projectId, (n === 1 ? 'That message stayed' : n + ' messages stayed') + ' on this computer: ' + why + '.');
  else say(projectId, n === 1 ? NOBODY_JOINED : n + ' messages stayed on this computer: nobody outside has joined this shared project yet.');
}
function kickJoinCheck(projectId, s) {
  if (s.joinCheck) return;
  const startedMono = mono();   // every post waiting now was held before this
  s.joinCheckAskedAt = Date.now();   // the window runs from the ask, not from the answer
  let ask = null;
  s.joinCheck = Promise.resolve()
    // The Mac's one shared edges request (#5193), but never an answer asked before this check started.
    .then(() => ensure(projectId, () => { ask = sharedEdges(Date.now(), startedMono); return ask.promise; }))
    .then((status) => {
      if (status === null || status === undefined) {
        // Nothing to check (signed out of Kosmos+, the link gone): say so now rather than hold for the hour.
        dropJoinWait(projectId, s, Infinity, 'the connection to ' + farSide(projectId) + ' is not up right now');
        return;
      }
      // An ensure that returned without asking (a start or a pass already under way) answers nothing: ask again
      // when the window ends, like a post held while a check was out.
      if (!ask) { s.joinCheckAgain = true; return; }
      // Kosmos+ could not answer (ensure turns that into 'reconnecting'): ask again at the window's end, and tell
      // each waiting post's writer once that it is held (the quiet hold would otherwise leave them nothing). Kept on
      // the post itself, not the seat, so nothing has to be reset when posts leave by any path.
      if (status === 'reconnecting') {
        s.joinCheckAgain = true;
        const fresh = (s.outbox || []).filter((h) => h.msg && h.msg.joinWait && !h.outageNoted);
        for (const h of fresh) h.outageNoted = true;
        if (fresh.length) say(projectId, (fresh.length === 1 ? 'That message is held' : fresh.length + ' messages are held') + ' on this computer until Kosmos+ can be reached to say whether anyone has joined.');
        return;
      }
      if (status === 'waiting') dropJoinWait(projectId, s, ask.mono);
      // Anything else: the seat is starting or connected, and its connect flushes what is held.
      else if (s.status === 'connected') flushHeld(projectId, s);
    })
    .catch(() => { s.joinCheckAgain = true; /* could not ask: ask again when the window ends; the pass also checks */ })
    .then(() => {
      s.joinCheck = null;
      const again = s.joinCheckAgain;
      s.joinCheckAgain = false;
      if (again && seats.get(projectId) === s && !s.stopped && (s.status === 'waiting' || s.status === 'reconnecting') && hasJoinWait(s)) scheduleJoinCheck(projectId, s);
    });
}
function sendPost(projectId, { from, kind, text, files, invites, sealedHeld, behindHeld, joinWait }, heldAt) {
  // sealedHeld: held while the room was known to be sealed (then it never goes in the clear).
  const msg = { from, kind, text, files: files === true, invites, sealedHeld: sealedHeld === true, behindHeld: behindHeld === true, joinWait: joinWait === true };
  const s = seats.get(projectId);
  if (!s || !s.child || !s.child.stdin || s.status !== 'connected') {
    // Every room post passes through here; only a federated project's room has
    // anywhere else for it to go, so only there is staying local worth a line.
    if (!safeLink(projectId)) return false;
    if (s && s.status === 'ended') {
      say(projectId, 'That message stayed on this computer: the connection to ' + farSide(projectId) + ' has ended.');
      return false;
    }
    if (s && s.status === 'waiting' && s.ownRefused) {
      say(projectId, 'That message stayed on this computer: this project is not connected to your other computers right now.');
      return false;
    }
    if (s && s.status === 'waiting') {
      /* #5194: an owner's room key is made when the first member joins and kept through a revoke, so a key here
         means someone was in this project and is not now: "has joined yet" would be wrong. */
      if (hasKey(roomSeal(projectId))) {
        say(projectId, 'That message stayed on this computer: nobody else is in this shared project now.');
        return false;
      }
      /* #5285: no key yet, so nobody was in before. But someone may have JUST joined: the seat only
         learns of a join on the next pass (up to a minute), and a post in that gap used to be refused and
         lost. Hold it and ask now; the check either connects the seat (the connect flushes it) or finds
         nobody, which releases it with the sentence below. At most one check per seat per JOIN_CHECK_MS; a post
         inside that window waits for the next check (scheduleJoinCheck), it is never refused at once. */
      if (heldAt === 0 && deps) {
        holdPost(projectId, s, Object.assign({}, msg, { joinWait: true }), 'it is waiting to hear whether someone has joined', 'once they are connected');
        if (hasJoinWait(s)) scheduleJoinCheck(projectId, s);   // a post holdPost refused (too long, full) waits on nothing
        return false;
      }
      say(projectId, NOBODY_JOINED);
      return false;
    }
    say(projectId, 'That message stayed on this computer: the connection to ' + farSide(projectId) + ' is not up right now.');
    return false;
  }
  let payload = { from: clean(from, 80) || 'someone', kind: kind === 'agent' ? 'agent' : 'person', text: String(text || '') };
  // #3728: a sealed room's posts leave this Mac only sealed.
  const sealed = roomSeal(projectId);
  const link = sealLink(projectId);
  const sealedRoom = sealed === undefined ? undefined : isSealedRoom(sealed, link);
  // #5192 round 28: a post written while this member is behind (a hold on and short of the epoch
  // that armed it) was promised the new key, whatever it is held for first (an unreadable record
  // here), so it is marked now and dropped, not sent under the old key, if the hold runs out
  // before the key arrives. Round 29: a member that caught up while the hold runs is not marked;
  // with the record unreadable it cannot tell, so it is marked (the drop is the safe side). The
  // `!hasKey(sealed)` term is what covers an unreadable (undefined) or keyless record; keep it.
  if (!heldAt && s.behind && Date.now() < s.behind.until && (sealed === undefined || !hasKey(sealed) || s.behind.epoch > sealed.epoch)) msg.behindHeld = true;
  if (sealedRoom === undefined) {
    // #5192: held, not dropped (a held one met here is held again): it goes once the record
    // can be read and says whether the room is sealed.
    return holdPost(projectId, s, msg, 'it cannot read its sealed-rooms record right now, so it cannot tell whether this room is sealed', 'when it can, if that is within the hour', heldAt);
  }
  if (!sealedRoom && heldAt && msg.sealedHeld) {
    // A post held for a sealed room never leaves in the clear, whatever the record says now.
    say(projectId, 'A held message was not sent: this shared room no longer reads as sealed here.');
    return false;
  }
  if (sealedRoom) {
    msg.sealedHeld = true;
    // #5192: a post held while behind, with the hold run out and this member still short of the
    // epoch that armed it, is never sealed under the key it has (a removed member may hold it).
    // Here, where the post is sealed, so no read of the record elsewhere can let it through.
    // Only a post held DURING a behind hold (it was promised the new key) is dropped when the
    // hold runs out; one held for another reason goes as a live post would now, under the key
    // this member has (#5197), with the flush note saying so. Dropping every held post instead
    // would let one forged far-ahead envelope disable holding for good (s.behind never clears),
    // while live posts went under the same key anyway.
    if (heldAt && msg.behindHeld && hasKey(sealed) && sealed.role === 'member' && s.behind && s.behind.epoch > sealed.epoch && Date.now() >= s.behind.until) {
      s.keylessHeld = (s.keylessHeld || 0) + 1;
      return false;
    }
    if (hasKey(sealed) && s.behind && s.behind.epoch > sealed.epoch && Date.now() < s.behind.until) {
      // #5192: marked, so it goes only under the new key: if the hold runs out first it is
      // dropped, never sent under a key a removed member may still hold.
      msg.behindHeld = true;
      return holdPost(projectId, s, msg, 'it is behind on this shared room\'s key and is waiting for the owner\'s computer to send the new one', 'when the new key arrives; if it is still missing when this computer next checks after a few minutes, it is not sent', heldAt);
    }
    if (!hasKey(sealed) || !s.room) {
      return holdPost(projectId, s, msg, hasKey(sealed)
        ? 'this computer has not heard this shared room\'s name from the relay yet'
        : link && link.role === 'owner'
        ? 'this shared room is sealed, and no member\'s computer has joined with its key yet'
        : 'this shared room is sealed, and the owner\'s computer has not shared its key yet', hasKey(sealed)
        ? 'when the relay names the room, if that is within the hour'
        : !link || link.role !== 'owner'
        ? 'when the key arrives, if it arrives within the hour, to everyone in the room by then'
        : 'to the first computer that joins with its key from an invite already made, if one joins within the hour', heldAt);
    }
    try { payload = fedseal.seal(sealed.keys[sealed.epoch], sealed.epoch, s.room, payload); } catch {
      say(projectId, (heldAt ? 'A held message' : 'That message') + ' stayed on this computer: it could not be sealed.');
      return false;
    }
  }
  const line = JSON.stringify(payload);
  // The connector refuses a stdin line over its post limit (16 KiB, the relay's
  // frame). Measured on the line itself, escapes included, and said here before
  // sending rather than as a refusal after.
  if (Buffer.byteLength(line) > MAX_POST_LINE) {
    say(projectId, (heldAt ? 'A held message' : 'That post') + ' stayed on this computer: it is too long to send to ' + farSide(projectId) + '. Shorter posts go out.');
    return false;
  }
  // #5192: posts still held for an earlier reason go first, so this one cannot overtake them.
  // Defensive: nothing re-enters post() during a flush today (a room note never federates).
  if (!heldAt && s.flushing) return holdPost(projectId, s, msg, 'messages sent before it are still waiting to go', 'after them', 0);
  if (!heldAt && s.outbox && s.outbox.length) {
    flushHeld(projectId, s);
    if (s.outbox.length) return holdPost(projectId, s, msg, 'messages sent before it are still waiting to go', 'after them', 0);
    if (seats.get(projectId) !== s || s.stopped || s.status !== 'connected' || !s.child || !s.child.stdin) return false;
  }
  try { s.child.stdin.write(line + '\n'); } catch {
    if (heldAt) holdPost(projectId, s, msg, '', '', heldAt);   // a held post whose write threw stays held
    return false;
  }
  const sentLink = safeLink(projectId);
  if (sentLink && sentLink.role === 'member') {
    // #5404: when this post went, for noteSentAfterRevoke.
    const now = Date.now();
    s.sentLog = (s.sentLog || []).filter((t) => now - t < SENT_LOG_MS).slice(-SENT_LOG_MAX);   // one past the cap, so "more than" is known
    s.sentLog.push(now);
  }
  // A held post a member sent while still behind went under the key it has (#5197): counted
  // once it is written, for the flush note.
  if (heldAt && sealed && sealed.role === 'member' && s.behind && s.behind.epoch > sealed.epoch && s.behindArmedAt === sealed.epoch) s.oldKeySent = (s.oldKeySent || 0) + 1;
  // #5197 (said once the post has gone): past the hold, still on the epoch it held when the hold armed (the armed epoch is
  // unauthenticated, so a member that has rotated since is not warned): the post goes out
  // under the old key, which the other boards refuse once the rotation is 90 s old. Said
  // once per armed hold, the same as the hold: while this member stays on one epoch, a forged
  // envelope that armed the hold uses up the note for a real miss at that epoch too (the
  // #5192 class, stated in the plan).
  if (sealed && sealed.role === 'member' && s.behind && s.behind.epoch > sealed.epoch && s.behindArmedAt === sealed.epoch) {
    noteOnce(projectId, s, 'behindSent' + s.behind.epoch, 'This computer may be behind on this shared room\'s key, so a message sent now may not be shown to the others until the owner\'s computer sends the new key.');
  }
  return true;
}

/** Stop every seat. Only tests call it: on a board shutdown each connector
    sees its stdin close when the board exits, and ends on that. */
function stopAll() {
  for (const s of seats.values()) {
    s.stopped = true;
    if (s.timer) clearTimeout(s.timer);
    if (s.joinCheckTimer) clearTimeout(s.joinCheckTimer);   // #5285
    if (s.child) letGo(s.child);
  }
  seats.clear();
}

module.exports = { ownWaiting, allowOwn, ownAllowed, ownRemove, ownCode, confirmOwn, ownStartOver, OWN_RUNS_PER_HOUR, contactStopped, contactState, contactReason, contactStops, farSide, retryOwn, rotateForRevoked, afterRemove, roomSeal, isSealedRoom, linkFor, wired, letGo, INBOUND_ROWS_PER_DAY, MAC_RETRY_MS, logUnreadable, STOP_KILL_MS, STABLE_MS, INBOUND_BYTES_PER_DAY, MAX_POST_LINE, SENT_LOG_MAX, REVOKE_SENT_SKEW_MS, configure, ensure, ensureAll, post, statusOf, stop, stopAll, onEvent, MAC_EDGES, INBOUND_PER_WINDOW, INBOUND_BYTES_PER_WINDOW, HELD_POSTS_MAX };
