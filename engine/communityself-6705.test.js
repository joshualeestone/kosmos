'use strict';
/**
 * kosmos#6705: the board tells its own agent's work by the agent's id when the service sends one, and by the stored
 * name only when it does not (a service from before #6705), and it refreshes the stored name from GET /agents/me so a
 * renamed agent's by-name reads (its Following feed) keep working. A fake community on a loopback port; the board's
 * own records are written in this process's sandbox.
 *
 *   node --test engine/communityself-6705.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-self-6705-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
const store = require('./communitystore');
const communityread = require('./communityread');
const home = require('./communityhome');
const self = require('./communityself');
const { eventually } = require('../test-support/eventually');
communityread.setFetcher(async (url) => { const r = await fetch(url); let json = null; try { json = await r.json(); } catch { json = null; } return { status: r.status, json }; });

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const AID = id(7001);     // mara's agent id
const OTHER = id(7002);   // another agent that later took the name "mara"
const POST = id(1);
const HEX = 'abcdef01-2345-4678-9abc-def012345678';   // letters, so a case change shows (id() is all digits)
const H = 60 * 60 * 1000;
const agent = (name, aid) => ({ ...(aid === undefined ? {} : { id: aid }), name, handle: null, role: null, kind: 'agent' });

function backend() {
  const st = { seen: [], me: { status: 200, json: { agent_id: AID, name: 'Mara Two', handle: 'mara-two-1a2b' } }, thread: [], feeds: {}, signIn: ['mara'] };
  const server = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    st.seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body: body ? JSON.parse(body) : null });
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.url === '/agents/me') return send(st.me.status, st.me.json);
    // Sign-in as on #6685: only the names in st.signIn sign in (the current one, or the first while it is kept).
    if (req.url === '/agents/login') {
      const b = body ? JSON.parse(body) : {};
      return st.signIn.includes(b.name) && b.api_key === 'k' ? send(200, { token: 'tok2' }) : send(401, { detail: 'wrong name or key' });
    }
    if (req.url === '/agents/me/following/feed?limit=1') return req.headers.authorization === 'Bearer tok2' ? send(200, { items: [], next_cursor: null }) : send(401, { detail: 'invalid or expired token' });
    if (req.url === '/posts/' + POST) return send(200, { id: POST, score: 0, comment_count: st.thread.length });
    if (req.url === '/posts/' + POST + '/comments?order=newest&limit=20') return send(200, { comments: st.thread, next_cursor: null });
    const fl = req.url.match(/^\/agents\/by-name\/([^/]+)\/following\?limit=100$/);
    if (fl && st.feeds[decodeURIComponent(fl[1])]) return send(200, { agents: [], next_cursor: null });
    if (req.method === 'POST' && req.url === '/agents/by-name/Ada/follow') return req.headers.authorization === 'Bearer tok' ? send(200, { name: 'Ada', following: true, follower_count: 1 }) : send(401, {});
    const m = req.url.match(/^\/agents\/by-name\/([^/]+)\/following\/feed\?limit=30$/);
    if (m && st.feeds[decodeURIComponent(m[1])]) return send(200, st.feeds[decodeURIComponent(m[1])]);
    return send(404, { detail: 'not found' });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:' + server.address().port;
    resolve({ st, close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) });
  }));
}

cs.setSwitch(() => ({ ok: true, on: true }));
cs.setSender((url, init) => fetch(url, init));
test.after(() => { cs.setSender(null); cs.setSwitch(null); });

/* mara's records: one post the service took, an hour old, and her keys (`k` replaces the defaults). */
function fresh(now, k = {}) {
  self._resetSelfCacheForTests();
  for (const d of [cs._paths.dir(), path.dirname(cs._paths.keysFile()), store._paths.dir()]) fs.rmSync(d, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ mara: { name: 'mara', remoteId: AID, apiKey: 'k', token: 'tok', ...k } }));
  fs.writeFileSync(cs._paths.sentFile(), JSON.stringify({ l1: { state: 'sent', agent: 'mara', remoteId: POST } }));
  fs.writeFileSync(cs._paths.deletesFile(), '{}');
  fs.mkdirSync(store._paths.dir(), { recursive: true });
  fs.writeFileSync(store._paths.postsFile(), JSON.stringify([{ id: 'l1', agent: 'mara', status: 'published', author: { type: 'agent', name: 'mara' },
    topic: 'Post 1', receivedAt: new Date(now - H).toISOString() }]));
}
const keysNow = () => JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8')).mara;
const meCalls = (st) => st.seen.filter((s) => s.url === '/agents/me');

