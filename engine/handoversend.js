'use strict';
/**
 * kosmos#8710 slice 3: the leaving member's computer packs the agents a company hands over to a colleague.
 *
 * The coordinator (kosmos-relay, slice 2) records a hand-over: which member leaves, who takes the agents, and the
 * agents by name. Once the successor's computer has made a one-time key and sent its public half (seal_pub), this
 * computer's part reads `packing`. tick() then packs: each named agent's folder, its profile and its recent
 * transcripts, sealed to seal_pub, signed with this computer's device key, uploaded under handover/<org>/<id>/ through
 * the hand-over grant and manifest routes (backupsnapshot input.handover). The manifest step moves the record to
 * `packed`; nothing here has to say so.
 *
 * What a pack carries, per agent (root names use backuptick.rootSegment of the agent's machine name):
 *   agents/<seg>        the agent's folder (create.workerDir): its instructions and its Files folder. REQUIRED: an
 *                       agent whose folder cannot be read fails the pack, said with its name.
 *   profiles/<seg>      its one profile file, by name (`only`). The successor strips per-install fields (slice 4).
 *   sessions/<seg>/...  its transcripts, from the SAME builder the backup uses (backuptick.inputsHere().sessions),
 *                       trimmed to the newest files up to SESSION_BYTES per agent, so a long history carries recent
 *                       context and not all of it.
 * Never the data root, credentials or provider sign-ins: an agent folder that holds or sits inside one of backuptick's
 * protected folders fails the pack (the profile file is the one named exception, a single file by name).
 *
 * Names: the hand-over names agents as the company's rollup shows them (a running agent's name, a stopped one's shown
 * name). Each is matched against register.survey() rows with a profile and not removed, by name or shown name; one that
 * matches none, or two different agents, fails the pack with that name in the sentence ("ACT ON name, SPEAK shownAs").
 *
 * One pack at a time, never two ticks at once. A failure that may pass (retryLater) is tried again next tick; any other
 * is kept in `state.failed` for the screen to say, and not tried again until the part changes. Never throws.
 */
const fs = require('fs');
const path = require('path');

const MINE_ROUTE = '/v1/mac/org/handover/mine';
const SESSION_BYTES = 50 * 1024 * 1024;
const EVERY_MS = 5 * 60 * 1000;

/* The agent machine names for the hand-over's labels, or a sentence. rows: register.survey().agents. */
function resolveNames(labels, rows) {
  if (!Array.isArray(labels) || !labels.length || labels.some((x) => typeof x !== 'string' || !x)) return { ok: false, because: 'the hand-over names no agents' };
  const live = (rows || []).filter((r) => r && r.profile === true && !r.removed && typeof r.name === 'string');
  const names = [];
  for (const label of labels) {
    const hits = [...new Set(live.filter((r) => r.name === label || r.shownAs === label).map((r) => r.name))];
    if (!hits.length) return { ok: false, because: `there is no agent called ${label} on this computer` };
    if (hits.length > 1) return { ok: false, because: `more than one agent on this computer is called ${label}` };
    if (!names.includes(hits[0])) names.push(hits[0]);
  }
  return { ok: true, names };
}

/* Keep the newest session files of one agent, across all its session roots, up to `cap` bytes. A file that cannot be
   read is dropped. Roots left with no files are dropped. */
function trimSessions(roots, cap, deps) {
  const stat = (deps && deps.stat) || ((p) => fs.statSync(p));
  const all = [];
  for (const r of roots) for (const rel of r.only || []) {
    try { const s = stat(path.join(r.path, rel)); if (s.isFile()) all.push({ r, rel, size: s.size, mtime: s.mtimeMs }); } catch { /* gone */ }
  }
  all.sort((a, b) => b.mtime - a.mtime || (a.rel < b.rel ? -1 : 1));
  const keep = new Map();
  let used = 0;
  for (const f of all) {
    if (used + f.size > cap) continue;   // a smaller older file may still fit
    used += f.size;
    if (!keep.has(f.r)) keep.set(f.r, []);
    keep.get(f.r).push(f.rel);
  }
  return roots.filter((r) => keep.has(r)).map((r) => Object.assign({}, r, { only: keep.get(r).sort() }));
}

function real(p) { try { return fs.realpathSync.native(p); } catch { return null; } }
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/* The roots of one pack, or a sentence. inputs: backuptick.inputsHere() (sessions, protect, protectIncomplete).
   deps (tests): workerDir(name), profilesDir, stat. */
