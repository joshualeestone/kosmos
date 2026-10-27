'use strict';

/*
 * kosmos#4326 -- preloaded into EVERY test process by tools/run-tests.sh
 * (`node --test --require ./test-support/tool-guard.js`, beside launch-guard.js). It refuses
 * to run a REAL `gh`, `vercel` or `cloudflared`: the operator's own CLIs, signed in (or not)
 * to their own accounts. On 2026-09-28 a real `vercel whoami` started by a test's board waited
 * forever on an unauthenticated prompt and spun for 2h39m at ~600 MB.
 *
 * This is the suite-wide net under the per-file fix #4309 (test-support/nohostcli.js), which
 * three connections tests use: those point the doors at nothing; this catches any OTHER test.
 *
 * "Real" means the tool's name appears as a command and does NOT resolve inside this repo or the
 * OS temp dir, where a test's own fakes live. Which words a call runs as commands is read by
 * tools/lib/command-words.cjs (#7262), the one reader this guard shares with the Windows
 * scheduler guard (tools/lib/schtasks-call.cjs), so the two cannot drift apart: the file of a
 * spawn / spawnSync / execFile / execFileSync (resolved against the call's `cwd`), what a shell
 * or launcher given as that file starts (`sh -c`, `bash -lc`, `cmd /c`, `powershell -Command`
 * and `-EncodedCommand`, `env`, `sudo`), every command of a `shell: true` or exec / execSync
 * string, and the prefixes in front of a command (NAME=value, nohup, exec, time, timeout, if,
 * `!` and others; command-words.cjs lists them, and what it does not see).
 * Command position only, so a tool named in an ARGUMENT (a commit message) is not refused.
 * A refused call throws (so nothing runs) and writes one line saying what to do. It ALSO throws
 * again on the next tick, uncaught, so the FILE fails whatever the test caught: the connections
 * sweep swallows a door's error and reports "could not check", so the first throw alone would
 * read as a passing test (test-support.tool-guard-4326.test.js pins both).
 *
 * cloudflared is listed although nothing in the repo spawns it today (the Cloudflare door checks
 * its token over HTTP): #4326 asked for it, and a future door that shells out is covered first.
 *
 * NOT SEEN (measured in review, accepted): a tool behind a launcher the reader does not know
 * (`npx vercel`, `xargs vercel`, `node .../vercel`); any shell script FILE (`bash x.sh`: the
 * file is never read); a tool reached through another interpreter's process API (python, a node
 * child); a shell function named like a tool (`gh() {...}; gh`, refused though it runs no CLI);
 * and spawns made by child processes (like launch-guard.js, it guards only this process). A
 * bare name is judged by the CALL's PATH: refused only when that PATH finds a real install.
 * execFile and exec keep their util.promisify.custom, so a promisify caller still gets
 * { stdout, stderr }.
 */

const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const util = require('node:util');
const url = require('node:url');

const TOOLS = {
  gh: 'Point AGENT_WORKFORCE_GH_BIN at a fake (tools/run-tests.sh exports test-support/fake-cli-signed-out.sh).',
  vercel: 'Point AGENT_WORKFORCE_VERCEL_BIN at a fake (tools/run-tests.sh exports test-support/fake-cli-signed-out.sh).',
  cloudflared: 'No test should run cloudflared; stub the call instead.',
};
// #7262: the words a call runs as commands, shared with the Windows scheduler guard.
const { callWords, lineWords } = require(path.join(__dirname, '..', 'tools', 'lib', 'command-words.cjs'));
const REPO = path.resolve(__dirname, '..');
/* #7318: on Windows a program is gh.exe or vercel.cmd (any PATHEXT extension, in any case), a path may use \ or a
   drive letter, a bare name is found in the current directory and then on PATH with each PATHEXT extension, and paths
   and variable names compare case-insensitively. Everywhere else the POSIX reading below is unchanged. */