test('sandbox: every record read is inside this process\'s temp dir', () => {
  for (const p of [cs._paths.keysFile(), cs._paths.sentFile(), store._paths.postsFile()]) assert.ok(p.startsWith(SANDBOX), p);
});

test('the rule: by id when the author carries one, by name only when it does not, never a person', () => {
  const me = { id: AID, name: 'mara' };
  assert.equal(self.isOwn(me, agent('Mara Two', AID)), true, 'renamed: the old stored name, the new author name, the same id');
  assert.equal(self.isOwn({ id: HEX, name: 'mara' }, agent('Mara Two', HEX.toUpperCase())), true, 'the id is compared without case');
  assert.equal(self.isOwn(me, agent('mara', OTHER)), false, 'the same name with another id was taken as this agent');
  assert.equal(self.isOwn(me, agent('MARA ')), true, 'no id on the wire (an older service): the name, case-folded, decides');
  assert.equal(self.isOwn(me, agent('Mara Two')), false, 'no id on the wire and another name');
  assert.equal(self.isOwn(me, agent('mara', null)), true, 'a null id is no id');
  assert.equal(self.isOwn({ id: '', name: 'mara' }, agent('mara', AID)), false, 'an author with an id is never matched by name');
  assert.equal(self.isOwn(me, { name: 'mara', kind: 'person' }), false, 'a person who took the agent\'s name');
  assert.equal(self.isOwn({ id: '', name: '' }, agent('')), false, 'nothing known matches nothing');
  assert.equal(self.isOwn('mara', agent('mara')), true, 'a bare name still works as a self');
});

test('read: an answer by the renamed agent (same id) clears a person\'s comment; one by a namesake with another id does not', () => {
  const at = (s) => new Date(Date.parse('2026-10-20T10:00:00Z') + s * 1000).toISOString();
  // A person's top comment and one reply under it, as the read's own commentOf builds them.
  const t = (by) => {
    const c = communityread.commentOf({ id: id(501), state: 'live', body: 'hi', created_at: at(0), agent: { id: null, name: 'Pat', kind: 'person' } });
    c.replies = [communityread.commentOf({ id: id(502), state: 'live', body: 'hello', created_at: at(5), agent: by }, true)];
    return c;
  };
  const me = { id: AID, name: 'mara' };
  assert.deepEqual(communityread.personOwed([t(agent('Mara Two', AID))], me), [], 'the renamed agent\'s own answer was not seen as its own');
  assert.equal(communityread.personOwed([t(agent('mara', OTHER))], me).length, 1, 'a namesake\'s reply answered for the agent');
  assert.deepEqual(communityread.personOwed([t(agent('mara'))], me), [], 'an older service (no id): the stored name did not decide');
});

test('home after a rename: own comments by id, the feed by the new name, keys.json rewritten, /agents/me asked once', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    be.st.thread = [
      { id: id(101), state: 'live', agent: agent('Mara Two', AID), replies: [], replies_cursor: null },                        // her own, renamed
      { id: id(102), state: 'live', agent: agent('mara', OTHER), replies: [], replies_cursor: null },                          // a namesake: owed
      { id: id(103), state: 'live', agent: agent('Ada', id(7003)), replies: [{ agent: agent('Mara Two', AID) }], replies_cursor: null },   // answered
    ];
    be.st.feeds['Mara Two'] = { next_cursor: null, items: [{ kind: 'post', id: id(301), created_at: new Date(now - H).toISOString(), agent: agent('Fay', id(7004)), post: { title: 'Hi' } }] };
    const h = await home.homeFor('mara', { now });
    assert.deepEqual(h.posts[0].unanswered.map((u) => u.id), [id(102)]);
    assert.equal(h.following && h.following.count, 1, 'the Following feed was not read by the new name');
    assert.equal(meCalls(be.st).length, 1);
    assert.equal(meCalls(be.st)[0].auth, 'Bearer tok', 'GET /agents/me went without the agent\'s token');
    await eventually(() => keysNow().currentName, (n) => n === 'Mara Two');
    const k = keysNow();
    assert.equal(k.name, 'mara', 'the sign-in name was overwritten');
    assert.equal(k.remoteId, AID);
    assert.equal(k.apiKey, 'k', 'the refresh lost the key');
    assert.equal(k.token, 'tok', 'the refresh lost the token');
    await home.homeFor('mara', { now });
    assert.equal(meCalls(be.st).length, 1, 'GET /agents/me was asked again inside its interval');
    assert.equal(be.st.seen.filter((s) => s.method !== 'GET').length, 0, 'the refresh sent a write (or logged in)');
  } finally { await be.close(); }
});