function rootsFor(names, inputs, deps) {
  const d = deps || {};
  const bt = require('./backuptick');
  if (inputs.protectIncomplete) return { ok: false, because: 'a folder that must never be handed over could not be checked' };
  const protect = [];
  for (const x of inputs.protect || []) {
    if (typeof x !== 'string' || !path.isAbsolute(x)) return { ok: false, because: 'a folder that must never be handed over was not given as a full path' };
    try { protect.push(fs.realpathSync.native(x)); } catch (err) {
      if (!err || err.code !== 'ENOENT') return { ok: false, because: 'a folder that must never be handed over could not be checked' };
    }
  }
  const workerDir = d.workerDir || ((n) => require('./create').workerDir(n));
  const profilesDir = d.profilesDir || require('./store').PROFILES;
  const roots = [];
  for (const name of names) {
    const seg = bt.rootSegment(name);
    if (!seg) return { ok: false, because: `the agent ${name} has a name a pack cannot carry` };
    let dir = null;
    try { dir = workerDir(name); } catch { dir = null; }
    const rd = dir && path.isAbsolute(dir) ? real(dir) : null;
    if (!rd) return { ok: false, because: `the folder of ${name} could not be found` };
    if (protect.some((q) => inside(rd, q) || inside(q, rd))) return { ok: false, because: `the folder of ${name} holds, or is inside, Kosmos's own data or a sign-in folder` };
    roots.push({ name: `agents/${seg}`, path: rd });
    const pd = real(profilesDir);
    if (pd && fs.existsSync(path.join(pd, `${name}.json`))) roots.push({ name: `profiles/${seg}`, path: pd, optional: true, only: [`${name}.json`] });
    let s = [];
    try { s = inputs.sessions ? inputs.sessions(dir, seg, name) : []; } catch { s = []; }
    // A transcript root inside the agent's own folder is already carried there.
    s = (s || []).filter((r) => r && r.only && !(real(r.path) && inside(real(r.path), rd)));
    for (const r of trimSessions(s, SESSION_BYTES, d)) roots.push(r);
  }
  return { ok: true, roots };
}

/* The snapshot input for one part, or a sentence. part: a /mine row. org: the enrolled company's id. */
function packInput(part, org, deps) {
  const d = deps || {};
  const pk = typeof part.seal_pub === 'string' ? Buffer.from(part.seal_pub, 'base64') : null;
  const sealable = (k) => { try { require('./hpke').hpkeSeal(k, Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)); return true; } catch { return false; } };
  // A trial seal (hpke's own rule: 32 bytes, a canonical X25519 point): one that is not would otherwise fail inside the
  // snapshot as "failed unexpectedly".
  if (!pk || pk.length !== 32 || pk.toString('base64') !== part.seal_pub || !sealable(pk)) return { ok: false, because: 'the colleague\'s key for this hand-over is not one this computer can seal to' };
  let rows;
  try { const sv = (d.survey || (() => require('./register').survey()))(); if (!sv || !sv.ok) return { ok: false, retryLater: true, because: (sv && sv.because) || 'the agents on this computer could not be read' }; rows = sv.agents; } catch { return { ok: false, retryLater: true, because: 'the agents on this computer could not be read' }; }
  const names = resolveNames(part.agents, rows);
  if (!names.ok) return names;
  let inputs;
  try { inputs = (d.inputsHere || (() => require('./backuptick').inputsHere()))(); } catch { return { ok: false, retryLater: true, because: 'this computer could not list what to pack' }; }
  const roots = rootsFor(names.names, inputs, d);
  if (!roots.ok) return roots;
  const dk = (d.deviceKey || (() => require('./backupdevicekey').deviceKey()))();
  if (!dk || !dk.ok) return { ok: false, retryLater: !!(dk && dk.retry), because: (dk && dk.because) || 'the device key could not be read' };
  const keys = require('./backupkeys');
  const snap = require('./backupsnapshot');
  const namingKey = keys.newNamingKey();
  return { ok: true, names: names.names, input: {
    roots: roots.roots, memberPk: pk, namingKey, namingKeyId: keys.namingKeyId(namingKey), deviceKey: dk.privateKey,
    ctx: snap.handoverContext(org, part.id), handover: { id: part.id, prefix: `handover/${org}/${part.id}/` },
  } };
}