const WIN = process.platform === 'win32';
// realpathSync.native on Windows also expands an 8.3 short name (C:\Users\RUNNER~1), so a fake under the temp dir
// is still seen under it however the temp dir is spelled.
const real = (p) => { try { return WIN ? fs.realpathSync.native(p) : fs.realpathSync(p); } catch { return path.resolve(p); } };
const ALLOWED_ROOTS = [real(REPO), real(os.tmpdir()), path.resolve(os.tmpdir())];
// A variable from an env object. On Windows names are case-insensitive, and when an env holds two spellings (a copy of
// process.env keeps "Path", a test adds "PATH") node sorts the keys and the child gets the first: so does this (review 1
// of #7318). An env with no PATH at all still searches the parent's PATH, as node does.
function envVar(vars, name) {
  if (!WIN) return vars[name];
  const k = Object.keys(vars).filter((x) => x.toUpperCase() === name.toUpperCase()).sort()[0];
  if (k !== undefined) return vars[k];
  return name.toUpperCase() === 'PATH' && vars !== process.env ? envVar(process.env, name) : undefined;
}
function pathExts(vars) {
  return String(envVar(vars, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
// The tool a file name is, or null: exactly gh / vercel / cloudflared, or on Windows any case with a PATHEXT extension;
// .exe and .com always count, since Windows runs one given by path whatever PATHEXT says.
function toolName(base, vars) {
  if (!WIN) return Object.prototype.hasOwnProperty.call(TOOLS, base) ? base : null;
  const lower = base.toLowerCase();
  const exts = ['.exe', '.com'].concat(pathExts(vars));
  return Object.keys(TOOLS).find((n) => lower === n || exts.some((e) => lower === n + e)) || null;
}
const isPathWord = (w) => (WIN ? /[\\/]/.test(w) || /^[A-Za-z]:/.test(w) : w.includes('/'));
const within = (where, root) => {
  const a = WIN ? where.toLowerCase() : where;
  const b = WIN ? root.toLowerCase() : root;
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep);   // a drive root (C:\) already ends in one
};

// One command word: is it a real tool? `cwd` resolves a relative path the way the spawn will.
function realToolIn(word, cwd, env) {
  if (typeof word !== 'string' || !word) return null;
  if (cwd != null && typeof cwd !== 'string') cwd = cwd instanceof URL ? url.fileURLToPath(cwd) : String(cwd);   // node takes a URL
  // Expand $VAR / ${VAR} (and cmd's %VAR% on Windows) from the call's env (else this process's) and drop quotes, so a
  // fake reached as "$TMPDIR"/fake/gh resolves where the shell will put it.
  const vars = env || process.env;
  const expand = (m, k) => (envVar(vars, k) != null ? String(envVar(vars, k)) : m);
  let w = word.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, expand);
  if (WIN) w = w.replace(/%([A-Za-z_][A-Za-z0-9_()]*)%/g, expand);
  w = w.replace(/['"]/g, '').replace(/^\(+|[);]+$/g, '');
  const name = toolName(path.basename(w), vars);
  if (!name) return null;
  // Test seam (the guard's own test only): dirs whose tools count as REAL installs even under the
  // temp dir, so the refusal can be proven with a harmless stand-in instead of the operator's CLI.
  const realDirs = String(process.env.KOSMOS_TOOL_GUARD_REAL_DIRS || '').split(path.delimiter).filter(Boolean).map(real);
  const isReal = (where) => realDirs.some((r) => within(where, r)) || !ALLOWED_ROOTS.some((r) => within(where, r));
  if (isPathWord(w)) return isReal(real(path.resolve(cwd || process.cwd(), w))) ? name : null;
  // A bare name runs whatever the CALL's PATH finds first. Refuse only if that is a real install; a PATH-stub dir of
  // fakes (the standard pattern) is allowed, and a name found nowhere would not run at all. On Windows the file found
  // first depends on who looks (node, cmd or bash, review 2 of #7318), so each one's first find is judged, and any real
  // one refuses.
  return onPath(w, envVar(vars, 'PATH'), vars, cwd).some((found) => isReal(real(found))) ? name : null;
}
/* The files a bare name runs, as a list: on Windows the first find of each one that may look it up, since each looks
   differently (measured, review 2 of #7318): node without a shell tries the name as given when it has an extension,
   else .com then .exe, in the current directory unless this process has NoDefaultCurrentDirectoryInExePath, then PATH;
   cmd tries the child env's PATHEXT, in the current directory unless the child env has that variable; Git Bash tries
   the name and then .exe, on PATH only. So a fake gh.cmd ahead of a real gh.exe on PATH hides nothing: node runs the
   gh.exe. Elsewhere, the one file PATH finds. Any regular file runs on Windows (no execute bit). */
function onPath(name, pathVar, vars, cwd) {
  if (WIN) {
    const dirs = String(pathVar || '').split(';').map((d) => d.replace(/^"|"$/g, '')).filter(Boolean);
    const here = cwd || process.cwd();
    const exts = pathExts(vars || {});
    const lower = name.toLowerCase();
    const hasExt = /\.[^.\\/]+$/.test(name);
    const first = (tries, ds) => {
      for (const d of ds) {
        for (const t of tries) {
          const p = path.join(d, t);
          try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
        }
      }
      return null;
    };
    const finds = [
      first(hasExt ? [name] : [name + '.com', name + '.exe'], (process.env.NoDefaultCurrentDirectoryInExePath ? [] : [here]).concat(dirs)),
      first(exts.some((e) => lower.endsWith(e)) ? [name] : exts.map((e) => name + e), (envVar(vars || {}, 'NoDefaultCurrentDirectoryInExePath') ? [] : [here]).concat(dirs)),
      first(hasExt ? [name] : [name, name + '.exe'], dirs),
    ];
    return finds.filter(Boolean);
  }
  return [onPosixPath(name, pathVar)].filter(Boolean);
}
function onPosixPath(name, pathVar) {
  for (const dir of String(pathVar || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    // A regular file with an execute bit, read from a stat: an execute-permission access check
    // also says yes to a directory (the #1592 trap engine.runnable-not-directory.test.js audits).
    try { const st = fs.statSync(p); if (st.isFile() && (st.mode & 0o111)) return p; } catch { /* next */ }
  }
  return null;
}
// The first real tool among a list of command words, or null.
function realToolInWords(list, cwd, env) {
  for (const word of list) {
    const hit = realToolIn(word, cwd, env);
    if (hit) return hit;
  }
  return null;
}
// A shell script: every word in command position (command-words.cjs), so
// `git commit -m "fix the gh door"` is not refused for its argument.
function realToolInScript(script, cwd, env) {
  if (typeof script !== 'string') return null;
  return realToolInWords(lineWords(script), cwd, env);
}
// The single-command check, exported for the test.
function refusedTool(command, cwd) { return realToolIn(command, cwd); }

function optsOf(args) {
  for (const a of args) if (a && typeof a === 'object' && !Array.isArray(a)) return a;
  return {};
}
function argvOf(args) { return Array.isArray(args[0]) ? args[0] : []; }

function refuse(fn, base, command) {
  const msg = `#4326: a test tried to run the REAL ${base} (${String(command).slice(0, 120)}) via ` +
    `child_process.${fn}. ${TOOLS[base]}`;
  try { process.stderr.write(msg + '\n'); } catch { /* the throw still carries it */ }
  // Out of the caller's reach: an uncaught exception fails the test file whatever it caught.
  setImmediate(() => { throw new Error(msg); });
  return new Error(msg);
}

function wrap(fn, check) {
  const orig = cp[fn];
  const guarded = function guarded(command, ...rest) {
    const hit = check(command, rest);
    if (hit) throw refuse(fn, hit, command);
    return orig.call(this, command, ...rest);
  };
  // execFile and exec carry util.promisify.custom (they resolve { stdout, stderr }); keep it,
  // guarded, or every promisify caller silently gets a different shape (#4326 review, measured).
  const promised = orig[util.promisify.custom];
  if (promised) {
    guarded[util.promisify.custom] = function guardedPromised(command, ...rest) {
      const hit = check(command, rest);
      if (hit) return Promise.reject(refuse(fn, hit, command));
      return promised.call(this, command, ...rest);
    };
  }
  cp[fn] = guarded;
}

// file + argv callers
const fileCheck = (command, rest) => {
  const opts = optsOf(rest);
  // The file itself, as given: callWords reads a shell: true call as one command line, whose
  // first word is the file cut at its spaces.
  return realToolIn(command, opts.cwd, opts.env)
    || realToolInWords(callWords(command, argvOf(rest), opts), opts.cwd, opts.env);
};
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) wrap(fn, fileCheck);

// command-string callers
const stringCheck = (command, rest) => realToolInScript(command, optsOf(rest).cwd, optsOf(rest).env);
for (const fn of ['exec', 'execSync']) wrap(fn, stringCheck);

// The spawn / execFile check without the wrapping, for the guard's own tests (#7262).
const refusedCall = (file, args, options) => fileCheck(file, [args, options].filter((x) => x !== undefined));

module.exports = { refusedTool, realToolInScript, refusedCall };
