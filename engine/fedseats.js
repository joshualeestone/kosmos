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
 * messages and determining how they work together").
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
const MAC_LEVEL_REFUSAL = /unknown mac|this mac was retired|account gone|not set up for kosmos\+/i;
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

/* projectId -> { child, edge, status, backoff, timer, ended, stopped, starting, inbound, inday }
   inbound: this minute's { since, count, bytes }; inday: this UTC day's { day, bytes, rows, noted, minuteNoted } */
const seats = new Map();

let deps = null;
/**
 * Wire the manager. Everything it touches is injected so a test can drive it:
 *   spawnSeat(edgeId) -> a ChildProcess-like { stdin, stdout, on('exit') }
 *   macRequest(method, route, body) -> { ok, data | because }
 *   recordExternal(projectId, { from, fromKind, text })
 *   onStatus(projectId, status)   optional
 *   enrolled() -> bool            optional; no seat is started on a Mac that is
 *                                 not connected to Kosmos+ (a dev board, a test)
 *   projectExists(projectId)      optional; a removed project gets no seat
 *   externalKeptOn(projectId, day) optional; { rows, bytes } the room already kept
 *                                 from outside on that UTC day, null if unknown
 *   projectCreatedAt(projectId)   optional; the project's createdAt, null when it
 *                                 has none, undefined when it cannot be read. A
 *                                 link stamped for another project of the same id
 *                                 gets no seat (#3851)
 *   note(projectId, text)         optional; Kosmos's own line in the room, used to
 *                                 say a post did not go out or messages were dropped
 */
function configure(d) {
  deps = d;
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
  let ev;
  try { ev = JSON.parse(line); } catch { return; }
  if (!ev || typeof ev !== 'object') return;
  const s = seats.get(projectId);
  if (!s) return;
  // The backoff resets only once a connection has lasted (see the exit handler),
  // so a seat that connects and drops at once still backs off.
  if (ev.event === 'connected') {
    setStatus(projectId, 'connected'); s.connectedAt = Date.now(); s.macNoted = false;
    // #3728: the room id both ends share (the coordinator derives it per project); it is bound into every seal.
    s.room = typeof ev.room === 'string' && ev.room ? ev.room : null;
    sayHello(projectId, s);
    sendRotates(projectId, s);
    return;
  }
  if (ev.event === 'disconnected') { setStatus(projectId, 'reconnecting'); return; }
  if (ev.event === 'ended') {
    s.ended = clean(ev.because, 200) || 'the connection ended';
    // Some final refusals are about THIS Mac or account, not the edge (the
    // connector's FINAL_REFUSALS). Signing in again fixes those, so nothing about
    // the edge is kept and the person is told the real fix.
    s.macLevel = MAC_LEVEL_REFUSAL.test(s.ended);
    if (s.macLevel) {
      // Said once until the seat connects again, not on every slow retry.
      if (!s.macNoted) {
        s.macNoted = true;
        say(projectId, 'This computer is not connected to Kosmos+ right now (' + s.ended + '). Sign in to Kosmos+ again in Settings, Kosmos Plus, and this shared project comes back.');
      }
      return;
    }
    // An owner's seat is pinned to one member's edge: that edge ending is not
    // the owner leaving, so the note (and its "ask the owner") is a member's.
    const link = safeLink(projectId);
    if (!link || link.role !== 'member') return;
    say(projectId, 'This computer is no longer connected to the external project: ' + s.ended + '. To take part again, ask the owner for a new code.');
    return;
  }
  if (ev.event === 'refused_post') { say(projectId, 'A message was not sent to the external project: ' + clean(ev.because, 200) + '.'); return; }
  if (ev.event === 'message' && ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data)) {
    // #3728: key frames are the room's handshake, never a row.
    if (typeof ev.data.t === 'string' && ev.data.t.startsWith('key-')) { onKeyFrame(projectId, s, ev.data); return; }
    const sealed = roomSeal(projectId);
    const sealedRoom = sealed === undefined ? undefined : isSealedRoom(sealed, sealLink(projectId));
    if (sealedRoom === undefined) { noteOnce(projectId, s, 'sealUnreadable', 'A message from the external project was not shown: this computer cannot read its sealed-rooms record right now.'); return; }
    if (fedseal.isSealed(ev.data)) {
      const now = Date.now();
      // A member seeing a newer epoch than its own missed a rotation: until the owner's
      // re-send arrives it holds its posts (a revoked member may still hold its key).
      if (sealed && sealed.role === 'member' && hasKey(sealed) && ev.data.epoch > sealed.epoch) {
        s.behindEpoch = Math.max(s.behindEpoch || 0, ev.data.epoch);
      }
      const opened = hasKey(sealed) && s.room ? fedseal.open(acceptedKeys(sealed, now), s.room, ev.data) : null;
      if (!opened && s.behindEpoch > (sealed && Number.isInteger(sealed.epoch) ? sealed.epoch : -1)) {
        noteOnce(projectId, s, 'behind', 'This computer is behind on this shared room\'s key, so a message could not be read yet. It is waiting for the owner\'s computer to send the new key, and holds its own posts until then.');
        return;
      }
      if (!opened && !sealed) {
        // This computer joined before the owner sealed the room: it holds no key and never will from that code.
        noteOnce(projectId, s, 'sealedSince', 'The owner has sealed this shared room since this computer joined, so its messages cannot be read here. Ask the owner to remove you from the shared project and send you a new code.');
        return;
      }
      if (!opened) { noteOnce(projectId, s, 'unopened', 'A sealed message arrived that this computer could not open, so it was not shown.'); return; }
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
      if (!s.inday.minuteNoted) { s.inday.minuteNoted = true; say(projectId, 'The external project sent more messages than Kosmos keeps in a minute; some were not kept. Kosmos says this once a day.'); }
      return;
    }
    // Only what is KEPT counts toward the day: a flood the minute bound drops
    // must not spend the room's day for everyone else in it.
    if (s.inday.bytes + size > INBOUND_BYTES_PER_DAY || s.inday.rows + 1 > INBOUND_ROWS_PER_DAY) {
      if (!s.inday.noted) { s.inday.noted = true; say(projectId, 'The external project sent more than Kosmos keeps in a day; its messages are not kept until the day resets (midnight UTC).'); }
      return;
    }
    s.inday.bytes += size;
    s.inday.rows += 1;
    // Runs inside the child's stdout 'data' handler, where a throw (a full disk)
    // has nothing above it to catch it and would take the board down.
    try {
      deps.recordExternal(projectId, {
        from: fromKept,
        fromKind: ev.data.kind === 'agent' ? 'agent' : 'person',
        text: ev.data.text,
      });
    } catch {
      say(projectId, 'A message from the external project could not be saved on this computer.');
    }
  }
}

