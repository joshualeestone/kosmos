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
 * Call it before requiring ./server: engine/devicedoor.js takes execFile and spawn from
 * node:child_process when it loads, so wrapping them later records nothing.
 */
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

function sandboxHostClis(sandbox) {
  process.env.AGENT_WORKFORCE_GH_BIN = path.join(sandbox, 'no-such-gh');
  process.env.AGENT_WORKFORCE_VERCEL_BIN = path.join(sandbox, 'no-such-vercel');
  const started = [];
  for (const name of ['execFile', 'spawn']) {
    const real = childProcess[name];
    childProcess[name] = function recorded(file, ...rest) { started.push(String(file)); return real.call(this, file, ...rest); };
  }
  return {
    started,
    assertNoHostCli(assert, home) {
      const host = started.filter((f) => /(^|\/)(gh|vercel)$/.test(f));
      assert.deepEqual(host, [], 'a sweep started the host\'s own CLI, which can outlive this test and write into its sandbox after it exits');
      for (const left of ['Library', '.npm']) {
        assert.equal(fs.existsSync(path.join(home, left)), false, 'home/' + left + ' exists, so a host tool wrote into this sandbox');
      }
    },
  };
}

module.exports = { sandboxHostClis };
