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
 *   workers/<seg>       the agent's folder (create.workerDir): its instructions and its Files folder. Named under
 *                       `workers` because the receiving computer restores into a Kosmos made by the restore path, whose
 *                       finish moves only `workers` and `projects` into place (restoreworld MOVED). REQUIRED: an
 *                       agent whose folder cannot be read fails the pack, said with its name.
 *   profiles/<seg>      its one profile file, by name (`only`). The successor strips per-install fields (slice 4).
 *   sessions/<seg>/...  its transcripts, from backuptick.inputsHere().sessions (the backup's builder), trimmed to the
 *                       newest files up to SESSION_BYTES per agent. The newest file is always taken, even alone over
 *                       the cap (the snapshot's own MAX_FILE still applies to it).
 *   NOT carried: Antigravity conversations. The backup stages those live SQLite files into Kosmos's own data first
 *   (backuptick.startWorld, backupagy.stageAgy); a pack does not, so an Antigravity agent arrives without them.
 * Never the data root, credentials or provider sign-ins: an agent folder that holds or sits inside one of backuptick's
 * protected folders fails the pack. Two kinds of root are not put through that check, as in backuptick: the one
 * profile file, by name, inside Kosmos's data; and the transcript roots, inside provider homes, whose safety is
 * backupsessions' file lists (session files only). Every file still passes the snapshot's own name and content scans.
 *
 * Names: the hand-over names agents as the company's rollup shows them (a running agent's name, a stopped one's shown
 * name). Each is matched against register.survey() rows with a profile and not removed, by name or shown name; one that
 * matches none, or two different agents, fails the pack with that name in the sentence ("ACT ON name, SPEAK shownAs").
 *
 * Only on a computer that may send to its company (orgenroll.mayReport: enrolled here AND the company's words accepted
 * here), the gate every sender uses.
 *
 * One pack at a time, never two ticks at once. Failures:
 *   final: decided by the part or the coordinator's answer (its names, its key, an agent folder missing, protected or
 *     holding other work, a pack larger than the hand-over allows, a hand-over no longer open), or MAX_ATTEMPTS failed
 *     attempts. Said in this module's own sentence on the screen; tried again only when the part changes.
 *   retryLater (a network refusal, a quota): tried again next tick, and not counted.
 *   any other (a coordinator error, a busy connector, a file that could not be read): tried again after RETRY_MS.
 * Neither of the last two is shown. The attempt count and a final reason are kept on disk (send-<id>.json) for the
 * part they were decided for, so a restart neither forgets nor resets them. Never throws.
 *
 * KNOWN, for slice 4: a pack's agent folders are named `workers/<seg>` (backuptick.rootSegment), which is the agent's
 * name unless that name is not a plain segment (then a cleaned form plus a hash); the receiver names the agent from its
 * brief, as a restore does, not from the folder.
 *
 * KNOWN, kosmos#8733: the colleague's one-time key (seal_pub) reaches this computer from Kosmos+ with nothing that ties
 * it to the colleague's computer, so "only the successor's computer can open the pack" rests on Kosmos+ passing it on
 * faithfully. Hand-over is off everywhere until that is closed.
 *
 * KNOWN, for slice 4: the coordinator moves the record to `packed` when it grants the manifest, before the upload. A
 * manifest upload that then fails leaves a `packed` record with no manifest, and a new pack cannot replace it (a new
 * naming key gives a new hash, and the re-grant is for the same hash only). The receiving computer must end such a
 * hand-over as failed (done {ok:false}) when the manifest is missing, so the company sees it and can start again.
 */
const fs = require('fs');
const path = require('path');

const MINE_ROUTE = '/v1/mac/org/handover/mine';
const SESSION_BYTES = 50 * 1024 * 1024;
const EVERY_MS = 5 * 60 * 1000;
const RETRY_MS = 60 * 60 * 1000;
const MAX_ATTEMPTS = 8;
const MAX_PACK_BYTES = 500 * 1024 * 1024;   // kosmos-relay handover.rs MAX_PACK_BYTES
/* What this computer decided about one part (attempts, a final reason, and the part it was decided for), kept in
   <store.ROOT>/handover/send-<id>.json so a restart neither forgets a final decision nor resets the ceiling. */
