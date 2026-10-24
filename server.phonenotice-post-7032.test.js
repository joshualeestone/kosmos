'use strict';
/**
 * kosmos#7032: the words behind a room notification. A `posted` push carries `post:<post id>` (server.js); the phone
 * asks GET /api/phone/notice for its words, and the computer answers with the post's text and its author, as it does
 * for a direct reply, the author read off the post row (the id names only the post). CONTROLS: the person's own post,
 * an unknown post, a post with no words, and malformed ids (one naming an author too) answer 404. Real post rows in the
 * room log, real route.
 *
 * ⚠️ SANDBOX EVERY ROOT BEFORE ANY REQUIRE (HOME included).
 */
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-pnpost-7032-'));
const HOME = path.join(SANDBOX, 'home');
fs.mkdirSync(HOME, { recursive: true });
process.env.HOME = HOME;
process.env.AGENT_WORKFORCE_HOME = HOME;
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');
process.env.AGENT_WORKFORCE_PROJECTS = path.join(SANDBOX, 'projects');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG_DIR = path.join(SANDBOX, 'claude-config-dir');
process.env.AGENT_WORKFORCE_TMUX_BIN = path.join(__dirname, 'test-support', 'fake-tmux.sh');
process.env.AGENT_WORKFORCE_DRY_RUN = '1';

const test = require('node:test');
const assert = require('node:assert/strict');
const { start, server } = require('./server');
const projects = require('./engine/projects');
const messages = require('./engine/messages');

let base;
let pid;
const post = (row) => {
  fs.mkdirSync(path.dirname(messages.LOG), { recursive: true });
  fs.appendFileSync(messages.LOG, JSON.stringify({ kind: 'post', project: pid, to: [], outcomes: {}, at: new Date().toISOString(), ...row }) + '\n');
};
test.before(async () => {
  await start(0);
  base = `http://127.0.0.1:${server.address().port}`;
  pid = projects.create({ name: 'Spring catalogue' }).id;
  post({ id: 'm901', from: 'dana', text: 'Copy for pages 1 to 8 is done. Pages 9 to 12 wait for the new photos.' });
  post({ id: 'm902', from: 'operator', operator: true, text: 'Thanks, Dana.' });
  post({ id: 'm903', from: 'eli', text: '   ' });
});
test.after(() => { try { server.closeAllConnections(); server.close(); } catch { /* down */ } fs.rmSync(SANDBOX, { recursive: true, force: true }); });

const notice = async (id) => {
  const res = await fetch(base + '/api/phone/notice?id=' + encodeURIComponent(id));
  return { status: res.status, json: await res.json().catch(() => null) };
};

test('#7032 a room post\'s words come back by the id the push carries, with its author', async () => {
  const r = await notice('post:m901');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.kind, 'post');
  assert.equal(r.json.session, 'dana');
  assert.equal(r.json.text, 'Copy for pages 1 to 8 is done. Pages 9 to 12 wait for the new photos.');
  assert.equal('permission' in r.json, false, 'a room post never carries Allow and Deny');
  assert.equal(r.json.project, pid, 'the room it was posted in: the push does not carry it, so a tap learns it here');
});

test('#7032 CONTROL: a direct reply\'s answer names no project', async () => {
  const pn = require('./engine/phonenotice');
  const at = '2026-10-22T15:00:00.000Z';
  const chat = { DIRECT: 'direct', readThread: () => ({ messages: [{ at, from: 'dana', text: 'Done.' }] }) };
  const got = pn.wordsFor('reply:' + at + ':dana', { chat });
  assert.equal(got.text, 'Done.', 'the stub is read (else this control would pass on a null)');
  assert.equal('project' in got, false, JSON.stringify(got));
  const post = pn.wordsFor('post:m901');
  assert.equal(post.project, pid, 'the same reader, on a post, does name it');
});

test('#7032 CONTROL: the person\'s own post, an unknown post, a post with no words and malformed ids answer 404', async () => {
  for (const id of ['post:m902', 'post:m999', 'post:m903', 'post:', 'post:dana', 'post:m901:dana', 'post:m1234567890123456']) {
    const r = await notice(id);
    assert.equal(r.status, 404, id + ' -> ' + JSON.stringify(r.json));
  }
});

test('#7032 a long post is shortened as the other words are', async () => {
  post({ id: 'm904', from: 'dana', text: 'word '.repeat(300) });
  const r = await notice('post:m904');
  assert.equal(r.status, 200);
  assert.ok(r.json.text.length <= 400 && r.json.text.endsWith('…'), String(r.json.text.length));
});
