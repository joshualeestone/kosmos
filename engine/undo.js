'use strict';

/**
 * #5153 slice 4: undo a closed task's file changes (the recommended call on the card, 2026-10-03; Josh can override).
 *
 * 🔑 KOSMOS'S OWN COPY, TAKEN JUST BEFORE AN EDIT. While the switch is on, the report hook asks the board to keep a
 * copy of a file just before a Kosmos agent's Claude session edits it (keep()). A closed task's undo puts each file the
 * agent edited during the task back to the copy kept before its first edit in that task. Claude Code's own rewind
 * backups were measured and rejected: undocumented, and each is a file at some turn of the conversation, not "before
 * this edit".
 *
 * 🛑 WHAT IT NEVER DOES (review 1 found the first version could write through a link: never again)
 *   - delete a file: one the agent created is MOVED into Kosmos's own folder;
 *   - write through a link, into a folder, or where the file's folder now resolves somewhere else: the file must still
 *     be a plain file (or absent) in the same real folder, and the copy is written beside it then renamed into place;
 *   - overwrite without saving the current version first;
 *   - touch a file changed or deleted after the task closed, or one with no copy;
 *   - keep copies of anything but a Kosmos agent's own sessions (never the person's own Claude sessions);
 *   - act on its own: plan() lists, the person chooses, apply() redoes the plan and does only what is chosen and safe.
 * A file whose history the copies cannot vouch for is marked, not offered as "before this task": the switch turned on
 * after the agent began, the same agent's other task overlapping, another agent's edit meanwhile.
 *
 * STORAGE (review 1): copies are content-addressed blobs (one per distinct content) plus one index line per keep, all
 * under store.ROOT/undo, folders 0700 and files 0600. Turning the switch off deletes them; a sweep drops what is older
 * than KEEP_DAYS at board start and at most daily. A file over MAX_BYTES gets no copy.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const taskchat = require('./taskchat');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_DAYS = 30;
const CHANGED_SLACK_MS = 2000;   // a write in the same moment as the close is the agent's own last edit
const SESSIONS_TTL_MS = 60 * 1000;

const dir = () => path.join(store.ROOT, 'undo');
const switchFile = () => path.join(store.ROOT, 'undo.json');
const blobsDir = () => path.join(dir(), 'blobs');
const indexFile = () => path.join(dir(), 'index.jsonl');
/* What an undo saved or moved aside lives OUTSIDE dir(): turning the switch off or the sweep never touches it (review 2:
   it held the person's files, and "nothing is deleted" has to stay true). */
const savedRoot = () => path.join(store.ROOT, 'undo-saved');
const mkdirPrivate = (d) => { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); try { fs.chmodSync(d, 0o700); } catch { /* best effort */ } };
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** The switch: { on, ok, since }. No file is OFF; a file that cannot be read is OFF with ok false. */
function read() {
  let raw;
  try { raw = fs.readFileSync(switchFile(), 'utf8'); } catch (err) { return { on: false, ok: !err || err.code === 'ENOENT', since: null }; }
  try { const v = JSON.parse(raw); return { on: v && v.on === true, ok: true, since: v && v.on === true && typeof v.since === 'string' ? v.since : null }; }
  catch { return { on: false, ok: false, since: null }; }
}
/* Turning it on records when (a hold that began earlier has no copies from before it); turning it off deletes every
   copy kept, so "off" means nothing of the person's files is held. */
function setOn(on, now = Date.now()) {
  fs.mkdirSync(store.ROOT, { recursive: true });
  const was = read();
  const since = on === true ? (was.on && was.since ? was.since : new Date(now).toISOString()) : null;
  const tmp = switchFile() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ on: on === true, ...(since ? { since } : {}) }));
  fs.renameSync(tmp, switchFile());
  if (on !== true) { try { fs.rmSync(dir(), { recursive: true, force: true }); } catch { /* the sweep tries again */ } }
  return read();
}

