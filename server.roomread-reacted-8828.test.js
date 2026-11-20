'use strict';
/**
 * kosmos#8828 item 1: the working rules say a confirmation is answered with a reaction, not another post. So a post the
 * reader reacted to (not a 🙋 claim, not a reaction taken back) leaves its `kosmos room <id> --unanswered` list when the
 * post asks no question (no "?"); a question still needs a post. Follows #4926 and #7848.
 */
require('./test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-reacted-8828-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const projects = require('./engine/projects');
const sendertoken = require('./engine/sendertoken');

let base;
let roster;
const ME = 'readerseat';
const CLAIMER = 'claimseat';
const BYSTANDER = 'otherseat';
const POSTER = 'askerseat';
function newRoom(name) {
  const p = projects.create({ name });
  projects.writeAll(projects.readAll().map((q) => (q.id === p.id ? { ...q, createdAt: '2020-01-01T00:00:00.000Z' } : q)));
  for (const n of [ME, CLAIMER, BYSTANDER, POSTER]) projects.addAgent(p.id, n, roster);
  return p.id;
}

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  roster = fleet.install([ME, CLAIMER, BYSTANDER, POSTER].map((n) => fleet.agent(n, { state: 'idle' }))).agents;
});
test.after(() => { try { server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

let seq = 0;
let clock = Date.now() - 60 * 60000;
const append = (row) => { fs.mkdirSync(path.dirname(messages.LOG), { recursive: true }); fs.appendFileSync(messages.LOG, JSON.stringify(row) + '\n'); };
function post(project, fields) {
  const id = 'm' + (88280 + (++seq));
  clock += 1000;
  append(Object.assign({ id, kind: 'post', from: POSTER, to: [ME, CLAIMER], project, text: 'row ' + id, at: new Date(clock).toISOString(), outcomes: {} }, fields));
  return id;
}
/* A claim, as react() writes one (`claim: true` is what makes a 🙋 a claim). */
function claim(project, of, from, op) {
  clock += 1000;
  append({ kind: 'reaction', project, of, at: new Date(clock).toISOString(), emoji: '\u{1F64B}', op: op || 'add', from, ...(op === 'remove' ? {} : { claim: true }) });
}
const room = async (project, who, query) => {
  const res = await fetch(`${base}/api/project/${encodeURIComponent(project)}/room?as=text${query || ''}`, { headers: who ? { 'x-kosmos-agent-token': sendertoken.mint(who).token } : {} });
  return { status: res.status, text: await res.text() };
};
const listed = (text, id) => text.split('\n').some((l) => l.includes('[' + id + '] ' + POSTER));
const CLAIMED = '[kosmos] Claimed, each by an agent the post also asked, so not counted as waiting on you: ';

function react(project, of, from, emoji, op) {
  clock += 1000;
  append({ kind: 'reaction', project, of, at: new Date(clock).toISOString(), emoji, op: op || 'add', from });
}

test('kosmos#8828: a reaction answers a confirmation, never a question', async () => {
  const pid = newRoom('Reacted8828a');
  const confirm = post(pid, { text: '@readerseat noted, I take the deposit clause and you keep the rent clause.', mentioned: [ME] });
  const question = post(pid, { text: '@readerseat can you take the rent clause today?', mentioned: [ME] });
  let r = await room(pid, ME, '&unanswered=1');
  assert.equal(r.status, 200, r.text);
  assert.ok(listed(r.text, confirm) && listed(r.text, question), 'fixture: before any reaction both are waiting on me:\n' + r.text);
  react(pid, confirm, ME, '\u{1F44D}');
  react(pid, question, ME, '\u{1F44D}');
  r = await room(pid, ME, '&unanswered=1');
  assert.ok(!listed(r.text, confirm), 'a confirmation I reacted to is still listed as waiting on me:\n' + r.text);
  assert.ok(listed(r.text, question), 'a question I only reacted to left the list; a question needs a post:\n' + r.text);
});

test('kosmos#8828: a claim, a reaction taken back, or someone else\'s reaction is not my answer', async () => {
  const pid = newRoom('Reacted8828b');
  const claimed = post(pid, { text: '@readerseat the lease draft is in the shared folder.', mentioned: [ME] });
  const takenBack = post(pid, { text: '@readerseat the signing is moved to Monday.', mentioned: [ME] });
  const others = post(pid, { text: '@readerseat the landlord agreed to the date.', mentioned: [ME] });
  claim(pid, claimed, ME);
  react(pid, takenBack, ME, '\u{1F44D}');
  react(pid, takenBack, ME, '\u{1F44D}', 'remove');
  react(pid, others, BYSTANDER, '\u{1F44D}');
  const r = await room(pid, ME, '&unanswered=1');
  assert.ok(listed(r.text, claimed), 'my own claim counted as an answer:\n' + r.text);
  assert.ok(listed(r.text, takenBack), 'a reaction I took back still counted:\n' + r.text);
  assert.ok(listed(r.text, others), 'another agent\'s reaction answered for me:\n' + r.text);
});
