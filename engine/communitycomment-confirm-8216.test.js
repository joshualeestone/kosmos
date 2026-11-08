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
        if (st.mode.postGone) return send(410, { detail: 'post taken down' });
        if (thread[1] !== POST) return send(404, { detail: 'post not found' });
        const tops = st.comments.filter((c) => !c.parent).slice().sort((a, b) => (u.searchParams.get('order') === 'newest' ? b.at.localeCompare(a.at) : a.at.localeCompare(b.at)));
        const p = page(tops);
        if (typeof st.mode.onGet === 'function') st.mode.onGet(req.url);
        if (st.mode.failCursor && u.searchParams.get('cursor')) return send(500, { detail: 'boom' });
        // As the service: each top-level comment carries its first replies (2, its preview) and the true count.
        const under = (id) => st.comments.filter((x) => x.parent === id).sort((a, b) => a.at.localeCompare(b.at));
        return send(200, { comments: p.rows.map((c) => ({ ...shown(c), replies: under(c.id).slice(0, 2).map(shown), reply_count: under(c.id).length, replies_cursor: null })), next_cursor: p.next_cursor });
      }
      if (req.method === 'GET' && replies) {
        // As the service: the id must be a top-level comment of this post, else 404 "comment not found".
        if (st.mode.postGone) return send(410, { detail: 'post taken down' });   // as the service: the post is checked first
        const top = st.comments.find((c) => c.id === replies[2]);
        if (replies[1] !== POST || !top || top.parent) return send(404, { detail: 'comment not found' });
        const rows = st.comments.filter((c) => c.parent === replies[2]).sort((a, b) => a.at.localeCompare(b.at));
        const p = page(rows);
        return send(200, { replies: p.rows.map(shown), next_cursor: p.next_cursor });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t);
      if (!a) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'POST' && thread) {
        // As the service: a reply to a reply is kept under the top-level comment.
        const p0 = body.parent_id ? st.comments.find((x) => x.id === body.parent_id) : null;
        const parentTop = p0 ? (p0.parent || p0.id) : (body.parent_id || null);
        const c = { id: crypto.randomUUID(), parent: parentTop, agentId: a.id, body: body.body, at: new Date(st.mode.at || Date.now()).toISOString() };
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
  await cs.sweep();   // registers ava and sends the comment published above
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

test('#8216 review 1: an id another record already holds is never claimed, even with the same account and words', async () => {
  await cs.sweep();
  const first = comment('ava', 'Same again.');
  await cs.sweep();   // sent normally, with its id
  assert.equal(recOf(first.id).state, 'sent', 'fixture: the first comment was not sent');
  const second = comment('ava', 'Same again.');
  be.st.mode.lose = 'unstored';   // the second never landed
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(second.id).state, 'unconfirmed', 'the second record took the first comment\'s id');
  assert.equal(recOf(first.id).remoteId, be.st.comments[0].id, 'the first record changed');
});

test('#8216 review 1: a record from before the send time was kept is bounded by when the comment was made', async () => {
  await cs.sweep();
  const c = comment('ava', 'Old record.');
  await cs.sweep();   // registers ava and sends it
  const sentRec = recOf(c.id);
  assert.equal(sentRec.state, 'sent', 'fixture: not sent');
  // An older copy of the same words by the same account, from long before this comment was made, must not match.
  const stored = be.st.comments.find((x) => x.id === sentRec.remoteId);
  stored.at = new Date(Date.now() - 24 * HOUR).toISOString();
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  recs[c.id] = { state: 'unconfirmed', agent: 'ava', post: POST };   // no attemptedAt: written by an older board
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
  await cs.sweep();
  assert.equal(recOf(c.id).state, 'unconfirmed', 'a copy from a day before the comment was made was taken for it');
  stored.at = new Date().toISOString();   // CONTROL: a copy from after it was made is it
  const again = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  delete again[c.id].lookedAt;
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(again));
  await cs.sweep();
  assert.equal(recOf(c.id).state, 'sent', 'CONTROL: a copy from after the comment was made was not found');
});

