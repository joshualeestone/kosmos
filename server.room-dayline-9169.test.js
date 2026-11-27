'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
/**
 * kosmos#9169 (#9166 item 3): GET /api/project/:id/room?as=text, the view `kosmos room` prints, puts a date line before
 * the first row and wherever the day changes, in the operator's zone, so lines from different days no longer read as one.
 *
 *   node --test server.room-dayline-9169.test.js
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-room-dayline-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');
const store = require('./engine/store');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');

let base;
let roster;
const ME = 'readerseat';
const POSTER = 'askerseat';
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, POSTER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* best effort */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

async function roomText(id, query, who) {
  const res = await fetch(base + '/api/project/' + encodeURIComponent(id) + '/room?as=text' + (query || ''),
    { headers: who ? { 'x-kosmos-agent-token': sendertoken.mint(who).token } : {} });
  return { code: res.status, text: await res.text() };
}
function append(row) {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n');
}
let seq = 9169000;
const post = (p, at, text) => append({ kind: 'post', id: 'm' + (++seq), from: 'ann', project: p.id, text, at, to: [], outcomes: {} });
const DAY = /^-- .+ --$/;
/* A project made before its rows (as server.room-paused-8769.test.js does), or the view leaves out rows older than the project. */
function madeIn2025(name) {
  const made = projects.create({ name });
  const back = '2025-01-01T00:00:00.000Z';
  projects.writeAll(projects.readAll().map((q) => (q.id === made.id ? { ...q, createdAt: back } : q)));
  const folder = projects.readAll().find((q) => q.id === made.id).folder;
  for (const f of fs.readdirSync(folder)) fs.utimesSync(path.join(folder, f), new Date(back), new Date(back));
  return made;
}

test('roomDay: the day in the given zone, the year only when it is not the current one, null for no time', () => {
  const now = Date.parse('2026-11-26T23:00:00Z');
  // 03:27 UTC on the 26th is 21:27 on the 25th in Chicago: the zone decides the day, not UTC.
  assert.equal(messages.roomDay('2026-11-26T03:27:00Z', 'America/Chicago', now), 'Wed 25 Nov');
  assert.equal(messages.roomDay('2026-11-26T03:27:00Z', 'UTC', now), 'Thu 26 Nov', 'CONTROL: the zone made no difference');
  assert.equal(messages.roomDay('2025-11-25T12:00:00Z', 'UTC', now), 'Tue 25 Nov 2025');
  // The words come from fixed tables, not the platform's locale data (some spell September "Sept").
  assert.equal(messages.roomDay('2026-09-03T12:00:00Z', 'UTC', now), 'Thu 3 Sep');
  assert.equal(messages.roomDay('2027-01-01T00:30:00Z', 'America/Chicago', now), 'Thu 31 Dec', 'the zone decides the year too');
  assert.equal(messages.roomDay('2026-11-26T03:27:00Z', 'Not/AZone', now), messages.roomDay('2026-11-26T03:27:00Z', null, now),
    'a stale zone falls back to the machine, as roomClock does');
  assert.notEqual(messages.roomDay('2026-11-26T03:27:00Z', null, now), null);
  assert.equal(messages.roomDay(undefined, 'UTC', now), null);
  assert.equal(messages.roomDay('not a time', 'UTC', now), null);
});

test('#9169: a date line before the first row and at each day change, none between rows of one day', async () => {
  store.writeSettings({ timezone: 'America/Chicago' });
  const p = madeIn2025('Day Lines');
  // 2025, so the year always shows whatever year the test runs in.
  post(p, '2025-11-26T03:27:00.000Z', 'evening one');    // Tue 25 Nov 21:27 in Chicago
  post(p, '2025-11-26T09:19:00.000Z', 'morning one');    // Wed 26 Nov 03:19
  post(p, '2025-11-26T20:51:00.000Z', 'afternoon one');  // Wed 26 Nov 14:51
  const { code, text } = await roomText(p.id);
  assert.equal(code, 200, text);
  const lines = text.split('\n').filter((l) => l.length);
  const at = (words) => lines.findIndex((l) => l.includes(words));
  for (const w of ['evening one', 'morning one', 'afternoon one']) assert.ok(at(w) >= 0, 'CONTROL: the row "' + w + '" is not in the view: ' + text);
  const days = lines.filter((l) => DAY.test(l));
  assert.deepEqual(days, ['-- Tue 25 Nov 2025 --', '-- Wed 26 Nov 2025 --'], text);
  assert.equal(lines[at('evening one') - 1], '-- Tue 25 Nov 2025 --', 'the first row has its day above it: ' + text);
  assert.equal(lines[at('morning one') - 1], '-- Wed 26 Nov 2025 --', 'the day change has a date line: ' + text);
  assert.equal(at('afternoon one'), at('morning one') + 1, 'a second row on the same day got another date line: ' + text);
  assert.match(lines[at('evening one')], /^21:27 /, 'the row\'s own time is unchanged, in the same zone');
});

