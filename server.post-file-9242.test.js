'use strict';
require('./test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)

/**
 * kosmos#9242: `kosmos post <project> --file <path>` attaches one of the agent's own files to its room post. The checks are
 * the same as `kosmos reply --file`'s (engine/replyfile.js: the Files folder or a project the agent is on, the size caps,
 * the daily total). The copy is kept as the ROOM's attachment (scope 'project', owner the project), so the room draws and
 * serves it as a person's upload there (#358, #7062). These arms drive the real POST /api/post.
 *
 * Every refusal arm asserts that nothing was posted and no stored copy was left anywhere.
 *
 * Sandbox as server.reply-file-6726.test.js (whose harness this follows): the data, workers and projects roots are temp
 * folders set BEFORE server.js is required.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const SANDBOX = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aw-9242-')));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_FAKE_PANES = path.join(SANDBOX, 'panes.txt');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const { start, server, boardAuthState } = require('./server');
const fleet = require('./test-support/fleet');
const messages = require('./engine/messages');
const attachments = require('./engine/attachments');
const dmfiles = require('./engine/dmfiles');
const projects = require('./engine/projects');
const replyfile = require('./engine/replyfile');
const sendertoken = require('./engine/sendertoken');

const TOK = 'BOARDTOKEN_9242_0123456789abcdef';
const WHO = 'leo';
let LEO_TOKEN = '';
let base;
let FILES;
let OUTSIDE;

test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  boardAuthState.on = true;
  boardAuthState.token = TOK;
  const minted = sendertoken.mint(WHO);
  assert.ok(minted.ok, JSON.stringify(minted));
  LEO_TOKEN = minted.token;
  FILES = dmfiles.filesDir(WHO);
  assert.ok(FILES && FILES.startsWith(SANDBOX + path.sep), 'the Files folder must be inside the sandbox: ' + FILES);
  fs.mkdirSync(FILES, { recursive: true });
  OUTSIDE = path.join(SANDBOX, 'outside');
  fs.mkdirSync(OUTSIDE, { recursive: true });
  projects.readAll();
  projects.writeAll([
    { id: 'room-9242', name: 'Room', agents: [WHO, 'mara'], createdAt: new Date().toISOString() },
    { id: 'other-9242', name: 'Other', agents: ['mara'], createdAt: new Date().toISOString() },
  ]);
});
test.after(() => { try { server.close(); } catch { /* closed */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

function withLeo(fn) {
  const board = fleet.install([fleet.agent('leo', { state: 'idle' }), fleet.agent('mara', { state: 'idle' })]);
  messages.setRunner((pane) => ({ ok: true, session: pane === '%9' ? 'mara-discord' : 'leo-discord' }));
  return Promise.resolve().then(() => fn(board)).finally(() => { messages.setRunner(null); board.restore(); });
}
async function post(body, { token = true } = {}) {
  const res = await fetch(base + '/api/post', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { 'x-kosmos-agent-token': LEO_TOKEN } : { 'x-kosmos-board-token': TOK }) },
    body: JSON.stringify({ from_pane: '%3', new_post: true, ...body }),
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch { /* left {} */ }
  return { code: res.status, json, text };
}
const roomRows = (project) => (messages.record().rows || []).filter((r) => r && r.project === project && r.kind === 'post');
const storedCount = () => {
  let n = 0;
  for (const scope of ['agent', 'project']) {
    let owners = [];
    try { owners = fs.readdirSync(path.join(attachments.ROOT, scope)); } catch { continue; }
    for (const o of owners) { try { n += fs.readdirSync(path.join(attachments.ROOT, scope, o)).length; } catch { /* none */ } }
  }
  return n;
};
function write(p, bytes) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); return p; }

async function refused(body, because, opts) {
  const before = roomRows('room-9242').length + roomRows('other-9242').length;
  const copies = storedCount();
  const r = await post(body, opts);
  assert.equal(r.code, 200, r.text);
  assert.equal(r.json.delivery && r.json.delivery.state, 'could_not', 'DANGEROUS: it was posted: ' + r.text);
  assert.match(String(r.json.delivery.because), because, r.text);
  assert.equal(roomRows('room-9242').length + roomRows('other-9242').length, before, 'a refused post wrote a row');
  assert.equal(storedCount(), copies, 'a refused post left a stored copy');
}

