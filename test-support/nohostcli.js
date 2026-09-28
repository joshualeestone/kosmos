'use strict';
/**
 * Keep a sandboxed board from running the HOST's own `gh` and `vercel` (kosmos#4309).
 *
 *     const hostClis = require('./test-support/nohostcli').sandboxHostClis(SANDBOX);
 *     const { start, server } = require('./server');   // after, never before
 *     ...
 *     test('#4309: no host gh or vercel ran with this sandbox as its home', () => hostClis.assertNoHostCli(assert, HOME));
 *
 * A route that asks the gh or Vercel door (GET /api/connections does) otherwise runs the real
 * CLI with the test's HOME. The measured cause and the before/after runs are in
 * .claude/plans/xsitechild-4309.md.
 *
 * Call it before requiring ./server: engine/devicedoor.js takes spawn from node:child_process
 * when it loads (its status probe runs through spawn since #4326), so wrapping it later records
 * nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const childProcess = require('node:child_process');

// Vercel's own folders under HOME, and the npm log its update check writes. Board code can write
// elsewhere under HOME/Library itself, so only these are read as a host tool's footprint.
const HOST_CLI_FOOTPRINT = [
  path.join('Library', 'Application Support', 'com.vercel.cli'),
  path.join('Library', 'Caches', 'com.vercel.cli'),
  path.join('.npm', '_logs'),
];

function sandboxHostClis(sandbox) {
  process.env.AGENT_WORKFORCE_GH_BIN = path.join(sandbox, 'no-such-gh');
  process.env.AGENT_WORKFORCE_VERCEL_BIN = path.join(sandbox, 'no-such-vercel');
  const started = [];
  for (const name of ['execFile', 'spawn']) {
    const real = childProcess[name];
    const recorded = function recorded(file, ...rest) { started.push(String(file)); return real.call(this, file, ...rest); };
    // execFile carries util.promisify.custom (it resolves { stdout, stderr }); a promisify caller uses it
    // instead of the function, so it is wrapped too, to keep both its shape and the record.
    const realPromised = real[util.promisify.custom];
    if (realPromised) recorded[util.promisify.custom] = function recordedPromised(file, ...rest) { started.push(String(file)); return realPromised.call(this, file, ...rest); };
    childProcess[name] = recorded;
  }
  return {
    started,
    assertNoHostCli(assert, home) {
      const host = started.filter((f) => /(^|\/)(gh|vercel)$/.test(f));
      assert.deepEqual(host, [], 'a sweep started the host\'s own gh or vercel, which can outlive this test and write into its sandbox after it exits');
      for (const left of HOST_CLI_FOOTPRINT) {
        assert.equal(fs.existsSync(path.join(home, left)), false, 'home/' + left + ' exists: the Vercel CLI wrote into this sandbox');
      }
    },
  };
}

module.exports = { sandboxHostClis };
