'use strict';

/**
 * #5153 slice 4: undo a closed task's file changes (the recommended call on the card, 2026-10-03; Josh can override).
 *
 * 🔑 KOSMOS'S OWN COPY, TAKEN JUST BEFORE AN EDIT. While the switch is on, the report hook asks the board to keep a
 * copy of a file just before a Claude agent edits it (keep()). A closed task's undo puts each file the agent edited
 * during the task back to the copy kept before its FIRST edit in that task. Claude Code's own rewind backups were
 * measured and rejected: undocumented, and each is a file at some turn of the conversation, not "before this edit".
 *
 * 🛑 WHAT IT NEVER DOES
 *   - delete a file: one the agent created is MOVED into Kosmos's own undone folder;
 *   - overwrite a file changed after the task closed (by anyone): listed, skipped;
 *   - touch a file with no copy (switch off, too big, a command's change, another provider): listed, never guessed;
 *   - restore without first saving the file's current version beside the copies, so an undo can be undone by hand;
 *   - act on its own: plan() lists, the person chooses, apply() does only what was chosen and is still safe.
 * A file another agent also edited while this task was held is listed and skipped unless the person chooses it.
 *
 * Copies live under store.ROOT/undo, on this computer only, for KEEP_DAYS; a file over MAX_BYTES gets no copy.
 * The switch is its own file (undo.json, like community.json): no file is OFF.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store');
const taskchat = require('./taskchat');

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_DAYS = 30;
const CHANGED_SLACK_MS = 2000;   // a write in the same moment as the close is the agent's own last edit

const dir = () => path.join(store.ROOT, 'undo');
const switchFile = () => path.join(store.ROOT, 'undo.json');
const copiesDir = () => path.join(dir(), 'copies');
const keyOf = (p) => crypto.createHash('sha256').update(p).digest('hex').slice(0, 24);

/** The switch: { on, ok }. No file is OFF (ok true); a file that cannot be read is OFF with ok false. */
function read() {
  let raw;
  try { raw = fs.readFileSync(switchFile(), 'utf8'); } catch (err) { return { on: false, ok: !err || err.code === 'ENOENT' }; }
  try { const v = JSON.parse(raw); return { on: v && v.on === true, ok: true }; } catch { return { on: false, ok: false }; }
}
function setOn(on) {
  fs.mkdirSync(store.ROOT, { recursive: true });
  const tmp = switchFile() + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ on: on === true }));
  fs.renameSync(tmp, switchFile());
  return read();
}

/**
 * Keep a copy of `file` as it is now, just before an edit. Never throws. { kept, because? }.
 * `cwd` is the session's folder (which agent's work this is), `session` its id. A missing file is recorded as
 * not existing (an undo then moves the created file aside). A link, a folder or a file over MAX_BYTES is not kept.
 */
function keep(file, { cwd = '', session = '', now = Date.now() } = {}) {
  try {
    if (!read().on) return { kept: false, because: 'off' };
    if (typeof file !== 'string' || !path.isAbsolute(file)) return { kept: false, because: 'not-absolute' };
    const abs = path.resolve(file);
    let st = null;
    try { st = fs.lstatSync(abs); } catch (err) { if (err.code !== 'ENOENT') return { kept: false, because: 'unreadable' }; }
    if (st && st.isSymbolicLink()) return { kept: false, because: 'link' };
    if (st && !st.isFile()) return { kept: false, because: 'not-a-file' };
    if (st && st.size > MAX_BYTES) return { kept: false, because: 'too-large' };
    const d = path.join(copiesDir(), keyOf(abs));
    fs.mkdirSync(d, { recursive: true });
    prune(d, now);
    const id = String(now).padStart(14, '0') + '-' + crypto.randomBytes(4).toString('hex');
    if (st) fs.copyFileSync(abs, path.join(d, id + '.bin'));
    fs.writeFileSync(path.join(d, id + '.json'), JSON.stringify({
      path: abs, existed: Boolean(st), at: new Date(now).toISOString(), cwd: String(cwd || ''), session: String(session || ''),
      size: st ? st.size : 0, mode: st ? st.mode & 0o7777 : null,
    }));
    return { kept: true };
  } catch {
    return { kept: false, because: 'failed' };
  }
}

/* Copies older than KEEP_DAYS go, one file's folder at a time (the one being kept), so no sweep runs on a request. */
function prune(d, now) {
  const cutoff = now - KEEP_DAYS * 86400000;
  let names = [];
  try { names = fs.readdirSync(d); } catch { return; }
  for (const n of names) {
    const t = Number(n.split('-')[0]);
    if (Number.isFinite(t) && t < cutoff) { try { fs.rmSync(path.join(d, n), { force: true }); } catch { /* next time */ } }
  }
}

/* Every copy kept, as { meta, bin } with its time. Small: one json per edit. */
function allCopies() {
  const out = [];
  let keys = [];
  try { keys = fs.readdirSync(copiesDir()); } catch { return out; }
  for (const k of keys) {
    let names = [];
    try { names = fs.readdirSync(path.join(copiesDir(), k)); } catch { continue; }
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(copiesDir(), k, n), 'utf8'));
        const at = Date.parse(meta.at);
        if (!meta || typeof meta.path !== 'string' || !Number.isFinite(at)) continue;
        out.push({ meta, at, bin: meta.existed ? path.join(copiesDir(), k, n.replace(/\.json$/, '.bin')) : null });
      } catch { /* a torn copy is skipped */ }
    }
  }
  return out;
}

