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

const RESTART_START_MS = 2000;
/* Inbound bound per project: a connected peer may not flood this Mac's message
   log (the relay allows bursts of 128). Past it, messages are dropped and the
   room says so once per window. */
const INBOUND_PER_WINDOW = 60;
/* And a byte budget in the same window, so the count bound cannot be spent on
   max-size messages: 64 KiB a minute is far above any conversation and keeps a
   flooding peer to under 100 MiB a day in the append-only message log. */
const INBOUND_BYTES_PER_WINDOW = 64 * 1024;
const INBOUND_WINDOW_MS = 60000;
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

/* A one-line label from outside: control characters (terminal escapes among
   them), direction overrides and line separators become spaces, whitespace
   collapses. */
function clean(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
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
  if (ev.event === 'connected') { setStatus(projectId, 'connected'); s.connectedAt = Date.now(); return; }
  if (ev.event === 'disconnected') { setStatus(projectId, 'reconnecting'); return; }
  if (ev.event === 'ended') {
    s.ended = clean(ev.because, 200) || 'the connection ended';
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
    s.inbound.count += 1;
    s.inbound.bytes += Buffer.byteLength(ev.data.text) + Buffer.byteLength(String(ev.data.from || ''));
    if (s.inbound.count > INBOUND_PER_WINDOW || s.inbound.bytes > INBOUND_BYTES_PER_WINDOW) {
      if (!s.inbound.noted) { s.inbound.noted = true; say(projectId, 'The external project sent more messages than Kosmos keeps in a minute; some were not kept.'); }
      return;
    }
    // Runs inside the child's stdout 'data' handler, where a throw (a full disk)
    // has nothing above it to catch it and would take the board down.
    try {
      deps.recordExternal(projectId, {
        from: clean(ev.data.from, 80) || 'someone outside',
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

/* The owner's seat needs an edge of the project; any active one names the room. */
/* An active edge of the owner's project, skipping any edge whose seat was
   already refused for good: the coordinator can still list an edge as active
   while refusing its ticket (the owner's own account lapsed), and without the
   skip the owner's seat would spawn, be refused, and spawn again every minute. */
async function ownerEdge(link, refused, edges) {
  const r = await (edges ? edges() : deps.macRequest('POST', MAC_EDGES, {}));
  if (!r.ok || !r.data || !Array.isArray(r.data.as_owner)) return null;
  const edge = r.data.as_owner.find((e) => e && e.project_ref === link.ref && e.status === 'active'
    && !(refused && refused.has(e.id)));
  return edge ? edge.id : null;
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
    buf += chunk;
    if (buf.length > MAX_LINE && buf.indexOf('\n') < 0) buf = '';
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onEvent(projectId, line);
    }
  });
  child.on('exit', (code) => {
    const cur = seats.get(projectId);
    if (!cur || cur.child !== child) return;
    cur.child = null;
    if (cur.stopped) return;
    // 3 = refused for good (revoked, lapsed). A member's seat ends there. An
    // owner's seat was pinned to one member's edge; it looks for another active
    // edge on the next check and ends only when none is left.
    if (code === 3) {
      const link = safeLink(projectId);
      if (link && link.role === 'owner') {
        if (!cur.refused) cur.refused = new Set();
        if (cur.edge) cur.refused.add(cur.edge);
        // Kept on the link, so a restart does not try the refused edge again.
        try { federation.recordLink(projectId, Object.assign({}, link, { refused: [...cur.refused].slice(-64) })); } catch { /* retried once next boot */ }
        setStatus(projectId, 'waiting');
        return;
      }
      // Kept on the link, so a board restart does not start the seat again only
      // to be refused and say so in the room once more.
      if (link) { try { federation.recordLink(projectId, Object.assign({}, link, { ended: cur.ended || 'the connection ended' })); } catch { /* ends again next boot */ } }
      setStatus(projectId, 'ended');
      return;
    }
    // 2 is a usage error: this computer's connector does not know the verb.
    // Restarting cannot fix that; updating Kosmos does.
    if (code === 2) {
      say(projectId, 'This computer cannot join the external project yet: its Kosmos connector is too old. Update Kosmos, then open this project again.');
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

function safeLink(projectId) {
  try { return federation.linkFor(projectId); } catch { return null; }
}

/** Make sure a linked project has a live seat. Safe to call repeatedly and
    concurrently: `starting` is set before the edge lookup's await, so two
    overlapping calls cannot both spawn a seat. */
async function ensure(projectId, edges) {
  if (!deps) return null;
  const link = federation.linkFor(projectId);
  if (!link) return null;
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
    const edge = link.role === 'member' ? link.edge_id : await ownerEdge(link, s.refused, edges);
    if (!edge) { setStatus(projectId, 'waiting'); return 'waiting'; }
    if (s.stopped || s.child) return s.status;
    spawnFor(projectId, edge);
    return statusOf(projectId);
  } finally {
    s.starting = false;
  }
}

/* Let a seat go: closing its stdin is how it is told to end, and a seat that
   has not exited STOP_KILL_MS later is killed, so a hung connector is never
   left running for a project that is gone. */
const STOP_KILL_MS = 5000;
function letGo(child) {
  try { child.stdin.end(); } catch { /* gone */ }
  const t = setTimeout(() => { try { child.kill(); } catch { /* gone */ } }, STOP_KILL_MS);
  if (typeof t.unref === 'function') t.unref();
  child.once('exit', () => clearTimeout(t));
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
  try { links = federation.readLinks(); } catch { return; }
  // One edges request per pass, shared by every owner project: the number of
  // linked projects must not set how often this Mac calls Kosmos+.
  let pending = null;
  const edges = () => pending || (pending = deps.macRequest('POST', MAC_EDGES, {}));
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

module.exports = { STOP_KILL_MS, STABLE_MS, configure, ensure, ensureAll, post, statusOf, stop, stopAll, onEvent, MAC_EDGES, INBOUND_PER_WINDOW, INBOUND_BYTES_PER_WINDOW };
