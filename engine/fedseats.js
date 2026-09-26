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
const { externalName } = require('./externalname');

const RESTART_START_MS = 2000;
/* Inbound bound per project: a connected peer may not flood this Mac's message
   log (the relay allows bursts of 128). Past it, messages are dropped and the
   room says so once per window. */
const INBOUND_PER_WINDOW = 60;
/* And a byte budget in the same window, so the count bound cannot be spent on
   max-size messages. */
const INBOUND_BYTES_PER_WINDOW = 64 * 1024;
const INBOUND_WINDOW_MS = 60000;
/* A day's budget per project (per ROOM, shared by every member of it; the
   sender is unattested, so it cannot be per peer) on top of the minute's: every stored row is kept in
   memory and scanned by the room and unread reads, so a peer sending at the
   minute's limit all day must not be able to grow them without end. 2 MiB of
   words a day is far above any conversation. Counted per board run: a restart
   (an update, a crash) starts a fresh day's allowance, so this bounds one run's
   growth, not a calendar day's. Persisting it is kosmos#3844. */
const INBOUND_BYTES_PER_DAY = 2 * 1024 * 1024;
/* And rows a day per room: every row is held in memory and scanned on every
   read, so tiny messages at the minute's limit must not grow it without end. */
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

/* projectId -> { child, edge, status, backoff, timer, ended, stopped, starting, inbound } */
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
 *   note(projectId, text)         optional; Kosmos's own line in the room, used to
 *                                 say a post did not go out or messages were dropped
 */
function configure(d) {
  deps = d;
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
  if (ev.event === 'connected') { setStatus(projectId, 'connected'); s.connectedAt = Date.now(); s.macNoted = false; return; }
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
  if (ev.event === 'message' && ev.data && typeof ev.data === 'object' && typeof ev.data.text === 'string' && ev.data.text.trim()) {
    const now = Date.now();
    if (!s.inbound || now - s.inbound.since >= INBOUND_WINDOW_MS) s.inbound = { since: now, count: 0, bytes: 0, noted: false };
    const day = new Date(now).toISOString().slice(0, 10);
    if (!s.inday || s.inday.day !== day) s.inday = { day, bytes: 0, rows: 0, noted: false };
    // `from` is whatever the other Mac wrote: only a string counts. String() on an
    // object whose toString is not a function throws, here, where nothing catches.
    const fromRaw = typeof ev.data.from === 'string' ? ev.data.from : '';
    const size = Buffer.byteLength(ev.data.text) + Buffer.byteLength(fromRaw);
    s.inbound.count += 1;
    s.inbound.bytes += size;
    if (s.inbound.count > INBOUND_PER_WINDOW || s.inbound.bytes > INBOUND_BYTES_PER_WINDOW) {
      if (!s.inbound.noted) { s.inbound.noted = true; say(projectId, 'The external project sent more messages than Kosmos keeps in a minute; some were not kept.'); }
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
        from: clean(fromRaw, 80) || 'someone outside',
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

function safeLink(projectId) {
  try { return federation.linkFor(projectId); } catch { return null; }
}

/** Make sure a linked project has a live seat. Safe to call repeatedly and
    concurrently: `starting` is set before the edge lookup's await, so two
    overlapping calls cannot both spawn a seat. */
async function ensure(projectId, edges) {
  if (!deps) return null;
  const link = federation.linkFor(projectId);
  // No link, no seat: one still running would carry another project's room.
  if (!link) { if (seats.has(projectId)) stop(projectId); return null; }
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
  const line = JSON.stringify({ from: clean(from, 80) || 'someone', kind: kind === 'agent' ? 'agent' : 'person', text: String(text || '') });
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

module.exports = { letGo, INBOUND_ROWS_PER_DAY, MAC_RETRY_MS, logUnreadable, STOP_KILL_MS, STABLE_MS, INBOUND_BYTES_PER_DAY, MAX_POST_LINE, configure, ensure, ensureAll, post, statusOf, stop, stopAll, onEvent, MAC_EDGES, INBOUND_PER_WINDOW, INBOUND_BYTES_PER_WINDOW };
