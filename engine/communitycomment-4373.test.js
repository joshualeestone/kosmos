'use strict';
/**
 * kosmos#4373 part B: an agent's comment on a post in the PUBLIC community service.
 * The board takes the service's post id (the one `kosmos community read` prints), holds the
 * comment by default through the same choke as a post, and the send layer delivers it once
 * published: POST /posts/{id}/comments { body } as the registered agent, at most once.
 * A fake kosmos-community on a loopback port answers with the #4370 contract (v0.2.0).
 * Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communitycomment-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

const POST = crypto.randomUUID();          // a post on the service, as read would show it

// A fake kosmos-community with the #4370 comment route. `mode` bends one answer per test.
function backend() {
  const st = { agents: new Map(), comments: [], seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id, active: true };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t && x.active);
      const m = /^\/posts\/([^/]+)\/comments$/.exec(req.url);
      if (req.method === 'POST' && m) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const extra = Object.keys(body).filter((k) => !['body', 'parent_id'].includes(k));
        if (extra.length) return send(422, { detail: [{ type: 'extra_forbidden', loc: ['body', extra[0]] }] });
        if (st.mode.status) return send(st.mode.status, st.mode.json || { detail: 'no' }, st.mode.headers || {});
        if (st.mode.hangup) { req.socket.destroy(); return undefined; }
        if (decodeURIComponent(m[1]) !== POST) return send(404, { detail: 'post not found' });
        const id = crypto.randomUUID();
        st.comments.push({ id, post: m[1], agent: a.id, body: body.body });
        return send(201, { id, parent_id: null, body: body.body, state: 'live' });
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
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
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

function comment(agent, text, { trusted = true, post = POST } = {}) {
  if (trusted) communitystore.grantTrust(agent);
  return feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: post }, { agentId: agent });
}
const sends = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));

test('the state files land under the sandboxed data root', () => {
  assert.ok(cs._paths.commentsSentFile().startsWith(SANDBOX));
  assert.ok(communitystore._paths.commentsFile().startsWith(SANDBOX));
});

test('the board refuses what the service must refuse, before anything is stored', () => {
  for (const [post, why] of [['', /id of a community post/], ['not-a-uuid', /id of a community post/], ['../posts/x', /id of a community post/]]) {
    const r = comment('ava', 'hello', { post });
    assert.equal(r.ok, false, post); assert.match(r.error, why);
  }
  const blank = comment('ava', '   ');
  assert.equal(blank.ok, false);
  // The service counts characters, not UTF-16 units: 2000 emoji pass, 2001 characters do not.
  assert.equal(comment('ava', '\u{1F600}'.repeat(2000)).ok, true, '2000 characters is the service limit, not over it');
  const long = comment('ava', 'x'.repeat(2001));
  assert.equal(long.ok, false); assert.match(long.error, /at most 2000 characters/);
  assert.equal(communitystore.moderationQueue().length, 0, 'a refused comment left a row to moderate');
});

test('held by default: an untrusted agent\'s comment is held and never sent; released, it is', async () => {
  await on();
  const r = comment('bo', 'a clean comment from a new agent', { trusted: false });
  assert.equal(r.ok, true); assert.equal(r.status, 'held');
  await cs.sweep();
  assert.equal(sends().length, 0, 'a held comment reached the service');
  const row = communitystore.moderationQueue().find((x) => x.id === r.id);
  assert.ok(row, 'the held comment is not in the moderation queue');
  assert.equal(row.postId, null); assert.equal(row.remotePostId, POST);
  communitystore.releaseHeld(r.id);
  await cs.sweep();
  assert.equal(sends().length, 1, 'the released comment was not sent');
  assert.deepEqual(sends()[0].body, { body: 'a clean comment from a new agent' }, 'only the body may reach the service');
  assert.equal(sends()[0].url, '/posts/' + POST + '/comments');
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('a leak is quarantined, never sent, and reads as held to the agent', async () => {
  await on();
  const r = comment('ava', 'mail me at ava@example.com');
  assert.equal(r.status, 'quarantined');
  await cs.sweep();
  assert.equal(sends().length, 0);
});

test('a comment on a service post is never served on the board\'s own site', () => {
  const r = comment('ava', 'hello there');
  assert.equal(r.status, 'published');
  const local = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: 'x', topic: 't', body: 'local post' }, { agentId: 'ava' });
  assert.deepEqual(communitystore.getComments(local.id), []);
  assert.deepEqual(communitystore.getComments(POST), [], 'the service post id reached the local comment read');
});

test('a published comment is sent once, as the registered agent, and a second sweep sends nothing', async () => {
  await on();
  const r = comment('ava', 'Tuesdays work for us too.');
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, 1);
  const agent = [...be.st.agents.values()][0];
  assert.equal(sends()[0].auth, 'Bearer ' + agent.token);
  assert.equal(be.st.comments.length, 1);
  assert.equal(cs.commentStatuses()[r.id].state, 'sent');
});

test('nothing is sent while the switch is off, or for a comment made before it came on', async () => {
  comment('ava', 'made while off');
  await cs.sweep();
  assert.equal(sends().length, 0, 'sent with the switch off');
  await on();
  await cs.sweep();
  assert.equal(sends().length, 0, 'a comment from before the ON period was sent');
});

test('the service\'s refusals are recorded, not retried', async () => {
  await on();
  for (const [mode, reason] of [
    [{ status: 409, json: { detail: { error: 'thread_full', limit: 200 } } }, 'thread_full'],
    [{ status: 422, json: { detail: { error: 'refused_by_feedguard', reasons: ['email'] } } }, 'email'],
    [{ status: 422, json: { detail: { error: 'agent_name_refused' } } }, 'agent_name_refused'],
  ]) {
    be.st.mode = mode;
    const r = comment('ava', 'refused ' + reason);
    await cs.sweep();
    assert.equal(cs.commentStatuses()[r.id].state, 'refused', reason);
    assert.deepEqual(cs.commentStatuses()[r.id].reasons, [reason]);
  }
  be.st.mode = {};
  const gone = comment('ava', 'on a post that is gone', { post: crypto.randomUUID() });
  const before = sends().length;
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, before + 1, 'a refused comment was sent again');
  assert.deepEqual(cs.commentStatuses()[gone.id], { state: 'refused', agentRefused: false, reasons: ['post_gone'] });
});

test('the daily cap waits the server\'s Retry-After, then sends', async () => {
  await on();
  be.st.mode = { status: 429, json: { detail: { error: 'daily_comment_limit', limit: 20 } }, headers: { 'retry-after': '7200' } };
  const r = comment('ava', 'over the cap');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id].state, 'pending');
  be.st.mode = {};
  await cs.sweep();
  assert.equal(sends().length, 1, 'sent again before the Retry-After ran out');
});

test('no answer: recorded unconfirmed and never sent again (a doubled public comment is worse)', async () => {
  await on();
  be.st.mode = { hangup: true };
  const r = comment('ava', 'the answer never came');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id].state, 'unconfirmed');
  be.st.mode = {};
  await cs.sweep();
  await cs.sweep();
  assert.equal(sends().length, 1, 'an unconfirmed comment was sent again');
});

test('a 5xx is unconfirmed too: the server may have stored it', async () => {
  await on();
  be.st.mode = { status: 503 };
  const r = comment('ava', 'the server stumbled');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[r.id].state, 'unconfirmed');
  be.st.mode = {};
  await cs.sweep();
  assert.equal(sends().length, 1);
});

test('comments keep their own record: sent.json (posts) is never written by a comment', async () => {
  await on();
  comment('ava', 'only a comment');
  await cs.sweep();
  const sent = JSON.parse(fs.readFileSync(cs._paths.sentFile(), 'utf8'));
  assert.deepEqual(sent, {}, 'a comment row reached the posts\' record, where deletes and take-downs walk');
  const csent = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  assert.equal(Object.keys(csent).length, 1);
});

test('an unreadable comments record sends no comment rather than risk sending one twice', async () => {
  await on();
  comment('ava', 'waits for a repair');
  fs.mkdirSync(path.dirname(cs._paths.commentsSentFile()), { recursive: true });
  fs.writeFileSync(cs._paths.commentsSentFile(), '{not json');
  await cs.sweep();
  assert.equal(sends().length, 0);
});

test('switched off mid-sweep: the comments after that one stay home', async () => {
  await on();
  comment('ava', 'the first comment');
  comment('ava', 'the second comment');
  // Community goes off the moment the service has stored one comment.
  cs.setSwitch(() => ({ on: be.st.comments.length === 0, ok: true }));
  await cs.sweep();
  assert.equal(sends().length, 1, 'a comment was sent after Community was switched off');
});
