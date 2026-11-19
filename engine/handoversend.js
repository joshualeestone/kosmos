'use strict';
/**
 * kosmos#8710 slice 3: the leaving member's computer packs the agents a company hands over to a colleague.
 *
 * The coordinator (kosmos-relay, slice 2) records a hand-over: which member leaves, who takes the agents, and the
 * agents by name. Once the successor's computer has made a one-time key and sent its public half (seal_pub), this
 * computer's part reads `packing`. tick() then packs: each named agent's folder, its memory notes and its recent
 * transcripts (never its profile: below), sealed to seal_pub, signed with this computer's device key, uploaded under handover/<org>/<id>/ through
 * the hand-over grant and manifest routes (backupsnapshot input.handover). The manifest step moves the record to
 * `packed`; nothing here has to say so.
 *
 * What a pack carries, per agent (root names use backuptick.rootSegment of the agent's machine name):
 *   workers/<seg>       the agent's folder (create.workerDir): its instructions and its Files folder. Named under
 *                       `workers` because the receiving computer restores into a Kosmos made by the restore path, whose
 *                       finish moves only `workers` and `projects` into place (restoreworld MOVED). REQUIRED: an
 *                       agent whose folder cannot be read fails the pack, said with its name.
 *   NOT its profile file: that holds this install's own id and absolute paths under the member's home, which a
 *                       profile never takes off this computer (store.js, kosmos#5995). The receiver names an agent from
 *                       its folder and brief, as a restore does.
 *   sessions/<seg>/...  its transcripts, from backuptick.inputsHere().sessions (the backup's builder), trimmed to the
 *                       files up to SESSION_BYTES per agent: its memory notes first, whatever their age, then the
 *                       newest transcripts that fit. The first file is taken even alone over the cap (the snapshot's own
 *                       MAX_FILE still applies to it).
 *   NOT carried: Antigravity conversations. The backup stages those live SQLite files into Kosmos's own data first
 *   (backuptick.startWorld, backupagy.stageAgy); a pack does not, so an Antigravity agent arrives without them.
 * Never the data root, credentials or provider sign-ins: an agent folder that holds or sits inside one of backuptick's
 * protected folders fails the pack. One kind of root is not put through that check, as in backuptick: the transcript
 * roots, inside provider homes, whose safety is backupsessions' file lists (session files only). Every file still passes the snapshot's own name and content scans.
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
 *   retryLater (a network refusal, a quota): not counted as an attempt; tried again after SOFT_RETRY_MS, and final after
 *     MAX_SOFT of them in a row. The key check's own waits (kosmos#8733: escrowd not reachable, an enrolment not
 *     finished) are counted apart (tieSoft, kept on disk), final after MAX_TIE_SOFT, and reset once the key checks out.
 *   any other (a coordinator error, a busy connector, a file that could not be read): tried again after RETRY_MS.
 * Neither of the last two is shown. The attempt count and a final reason are kept on disk (send-<id>.json) for the
 * part they were decided for, so a restart neither forgets nor resets them (the back-off wait itself is not kept: a
 * restart tries once at once). Never throws.
 *
 * KNOWN: every try packs and uploads the whole pack (a hand-over keeps no index), and the coordinator counts every
 * granted byte against the pack's 500 MB cap. So for a pack over about half the cap, a try interrupted after its
 * uploads leaves too little room for another: it ends with "an earlier try used up the room", and the company starts
 * the hand-over again.
 *
 * KNOWN, for slice 4: a pack's agent folders are named `workers/<seg>` (backuptick.rootSegment), which is the agent's
 * name unless that name is not a plain segment (then a cleaned form plus a hash); the receiver names the agent from its
 * brief, as a restore does, not from the folder.
 *
 * kosmos#8733: the colleague's one-time key (seal_pub) is packed to only when handoverseal.checkSeal holds: the
 * colleague's computer signed it (seal_sig) with a device key (seal_signer) that escrowd's signed history for the
 * colleague (seal_history, seal_member) lists as theirs now, enrolled by two admins.
 * KNOWN, kosmos#8764: WHICH member the colleague is (seal_member) is still Kosmos+'s word, so a breached Kosmos+ could
 * name another enrolled member. Hand-over is off everywhere until that is closed.
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
const SOFT_RETRY_MS = 15 * 60 * 1000;   // a retryLater (a network refusal, a quota) waits this long
const MAX_SOFT = 24;                     // ... and this many in a row (six hours) is final
const MAX_TIE_SOFT = 96;                 // kosmos#8733: the key check's waits (an enrolment two admins finish): a day
const MAX_PACK_BYTES = 500 * 1024 * 1024;   // kosmos-relay handover.rs MAX_PACK_BYTES
/* What this computer decided about one part (attempts, the retryLater run, a final reason, and the part it was decided
   for), kept in
   <store.ROOT>/handover/send-<id>.json so a restart neither forgets a final decision nor resets the ceiling. */