/* ---- whose session is this: only a Kosmos agent's own Claude sessions get copies ---- */
let sessionsCache = { at: 0, byAgent: new Map(), folders: new Map() };
function agentSessions(now = Date.now()) {
  if (sessionsCache.at && now - sessionsCache.at < SESSIONS_TTL_MS) return sessionsCache;
  const byAgent = new Map();
  const folders = new Map();
  try {
    const known = require('./register').known();
    const create = require('./create');
    const { canonicalOnDisk } = require('./trust');
    const { configRoots } = require('./status');
    for (const name of known.ok ? known.names : []) {
      let folder;
      try { folder = canonicalOnDisk(create.workerDir(name)); } catch { continue; }
      folders.set(name, folder);
      const ids = new Set();
      const flats = [...new Set([folder, create.workerDir(name)].map((p) => String(p).replace(/[^A-Za-z0-9]/g, '-')))];
      for (const root of configRoots()) for (const flat of flats) {
        let names = [];
        try { names = fs.readdirSync(path.join(root, 'projects', flat)); } catch { continue; }
        for (const n of names) if (n.endsWith('.jsonl')) ids.add(n.slice(0, -6));
      }
      byAgent.set(name, ids);
    }
  } catch { /* nobody known: nothing is kept */ }
  sessionsCache = { at: now, byAgent, folders };
  return sessionsCache;
}
function ownerOf(cwd, session, now) {
  const { byAgent, folders } = agentSessions(now);
  const { canonicalOnDisk } = require('./trust');
  let canon = '';
  try { canon = cwd ? canonicalOnDisk(cwd) : ''; } catch { canon = ''; }
  for (const [name, ids] of byAgent) if (session && ids.has(session)) return name;
  /* By folder too: an agent's session whose transcript is not on disk yet. A person running Claude by hand IN an
     agent's own folder is taken for that agent (review 3: noted, copies stay private and local). */
  for (const [name, folder] of folders) if (canon && canon === folder) return name;
  return null;
}
let lastSweep = 0;
function resetForTests() { sessionsCache = { at: 0, byAgent: new Map(), folders: new Map() }; lastSweep = 0; }

/* ---- the index: one line per copy kept ---- */
function readIndex() {
  let raw = '';
  try { raw = fs.readFileSync(indexFile(), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      const r = JSON.parse(line);
      const at = Date.parse(r && r.at);
      if (r && typeof r.path === 'string' && typeof r.id === 'string' && Number.isFinite(at)) out.push({ ...r, atMs: at });
    } catch { /* a torn line is skipped */ }
  }
  return out;
}

/**
 * Keep a copy of `file` as it is now, just before an edit. Never throws. { kept, because? }. A missing file is
 * recorded as not existing (an undo then moves the created file aside). Not kept: switch off, a path that is not
 * absolute or carries control characters, a session or folder that is not a Kosmos agent's, a link, a folder, a file
 * over MAX_BYTES.
 */
function keep(file, { cwd = '', session = '', now = Date.now(), onlyFor = null } = {}) {
  try {
    const sw = read();
    if (!sw.on) return { kept: false, because: 'off' };
    if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/.test(file)) return { kept: false, because: 'not-absolute' };
    let who = ownerOf(String(cwd || ''), String(session || ''), now);
    /* A session that started after the last look (an agent just restarted) is looked for again, at most every 5 s. */
    if (!who && now - sessionsCache.at > 5000) { sessionsCache.at = 0; who = ownerOf(String(cwd || ''), String(session || ''), now); }
    if (!who) return { kept: false, because: 'not-an-agent' };
    /* Baron's review: a caller on an agent token alone (server.js agentTokenOnlyCaller) keeps copies for its OWN sessions
       only: its exact name, or its store key for an older token that carries only the key. */
    if (onlyFor && typeof onlyFor === 'object') {
      let mine = false;
      try { mine = onlyFor.byKey ? require('./store').safeKey(who) === onlyFor.key : who === onlyFor.name; } catch { mine = false; }
      if (!mine) return { kept: false, because: 'not-yours' };
    }
    const abs = path.resolve(file);
    let st = null;
    try { st = fs.lstatSync(abs); } catch (err) { if (err.code !== 'ENOENT') return { kept: false, because: 'unreadable' }; }
    if (st && st.isSymbolicLink()) return { kept: false, because: 'link' };
    if (st && !st.isFile()) return { kept: false, because: 'not-a-file' };
    if (st && st.size > MAX_BYTES) return { kept: false, because: 'too-large' };
    let dirReal = '';
    try { dirReal = fs.realpathSync(path.dirname(abs)); } catch { dirReal = ''; }
    mkdirPrivate(blobsDir());
    let hash = null;
    if (st) {
      const buf = fs.readFileSync(abs);
      hash = sha(buf);
      const blob = path.join(blobsDir(), hash);
      if (!fs.existsSync(blob)) { fs.writeFileSync(blob + '.tmp', buf, { mode: 0o600 }); fs.renameSync(blob + '.tmp', blob); }
    }
    const rec = { id: String(now).padStart(14, '0') + '-' + crypto.randomBytes(4).toString('hex'), path: abs, existed: Boolean(st),
      hash, at: new Date(now).toISOString(), agent: who, cwd: String(cwd || ''), session: String(session || ''),
      mode: st ? st.mode & 0o7777 : null, dirReal, mtimeMs: st ? st.mtimeMs : null };
    /* A torn last line (a crash mid-append) must not swallow this one too (review 2). */
    let lead = '';
    try { const fd = fs.openSync(indexFile(), 'r'); const size = fs.fstatSync(fd).size; const b = Buffer.alloc(1);
      if (size) { fs.readSync(fd, b, 0, 1, size - 1); if (b[0] !== 10) lead = '\n'; } fs.closeSync(fd); } catch { /* no index yet */ }
    fs.appendFileSync(indexFile(), lead + JSON.stringify(rec) + '\n', { mode: 0o600 });
    maybeSweep(now);
    return { kept: true };
  } catch {
    return { kept: false, because: 'failed' };
  }
}

