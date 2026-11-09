'use strict';
/* kosmos#8287: the restart-note route answers what was checked, from the roster now, and the page never gets the list. */
require('./test-support/tmpscope');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartnote-8287-' + p + '-'));
process.env.HOME = tmp('home');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = tmp('data');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('proj');
process.env.AGENT_WORKFORCE_WORKERS = tmp('work');
process.env.AGENT_WORKFORCE_LAUNCH = tmp('launch');

const rn = require('./engine/restartnote');
const now = Date.now();
fs.mkdirSync(path.dirname(rn._files.noteFile()), { recursive: true });
fs.writeFileSync(rn._files.noteFile(), JSON.stringify({
  lastAliveAt: new Date(now - 9 * 60000).toISOString(), bootAt: new Date(now - 7 * 60000).toISOString(), upAt: new Date(now - 60000).toISOString(),
  dismissed: false, wereRunning: [{ session: 'nobodyhere', name: 'Nobody Here' }], files: { damaged: 2 },
}));
let atStartGot = null;
const realAtStart = rn.atStart;
rn.atStart = (deps) => { atStartGot = deps || null; return realAtStart(deps); };
const realStartBeating = rn.startBeating;
rn.startBeating = (...a) => { const t = realStartBeating(...a); if (t && t.unref) t.unref(); return t; };
const { start, server } = require('./server');

test('#8287: the route says what was checked, names who is not back, and keeps the list to itself', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const got = await (await fetch(`http://127.0.0.1:${server.address().port}/api/board/restart-note`)).json();
  assert.ok(got.note, 'the note was not served');
  assert.deepEqual(got.note.checks, { agents: { was: 1, back: 0, notBack: ['Nobody Here'] }, files: { damaged: 2 } });
  assert.equal('wereRunning' in got.note, false, 'the page was sent the recorded list');
  assert.equal('files' in got.note, false, 'the raw record reached the page beside checks');
});

test('#8287: start() hands atStart the result of the file check', () => {
  assert.ok(atStartGot, 'start() never called atStart');
  assert.ok(atStartGot.files && typeof atStartGot.files.checked === 'boolean', 'atStart was not given the file check');
});