function say(projectId, text) {
  if (deps && typeof deps.note === 'function') { try { deps.note(projectId, text); } catch { /* a note is furniture */ } }
}

function setStatus(projectId, status) {
  const s = seats.get(projectId);
  if (!s) return;
  s.status = status;
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
  s.edge = edge;
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
      if (link.role === 'owner') {
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
/* After a rotation, the previous epoch still opens for this long (a message sealed
   just before it, still in flight), then never again: a revoked member cannot keep
   posting under the key it was rotated out of. */
const EPOCH_GRACE_MS = 10 * 60 * 1000;

/** This room's seal state, null for a room with none, undefined when the record
    cannot be read (then nothing is sent or shown: we cannot tell). */
function roomSeal(projectId) {
  try { return fedseal.roomState(projectId); } catch { return undefined; }
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
/** The epochs this board opens now: the current one, and the one before it for
    EPOCH_GRACE_MS after a rotation. */
function acceptedKeys(st, now) {
  const keys = { [st.epoch]: st.keys[st.epoch] };
  const prev = st.epoch - 1;
  if (prev >= 0 && typeof st.keys[prev] === 'string' && Number.isFinite(st.rotatedAt) && now - st.rotatedAt < EPOCH_GRACE_MS) keys[prev] = st.keys[prev];
  return keys;
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
  for (const pub of Object.keys(st.peers || {})) {
    try { sendFrame(s, fedseal.rotateFrame(me, pub, st.keys[st.epoch], st.epoch, s.room, Number.isSafeInteger(st.rotatedAt) ? st.rotatedAt : 0)); } catch { /* the next connect sends it again */ }
  }
}
/** Owner: a pinned member whose edge the coordinator reports as not active has been
    revoked. The room moves to a new key only the remaining members get, so the revoked
    member cannot read anything posted after (it keeps what it read). The edge was
    bound at pin time from the coordinator's own list (the invite the member redeemed),
    never from anything the member said. */
function rotateForRevoked(projectId, link, edges) {
  return sealStep(projectId, async () => {
    const first = roomSeal(projectId);
    if (!hasKey(first) || first.role !== 'owner' || !Object.keys(first.peers || {}).length) return false;
    let r;
    try { r = await (edges ? edges() : deps.macRequest('POST', MAC_EDGES, {})); } catch { return false; }
    if (!r || !r.ok || !r.data || !Array.isArray(r.data.as_owner)) return false;
    const status = new Map(r.data.as_owner.filter((e) => e && e.project_ref === link.ref).map((e) => [e.id, e.status]));
    const st = roomSeal(projectId);   // re-read: a hello may have pinned someone during the await
    if (!hasKey(st) || st.role !== 'owner') return false;
    const peers = st.peers || {};
    // Only an edge the coordinator names as no longer active counts; an edge it does not
    // list is not taken as revoked (a partial answer must not lock a member out).
    const gone = Object.keys(peers).filter((pub) => peers[pub] && status.has(peers[pub].edge) && status.get(peers[pub].edge) !== 'active');
    if (!gone.length) return false;
    const epoch = st.epoch + 1;
    const keep = {};
    for (const pub of Object.keys(peers)) if (!gone.includes(pub)) keep[pub] = peers[pub];
    fedseal.setRoomState(projectId, Object.assign({}, st, {
      peers: keep, epoch, rotatedAt: Date.now(), keys: Object.assign({}, st.keys, { [epoch]: fedseal.randomSecret() }),
    }));
    const s = seats.get(projectId);
    if (s) sendRotates(projectId, s);
    return true;
  });
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
  if (!hasKey(st)) st = { role: 'owner', peers: {}, epoch: 0, keys: { 0: fedseal.randomSecret() } };
  st = Object.assign({}, st, { peers: Object.assign({}, peers, { [frame.pub]: { s: inv.s, code: inv.code, invite: inv.invite, edge: edge.id } }) });
  fedseal.setRoomState(projectId, st);
  fedseal.spendInvite(link.ref, inv.s);
  sendFrame(s, fedseal.shareFrame(inv.s, inv.code, me, frame.pub, st.keys[st.epoch], st.epoch, s.room));
}
function onKeyFrame(projectId, s, frame) {
  const link = safeLink(projectId);
  if (!link || !s.room) return;
  let me;
  try { me = fedseal.sealingKey(); } catch { return; }
  if (frame.t === 'key-hello' && link.role === 'owner') { sealStep(projectId, () => ownerHello(projectId, s, link, frame, me)); return; }
  try {
    if (frame.t === 'key-share' && link.role === 'member') {
      const st = roomSeal(projectId);
      if (!st || st.role !== 'member' || hasKey(st)) return;
      const got = fedseal.openShare(st.s, st.code, me, frame, s.room);
      if (!got) return;   // another member's share, or not genuine
      fedseal.setRoomState(projectId, Object.assign({}, st, { peer: got.ownerPub, epoch: got.epoch, keys: { [got.epoch]: got.roomKey } }));
      say(projectId, 'This shared room is sealed: only the computers in it can read its messages.');
      return;
    }
    if (frame.t === 'key-rotate' && link.role === 'member') {
      const st = roomSeal(projectId);
      if (!hasKey(st) || !st.peer) return;
      const got = fedseal.openRotate(me, st.peer, frame, s.room);
      if (!got || Object.prototype.hasOwnProperty.call(st.keys, got.epoch) || got.epoch <= st.epoch) return;
      const keys = Object.assign({}, st.keys, { [got.epoch]: got.roomKey });
      // The grace runs from the owner's rotation (sealed in the frame), never from now:
      // a member catching up late must not reopen the old key for a revoked member.
      // A time ahead of this clock counts as now.
      fedseal.setRoomState(projectId, Object.assign({}, st, { keys, epoch: got.epoch, rotatedAt: Math.min(got.rotatedAt, Date.now()) }));
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
  if (typeof deps.enrolled === 'function' && !deps.enrolled()) return null;
  if (typeof deps.projectExists === 'function' && !deps.projectExists(projectId)) {
    stop(projectId);
    try { federation.forgetLink(projectId); } catch { /* retried on the next check */ }
    return null;
  }
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
      if (got.none) { setStatus(projectId, 'waiting'); return 'waiting'; }
      edge = got.edge;
    }
    if (s.stopped || s.child) return s.status;
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
  s.stopped = true;
  if (s.timer) clearTimeout(s.timer);
  if (s.child) letGo(s.child);
  seats.delete(projectId);
}

/** Seat every linked project (called at boot and after a join or a link). */
async function ensureAll() {
  if (!deps) return;
  let links;
  try { links = federation.readLinks(); } catch (err) { logUnreadable(err); return; }
  // One edges request per pass, shared by every owner project: the number of
  // linked projects must not set how often this Mac calls Kosmos+.
  let pending = null;
  const edges = () => pending || (pending = deps.macRequest('POST', MAC_EDGES, {}));
  // A seat whose link is gone (its project removed some other way) stops.
  for (const id of [...seats.keys()]) if (!Object.prototype.hasOwnProperty.call(links, id)) stop(id);
  for (const id of Object.keys(links)) {
    try { await ensure(id, edges); } catch { /* one project's seat never blocks another's */ }
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
  }
  for (const id of Object.keys(links)) {
    const link = links[id];
    if (!link || link.role !== 'owner') continue;
    try { await rotateForRevoked(id, link, edges); } catch { /* retried on the next pass */ }
  }
}

/**
 * Post one local message out to the project's room. Returns true if a live seat
 * took it. Only the words and who said them leave this Mac.
 */
function post(projectId, { from, kind, text }) {
  const s = seats.get(projectId);
  if (!s || !s.child || !s.child.stdin || s.status !== 'connected') {
    // Every room post passes through here; only a federated project's room has
    // anywhere else for it to go, so only there is staying local worth a line.
    if (!safeLink(projectId)) return false;
    if (s && s.status === 'ended') {
      say(projectId, 'That message stayed on this computer: the connection to the external project has ended.');
      return false;
    }
    if (s && s.status === 'waiting') {
      say(projectId, 'That message stayed on this computer: nobody outside has joined this shared project yet.');
      return false;
    }
    say(projectId, 'That message stayed on this computer: the connection to the external project is not up right now.');
    return false;
  }
  let payload = { from: clean(from, 80) || 'someone', kind: kind === 'agent' ? 'agent' : 'person', text: String(text || '') };
  // #3728: a sealed room's posts leave this Mac only sealed.
  const sealed = roomSeal(projectId);
  const link = sealLink(projectId);
  const sealedRoom = sealed === undefined ? undefined : isSealedRoom(sealed, link);
  if (sealedRoom === undefined) {
    say(projectId, 'That message stayed on this computer: it cannot read its sealed-rooms record right now, so it cannot tell whether this room is sealed.');
    return false;
  }
  if (sealedRoom) {
    if (hasKey(sealed) && s.behindEpoch > sealed.epoch) {
      say(projectId, 'That message stayed on this computer: it is behind on this shared room\'s key and is waiting for the owner\'s computer to send the new one.');
      return false;
    }
    if (!hasKey(sealed) || !s.room) {
      say(projectId, link && link.role === 'owner'
        ? 'That message stayed on this computer: this shared room is sealed, and no member\'s computer has joined with its key yet. Nothing is sent until one has.'
        : 'That message stayed on this computer: this shared room is sealed, and the owner\'s computer has not shared its key yet. Nothing is sent until it has.');
      return false;
    }
    try { payload = fedseal.seal(sealed.keys[sealed.epoch], sealed.epoch, s.room, payload); } catch {
      say(projectId, 'That message stayed on this computer: it could not be sealed.');
      return false;
    }
  }
  const line = JSON.stringify(payload);
  // The connector refuses a stdin line over its post limit (16 KiB, the relay's
  // frame). Measured on the line itself, escapes included, and said here before
  // sending rather than as a refusal after.
  if (Buffer.byteLength(line) > MAX_POST_LINE) {
    say(projectId, 'That post stayed on this computer: it is too long to send to the external project. Shorter posts go out.');
    return false;
  }
  try { s.child.stdin.write(line + '\n'); return true; } catch { return false; }
}

/** Stop every seat. Only tests call it: on a board shutdown each connector
    sees its stdin close when the board exits, and ends on that. */
function stopAll() {
  for (const s of seats.values()) {
    s.stopped = true;
    if (s.timer) clearTimeout(s.timer);
    if (s.child) letGo(s.child);
  }
  seats.clear();
}

module.exports = { rotateForRevoked, roomSeal, isSealedRoom, linkFor, wired, letGo, INBOUND_ROWS_PER_DAY, MAC_RETRY_MS, logUnreadable, STOP_KILL_MS, STABLE_MS, INBOUND_BYTES_PER_DAY, MAX_POST_LINE, configure, ensure, ensureAll, post, statusOf, stop, stopAll, onEvent, MAC_EDGES, INBOUND_PER_WINDOW, INBOUND_BYTES_PER_WINDOW };
