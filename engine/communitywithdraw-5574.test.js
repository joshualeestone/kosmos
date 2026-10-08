'use strict';
/**
 * kosmos#5574: an AGENT takes back its own post or comment (`kosmos community withdraw`), through the owner's removal
 * path (#4287 posts, #4801 comments): queued, it is withheld and never goes; sent, the next sweep takes it down as that
 * agent. The id is the one the agent holds (the service's, or the board's own while queued), and it must be the
 * agent's own: another agent's id is not found.
 *
 * A fake kosmos-community on a loopback port answers register, posts, comments and both deletes. Sandboxed data root
 * before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-withdraw-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

const POST = crypto.randomUUID();   // somebody's post on the service, to comment on

function backend() {
  const st = { agents: new Map(), comments: [], posts: [], seen: [], n: 0 };
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
      if (!a && req.url !== '/agents/register') {
        if (req.method === 'POST' && req.url === '/agents/login') return send(404, { detail: 'not found' });
      }
      if (req.method === 'POST' && req.url === '/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const id = crypto.randomUUID();
        st.posts.push({ id, agent: a.id });
        return send(201, { id });
      }
      const pd = /^\/posts\/([^/]+)$/.exec(req.url);
      if (req.method === 'DELETE' && pd) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const i = st.posts.findIndex((p) => p.id === decodeURIComponent(pd[1]) && p.agent === a.id);
        if (i < 0) return send(404, { detail: 'post not found' });
        st.posts.splice(i, 1);
        return send(204);
      }
      const m = /^\/posts\/([^/]+)\/comments$/.exec(req.url);
      if (req.method === 'POST' && m) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const id = crypto.randomUUID();
        st.comments.push({ id, post: decodeURIComponent(m[1]), agent: a.id });
        return send(201, { id, parent_id: null, body: body.body, state: 'live' });
      }
      const d = /^\/posts\/([^/]+)\/comments\/([^/]+)$/.exec(req.url);
      if (req.method === 'DELETE' && d) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
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
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function agentFolder(agent) { fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true }); }
function comment(agent, text) {
  agentFolder(agent);
  communitystore.grantTrust(agent);
  const r = feedpublish.publishServiceComment({ kind: 'community_post', agent, at: new Date().toISOString(), body: text, servicePostId: POST }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
function post(agent, topic) {
  agentFolder(agent);
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic, body: 'A post body long enough.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
// The ON period starts at the first sweep with the switch on, and only items made inside it are sent (#4373), so
// a test that wants something sent turns it on and sweeps BEFORE publishing, as communitycommentmine-4801 does.
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
const commentPosts = () => be.st.seen.filter((s) => s.method === 'POST' && /\/comments$/.test(s.url));
const dels = () => be.st.seen.filter((s) => s.method === 'DELETE');

test('a comment taken back before it was sent is withheld and never goes out', async () => {
  await on();   // made inside the ON period, so it WOULD go on the next sweep
  const c = comment('ava', 'A slip I want back.');
  const kept = comment('ava', 'This one stays.');
  const r = cs.withdrawFor('ava', 'comment', c.id);   // the board's own id, which the send answered
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, 'withheld');
  await cs.sweep();
  assert.equal(commentPosts().length, 1, 'CONTROL: the comment not taken back went out');
  assert.equal(commentPosts()[0].body.body, 'This one stays.', 'only the kept comment was sent');
  assert.ok(kept.id);
});

test('a sent comment is taken down by the service id the agent reads, as that agent', async () => {
  await on();
  const c = comment('ava', 'Sent, then regretted.');
  await cs.sweep();
  assert.equal(commentPosts().length, 1, 'CONTROL: it really went out');
  const remote = readJson(cs._paths.commentsSentFile())[c.id].remoteId;
  assert.ok(remote);
  const r = cs.withdrawFor('ava', 'comment', remote.toUpperCase());   // ids compare without case, as a person may type them
  assert.equal(r.ok, true, JSON.stringify(r));
  await cs.sweep();
  assert.equal(dels().length, 1, 'the next sweep asks the service to take it down');
  assert.match(dels()[0].url, new RegExp('/comments/' + remote + '$'));
  assert.equal(be.st.comments.length, 0, 'gone from the service');
});

test('another agent\'s comment is not found, by either id, and nothing is recorded', async () => {
  await on();
  const c = comment('ava', 'Ava\'s words.');
  await cs.sweep();
  const remote = readJson(cs._paths.commentsSentFile())[c.id].remoteId;
  for (const id of [c.id, remote, crypto.randomUUID()]) {
    const r = cs.withdrawFor('bo', 'comment', id);
    assert.equal(r.ok, false);
    assert.equal(r.missing, true, JSON.stringify(r));
  }
  assert.deepEqual(readJson(cs._paths.commentDeletesFile()), {}, 'no removal recorded for someone else\'s comment');
  assert.equal(cs.withdrawFor('ava', 'comment', remote).ok, true, 'CONTROL: its own agent can');
});

test('a post is taken back the same way: queued it is withheld, sent it is taken down', async () => {
  await on();   // both made inside the ON period, so both WOULD go
  const queued = post('ava', 'Queued');
  const sent = post('ava', 'Sent');
  const r1 = cs.withdrawFor('ava', 'post', queued.id);
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.state, 'withheld');
  await cs.sweep();
  const posted = be.st.seen.filter((s) => s.method === 'POST' && s.url === '/posts');
  assert.equal(posted.length, 1, 'only the post not taken back went out (the CONTROL is that it did)');
  assert.equal(posted[0].body.title, 'Sent');
  const remote = readJson(cs._paths.sentFile())[sent.id].remoteId;
  assert.equal(cs.withdrawFor('bo', 'post', remote).missing, true, 'another agent cannot take it back');
  const r2 = cs.withdrawFor('ava', 'post', remote);
  assert.equal(r2.ok, true, JSON.stringify(r2));
  await cs.sweep();
  assert.ok(dels().some((d) => d.url === '/posts/' + remote), 'the sweep took the post down');
});

test('a post id is not a comment id, and an empty id or kind is refused', () => {
  const p = post('ava', 'Mine');
  assert.equal(cs.withdrawFor('ava', 'comment', p.id).missing, true, 'a post id never matches a comment');
  assert.equal(cs.withdrawFor('ava', 'comment', '').ok, false);
  assert.equal(cs.withdrawFor('ava', 'vote', p.id).ok, false);
  assert.equal(cs.withdrawFor('', 'post', p.id).ok, false);
});

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}

test('review 1+2: a post the community refused, or whose agent it refused, is not "taken back"; nothing is recorded', () => {
  const refused = post('ava', 'Refused');
  const byRefusedAgent = post('bo', 'From a refused agent');
  const fine = post('ava', 'Fine');
  writeJson(cs._paths.sentFile(), {
    [refused.id]: { state: 'refused', agent: 'ava', lastStatus: 422 },
    [byRefusedAgent.id]: { state: 'sent', agent: 'bo', remoteId: crypto.randomUUID() },
    [fine.id]: { state: 'sent', agent: 'ava', agentId: 'ra', remoteId: crypto.randomUUID() },
  });
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_ra', remoteId: 'ra', name: 'ava' }, bo: { refused: true, name: 'bo' } });
  const r1 = cs.withdrawFor('ava', 'post', refused.id);
  assert.equal(r1.notEligible, true, JSON.stringify(r1));
  assert.match(r1.because, /did not accept this post/);
  const r2 = cs.withdrawFor('bo', 'post', byRefusedAgent.id);
  assert.equal(r2.notEligible, true, JSON.stringify(r2));
  assert.match(r2.because, /refused this agent/);
  assert.deepEqual(readJson(cs._paths.deletesFile()), {}, 'nothing recorded for a post that cannot be taken back');
  const r3 = cs.withdrawFor('ava', 'post', fine.id);
  assert.equal(r3.ok, true, 'CONTROL: a sent post with its id and a live registration is taken back: ' + JSON.stringify(r3));
});

test('review 2: a post whose send got no answer IS taken back: the next sweep settles it and takes it down or holds it', () => {
  const lost = post('ava', 'Lost');
  writeJson(cs._paths.sentFile(), { [lost.id]: { state: 'pending', attempted: true, agent: 'ava', agentId: 'ra' } });
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_ra', remoteId: 'ra', name: 'ava' } });
  const r = cs.withdrawFor('ava', 'post', lost.id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.state, 'unconfirmed');
  assert.ok(readJson(cs._paths.deletesFile())[lost.id], 'the removal is recorded for the sweep to act on');
});

test('review 2: one already taken down answers as done, not as a refusal', () => {
  const p = post('ava', 'Gone');
  writeJson(cs._paths.sentFile(), { [p.id]: { state: 'deleted', agent: 'ava', remoteId: crypto.randomUUID() } });
  assert.deepEqual(cs.withdrawFor('ava', 'post', p.id), { ok: true, state: 'deleted' });
  const c = comment('ava', 'Gone too.');
  writeJson(cs._paths.commentsSentFile(), { [c.id]: { state: 'deleted', agent: 'ava', post: POST, remoteId: crypto.randomUUID() } });
  assert.deepEqual(cs.withdrawFor('ava', 'comment', c.id), { ok: true, state: 'deleted' });
});

test('review 1: ids do not cross kinds, by board id or by service id', async () => {
  await on();
  const p = post('ava', 'A post');
  const c = comment('ava', 'A comment');
  await cs.sweep();
  const pRemote = readJson(cs._paths.sentFile())[p.id].remoteId;
  const cRemote = readJson(cs._paths.commentsSentFile())[c.id].remoteId;
  assert.equal(cs.withdrawFor('ava', 'post', c.id).missing, true, 'a comment board id as a post');
  assert.equal(cs.withdrawFor('ava', 'post', cRemote).missing, true, 'a comment service id as a post');
  assert.equal(cs.withdrawFor('ava', 'comment', p.id).missing, true, 'a post board id as a comment');
  assert.equal(cs.withdrawFor('ava', 'comment', pRemote).missing, true, 'a post service id as a comment');
  assert.deepEqual([readJson(cs._paths.deletesFile()), readJson(cs._paths.commentDeletesFile())], [{}, {}]);
});

test('review 1: a new agent given a removed agent\'s name cannot take back the old agent\'s words by their board id', () => {
  const old = comment('ava', 'The removed agent\'s words.');
  // The removal renames the SENT record (retireIn); the board's own row keeps the name "ava".
  writeJson(cs._paths.commentsSentFile(), { [old.id]: { state: 'sent', agent: 'retired:ava:2026-10-01T00:00:00.000Z', post: POST, remoteId: crypto.randomUUID() } });
  const r = cs.withdrawFor('ava', 'comment', old.id);
  assert.equal(r.missing, true, JSON.stringify(r));
  assert.deepEqual(readJson(cs._paths.commentDeletesFile()), {});
  const mine = comment('ava', 'The new agent\'s own words.');
  assert.equal(cs.withdrawFor('ava', 'comment', mine.id).ok, true, 'CONTROL: its own queued comment is taken back');
});

test('review 3: with no live registration, neither a sent post nor an unanswered one is "taken back"', () => {
  const sent = post('ava', 'Sent');
  const lost = post('ava', 'Lost');
  writeJson(cs._paths.sentFile(), {
    [sent.id]: { state: 'sent', agent: 'ava', remoteId: crypto.randomUUID() },
    [lost.id]: { state: 'pending', attempted: true, agent: 'ava' },
  });
  writeJson(cs._paths.keysFile(), { ava: { registering: { at: '2026-10-08T00:00:00Z' }, name: 'ava' } });   // no apiKey
  for (const p of [sent, lost]) {
    const r = cs.withdrawFor('ava', 'post', p.id);
    assert.equal(r.notEligible, true, JSON.stringify(r));
    assert.match(r.because, /no longer holds the registration/);
  }
  writeJson(cs._paths.keysFile(), { ava: { refused: true, name: 'ava' } });
  assert.match(cs.withdrawFor('ava', 'post', lost.id).because, /refused this agent/, 'an unanswered post from a refused agent too');
  assert.deepEqual(readJson(cs._paths.deletesFile()), {});
});

test('review 3: a comment already held back answers as done on a retry, and a moderator-removed post as already down', async () => {
  await on();
  const c = comment('ava', 'Queued then taken back.');   // inside the ON period, so the sweep acts on it
  assert.equal(cs.withdrawFor('ava', 'comment', c.id).state, 'withheld');
  await cs.sweep();   // records it withheld
  assert.equal(readJson(cs._paths.commentsSentFile())[c.id].state, 'withheld', 'fixture: the sweep recorded it withheld');
  assert.deepEqual(cs.withdrawFor('ava', 'comment', c.id), { ok: true, state: 'withheld' }, 'a retry is not "Nothing was taken back"');
  const p = post('ava', 'Moderated');
  writeJson(cs._paths.sentFile(), { [p.id]: { state: 'sent', agent: 'ava', remoteId: crypto.randomUUID(), takenDown: true } });
  assert.deepEqual(cs.withdrawFor('ava', 'post', p.id), { ok: true, state: 'deleted' });
});

test('review 4+6: a post that names a registration since replaced is not "taken back"; an older record without one is, as on main', () => {
  const sent = post('ava', 'Sent by the old registration');
  const lost = post('ava', 'Unanswered under the old registration');
  const legacy = post('ava', 'An older record with no agentId');
  writeJson(cs._paths.sentFile(), {
    [sent.id]: { state: 'sent', agent: 'ava', agentId: 'r-old', remoteId: crypto.randomUUID(), sentAt: '2026-10-01T00:00:00.000Z' },
    [lost.id]: { state: 'pending', attempted: true, agent: 'ava', agentId: 'r-old' },
    [legacy.id]: { state: 'sent', agent: 'ava', remoteId: crypto.randomUUID(), sentAt: '2026-10-01T00:00:00.000Z' },
  });
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_new', remoteId: 'r-new', name: 'ava-2', registeredAt: '2026-10-05T00:00:00.000Z' } });
  for (const p of [sent, lost]) {
    const r = cs.withdrawFor('ava', 'post', p.id);
    assert.equal(r.notEligible, true, p.id + ' ' + JSON.stringify(r));
    assert.match(r.because, /no longer holds the registration that sent this post/);
  }
  assert.deepEqual(readJson(cs._paths.deletesFile()), {});
  assert.equal(cs.withdrawFor('ava', 'post', legacy.id).ok, true, 'an older record is treated as the held registration\'s, as main does');
  // CONTROL: the registration that sent them can.
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_old', remoteId: 'r-old', name: 'ava', registeredAt: '2026-09-01T00:00:00.000Z' } });
  for (const p of [sent, lost]) assert.equal(cs.withdrawFor('ava', 'post', p.id).ok, true, p.id);
});

test('review 4: a post the sweep really sends records which service agent sent it, so it can be taken back', async () => {
  await on();
  const p = post('ava', 'First post of a new agent');
  await cs.sweep();
  const rec = readJson(cs._paths.sentFile())[p.id];
  const k = readJson(cs._paths.keysFile()).ava;
  assert.equal(rec.state, 'sent');
  assert.ok(rec.agentId && rec.agentId === k.remoteId, 'the sent record names the registration that sent it: ' + JSON.stringify(rec));
  assert.equal(cs.withdrawFor('ava', 'post', rec.remoteId).ok, true, 'a new agent\'s first post is not refused for registering in the same sweep');
});

test('review 5: a registration replaced between the take-back and the sweep sends no DELETE, so nothing reads as removed', async () => {
  await on();
  const p = post('ava', 'Sent, then the registration changed');
  await cs.sweep();
  const remote = readJson(cs._paths.sentFile())[p.id].remoteId;
  assert.equal(cs.withdrawFor('ava', 'post', remote).ok, true, 'fixture: asked for while the sending registration is held');
  // The registration is replaced before the next sweep (keys.json lost and a new account registered under the name).
  const keys = readJson(cs._paths.keysFile());
  writeJson(cs._paths.keysFile(), { ...keys, ava: { ...keys.ava, remoteId: 'r-replaced', registeredAt: new Date(Date.now() + 1000).toISOString() } });
  await cs.sweep();
  assert.equal(dels().length, 0, 'no DELETE goes out as another service agent');
  assert.notEqual(readJson(cs._paths.sentFile())[p.id].state, 'deleted', 'not marked removed while it is still public');
});

test('review 6: the person\'s Delete still takes down an older post whose registration was made in the same sweep (no regression)', async () => {
  await on();
  const p = post('ava', 'First post, sent before #5574');
  await cs.sweep();
  // As main wrote it: no agentId, and sentAt is the sweep START, earlier than the registration made inside that sweep.
  const sent = readJson(cs._paths.sentFile());
  const k = readJson(cs._paths.keysFile()).ava;
  const { agentId: _a, ...legacy } = sent[p.id];
  legacy.sentAt = new Date(Date.parse(k.registeredAt) - 1000).toISOString();
  writeJson(cs._paths.sentFile(), { ...sent, [p.id]: legacy });
  assert.equal(cs.requestDelete(p.id).ok, true, 'the owner\'s Delete is accepted');
  await cs.sweep();
  assert.equal(dels().length, 1, 'the DELETE goes out, as it did on main');
  assert.equal(readJson(cs._paths.sentFile())[p.id].state, 'deleted');
});

test('review 6: the person is told up front when a post\'s sending registration is known to be gone', () => {
  const p = post('ava', 'Sent by a registration since replaced');
  writeJson(cs._paths.sentFile(), { [p.id]: { state: 'sent', agent: 'ava', agentId: 'r-old', remoteId: crypto.randomUUID(), sentAt: '2026-10-01T00:00:00.000Z' } });
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_new', remoteId: 'r-new', name: 'ava', registeredAt: '2026-10-05T00:00:00.000Z' } });
  const r = cs.requestDelete(p.id);
  assert.equal(r.notEligible, true, JSON.stringify(r));
  assert.match(r.because, /no longer holds the registration that sent this post/);
  assert.deepEqual(readJson(cs._paths.deletesFile()), {}, 'nothing recorded, so the list never says "Deleting" for it');
});

test('review 7: an unreadable keys.json makes the person\'s Delete a "try again", not "the registration is gone"', () => {
  const p = post('ava', 'Sent, with its registration named');
  writeJson(cs._paths.sentFile(), { [p.id]: { state: 'sent', agent: 'ava', agentId: 'r-1', remoteId: crypto.randomUUID(), sentAt: '2026-10-01T00:00:00.000Z' } });
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), '{ not json');
  const r = cs.requestDelete(p.id);
  assert.equal(r.retryable, true, JSON.stringify(r));
  assert.deepEqual(readJson(cs._paths.deletesFile()), {});
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_1', remoteId: 'r-1', name: 'ava' } });
  assert.equal(cs.requestDelete(p.id).ok, true, 'CONTROL: readable, and the same registration, it is accepted');
});

test('review 8: a comment already marked for removal but unconfirmed or untraceable is not "taken back"', () => {
  const lost = comment('ava', 'Out when the person pressed Delete.');
  const gone = comment('ava', 'Sent by a registration since replaced.');
  writeJson(cs._paths.commentsSentFile(), {
    [lost.id]: { state: 'pending', attempted: true, agent: 'ava', post: POST },
    [gone.id]: { state: 'sent', agent: 'ava', post: POST, remoteId: crypto.randomUUID(), agentId: 'r-old', sentAt: '2026-10-01T00:00:00.000Z' },
  });
  writeJson(cs._paths.commentDeletesFile(), { [lost.id]: '2026-10-08T00:00:00.000Z', [gone.id]: '2026-10-08T00:00:00.000Z' });
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_new', remoteId: 'r-new', name: 'ava' } });
  const r1 = cs.withdrawFor('ava', 'comment', lost.id);
  assert.equal(r1.notEligible, true, JSON.stringify(r1));
  assert.match(r1.because, /never learned whether this comment arrived/);
  const r2 = cs.withdrawFor('ava', 'comment', gone.id);
  assert.equal(r2.notEligible, true, JSON.stringify(r2));
  assert.match(r2.because, /no way to find this comment again/);
  writeJson(cs._paths.keysFile(), { ava: { apiKey: 'kc_key_old', remoteId: 'r-old', name: 'ava' } });
  assert.equal(cs.withdrawFor('ava', 'comment', gone.id).ok, true, 'CONTROL: with the registration that sent it, it is taken back');
});
