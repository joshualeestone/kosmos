'use strict';
/**
 * kosmos#5574 slice 2b: an AGENT edits the words of its own post or comment (`kosmos community edit`). The state table is
 * in .claude/plans/edit-5574.md; each row a test can reach is here, with a control beside each refusal.
 *
 * A fake kosmos-community on a loopback port answers register, posts, comments and PATCH (with an answer the test can
 * set), and can hold a send open. Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-edit-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

const POST = crypto.randomUUID();   // somebody's post on the service, to comment on
const KEY = 'my key is sk-ant-api03-' + 'A'.repeat(95);   // words the board's check holds

function backend() {
  const st = { agents: new Map(), seen: [], n: 0, mode: {} };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t);
      if (!a) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'PATCH') {
        if (st.mode.patch) return send(st.mode.patch[0], st.mode.patch[1]);
        return send(200, { id: req.url.split('/').pop(), ...body });
      }
      if (req.method === 'POST' && req.url === '/posts') {
        if (st.mode.holdPost) { st.release = () => send(201, { id: crypto.randomUUID() }); return undefined; }
        return send(201, { id: crypto.randomUUID() });
      }
      if (req.method === 'POST' && /^\/posts\/[^/]+\/comments$/.test(req.url)) {
        return send(201, { id: crypto.randomUUID(), parent_id: null, body: body.body, state: 'live' });
      }
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${server.address().port}/`;
    resolve({ st, server });
  }));
}

let be;
let SW = { on: false, ok: true };
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  fs.rmSync(data, { recursive: true, force: true });
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  cs.resetPauses();
  be = await backend();
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); cs.setAgentWaitMs(); });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function agentFolder(agent) { fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true }); }
function comment(agent, text) {
  agentFolder(agent);
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: POST }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function post(agent, fields) {
  agentFolder(agent);
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), body: 'The first body.', ...fields }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
function writeJson(file, obj) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(obj)); }
const patches = () => be.st.seen.filter((s) => s.method === 'PATCH');
const commentPosts = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));
const row = (kind, id) => communitystore.rowOf(kind, id);

// ---- queued ----

test('a queued comment is changed before it is sent, and the NEW words are what go out', async () => {
  await on();
  const c = comment('ava', 'The first words.');
  const r = await cs.editFor('ava', 'comment', c.id, { body: 'The corrected words.' });
  assert.deepEqual(r, { ok: true, outcome: 'queued' });
  assert.equal(row('comment', c.id).body, 'The corrected words.');
  await cs.sweep();
  assert.equal(commentPosts().length, 1, 'CONTROL: it went out');
  assert.equal(commentPosts()[0].body.body, 'The corrected words.', 'the old words must never be sent');
  assert.equal(patches().length, 0, 'a queued edit sends no PATCH');
});

test('a queued comment made outside the sending period is changed, and says it will not go', async () => {
  const c = comment('ava', 'Made while sending was off.');
  const r = await cs.editFor('ava', 'comment', c.id, { body: 'Changed anyway.' });
  assert.deepEqual(r, { ok: true, outcome: 'queued_not_going' });
});

// ---- sent ----

async function sentComment(text) {
  await on();
  const c = comment('ava', text);
  await cs.sweep();
  assert.equal(commentPosts().length, 1, 'fixture: it went out');
  return { c, rec: readJson(cs._paths.commentsSentFile())[c.id] };
}

test('a sent comment is changed on the community with a PATCH as its own registration, and the board\'s copy follows', async () => {
  const { c, rec } = await sentComment('Sent words.');
  const r = await cs.editFor('ava', 'comment', rec.remoteId, { body: 'Fixed words.' });
  assert.deepEqual(r, { ok: true, outcome: 'changed' });
  assert.equal(patches().length, 1);
  assert.equal(patches()[0].url, '/posts/' + POST + '/comments/' + rec.remoteId);
  assert.deepEqual(patches()[0].body, { body: 'Fixed words.' });
  assert.equal(row('comment', c.id).body, 'Fixed words.');
});

test('a sent post keeps its title on a body edit, and takes a new one when given', async () => {
  await on();
  const p = post('ava', { topic: 'The title' });
  await cs.sweep();
  const rec = readJson(cs._paths.sentFile())[p.id];
  assert.ok(rec.agentId, 'fixture: the post records its registration');
  assert.deepEqual(await cs.editFor('ava', 'post', rec.remoteId, { body: 'A new body.' }), { ok: true, outcome: 'changed' });
  assert.deepEqual(patches()[0].body, { title: 'The title', body: 'A new body.' }, 'the title is pinned, never silently changed');
  assert.deepEqual(await cs.editFor('ava', 'post', p.id, { body: 'Another body.', topic: 'A better title' }), { ok: true, outcome: 'changed' });
  assert.deepEqual(patches()[1].body, { title: 'A better title', body: 'Another body.' });
  assert.equal(row('post', p.id).topic, 'A better title');
});

test('a post with no topic keeps the title it had (its first line) when only the body changes', async () => {
  await on();
  const p = post('ava', { body: 'First line is the title\nand the rest.' });
  await cs.sweep();
  assert.deepEqual(await cs.editFor('ava', 'post', p.id, { body: 'A different first line now.' }), { ok: true, outcome: 'changed' });
  assert.equal(patches()[0].body.title, 'First line is the title');
});

test('each community refusal is told in words, and the board\'s copy keeps the old words', async () => {
  const { c, rec } = await sentComment('Sent words.');
  const cases = [
    [[409, { detail: { error: 'edit_window_closed', minutes: 15 } }], /more than 15 minutes/, 'notEligible'],
    [[409, { detail: { error: 'reported' } }], /was reported/, 'notEligible'],
    [[409, { detail: { error: 'taken_down' } }], /taken down/, 'notEligible'],
    [[422, { detail: { error: 'refused_by_feedguard', reasons: ['x'] } }], /safety check refused/, 'notEligible'],
    [[422, { detail: [{ loc: ['body'], msg: 'bad' }] }], /did not accept the new words/, 'input'],
    [[429, { detail: { error: 'edit_limit', limit: 10 } }], /edited the most times/, 'notEligible'],
    [[404, { detail: 'comment not found' }], /no longer has/, 'notEligible'],
    [[500, { detail: 'boom' }], /may or may not/, 'maybe'],
  ];
  for (const [answer, words, flag] of cases) {
    be.st.mode.patch = answer;
    const r = await cs.editFor('ava', 'comment', rec.remoteId, { body: 'Attempted words.' });
    assert.equal(r.ok, false, JSON.stringify(answer));
    assert.match(r.because, words, JSON.stringify(answer) + ' -> ' + r.because);
    assert.equal(r[flag], true, JSON.stringify(answer) + ' -> ' + JSON.stringify(r));
    assert.ok(!/boom|comment not found|bad/.test(r.because), 'the server\'s own text is never echoed');
    assert.equal(row('comment', c.id).body, 'Sent words.', 'the board\'s copy is unchanged after a refusal');
  }
  be.st.mode.patch = null;
  assert.equal((await cs.editFor('ava', 'comment', rec.remoteId, { body: 'Fine now.' })).ok, true, 'CONTROL: a 200 changes it');
});

// ---- refusals before anything is sent ----

test('words the board\'s check would hold change nothing and send nothing', async () => {
  const { c, rec } = await sentComment('Sent words.');
  const r = await cs.editFor('ava', 'comment', rec.remoteId, { body: KEY });
  assert.equal(r.notEligible, true, JSON.stringify(r));
  assert.match(r.because, /safety check would hold these words/);
  assert.equal(patches().length, 0);
  assert.equal(row('comment', c.id).body, 'Sent words.');
});

test('another agent\'s item, a person\'s post, a taken-back item and a never-sent item are refused, with nothing sent', async () => {
  const { c, rec } = await sentComment('Ava\'s words.');
  assert.equal((await cs.editFor('bo', 'comment', rec.remoteId, { body: 'x y z' })).missing, true, 'another agent');
  assert.equal((await cs.editFor('bo', 'comment', c.id, { body: 'x y z' })).missing, true, 'another agent, board id');
  const personPost = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), topic: 'Mine', body: 'A person wrote this.' }, { trusted: true, author: { type: 'user', name: 'ava' } });
  assert.equal(personPost.ok, true, JSON.stringify(personPost));
  assert.equal((await cs.editFor('ava', 'post', personPost.id, { body: 'x y z' })).missing, true, 'a person\'s post is never an agent\'s to edit');
  const queued = comment('ava', 'To be taken back.');
  assert.equal(cs.withdrawFor('ava', 'comment', queued.id).ok, true);
  assert.match((await cs.editFor('ava', 'comment', queued.id, { body: 'x y z' })).because, /took this comment back/);
  const notSent = comment('ava', 'Marked never to send.');
  communitystore.markServiceCommentNotSent(notSent.id);
  assert.match((await cs.editFor('ava', 'comment', notSent.id, { body: 'x y z' })).because, /never sent/);
  assert.equal(patches().length, 0);
});

test('a post whose sending registration is not the one held is refused, and no PATCH goes out', async () => {
  await on();
  const p = post('ava', { topic: 'T' });
  await cs.sweep();
  const keys = readJson(cs._paths.keysFile());
  writeJson(cs._paths.keysFile(), { ...keys, ava: { ...keys.ava, remoteId: 'r-replaced' } });
  const r = await cs.editFor('ava', 'post', p.id, { body: 'New body here.' });
  assert.equal(r.notEligible, true, JSON.stringify(r));
  assert.match(r.because, /cannot be sure the registration/);
  assert.equal(patches().length, 0);
  writeJson(cs._paths.keysFile(), keys);
  assert.equal((await cs.editFor('ava', 'post', p.id, { body: 'New body here.' })).ok, true, 'CONTROL: the sending registration can');
});

test('held past the wait while a sweep has the section: busy, nothing changed, and never applied later', async () => {
  await on();
  const first = post('ava', { topic: 'Out on the network' });
  const c = comment('ava', 'Queued words.');
  be.st.mode.holdPost = true;
  const sweeping = cs.sweep();   // holds the section while the post's POST is out
  for (let i = 0; i < 200 && !be.st.release; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(be.st.release, 'fixture: the sweep is holding the section');
  cs.setAgentWaitMs(50);
  const r = await cs.editFor('ava', 'comment', c.id, { body: 'Too late, Kosmos was busy.' });
  assert.equal(r.busy, true, JSON.stringify(r));
  be.st.release();
  await sweeping;
  await new Promise((res) => setTimeout(res, 50));
  assert.equal(row('comment', c.id).body, 'Queued words.', 'the edit that answered busy must never land later');
  assert.ok(first.id);
});

// ---- review 1 ----

test('review 1: a queued post with no topic takes its title from the NEW body (its old first line never goes out)', async () => {
  await on();
  const p = post('ava', { body: 'A slip in the first line\nand more.' });
  assert.deepEqual(await cs.editFor('ava', 'post', p.id, { body: 'The corrected first line\nand more.' }), { ok: true, outcome: 'queued' });
  await cs.sweep();
  const sentPost = be.st.seen.find((x) => x.method === 'POST' && x.url === '/posts');
  assert.equal(sentPost.body.title, 'The corrected first line', 'the old first line must not go out as the title');
  assert.ok(!JSON.stringify(sentPost.body).includes('A slip'), 'no old words at all');
});

test('review 1: a queued row held for the person cannot be edited; one older than the sending period changes but will not go', async () => {
  agentFolder('ava');
  const held = feedpublish.publishServiceComment({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), body: 'Held for the person.', servicePostId: POST }, { trusted: false });
  assert.equal(held.status, 'held', 'fixture: held');
  const r = await cs.editFor('ava', 'comment', held.id, { body: 'Changed while held.' });
  assert.equal(r.notEligible, true, JSON.stringify(r));
  assert.match(r.because, /held for your person/);
  const old = comment('ava', 'Made before sending was turned on.');
  await on();   // the period starts now, after the row
  assert.deepEqual(await cs.editFor('ava', 'comment', old.id, { body: 'Changed anyway.' }), { ok: true, outcome: 'queued_not_going' });
});

test('review 1: over-long words are told their length, not "held"', async () => {
  await on();
  const c = comment('ava', 'Short.');
  const r = await cs.editFor('ava', 'comment', c.id, { body: 'x'.repeat(2001) });
  assert.equal(r.input, true, JSON.stringify(r));
  assert.match(r.because, /at most 2000 characters/);
});

test('review 1: out of time before anything is sent is busy and nothing changed, never "may have"', async () => {
  const { c, rec } = await sentComment('Sent words.');
  cs.setAgentBudgetMs(10);   // the deadline is already inside the request timeout when the PATCH would start
  try {
    const r = await cs.editFor('ava', 'comment', rec.remoteId, { body: 'Too slow.' });
    assert.equal(r.busy, true, JSON.stringify(r));
    assert.ok(!r.maybe);
    assert.equal(patches().length, 0, 'nothing was sent');
    assert.equal(row('comment', c.id).body, 'Sent words.');
  } finally { cs.setAgentBudgetMs(); }
});
