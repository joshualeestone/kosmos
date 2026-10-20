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
 *   else   <root>/runtime/bin/node and <root>/app/server.js, root two folders up from this engine, AND root the
 *          default ~/.local/share/kosmos. Measured 2026-10-20 on two real Mac installs (Agent1s, and Mortals for two
 *          users): every installed board runs as <root>/runtime/bin/node <root>/app/server.js with that root and its
 *          engine in <root>/app/engine. A source checkout or worktree has neither file two up from its engine. A
 *          bundle under any other KOSMOS_HOME is a sandbox here, as install/setup.sh write_install_config treats it
 *          (a self-host install with a custom KOSMOS_HOME keeps relying on setup.sh's own wiring).
 * NOT covered on Windows (as #6601 records): a second built bundle extracted elsewhere passes bundleRoot.
 *
 * leaveAlone(file) returns why a write of `file` must be skipped, or null to go ahead. Skipped when this board is not
 * the installed Kosmos and the file is in the real home, unless it is inside a sandbox (AGENT_WORKFORCE_HOME that is
 * not the home itself), where a test board writes only its own folders. Folders are compared by identity
 * (device and inode, as setup.sh's `-ef`), never by spelling: /System/Volumes/Data/Users/<u> and a differently cased
 * path name the real home too. `platform`, `root`, `exists`, `home` and `env` are injectable for tests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/* The same folder? By device and inode when both exist; by resolved text otherwise. */
function sameDir(a, b) {
  try {
    const x = fs.statSync(a); const y = fs.statSync(b);
    return x.dev === y.dev && x.ino === y.ino;
  } catch { return path.resolve(a) === path.resolve(b); }
}

/* Is `file` inside `dir`: some folder above it (or it) is `dir`, by identity, else by text. */
function inside(file, dir) {
  let d = path.resolve(file);
  for (;;) {
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
    if (sameDir(d, dir)) return true;
  }
  const rel = path.relative(path.resolve(dir), path.resolve(file));
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

const NOT_INSTALLED = 'this board is not an installed Kosmos (a source checkout, a worktree or a test install), so it '
  + 'leaves this account’s Claude settings alone; Kosmos’s installer or the installed board sets them up';

function leaveAlone(file, opts) {
  const o = opts || {};
  if (typeof file !== 'string') return null;
  let home;
  try { home = o.home || os.homedir(); } catch { return 'this board could not tell where the home folder is, so it leaves this account’s Claude settings alone'; }
  if (!inside(file, home)) return null;
  const sandbox = (o.env || process.env).AGENT_WORKFORCE_HOME;
  if (sandbox && !sameDir(sandbox, home) && inside(file, sandbox)) return null;   // a sandboxed board's own folders
  let root = null;
  try { root = o.installRoot !== undefined ? o.installRoot : installRoot({ ...o, home }); }
  catch { return 'this board could not tell whether it is an installed Kosmos, so it leaves this account’s Claude settings alone'; }
  return root ? null : NOT_INSTALLED;
}

module.exports = { installRoot, leaveAlone, NOT_INSTALLED };