/* Drop copies older than KEEP_DAYS and the blobs nothing references any more. At board start and at most daily. */
function maybeSweep(now) { if (now - lastSweep > 86400000) sweep(now); }
function sweep(now = Date.now()) {
  lastSweep = now;
  try {
    const cutoff = now - KEEP_DAYS * 86400000;
    const all = readIndex();
    const live = all.filter((r) => r.atMs >= cutoff);
    if (live.length !== all.length) {
      const tmp = indexFile() + '.' + process.pid + '.tmp';
      fs.writeFileSync(tmp, live.map(({ atMs, ...r }) => JSON.stringify(r)).join('\n') + (live.length ? '\n' : ''), { mode: 0o600 });
      fs.renameSync(tmp, indexFile());
    }
    const used = new Set(live.map((r) => r.hash).filter(Boolean));
    for (const n of fs.existsSync(blobsDir()) ? fs.readdirSync(blobsDir()) : []) {
      const f = path.join(blobsDir(), n);
      let stale = !used.has(n) && !n.endsWith('.tmp');
      if (n.endsWith('.tmp')) { try { stale = now - fs.statSync(f).mtimeMs > 3600000; } catch { stale = false; } }   // a keep that died
      if (stale) { try { fs.rmSync(f, { force: true }); } catch { /* next sweep */ } }
    }
  } catch { /* the next sweep */ }
}

/* Every other task's holds for these agents: an edit inside one of them belongs to that task too. */
function otherHolds(agents, projectId, number) {
  const out = new Map(agents.map((a) => [a, []]));
  const receipt = require('./receipt');
  let all = [];
  try { all = require('./projects').readAll() || []; } catch { return out; }
  for (const proj of all) {
    for (const t of (proj && proj.tasks) || []) {
      if (proj.id === projectId && t.number === number) continue;
      const closed = Date.parse(receipt.closedAtOf(t));
      const holds = receipt.holdsFrom(taskchat.read(proj.id, t.number), Number.isFinite(closed) ? closed : Date.now());
      for (const a of agents) if (holds[a]) out.get(a).push(...holds[a]);
    }
  }
  return out;
}

/* What the file at `p` is now, for safety: 'file', 'missing', or 'other' (a link, a folder, anything else). */
function nowIs(p) {
  try { const st = fs.lstatSync(p); return st.isFile() ? { kind: 'file', st } : { kind: 'other', st }; }
  catch (err) { return { kind: err && err.code === 'ENOENT' ? 'missing' : 'other', st: null }; }
}

const CHOOSABLE = new Set(['shared', 'other-task', 'incomplete']);