test('#8216 review 1: a reply to a reply (kept under the top-level comment) is found', async () => {
  await cs.sweep();
  const top = { id: crypto.randomUUID(), parent: null, agentId: 'someone-else', body: 'A question.', at: new Date(Date.now() - 9000).toISOString() };
  const mid = { id: crypto.randomUUID(), parent: top.id, agentId: 'someone-else', body: 'A follow-up.', at: new Date(Date.now() - 8000).toISOString() };
  be.st.comments.push(top, mid);
  const c = comment('ava', 'Answering the follow-up.', { serviceParentId: mid.id });
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  assert.equal(be.st.comments.find((x) => x.body === 'Answering the follow-up.').parent, top.id, 'fixture: the fake did not keep it under the top');
  be.st.mode.lose = null;
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'sent', 'a reply to a reply was not found: ' + JSON.stringify(recOf(c.id)));
});

test('#8216 review 1: a comment on the second page of a busy thread is found; one older than the send is never matched', async () => {
  await cs.sweep();
  const c = comment('ava', 'Deep in the thread.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  // 25 newer comments by others push it to the second page (newest first, 20 a page).
  for (let i = 0; i < 25; i++) be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId: 'other' + i, body: 'Noise ' + i, at: new Date(t0 + 100 + i).toISOString() });
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'sent', 'a comment on page two was not found');
  // The same words by the same account from well before a send (outside the ten-minute margin) are never it.
  const d = comment('ava', 'Said before.');
  be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId: be.st.comments.find((x) => x.body === 'Deep in the thread.').agentId, body: 'Said before.', at: new Date(t0 - 2 * HOUR).toISOString() });
  be.st.mode.lose = 'unstored';
  await cs.sweep(t0 + 2000);
  be.st.mode.lose = null;
  await cs.sweep(t0 + 3000);
  assert.equal(recOf(d.id).state, 'unconfirmed', 'a copy from two hours before the send was taken for it');
});

test('#8216 review 1: a taken-down post (410) ends the look as complete, and the look runs with the switch off', async () => {
  await cs.sweep();
  const c = comment('ava', 'On a post that goes.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  be.st.mode.postGone = true;
  SW = { on: false, ok: true };
  const before = looks().length;
  await cs.sweep(t0 + 1000);
  assert.ok(looks().length > before, 'the look did not run with the switch off');
  assert.equal(recOf(c.id).lookComplete, true, 'a 410 was read as "could not read"');
  assert.equal(posts().length, 1, 'something was sent with the switch off');
});

test('#8216 review 2: a row whose time cannot be read is never taken for the comment', async () => {
  await cs.sweep();
  const c = comment('ava', 'Timeless.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  const stored = be.st.comments.find((x) => x.body === 'Timeless.');
  stored.at = 'not a time';
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'a row with no readable time was taken for it');
  stored.at = new Date(t0).toISOString();   // CONTROL: with its time, it is found
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  delete recs[c.id].lookedAt;
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
  await cs.sweep(t0 + 2000);
  assert.equal(recOf(c.id).state, 'sent', 'CONTROL: with a readable time it was not found');
});

test('#8216 review 3: same-words copies pair in send order, across pages of the thread', async () => {
  await cs.sweep();
  const t0 = Date.now();
  const a = comment('ava', 'Twice over.');
  const b = comment('ava', 'Twice over.');
  be.st.mode.lose = 'stored';
  await cs.sweep(t0);   // both go out in one pass, in order, and both answers are lost
  be.st.mode.lose = null;
  assert.deepEqual([recOf(a.id).state, recOf(b.id).state], ['unconfirmed', 'unconfirmed'], 'fixture');
  // Their sends a minute apart, and the copies at the same times (the service kept them in that order).
  const [copyA, copyB] = be.st.comments.filter((x) => x.body === 'Twice over.');
  copyA.at = new Date(t0).toISOString();
  copyB.at = new Date(t0 + 60 * 1000).toISOString();
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  // The file lists the newer send first, so the order cannot come from the file.
  const reordered = { [b.id]: { ...recs[b.id], attemptedAt: copyB.at }, [a.id]: { ...recs[a.id], attemptedAt: copyA.at } };
  for (const [k, v] of Object.entries(recs)) if (!(k in reordered)) reordered[k] = v;
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(reordered));
  // 20 newer comments between them put the older copy on the second page, newest first.
  for (let i = 0; i < 20; i++) be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId: 'other' + i, body: 'Between ' + i, at: new Date(t0 + 1000 + i).toISOString() });
  await cs.sweep(t0 + 2 * 60 * 1000);
  assert.equal(recOf(a.id).remoteId, copyA.id, 'the older record took the newer copy');
  assert.equal(recOf(b.id).remoteId, copyB.id, 'the newer record took the older copy');
});

