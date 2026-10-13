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
 *     schema's default is `enabled: true`), and each included folder with no record in the trust
 *     file opens a "trust these folders?" dialog that an unattended agent would sit in front of.
 *     So the Mac launch gives the agent ITS OWN trust file (GEMINI_CLI_TRUSTED_FOLDERS_PATH, which
 *     gemini reads instead of <home>/.gemini/trustedFolders.json), holding exactly its current
 *     project folders, rewritten at every launch (agentTrust below). The person's own trust file
 *     is only read, never written: a folder they marked DO_NOT_TRUST there is left out, and nothing
 *     here trusts a folder for any other agent or for the person's own gemini. The agent's own
 *     folder needs no record (--skip-trust). A headless turn (Windows) adds the folders without
 *     asking, so it writes nothing.
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
/* What each folder costs on top of its own path: the flag, the space after it and before the next
   argument (2), and the quotes Windows puts round an argument with a space in it (2). */
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
    if (path.dirname(real) === real || within(realDir(os.homedir()) || os.homedir(), real)) {
      out.leftOut.push({ folder, because: 'it holds the whole home folder or the whole disk, which is too wide to open to an agent\'s file tools' });
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

/* The one wording of a left-out folder, for the Mac launch log and the Windows turn log alike. */
function leftOutLine(l) {
  return '#5812: the project folder ' + ((l && l.folder) || '(none)') + ' was left out of the Gemini workspace (' + ((l && l.because) || 'unknown') + ')';
}

/* The argv for those folders: one flag per folder, so no folder is joined to another. Pure. */
function includeArgs(folders) {
  return (Array.isArray(folders) ? folders : []).flatMap((f) => ['--include-directories', String(f)]);
}

/* The person's own gemini trust file: <GEMINI_CLI_HOME or home>/.gemini/trustedFolders.json
   (Storage.getTrustedFoldersPath), or where GEMINI_CLI_TRUSTED_FOLDERS_PATH moves it. That variable
   is NOT honoured when it names one of the agents' own trust files (agentTrustFile): a process started
   from an agent's pane inherits the pane's, and reading it as the person's would read every folder as
   trusted and skip their DO_NOT_TRUST marks. */
function trustFile(cliHome) {
  const moved = process.env.GEMINI_CLI_TRUSTED_FOLDERS_PATH;
  if (moved && !within(path.resolve(moved), agentTrustDir())) return moved;
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

/* gemini parses its trust file through strip-json-comments (parseTrustedFoldersJson), so a hand-edited
   file may carry line and block comments. Drop them outside strings, as that does, before JSON.parse. */
function stripComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === '\\') { out += text[i + 1] || ''; i++; }
      else if (c === '"') inString = false;
    } else if (c === '"') { inString = true; out += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { const end = text.indexOf('*/', i + 2); i = end < 0 ? text.length : end + 1; out += ' '; }
    else out += c;
  }
  return out;
}

/* Read the person's trust file: { rules } (an absent file is no rules) or { because }. When it cannot
   be read, their DO_NOT_TRUST marks cannot be honoured, so the caller includes no folder at all. */
function readRules(file) {
  let rules = {};
  try { rules = JSON.parse(stripComments(fs.readFileSync(file, 'utf8'))); }
  catch (err) { if (!err || err.code !== 'ENOENT') return { because: 'Gemini\'s trusted folders file could not be read, so the do-not-trust marks in it could not be checked' }; }
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return { because: 'Gemini\'s trusted folders file is not an object, so the do-not-trust marks in it could not be checked' };
  return { rules };
}

/**
 * Leave out the folders the person marked DO_NOT_TRUST in their own trust file (read only). The same
 * rule on the Mac and on Windows. Never throws.
 * @returns {{ folders: string[], leftOut: Array<{ folder: string, because: string }> }}
 */
function honourMarks(folders, cliHome) {
  const list = Array.isArray(folders) ? folders : [];
  const out = { folders: [], leftOut: [] };
  if (list.length === 0) return out;
  const theirs = readRules(trustFile(cliHome));
  if (!theirs.rules) return { folders: [], leftOut: list.map((folder) => ({ folder, because: theirs.because })) };
  for (const f of list) {
    if (trustOf(theirs.rules, f) === false) out.leftOut.push({ folder: f, because: 'the folder is marked do not trust in Gemini, and that is left as it is' });
    else out.folders.push(f);
  }
  return out;
}

