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
const RESTART_MAX_MS = 60000;
const MAC_EDGES = '/v1/mac/federation/edges';

/* projectId -> { child, edge, status, backoff, timer, ended } */
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
 */
function configure(d) {
  deps = d;
}

function statusOf(projectId) {
  const s = seats.get(projectId);
  return s ? s.status : null;
}

function clean(v, max) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
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
  if (ev.event === 'connected') { setStatus(projectId, 'connected'); s.backoff = RESTART_START_MS; return; }
  if (ev.event === 'disconnected') { setStatus(projectId, 'reconnecting'); return; }
  if (ev.event === 'ended') { s.ended = String(ev.because || 'the connection ended'); setStatus(projectId, 'ended'); return; }
  if (ev.event === 'message' && ev.data && typeof ev.data === 'object' && typeof ev.data.text === 'string') {
    deps.recordExternal(projectId, {
      from: clean(ev.data.from, 80) || 'someone outside',
      fromKind: ev.data.kind === 'agent' ? 'agent' : 'person',
      text: ev.data.text,
    });
  }
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
async function ownerEdge(link) {
  const r = await deps.macRequest('POST', MAC_EDGES, {});
  if (!r.ok || !r.data || !Array.isArray(r.data.as_owner)) return null;
  const edge = r.data.as_owner.find((e) => e && e.project_ref === link.ref && e.status === 'active');
  return edge ? edge.id : null;
}

function spawnFor(projectId, edge) {
  const s = seats.get(projectId);
  const child = deps.spawnSeat(edge);
  s.child = child;
  // A connector that cannot start (missing, not executable) emits 'error' and
  // may never 'exit': treat it as an exit so it backs off instead of crashing
  // the board on an unhandled event.
  child.on('error', () => { child.emit('exit', null); });
  s.edge = edge;
  setStatus(projectId, 'connecting');
  let buf = '';
  child.stdout.setEncoding && child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
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
    // 3 = refused for good (revoked, lapsed): do not hammer the coordinator.
    if (code === 3 || cur.stopped) { if (code === 3) setStatus(projectId, 'ended'); return; }
    setStatus(projectId, 'reconnecting');
    cur.timer = setTimeout(() => { cur.timer = null; ensure(projectId).catch(() => {}); }, cur.backoff);
    cur.backoff = Math.min(cur.backoff * 2, RESTART_MAX_MS);
  });
}

/** Make sure a linked project has a live seat. Safe to call repeatedly. */
async function ensure(projectId) {
  if (!deps) return null;
  const link = federation.linkFor(projectId);
  if (!link) return null;
  if (typeof deps.enrolled === 'function' && !deps.enrolled()) return null;
  let s = seats.get(projectId);
  if (!s) { s = { child: null, edge: null, status: null, backoff: RESTART_START_MS, timer: null, ended: null, stopped: false }; seats.set(projectId, s); }
  if (s.child || s.stopped || s.status === 'ended') return s.status;
  const edge = link.role === 'member' ? link.edge_id : await ownerEdge(link);
  if (!edge) { setStatus(projectId, 'waiting'); return 'waiting'; }
  spawnFor(projectId, edge);
  return statusOf(projectId);
}

/** Seat every linked project (called at boot and after a join or a link). */
async function ensureAll() {
  if (!deps) return;
  let links;
  try { links = federation.readLinks(); } catch { return; }
  for (const id of Object.keys(links)) {
    try { await ensure(id); } catch { /* one project's seat never blocks another's */ }
  }
}

/**
 * Post one local message out to the project's room. Returns true if a live seat
 * took it. Only the words and who said them leave this Mac.
 */
function post(projectId, { from, kind, text }) {
  const s = seats.get(projectId);
  if (!s || !s.child || !s.child.stdin || s.status !== 'connected') return false;
  const line = JSON.stringify({ from: clean(from, 80) || 'someone', kind: kind === 'agent' ? 'agent' : 'person', text: String(text || '') });
  try { s.child.stdin.write(line + '\n'); return true; } catch { return false; }
}

/** Stop every seat (board shutdown, tests). */
function stopAll() {
  for (const s of seats.values()) {
    s.stopped = true;
    if (s.timer) clearTimeout(s.timer);
    if (s.child) { try { s.child.stdin.end(); } catch { /* gone */ } }
  }
  seats.clear();
}

module.exports = { configure, ensure, ensureAll, post, statusOf, stopAll, onEvent, MAC_EDGES };
