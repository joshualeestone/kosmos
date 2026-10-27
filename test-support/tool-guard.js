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

const TOOLS = {
  gh: 'Point AGENT_WORKFORCE_GH_BIN at a fake (tools/run-tests.sh exports test-support/fake-cli-signed-out.sh).',
  vercel: 'Point AGENT_WORKFORCE_VERCEL_BIN at a fake (tools/run-tests.sh exports test-support/fake-cli-signed-out.sh).',
  cloudflared: 'No test should run cloudflared; stub the call instead.',
};
// #7262: the words a call runs as commands, shared with the Windows scheduler guard.
const { callWords, lineWords } = require(path.join(__dirname, '..', 'tools', 'lib', 'command-words.cjs'));
const REPO = path.resolve(__dirname, '..');
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const ALLOWED_ROOTS = [real(REPO), real(os.tmpdir()), path.resolve(os.tmpdir())];

// One command word: is it a real tool? `cwd` resolves a relative path the way the spawn will.
function realToolIn(word, cwd, env) {
  if (typeof word !== 'string' || !word) return null;
  // Expand $VAR / ${VAR} from the call's env (else this process's) and drop quotes, so a fake
  // reached as "$TMPDIR"/fake/gh resolves where the shell will put it.
  const vars = env || process.env;
  const w = word.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (m, k) => (vars[k] != null ? String(vars[k]) : m))
    .replace(/['"]/g, '').replace(/^\(+|[);]+$/g, '');
  const base = path.basename(w);
  if (!Object.prototype.hasOwnProperty.call(TOOLS, base)) return null;
  let where;
  if (!w.includes('/')) {
    // A bare name runs whatever the CALL's PATH finds first. Refuse only if that is a real
    // install; a PATH-stub dir of fakes (the standard pattern) is allowed, and a name found
    // nowhere would not run at all.
    const found = onPath(w, vars.PATH);
    if (!found) return null;
    where = real(found);
  } else {
    where = real(path.resolve(cwd || process.cwd(), w));
  }
  // Test seam (the guard's own test only): dirs whose tools count as REAL installs even under the
  // temp dir, so the refusal can be proven with a harmless stand-in instead of the operator's CLI.
  const realDirs = String(process.env.KOSMOS_TOOL_GUARD_REAL_DIRS || '').split(path.delimiter).filter(Boolean).map(real);
  if (realDirs.some((r) => where === r || where.startsWith(r + path.sep))) return base;
  if (ALLOWED_ROOTS.some((r) => where === r || where.startsWith(r + path.sep))) return null;
  return base;
}
function onPath(name, pathVar) {
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
