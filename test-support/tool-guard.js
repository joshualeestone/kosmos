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
 * OS temp dir, where a test's own fakes live. Checked:
 *   - spawn / spawnSync / execFile / execFileSync: the file, resolved against the call's `cwd`;
 *     with `shell: true`, or a shell given a script (`sh`/`bash`/`zsh`/`dash`/`ksh`/`fish` with a
 *     short-flag cluster containing `c` such as `-c` or `-lc`; `cmd /c`; `powershell`/`pwsh
 *     -Command`), the command word of each segment of the script.
 *   - exec / execSync: the command word of each segment of the command string.
 * Command position only, so a tool named in an ARGUMENT (a commit message) is not refused.
 * A refused call throws (so nothing runs) and writes one line saying what to do. It ALSO throws
 * again on the next tick, uncaught, so the FILE fails whatever the test caught: the connections
 * sweep swallows a door's error and reports "could not check", so the first throw alone would
 * read as a passing test (test-support.tool-guard-4326.test.js pins both).
 *
 * cloudflared is listed although nothing in the repo spawns it today (the Cloudflare door checks
 * its token over HTTP): #4326 asked for it, and a future door that shells out is covered first.
 *
 * NOT SEEN (measured in review, accepted): a tool behind a launcher the guard does not parse,
 * given as a FILE (`/usr/bin/env vercel`, `npx vercel`, `timeout 5 vercel`, `node .../vercel`)
 * or in a script after a keyword it does not skip (`if gh ...; then`, `! vercel`,
 * `xargs vercel`); any shell script FILE (`bash x.sh`: the file is never read); a tool reached
 * through another interpreter's process API (python, a node child); a shell function named
 * like a tool (`gh() {...}; gh`, refused though it runs no CLI); and spawns made by child
 * processes (like launch-guard.js, it guards only this process). A bare name is judged by the
 * CALL's PATH: refused only when that PATH finds a real install. execFile and exec keep
 * their util.promisify.custom, so a promisify caller still gets { stdout, stderr }.
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
// A shell and the flag that hands it a script. POSIX shells take it in any short-flag cluster
// (`-c`, `-lc`, `-ic`: the login-shell form is the common way to get a CLI on PATH); cmd.exe and
// PowerShell have their own. (Round 2 of the #4326 review measured `bash -lc` and `fish -c`
// getting past a literal '-c' check.)
const POSIX_SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
function scriptArgOf(command, argv) {
  const shell = path.basename(String(command)).toLowerCase().replace(/\.exe$/, '');
  if (POSIX_SHELLS.has(shell)) {
    const i = argv.findIndex((a) => typeof a === 'string' && /^-[A-Za-z]*c[A-Za-z]*$/.test(a));
    return i >= 0 ? argv[i + 1] : null;
  }
  if (shell === 'cmd') {
    const i = argv.findIndex((a) => typeof a === 'string' && /^\/[ck]$/i.test(a));
    return i >= 0 ? argv.slice(i + 1).join(' ') : null;
  }
  if (shell === 'powershell' || shell === 'pwsh') {
    const i = argv.findIndex((a) => typeof a === 'string' && /^-(c|command)$/i.test(a));
    return i >= 0 ? argv.slice(i + 1).join(' ') : null;
  }
  return null;
}
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
// A shell script: the COMMAND word of each segment (split on ; && || | newlines, backticks and
// $( ), skipping VAR=value assignments and env/exec/command/nohup/time prefixes. Only command
// position counts, so `git commit -m "fix the gh door"` is not refused for its argument.
const PREFIXES = new Set(['env', 'exec', 'command', 'nohup', 'time', 'sudo']);
// Split on ; && || | newline ` and $( OUTSIDE quotes only, so a separator inside a quoted
// argument (git commit -m "fix; gh door") does not start a new command.
function segments(script) {
  const out = [];
  let cur = '';
  let q = null;
  for (let i = 0; i < script.length; i += 1) {
    const c = script[i];
    if (q) { if (c === q) q = null; cur += c; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    const two = script.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '$(') { out.push(cur); cur = ''; i += 1; continue; }
    if (c === ';' || c === '|' || c === '\n' || c === '`') { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}
function realToolInScript(script, cwd, env) {
  if (typeof script !== 'string') return null;
  for (const seg of segments(script)) {
    const words = seg.trim().replace(/^[({\s]+/, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || PREFIXES.has(words[i]))) i += 1;
    const hit = realToolIn(words[i], cwd, env);
    if (hit) return hit;
  }
  return null;
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
  const argv = argvOf(rest);
  let hit = realToolIn(command, opts.cwd, opts.env);
  if (!hit && opts.shell) hit = realToolInScript([command].concat(argv).join(' '), opts.cwd, opts.env);
  if (!hit) {
    const script = scriptArgOf(command, argv);
    if (script) hit = realToolInScript(script, opts.cwd, opts.env);
  }
  return hit;
};
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) wrap(fn, fileCheck);

// command-string callers
const stringCheck = (command, rest) => realToolInScript(command, optsOf(rest).cwd, optsOf(rest).env);
for (const fn of ['exec', 'execSync']) wrap(fn, stringCheck);

module.exports = { refusedTool, realToolInScript };
