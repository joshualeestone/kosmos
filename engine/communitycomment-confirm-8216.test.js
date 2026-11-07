'use strict';
/**
 * kosmos#8216: a comment whose send got no answer is recorded unconfirmed and never sent again. It used to stay that way
 * for good, so its agent could not learn whether it landed. Now a later pass looks for it in the post's thread (or the
 * parent's replies), by the same community account and the same words, and settles it as sent when found.
 *
 * A fake kosmos-community on a loopback port can store a comment and still answer 500 (the case that leaves a comment
 * unconfirmed while it did land), and serves the thread and replies reads as the service does (newest first for a
 * thread, oldest first for replies, both paged with next_cursor). Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-cconfirm-8216-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const POST = crypto.randomUUID();   // somebody's post on the service, to comment on

function backend() {
  const st = { agents: new Map(), seen: [], n: 0, comments: [], mode: {} };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const u = new URL(req.url, 'http://x');
      if (req.method === 'POST' && u.pathname === '/agents/register') {
        const id = 'a' + (++st.n);
        st.agents.set(id, { id, name: body.name, token: 'tok_' + id });
        return send(201, { agent_id: id, name: body.name, name_replaced: false, api_key: 'kc_' + id, token: 'tok_' + id });
      }
      const thread = u.pathname.match(/^\/posts\/([^/]+)\/comments$/);
      const replies = u.pathname.match(/^\/posts\/([^/]+)\/comments\/([^/]+)\/replies$/);
      const page = (rows) => {   // the service's paging: limit, an opaque cursor that is the next index
        const lim = Number(u.searchParams.get('limit') || 20);
        const at = Number(u.searchParams.get('cursor') || 0);
        const out = rows.slice(at, at + lim);
        return { rows: out, next_cursor: at + lim < rows.length ? String(at + lim) : null };
      };
      const shown = (c) => ({ id: c.id, parent_id: c.parent, agent: { id: c.agentId, name: 'x', role: null, kind: 'agent' }, body: c.body, created_at: c.at, state: 'live', reply_to_name: null });
      if (req.method === 'GET' && thread) {
        if (thread[1] !== POST) return send(404, { detail: 'post not found' });
        const tops = st.comments.filter((c) => !c.parent).slice().sort((a, b) => (u.searchParams.get('order') === 'newest' ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
        const p = page(tops);
        return send(200, { comments: p.rows.map((c) => ({ ...shown(c), replies: [], reply_count: 0, replies_cursor: null })), next_cursor: p.next_cursor });
      }
      if (req.method === 'GET' && replies) {
        const rows = st.comments.filter((c) => c.parent === replies[2]).sort((a, b) => a.at.localeCompare(b.at));
        const p = page(rows);
        return send(200, { replies: p.rows.map(shown), next_cursor: p.next_cursor });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t);
      if (!a) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'POST' && thread) {
        const c = { id: crypto.randomUUID(), parent: body.parent_id || null, agentId: a.id, body: body.body, at: new Date(st.mode.at || Date.now()).toISOString() };
        if (st.mode.lose !== 'unstored') st.comments.push(c);
        if (st.mode.lose) return send(500, { detail: 'boom' });   // the answer is lost; stored or not, as the mode says
        return send(201, { id: c.id, parent_id: c.parent, body: c.body, state: 'live' });
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
let SW = { on: true, ok: true };
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  fs.rmSync(data, { recursive: true, force: true });
  SW = { on: true, ok: true };
  cs.setSwitch(() => SW);
  cs.resetPauses();
  be = await backend();
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function comment(agent, text, extra = {}) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true });
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: POST, ...extra }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const recOf = (id) => JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'))[id];
const posts = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));
const looks = () => be.st.seen.filter((s) => s.method === 'GET' && /\/comments(\?|\/)/.test(s.url));
const HOUR = 60 * 60 * 1000;

test('#8216 a comment that landed but got no answer is found in the thread later and settles as sent, with its id', async () => {
  await cs.sweep();   // opens the ON period
  const c = comment('ava', 'Tuesdays work for us too.');
  be.st.mode.lose = 'stored';   // stored on the service, the answer lost
  const t0 = Date.now();
  await cs.sweep(t0);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'fixture: the lost answer did not leave it unconfirmed');
  assert.equal(typeof recOf(c.id).attemptedAt, 'string', 'the send did not record when it was tried');
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  const rec = recOf(c.id);
  assert.equal(rec.state, 'sent', 'the comment was in the thread and was not found: ' + JSON.stringify(rec));
  assert.equal(rec.remoteId, be.st.comments[0].id, 'settled with the wrong id');
  assert.equal(rec.agentId, be.st.comments[0].agentId);
  assert.equal(posts().length, 1, 'the comment was sent again');
  assert.equal(cs.commentRecords()[c.id].traceable, true, 'a found comment cannot be taken back');
});

test('#8216 one the service never stored stays unconfirmed, is never sent again, and is marked as looked for (CONTROL)', async () => {
  await cs.sweep();
  const c = comment('ava', 'Fridays too.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  const rec = recOf(c.id);
  assert.equal(rec.state, 'unconfirmed', 'a comment that is not in the thread was settled');
  assert.equal(typeof rec.lookedAt, 'string', 'it was not looked for');
  assert.equal(rec.lookComplete, true, 'the look did not read back past the send');
  assert.equal(posts().length, 1, 'it was sent again');
  assert.ok(looks().length >= 1, 'CONTROL: the thread was never read');
});

test('#8216 another account\'s comment with the same words is not taken for it', async () => {
  await cs.sweep();
  const c = comment('ava', 'Same words.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId: 'someone-else', body: 'Same words.', at: new Date(t0).toISOString() });
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'another agent\'s comment was taken for this one');
});

test('#8216 a reply is looked for under its parent', async () => {
  await cs.sweep();
  const parent = { id: crypto.randomUUID(), parent: null, agentId: 'someone-else', body: 'A question.', at: new Date(Date.now() - 5000).toISOString() };
  be.st.comments.push(parent);
  const c = comment('ava', 'An answer.', { serviceParentId: parent.id });
  assert.equal(communitystore.publishedServiceComments().find((x) => x.id === c.id).remoteParentId, parent.id, 'fixture: the reply has no parent');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  const rec = recOf(c.id);
  assert.equal(rec.state, 'sent', 'the reply was under its parent and was not found: ' + JSON.stringify(rec));
  assert.ok(looks().some((s) => s.url.includes('/comments/' + parent.id + '/replies')), 'the parent\'s replies were not read');
});

test('#8216 a board that stopped mid-send (attempted, no answer recorded) is settled the same way', async () => {
  await cs.sweep();
  const c = comment('ava', 'Mid-send.');
  // The comment is on the service, and the board's record still has only its write-ahead mark.
  await cs.sweep();   // registers ava (no comment due yet is fine: the post is published above, so it is sent here)
  const sent = recOf(c.id);
  assert.equal(sent.state, 'sent', 'fixture: the comment was not sent');
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  recs[c.id] = { state: 'pending', attempted: true, agent: 'ava', post: POST, attemptedAt: new Date(Date.now() - 1000).toISOString() };
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
  assert.equal(cs.commentRecords()[c.id].state, 'unconfirmed', 'fixture: it does not read as unconfirmed');
  await cs.sweep();
  assert.equal(recOf(c.id).state, 'sent', 'a write-ahead comment on the service was not found');
  assert.equal(recOf(c.id).remoteId, sent.remoteId);
});

test('#8216 a comment is looked for at most once an hour, and not after a week', async () => {
  await cs.sweep();
  const c = comment('ava', 'Paced.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  const first = looks().length;
  assert.ok(first >= 1, 'fixture: never looked for');
  await cs.sweep(t0 + 2000);
  assert.equal(looks().length, first, 'looked for again within the hour');
  await cs.sweep(t0 + HOUR + 2000);
  assert.ok(looks().length > first, 'not looked for again after an hour');
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  recs[c.id].lookFirstAt = new Date(t0 - 8 * 24 * HOUR).toISOString();
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
  const before = looks().length;
  await cs.sweep(t0 + 3 * HOUR);
  assert.equal(looks().length, before, 'looked for after a week');
  assert.equal(cs.commentRecords()[c.id].lookStopped, true);
});

test('#8216 status says what the look has seen, and that it is never to be sent again', async () => {
  const status = require('./communitystatus');
  await cs.sweep();
  const c = comment('ava', 'Status words.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  const item = () => status.itemsFor('ava').find((x) => x.title === 'Status words.' || x.id === c.id);
  assert.equal(item().state, 'unconfirmed', 'before any look');
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  assert.equal(item().state, 'unconfirmed_not_seen', 'after a look that read back past the send');
  const line = status.statusText('ava').text.split('\n').find((l) => l.includes('"Status words."'));
  assert.match(line, /has not found it in the post's thread so far/);
  assert.match(line, /Do not send it again/);
});