test('an older service: /agents/me answers 404, nothing throws, the stored name stands and decides, asked once', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    be.st.me = { status: 404, json: { detail: 'Not Found' } };
    be.st.thread = [
      { id: id(101), state: 'live', agent: agent('mara'), replies: [], replies_cursor: null },                                  // her own (no id)
      { id: id(102), state: 'live', agent: agent('Bo'), replies: [{ agent: agent('MARA') }], replies_cursor: null },          // answered
      { id: id(103), state: 'live', agent: agent('Cy'), replies: [], replies_cursor: null },                                   // owed
    ];
    be.st.feeds.mara = { next_cursor: null, items: [] };
    const before = fs.readFileSync(cs._paths.keysFile(), 'utf8');
    const h = await home.homeFor('mara', { now });
    assert.deepEqual(h.posts[0].unanswered.map((u) => u.id), [id(103)]);
    assert.equal(h.following && h.following.count, 0, 'the feed was not read by the stored name');
    assert.equal(fs.readFileSync(cs._paths.keysFile(), 'utf8'), before, 'keys.json changed on a 404');
    assert.deepEqual(await self.current('mara'), { id: AID, name: 'mara' });
    assert.equal(meCalls(be.st).length, 1, 'a 404 was asked again inside the interval');
    assert.equal(self._selfCacheForTests('mara').ms, self.REFRESH_MS, 'an answer (a 404) is not waited on for the full interval');
  } finally { await be.close(); }
});

test('a missing remoteId is filled from agent_id; a different one changes nothing', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now, { remoteId: undefined });
    be.st.me = { status: 200, json: { agent_id: HEX.toUpperCase(), name: 'mara', handle: 'mara' } };
    const r = await cs.refreshSelf('mara');
    assert.ok(r.saved, 'no write was made for a missing remoteId');
    await r.saved;
    assert.equal(keysNow().remoteId, HEX, 'the filled id was not lower-cased');
    assert.equal('currentName' in keysNow(), false, 'a current name equal to the sign-in name was stored');

    fresh(now, { remoteId: OTHER });
    be.st.me = { status: 200, json: { agent_id: AID, name: 'Mara Two', handle: 'm' } };
    const before = fs.readFileSync(cs._paths.keysFile(), 'utf8');
    const r2 = await cs.refreshSelf('mara');
    assert.equal(r2.self, null, 'another account\'s answer was taken');
    assert.equal(r2.saved, null, 'a write was queued for another account\'s answer');
    assert.equal(fs.readFileSync(cs._paths.keysFile(), 'utf8'), before);
    assert.deepEqual(await self.current('mara'), { id: OTHER, name: 'mara' });
  } finally { await be.close(); }
});

test('an existing remoteId is never rewritten (sent records compare it exactly), only a missing one is filled', async () => {
  const be = await backend();
  try {
    fresh(Date.now(), { remoteId: HEX.toUpperCase() });
    be.st.me = { status: 200, json: { agent_id: HEX, name: 'Mara Two', handle: 'm' } };
    const r = await cs.refreshSelf('mara');
    assert.ok(r.saved, 'the rename was not written');
    await r.saved;
    assert.equal(keysNow().remoteId, HEX.toUpperCase(), 'the stored remoteId was rewritten');
    assert.equal(keysNow().currentName, 'Mara Two');
  } finally { await be.close(); }
});

