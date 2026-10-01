'use strict';
/**
 * kosmos#4801: the owner sees the COMMENTS their agents published to the public community, beside the posts in the
 * #4313 list, and can remove one. The board side of DELETE /posts/{post_id}/comments/{comment_id} (kosmos-community
 * #24: the comment's own agent, 204, 404 when it is gone or not that agent's).
 *
 * A fake kosmos-community on a loopback port answers the comment routes. Fixtures for the owner's list use only record
 * shapes communitysend.sendComment and the sweeps write. Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-commentmine-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');
const mine = require('./communitymine');

const POST = crypto.randomUUID();          // a post on the service

// A fake kosmos-community: register, login, comment, and remove a comment as its own agent.
function backend() {
  const st = { agents: new Map(), comments: [], seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        if (st.mode.onRegister) st.mode.onRegister();     // review 1 W1: something happens while registration is out
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const a = [...st.agents.values()].find((x) => x.token === t);
      if (req.method === 'POST' && req.url === '/posts') {   // review 1 NIT d: posts, to show they still send
        if (!a) return send(401, { detail: 'invalid or expired token' });
        return send(201, { id: crypto.randomUUID() });
      }
      const m = /^\/posts\/([^/]+)\/comments$/.exec(req.url);
      if (req.method === 'POST' && m) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        if (st.mode.hold) {                                // review 1 W2: the POST stays out until the test lets it go
          st.release = () => {
            const id = crypto.randomUUID();
            st.comments.push({ id, post: decodeURIComponent(m[1]), agent: a.id, body: body.body });
            send(201, { id, parent_id: null, body: body.body, state: 'live' });
          };
          return undefined;
        }
        if (st.mode.post) return send(st.mode.post, { detail: 'no' });
        if (st.mode.postNoId) return send(201, { body: body.body });
        const id = crypto.randomUUID();
        st.comments.push({ id, post: decodeURIComponent(m[1]), agent: a.id, body: body.body });
        return send(201, { id, parent_id: null, body: body.body, state: 'live' });
      }
      const d = /^\/posts\/([^/]+)\/comments\/([^/]+)$/.exec(req.url);
      if (req.method === 'DELETE' && d) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        if (st.mode.del) return send(st.mode.del, { detail: 'no' });
        const i = st.comments.findIndex((c) => c.id === decodeURIComponent(d[2]) && c.post === decodeURIComponent(d[1]) && c.agent === a.id);
        if (i < 0) return send(404, { detail: 'comment not found' });
        st.comments.splice(i, 1);
        return send(204);
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
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(data, { recursive: true, force: true });
  be = await backend();
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function comment(agent, text) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: POST }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
const posts = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));
const postPosts = () => be.st.seen.filter((s) => s.method === 'POST' && s.url === '/posts');
async function until(fn) {
  for (let i = 0; i < 400 && !fn(); i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok(fn(), 'timed out waiting');
}
const dels = () => be.st.seen.filter((s) => s.method === 'DELETE');
// The registration a fixture's sent records name (agentId 'ra'), as ensureRegistered writes it.
const AVA_KEY = { remoteId: 'ra', name: 'ava', apiKey: 'kc_key_ra', token: 'tok_ra', registeredAt: '2026-09-28T07:00:00.000Z' };
const pause = () => new Promise((r) => setTimeout(r, 5));

test('the comment-deletes file lands under the sandboxed data root, beside deletes.json and not in it', () => {
  assert.ok(cs._paths.commentDeletesFile().startsWith(SANDBOX));
  assert.equal(path.dirname(cs._paths.commentDeletesFile()), path.dirname(cs._paths.deletesFile()));
  assert.notEqual(cs._paths.commentDeletesFile(), cs._paths.deletesFile());
});

test('nothing sent yet: no comment rows, not an error', () => {
  assert.deepEqual(mine.mineComments(), []);
});

test('a sent comment lists with its first line, its agent, when, and Delete; no remote id of any kind', async () => {
  require('./store').writeProfile('ava', { displayName: 'Ava', role: 'Ops' });
  await on();
  const c = comment('ava', '\n# Tuesdays work for us too.\nAnd a second line that is not shown.');
  await cs.sweep();
  assert.equal(posts().length, 1, 'CONTROL: the comment really went out');
  const rows = mine.mineComments();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.deepEqual(Object.keys(row).sort(),
    ['agent', 'agentRefused', 'canDelete', 'deleteRequested', 'deleteRetrying', 'id', 'kind', 'postedAt', 'remotePostId', 'state', 'text', 'traceUnknown', 'untraceable']);
  assert.deepEqual([row.id, row.kind, row.text, row.agent, row.state, row.canDelete, row.untraceable], [c.id, 'comment', 'Tuesdays work for us too.', 'Ava', 'sent', true, false]);
  const stored = communitystore.serviceComments().find((x) => x.id === c.id);
  assert.equal(row.postedAt, stored.receivedAt);
  const csent = readJson(cs._paths.commentsSentFile());
  // (sentAt is not checked by value: on a fast run it can equal receivedAt to the millisecond. The key set above pins it out.)
  // Review 1: the comment's own service id never appears; the post's id (public, the page links to it) appears only as
  // remotePostId, the link's post.
  assert.ok(csent[c.id].remoteId && !JSON.stringify(rows).includes(csent[c.id].remoteId), 'the comment\'s service id reached the row');
  assert.equal(row.remotePostId, POST);
  const { remotePostId: _p, ...rest } = row;
  assert.ok(!JSON.stringify(rest).includes(POST), 'the post id appears somewhere other than the link\'s post');
});

test('the text is cut to the length a post title is', () => {
  const c = comment('ava', 'x'.repeat(500));
  writeJson(cs._paths.commentsSentFile(), { [c.id]: { state: 'sent', agent: 'ava', post: POST, remoteId: 'rc-1', sentAt: '2026-09-28T08:00:00Z' } });
  assert.equal(mine.mineComments()[0].text, 'x'.repeat(120));
});

test('newest first', async () => {
  const a = comment('ava', 'older');
  await pause();
  const b = comment('ava', 'newer');
  const rec = { state: 'sent', agent: 'ava', post: POST, sentAt: '2026-09-28T08:00:00Z' };
  writeJson(cs._paths.commentsSentFile(), { [a.id]: { ...rec, remoteId: 'r-a' }, [b.id]: { ...rec, remoteId: 'r-b' } });
  assert.deepEqual(mine.mineComments().map((r) => r.text), ['newer', 'older']);
});

test('Delete only on a comment the service can be asked about (sent with an id) or one not tried yet (pending)', () => {
  const id = {};
  for (const t of ['sent', 'pending', 'unconfirmed', 'sentNoId', 'refused', 'deleted', 'notSent', 'refusedAgent', 'unconfirmed5xx'])
    id[t] = comment(t === 'refusedAgent' ? 'bo' : 'ava', t).id;
  // sendComment's own shapes, by the registration keys.json still holds (agentId: review 1 NIT e).
  writeJson(cs._paths.keysFile(), { ava: AVA_KEY, bo: { remoteId: 'rb', refused: true } });
  writeJson(cs._paths.commentsSentFile(), {
    [id.sent]: { state: 'sent', agent: 'ava', post: POST, remoteId: 'rc-1', sentAt: '2026-09-28T08:00:00Z', agentId: 'ra' },
    [id.pending]: { state: 'pending', agent: 'ava', post: POST },                               // a 429: settle(rec, {})
    [id.unconfirmed]: { state: 'unconfirmed', agent: 'ava', post: POST },                       // no answer
    [id.unconfirmed5xx]: { state: 'pending', agent: 'ava', post: POST, attempted: true },        // write-ahead, board stopped
    [id.sentNoId]: { state: 'sent', agent: 'ava', post: POST, sentAt: '2026-09-28T08:00:00Z', agentId: 'ra' }, // a 201 with no id
    [id.refused]: { state: 'refused', agent: 'ava', post: POST, reasons: ['post_gone'] },
    [id.deleted]: { state: 'deleted', agent: 'ava', post: POST, remoteId: 'rc-2', sentAt: '2026-09-28T08:00:00Z', agentId: 'ra' },
    [id.notSent]: { state: 'not_sent', agent: 'ava', post: POST, reasons: ['not_sending'] },
    [id.refusedAgent]: { state: 'sent', agent: 'bo', post: POST, remoteId: 'rc-3', sentAt: '2026-09-28T08:00:00Z', agentId: 'rb' },
  });
  const by = Object.fromEntries(mine.mineComments().map((r) => [r.text, [r.state, r.canDelete, r.untraceable]]));
  assert.deepEqual(by, {
    sent: ['sent', true, false], pending: ['pending', true, false],
    unconfirmed: ['unconfirmed', false, true], unconfirmed5xx: ['unconfirmed', false, true], sentNoId: ['sent', false, true],
    refused: ['refused', false, false], deleted: ['deleted', false, false], notSent: ['not_sent', false, false],
    refusedAgent: ['sent', false, false],
  });
  // The board refuses the removal too, so a request cannot make the row say "coming down" forever.
  for (const t of ['unconfirmed', 'sentNoId']) {
    const r = cs.requestDelete(id[t]);
    assert.equal(r.ok, false, t);
    assert.equal(r.notEligible, true, t);
  }
  assert.match(cs.requestDelete(id.unconfirmed).because, /never learned whether this comment arrived/);
  assert.deepEqual(readJson(cs._paths.commentDeletesFile()), {}, 'a refused removal was recorded');
});

test('a removal goes to comment-deletes.json and NEVER to deletes.json, and turns Delete off', () => {
  const c = comment('ava', 'take me back');
  writeJson(cs._paths.keysFile(), { ava: AVA_KEY });
  writeJson(cs._paths.commentsSentFile(), { [c.id]: { state: 'sent', agent: 'ava', post: POST, remoteId: 'rc-1', sentAt: '2026-09-28T08:00:00Z', agentId: 'ra' } });
  assert.deepEqual(cs.requestDelete(c.id), { ok: true, state: 'sent' });
  assert.ok(readJson(cs._paths.commentDeletesFile())[c.id], 'not recorded in comment-deletes.json');
  assert.ok(!Object.prototype.hasOwnProperty.call(readJson(cs._paths.deletesFile()), c.id), 'a comment id reached deletes.json, which the sweep walks as POSTS');
  const row = mine.mineComments()[0];
  assert.deepEqual([row.deleteRequested, row.canDelete, row.deleteRetrying], [true, false, false]);
  assert.deepEqual(cs.requestDelete(c.id), { ok: true, state: 'sent' }, 'asking twice is harmless');
});

test('a removal for a comment on one of the board\'s own posts, or an unknown id, is refused', () => {
  assert.equal(cs.requestDelete('no-such-thing').missing, true);
  const local = communitystore.insertPost({ status: 'published', author: { type: 'human', name: 'Pat' }, topic: 't', body: 'b', at: new Date().toISOString() });
  const lc = communitystore.insertComment({ postId: local.id, status: 'published', agent: 'ava', author: { type: 'agent', name: 'ava' }, body: 'local', at: new Date().toISOString() });
  assert.equal(cs.requestDelete(lc.id).missing, true, 'a comment the send layer never sends has nothing to take back');
});

test('the sweep removes a sent comment as its own agent at /posts/{post}/comments/{id}, with the switch OFF too', async () => {
  await on();
  const c = comment('ava', 'Tuesdays work for us too.');
  await cs.sweep();
  const remote = be.st.comments[0];
  assert.ok(remote, 'CONTROL: the comment is on the service');
  SW = { on: false, ok: true };                     // removals run whatever the switch says
  assert.equal(cs.requestDelete(c.id).ok, true);
  await cs.sweep();
  assert.equal(dels().length, 1);
  assert.equal(dels()[0].url, `/posts/${POST}/comments/${remote.id}`);
  const agent = [...be.st.agents.values()][0];
  assert.equal(dels()[0].auth, 'Bearer ' + agent.token, 'not asked with the agent\'s own key');
  assert.equal(be.st.comments.length, 0, 'still on the service');
  assert.equal(cs.commentStatuses()[c.id].state, 'deleted');
  const row = mine.mineComments()[0];
  assert.deepEqual([row.state, row.canDelete, row.deleteRetrying], ['deleted', false, false]);
  await cs.sweep();
  assert.equal(dels().length, 1, 'a removed comment was asked about again');
  assert.deepEqual(readJson(cs._paths.sentFile()), {}, 'a comment reached the posts\' record');
});

test('a 404 settles the removal (already gone, or not this agent\'s): not asked again', async () => {
  await on();
  const c = comment('ava', 'gone already');
  await cs.sweep();
  be.st.comments.length = 0;                        // a moderator took it down meanwhile
  assert.equal(cs.requestDelete(c.id).ok, true);
  await cs.sweep();
  await cs.sweep();
  assert.equal(dels().length, 1);
  assert.equal(cs.commentStatuses()[c.id].state, 'deleted');
});

test('a 5xx keeps the removal and tries again next sweep; the row says it is retrying', async () => {
  await on();
  const c = comment('ava', 'stubborn');
  await cs.sweep();
  assert.equal(cs.requestDelete(c.id).ok, true);
  be.st.mode = { del: 500 };
  await cs.sweep();
  assert.equal(dels().length, 1);
  assert.equal(cs.commentStatuses()[c.id].state, 'sent');
  assert.equal(readJson(cs._paths.commentsSentFile())[c.id].deleteStatus, 500);
  const row = mine.mineComments()[0];
  assert.deepEqual([row.state, row.deleteRetrying, row.canDelete], ['sent', true, false]);
  be.st.mode = {};
  await cs.sweep();
  assert.equal(dels().length, 2, 'not tried again');
  assert.equal(cs.commentStatuses()[c.id].state, 'deleted');
  assert.equal(readJson(cs._paths.commentsSentFile())[c.id].deleteStatus, undefined, 'a settled removal kept its failure');
  assert.equal(mine.mineComments()[0].deleteRetrying, false);
});

test('a comment removed BEFORE it is sent is never sent: withheld', async () => {
  await on();
  const c = comment('ava', 'thought better of it');
  const keep = comment('ava', 'this one goes');
  assert.deepEqual(cs.requestDelete(c.id), { ok: true, state: 'withheld' });
  assert.equal(mine.mineComments().find((r) => r.id === c.id).state, 'withheld', 'listed as withheld before the sweep');
  await cs.sweep();
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.body), ['this one goes'], 'a removed comment went out (CONTROL: the other did)');
  assert.equal(cs.commentStatuses()[c.id].state, 'withheld');
  assert.equal(dels().length, 0);
  assert.ok(keep);
});

test('an unconfirmed comment is never asked about, even with a removal on record', async () => {
  await on();
  be.st.mode = { post: 503 };
  const c = comment('ava', 'no answer came');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[c.id].state, 'unconfirmed');
  writeJson(cs._paths.commentDeletesFile(), { [c.id]: new Date().toISOString() });   // as if recorded by an older board
  be.st.mode = {};
  await cs.sweep();
  assert.equal(dels().length, 0);
  assert.equal(mine.mineComments()[0].canDelete, false);
});

test('a comment sent with no id back cannot be removed: nothing to ask the service about', async () => {
  await on();
  be.st.mode = { postNoId: true };
  const c = comment('ava', 'stored, no id');
  await cs.sweep();
  assert.equal(cs.commentStatuses()[c.id].state, 'sent');
  const row = mine.mineComments()[0];
  assert.deepEqual([row.canDelete, row.untraceable], [false, true]);
  assert.equal(cs.requestDelete(c.id).ok, false);
});

test('an unreadable comment-deletes.json sends no comment (a removal might be in it), and willSend says so', async () => {
  await on();
  const out = comment('ava', 'already out');
  await cs.sweep();
  assert.equal(posts().length, 1, 'CONTROL: a comment went out before the file broke');
  writeJson(cs._paths.commentDeletesFile(), { [out.id]: new Date().toISOString() });
  const removal = fs.readFileSync(cs._paths.commentDeletesFile());
  assert.equal(cs.willSend('ava').sends, true, 'CONTROL: readable, it sends');
  fs.writeFileSync(cs._paths.commentDeletesFile(), '{not json');
  assert.equal(cs.willSend('ava').sends, false);
  comment('ava', 'waits for a repair');
  communitystore.grantTrust('ava');
  const pr = feedpublish.publishPost({ kind: 'community_post', agent: 'ava', at: new Date().toISOString(), topic: 't', body: 'a post' }, { agentId: 'ava' });
  assert.equal(pr.ok, true, JSON.stringify(pr));
  await cs.sweep();
  assert.equal(posts().length, 1, 'a comment went out while the removals could not be read');
  assert.equal(postPosts().length, 1, 'posts stopped too: only comments wait on comment-deletes.json');
  assert.equal(dels().length, 0, 'a removal was sent from a file that cannot be read');
  const asked = cs.requestDelete(out.id);
  assert.equal(asked.ok, false, 'a removal was accepted into a file that cannot be read');
  assert.match(asked.because, /could not read the list of removed comments/);
  fs.writeFileSync(cs._paths.commentDeletesFile(), removal);
  await cs.sweep();
  assert.equal(posts().length, 2, 'CONTROL: repaired, it goes');
  assert.equal(dels().length, 1, 'CONTROL: repaired, the removal is sent');
});

test('after the agent registers afresh (keys.json lost), its old comments are not asked about: a 404 would not mean gone', async () => {
  await on();
  const c = comment('ava', 'sent by the first registration');
  await cs.sweep();
  const first = [...be.st.agents.values()][0];
  assert.equal(readJson(cs._paths.commentsSentFile())[c.id].agentId, first.id, 'the sent record names the service agent that stored it');
  assert.equal(mine.mineComments()[0].canDelete, true, 'CONTROL: with the same registration it can be removed');
  // keys.json removed (its corrupt-file message allows it); the next sweep registers the agent again, as a new service agent.
  fs.rmSync(cs._paths.keysFile());
  comment('ava', 'a later comment, which registers the agent again');
  await cs.sweep();
  assert.equal(be.st.agents.size, 2, 'CONTROL: the agent really registered afresh');
  const row = mine.mineComments().find((r) => r.id === c.id);
  assert.deepEqual([row.canDelete, row.untraceable], [false, true]);
  assert.equal(cs.requestDelete(c.id).ok, false);
  writeJson(cs._paths.commentDeletesFile(), { [c.id]: new Date().toISOString() });   // even with a removal on record
  await cs.sweep();
  assert.equal(dels().length, 0, 'asked as another agent, the service answers 404 and the comment would read as removed');
  assert.equal(cs.commentStatuses()[c.id].state, 'sent');
});

test('review 1 W1: a removal accepted while the agent first registers is not sent: withheld', async () => {
  await on();
  const c = comment('ava', 'removed while registering');
  let asked = null;
  be.st.mode.onRegister = () => { asked = cs.requestDelete(c.id); };
  await cs.sweep();
  assert.equal(be.st.agents.size, 1, 'CONTROL: the agent registered in this sweep');
  assert.deepEqual(asked, { ok: true, state: 'withheld' }, 'CONTROL: the removal was accepted mid-registration');
  assert.equal(posts().length, 0, 'a comment the owner removed went out');
  assert.equal(cs.commentStatuses()[c.id].state, 'withheld');
  assert.equal(mine.mineComments()[0].state, 'withheld');
  await cs.sweep();
  assert.equal(posts().length, 0, 'sent on a later sweep');
});

test('review 1 W2: while its POST is out a comment reads sending, and a removal is refused as busy, not as never-learned', async () => {
  await on();
  const c = comment('ava', 'on the wire');
  be.st.mode.hold = true;
  const sweeping = cs.sweep();
  await until(() => typeof be.st.release === 'function');
  try {
    const row = mine.mineComments()[0];
    assert.deepEqual([row.state, row.canDelete, row.untraceable], ['sending', false, false]);
    assert.deepEqual(cs.requestDelete(c.id), { ok: false, busy: true, because: 'It is being sent right now; try again in a minute' });
    assert.deepEqual(readJson(cs._paths.commentDeletesFile()), {}, 'a refused removal was recorded');
  } finally {
    be.st.release();          // a failure here must not leave the sweep hanging into the next test
    await sweeping;
  }
  const after = mine.mineComments()[0];
  assert.deepEqual([after.state, after.canDelete], ['sent', true], 'CONTROL: with its answer in, it can be removed');
  assert.equal(cs.requestDelete(c.id).ok, true);
});

test('review 1 W4: keys.json unreadable is unknown, not another registration: no Delete, says so, and a removal is a retryable refusal', async () => {
  await on();
  const c = comment('ava', 'sent before keys.json broke');
  await cs.sweep();
  assert.equal(mine.mineComments()[0].canDelete, true, 'CONTROL: readable, it can be removed');
  const keys = fs.readFileSync(cs._paths.keysFile());
  fs.writeFileSync(cs._paths.keysFile(), '{not json');
  const row = mine.mineComments()[0];
  assert.deepEqual([row.state, row.canDelete, row.untraceable, row.traceUnknown], ['sent', false, false, true]);
  assert.equal(cs.commentRecords()[c.id].traceable, null, 'unknown must not read as false');
  const r = cs.requestDelete(c.id);
  assert.deepEqual(r, { ok: false, retryable: true, because: 'Kosmos could not read its community registrations just now' });
  assert.deepEqual(readJson(cs._paths.commentDeletesFile()), {}, 'recorded while it could not be told');
  fs.writeFileSync(cs._paths.keysFile(), keys);
  assert.equal(cs.requestDelete(c.id).ok, true, 'CONTROL: repaired, the removal is taken');
});

test('review 1 NIT e: a record with no agentId is this registration\'s only when the registration is no newer than the send', async () => {
  const later = comment('ava', 'sent after the registration');
  const earlier = comment('ava', 'sent before the registration');
  const noDate = comment('bo', 'a key with no registration time');
  writeJson(cs._paths.keysFile(), {
    ava: { remoteId: 'a9', name: 'ava', apiKey: 'k', token: 't', registeredAt: '2026-09-28T08:00:00.000Z' },
    bo: { remoteId: 'b9', name: 'bo', apiKey: 'k2', token: 't2' },
  });
  const rec = { state: 'sent', post: POST };
  writeJson(cs._paths.commentsSentFile(), {
    [later.id]: { ...rec, agent: 'ava', remoteId: 'r-later', sentAt: '2026-09-28T09:00:00.000Z' },
    [earlier.id]: { ...rec, agent: 'ava', remoteId: 'r-earlier', sentAt: '2026-09-28T07:00:00.000Z' },
    [noDate.id]: { ...rec, agent: 'bo', remoteId: 'r-nodate', sentAt: '2026-09-28T09:00:00.000Z' },
  });
  const by = Object.fromEntries(mine.mineComments().map((r) => [r.text, [r.canDelete, r.untraceable]]));
  assert.deepEqual(by, {
    'sent after the registration': [true, false],
    'sent before the registration': [false, true],
    'a key with no registration time': [false, true],
  });
  assert.equal(cs.requestDelete(earlier.id).notEligible, true);
  // Even with removals on record, the sweep asks only about the one this registration sent.
  writeJson(cs._paths.commentDeletesFile(), { [later.id]: 'x', [earlier.id]: 'x', [noDate.id]: 'x' });
  await cs.sweep();
  assert.deepEqual(dels().map((d) => d.url.split('/').pop()), ['r-later']);
});
