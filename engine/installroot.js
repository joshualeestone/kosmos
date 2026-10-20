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
 *   else   <root>/runtime/bin/node and <root>/app/server.js, root two folders up from this engine. Measured
 *          2026-10-20 on two real Mac installs (Agent1s, and Mortals for two users): every installed board runs as
 *          <root>/runtime/bin/node <root>/app/server.js with root = ~/.local/share/kosmos and its engine in
 *          <root>/app/engine. A source checkout or worktree has neither file two up from its engine.
 * NOT covered (as on Windows): a second BUILT bundle extracted elsewhere and started as a test board passes.
 *
 * leaveAlone(file) returns why a write of `file` must be skipped, or null to go ahead. It is skipped only when this
 * board is not the installed Kosmos AND the file is in the real home: no AGENT_WORKFORCE_HOME, or one that is the
 * home itself, and the file inside the home folder. A sandboxed board (its own AGENT_WORKFORCE_HOME, every test)
 * still wires its own sandbox, so nothing it does reaches the real accounts.
 * `platform`, `root`, `exists`, `home` and `env` are injectable for tests.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function installRoot(opts) {
  const o = opts || {};
  const plat = o.platform || process.platform;
  if (plat === 'win32') return require('./win32board').bundleRoot({ platform: plat, root: o.root, exists: o.exists });
  const root = o.root || path.resolve(__dirname, '..', '..');
  const exists = o.exists || ((f) => fs.existsSync(f));
  if (exists(path.posix.join(root, 'runtime', 'bin', 'node')) && exists(path.posix.join(root, 'app', 'server.js'))) return root;
  return null;
}

function inside(file, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(file));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const NOT_INSTALLED = 'this board is not an installed Kosmos (a source checkout or a worktree), so it leaves this '
  + 'account’s Claude settings alone; the installed Kosmos wires them';

function leaveAlone(file, opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const home = o.home || os.homedir();
  const sandbox = env.AGENT_WORKFORCE_HOME;
  if (sandbox && path.resolve(sandbox) !== path.resolve(home)) return null;   // a sandboxed board writes only its sandbox
  if (typeof file !== 'string' || !inside(file, home)) return null;
  let root = null;
  try { root = o.installRoot !== undefined ? o.installRoot : installRoot(o); }
  catch { return 'this board could not tell whether it is an installed Kosmos, so it leaves this account’s Claude settings alone'; }
  return root ? null : NOT_INSTALLED;
}

module.exports = { installRoot, leaveAlone, NOT_INSTALLED };