function sendFile(id, root) { return path.join(root || require('./store').ROOT, 'handover', `send-${id}.json`); }
function readSend(id, root) { try { const j = JSON.parse(fs.readFileSync(sendFile(id, root), 'utf8')); return j && typeof j === 'object' ? j : {}; } catch { return {}; } }
function writeSend(id, root, rec) {
  try {
    const f = sendFile(id, root);
    fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
    require('./store').saveFlushed(f, Buffer.from(JSON.stringify(rec) + '\n'));   // whole, flushed, renamed (#8718)
  } catch { /* kept in memory for this run */ }
}
function dropSend(id, root) { try { fs.rmSync(sendFile(id, root), { force: true }); } catch { /* left */ } }
/* A decision file whose hand-over Kosmos+ no longer lists, a day after it was last written: removed. */
function sweepSends(open, now, root) {
  const dir = path.dirname(sendFile('x', root));
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return; }
  for (const n of names) {
    const m = /^send-([A-Za-z0-9_-]{1,64})\.json$/.exec(n);
    if (!m || open.has(m[1])) continue;
    try { const st = fs.lstatSync(path.join(dir, n)); if (st.isFile() && now - st.mtimeMs >= 24 * 60 * 60 * 1000) fs.rmSync(path.join(dir, n), { force: true }); } catch { /* left */ }
  }
}
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
    if (!hits.length) return { ok: false, because: `there is no agent called ${label} on this computer` };   // may be mid-rename: an ordinary try
    if (hits.length > 1) return { ok: false, final: true, because: `more than one agent on this computer is called ${label}` };
    if (!names.some((n) => n.name === hits[0])) names.push({ name: hits[0], label });
  }
  return { ok: true, names };
}

/* Keep one agent's memory notes, then its newest session files, across all its session roots, up to `cap` bytes; the
   first file is kept even alone over it. A file that cannot be read is dropped. Roots left with no files are dropped. */
