'use strict';
/* #6160: the board's streak route. engine/streak-6160.test.js covers the day rule; this covers the wiring the page
   depends on: POST /api/streak records a visit on the page's date, answers { count, congrats }, says congrats on one
   call only, and refuses a body it cannot read without touching the count. */
require('./test-support/tmpscope');   // #4273: first, so every temp dir this file makes is contained and removed
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), 'aw-streak-' + p + '-'));
process.env.HOME = tmp('home');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = tmp('data');
process.env.AGENT_WORKFORCE_PROJECTS = tmp('proj');
process.env.AGENT_WORKFORCE_WORKERS = tmp('work');
process.env.AGENT_WORKFORCE_LAUNCH = tmp('launch');

const streak = require('./engine/streak');
const { start, server } = require('./server');

/* The board's own UTC date and the day before it: both are plausible local dates wherever the test runs. */
const utc = (ms) => new Date(ms).toISOString().slice(0, 10);
const TODAY = utc(Date.now()), YESTERDAY = utc(Date.now() - 86400000);

test('#6160: POST /api/streak records a visit, grows across a day, and congratulates once', async (t) => {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (body) => {
    const r = await fetch(`${base}/api/streak`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    return { status: r.status, json: await r.json() };
  };

  assert.deepEqual(await post(JSON.stringify({ today: YESTERDAY })), { status: 200, json: { count: 1, congrats: false } });
  assert.deepEqual(await post(JSON.stringify({ today: TODAY })), { status: 200, json: { count: 2, congrats: true } });
  assert.deepEqual(await post(JSON.stringify({ today: TODAY })), { status: 200, json: { count: 2, congrats: false } }, 'the note was offered twice on one day');
  assert.deepEqual(JSON.parse(fs.readFileSync(streak.file(), 'utf8')), { count: 2, last: TODAY, congratulated: TODAY });

  const bad = await post('{not json');
  assert.equal(bad.status, 400);
  assert.deepEqual(await post(JSON.stringify({ today: 'soon' })), { status: 200, json: { count: 2, congrats: false } }, 'a date it cannot read changed the count');
  assert.deepEqual(JSON.parse(fs.readFileSync(streak.file(), 'utf8')).count, 2);

  const get = await fetch(`${base}/api/streak`);
  assert.notEqual(get.status, 200, 'a GET must not record a visit');
});
