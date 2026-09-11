'use strict';
/* #570: the real board names the build its PROCESS loaded in a header on GET /.
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
const { BOARD_BUILD_HEADER, buildIdentity } = require('./engine/win32handoff');

test('GET / names the build this process loaded, the same identity the hand-off computes for itself', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const res = await fetch(`http://127.0.0.1:${server.address().port}/`);
  assert.equal(res.status, 200);
  const named = res.headers.get(BOARD_BUILD_HEADER);
  const { version } = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  assert.ok(named, 'the page response no longer names the running build');
  assert.equal(named, buildIdentity(__dirname), 'the header and the hand-off derive the build two different ways');
  assert.ok(named.startsWith(version), 'the build does not lead with package.json\'s version');
});
