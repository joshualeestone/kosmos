'use strict';

/*
 * kosmos#4326 -- preloaded into EVERY test process by tools/run-tests.sh
 * (`node --test --require ./test-support/tool-guard.js`, beside launch-guard.js). It refuses
 * to spawn a REAL `gh`, `vercel` or `cloudflared`: the operator's own CLIs, signed in (or not)
 * to their own accounts. A test must never reach them. On 2026-09-28 a test that read
 * /api/connections without setting AGENT_WORKFORCE_VERCEL_BIN ran the real `vercel whoami`,
 * which waited forever on an unauthenticated prompt and spun for 2h39m at ~600 MB.
 *
 * "Real" means the command's basename is one of those tools and it does NOT resolve inside
 * this repo or the OS temp dir, where a test's own fakes live. A refused spawn throws (so
 * nothing runs) and writes one line naming the override to set. It ALSO throws again on the
 * next tick, uncaught, so the FILE fails: the connections sweep catches a door's error and
 * reports "could not check", so the first throw alone would read as a passing test. An
 * uncaught exception fails the file whatever the test caught (tool-guard-4326.test.js pins it).
 *
 * Like launch-guard.js it covers only this process's spawns, and it is standalone (node
 * built-ins only), so it runs before any test file sets its sandbox seams.
 */

const cp = require('node:child_process');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const TOOLS = { gh: 'AGENT_WORKFORCE_GH_BIN', vercel: 'AGENT_WORKFORCE_VERCEL_BIN', cloudflared: 'AGENT_WORKFORCE_CLOUDFLARED_BIN' };
const REPO = path.resolve(__dirname, '..');
const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };
const ALLOWED_ROOTS = [real(REPO), real(os.tmpdir()), path.resolve(os.tmpdir())];

function refusedTool(command) {
  if (typeof command !== 'string' || !command) return null;
  const base = path.basename(command);
  if (!Object.prototype.hasOwnProperty.call(TOOLS, base)) return null;
  // A bare name resolves through PATH to the operator's install: always real.
  if (!command.includes('/')) return base;
  const where = real(command);
  if (ALLOWED_ROOTS.some((r) => where === r || where.startsWith(r + path.sep))) return null;
  return base;
}

function refuse(fn, base, command) {
  const msg = `#4326: a test tried to run the REAL ${base} (${command}) via child_process.${fn}. ` +
    `Point ${TOOLS[base]} at a fake (tools/run-tests.sh exports test-support/fake-cli-signed-out.sh).`;
  try { process.stderr.write(msg + '\n'); } catch { /* the throw still carries it */ }
  // Out of the caller's reach: an uncaught exception fails the test file whatever it caught.
  setImmediate(() => { throw new Error(msg); });
  return new Error(msg);
}

for (const fn of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const orig = cp[fn];
  cp[fn] = function guarded(command, ...rest) {
    const base = refusedTool(command);
    if (base) throw refuse(fn, base, command);
    return orig.call(this, command, ...rest);
  };
}

module.exports = { refusedTool };
