'use strict';
/**
 * tmpscope (./tmpscope.js), with this test process's temp folder made OUTSIDE the person's home folder on Windows
 * (kosmos#8378). Require it FIRST in a test file, in place of tmpscope:
 *
 *     require('../test-support/tmpscope-outside-home');
 *
 * WHY: on Windows the temp folder is usually inside the home (C:\Users\<user>\AppData\Local\Temp, on a person's
 * computer and on GitHub's Windows runners, where TEMP is written in its short 8.3 form, C:\Users\RUNNER~1\..., and the
 * home in its long one, C:\Users\runneradmin), so a sandbox made under it has the real home as an ancestor. The
 * token-only guard (engine/setup-assistant.js tokenOnlySettingsRules) walks every ancestor of an agent's folder and reads
 * the instruction files there (CLAUDE.md, AGENTS.md, .claude/CLAUDE.md and its rules) and everything they import. So a
 * guard test whose sandbox sat in the temp folder read the REAL ~/.claude/CLAUDE.md and its imports, and its result
 * depended on what the computer running it has there (measured on the Windows box: the imported BULLETINS.md and two
 * more named in the reason, and the guard not whole). On the Mac and Linux the temp folder is not in the home, so nothing
 * changes there.
 *
 * HOW: on a Windows host whose temp folder is inside the home (compared by their real paths, case-blind, so the short
 * and long spellings of one folder match), TEMP and TMP are pointed at the system temp folder (%SystemRoot%\Temp, which
 * a standard account may create folders in) before tmpscope runs, so tmpscope's per-process folder, and every fixture
 * made in it, lands there and is removed at exit as before. The place is used only if a folder can be made in it and
 * neither it nor any folder above it holds an instruction file or a .claude folder; otherwise nothing is changed, the
 * file behaves exactly as with tmpscope alone, and one line on stderr says why (so a later failure has a visible cause).
 * A host whose temp folder is already outside the home is left alone, silently.
 *
 * WHAT IT DOES NOT COVER (a risk to the tests being deterministic, not to the product):
 *  - %SystemRoot%\Temp is shared by every account on the computer. A standard account cannot list it, so a scope left
 *    there by a run that was killed (which tmpscope cannot sweep) is invisible to that account; it is still removable by
 *    its owner, by its name.
 *  - The create right BUILTIN\Users holds on %SystemRoot%\Temp is inherited by the folders made in it, so another local
 *    account that guessed a run's random kts- name could add a file inside that run's scope while it runs.
 *
 * It must never throw, for the reason tmpscope gives.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* The names looked for in the system temp folder and each folder above it. The guard reads CLAUDE.md, CLAUDE.local.md
   and AGENTS.md there, and in .claude the files CLAUDE.md and AGENTS.md and its rules folder (setup-assistant.js,
   topRoots and dotClaudeRoots). A bare .claude folder counts too, whatever it holds: conservative on purpose. */
const INSTRUCTION_NAMES = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', '.claude'];

/* The real path (a short 8.3 name spelled long, a link followed). A path that does not exist yet is resolved through its
   deepest existing folder with the rest added back, as the guard's realOrLeaf does, so a short spelling above a folder
   not made yet still compares by its long one (review round 2: on the runner TEMP is C:\Users\RUNNER~1\...). */
function realOrResolved(p) {
  const abs = path.resolve(p);
  const tail = [];
  for (let d = abs; ; d = path.dirname(d)) {
    try { return path.join(fs.realpathSync.native(d), ...tail); } catch { /* not there yet: climb */ }
    if (path.dirname(d) === d) return abs;
    tail.unshift(path.basename(d));
  }
}

const inside = (child, parent, real) => {
  const c = real(child).toLowerCase(), p = real(parent).toLowerCase();
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

/* What to do, and why: { inHome, root, why }. root is the folder to make the scope in, or null to leave TEMP alone;
   inHome says whether the temp folder is inside the home; why says why root is null. Seams (platform, tmp, home, env,
   exists, canMake, real) are for its own test; callers leave them out. */
function outsideHomeChoice({ platform = process.platform, tmp = os.tmpdir(), home = os.homedir(), env = process.env,
  exists = fs.existsSync, canMake = canMakeIn, real = realOrResolved } = {}) {
  if (platform !== 'win32') return { inHome: false, root: null, why: 'not Windows' };
  /* Review round 3: as the guard walks both the path as written and its real path (setup-assistant.js ancestorsOf), the
     temp folder counts as inside the home if either spelling is. */
  const ident = (p) => path.resolve(p);
  const insideEither = (child, parent) => inside(child, parent, ident) || inside(child, parent, real);
  if (!home || !insideEither(tmp, home)) return { inHome: false, root: null, why: 'the temp folder is not inside the home' };
  const no = (why) => ({ inHome: true, root: null, why });
  const sys = env.SystemRoot || env.windir;
  if (!sys) return no('neither SystemRoot nor windir is set, so the system temp folder is unknown');
  const root = path.join(sys, 'Temp');
  if (insideEither(root, home)) return no(`the system temp folder ${root} is inside the home too`);
  // Both chains above it too: the written one and the real one (a link in the way leads the guard up the other).
  for (const start of new Set([path.resolve(root), real(root)])) {
    for (let d = start; ; d = path.dirname(d)) {
      const found = INSTRUCTION_NAMES.find((n) => exists(path.join(d, n)));
      if (found) return no(`${path.join(d, found)} is there, and the guard would read it as an instruction file`);
      if (path.dirname(d) === d) break;
    }
  }
  if (!canMake(root)) return no(`a folder cannot be made in ${root}`);
  return { inHome: true, root, why: null };
}

function outsideHomeRoot(opts) { return outsideHomeChoice(opts).root; }

function canMakeIn(root) {
  try { const d = fs.mkdtempSync(path.join(root, 'kts-probe-')); fs.rmdirSync(d); return true; } catch { return false; }
}

let choice = null;
try {
  /* Only before tmpscope has run in this process: once it has, its folder is already made, and moving TEMP now would
     put later fixtures outside it, where nothing removes them. */
  if (!require.cache[require.resolve('./tmpscope')]) {
    choice = outsideHomeChoice();
    if (choice.root) { process.env.TEMP = choice.root; process.env.TMP = choice.root; }
    else if (choice.inHome) process.stderr.write(`tmpscope-outside-home (kosmos#8378): the temp folder stays inside the home, so a guard test here can read this computer's own instruction files: ${choice.why}\n`);
  }
} catch { choice = null; }

const tmpscope = require('./tmpscope');

module.exports = { ...tmpscope, outsideHomeRoot, outsideHomeChoice, realOrResolved, choice: () => choice, movedTo: () => (choice && choice.root) || null };