/**
 * What undoing task `task` of project `projectId` would do, file by file: { ready, because?, files: [{ path, agent,
 * action: 'restore'|'move-aside', copyId, ok, why? }] }. `ok` false says why: not choosable ('not-a-file', 'moved',
 * 'gone', 'changed-since', 'copy-missing'), or choosable with care (CHOOSABLE). Reading only.
 */
function plan(projectId, task, { now = Date.now() } = {}) {
  const receipt = require('./receipt');
  const closedIso = receipt.closedAtOf(task);
  const closedAt = Date.parse(closedIso);
  if (!Number.isFinite(closedAt)) return { ready: false, because: 'open', files: [] };
  const holds = receipt.holdsFrom(taskchat.read(projectId, task.number), closedAt);
  const holders = Object.keys(holds);
  if (!holders.length) return { ready: true, closedAt: closedIso, files: [] };
  const index = readIndex();
  const since = Date.parse(read().since);
  const others = otherHolds(holders, projectId, task.number);
  const inside = (spans, t) => spans.some((h) => t >= h.from && t <= h.to);
  const first = new Map();   // path -> { who, rec }: the copy before the agent's FIRST edit in its holds
  for (const rec of index) {
    if (!holders.includes(rec.agent) || !inside(holds[rec.agent], rec.atMs)) continue;
    const cur = first.get(rec.path);
    if (!cur || rec.atMs < cur.rec.atMs) first.set(rec.path, { who: rec.agent, rec });
  }
  const span = Object.values(holds).flat();
  const from = Math.min(...span.map((h) => h.from));
  const files = [];
  for (const [p, { who, rec }] of [...first.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    /* `shown`: the path inside the agent's folder, as the receipt shows it; a file outside it keeps its full path, so a
       short path never hides where a file is (Mona Lisa's design review). */
    let shown = p;
    try {
      const { canonicalOnDisk } = require('./trust');
      const folder = canonicalOnDisk(require('./create').workerDir(who));
      const rel = path.relative(folder, p);
      if (rel && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel)) shown = rel;
    } catch { shown = p; }
    const entry = { path: p, shown, agent: who, action: rec.existed ? 'restore' : 'move-aside', copyId: rec.id, at: rec.at, ok: true };
    const hold0 = Math.min(...holds[who].map((h) => h.from));
    const cur = nowIs(p);
    let dirReal = '';
    try { dirReal = fs.realpathSync(path.dirname(p)); } catch { dirReal = ''; }
    const flag = (why) => { if (entry.ok) { entry.ok = false; entry.why = why; } };
    if (cur.kind === 'other') flag('not-a-file');
    /* No folder recorded (the file was created in a folder that did not exist yet): its folder must still be exactly
       the path it was named by, not a link to somewhere else (review 2). */
    else if (rec.dirReal ? (dirReal && dirReal !== rec.dirReal) : (dirReal && dirReal !== path.dirname(p))) flag('moved');
    else if (cur.kind === 'missing') flag('gone');   // created and since removed, or deleted after: never brought back
    else if (cur.st.mtimeMs > closedAt + CHANGED_SLACK_MS) flag('changed-since');
    else if (rec.existed && !fs.existsSync(path.join(blobsDir(), rec.hash || '-'))) flag('copy-missing');
    else if (index.some((r) => r.path === p && r.atMs >= from && r.atMs <= closedAt && !holders.includes(r.agent))) flag('shared');
    else if (index.some((r) => r.path === p && r.agent === who && inside(holds[who], r.atMs) && inside(others.get(who) || [], r.atMs))) flag('other-task');
    /* The first copy may not be from before the agent's first edit (review 2): the switch went on after the agent began,
       the file had already changed inside the hold when its first copy was made (a late or missed keep, a command's
       change), or the hold is older than the copies kept. */
    else if (!Number.isFinite(since) || since > hold0 || (rec.existed && Number.isFinite(rec.mtimeMs) && rec.mtimeMs > hold0)
      || hold0 < now - KEEP_DAYS * 86400000) flag('incomplete');
    files.push(entry);
  }
  return { ready: true, closedAt: closedIso, savedRoot: savedRoot(), files };   // savedRoot: where a moved file goes, said on the page
}

