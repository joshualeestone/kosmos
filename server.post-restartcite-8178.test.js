'use strict';
require('./test-support/tmpscope'); // #4273: contains every temp dir below, so none outlives the run
/**
 * kosmos#8178 item 1: a post's id reaches the members before its row is written (#8165), and PENDING_POSTS, which
 * answered for it until then, lived only in memory. So a board restart in that window forgot the post: a member who
 * answered it was refused ("we could not find post mN"), and the board's next post could take the same id. The ids are
 * now kept beside the log (messages.ids.jsonl). Here the restart happens while the first post is still being typed.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartcite-8178-'));
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartcite-8178-home-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
process.env.AGENT_WORKFORCE_WORKERS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartcite-8178-w-'));
process.env.AGENT_WORKFORCE_PROJECTS = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartcite-8178-p-'));
process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-restartcite-8178-l-'));
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_BIN = '/bin/echo';
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server } = require('./server');
const fleet = require('./test-support/fleet');
const sendertoken = require('./engine/sendertoken');
const messages = require('./engine/messages');
const chat = require('./engine/chat');
const projects = require('./engine/projects');

let board;
let seen = null;
let replyP = null;
let roomId = null;
let failAll = false;   // every typing fails, so a post reaches nobody
async function post(body, headers) {
  const res = await fetch(`http://127.0.0.1:${server.address().port}/api/post`, { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

test.before(async () => {
  await start(0);
  board = fleet.install([fleet.agent('dana', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  chat.setRunner((args) => {
    if (args[0] === 'display-message') return { ran: true, spawnFailed: false, status: 0, out: '2.1.212\t\t0\n', err: '' };
    if (failAll) return { ran: true, spawnFailed: false, status: 1, out: '', err: "can't find pane" };
    const m = /--in-reply-to (m\d+)/.exec(args.join(' '));
    if (m && !seen && roomId) {
      seen = { id: m[1] };
      // The board restarts while the post is being typed: everything it held in memory is gone, the files stay.
      messages._restartForTests();
      replyP = post({ project: roomId, text: 'answer after a restart', from_pane: '', in_reply_to: m[1] }, { 'x-kosmos-agent-token': sendertoken.mint('dana').token });
    }
    return { ran: true, spawnFailed: false, status: 0, out: '', err: '' };
  });
  chat.setDryRun(false);
  chat.setPauser((ms) => new Promise((r) => setTimeout(r, Math.max(ms, 300))));
});
test.after(() => {
  messages.resetForTests();
  chat.setRunner(null);
  chat.setDryRun(true);
  if (board) board.restore();
  server.closeAllConnections();
  server.close();
  for (const d of [SANDBOX, process.env.HOME, process.env.AGENT_WORKFORCE_WORKERS, process.env.AGENT_WORKFORCE_PROJECTS, process.env.AGENT_WORKFORCE_LAUNCH]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

test('kosmos#8178: a reply to a post caught by a board restart posts, and the restarted board does not reuse its id', async () => {
  const p = projects.create({ name: 'Restart cite 8178' });
  projects.addAgent(p.id, 'dana');
  projects.addAgent(p.id, 'mara');
  roomId = p.id;
  const a = await post({ project: p.id, text: '@dana can you check this please?', from_pane: '' }, { 'x-kosmos-agent-token': sendertoken.mint('mara').token });
  assert.ok(seen, 'CONTROL: the envelope was typed with an --in-reply-to id: ' + JSON.stringify(a.json));
  assert.equal(seen.id, a.json.delivery.id);
  const r = await replyP;
  assert.notEqual(r.json.delivery.state, 'could_not', 'a reply to a post the members hold was refused after a restart: ' + JSON.stringify(r.json.delivery));
  assert.notEqual(r.json.delivery.id, a.json.delivery.id, 'the restarted board handed out the same id again');
  const rows = messages.record().rows.filter((x) => x && x.kind === 'post');
  assert.equal(new Set(rows.map((x) => x.id)).size, rows.length, 'two recorded posts share an id: ' + JSON.stringify(rows.map((x) => x.id)));
  const reply = rows.find((x) => x.text === 'answer after a restart');
  assert.ok(reply, 'the reply was not recorded');
  // Round 1: and it records what it answers, so it does not read as an uncited post (#4926's waiting list).
  assert.equal(reply.replyTo, a.json.delivery.id, 'the reply to a restored post does not say what it answers');
});

test('kosmos#8178: the id file is read as it says: this room, the last hour, never a post that reached nobody', () => {
  messages.resetForTests();
  const ids = messages._idsPathForTests();
  const now = Date.now();
  const line = (x) => JSON.stringify(x) + '\n';
  fs.writeFileSync(ids, line({ id: 'm7', project: 'proj-a', at: now - 1000 })
    + line({ id: 'm8', project: 'proj-a', at: now - 900 }) + line({ id: 'm8', gone: true })
    + line({ id: 'm9', project: 'proj-a', at: now - 2 * 60 * 60 * 1000 })
    + line({ id: 'm12', at: now - 500 })
    + '{"id":"m13","proj');   // a torn last line, as a crash mid-append leaves it
  messages._restartForTests();
  assert.equal(messages.projectOfPost('m7'), 'proj-a', 'a post from the last hour is back in its room');
  assert.deepEqual(messages.kindOfId('m7'), { is: 'post' });
  assert.equal(messages.projectOfPost('m8'), null, 'a post that reached nobody is not put back');
  assert.equal(messages.projectOfPost('m9'), null, 'a post older than the hour is not put back');
  assert.equal(messages._nextIdForTests(), 'm13', 'the next id is above every id handed out, a direct message included');
  const kept = fs.readFileSync(ids, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(kept.map((x) => x.id), ['m7', 'm12'], 'compacted to what it still needs');
  // CONTROL: with no id file a restarted board knows only the log (the first test's posts).
  messages.resetForTests();
  messages._restartForTests();
  const inLog = messages.record().parsed.reduce((n, x) => Math.max(n, x && /^m\d+$/.test(String(x.id)) ? Number(String(x.id).slice(1)) : 0), 0);
  assert.ok(inLog < 12, 'CONTROL: the log alone must not already reach m13, or the assertion above proves nothing');
  assert.equal(messages._nextIdForTests(), 'm' + (inLog + 1));
  assert.equal(messages.projectOfPost('m7'), null);
});

test('kosmos#8178 round 1: a post the record already holds, or holds as deleted, is the record\'s to answer for after a restart', () => {
  messages.resetForTests();
  const ids = messages._idsPathForTests();
  const log = path.join(path.dirname(ids), 'messages.jsonl');
  const now = Date.now();
  const line = (x) => JSON.stringify(x) + '\n';
  fs.appendFileSync(log, line({ kind: 'post-deleted', project: 'proj-b', of: 'm40', at: new Date(now).toISOString(), operator: true })
    + line({ kind: 'note', id: 'm41', at: new Date(now).toISOString() }));
  fs.writeFileSync(ids, line({ id: 'm40', project: 'proj-b', at: now - 100 }) + line({ id: 'm41', project: 'proj-b', at: now - 90 })
    + line({ id: 'm42', project: 'proj-b', from: 'mara', at: now - 80 }));
  messages._restartForTests();
  assert.equal(messages.projectOfPost('m40'), null, 'a deleted post came back as a post');
  assert.equal(messages.kindOfId('m40').is, 'deleted', 'a deleted post is still said to be deleted');
  assert.equal(messages.projectOfPost('m41'), null, 'an id the record holds is not put back from the id file');
  // CONTROL: an id the record does not hold is put back, with its author.
  assert.equal(messages.projectOfPost('m42'), 'proj-b');
  assert.equal(messages._withPendingForTests([], 'proj-b').length, 0, 'a stand-in row (no text) is never quoted');
});

test('kosmos#8178 round 1: a post that reached nobody is written gone, and a restart does not put it back', async () => {
  messages.resetForTests();
  const p = projects.create({ name: 'Gone 8178' });
  projects.addAgent(p.id, 'dana');
  projects.addAgent(p.id, 'mara');
  failAll = true;
  let a;
  try { a = await post({ project: p.id, text: '@dana nobody hears this', from_pane: '' }, { 'x-kosmos-agent-token': sendertoken.mint('mara').token }); }
  finally { failAll = false; }
  assert.equal(a.json.delivery.state, 'could_not', 'CONTROL: the post reached nobody: ' + JSON.stringify(a.json.delivery));
  const lines = fs.readFileSync(messages._idsPathForTests(), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const minted = lines.filter((x) => x.project === p.id).map((x) => x.id);
  assert.equal(minted.length, 1, 'the post minted one id: ' + JSON.stringify(lines));
  assert.ok(lines.some((x) => x.id === minted[0] && x.gone === true), 'the send path did not write it gone');
  messages._restartForTests();
  assert.equal(messages.projectOfPost(minted[0]), null, 'a post that reached nobody came back after a restart');
});