test('#8216 review 3: an id another record claims while the look is out is refused at the write', async () => {
  await cs.sweep();
  const c = comment('ava', 'Raced.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  const copy = be.st.comments.find((x) => x.body === 'Raced.');
  be.st.mode.onGet = () => {   // another writer settles a record with this id while the thread read is on the network
    const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
    recs['someone-else'] = { state: 'sent', agent: 'ava', post: POST, remoteId: copy.id };
    fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
    be.st.mode.onGet = null;
  };
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'an id claimed meanwhile was taken again');
  assert.equal(recOf('someone-else').remoteId, copy.id, 'the other writer\'s record was overwritten');
});

test('#8216 review 3: a copy much later than the try is another send, never this one', async () => {
  await cs.sweep();
  const c = comment('ava', 'Later copy.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  const agentId = [...be.st.agents.values()][0].id;
  be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId, body: 'Later copy.', at: new Date(t0 + 3 * HOUR).toISOString() });
  await cs.sweep(t0 + 4 * HOUR);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'a copy three hours after the try was taken for it');
});

test('#8216 review 3: status says so when Kosmos cannot look, and when it has stopped', async () => {
  const status = require('./communitystatus');
  await cs.sweep();
  const c = comment('ava', 'No key to look with.');
  be.st.mode.lose = 'unstored';
  await cs.sweep();
  be.st.mode.lose = null;
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  delete keys.ava.remoteId;
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  const old = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  delete old[c.id].agentId;   // a record written before the sending account was recorded
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(old));
  const line = () => status.statusText('ava').text.split('\n').find((l) => l.includes('"No key to look with."'));
  assert.match(line(), /Kosmos cannot look for it from this board/, 'no account held, and status still promised a look');
  keys.ava.remoteId = [...be.st.agents.values()][0].id;
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  recs[c.id].lookFirstAt = new Date(Date.now() - 8 * 24 * HOUR).toISOString();
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
  assert.match(line(), /looked for it in the post's thread for a week without finding it/, 'a week of looking is not said');
});

test('#8216 review 4: a "cannot look" mark is cleared once a look is made', async () => {
  const status = require('./communitystatus');
  await cs.sweep();
  const c = comment('ava', 'Marked once.');
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  const recs = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  recs[c.id].lookSkip = 'company';   // as if its company community had not been this computer's
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(recs));
  assert.equal(status.itemsFor('ava').find((x) => x.title === 'Marked once.').state, 'unconfirmed_unasked', 'fixture');
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).lookSkip, undefined, 'the mark survived a look');
  assert.equal(status.itemsFor('ava').find((x) => x.title === 'Marked once.').state, 'unconfirmed_not_seen');
});

