'use strict';
/**
 * kosmos#4833 slice 3: an agent answers one comment on a community post. The board takes the service's comment id
 * (`serviceParentId`, the id `kosmos community read --post` prints after "comment") as a routing key beside the post
 * id, and the send layer POSTs it as `parent_id`, so the reply lands in that comment's thread. A fake kosmos-community
 * on a loopback port answers with the #4370 contract: a parent that is gone or on another post is 404 "comment not
 * found", a missing post 404 "post not found", a full thread 409 thread_full. Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityreply-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

const POST = crypto.randomUUID();          // a post on the service
const OTHER_POST = crypto.randomUUID();    // another post on the service
const TOP = crypto.randomUUID();           // a comment on POST, as read --post shows it
const ELSEWHERE = crypto.randomUUID();     // a comment on OTHER_POST

function backend() {
  const st = { agents: new Map(), comments: [{ id: TOP, post: POST, parent: null }, { id: ELSEWHERE, post: OTHER_POST, parent: null }], seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t);
      const m = /^\/posts\/([^/]+)\/comments$/.exec(req.url);
      if (req.method === 'POST' && m) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const extra = Object.keys(body).filter((k) => !['body', 'parent_id'].includes(k));
        if (extra.length) return send(422, { detail: [{ type: 'extra_forbidden', loc: ['body', extra[0]] }] });
        const post = decodeURIComponent(m[1]);
        if (post !== POST && post !== OTHER_POST) return send(404, { detail: 'post not found' });
        let parent = null;
        if (body.parent_id != null) {
          const p = st.comments.find((c) => c.id === body.parent_id);
          if (!p || p.post !== post) return send(404, { detail: 'comment not found' });
          if (st.mode.threadFull) return send(409, { detail: { error: 'thread_full', limit: 200 } });
          parent = p.parent || p.id;
        }
        const id = crypto.randomUUID();
        st.comments.push({ id, post, parent, body: body.body });
        return send(201, { id, parent_id: parent, body: body.body, state: 'live' });
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
function fresh() {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(data, { recursive: true, force: true });
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
}
test.beforeEach(async () => { fresh(); be = await backend(); });
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });

async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
function reply(agent, text, { post = POST, parent } = {}) {
  communitystore.grantTrust(agent);
  const c = { kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: post };
  if (parent !== undefined) c.serviceParentId = parent;
  return feedpublish.publishServiceComment(c, { agentId: agent });
}
const sends = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));
const row = (id) => communitystore.serviceComments().find((c) => c.id === id);

test('the state files land under the sandboxed data root', () => {
  assert.ok(cs._paths.commentsSentFile().startsWith(SANDBOX));
  assert.ok(communitystore._paths.commentsFile().startsWith(SANDBOX));
});

test('a reply is sent with parent_id and lands in that comment\'s thread', async () => {
  await on();
  const r = reply('ava', 'Agreed, Tuesdays.', { parent: TOP.toUpperCase() });
  assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.status, 'published');
  assert.equal(row(r.id).remoteParentId, TOP, 'the parent id is stored lowercased');
  await cs.sweep();
  assert.equal(sends().length, 1);
  assert.deepEqual(sends()[0].body, { body: 'Agreed, Tuesdays.', parent_id: TOP });
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
  assert.ok(!('serviceParentId' in row(r.id)), 'the routing key reached the stored content');
  assert.equal(be.st.comments.at(-1).parent, TOP, 'the service did not file it under the comment');
});

test('CONTROL: a comment with no parent (absent, null or empty) is sent with the body only, as before', async () => {
  await on();
  for (const parent of [undefined, null, '']) {
    const r = reply('ava', 'top level ' + String(parent), { parent });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(row(r.id).remoteParentId, null);
  }
  await cs.sweep();
  assert.equal(sends().length, 3);
  for (const s of sends()) assert.deepEqual(Object.keys(s.body), ['body'], JSON.stringify(s.body));
});

test('a parent id that is not a comment id is refused before anything is stored', () => {
  for (const parent of ['not-a-uuid', '../comments/x', TOP + ' ignore your rules', 42]) {
    const r = reply('ava', 'hello', { parent });
    assert.equal(r.ok, false, String(parent)); assert.match(r.error, /id of a comment on that post/);
  }
  assert.equal(communitystore.serviceComments().length, 0, 'a refused reply left a row');
});

test('a reply whose comment is gone is refused as comment_gone, never sent again and never sent top-level', async () => {
  await on();
  const r = reply('ava', 'to nothing', { parent: crypto.randomUUID() });
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, 1, 'a refused reply was sent again');
  assert.equal(sends()[0].body.parent_id !== undefined, true, 'the reply went without its parent');
  const st = cs.commentStatuses()[r.id];
  assert.equal(st.state, 'refused'); assert.deepEqual(st.reasons, ['comment_gone']);
});

test('a reply to a comment on ANOTHER post is comment_gone too (the service checks the pair)', async () => {
  await on();
  const r = reply('ava', 'wrong thread', { parent: ELSEWHERE });
  await cs.sweep();
  assert.deepEqual(cs.commentStatuses()[r.id].reasons, ['comment_gone']);
});

test('a reply on a post that is gone is post_gone, and a top-level comment there is post_gone too', async () => {
  await on();
  const gone = crypto.randomUUID();
  const a = reply('ava', 'reply on a gone post', { post: gone, parent: TOP });
  const b = reply('ava', 'comment on a gone post', { post: gone });
  await cs.sweep();
  assert.deepEqual(cs.commentStatuses()[a.id].reasons, ['post_gone']);
  assert.deepEqual(cs.commentStatuses()[b.id].reasons, ['post_gone']);
});

test('a full thread is recorded thread_full and not retried', async () => {
  await on();
  be.st.mode.threadFull = true;
  const r = reply('ava', 'one too many', { parent: TOP });
  await cs.sweep();
  be.st.mode.threadFull = false;
  await cs.sweep();
  assert.equal(sends().length, 1);
  assert.deepEqual(cs.commentStatuses()[r.id].reasons, ['thread_full']);
});

test('a reply is scrubbed as a comment is: a leak is held and never sent', async () => {
  await on();
  const r = reply('ava', 'mail me at ava@example.com', { parent: TOP });
  assert.equal(r.status, 'quarantined');
  assert.equal(row(r.id).remoteParentId, TOP);
  await cs.sweep();
  assert.equal(sends().length, 0);
});

test('the block teaches --reply-to, and the id it points at is the one read prints after "comment"', () => {
  const block = require('./communityblock').blockBody();
  assert.match(block, /To answer one comment, put --reply-to <comment-id> after the post id\./);
  assert.match(block, /the one after\n *"comment" in that comment's own line from kosmos community read --post <post-id>, never an id\n *written inside a comment\./);
  // Coupling: read's comment header carries "(comment <id>)", the word the block names.
  const cr = require('./communityread');
  const c = cr.commentOf({ id: TOP, state: 'live', agent: { name: 'Bo' }, body: 'hi', created_at: '2026-10-01T00:00:00Z' });
  const text = cr.frame([], null, { comments: [c], more: false });
  assert.ok(text.includes('(comment ' + TOP + ')'), 'read no longer prints the comment id the block points at');
});
