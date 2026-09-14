'use strict';
/* #570: the real board names the build its PROCESS loaded, and the world it booted,
   in a header on GET /.
   The Windows hand-off (engine/win32handoff.js) reads it to tell the code that is
   running from the files on disk -- the page cannot, because it is read per
   request. Driven through the real server, not a grep of its source. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-buildheader-570-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
/* kosmos#1651: DRY_RUN stops tmux WRITES; the roster is a READ and only
   TMUX_BIN redirects one, so the whole-sandbox guard requires it. */
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-buildheader-570-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-buildheader-570-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-buildheader-570-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-buildheader-570-launch-'));

const { start, server } = require('./server');
const { BOARD_IDENTITY_HEADER, buildIdentity, boardIdentity } = require('./engine/win32handoff');

test('GET / names the build this process loaded and the world it booted, the same identity the hand-off computes for itself', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(res.status, 200);
  const named = res.headers.get(BOARD_IDENTITY_HEADER);
  const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.ok(named, 'the page response no longer names the running build');
  assert.equal(named, boardIdentity(buildIdentity(__dirname), require('./engine/worldenv').bootedWorld()), 'the header and the hand-off derive the identity two different ways');
  assert.ok(named.startsWith(version), 'the build does not lead with package.json\'s version');

  /* #2973 review round 1: the board also says whether its logon task started it, which
     the Windows hand-off needs before it may end a board, and reads it per request from
     the marker the task's boot shim stamps. '1' only when that marker is there. */
  const { BOARD_STARTED_BY_TASK_HEADER } = require('./engine/win32handoff');
  const { MARKER_ENV, TASK_NAME } = require('./engine/win32board');
  const saved = process.env[MARKER_ENV];
  try {
    delete process.env[MARKER_ENV];
    const byHand = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(byHand.headers.get(BOARD_STARTED_BY_TASK_HEADER), '0', 'a board its task did not start must not claim it');
    process.env[MARKER_ENV] = TASK_NAME;
    const byTask = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(byTask.headers.get(BOARD_STARTED_BY_TASK_HEADER), '1', 'a board its task started says so');
    process.env[MARKER_ENV] = 'Kosmos\\agent-fred';
    const other = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(other.headers.get(BOARD_STARTED_BY_TASK_HEADER), '0', 'only the BOARD task\'s marker counts');
  } finally {
    if (saved === undefined) delete process.env[MARKER_ENV]; else process.env[MARKER_ENV] = saved;
  }
});

test('#570: the hand-off is given the LAUNCH env, copied before the world bootstrap, and the identity is the BOOTED world', () => {
  /* A named world's bootstrap writes AGENT_WORKFORCE_* into process.env, and the
     hand-off would read that as the launch choosing its own data folder -- so a
     named-world user never got the hand-off. Source order is the assertion
     because the hand-off only runs in the real-startup block, as
     server.worldenv-order.test.js does for the bootstrap itself. The live GET /
     test above cannot tell a booted world from a constant (both are the default
     world here), so the source also pins where the world comes from. The world
     boot-attempt handling is tested for real in engine/win32handoff.test.js. */
  const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const copied = src.indexOf('const LAUNCH_ENV_OVERRIDES');
  const bootstrap = src.indexOf('bootstrapWorldEnv(process.env)');
  assert.ok(copied > -1 && bootstrap > -1 && copied < bootstrap, 'the launch env is not copied before the world bootstrap rewrites it');
  assert.match(src, /handOffToTask\(\{[^}]*env: LAUNCH_ENV_OVERRIDES/, 'the hand-off reads process.env after the bootstrap, so a named world looks like an override');
  assert.match(src, /const BOARD_IDENTITY = boardIdentity\([^;]*require\('\.\/engine\/worldenv'\)\.bootedWorld\(\)\)/, 'the identity no longer names the booted world');
});