function trimSessions(roots, cap, deps) {
  const stat = (deps && deps.stat) || ((p) => fs.statSync(p));
  const all = [];
  for (const r of roots) for (const rel of r.only || []) {
    try { const s = stat(path.join(r.path, rel)); if (s.isFile()) all.push({ r, rel, size: s.size, mtime: s.mtimeMs }); } catch { /* gone */ }
  }
  // The agent's memory notes (backupsessions lists them as memory/...) first, whatever their age: they are what the
  // colleague most needs, and they are usually older than the recent transcripts. Then the newest transcripts.
  const mem = (f) => (f.rel === 'memory' || f.rel.startsWith('memory/') ? 0 : 1);
  all.sort((a, b) => mem(a) - mem(b) || b.mtime - a.mtime || (a.rel < b.rel ? -1 : 1));
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
   inputs: backuptick.inputsHere() (sessions, protect, protectIncomplete). deps (tests): workerDir(name), stat. */
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
  const roots = [];
  let total = 0;
  for (const { name, label } of names) {
    const seg = bt.rootSegment(name);
    if (!seg) return { ok: false, final: true, because: `the agent ${label} has a name a pack cannot carry` };
    let dir = null;
    try { dir = workerDir(name); } catch { dir = null; }
    const rd = dir && path.isAbsolute(dir) ? real(dir) : null;
    if (!rd) return { ok: false, because: `the folder of ${label} could not be found` };   // an unmounted disk, a denied folder: an ordinary try
    if (protect.some((q) => inside(rd, q) || inside(q, rd))) return { ok: false, final: true, because: `the folder of ${label} holds, or is inside, Kosmos's own data or a sign-in folder` };
    // Only this agent's own folder (as the backup refuses a root that would hold the workers folder): never one that is
    // or holds the workers or projects folder or a project, nor one that holds, or sits inside, another agent's.
    const roots0 = [inputs.workersDir, inputs.projectsDir, ...(inputs.projects || []).map((p) => p && p.folder)].map((x) => (typeof x === 'string' && path.isAbsolute(x) ? real(x) : null)).filter(Boolean);
    const others = (inputs.agents || []).filter((a) => a && a.id !== name && typeof a.dir === 'string' && path.isAbsolute(a.dir)).map((a) => real(a.dir)).filter(Boolean);
    if (roots0.some((q) => inside(q, rd)) || others.some((q) => inside(q, rd) || inside(rd, q))) {
      return { ok: false, final: true, because: `the folder of ${label} holds other work (the workers or projects folder, or another agent's), so it is not handed over` };
    }
    // kosmos#8738: the folder must be the one this agent is registered with (backuptick.inputsHere agents), not only
    // wherever workerDir resolves. Checked whenever the list is given (it always is outside tests).
    if (Array.isArray(inputs.agents)) {
      const mine = inputs.agents.find((a) => a && a.id === name && typeof a.dir === 'string' && path.isAbsolute(a.dir));
      if (!mine) return { ok: false, because: `the folder of ${label} is not one this computer has registered for it` };
      if (real(mine.dir) !== rd) return { ok: false, final: true, because: `the folder of ${label} is not the one it was set up with, so it is not handed over` };
    }
    const size = folderBytes(rd);
    if (size === null) return { ok: false, final: true, because: `the folder of ${label} holds more files than one hand-over can carry` };
    total += size;
    roots.push({ name: `workers/${seg}`, path: rd });
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
  if (!pk || pk.length !== 32 || pk.toString('base64') !== part.seal_pub || !sealable(pk)) return { ok: false, final: true, because: 'the key for this hand-over is not one this computer can seal to' };
  // kosmos#8733: never seal to a key only Kosmos+ vouches for. The successor's computer signed it with its device key,
  // and that key must be one escrowd's signed history lists for the successor, enrolled by two admins. No history
  // (escrowd could not be asked), a stale history or an enrolment not finished yet (checkSeal's wait) is tried again as
  // a retryLater, bounded by MAX_TIE_SOFT; any other refusal is final. Nothing is packed either way. Every answer after
  // the check carries tieOk, so the tick ends a run of the check's waits even when a later step then fails (review 4).
  const nowSec = Math.floor(((d.now || Date.now)()) / 1000);
  const tie = require('./handoverseal').checkSeal({ org, member: part.seal_member, id: part.id, sealPub: part.seal_pub, sig: part.seal_sig, signer: part.seal_signer, history: part.seal_history, now: nowSec });
  if (!tie.ok) return tie.wait ? { ok: false, retryLater: true, tieWait: true, because: tie.because } : { ok: false, final: true, because: tie.because };
  return Object.assign(packAfterTie(part, org, d, pk), { tieOk: true });
}
/* packInput past the key check: the agents, their folders and the device key. */
function packAfterTie(part, org, d, pk) {
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
  // kosmos#8738: a tick that threw (a step documented never to) waits RETRY_MS before the next, never every tick.
  if ((state.thrownUntil || 0) > (d.now || Date.now)()) return { ok: false, because: 'the hand-over could not be checked' };
  state.running = true;
  try {
    const org = (d.org || (() => { const oe = require('./orgenroll'); const r = oe.mayReport() ? oe.readEnrollment() : null; return r && r.org ? r.org.id : null; }))();
    const now = (d.now || Date.now)();
    if (typeof org !== 'string' || !PLAIN.test(org)) { state.open = []; return { ok: true, none: true }; }
    const mac = d.macRequest || ((m, r, b) => require('./remote').macRequest(m, r, b));
    const mine = await mac('POST', MINE_ROUTE, {});
    if (!mine || !mine.ok) { state.open = []; return { ok: false, because: (mine && mine.because) || 'Kosmos+ did not answer' }; }   // nothing known: say nothing rather than an old line
    sweepSends(new Set((mine.data && Array.isArray(mine.data.handovers) ? mine.data.handovers : []).map((h) => h && h.id)), now, d.root);
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
          if (Number.isSafeInteger(rec.soft)) state.soft.set(part.id, rec.soft);
          if (Number.isSafeInteger(rec.tieSoft)) state.tieSoft.set(part.id, rec.tieSoft);
          if (rec.spent === true) state.spent.add(part.id);
          if (rec.inflight === true) {   // the board stopped during a try: count it, and its bytes may be on the coordinator
            state.attempts.set(part.id, (state.attempts.get(part.id) || 0) + 1);
            state.spent.add(part.id);
          }
          if (typeof rec.final === 'string') state.failed.set(part.id, { key, because: rec.final });
        }
      }
      const f = state.failed.get(part.id);
      if (f && f.key === key) continue;   // decided already; a changed part is tried again
      if (f) { state.failed.delete(part.id); state.attempts.delete(part.id); state.soft.delete(part.id); state.tieSoft.delete(part.id); state.spent.delete(part.id); dropSend(part.id, d.root); }
      if (state.packed.has(part.id)) continue;   // packed in this run; the record moves on its own
      if ((state.retryAt.get(part.id) || 0) > now) continue;
      const p = packInput(part, org, d);
      // The key checked out (checkSeal), so the run of its waits (an enrolment, escrowd) is over, whatever the steps
      // after it then say. Those waits have their own count (tieSoft, kept on disk): the network or quota run (soft) is
      // never reset by them, nor they by it.
      if (p.tieOk) state.tieSoft.delete(part.id);
      let r = p;
      if (p.ok) {
        const take = d.takeSnapshot || require('./backupsnapshot').takeSnapshot;
        // Noted before the upload: a board that quits part way leaves `inflight`, which the next run reads as a try that
        // counted and may have been granted bytes (it cannot know it was not).
        writeSend(part.id, d.root, { key, attempts: state.attempts.get(part.id) || 0, soft: state.soft.get(part.id) || 0, tieSoft: 0, spent: state.spent.has(part.id), inflight: true });
        r = await take(p.input, { macRequest: mac });
        if (!r || typeof r !== 'object') r = { ok: false, because: 'the pack failed unexpectedly' };
      }
      state.retryAt.delete(part.id);
      if (r.ok) { state.packed.add(part.id); state.failed.delete(part.id); state.attempts.delete(part.id); state.soft.delete(part.id); state.tieSoft.delete(part.id); dropSend(part.id, d.root); }
      else {
        const grantedNow = !!(r.added && r.added.size) || r.grantSpent === true;
        // A network refusal or a quota (retryLater) is not the pack's: tried next tick, not counted.
        const tries = (state.attempts.get(part.id) || 0) + (r.retryLater ? 0 : 1);
        if (!r.retryLater) state.soft.delete(part.id);   // the retryLater run is IN A ROW: a counted failure ends it
        state.attempts.set(part.id, tries);
        const code = r.code || require('./backupupload').refusalOf(r.because).code;
        // Every grant counts against the pack's cap on the coordinator and a new try uploads again, so "too big" after a
        // try that uploaded is the earlier try's bytes, not the agents' size.
        let said = FINAL_CODES[code];
        // `spent`: an earlier try was granted bytes (kept on disk), counted or not, so the cap may hold its uploads.
        // "No longer open" after an earlier try was granted bytes is most likely that try's manifest grant having moved the
        // record to packed before its upload landed (the KNOWN note in the header): say so, not that the hand-over closed.
        if (code === 'handover_wrong_state' && state.spent.has(part.id)) said = 'an earlier try may have left the pack half sent; your company can cancel this hand-over and start a new one';
        if (code === 'handover_too_big' && state.spent.has(part.id)) said = 'an earlier try used up the room Kosmos+ keeps for this hand-over; your company can cancel this hand-over and start a new one';
        let final = null;
        if (r.final || said) final = said || r.because || 'the pack did not finish';
        else if (tries >= MAX_ATTEMPTS) final = `Kosmos tried ${tries} times and could not finish the pack; your company can cancel this hand-over and start a new one`;
        else if (r.retryLater && r.tieWait) {
          // kosmos#8733: the key could not be checked yet. Its own count, MAX_TIE_SOFT in a row (a day, as the receiver's
          // wait for the same cause), reset only when the key checks out; it leaves the network run alone.
          const ts = (state.tieSoft.get(part.id) || 0) + 1;
          state.tieSoft.set(part.id, ts);
          if (ts >= MAX_TIE_SOFT) final = `${r.because}, and that did not change for a day; your company can cancel this hand-over and start a new one`;
          else state.retryAt.set(part.id, now + SOFT_RETRY_MS);
        } else if (r.retryLater) {
          // Not counted as an attempt, but not every tick for ever: backed off, and final past MAX_SOFT in a row.
          const soft = (state.soft.get(part.id) || 0) + 1;
          state.soft.set(part.id, soft);
          if (soft >= MAX_SOFT) final = 'Kosmos+ kept asking this computer to wait, so the pack did not finish; your company can cancel this hand-over and start a new one';
          else state.retryAt.set(part.id, now + SOFT_RETRY_MS);
        } else state.retryAt.set(part.id, now + RETRY_MS);
        if (final) state.failed.set(part.id, { key, because: final });
        if (grantedNow) state.spent.add(part.id);
        writeSend(part.id, d.root, Object.assign({ key, attempts: tries, soft: state.soft.get(part.id) || 0, tieSoft: state.tieSoft.get(part.id) || 0, spent: state.spent.has(part.id) }, final ? { final } : {}));
      }
      return { ok: r.ok === true, id: part.id, because: r.ok ? undefined : r.because };   // one pack per tick
    }
    return { ok: true, none: true };
  } catch {
    state.open = [];   // nothing known: say nothing rather than an old line
    state.thrownUntil = (d.now || Date.now)() + RETRY_MS;
    return { ok: false, because: 'the hand-over could not be checked' };
  } finally { state.running = false; }
}

function newSendState() { return { running: false, failed: new Map(), retryAt: new Map(), attempts: new Map(), soft: new Map(), tieSoft: new Map(), spent: new Set(), packed: new Set(), loaded: new Set(), open: [] }; }

/* The board's own timer. Never throws. */
function startTick(deps) {
  const d = deps || {};
  const state = newSendState();
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

module.exports = { sweepSends, newSendState, MAX_SOFT, MAX_TIE_SOFT, SOFT_RETRY_MS, MINE_ROUTE, SESSION_BYTES, RETRY_MS, MAX_ATTEMPTS, resolveNames, trimSessions, rootsFor, packInput, sendable, tick, startTick, enabled, startHere, notice };