test('#8216 review 4: unreadable keys keep the plain words, never "cannot look"', async () => {
  const status = require('./communitystatus');
  await cs.sweep();
  const c = comment('ava', 'Keys broken.');
  be.st.mode.lose = 'unstored';
  await cs.sweep();
  be.st.mode.lose = null;
  const old = JSON.parse(fs.readFileSync(cs._paths.commentsSentFile(), 'utf8'));
  delete old[c.id].agentId;   // a record written before the sending account was recorded
  fs.writeFileSync(cs._paths.commentsSentFile(), JSON.stringify(old));
  fs.writeFileSync(cs._paths.keysFile(), '{ not json');
  assert.equal(cs.commentRecords()[c.id].canLook, null, 'unreadable keys read as a known "no account"');
  const it = status.itemsFor('ava').find((x) => x.title === 'Keys broken.');
  assert.ok(it, 'fixture: status could not list it');
  assert.notEqual(it.state, 'unconfirmed_unasked', 'unreadable keys read as "cannot look"');   // status says its records cannot be read
});

test('#8216 review 4: a copy whose words were edited on the site is never taken for it', async () => {
  await cs.sweep();
  const c = comment('ava', 'Before the edit.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  be.st.comments.find((x) => x.body === 'Before the edit.').body = 'After the edit.';
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'a copy with other words was taken for it');
});

test('#8216 review 5: the account that sent it is recorded, so a look finds it after the agent re-registered', async () => {
  await cs.sweep();
  const c = comment('ava', 'Before a new account.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  const sender = be.st.comments.find((x) => x.body === 'Before a new account.').agentId;
  assert.equal(recOf(c.id).agentId, sender, 'the write-ahead did not record the sending account');
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  keys.ava.remoteId = 'a-new-registration';
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'sent', 'after a re-registration the look searched the new account');
});

test('#8216 review 5: a page that fails is tried again later, never settled on what came before it', async () => {
  await cs.sweep();
  const c = comment('ava', 'Partial read.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  for (let i = 0; i < 25; i++) be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId: 'other' + i, body: 'Noise ' + i, at: new Date(t0 + 100 + i).toISOString() });
  be.st.mode.failCursor = true;   // the second page fails
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'settled on a read whose second page failed');
  assert.equal(recOf(c.id).lookComplete, undefined, 'a failed read was recorded as a look');
  assert.equal(recOf(c.id).lookFails, 1);
  be.st.mode.failCursor = false;
  await cs.sweep(t0 + HOUR + 2000);
  assert.equal(recOf(c.id).state, 'sent', 'CONTROL: once the page reads, it is found');
});

test('#8216 review 7: a sole match on the first page is not settled when a later page fails', async () => {
  await cs.sweep();
  const c = comment('ava', 'Sole match first.');
  be.st.mode.lose = 'stored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  const copy = be.st.comments.find((x) => x.body === 'Sole match first.');
  copy.at = new Date(t0 + 1000).toISOString();   // the newest, so on page one
  // 25 older comments by others, still inside the window, so the read goes on to page two (which fails).
  for (let i = 0; i < 25; i++) be.st.comments.push({ id: crypto.randomUUID(), parent: null, agentId: 'other' + i, body: 'Earlier ' + i, at: new Date(t0 - 60 * 1000 + i).toISOString() });
  be.st.mode.failCursor = true;
  await cs.sweep(t0 + 2000);
  assert.equal(recOf(c.id).state, 'unconfirmed', 'settled on page one though page two failed');
  assert.equal(recOf(c.id).lookFails, 1);
});

test('#8216 review 7: a reply on a post taken down (410) ends the look as complete', async () => {
  await cs.sweep();
  const top = { id: crypto.randomUUID(), parent: null, agentId: 'someone-else', body: 'Question.', at: new Date(Date.now() - 5000).toISOString() };
  be.st.comments.push(top);
  const c = comment('ava', 'Answer on a gone post.', { serviceParentId: top.id });
  be.st.mode.lose = 'unstored';
  const t0 = Date.now();
  await cs.sweep(t0);
  be.st.mode.lose = null;
  be.st.mode.postGone = true;
  await cs.sweep(t0 + 1000);
  assert.equal(recOf(c.id).state, 'unconfirmed');
  assert.equal(recOf(c.id).lookComplete, true, 'a reply on a taken-down post was not called complete');
});
