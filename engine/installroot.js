'use strict';
/**
 * kosmos#6713: is THIS board the installed Kosmos, and may it write a script path of its own into this computer's
 * shared Claude settings?
 *
 * The report hooks and the weekly statusline name a script beside the RUNNING engine. A board started from a source
 * checkout or a worktree (a test board) that writes them into an account folder in the real home points every agent
 * on that account at its own throwaway code: the #6601 class, through accounts.prepare and allowance.ensureStatusLine.
 *
 * installRoot answers where the installed bundle is, or null:
 *   win32  win32board.bundleRoot (<root>/runtime/node.exe and <root>/app/server.js; #6601)
 *   else   <root>/runtime/bin/node and <root>/app/server.js, root two folders up from this engine (the same layout
 *          test as update.js installedRoot; keep the two alike), AND root being the default ~/.local/share/kosmos,
 *          compared by identity. Measured 2026-10-20 on two real Mac installs (Agent1s, and Mortals for two users):
 *          every installed board runs as <root>/runtime/bin/node <root>/app/server.js with that root. A source
 *          checkout or worktree has neither file two up from its engine. A bundle under any other KOSMOS_HOME counts
 *          as a test install, the stance install/setup.sh write_install_config takes; so a self-host install with a
 *          custom KOSMOS_HOME gets no account hooks or statusline from Kosmos in the real home, from the board or from
 *          setup.sh, which asks this same rule.
 * NOT covered on Windows (as #6601 records): a second built bundle extracted elsewhere passes bundleRoot.
 *
 * leaveAlone(file) returns why a write of `file` must be skipped, or null to go ahead. Skipped when this board is not
 * the installed Kosmos and the file is in the real home (as spelled, or where links lead), unless it is inside a
 * sandbox (an AGENT_WORKFORCE_HOME that is neither the home nor above it), where a test board writes only its own
 * folders. A real-home file is skipped even while a sandbox elsewhere is set. Folders are compared by identity
 * (device and inode, as setup.sh's `-ef`), never by spelling: /System/Volumes/Data/Users/<u> and a differently cased
 * path name the real home too. `platform`, `root`, `exists`, `home` and `env` are injectable for tests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/* The same folder? By device and inode when both exist; by resolved text otherwise. */
function sameDir(a, b, plat) {
  try {
    const x = fs.statSync(a, { bigint: true }); const y = fs.statSync(b, { bigint: true });   // bigint: exact inode numbers
    if (x.ino !== 0n && y.ino !== 0n) return x.dev === y.dev && x.ino === y.ino;   // 0: no inode reported, so it proves nothing
  } catch { /* fall through to the text */ }
  return textKey(a, plat) === textKey(b, plat);
}
/* Resolved text, where links lead, without letter case on Windows (its paths are case-insensitive), for folders
   that cannot be told apart by inode. */
function textKey(p, plat) { const r = realOf(p); return (plat || process.platform) === 'win32' ? r.toLowerCase() : r; }

/* The real path of `file`: its deepest existing folder resolved through links, with the rest appended. */
function realOf(file) {
  let d = path.resolve(file); const rest = [];
  for (;;) {
    try { return path.join(fs.realpathSync(d), ...rest); } catch { /* not there yet */ }
    const up = path.dirname(d);
    if (up === d) return path.resolve(file);
    rest.unshift(path.basename(d)); d = up;
  }
}

/* Is `file` inside `dir`, as spelled or where its links lead. */
function inside(file, dir, plat) {
  if (insideSpelled(file, dir, plat)) return true;
  const real = realOf(file);
  return real !== path.resolve(file) && insideSpelled(real, dir, plat);
}
/* Some folder above `file` is `dir`, by identity, else by text. */
function insideSpelled(file, dir, plat) {
  let d = path.resolve(file);
  for (;;) {
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
    if (sameDir(d, dir, plat)) return true;
  }
  const rel = path.relative(textKey(dir, plat), textKey(file, plat));
  return rel !== '' && rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
}

function installRoot(opts) {
  const o = opts || {};
  const plat = o.platform || process.platform;
  if (plat === 'win32') return require('./win32board').bundleRoot({ platform: plat, root: o.root, exists: o.exists });
  const root = o.root || path.resolve(__dirname, '..', '..');
  const exists = o.exists || ((f) => fs.existsSync(f));
  if (!exists(path.posix.join(root, 'runtime', 'bin', 'node')) || !exists(path.posix.join(root, 'app', 'server.js'))) return null;
  const home = o.home || os.homedir();
  return sameDir(root, path.join(home, '.local', 'share', 'kosmos')) ? root : null;
}

const NOT_INSTALLED = 'this board is not the installed Kosmos (a source checkout, a worktree or a test install), so it '
  + 'leaves this account\'s Claude settings alone';

function leaveAlone(file, opts) {
  const o = opts || {};
  if (typeof file !== 'string') return null;
  let home;
  try { home = o.home || os.homedir(); } catch { return 'this board could not tell where the home folder is, so it leaves this account\'s Claude settings alone'; }
  const plat = o.platform;
  if (!inside(file, home, plat)) return null;
  const sandbox = (o.env || process.env).AGENT_WORKFORCE_HOME;
  // A sandboxed board's own folders; a "sandbox" that is the home or above it is not one.
  // Judged where the file really is: a link inside the sandbox that leads into the real home does not count.
  if (sandbox && !sameDir(sandbox, home, plat) && !inside(home, sandbox, plat) && insideSpelled(realOf(file), sandbox, plat)) return null;
  let root = null;
  try { root = o.installRoot !== undefined ? o.installRoot : installRoot({ ...o, home }); }
  catch { return 'this board could not tell whether it is an installed Kosmos, so it leaves this account\'s Claude settings alone'; }
  return root ? null : NOT_INSTALLED;
}

module.exports = { installRoot, leaveAlone, NOT_INSTALLED };