/**
 * What a Windows turn passes: the project folders, minus the person's DO_NOT_TRUST marks. A headless
 * turn asks no trust question, so no trust file is written. Never throws.
 */
function turnFolders(name, workdir, cliHome, opts) {
  const r = foldersFor(name, Object.assign({}, opts, { workdir }));
  const m = honourMarks(r.folders, cliHome);
  return { folders: m.folders, leftOut: r.leftOut.concat(m.leftOut) };
}

/* The agent's own trust file, in the Kosmos store (one per agent, so trust never spreads to another
   agent or to the person). The name is encoded so it is always one file name. */
function agentTrustDir() { return path.join(require('./store').ROOT, 'gemini-trust'); }
function agentTrustFile(name) {
  return path.join(agentTrustDir(), encodeURIComponent(String(name || '')) + '.json');
}

/**
 * Write the agent's own trust file: exactly `folders`, as TRUST_FOLDER, minus any the person's own
 * trust file marks DO_NOT_TRUST (read only). Replaced whole at each launch, so a project the agent
 * has left is no longer trusted. Never throws.
 * @param {string} name     the agent's roster name
 * @param {string[]} folders
 * @param {string} [cliHome] the agent's GEMINI_CLI_HOME (where the person's trust file is)
 * @param {object} [opts]   seams: { file } the agent trust file path
 * @returns {{ file: string|null, folders: string[], leftOut: Array<{ folder: string, because: string }> }}
 *   `file` is set only when it was written and `folders` is not empty.
 */
function agentTrust(name, folders, cliHome, opts) {
  const list = Array.isArray(folders) ? folders : [];
  const out = { file: null, folders: [], leftOut: [] };
  if (list.length === 0) return out;
  const leaveAll = (because) => ({ file: null, folders: [], leftOut: list.map((folder) => ({ folder, because })) });
  const m = honourMarks(list, cliHome);
  out.folders = m.folders;
  out.leftOut = m.leftOut;
  const rules = {};
  for (const f of out.folders) rules[f] = 'TRUST_FOLDER';
  if (out.folders.length === 0) return out;
  try {
    const file = (opts && opts.file) || agentTrustFile(name);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    require('./securewrite').writeSecret(file, JSON.stringify(rules, null, 2) + '\n', 0o600, { atomicOnly: true });
    out.file = file;
    return out;
  } catch (err) {
    return leaveAll('the agent\'s Gemini trust file could not be written (' + ((err && err.code) || (err && err.message) || 'unknown') + ')');
  }
}

/**
 * What the Mac launch passes: the project folders and the agent's own trust file. Never throws.
 * @returns {{ folders: string[], trustFile: string|null, leftOut: Array<{ folder: string, because: string }> }}
 */
function launchFolders(name, workdir, cliHome, opts) {
  const r = foldersFor(name, Object.assign({}, opts, { workdir }));
  if (r.folders.length === 0) return { folders: [], trustFile: null, leftOut: r.leftOut };
  const t = agentTrust(name, r.folders, cliHome, opts);
  return { folders: t.folders, trustFile: t.file, leftOut: r.leftOut.concat(t.leftOut) };
}

/* The supervisor's door: `node geminidirs.js launch-args <name> <workdir> [cliHome]` prints the
   agent's trust file as `TRUST <path>`, then one folder per line on stdout (a folder never holds a newline: those are left out above) and
   each left-out folder on stderr. Always exits 0: no folders is a launch like before. */
if (require.main === module) {
  try {
    const [verb, name, workdir, cliHome] = process.argv.slice(2);
    if (verb === 'launch-args') {
      const r = launchFolders(name, workdir, cliHome || '');
      for (const l of r.leftOut) process.stderr.write(leftOutLine(l) + '\n');
      /* The trust file first, as `TRUST <path>` (a folder line is always an absolute path). */
      if (r.folders.length && r.trustFile) fs.writeSync(1, 'TRUST ' + r.trustFile + '\n' + r.folders.join('\n') + '\n');
    }
  } catch (err) {
    process.stderr.write(`#5812: no project folders were added to the Gemini workspace (${err && err.message})\n`);
  }
  process.exit(0);
}

module.exports = { foldersFor, includeArgs, agentTrust, agentTrustFile, trustOf, trustFile, honourMarks, turnFolders, launchFolders, stripComments, leftOutLine, MAX_TOTAL_CHARS };