test('a current name the board could not use in a by-name path changes nothing', async () => {
  const be = await backend();
  try {
    for (const bad of ['Mara/Two', 'x'.repeat(81), 'Mara\u0007Two', '..', 42]) {
      fresh(Date.now());
      be.st.me = { status: 200, json: { agent_id: AID, name: bad, handle: 'm' } };
      const before = fs.readFileSync(cs._paths.keysFile(), 'utf8');
      const r = await cs.refreshSelf('mara');
      assert.equal(r.self, null, 'a name it cannot use was taken: ' + JSON.stringify(bad));
      assert.equal(r.saved, null, 'a write was queued for ' + JSON.stringify(bad));
      assert.equal(fs.readFileSync(cs._paths.keysFile(), 'utf8'), before);
      assert.deepEqual(await self.current('mara'), { id: AID, name: 'mara' });
    }
  } finally { await be.close(); }
});

test('a follow after a rename reads the following list by the new name, and the follow lands inside its budget', async () => {
  const be = await backend();
  const follow = require('./communityfollow');
  try {
    fresh(Date.now());
    follow._resetRate();
    be.st.feeds['Mara Two'] = { next_cursor: null, items: [] };
    const r = await follow.follow('mara', 'Ada');
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(be.st.seen.some((x) => x.url === '/agents/by-name/Mara%20Two/following?limit=100'), 'the following list was not read by the new name');
    assert.ok(!be.st.seen.some((x) => x.url === '/agents/by-name/mara/following?limit=100'), 'the following list was read by the old name');
    assert.equal(be.st.seen.filter((x) => x.method === 'POST' && x.url === '/agents/by-name/Ada/follow').length, 1, 'the follow was not sent');
  } finally { await be.close(); }
});

test('after a rename the board still signs in with the registered name, and the account is never switched off', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    // The agent was hidden as "Mara Two" and then restored: only "mara" signs in now; the token has expired.
    fresh(now, { currentName: 'Mara Two', token: 'stale' });
    be.st.signIn = ['mara'];
    const r = await cs.agentCall('mara', 'GET', '/agents/me/following/feed?limit=1', { register: false });
    assert.equal(r.status, 200, JSON.stringify(r));
    const logins = be.st.seen.filter((x) => x.url === '/agents/login');
    assert.deepEqual(logins.map((x) => x.body.name), ['mara'], 'signed in with the refreshed name');
    assert.equal(keysNow().refused, undefined, 'the account was switched off');
    assert.equal(keysNow().currentName, 'Mara Two');
  } finally { await be.close(); }
});

test('a refresh written while a later account took the row is not answered from the cache', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now);
    assert.deepEqual(await self.current('mara'), { id: AID, name: 'Mara Two' });
    // The agent is deleted and made again under the same session name: a new key, no id yet.
    fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ mara: { name: 'mara', apiKey: 'k-new', token: 'tok' } }));
    assert.deepEqual(await self.current('mara'), { id: '', name: 'mara' }, 'the old account\'s id and name came back from the cache');
  } finally { await be.close(); }
});

test('nothing is asked without a token, with the switch off, or when the service does not answer, and nothing throws', async () => {
  const be = await backend();
  try {
    const now = Date.now();
    fresh(now, { token: undefined });
    assert.deepEqual(await self.current('mara'), { id: AID, name: 'mara' });
    assert.equal(meCalls(be.st).length, 0, 'asked without a token (it would have had to log in)');
    fresh(now);
    cs.setSwitch(() => ({ ok: true, on: false }));
    try { assert.deepEqual(await self.current('mara'), { id: AID, name: 'mara' }); } finally { cs.setSwitch(() => ({ ok: true, on: true })); }
    assert.equal(meCalls(be.st).length, 0, 'asked with the community switched off');
    self._resetSelfCacheForTests();
    assert.deepEqual(await self.current('mara', { deadline: Date.now() + 10 }), { id: AID, name: 'mara' });
    assert.equal(meCalls(be.st).length, 0, 'asked with less than one request\'s time left');
  } finally { await be.close(); }
  fresh(Date.now());   // the backend is closed: no answer
  assert.deepEqual(await self.current('mara'), { id: AID, name: 'mara' });
  assert.equal(self._selfCacheForTests('mara').ms, self.RETRY_MS, 'no answer waits the full interval');
  assert.ok(self.RETRY_MS < self.REFRESH_MS);
  assert.deepEqual(await self.current(''), { id: '', name: '' }, 'an empty agent');
});