function sendFile(id, root) { return path.join(root || require('./store').ROOT, 'handover', `send-${id}.json`); }
function readSend(id, root) { try { const j = JSON.parse(fs.readFileSync(sendFile(id, root), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeSend(id, root, rec) {
  try {
    const f = sendFile(id, root);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec) + '\n', { mode: 0o600 });
    fs.renameSync(tmp, f);
  } catch { /* kept in memory for this run */ }
}
function dropSend(id, root) { try { fs.rmSync(sendFile(id, root), { force: true }); } catch { /* left */ } }
/* Coordinator refusals that no retry can change, each said in this module's own words (never the coordinator's text). */
const FINAL_CODES = {
  handover_too_big: 'the agents are larger than one hand-over can carry',
  handover_wrong_state: 'the hand-over is no longer open',
  handover_not_open: 'the hand-over is no longer open',
  handover_not_yours: 'the hand-over is no longer open',
};

/* The agents for the hand-over's labels, [{ name, label }] (act on name, speak label), or a final sentence.
   rows: register.survey().agents. */
function resolveNames(labels, rows) {
  if (!Array.isArray(labels) || !labels.length || labels.some((x) => typeof x !== 'string' || !x)) return { ok: false, final: true, because: 'the hand-over names no agents' };
  const live = (rows || []).filter((r) => r && r.profile === true && !r.removed && typeof r.name === 'string');
  const names = [];
  for (const label of labels) {
    const hits = [...new Set(live.filter((r) => r.name === label || r.shownAs === label).map((r) => r.name))];
    if (!hits.length) return { ok: false, final: true, because: `there is no agent called ${label} on this computer` };
    if (hits.length > 1) return { ok: false, final: true, because: `more than one agent on this computer is called ${label}` };
    if (!names.some((n) => n.name === hits[0])) names.push({ name: hits[0], label });
  }
  return { ok: true, names };
}

/* Keep the newest session files of one agent, across all its session roots, up to `cap` bytes; the newest is kept even
   alone over it. A file that cannot be read is dropped. Roots left with no files are dropped. */
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
    if (keep.size && used + f.size > cap) continue;   // a smaller older file may still fit
    used += f.size;
    if (!keep.has(f.r)) keep.set(f.r, []);
    keep.get(f.r).push(f.rel);
  }
  return roots.filter((r) => keep.has(r)).map((r) => Object.assign({}, r, { only: keep.get(r).sort() }));
}

function real(p) { try { return fs.realpathSync.native(p); } catch { return null; } }
/* Bytes of the files under a folder (links not followed), or null past MAX_WALK entries. */
const MAX_WALK = 200000;
function folderBytes(dir) {
  let n = 0, bytes = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (++n > MAX_WALK) return null;
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile()) { try { bytes += fs.lstatSync(p).size; } catch { /* gone */ } }
    }
  }
  return bytes;
}
function inside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/* The roots of one pack, or a sentence (`final` when the agent itself decides it). names: resolveNames' [{ name, label }].
   inputs: backuptick.inputsHere() (sessions, protect, protectIncomplete). deps (tests): workerDir(name), profilesDir, stat. */
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
  let total = 0;
  for (const { name, label } of names) {
    const seg = bt.rootSegment(name);
    if (!seg) return { ok: false, final: true, because: `the agent ${label} has a name a pack cannot carry` };
    let dir = null;
    try { dir = workerDir(name); } catch { dir = null; }
    const rd = dir && path.isAbsolute(dir) ? real(dir) : null;
    if (!rd) return { ok: false, final: true, because: `the folder of ${label} could not be found` };
    if (protect.some((q) => inside(rd, q) || inside(q, rd))) return { ok: false, final: true, because: `the folder of ${label} holds, or is inside, Kosmos's own data or a sign-in folder` };
    // Only this agent's own folder (as the backup refuses a root that would hold the workers folder): never one that is
    // or holds the workers or projects folder or a project, nor one that holds, or sits inside, another agent's.
    const roots0 = [inputs.workersDir, inputs.projectsDir, ...(inputs.projects || []).map((p) => p && p.folder)].map((x) => (typeof x === 'string' && path.isAbsolute(x) ? real(x) : null)).filter(Boolean);
    const others = (inputs.agents || []).filter((a) => a && a.id !== name && typeof a.dir === 'string' && path.isAbsolute(a.dir)).map((a) => real(a.dir)).filter(Boolean);
    if (roots0.some((q) => inside(q, rd)) || others.some((q) => inside(q, rd) || inside(rd, q))) {
      return { ok: false, final: true, because: `the folder of ${label} holds other work (the workers or projects folder, or another agent's), so it is not handed over` };
    }
    const size = folderBytes(rd);
    if (size === null) return { ok: false, final: true, because: `the folder of ${label} holds more files than one hand-over can carry` };
    total += size;
    roots.push({ name: `workers/${seg}`, path: rd });
    const pd = real(profilesDir);
    if (pd && fs.existsSync(path.join(pd, `${name}.json`))) roots.push({ name: `profiles/${seg}`, path: pd, optional: true, only: [`${name}.json`] });
    let s = [];
    try { s = inputs.sessions ? inputs.sessions(dir, seg, name) : []; } catch { s = []; }
    // A transcript root inside the agent's own folder is already carried there.
    s = (s || []).filter((r) => r && r.only && !(real(r.path) && inside(real(r.path), rd)));
    for (const r of trimSessions(s, SESSION_BYTES, d)) {
      for (const rel of r.only || []) { try { total += fs.statSync(path.join(r.path, rel)).size; } catch { /* gone */ } }
      roots.push(r);
    }
  }
  // Raw sizes: nothing is compressed, so a pack larger than this is larger once sealed (only duplicate files shrink it).
  if (total > (Number.isSafeInteger(d.maxPackBytes) ? d.maxPackBytes : MAX_PACK_BYTES)) return { ok: false, final: true, because: 'the agents are larger than one hand-over can carry' };
  return { ok: true, roots };
}

