'use strict';
/**
 * tmpscope (./tmpscope.js), with this test process's temp folder made OUTSIDE the person's home folder on Windows
 * (kosmos#8378). Require it FIRST in a test file, in place of tmpscope:
 *
 *     require('../test-support/tmpscope-outside-home');
 *
 * WHY: on Windows the temp folder is inside the home (C:\Users\<user>\AppData\Local\Temp, on a person's computer and on
 * GitHub's Windows runners alike), so a sandbox made under it has the real home as an ancestor. The token-only guard
 * (engine/setup-assistant.js tokenOnlySettingsRules) walks every ancestor of an agent's folder and reads the instruction
 * files there (CLAUDE.md, AGENTS.md, .claude/CLAUDE.md and its rules) and everything they import. So a guard test whose
 * sandbox sat in the temp folder read the REAL ~/.claude/CLAUDE.md and its imports, and its result depended on what the
 * computer running it has there (measured on the Windows box: the imported BULLETINS.md and two more named in the
 * reason, and the guard not whole). On the Mac and Linux the temp folder is not in the home, so nothing changes there.
 *
 * HOW: on a Windows host whose temp folder is inside the home, TEMP and TMP are pointed at the system temp folder
 * (%SystemRoot%\Temp, which a standard account may create folders in) before tmpscope runs, so tmpscope's per-process
 * folder, and every fixture made in it, lands there and is removed at exit as before. The place is used only if a
 * folder can be made in it and neither it nor any folder above it holds an instruction file the guard would read;
 * otherwise nothing is changed and the file behaves exactly as with tmpscope alone.
 *
 * It must never throw, for the reason tmpscope gives.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// The names the guard reads in each ancestor (setup-assistant.js, topRoots and dotClaudeRoots).
const INSTRUCTION_NAMES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude'];

const inside = (child, parent) => {
  const c = path.resolve(child).toLowerCase(), p = path.resolve(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

/* The folder to make the scope in, or null to leave TEMP alone. Seams (platform, tmp, home, env, exists, canMake) are for
   its own test; callers leave them out. */
function outsideHomeRoot({ platform = process.platform, tmp = os.tmpdir(), home = os.homedir(), env = process.env,
  exists = fs.existsSync, canMake = canMakeIn } = {}) {
  if (platform !== 'win32' || !home || !inside(tmp, home)) return null;
  const sys = env.SystemRoot || env.windir;
  if (!sys) return null;
  const root = path.join(sys, 'Temp');
  if (inside(root, home)) return null;
  for (let d = path.resolve(root); ; d = path.dirname(d)) {
    if (INSTRUCTION_NAMES.some((n) => exists(path.join(d, n)))) return null;
    if (path.dirname(d) === d) break;
  }
  return canMake(root) ? root : null;
}

function canMakeIn(root) {
  try { const d = fs.mkdtempSync(path.join(root, 'kts-probe-')); fs.rmdirSync(d); return true; } catch { return false; }
}

let moved = null;
try {
  /* Only before tmpscope has run in this process: once it has, its folder is already made, and moving TEMP now would
     put later fixtures outside it, where nothing removes them. */
  if (!require.cache[require.resolve('./tmpscope')]) {
    moved = outsideHomeRoot();
    if (moved) { process.env.TEMP = moved; process.env.TMP = moved; }
  }
} catch { moved = null; }

const tmpscope = require('./tmpscope');

module.exports = { ...tmpscope, outsideHomeRoot, movedTo: () => moved };