/* Move a file aside, across volumes too (review 2: rename fails between disks): copy, check it arrived whole, then
   remove the original. If anything differs the original stays where it was. */
function moveAside(from, to) {
  try { fs.renameSync(from, to); return; } catch (err) { if (!err || err.code !== 'EXDEV') throw err; }
  try { fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL); }
  catch (err) { if (err && err.code !== 'EEXIST') { try { fs.unlinkSync(to); } catch { /* not made */ } } throw err; }   // no half copy left behind (review 3), never someone else's file (review 4)
  if (sha(fs.readFileSync(from)) !== sha(fs.readFileSync(to))) { try { fs.unlinkSync(to); } catch { /* left */ } throw new Error('copy differs'); }
  fs.unlinkSync(from);
}

/**
 * Undo the chosen files of a closed task. Redoes the plan and acts only on chosen files that are ok, or choosable with
 * care and chosen. Each file's current version is saved first; the copy is written beside the file and renamed into
 * place (never through a link). Returns { done, skipped: [{ path, why }], savedIn }.
 */
function apply(projectId, task, paths, { now = Date.now() } = {}) {
  if (!read().on) return { done: [], skipped: [], because: 'off' };
  const p = plan(projectId, task, { now });
  if (!p.ready) return { done: [], skipped: [], because: p.because };
  const chosen = new Set(Array.isArray(paths) ? paths : []);
  const byId = new Map(readIndex().map((r) => [r.id, r]));
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');   // one folder per undo
  const savedIn = path.join(savedRoot(), stamp);
  const done = [];
  const skipped = [];
  for (const f of p.files) {
    if (!chosen.has(f.path)) continue;
    if (!f.ok && !CHOOSABLE.has(f.why)) { skipped.push({ path: f.path, why: f.why }); continue; }
    const rec = byId.get(f.copyId);
    const cur = nowIs(f.path);
    if (!rec || cur.kind === 'other') { skipped.push({ path: f.path, why: 'not-a-file' }); continue; }
    try {
      mkdirPrivate(savedIn);
      const keepAs = path.join(savedIn, sha(Buffer.from(f.path)).slice(0, 16) + '-' + path.basename(f.path));
      if (f.action === 'move-aside') {
        if (cur.kind !== 'file') { skipped.push({ path: f.path, why: 'gone' }); continue; }
        moveAside(f.path, keepAs);                         // the created file, moved aside: never deleted
      } else {
        /* The kept copy must still be what was kept, and the current version must be saved whole, before anything is
           written (review 3). */
        const blobPath = path.join(blobsDir(), rec.hash);
        if (sha(fs.readFileSync(blobPath)) !== rec.hash) { skipped.push({ path: f.path, why: 'copy-missing' }); continue; }
        if (cur.kind === 'file') {
          fs.copyFileSync(f.path, keepAs, fs.constants.COPYFILE_EXCL);   // the current version, saved first; never over another save
          if (sha(fs.readFileSync(f.path)) !== sha(fs.readFileSync(keepAs))) throw new Error('save differs');
        }
        const tmp = path.join(path.dirname(f.path), '.kosmos-undo-' + crypto.randomBytes(6).toString('hex'));
        try {
          fs.copyFileSync(blobPath, tmp, fs.constants.COPYFILE_EXCL);
          if (rec.mode != null) { try { fs.chmodSync(tmp, rec.mode); } catch { /* the content is what matters */ } }
          fs.renameSync(tmp, f.path);                      // replaces the entry itself: never writes through a link
        } catch (err) {
          try { fs.unlinkSync(tmp); } catch { /* not made */ }   // never leave the old content beside the file (review 2)
          throw err;
        }
      }
      fs.writeFileSync(keepAs + '.json', JSON.stringify({ path: f.path, action: f.action, project: projectId, task: task.number }), { mode: 0o600 });
      done.push(f.path);
    } catch {
      skipped.push({ path: f.path, why: 'failed' });
    }
  }
  if (done.length) taskchat.record(projectId, task.number, { kind: 'undone', files: done.length });
  return { done, skipped, savedIn: done.length ? savedIn : null };
}

module.exports = { read, setOn, keep, plan, apply, sweep, resetForTests, moveAside, MAX_BYTES, KEEP_DAYS, CHOOSABLE };
