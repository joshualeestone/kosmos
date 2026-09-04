'use strict';
/*
 * kosmos#2037: the LOCAL /api/feedback route. GET lists the report dates and
 * returns a day's body; POST writes today's (or a given day's) report to the
 * user's own disk. The route reads NO send/opt-in flag - "store locally
 * regardless of the switch" - so these tests assert only local read/write.
 * A fresh test board is non-enforcing, so the sensitive-route gate lets the
 * fetches through without a board token (same as the other server route tests).
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert');

const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-feedback-route-'));
process.env.HOME = FAKE_HOME;
process.env.AGENT_WORKFORCE_DRY_RUN = '1';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-feedback-route-data-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-feedback-route-proj-'));
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-feedback-route-work-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-feedback-route-launch-'));

const { start, server } = require('./server');
const feedback = require('./engine/feedback');

async function boot(t) {
  await start(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('POST writes a report to local disk and GET reads it back', async (t) => {
  const base = await boot(t);
  const md = '## Did not work\n- The + button did nothing.\n\n## Suggestions\n- Label it.';
  const post = await fetch(`${base}/api/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ body: md }),
  });
  assert.equal(post.status, 200);
  const posted = await post.json();
  assert.equal(posted.ok, true);
  assert.equal(posted.date, feedback.today());

  // It actually landed on the user's own disk (the local-store integration).
  assert.ok(fs.existsSync(feedback.pathFor(feedback.today())), 'report file was not written to disk');

  const get = await fetch(`${base}/api/feedback`);
  assert.equal(get.status, 200);
  const read = await get.json();
  assert.equal(read.ok, true);
  assert.ok(read.report.includes('The + button did nothing.'));
  assert.ok(read.dates.includes(feedback.today()));
});

test('POST with no body is refused (400), nothing written', async (t) => {
  const base = await boot(t);
  // A unique date nothing else in this file writes, so "nothing written" is
  // provable in isolation (the tests share one sandbox data root, no per-test
  // cleanup): the route must reject on the empty body BEFORE it writes anything.
  const r = await fetch(`${base}/api/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2019-06-15', body: '   ' }),
  });
  assert.equal(r.status, 400);
  assert.equal(feedback.has('2019-06-15'), false, 'a rejected empty-body POST still wrote a report');
});

test('GET ?date= returns that day; a written past day round-trips', async (t) => {
  const base = await boot(t);
  await fetch(`${base}/api/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: '2026-09-01', body: 'older report' }),
  });
  const get = await fetch(`${base}/api/feedback?date=2026-09-01`);
  const read = await get.json();
  assert.equal(read.date, '2026-09-01');
  assert.equal(read.report.trim(), 'older report');
});

test('GET with a malformed date is refused (400), not treated as a path', async (t) => {
  const base = await boot(t);
  const r = await fetch(`${base}/api/feedback?date=../../etc/passwd`);
  assert.equal(r.status, 400);
});

test('POST with a malformed date is a clean 400 (validated at the route, before the write)', async (t) => {
  const base = await boot(t);
  const r = await fetch(`${base}/api/feedback`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ date: '../../oops', body: 'real body' }),
  });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.match(j.error, /YYYY-MM-DD/);
});

test('GET for a day with no report returns report: null, not an error', async (t) => {
  const base = await boot(t);
  const r = await fetch(`${base}/api/feedback?date=2020-01-01`);
  assert.equal(r.status, 200);
  const read = await r.json();
  assert.equal(read.report, null);
});
