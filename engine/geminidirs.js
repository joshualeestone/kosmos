'use strict';
/**
 * #5812: the project folders a Gemini agent may write in, passed as --include-directories.
 *
 * Gemini refuses write_file and replace outside its workspace (validatePathAccess), so an agent
 * on a project whose folder is not its own could only change project files through shell
 * commands, which nothing records. Read in gemini-cli 0.61.0 (the pinned build), 2026-10-13:
 *
 *   - every --include-directories folder is added to the WORKSPACE (WorkspaceContext.addDirectory),
 *     not to its read-only list, and a write is allowed anywhere inside the workspace
 *     (Config.isPathAllowed -> isPathWithinWorkspace). So the flag widens writes, not just reads.
 *   - a folder that does not exist, or is not a directory, THROWS from Config._initialize, so
 *     one stale project folder would stop the agent starting. Only folders that exist go in.
 *   - the flag splits every value on commas and trims each piece (coerceCommaSeparated), so a
 *     folder whose path holds a comma, or ends in a space, would arrive as paths that do not
 *     exist. Those are left out and said, never passed.
 *   - interactive only (the Mac pane): folder trust is ON unless switched off (the settings
 *     schema's default is `enabled: true`), and each included folder with no record in the
 *     account's trustedFolders.json opens a "trust these folders?" dialog that an unattended agent
 *     would sit in front of. So before the Mac launch, each folder is recorded as TRUST_FOLDER in
 *     that file (trustFolders below), the way engine/agytrust.js pre-answers Antigravity's question
 *     for the agent's own folder. A folder the person marked DO_NOT_TRUST is left out and never
 *     overwritten. A headless turn (Windows) adds the folders without asking, so it writes nothing.
 *
 * Membership is read raw from projects.json (projects.readAll), never through describe, which
 * can write. The Mac reads it at each launch, so a project joined mid-session reaches a running
 * Mac agent at its next start; Windows reads it at every turn.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* Kept well inside a Windows command line (32767) next to the message batch (win32codexsup's
   BATCH_CHARS, 24000): folders past this are left out, and said. */
const MAX_TOTAL_CHARS = 4000;
/* What each folder costs on top of its own path: the flag, two spaces, and quotes. */
const FLAG_CHARS = '--include-directories'.length + 4;

const sameCase = (p) => (process.platform === 'win32' || process.platform === 'darwin' ? p.toLowerCase() : p);

function realDir(p) {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return null;
    return fs.realpathSync(p);
  } catch { return null; }
}

function within(child, parent) {
  const c = sameCase(child);
  const p = sameCase(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
}

/**
 * The folders to include for an agent, and the ones left out with why. Never throws.
 * @param {string} name     the agent's session name, as projects.json lists it
 * @param {object} [opts]
 * @param {string} [opts.workdir]  the agent's own folder: already its workspace, so not repeated
 * @param {Array}  [opts.projects] seam: the raw project list (default projects.readAll())
 * @returns {{ folders: string[], leftOut: Array<{ folder: string, because: string }> }}
 */
function foldersFor(name, opts) {
  const o = opts || {};
  const out = { folders: [], leftOut: [] };
  const key = String(name || '');
  if (!key) return out;
  let all;
  try { all = Array.isArray(o.projects) ? o.projects : require('./projects').readAll(); }
  catch (err) { out.leftOut.push({ folder: '', because: 'we could not read the projects (' + ((err && err.message) || 'unknown') + ')' }); return out; }
  const own = o.workdir ? (realDir(o.workdir) || path.resolve(o.workdir)) : null;
  const seen = new Set();
  let total = 0;
  for (const p of all) {
    if (!p || !Array.isArray(p.agents) || !p.agents.includes(key)) continue;
    const folder = typeof p.folder === 'string' ? p.folder : '';
    if (!folder) continue;
    if (!path.isAbsolute(folder)) { out.leftOut.push({ folder, because: 'its folder is not a full path' }); continue; }
    if (/[,\r\n]/.test(folder) || folder !== folder.trim()) {
      out.leftOut.push({ folder, because: 'Gemini splits folder names on commas and trims spaces, so it would get the wrong folder' });
      continue;
    }
    const real = realDir(folder);
    if (!real) { out.leftOut.push({ folder, because: 'the folder is not there' }); continue; }
    if (/[,\r\n]/.test(real) || real !== real.trim()) {
      out.leftOut.push({ folder, because: 'Gemini splits folder names on commas and trims spaces, so it would get the wrong folder' });
      continue;
    }
    if (own && within(real, own)) continue;   // already inside its own workspace
    if (seen.has(sameCase(real))) continue;
    if (total + real.length + FLAG_CHARS > MAX_TOTAL_CHARS) { out.leftOut.push({ folder, because: 'the list of folders is already as long as a launch can carry' }); continue; }
    seen.add(sameCase(real));
    total += real.length + FLAG_CHARS;
    out.folders.push(real);
  }
  return out;
}

/* The argv for those folders: one flag per folder, so no folder is joined to another. Pure. */
function includeArgs(folders) {
  return (Array.isArray(folders) ? folders : []).flatMap((f) => ['--include-directories', String(f)]);
}

/* gemini's own trust file: <GEMINI_CLI_HOME or home>/.gemini/trustedFolders.json
   (Storage.getTrustedFoldersPath; GEMINI_CLI_TRUSTED_FOLDERS_PATH moves it). */
function trustFile(cliHome) {
  if (process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH) return process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH;
  return path.join(cliHome || os.homedir(), '.gemini', 'trustedFolders.json');
}

const TRUST_LEVELS = Object.freeze(['TRUST_FOLDER', 'TRUST_PARENT', 'DO_NOT_TRUST']);

/* gemini's LoadedTrustedFolders.isPathTrusted, over a parsed file: the LONGEST matching rule wins,
   TRUST_PARENT covers its rule's parent folder. true, false (DO_NOT_TRUST), or undefined (no rule). */
function trustOf(rules, folder) {
  const where = sameCase(folder);
  let longest = -1;
  let level;
  for (const [rule, lvl] of Object.entries(rules)) {
    if (!TRUST_LEVELS.includes(lvl)) continue;
    const base = lvl === 'TRUST_PARENT' ? path.dirname(rule) : rule;
    let real = base;
    try { real = fs.realpathSync(base); } catch { /* gemini also falls back to the path as written */ }
    const rel = path.relative(sameCase(real), where);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
      if (rule.length > longest) { longest = rule.length; level = lvl; }
    }
  }
  if (level === 'DO_NOT_TRUST') return false;
  if (level) return true;
  return undefined;
}

