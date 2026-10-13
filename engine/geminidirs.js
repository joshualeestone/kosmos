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
 *   - interactive only (the Mac pane): when the account's settings switch folder trust ON
 *     (security.folderTrust.enabled; it is off unless the person turned it on), each included
 *     folder with no trust record opens a "trust these folders?" dialog, which an unattended
 *     agent would sit in front of. So on the Mac nothing is included then, and the log says why.
 *     A headless turn (Windows) adds the folders without asking, so it is not affected.
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
    if (total + real.length > MAX_TOTAL_CHARS) { out.leftOut.push({ folder, because: 'the list of folders is already as long as a launch can carry' }); continue; }
    seen.add(sameCase(real));
    total += real.length;
    out.folders.push(real);
  }
  return out;
}

/* The argv for those folders: one flag per folder, so no folder is joined to another. Pure. */
function includeArgs(folders) {
  return (Array.isArray(folders) ? folders : []).flatMap((f) => ['--include-directories', String(f)]);
}

/**
 * Does this account's Gemini settings switch folder trust on? true, false, or null (unreadable,
 * which is treated as on by the launch: an unanswered dialog costs more than a missing folder).
 * @param {string} [cliHome] the agent's GEMINI_CLI_HOME; unset is the person's home
 */
function folderTrustOn(cliHome) {
  const root = cliHome || process.env.AGENT_WORKFORCE_HOME || os.homedir();
  const file = path.join(root, '.gemini', 'settings.json');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); }
  catch (err) { return err && err.code === 'ENOENT' ? false : null; }
  try {
    const s = JSON.parse(raw);
    return Boolean(s && s.security && s.security.folderTrust && s.security.folderTrust.enabled === true);
  } catch { return null; }
}

/**
 * What the Mac launch passes: the folders, unless folder trust is on (or unknown). Never throws.
 * @returns {{ folders: string[], leftOut: Array<{ folder: string, because: string }> }}
 */
function launchFolders(name, workdir, cliHome, opts) {
  const r = foldersFor(name, Object.assign({}, opts, { workdir }));
  if (r.folders.length === 0) return r;
  const trust = (opts && typeof opts.folderTrustOn === 'function') ? opts.folderTrustOn(cliHome) : folderTrustOn(cliHome);
  if (trust === false) return r;
  const because = trust === true
    ? 'folder trust is switched on in this Gemini account, and Gemini would stop to ask about each folder'
    : 'we could not read this Gemini account\'s settings, so we could not tell whether Gemini would stop to ask about each folder';
  return { folders: [], leftOut: r.leftOut.concat(r.folders.map((folder) => ({ folder, because }))) };
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

module.exports = { foldersFor, includeArgs, folderTrustOn, launchFolders, MAX_TOTAL_CHARS };