test('#9242: a file from the Files folder arrives on the room post as the room\'s attachment and downloads byte for byte', () => withLeo(async () => {
  const bytes = Buffer.from(Array.from({ length: 200 * 1024 }, (_, i) => (i * 17 + 3) & 0xff));
  const src = write(path.join(FILES, 'design-sample.pdf'), bytes);
  const r = await post({ project: 'room-9242', text: 'Here is the design sample', file: src });
  assert.ok(r.json.delivery && r.json.delivery.id, 'not posted: ' + r.text);
  const row = roomRows('room-9242').find((x) => x.id === r.json.delivery.id);
  assert.ok(row, 'no room row for the post');
  const a = (row.attachments && row.attachments[0]) || row.attachment;
  assert.ok(a && typeof a.id === 'string', 'the row carries no attachment: ' + JSON.stringify(row));
  assert.equal(a.name, 'design-sample.pdf');
  const rec = attachments.read(a.id);
  assert.equal(rec.scope, 'project', 'kept as the room\'s attachment, as a person\'s upload is');
  assert.equal(rec.owner, 'room-9242');
  assert.equal(rec.by, 'agent');
  assert.equal(rec.from, WHO, 'the copy names the agent that sent it (its daily total)');
  const dl = await fetch(base + '/api/attachment/' + a.id, { headers: { 'x-kosmos-board-token': TOK } });
  assert.equal(dl.status, 200);
  assert.ok(Buffer.from(await dl.arrayBuffer()).equals(bytes), 'the download is not the file, byte for byte');
  // A copy: changing the original afterwards does not change what was posted.
  fs.writeFileSync(src, 'changed');
  const again = await fetch(base + '/api/attachment/' + a.id, { headers: { 'x-kosmos-board-token': TOK } });
  assert.ok(Buffer.from(await again.arrayBuffer()).equals(bytes));
}));

test('#9242: with no words the file\'s name is the post', () => withLeo(async () => {
  const src = write(path.join(FILES, 'notes.md'), '# notes\n');
  const r = await post({ project: 'room-9242', text: '', file: src });
  assert.ok(r.json.delivery && r.json.delivery.id, r.text);
  const row = roomRows('room-9242').find((x) => x.id === r.json.delivery.id);
  assert.equal(row.text, 'notes.md');
}));

test('#9242: refused, with nothing posted and no copy left: no agent token, not on the project, a file that is not the agent\'s, a missing file', () => withLeo(async () => {
  const src = write(path.join(FILES, 'ok.txt'), 'fine');
  await refused({ project: 'room-9242', text: 'x', file: src }, /only by an agent Kosmos started with its own agent token/, { token: false });
  await refused({ project: 'other-9242', text: 'x', file: src }, /you are not on that project, so nothing was posted and no file was taken/);
  await refused({ project: 'room-9242', text: 'x', file: write(path.join(OUTSIDE, 'secret.txt'), 'no') }, /so nothing was posted$/);
  await refused({ project: 'room-9242', text: 'x', file: path.join(FILES, 'nope.txt') }, /there is no file at .*so nothing was posted/);
  await refused({ project: 'no-such-room', text: 'x', file: src }, /there is no project by that name/);
  // CONTROL: the same file to the right room from leo's own token is posted (so the refusals above are the checks').
  const ok = await post({ project: 'room-9242', text: 'x', file: src });
  assert.ok(ok.json.delivery && ok.json.delivery.id, ok.text);
}));

test('#9242: a file shape that is not a path is a 400; a post without a file is unchanged', () => withLeo(async () => {
  const bad = await post({ project: 'room-9242', text: 'x', file: 42 });
  assert.equal(bad.code, 400);
  const plain = await post({ project: 'room-9242', text: 'a plain post' });
  assert.ok(plain.json.delivery && plain.json.delivery.id, plain.text);
  const row = roomRows('room-9242').find((x) => x.id === plain.json.delivery.id);
  assert.equal(row.attachment, undefined);
}));

test('#9242: a room post\'s copy counts against the agent\'s daily total, and still does after the ledger is read from disk again (a restart)', () => withLeo(async () => {
  const before = replyfile.sentToday(WHO);
  const src = write(path.join(FILES, 'big.bin'), Buffer.alloc(64 * 1024, 7));
  const r = await post({ project: 'room-9242', text: 'big', file: src });
  assert.ok(r.json.delivery && r.json.delivery.id, r.text);
  assert.equal(replyfile.sentToday(WHO), before + 64 * 1024);
  replyfile.seed();   // what a board restart does: the ledger is read back from the store
  assert.ok(replyfile.sentToday(WHO) >= 64 * 1024, 'after a restart the room post\'s copy no longer counted: ' + replyfile.sentToday(WHO));
}));