/* Read the trust file: { rules } (an absent file is no rules) or { because } to leave it alone.
   gemini refuses to start on a file it cannot parse, so such a file is never rewritten here. */
function readRules(file) {
  let rules = {};
  try { rules = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (err) { if (!err || err.code !== 'ENOENT') return { because: 'Gemini\'s trusted folders file could not be read, so it was left alone' }; }
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return { because: 'Gemini\'s trusted folders file is not an object, so it was left alone' };
  return { rules };
}

/**
 * Record each folder as trusted in the account's trustedFolders.json, so the Mac pane does not stop
 * on gemini's trust dialog. Only ever ADDS entries; every other entry is kept as read. Locks and
 * re-reads with engine/agytrust.js's lock (run in its own process only: the lock wait blocks).
 * @returns {{ folders: string[], leftOut: Array<{ folder: string, because: string }> }}
 *   `folders` are the ones gemini will add without asking.
 */
function trustFolders(folders, cliHome) {
  const out = { folders: [], leftOut: [] };
  const list = Array.isArray(folders) ? folders : [];
  if (list.length === 0) return out;
  const file = trustFile(cliHome);
  const leaveAll = (because) => ({ folders: [], leftOut: list.map((folder) => ({ folder, because })) });
  let target = file;
  try { if (fs.lstatSync(file).isSymbolicLink()) target = fs.realpathSync(file); }
  catch (err) { if (!err || err.code !== 'ENOENT') return leaveAll('Gemini\'s trusted folders file is a link to a file that is gone, so it was left alone'); }
  try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch { /* the lock below says why */ }
  const held = require('./agytrust')._lock(target);
  if (!held.release) return leaveAll(held.because);
  try {
    for (let i = 0; i < 3; i++) {
      const r = readRules(target);
      if (!r.rules) return leaveAll(r.because);
      const missing = [];
      const ok = [];
      const refused = [];
      for (const f of list) {
        const t = trustOf(r.rules, f);
        if (t === false) refused.push(f);
        else if (t === true) ok.push(f);
        else missing.push(f);
      }
      if (missing.length === 0) {
        return { folders: ok, leftOut: refused.map((folder) => ({ folder, because: 'the folder is marked do not trust in Gemini, and that is left as it is' })) };
      }
      const next = Object.assign({}, r.rules);
      for (const f of missing) next[f] = 'TRUST_FOLDER';
      let mode = 0o600;
      try { mode = fs.statSync(target).mode & 0o777; } catch { /* new file: owner only, like gemini's own */ }
      require('./securewrite').writeSecret(target, JSON.stringify(next, null, 2) + '\n', mode, { atomicOnly: true, ownTempsOnly: true });
      /* the loop re-reads: gemini itself may have written the file meanwhile (it locks differently) */
    }
    return leaveAll('Gemini\'s trusted folders file kept changing underneath, so the folders could not be recorded');
  } catch (err) {
    return leaveAll('the folders could not be recorded as trusted in Gemini (' + ((err && err.code) || (err && err.message) || 'unknown') + ')');
  } finally {
    held.release();
  }
}

/**
 * What the Mac launch passes: the project folders, each recorded as trusted first. Never throws.
 * @returns {{ folders: string[], leftOut: Array<{ folder: string, because: string }> }}
 */
function launchFolders(name, workdir, cliHome, opts) {
  const r = foldersFor(name, Object.assign({}, opts, { workdir }));
  if (r.folders.length === 0) return r;
  const t = trustFolders(r.folders, cliHome);
  return { folders: t.folders, leftOut: r.leftOut.concat(t.leftOut) };
}

/* The supervisor's door: `node geminidirs.js launch-args <name> <workdir> [cliHome]` prints one
   folder per line on stdout (a folder never holds a newline: those are left out above) and
   each left-out folder on stderr. Always exits 0: no folders is a launch like before. */
if (require.main === module) {
  try {
    const [verb, name, workdir, cliHome] = process.argv.slice(2);
    if (verb === 'launch-args') {
      const r = launchFolders(name, workdir, cliHome || '');
      for (const l of r.leftOut) process.stderr.write(`#5812: the project folder ${l.folder || '(none)'} was left out of the Gemini workspace (${l.because})\n`);
      if (r.folders.length) fs.writeSync(1, r.folders.join('\n') + '\n');
    }
  } catch (err) {
    process.stderr.write(`#5812: no project folders were added to the Gemini workspace (${err && err.message})\n`);
  }
  process.exit(0);
}

module.exports = { foldersFor, includeArgs, trustFolders, trustOf, trustFile, launchFolders, MAX_TOTAL_CHARS };