test('#9169: an empty room has no date line', async () => {
  const p = projects.create({ name: 'Day Lines Empty' });
  const { text } = await roomText(p.id);
  assert.match(text, /Nothing has been said in this room yet\./, 'CONTROL: the room is not empty');
  assert.doesNotMatch(text, /^-- .+ --$/m);
});

test('#9169: a row from the current year gets a date line with no year, in the operator zone', async () => {
  store.writeSettings({ timezone: 'America/Chicago' });
  const p = projects.create({ name: 'Day Lines Now' });
  const at = new Date().toISOString();
  post(p, at, 'just now one');
  const { code, text } = await roomText(p.id);
  assert.equal(code, 200, text);
  const lines = text.split('\n').filter((l) => l.length);
  const row = lines.findIndex((l) => l.includes('just now one'));
  assert.ok(row > 0, 'CONTROL: the row is not in the view: ' + text);
  const expected = '-- ' + messages.roomDay(at, 'America/Chicago', Date.now()) + ' --';
  assert.equal(lines[row - 1], expected, text);
  assert.doesNotMatch(expected, / \d{4} --$/, 'a row from this year was given its year');
});

/* The filtered reads go through the same lines, so each gets its date line, and an unreadable time adds none. */
function datedRoom(name) {
  store.writeSettings({ timezone: 'America/Chicago' });
  const p = madeIn2025(name);
  for (const n of [ME, POSTER]) projects.addAgent(p.id, n, roster);
  const ids = {};
  const add = (key, at, text, extra) => {
    ids[key] = 'm' + (++seq);
    append(Object.assign({ kind: 'post', id: ids[key], from: POSTER, project: p.id, text, at, to: [ME], outcomes: {} }, extra || {}));
  };
  add('tue', '2025-11-26T03:27:00.000Z', '@' + ME + ' tuesday ask', { mentioned: [ME] });   // Tue 25 Nov 21:27 Chicago
  add('wed1', '2025-11-26T15:00:00.000Z', 'wednesday one');                                // Wed 26 Nov 09:00
  add('bad', 'not a time', 'unreadable time');
  add('wed2', '2025-11-26T16:00:00.000Z', '@' + ME + ' wednesday ask', { mentioned: [ME] }); // Wed 26 Nov 10:00
  return { p, ids };
}
const dayLines = (text) => text.split('\n').filter((l) => DAY.test(l));
const above = (text, words) => {
  const lines = text.split('\n').filter((l) => l.length);
  const i = lines.findIndex((l) => l.includes(words));
  assert.ok(i >= 0, 'CONTROL: "' + words + '" is not in the view: ' + text);
  return lines[i - 1];
};

test('#9169: a stored row with an unreadable time never reaches the view, and the rows around it keep their days', async () => {
  const { p } = datedRoom('Day Lines Bad Time');
  const { text } = await roomText(p.id);
  // The room's reader leaves it out before the text is built, so roomDay's null (unit test above) is the only guard there.
  assert.doesNotMatch(text, /unreadable time/, text);
  assert.equal(above(text, 'wednesday ask'), '09:00  [' + 'm' + (seq - 2) + '] askerseat -> readerseat: wednesday one', text);
  assert.deepEqual(dayLines(text), ['-- Tue 25 Nov 2025 --', '-- Wed 26 Nov 2025 --'], text);
});

test('#9169: --post, --since and --unanswered each start with the date of their first row', async () => {
  const { p, ids } = datedRoom('Day Lines Filtered');
  const one = await roomText(p.id, '&post=' + ids.wed1);
  assert.equal(one.code, 200, one.text);
  assert.equal(above(one.text, 'wednesday one'), '-- Wed 26 Nov 2025 --', one.text);
  const since = await roomText(p.id, '&since=' + ids.tue);
  assert.equal(since.code, 200, since.text);
  assert.doesNotMatch(since.text, /tuesday ask/, 'CONTROL: --since showed the post it starts after');
  assert.deepEqual(dayLines(since.text), ['-- Wed 26 Nov 2025 --'], since.text);
  assert.equal(above(since.text, 'wednesday one'), '-- Wed 26 Nov 2025 --', since.text);
  const open = await roomText(p.id, '&unanswered=1&all=1', ME);
  assert.equal(open.code, 200, open.text);
  assert.doesNotMatch(open.text, /wednesday one/, 'CONTROL: --unanswered listed a post that asked nothing');
  assert.equal(above(open.text, 'tuesday ask'), '-- Tue 25 Nov 2025 --', open.text);
  assert.equal(above(open.text, 'wednesday ask'), '-- Wed 26 Nov 2025 --', open.text);
});
