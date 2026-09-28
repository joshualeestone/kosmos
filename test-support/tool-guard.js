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
 *     with `shell: true`, or a shell (`sh`/`bash`/`zsh`/`dash`) given `-c`, the command word of
 *     each segment of the script.
 *   - exec / execSync: the command word of each segment of the command string.
 * Command position only, so a tool named in an ARGUMENT (a commit message) is not refused.
 * A refused call throws (so nothing runs) and writes one line saying what to do. It ALSO throws
 * again on the next tick, uncaught, so the FILE fails whatever the test caught: the connections
 * sweep swallows a door's error and reports "could not check", so the first throw alone would
 * read as a passing test (test-support.tool-guard-4326.test.js pins both).
 *
 * NOT SEEN: a tool reached through another interpreter's own process API (a python or node
 * child that spawns it), a name built at runtime inside a shell script FILE, and spawns made by
 * child processes (like launch-guard.js, it guards only this process). execFile and exec keep
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
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
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
  if (!w.includes('/')) return base;   // a bare name resolves through PATH: the operator's install
  const where = real(path.resolve(cwd || process.cwd(), w));
  if (ALLOWED_ROOTS.some((r) => where === r || where.startsWith(r + path.sep))) return null;
  return base;
}
// A shell script: the COMMAND word of each segment (split on ; && || | newlines, backticks and
// $( ), skipping VAR=value assignments and env/exec/command/nohup/time prefixes. Only command
// position counts, so `git commit -m "fix the gh door"` is not refused for its argument.
const PREFIXES = new Set(['env', 'exec', 'command', 'nohup', 'time', 'sudo']);
function realToolInScript(script, cwd, env) {
  if (typeof script !== 'string') return null;
  for (const seg of script.split(/;|&&|\|\||\||\n|`|\$\(/)) {
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
  if (!hit && SHELLS.has(path.basename(String(command)))) {
    const c = argv.indexOf('-c');
    if (c >= 0) hit = realToolInScript(argv[c + 1], opts.cwd, opts.env);
  }
  return hit;
};
for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) wrap(fn, fileCheck);

// command-string callers
const stringCheck = (command, rest) => realToolInScript(command, optsOf(rest).cwd, optsOf(rest).env);
for (const fn of ['exec', 'execSync']) wrap(fn, stringCheck);

module.exports = { refusedTool, realToolInScript };