const PLAIN = /^[A-Za-z0-9_-]{1,64}$/;
/* The parts this computer packs now: side send, state packing, a key to seal to. */
function sendable(data) {
  const rows = data && Array.isArray(data.handovers) ? data.handovers : [];
  return rows.filter((h) => h && h.side === 'send' && h.state === 'packing' && typeof h.seal_pub === 'string' && typeof h.id === 'string' && PLAIN.test(h.id));
}

/* One tick. state: { running, failed: Map id -> { because, key } , packed: Set }. deps (tests): macRequest, org(),
   takeSnapshot, and packInput's. */
async function tick(state, deps) {
  const d = deps || {};
  if (state.running) return { skipped: true };
  state.running = true;
  try {
    const org = (d.org || (() => { const r = require('./orgenroll').readEnrollment(); return require('./orgenroll').isEnrolledHere() && r ? r.org.id : null; }))();
    if (typeof org !== 'string' || !PLAIN.test(org)) return { ok: true, none: true };
    const mac = d.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
    const mine = await mac('POST', MINE_ROUTE, {});
    if (!mine || !mine.ok) return { ok: false, because: (mine && mine.because) || 'Kosmos+ did not answer' };
    // What the leaving member is told (notice): every open part this computer sends, as the company named its agents.
    const rows = mine.data && Array.isArray(mine.data.handovers) ? mine.data.handovers : [];
    state.open = rows.filter((h) => h && h.side === 'send' && typeof h.id === 'string' && PLAIN.test(h.id) && Array.isArray(h.agents))
      .map((h) => ({ id: h.id, agents: h.agents.filter((x) => typeof x === 'string' && x) }));
    for (const part of sendable(mine.data)) {
      const key = `${part.seal_pub}|${(part.agents || []).join('\n')}`;
      const f = state.failed.get(part.id);
      if (f && f.key === key) continue;   // decided already; a changed part is tried again
      if (state.packed.has(part.id)) continue;   // packed in this run; the record moves on its own
      const p = packInput(part, org, d);
      let r = p;
      if (p.ok) {
        const take = d.takeSnapshot || require('./backupsnapshot').takeSnapshot;
        r = await take(p.input, { macRequest: mac });
        if (!r || typeof r !== 'object') r = { ok: false, because: 'the pack failed unexpectedly' };
      }
      if (r.ok) { state.packed.add(part.id); state.failed.delete(part.id); }
      else if (!r.retryLater) state.failed.set(part.id, { key, because: r.because || 'the pack did not finish' });
      return { ok: r.ok === true, id: part.id, because: r.ok ? undefined : r.because };   // one pack per tick
    }
    return { ok: true, none: true };
  } catch {
    return { ok: false, because: 'the hand-over could not be checked' };
  } finally { state.running = false; }
}

/* The board's own timer. Never throws. */
function startTick(deps) {
  const d = deps || {};
  const state = { running: false, failed: new Map(), packed: new Set(), open: [] };
  const run = () => { tick(state, d).catch(() => {}); };
  const t = (d.setInterval || setInterval)(run, d.everyMs || EVERY_MS);
  if (t && typeof t.unref === 'function') t.unref();
  return Object.assign(() => (d.clearInterval || clearInterval)(t), { tick: () => tick(state, d), state });
}

/* Off unless KOSMOS_ORG_HANDOVER=1 is in the board's environment, the same word that turns hand-over on at the
   coordinator: until then no company computer asks /mine every few minutes for a route that is off. */
function enabled(env) { return String(((env || process.env).KOSMOS_ORG_HANDOVER) || '').trim() === '1'; }
let here = null;
function startHere(env) { if (!enabled(env)) return null; if (!here) here = startTick({}); return here; }

/* For the leaving member's screen: the agents moving, and why a pack stopped if one did, or null. Read from the last
   /mine answer, so it is at most one tick old. A notice, not a consent ask: the company decided. */
function notice(state) {
  const st = state || (here && here.state);
  if (!st || !Array.isArray(st.open) || !st.open.length) return null;
  const agents = [...new Set(st.open.flatMap((h) => h.agents))];
  if (!agents.length) return null;
  const failed = st.open.map((h) => st.failed.get(h.id)).find(Boolean);
  return failed ? { agents, stopped: failed.because } : { agents };
}

module.exports = { MINE_ROUTE, SESSION_BYTES, resolveNames, trimSessions, rootsFor, packInput, sendable, tick, startTick, enabled, startHere, notice };