/* The snapshot input for one part, or a sentence. part: a /mine row. org: the enrolled company's id. */
function packInput(part, org, deps) {
  const d = deps || {};
  const pk = typeof part.seal_pub === 'string' ? Buffer.from(part.seal_pub, 'base64') : null;
  const sealable = (k) => { try { require('./hpke').hpkeSeal(k, Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)); return true; } catch { return false; } };
  // A trial seal (hpke's own rule: 32 bytes, a canonical X25519 point): one that is not would otherwise fail inside the
  // snapshot as "failed unexpectedly".
  if (!pk || pk.length !== 32 || pk.toString('base64') !== part.seal_pub || !sealable(pk)) return { ok: false, final: true, because: 'the colleague\'s key for this hand-over is not one this computer can seal to' };
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
  return { ok: true, names: names.names.map((n) => n.name), input: {
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

/* One tick. state: { running, failed: Map id -> { because, key }, retryAt: Map id -> ms, attempts: Map id -> n,
   packed: Set, open }. deps
   (tests): macRequest, org(), now(), takeSnapshot, and packInput's. */
async function tick(state, deps) {
  const d = deps || {};
  if (state.running) return { skipped: true };
  state.running = true;
  try {
    const org = (d.org || (() => { const oe = require('./orgenroll'); const r = oe.mayReport() ? oe.readEnrollment() : null; return r && r.org ? r.org.id : null; }))();
    const now = (d.now || Date.now)();
    if (typeof org !== 'string' || !PLAIN.test(org)) { state.open = []; return { ok: true, none: true }; }
    const mac = d.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
    const mine = await mac('POST', MINE_ROUTE, {});
    if (!mine || !mine.ok) return { ok: false, because: (mine && mine.because) || 'Kosmos+ did not answer' };
    // What the leaving member is told (notice): every open part this computer sends, as the company named its agents.
    const rows = mine.data && Array.isArray(mine.data.handovers) ? mine.data.handovers : [];
    state.open = rows.filter((h) => h && h.side === 'send' && typeof h.id === 'string' && PLAIN.test(h.id) && Array.isArray(h.agents))
      .map((h) => ({ id: h.id, agents: h.agents.filter((x) => typeof x === 'string' && x) }));
    for (const part of sendable(mine.data)) {
      const key = `${part.seal_pub}|${(part.agents || []).join('\n')}`;
      // What an earlier run decided, kept on disk; a changed part (a new key, other agents) starts again.
      if (!state.loaded.has(part.id)) {
        state.loaded.add(part.id);
        const rec = readSend(part.id, d.root);
        if (rec.key === key) {
          if (Number.isSafeInteger(rec.attempts)) state.attempts.set(part.id, rec.attempts);
          if (typeof rec.final === 'string') state.failed.set(part.id, { key, because: rec.final });
        }
      }
      const f = state.failed.get(part.id);
      if (f && f.key === key) continue;   // decided already; a changed part is tried again
      if (f) { state.failed.delete(part.id); state.attempts.delete(part.id); dropSend(part.id, d.root); }
      if (state.packed.has(part.id)) continue;   // packed in this run; the record moves on its own
      if ((state.retryAt.get(part.id) || 0) > now) continue;
      const p = packInput(part, org, d);
      let r = p;
      if (p.ok) {
        const take = d.takeSnapshot || require('./backupsnapshot').takeSnapshot;
        r = await take(p.input, { macRequest: mac });
        if (!r || typeof r !== 'object') r = { ok: false, because: 'the pack failed unexpectedly' };
      }
      state.retryAt.delete(part.id);
      if (r.ok) { state.packed.add(part.id); state.failed.delete(part.id); state.attempts.delete(part.id); dropSend(part.id, d.root); }
      else {
        // A network refusal or a quota (retryLater) is not the pack's: tried next tick, not counted.
        const tries = (state.attempts.get(part.id) || 0) + (r.retryLater ? 0 : 1);
        state.attempts.set(part.id, tries);
        const code = r.code || require('./backupupload').refusalOf(r.because).code;
        // Every grant counts against the pack's cap on the coordinator and a new try uploads again, so "too big" after a
        // try that uploaded is the earlier try's bytes, not the agents' size.
        let said = FINAL_CODES[code];
        if (code === 'handover_too_big' && tries > 1) said = 'an earlier try used up the room Kosmos+ keeps for this hand-over; your company can start the hand-over again';
        let final = null;
        if (r.final || said) final = said || r.because || 'the pack did not finish';
        else if (tries >= MAX_ATTEMPTS) final = `Kosmos tried ${tries} times and could not finish the pack; your company can start the hand-over again`;
        else if (!r.retryLater) state.retryAt.set(part.id, now + RETRY_MS);
        if (final) state.failed.set(part.id, { key, because: final });
        writeSend(part.id, d.root, Object.assign({ key, attempts: tries }, final ? { final } : {}));
      }
      return { ok: r.ok === true, id: part.id, because: r.ok ? undefined : r.because };   // one pack per tick
    }
    return { ok: true, none: true };
  } catch {
    state.open = [];   // nothing known: say nothing rather than an old line
    return { ok: false, because: 'the hand-over could not be checked' };
  } finally { state.running = false; }
}

/* The board's own timer. Never throws. */
function startTick(deps) {
  const d = deps || {};
  const state = { running: false, failed: new Map(), retryAt: new Map(), attempts: new Map(), packed: new Set(), loaded: new Set(), open: [] };
  const run = () => { tick(state, d).catch(() => {}); };
  const t = (d.setInterval || setInterval)(run, d.everyMs || EVERY_MS);
  if (t && typeof t.unref === 'function') t.unref();
  return Object.assign(() => (d.clearInterval || clearInterval)(t), { tick: () => tick(state, d), state });
}

/* Off unless KOSMOS_ORG_HANDOVER=1 is in the BOARD's environment. The coordinator has its own switch of the same name in
   its own environment; the two are set separately, and until this one is set no company computer asks /mine every few
   minutes. */
function enabled(env) { return String(((env || process.env).KOSMOS_ORG_HANDOVER) || '').trim() === '1'; }
let here = null;
function startHere(env) { if (!enabled(env)) return null; if (!here) here = startTick({}); return here; }

/* For the leaving member's screen: the agents moving, and why a pack stopped if one did (a `final` failure only: its
   sentence is this module's own, never a coordinator's text), or null. Read from the last /mine answer, so it is at most
   one tick old. A notice, not a consent ask: the company decided. */
function notice(state) {
  const st = state || (here && here.state);
  if (!st || !Array.isArray(st.open) || !st.open.length) return null;
  const agents = [...new Set(st.open.flatMap((h) => h.agents))];
  if (!agents.length) return null;
  const failed = st.open.map((h) => st.failed.get(h.id)).find(Boolean);
  return failed ? { agents, stopped: failed.because } : { agents };
}

module.exports = { MINE_ROUTE, SESSION_BYTES, RETRY_MS, MAX_ATTEMPTS, resolveNames, trimSessions, rootsFor, packInput, sendable, tick, startTick, enabled, startHere, notice };
