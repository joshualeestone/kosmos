'use strict';
/* #5359 part 1: the board's restart-note routes, and the start-up call that writes when the board was last alive.
   engine/restartnote-5359.test.js covers the rule; this covers the wiring a page and a restart depend on. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartnote-' + p + '-'));
process.env.HOME = tmp('home');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = tmp('data');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('proj');
process.env.AGENT_WORKFORCE_WORKERS = tmp('work');
process.env.AGENT_WORKFORCE_LAUNCH = tmp('launch');

const rn = require('./engine/restartnote');
// A note as a start would have left it a few minutes ago.
const now = Date.now();
fs.mkdirSync(path.dirname(rn._files.noteFile()), { recursive: true });
fs.writeFileSync(rn._files.noteFile(), JSON.stringify({
  lastAliveAt: new Date(now - 9 * 60000).toISOString(), bootAt: new Date(now - 7 * 60000).toISOString(),
  upAt: new Date(now - 60000).toISOString(), dismissed: false,
}));

const { start, server } = require('./server');

test('#5359: the board serves the restart note, records a dismiss, and says it is alive at start', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const alive = JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8'));
  assert.ok(Math.abs(Date.parse(alive.at) - Date.now()) < 60000, 'start did not write when the board was last alive');

  const first = await (await fetch(`${base}/api/board/restart-note`)).json();
  assert.ok(first.note, 'the note was not served');
  assert.equal(first.note.bootAt, new Date(now - 7 * 60000).toISOString());

  const d = await fetch(`${base}/api/board/restart-note/dismiss`, { method: 'POST' });
  assert.equal(d.status, 200);
  assert.deepEqual(await d.json(), { dismissed: true });

  const after = await (await fetch(`${base}/api/board/restart-note`)).json();
  assert.equal(after.note, null, 'the note was served after it was dismissed');
});
