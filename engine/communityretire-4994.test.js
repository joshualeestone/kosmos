'use strict';
/**
 * kosmos#4994: deleting an agent's leftover frees its name, and a new agent under that name must not inherit the old
 * one's community account. communitysend.requestRetire records the request; the next keys.json section moves the old
 * account to a retired key, so the owner's deletes still reach the old account's public posts and the name registers
 * fresh.
 *
 * A fake kosmos-community on a loopback port answers register, a post delete and GET /agents/me. Fixture rows use
 * only the shapes ensureRegistered and sendPost write. Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-retire-4994-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');

function backend() {
  const st = { seen: [], n: 0, agents: new Map([['tok_r1', 'r1']]), posts: new Map([['remote-1', 'r1']]) };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
      st.seen.push({ method: req.method, url: req.url, body, auth });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        if (st.onRegister) st.onRegister();                // something happens while the registration is out
        if (st.clashOnce) { st.clashOnce = false; return send(409, { detail: 'name taken' }); }   // the name is taken: retried
        const id = 'n' + (++st.n);
        st.agents.set('tok_' + id, id);
        return send(201, { agent_id: id, name: body.name, name_replaced: false, api_key: 'kc_key_' + id, token: 'tok_' + id });
      }
      const who = st.agents.get(auth);
      if (!who) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'GET' && req.url === '/agents/me') return send(200, { id: who });
      if (req.method === 'GET' && req.url === '/agents/me/posts') {
        if (st.minePosts503) return send(503, { detail: 'busy' });                    // the service cannot say yet
        return send(200, []);                                                       // nothing of an unanswered send arrived
      }
      if (req.method === 'POST' && req.url === '/posts') {
        const id = 'p' + (++st.n);
        st.posts.set(id, who);
        return send(201, { id });
      }
      const d = /^\/posts\/([^/]+)$/.exec(req.url);
      if (req.method === 'DELETE' && d) {
        const id = decodeURIComponent(d[1]);
        if (st.posts.get(id) !== who) return send(404, { detail: 'not found' });   // the service: only its own agent
        st.posts.delete(id);
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
let SW = { on: true, ok: true };
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  fs.rmSync(data, { recursive: true, force: true });
  SW = { on: true, ok: true };
  cs.setSwitch(() => SW);
  be = await backend();
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj));
}
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
// The old agent's registration and one public post of it, as ensureRegistered and sendPost write them.
const REX_KEY = { remoteId: 'r1', name: 'rex', apiKey: 'kc_key_r1', token: 'tok_r1', registeredAt: '2026-09-28T07:00:00.000Z' };
function oldAgentOnFile() {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  writeJson(cs._paths.sentFile(), { 'local-1': { state: 'sent', agent: 'rex', remoteId: 'remote-1', sentAt: '2026-09-28T08:00:00.000Z' } });
  writeJson(cs._paths.commentsSentFile(), { 'c-1': { state: 'sent', agent: 'rex', post: 'remote-9', remoteId: 'rc-1', agentId: 'r1' } });
}
const retireFiles = () => (fs.existsSync(cs._paths.retireDir()) ? fs.readdirSync(cs._paths.retireDir()) : []);

test('retired, not dropped: the old account moves to a key no agent name can match, and every record of it follows', async () => {
  oldAgentOnFile();
  cs.requestRetire('rex');
  await cs.sweep();
  const keys = readJson(cs._paths.keysFile());
  assert.equal(keys.rex, undefined, 'the freed name still holds the old account');
  const retired = Object.keys(keys).filter((k) => k.startsWith('retired:rex:'));
  assert.equal(retired.length, 1, `expected one retired entry, got ${JSON.stringify(Object.keys(keys))}`);
  const { apiKey, token, remoteId } = keys[retired[0]];
  assert.deepEqual({ apiKey, token, remoteId }, { apiKey: REX_KEY.apiKey, token: REX_KEY.token, remoteId: REX_KEY.remoteId }, 'the retired entry lost the old account\'s key');
  assert.ok(!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(retired[0]), 'a retired key an agent name could equal');
  assert.equal(readJson(cs._paths.sentFile())['local-1'].agent, retired[0]);
  assert.equal(readJson(cs._paths.commentsSentFile())['c-1'].agent, retired[0]);
  assert.deepEqual(retireFiles(), [], 'an applied request was left on file');
});

test('the owner\'s delete of the old agent\'s public post still reaches it, as the account that made it', async () => {
  oldAgentOnFile();
  cs.requestRetire('rex');
  await cs.sweep();
  writeJson(cs._paths.deletesFile(), { 'local-1': new Date().toISOString() });   // as requestDelete writes it
  await cs.sweep();
  const del = be.st.seen.filter((s) => s.method === 'DELETE');
  assert.equal(del.length, 1, 'the delete never went out');
  assert.equal(del[0].auth, 'tok_r1', 'the delete was asked by an account that is not the post\'s');
  assert.equal(be.st.posts.has('remote-1'), false, 'the public post is still up');
  assert.equal(readJson(cs._paths.sentFile())['local-1'].state, 'deleted');
});

test('a new agent under the freed name joins as itself, never as the old account', async () => {
  oldAgentOnFile();
  // CONTROL: before the retirement, the name acts as the old account (the bug this card fixes).
  const before = await cs.agentCall('rex', 'GET', '/agents/me');
  assert.equal(before.ok && before.json && before.json.id, 'r1', 'CONTROL: the fixture is not the old account');
  cs.requestRetire('rex');
  const after = await cs.agentCall('rex', 'GET', '/agents/me');
  assert.equal(after.ok, true, after.because);
  assert.notEqual(after.json && after.json.id, 'r1', 'the new agent spoke as the old account');
  assert.equal(be.st.seen.filter((s) => s.method === 'POST' && s.url === '/agents/register').length, 1, 'no fresh registration');
});

test('a request applied twice (a stop between saves) is the same as once: one retired entry, the name free', async () => {
  oldAgentOnFile();
  cs.requestRetire('rex');
  const [file] = retireFiles();
  const req = readJson(path.join(cs._paths.retireDir(), file));
  // A stop after save 1 (keys.json holds both entries), as retireIn writes it.
  writeJson(cs._paths.keysFile(), { rex: REX_KEY, [`retired:rex:${req.at}`]: REX_KEY });
  await cs.sweep();
  const keys = readJson(cs._paths.keysFile());
  assert.deepEqual(Object.keys(keys), [`retired:rex:${req.at}`]);
  assert.equal(readJson(cs._paths.sentFile())['local-1'].agent, `retired:rex:${req.at}`);
});

test('an unreadable record keeps the request on file, and the name acts as nobody until it lands', async () => {
  oldAgentOnFile();
  fs.writeFileSync(cs._paths.sentFile(), '{ not json');
  cs.requestRetire('rex');
  await cs.sweep();
  assert.equal(retireFiles().length, 1, 'the request was dropped while a record of the old account could not be moved');
  const r = await cs.agentCall('rex', 'GET', '/agents/me');
  assert.notEqual(r.ok && r.json && r.json.id, 'r1', 'the name spoke as the old account while its retirement was pending');
  assert.equal(be.st.seen.filter((s) => s.method === 'POST' && s.url === '/agents/register').length, 0, 'registered a new account while the old one was still the name\'s');
  writeJson(cs._paths.sentFile(), { 'local-1': { state: 'sent', agent: 'rex', remoteId: 'remote-1', sentAt: '2026-09-28T08:00:00.000Z' } });
  await cs.sweep();
  assert.deepEqual(retireFiles(), [], 'the request did not land once the record could be read');
  assert.equal(readJson(cs._paths.keysFile()).rex, undefined);
});

test('a name that never joined the community: the request lands as a no-op and leaves nothing behind', async () => {
  cs.requestRetire('quiet');
  await cs.sweep();
  assert.deepEqual(retireFiles(), []);
  assert.deepEqual(readJson(cs._paths.keysFile()), {});
});

// Publish a post as an agent through the real choke, as communitysend.test.js does.
function agentPost(agent, fields) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), ...fields }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const postsBy = (tok) => be.st.seen.filter((s) => s.method === 'POST' && s.url === '/posts' && (tok === undefined || s.auth === tok));
const findRow = (recs, agentPrefix) => Object.values(recs).filter((r) => String(r.agent).startsWith(agentPrefix));

test('what the deleted agent published but never sent is not sent: it goes out under neither account', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  agentPost('rex', { topic: 'sent before', body: 'one' });
  await cs.sweep();
  assert.equal(postsBy('tok_r1').length, 1, 'CONTROL: a post by the old agent does go out in this setup');
  agentPost('rex', { topic: 'never sent', body: 'two' });
  cs.requestRetire('rex');
  await cs.sweep();
  assert.equal(postsBy().length, 1, 'the deleted agent\'s unsent post went out');
  const recs = readJson(cs._paths.sentFile());
  const sentRow = Object.values(recs).find((r) => r.state === 'sent');
  assert.match(sentRow.agent, /^retired:rex:/, 'the sent post\'s record does not follow the old account');
  assert.equal(Object.values(recs).length, 1, `an item with no record got one: ${JSON.stringify(recs)}`);
  const never = communitystore.publishedPosts().find((p) => p.topic === 'never sent' || (p.title || '') === 'never sent' || p.body === 'two');
  assert.equal(never && never.notSent, true, 'the unsent post is not marked never to send in the store');
});

test('a record left pending (a 429) is marked not sent, never sent later as the new agent and then mis-deleted', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'capped', body: 'three' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  writeJson(cs._paths.sentFile(), { [id]: { state: 'pending', agent: 'rex' } });   // as settle(rec, {}) leaves a 429
  cs.requestRetire('rex');
  await cs.sweep();
  assert.equal(postsBy().length, 0, 'the pending post went out after its agent was deleted');
  assert.equal(readJson(cs._paths.sentFile())[id].state, 'not_sent');
});

test('an unreadable record in ANOTHER service\'s folder does not hold the name on this one', async () => {
  oldAgentOnFile();
  const stale = path.join(cs._paths.dir(), 'aaaaaaaaaaaa');
  writeJson(path.join(stale, 'keys.json'), { rex: { ...REX_KEY, remoteId: 'old-service' } });
  fs.writeFileSync(path.join(stale, 'sent.json'), '{ not json');
  cs.requestRetire('rex');
  const r = await cs.agentCall('rex', 'GET', '/agents/me');
  assert.equal(r.ok, true, r.because);
  assert.notEqual(r.json && r.json.id, 'r1', 'the new agent spoke as the old account');
  const left = retireFiles();
  assert.equal(left.length, 1, 'the stale folder\'s retirement was given up on');
  const req = readJson(path.join(cs._paths.retireDir(), left[0]));
  assert.deepEqual(req.done, [path.basename(cs._paths.endpointDir())], 'the current service\'s folder is not recorded done');
  assert.ok(readJson(path.join(stale, 'keys.json')).rex, 'CONTROL: the stale folder really was left as it was');
});

test('a post the NEW agent publishes while the request waits for the lock is its own: sent as itself, not kept back', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  // A request recorded before the new agent's post, as requestRetire writes it (written here so no section applies it
  // first, standing in for a long sweep holding the lock).
  const at = new Date(Date.now() - 1000).toISOString();
  writeJson(path.join(cs._paths.retireDir(), `${Date.now()}-0000.json`), { agent: 'rex', at, done: [] });
  agentPost('rex', { topic: 'new agent', body: 'hello' });
  await cs.sweep();
  const sent = postsBy();
  assert.equal(sent.length, 1, 'the new agent\'s post was kept back as the deleted agent\'s');
  assert.notEqual(sent[0].auth, 'tok_r1', 'the new agent\'s post went out as the old account');
  const recs = readJson(cs._paths.sentFile());
  assert.deepEqual(Object.values(recs).map((r) => [r.state, r.agent]), [['sent', 'rex']]);
});

test('a send that got no answer, which the service never received, is not sent later as the new agent', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'unanswered', body: 'four' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  writeJson(cs._paths.sentFile(), { [id]: { state: 'pending', agent: 'rex', attempted: true } });   // as sendPost's write-ahead leaves it
  cs.requestRetire('rex');
  await cs.sweep();                                        // settles it as never received, then the post pass runs
  await cs.sweep();
  assert.ok(be.st.seen.some((x) => x.url === '/agents/me/posts' && x.auth === 'tok_r1'), 'CONTROL: the old account was asked whether it arrived');
  assert.equal(postsBy().length, 0, 'the deleted agent\'s post went out as the new agent');
  const rec = readJson(cs._paths.sentFile())[id];
  assert.equal(rec.state, 'not_sent');
  assert.deepEqual(rec.reasons, ['agent_deleted']);
});

test('the owner\'s list names a deleted agent\'s rows as a deleted agent, never by the new agent\'s display name', async () => {
  const mine = require('./communitymine');
  oldAgentOnFile();
  agentPost('rex', { topic: 'old public post', body: 'five' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  writeJson(cs._paths.sentFile(), { [id]: { state: 'sent', agent: 'rex', remoteId: 'remote-1', sentAt: '2026-09-28T08:00:00.000Z' } });
  require('./store').writeProfile('rex', { displayName: 'Rex the Second', role: 'pm' });   // the new agent under the name
  assert.equal(mine.mine().find((r) => r.id === id).agent, 'Rex the Second', 'CONTROL: before retirement the row takes the profile\'s name');
  cs.requestRetire('rex');
  await cs.sweep();
  assert.equal(mine.mine().find((r) => r.id === id).agent, 'rex (deleted agent)');
});

test('a post the deleted agent left HELD for approval, released after the retirement, goes out under neither account', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  const r = feedpublish.publishPost({ kind: 'community_post', agent: 'rex', at: new Date().toISOString(), topic: 'held', body: 'six' }, { trusted: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  const held = communitystore.moderationQueue({ kind: 'post' }).find((p) => p.agent === 'rex');
  assert.ok(held, 'CONTROL: the post really is held');
  cs.requestRetire('rex');
  await cs.sweep();
  communitystore.releaseHeld(held.id);                     // the owner approves it after the agent was deleted
  await cs.sweep();
  assert.equal(postsBy().length, 0, 'the deleted agent\'s held post went out once released');
  const row = communitystore.publishedPosts().find((p) => p.id === held.id);
  assert.equal(row && row.notSent, true, 'the released post lost its never-send mark');
});

test('a send that got no answer, which the service cannot yet confirm either way, is left to be settled, never marked not sent', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'maybe public', body: 'seven' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  writeJson(cs._paths.sentFile(), { [id]: { state: 'pending', agent: 'rex', attempted: true } });   // sendPost's write-ahead
  be.st.minePosts503 = true;
  cs.requestRetire('rex');
  await cs.sweep();
  await cs.sweep();
  assert.ok(be.st.seen.some((x) => x.url === '/agents/me/posts' && x.auth === 'tok_r1'), 'CONTROL: the old account was asked');
  const rec = readJson(cs._paths.sentFile())[id];
  assert.equal(rec.state, 'pending', 'a post that may be public was settled as never sent');
  assert.equal(rec.attempted, true, 'the mark that it may be public was dropped');
  assert.equal(postsBy().length, 0, 'it was sent again');
});

test('willSend says later, never no, for a name whose retirement FAILED on this service (a no is permanent)', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  assert.deepEqual(cs.willSend('rex'), { sends: true, later: false }, 'CONTROL: the name sends on the next pass before any retirement');
  const ep = cs._paths.endpointDir();
  assert.ok(ep.startsWith(SANDBOX), 'refusing to chmod a folder outside this test\'s sandbox');
  fs.chmodSync(ep, 0o500);                                 // readable, but no save can land: the retirement fails here
  try {
    cs.requestRetire('rex');
    await cs.sweep();
    assert.equal(retireFiles().length, 1, 'CONTROL: the retirement really did not land');
    assert.deepEqual(cs.willSend('rex'), { sends: true, later: true }, 'a held name was not told its comment goes later');
    assert.equal(cs.postWaits('rex'), true, 'a held name was told its post goes at once');
    assert.deepEqual(cs.willSend('other'), { sends: true, later: false }, 'another agent was held by this name\'s retirement');
  } finally { fs.chmodSync(ep, 0o700); }
  await cs.sweep();
  assert.deepEqual(retireFiles(), [], 'the retirement did not land once the folder could be written');
  assert.deepEqual(cs.willSend('rex'), { sends: true, later: false });
});

test('a never-sent record whose item is not in the store is left as it is', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  writeJson(cs._paths.sentFile(), { 'gone-1': { state: 'pending', agent: 'rex' } });
  cs.requestRetire('rex');
  await cs.sweep();
  assert.deepEqual(readJson(cs._paths.sentFile())['gone-1'], { state: 'pending', agent: 'rex' });
  assert.equal(readJson(cs._paths.keysFile()).rex, undefined, 'CONTROL: the retirement did land');
});

test('an unreadable state.json at retirement, repaired later, does not send the deleted agent\'s unsent post', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  const since = readJson(cs._paths.stateFile()).since;
  assert.ok(since, 'CONTROL: an ON period was recorded');
  agentPost('rex', { topic: 'in period', body: 'nine' });  // no sweep yet, so it has no record
  fs.writeFileSync(cs._paths.stateFile(), '{ not json');
  cs.requestRetire('rex');
  await cs.sweep();
  writeJson(cs._paths.stateFile(), { since });             // the owner repairs it
  await cs.sweep();
  assert.equal(postsBy().length, 0, 'the deleted agent\'s post went out once the state file was repaired');
});

test('a never-sent record of the name whose item is not the deleted agent\'s keeps its agent', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  // As markNotSent writes it for a comment the agent was told will not go.
  writeJson(cs._paths.commentsSentFile(), { 'new-c': { state: 'not_sent', agent: 'rex', post: 'remote-9', reasons: ['not_sending'] } });
  cs.requestRetire('rex');
  await cs.sweep();
  assert.equal(readJson(cs._paths.commentsSentFile())['new-c'].agent, 'rex');
  assert.equal(readJson(cs._paths.keysFile()).rex, undefined, 'CONTROL: the retirement did land');
});

test('a store mark that fails at the delete is made when the request lands, and the post never goes', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  agentPost('rex', { topic: 'marked late', body: 'ten' });
  const storeDir = path.join(require('./store').ROOT, 'community');   // communitystore's dir()
  assert.ok(storeDir.startsWith(SANDBOX) && fs.existsSync(path.join(storeDir, 'posts.json')), `CONTROL: the store is at ${storeDir}`);
  fs.chmodSync(storeDir, 0o500);                           // no save can land: the mark at the delete fails
  try {
    cs.requestRetire('rex');
    assert.equal(communitystore.publishedPosts().find((p) => p.agent === 'rex').notSent, undefined, 'CONTROL: the mark really failed');
  } finally { fs.chmodSync(storeDir, 0o700); }
  await cs.sweep();
  assert.equal(communitystore.publishedPosts().find((p) => p.agent === 'rex').notSent, true, 'the mark was not made when the request landed');
  assert.equal(postsBy().length, 0, 'the deleted agent\'s post went out');
});

test('a store that stays unwritable through the first apply keeps the request and the name held, for an agent with no key', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, async () => {
  await cs.sweep();                                        // starts the ON period; rex never registered
  agentPost('rex', { topic: 'never registered', body: 'eleven' });
  const storeDir = path.join(require('./store').ROOT, 'community');   // communitystore's dir()
  assert.ok(storeDir.startsWith(SANDBOX) && fs.existsSync(path.join(storeDir, 'posts.json')), `CONTROL: the store is at ${storeDir}`);
  fs.chmodSync(storeDir, 0o500);
  try {
    cs.requestRetire('rex');
    await cs.sweep();                                      // the first apply runs while the store is still unwritable
    assert.equal(retireFiles().length, 1, 'the request finished without the store being marked');
    assert.equal(postsBy().length, 0, 'the deleted agent\'s post went out while its mark was missing');
    assert.equal(be.st.seen.filter((x) => x.url === '/agents/register').length, 0, 'a new account was registered under the held name');
  } finally { fs.chmodSync(storeDir, 0o700); }
  await cs.sweep();
  assert.deepEqual(retireFiles(), [], 'the request did not finish once the store could be written');
  assert.equal(communitystore.publishedPosts().find((p) => p.agent === 'rex').notSent, true);
  await cs.sweep();
  assert.equal(postsBy().length, 0, 'the deleted agent\'s post went out after the request finished');
});

test('a retire folder that cannot be read holds every name rather than freeing one', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a read with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  cs.requestRetire('rex');
  const rd = cs._paths.retireDir();
  fs.mkdirSync(rd, { recursive: true });
  assert.ok(rd.startsWith(SANDBOX), 'refusing to chmod a folder outside this test\'s sandbox');
  const before = be.st.seen.length;
  fs.chmodSync(rd, 0o000);
  try {
    assert.deepEqual(cs.willSend('rex'), { sends: true, later: true }, 'a name was told its comment goes on the next pass while the retire folder could not be read');
    const r = await cs.agentCall('rex', 'GET', '/agents/me');
    assert.equal(r.ok, false, 'the name acted while the retire folder could not be read');
    assert.equal(be.st.seen.length, before, 'something reached the service as the name');
  } finally { fs.chmodSync(rd, 0o700); }
  await cs.sweep();
  assert.equal(readJson(cs._paths.keysFile()).rex, undefined, 'CONTROL: the retirement lands once the folder can be read');
});

test('a request applied everywhere whose file cannot be removed does not hold the name afterwards', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails an unlink with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  const rd = cs._paths.retireDir();
  fs.mkdirSync(rd, { recursive: true });
  assert.ok(rd.startsWith(SANDBOX), 'refusing to chmod a folder outside this test\'s sandbox');
  // The request goes in first, then the folder stops taking changes: the apply works, the unlink cannot.
  const at = new Date().toISOString();
  writeJson(path.join(rd, `${Date.now()}-unlinkfail.json`), { agent: 'rex', at, done: [] });
  fs.chmodSync(rd, 0o500);
  try {
    await cs.sweep();
    assert.equal(retireFiles().length, 1, 'CONTROL: the request file really could not be removed');
    assert.equal(readJson(cs._paths.keysFile()).rex, undefined, 'CONTROL: the retirement itself landed');
    const r = await cs.agentCall('rex', 'GET', '/agents/me');
    assert.equal(r.ok, true, `the name stayed held after its retirement landed: ${r.because}`);
    assert.notEqual(r.json && r.json.id, 'r1');
  } finally { fs.chmodSync(rd, 0o700); }
});

test('an agent deleted while its first registration is on the network does not then send its post', async () => {
  await cs.sweep();                                        // starts the ON period; rex has no key yet
  agentPost('rex', { topic: 'first post', body: 'twelve' });
  be.st.onRegister = () => { be.st.onRegister = null; cs.requestRetire('rex'); };   // the owner deletes it meanwhile
  await cs.sweep();
  assert.equal(be.st.seen.filter((x) => x.url === '/agents/register').length, 1, 'CONTROL: the registration really was out');
  await cs.sweep();
  assert.equal(postsBy().length, 0, 'the deleted agent\'s post went out after its registration answered');
  const keys = readJson(cs._paths.keysFile());
  assert.equal(keys.rex, undefined, 'the account registered for the deleted agent was left live under the name');
  assert.equal(Object.keys(keys).filter((k) => k.startsWith('retired:rex:')).length, 1);
  assert.deepEqual(retireFiles(), []);
});

test('willSend ignores the deleted agent\'s refused key while the name is held, and still records the ON period first', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: { ...REX_KEY, refused: true } });
  assert.equal(cs.willSend('rex').sends, false, 'CONTROL: the refused old account is a no before any retirement');
  fs.rmSync(cs._paths.stateFile(), { force: true });       // no ON period recorded yet
  const ep = cs._paths.endpointDir();
  assert.ok(ep.startsWith(SANDBOX), 'refusing to chmod a folder outside this test\'s sandbox');
  cs.requestRetire('rex');
  fs.chmodSync(ep, 0o500);                                 // the retirement fails here, so the name stays held
  try {
    await cs.sweep();
    assert.equal(retireFiles().length, 1, 'CONTROL: the retirement really did not land');
    fs.rmSync(cs._paths.stateFile(), { force: true });     // the sweep may have recorded one; start from none again
    assert.deepEqual(cs.willSend('rex'), { sends: true, later: true }, 'the new agent was judged by the deleted agent\'s refused key');
    assert.ok(readJson(cs._paths.stateFile()).since, 'willSend did not record the ON period before answering');
  } finally { fs.chmodSync(ep, 0o700); }
});

test('a request applied again after the name\'s new agent registered and posted retires nothing of the new agent', async () => {
  const at = new Date(Date.now() - 60000).toISOString();   // the delete, a minute ago
  await cs.sweep();                                          // starts the ON period
  agentPost('rex', { topic: 'new agent post', body: 'thirteen' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  const NEW_KEY = { remoteId: 'n9', name: 'rex', apiKey: 'kc_key_n9', token: 'tok_n9', registeredAt: new Date().toISOString() };
  be.st.agents.set('tok_n9', 'n9');                          // the service knows the new account
  writeJson(cs._paths.keysFile(), { rex: NEW_KEY });
  writeJson(cs._paths.sentFile(), {
    [id]: { state: 'sent', agent: 'rex', remoteId: 'p9', sentAt: new Date().toISOString() },
    'gone-new': { state: 'sent', agent: 'rex', remoteId: 'p10', sentAt: new Date().toISOString() },   // its post has left the store
  });
  // The same request, as requestRetire wrote it, found again on disk (one whose file could not be removed, after a restart).
  writeJson(path.join(cs._paths.retireDir(), `${Date.now()}-stale.json`), { agent: 'rex', at, done: [], marked: true });
  await cs.sweep();
  assert.deepEqual(retireFiles(), [], 'CONTROL: the request was applied');
  const keys = readJson(cs._paths.keysFile());
  assert.deepEqual(Object.keys(keys), ['rex'], 'the new agent\'s account was retired');
  assert.equal(keys.rex.token, 'tok_n9');
  assert.equal(readJson(cs._paths.sentFile())[id].agent, 'rex', 'the new agent\'s sent post was moved to the old account');
  assert.equal(readJson(cs._paths.sentFile())['gone-new'].agent, 'rex', 'a new agent\'s record whose post left the store was moved');
});

test('an agent call whose registration is on the network when the agent is deleted sends nothing as it', async () => {
  await cs.sweep();                                        // starts the ON period; rex has no key yet
  be.st.onRegister = () => { be.st.onRegister = null; cs.requestRetire('rex'); };
  const r = await cs.agentCall('rex', 'GET', '/agents/me');
  assert.equal(be.st.seen.filter((x) => x.url === '/agents/register').length, 1, 'CONTROL: the registration really was out');
  assert.equal(r.ok, false, 'the call went on as the deleted agent');
  assert.equal(be.st.seen.filter((x) => x.url === '/agents/me').length, 0, 'the call reached the service as the deleted agent');
});

test('one failed read of the retire folder does not hold every name after it can be read again', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a read with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { other: { ...REX_KEY, name: 'other' } });
  await cs.sweep();                                        // starts the ON period
  fs.mkdirSync(cs._paths.retireDir(), { recursive: true });
  assert.deepEqual(cs.willSend('other'), { sends: true, later: false }, 'CONTROL: the name is free and the folder read is cached');
  const d = cs._paths.dir();
  assert.ok(d.startsWith(SANDBOX), 'refusing to chmod a folder outside this test\'s sandbox');
  fs.chmodSync(d, 0o000);                                  // the retire folder cannot even be looked at
  try {
    await cs.sweep();                                      // its lock section reads the retire folder and fails
  } finally { fs.chmodSync(d, 0o700); }
  const held = await cs.agentCall('other', 'GET', '/agents/me');
  assert.deepEqual(cs.willSend('other'), { sends: true, later: false }, 'the name stayed held after the folder could be read again');
  assert.equal(held.ok, true, `an agent call stayed refused after the folder could be read again: ${held.because}`);
});

test('an unanswered send of a name whose retirement is stuck is not settled until the record has moved', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'unanswered, stuck', body: 'fourteen' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  writeJson(cs._paths.sentFile(), { [id]: { state: 'pending', agent: 'rex', attempted: true } });
  const storeDir = path.join(require('./store').ROOT, 'community');
  assert.ok(storeDir.startsWith(SANDBOX), `refusing to chmod ${storeDir}`);
  fs.chmodSync(storeDir, 0o500);                           // the store mark fails, so the retirement stays pending
  try {
    cs.requestRetire('rex');
    await cs.sweep();
    assert.equal(retireFiles().length, 1, 'CONTROL: the retirement really is stuck');
    assert.equal(be.st.seen.filter((x) => x.url === '/agents/me/posts').length, 0, 'the record was settled under the name while it was being retired');
    assert.equal(readJson(cs._paths.sentFile())[id].attempted, true);
  } finally { fs.chmodSync(storeDir, 0o700); }
  await cs.sweep();
  await cs.sweep();
  assert.match(readJson(cs._paths.sentFile())[id].agent, /^retired:rex:/, 'the record did not follow the old account once the retirement landed');
});

test('a post the deleted agent was sending at the delete follows the old account, though it was sent after the delete', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'on the wire', body: 'fifteen' });
  const { id } = communitystore.publishedPosts().find((p) => p.agent === 'rex');
  const at = new Date().toISOString();                     // the delete lands while the POST is out
  writeJson(cs._paths.sentFile(), { [id]: { state: 'sent', agent: 'rex', remoteId: 'remote-1', sentAt: new Date(Date.parse(at) + 1000).toISOString() } });
  writeJson(path.join(cs._paths.retireDir(), `${Date.now()}-wire.json`), { agent: 'rex', at, done: [], marked: true });
  await cs.sweep();
  assert.deepEqual(retireFiles(), [], 'CONTROL: the request was applied');
  assert.match(readJson(cs._paths.sentFile())[id].agent, /^retired:rex:/, 'the old agent\'s post was left under the name, so its delete would ask as the new agent');
});

test('while a retirement is stuck, the install group is never sent to the deleted agent\'s key, even with a new folder under the name', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();                                        // starts the ON period
  fs.writeFileSync(cs._paths.commentsSentFile(), '{ broken');   // the current folder cannot be retired yet
  cs.requestRetire('rex');
  const folder = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'rex');
  assert.ok(folder.startsWith(SANDBOX), 'refusing to write a worker folder outside this test\'s sandbox');
  fs.mkdirSync(folder, { recursive: true });               // a NEW rex now exists
  try {
    await cs.sweep();
    assert.equal(retireFiles().length, 1, 'CONTROL: the retirement really is stuck');
    const sentGroup = be.st.seen.filter((x) => x.method === 'PATCH' && x.auth === 'tok_r1' && x.body && x.body.install_group);
    assert.deepEqual(sentGroup, [], 'the install group was sent to the deleted agent\'s account');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('an unreadable retire request holds the install-group pass for live agents, rather than clearing every one', async () => {
  const AVA = { remoteId: 'a1', name: 'ava', apiKey: 'kc_key_a1', token: 'tok_a1', registeredAt: '2026-09-28T07:00:00.000Z', installGroupSent: 'old-group' };
  be.st.agents.set('tok_a1', 'a1');
  const folder = path.join(process.env.AGENT_WORKFORCE_WORKERS, 'ava');
  assert.ok(folder.startsWith(SANDBOX), 'refusing to write a worker folder outside this test\'s sandbox');
  fs.mkdirSync(folder, { recursive: true });               // a live agent
  const patches = () => be.st.seen.filter((x) => x.method === 'PATCH' && x.auth === 'tok_a1' && x.body && 'install_group' in x.body);
  try {
    writeJson(cs._paths.keysFile(), { ava: AVA });
    await cs.sweep();
    assert.ok(patches().length > 0, 'CONTROL: the install-group pass does reach a live agent in this setup');
    be.st.seen.length = 0;
    writeJson(cs._paths.keysFile(), { ava: AVA });         // back to a group to change
    fs.mkdirSync(cs._paths.retireDir(), { recursive: true });
    fs.writeFileSync(path.join(cs._paths.retireDir(), `${Date.now()}-bad.json`), '{ not json');
    cs._installGroupRetry(0);
    await cs.sweep();
    assert.deepEqual(patches(), [], 'a live agent\'s install group was changed while the retire list could not be read');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('no folder counts as done before the store mark lands, not even another service\'s, so a later switch cannot finish it unmarked', { skip: typeof process.getuid === 'function' && process.getuid() === 0 ? 'root ignores the chmod this test fails a write with' : false }, async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'switch', body: 'sixteen' });
  const other = path.join(cs._paths.dir(), 'cccccccccccc');
  writeJson(path.join(other, 'keys.json'), { rex: { ...REX_KEY, remoteId: 'other' } });
  const storeDir = path.join(require('./store').ROOT, 'community');
  assert.ok(storeDir.startsWith(SANDBOX), `refusing to chmod ${storeDir}`);
  fs.chmodSync(storeDir, 0o500);                           // the store mark cannot land
  try {
    cs.requestRetire('rex');
    await cs.sweep();
    const [f] = retireFiles();
    assert.ok(f, 'CONTROL: the request is still on file');
    const req = readJson(path.join(cs._paths.retireDir(), f));
    assert.deepEqual(req.done || [], [], 'a folder was counted done while the store mark had not landed');
    assert.ok(readJson(path.join(other, 'keys.json')).rex, 'the other service\'s key moved before the mark landed');
  } finally { fs.chmodSync(storeDir, 0o700); }
  await cs.sweep();
  assert.deepEqual(retireFiles(), [], 'the request did not finish once the store could be written');
  assert.equal(communitystore.publishedPosts().find((p) => p.agent === 'rex').notSent, true);
});

test('a stored post with no time counts as the deleted agent\'s and is marked never to send', async () => {
  writeJson(cs._paths.keysFile(), { rex: REX_KEY });
  await cs.sweep();
  agentPost('rex', { topic: 'no time', body: 'seventeen' });
  const postsFile = path.join(require('./store').ROOT, 'community', 'posts.json');
  assert.ok(postsFile.startsWith(SANDBOX), `refusing to edit ${postsFile}`);
  const rows = JSON.parse(fs.readFileSync(postsFile, 'utf8'));
  const row = rows.find((p) => p.agent === 'rex');
  delete row.receivedAt;                                   // a row from before the store kept this field
  fs.writeFileSync(postsFile, JSON.stringify(rows));
  cs.requestRetire('rex');
  await cs.sweep();
  const after = JSON.parse(fs.readFileSync(postsFile, 'utf8')).find((p) => p.id === row.id);
  assert.equal(after.notSent, true, 'a post with no time was left sendable after its agent was deleted');
  assert.equal(postsBy().length, 0);
});

test('with the retire list unreadable, a live agent whose key the service refused is still told no, not later', async () => {
  writeJson(cs._paths.keysFile(), { ava: { ...REX_KEY, name: 'ava', refused: true } });
  await cs.sweep();
  assert.equal(cs.willSend('ava').sends, false, 'CONTROL: a refused key is a no');
  fs.mkdirSync(cs._paths.retireDir(), { recursive: true });
  const bad = path.join(cs._paths.retireDir(), `${Date.now()}-bad.json`);
  fs.writeFileSync(bad, '{ not json');
  assert.deepEqual(cs.willSend('ava'), { sends: false, later: false }, 'a refused agent was promised its comment goes later');
  fs.writeFileSync(bad, JSON.stringify({ agent: 'nobody', at: new Date().toISOString(), done: [] }));   // repaired in place
  const r = await cs.agentCall('ava', 'GET', '/agents/me');
  assert.doesNotMatch(String(r.because || ''), /cannot read its list of retired community accounts/, 'a request repaired in place still held every name');
});

test('an agent deleted during a registration that clashes on its name is not registered again on the retry', async () => {
  await cs.sweep();                                        // starts the ON period; rex has no key yet
  agentPost('rex', { topic: 'clash', body: 'eighteen' });
  be.st.clashOnce = true;
  be.st.onRegister = () => { be.st.onRegister = null; cs.requestRetire('rex'); };
  await cs.sweep();
  assert.equal(be.st.seen.filter((x) => x.url === '/agents/register').length, 1, 'a second registration went out for the deleted agent');
  assert.equal(postsBy().length, 0);
});