/**
 * What undoing task `task` of project `projectId` would do, file by file. { ready, because?, files: [{ path, agent,
 * action: 'restore'|'move-aside', ok, why?, otherAgents? }] }. Only files with a copy appear; `ok` false says why it
 * will not be touched ('changed-since', 'gone', 'shared' needs choosing). Pure reading: nothing is changed.
 */
function plan(projectId, task, { now = Date.now() } = {}) {
  const receipt = require('./receipt');
  const closedIso = receipt.closedAtOf(task);
  const closedAt = Date.parse(closedIso);
  if (!Number.isFinite(closedAt)) return { ready: false, because: 'open', files: [] };
  const holds = receipt.holdsFrom(taskchat.read(projectId, task.number), closedAt);
  const create = require('./create');
  const { canonicalOnDisk } = require('./trust');
  const copies = allCopies();
  const canon = new Map();
  const folderOf = (d) => { if (!canon.has(d)) { try { canon.set(d, canonicalOnDisk(d)); } catch { canon.set(d, d); } } return canon.get(d); };
  const holders = new Set();   // the folders of the agents that held this task
  const byPath = new Map();
  for (const [who, spans] of Object.entries(holds)) {
    let folder;
    try { folder = folderOf(create.workerDir(who)); } catch { continue; }
    holders.add(folder);
    for (const c of copies) {
      if (!c.meta.cwd || folderOf(c.meta.cwd) !== folder) continue;
      if (!spans.some((h) => c.at >= h.from && c.at <= h.to)) continue;
      const cur = byPath.get(c.meta.path);
      if (!cur || c.at < cur.copy.at) byPath.set(c.meta.path, { who, copy: c });   // the copy before the FIRST edit
    }
  }
  /* A copy of the same file, inside this task's span, from a folder that is not one of its holders: another agent
     edited it meanwhile, and this undo would take that back too. */
  const span = Object.values(holds).flat();
  const from = Math.min(...span.map((h) => h.from));
  const files = [];
  for (const [p, { who, copy }] of [...byPath.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const others = copies.filter((c) => c.meta.path === p && c.at >= from && c.at <= closedAt && !holders.has(folderOf(c.meta.cwd || '')));
    const entry = { path: p, agent: who, action: copy.meta.existed ? 'restore' : 'move-aside', at: copy.meta.at, ok: true };
    let st = null;
    try { st = fs.lstatSync(p); } catch { st = null; }
    if (!st && copy.meta.existed === false) { entry.ok = false; entry.why = 'gone'; }
    else if (st && st.mtimeMs > closedAt + CHANGED_SLACK_MS) { entry.ok = false; entry.why = 'changed-since'; }
    else if (copy.meta.existed && !fs.existsSync(copy.bin)) { entry.ok = false; entry.why = 'copy-missing'; }
    if (others.length) { entry.shared = true; if (entry.ok) { entry.ok = false; entry.why = 'shared'; } }
    files.push(entry);
  }
  return { ready: true, closedAt: closedIso, files };
}
/**
 * Undo the chosen files of a closed task. `paths` are files from plan(); a file the plan marks not ok is done only if
 * it is 'shared' and chosen (the person's call); 'changed-since', 'gone' and 'copy-missing' are never done. Each file's
 * current version is saved first. Returns { done: [...], skipped: [{ path, why }], savedIn }.
 */
function apply(projectId, task, paths, { now = Date.now() } = {}) {
  if (!read().on) return { done: [], skipped: [], because: 'off' };
  const p = plan(projectId, task, { now });
  if (!p.ready) return { done: [], skipped: [], because: p.because };
  const chosen = new Set(Array.isArray(paths) ? paths : []);
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');   // one folder per undo
  const savedIn = path.join(dir(), 'saved', stamp);
  const done = [];
  const skipped = [];
  for (const f of p.files) {
    if (!chosen.has(f.path)) continue;
    if (!f.ok && f.why !== 'shared') { skipped.push({ path: f.path, why: f.why }); continue; }
    try {
      fs.mkdirSync(savedIn, { recursive: true });
      const keep = path.join(savedIn, keyOf(f.path) + '-' + path.basename(f.path));
      if (f.action === 'move-aside') {
        fs.renameSync(f.path, keep);                    // the created file, moved aside: never deleted
      } else {
        const copy = allCopies().filter((c) => c.meta.path === f.path && c.meta.at === f.at)[0];
        if (fs.existsSync(f.path)) fs.copyFileSync(f.path, keep);   // the current version, saved first
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        fs.copyFileSync(copy.bin, f.path);
        if (copy.meta.mode != null) { try { fs.chmodSync(f.path, copy.meta.mode); } catch { /* the content is back */ } }
      }
      fs.writeFileSync(keep + '.json', JSON.stringify({ path: f.path, action: f.action, project: projectId, task: task.number }));
      done.push(f.path);
    } catch (err) {
      skipped.push({ path: f.path, why: 'failed' });
    }
  }
  if (done.length) taskchat.record(projectId, task.number, { kind: 'undone', files: done.length });
  return { done, skipped, savedIn: done.length ? savedIn : null };
}

module.exports = { read, setOn, keep, plan, apply, MAX_BYTES, KEEP_DAYS };
