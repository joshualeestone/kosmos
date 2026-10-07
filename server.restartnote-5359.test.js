'use strict';
/* #5359 part 1: the board's restart-note routes, and the start-up call that writes when the board was last alive.
   engine/restartnote-5359.test.js covers the rule; this covers the wiring a page and a restart depend on. */
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is contained and removed
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

/* Review 5: start() must also arm the once-a-minute beat, or the record holds only the start time and a board that ran
   for hours before the computer died never makes a note. server.js requires this same cached module, so wrapping it
   here records the call without waiting a minute. */
let beatsArmed = 0;
const realStartBeating = rn.startBeating;
rn.startBeating = (...a) => { beatsArmed++; const t = realStartBeating(...a); if (t && t.unref) t.unref(); return t; };
// #5450: the launcher's word is taken out of the environment when server.js loads, before anything could inherit it.
process.env.KOSMOS_BOARD_STARTED_BY = 'supervisor';
process.env.KOSMOS_BOARD_PERSON_MARK = '/nonexistent/board.person-start';
process.env.KOSMOS_START_BY = 'supervisor';
const { start, server } = require('./server');
const STARTED_BY_LEFT = 'KOSMOS_BOARD_STARTED_BY' in process.env || 'KOSMOS_BOARD_PERSON_MARK' in process.env || 'KOSMOS_START_BY' in process.env;

test('#5359: the board serves the restart note, records a dismiss, and says it is alive at start', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const alive = JSON.parse(fs.readFileSync(rn._files.aliveFile(), 'utf8'));
  assert.ok(Math.abs(Date.parse(alive.at) - Date.now()) < 60000, 'start did not write when the board was last alive');
  assert.equal(beatsArmed, 1, 'start did not arm the once-a-minute beat');

  const first = await (await fetch(`${base}/api/board/restart-note`)).json();
  assert.ok(first.note, 'the note was not served');
  assert.equal(first.note.bootAt, new Date(now - 7 * 60000).toISOString());

  const d = await fetch(`${base}/api/board/restart-note/dismiss`, { method: 'POST' });
  assert.equal(d.status, 200);
  assert.deepEqual(await d.json(), { dismissed: true });

  const after = await (await fetch(`${base}/api/board/restart-note`)).json();
  assert.equal(after.note, null, 'the note was served after it was dismissed');
});

test('#5450: loading server.js removes the launcher\'s word from the environment (no agent it starts inherits it)', () => {
  assert.equal(STARTED_BY_LEFT, false);
});
