'use strict';
/**
 * The community send layer (kosmos#4287). A fake backend on a loopback port answers
 * with the kosmos-community contract (#4282): register / login / posts / delete /
 * me/posts, refusing unknown keys and unknown channels the way the real one does.
 * Each numbered test is one line of the card's acceptance list.
 * Sandboxed data root before the require.
 */
require('../test-support/tmpscope'); // #4273: this file's temp dirs go with the process
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communitysend-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const store = require('./store');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const cs = require('./communitysend');

const CHANNELS = new Set(['general', 'engineering', 'operations']);

// A fake kosmos-community. `mode` bends one behaviour per test.
function backend() {
  const st = { agents: new Map(), posts: new Map(), seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      const send = (code, obj, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (st.mode.hang) return; // never answers
      const who = () => {
        const t = (req.headers.authorization || '').replace(/^Bearer /, '');
        for (const a of st.agents.values()) if (a.token === t && a.active) return a;
        return null;
      };
      if (req.method === 'POST' && req.url === '/agents/register') {
        if ([...st.agents.values()].some((a) => a.name.toLowerCase() === body.name.toLowerCase())) return send(409, { detail: 'that name is taken' });
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, bio: body.bio, key: 'kc_key_' + id, token: 'tok_' + id + '_1', active: true };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'POST' && req.url === '/agents/login') {
        const a = [...st.agents.values()].find((x) => x.name === body.name && x.key === body.api_key && x.active);
        if (!a) return send(401, { detail: 'wrong name or key' });
        a.token = 'tok_' + a.id + '_' + (++st.n);
        return send(200, { token: a.token });
      }
      const a = who();
      if (req.method === 'POST' && req.url === '/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const extra = Object.keys(body).filter((k) => !['channel', 'sub_channel', 'title', 'body'].includes(k));
        if (extra.length) return send(400, { error: 'unknown_fields', fields: extra });
        if (!CHANNELS.has(body.channel)) return send(400, { detail: 'unknown channel' });
        if (st.mode.refuse) return send(422, { detail: { error: 'refused_by_feedguard', reasons: ['email'] } });
        if (st.mode.cap) return send(429, { detail: { error: 'daily_post_limit', limit: 3 } }, { 'retry-after': '7200' });
        const id = 'p' + (++st.n);
        st.posts.set(id, { id, agent: a.id, ...body, deleted: false, taken_down: false, take_down_reason: null });
        return send(201, { id, ...body });
      }
      if (req.method === 'DELETE' && req.url.startsWith('/posts/')) {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const p = st.posts.get(decodeURIComponent(req.url.slice(7)));
        if (!p || p.agent !== a.id || p.deleted) return send(404, { detail: 'post not found' });
        p.deleted = true;
        return send(204);
      }
      if (req.method === 'GET' && req.url === '/agents/me/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        return send(200, [...st.posts.values()].filter((p) => p.agent === a.id && !p.deleted)
          .map((p) => ({ id: p.id, channel: p.channel, sub_channel: p.sub_channel, title: p.title, body: p.body,
            taken_down: p.taken_down, take_down_reason: p.take_down_reason })));
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
// Turn the switch on (Renet's #4288 contract: on && ok), then one empty sweep so the
// layer records when it first found it on; posts published after that are due.
async function on() { SW = { on: true, ok: true }; await cs.sweep(); }
function fresh() {
  SW = { on: false, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(process.env.AGENT_WORKFORCE_DATA, { recursive: true, force: true });
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
}
test.beforeEach(async () => { fresh(); be = await backend(); });
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });

// Publish a post as an agent through the real choke. trusted -> published, else held.
// #3485 (2026-09-30): an agentId now publishes straight away, so a HELD fixture asks the choke
// for the hold explicitly (trusted: false), standing for a row held before that update.
function agentPost(agent, fields, { trusted = true } = {}) {
  if (trusted) communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), ...fields }, trusted ? { agentId: agent } : { trusted: false });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const posts = () => be.st.seen.filter((s) => s.method === 'POST' && s.url === '/posts');

test('the state files land under the sandboxed data root', () => {
  assert.ok(cs._paths.dir().startsWith(SANDBOX));
});

/* #4288 landed engine/communityswitch.js, so the tripwire that stood here (the switch reads OFF while the
   module is missing) is replaced, as it asked, by the real default through the REAL module: no file reads
   ON (Josh's ruling on #3485), a person's OFF sends nothing, and a file that cannot be read sends nothing. */
test('#4288: the real switch reads ON with no file, and an OFF or unreadable community.json sends nothing', async () => {
  cs.setSwitch(null);                        // the real module
  const sw = require('./communityswitch');
  assert.ok(sw.FILE.startsWith(SANDBOX + path.sep), 'the real switch file is not in this test\'s sandbox');
  fs.rmSync(sw.FILE, { force: true, recursive: true });
  try {
    assert.equal(cs.switchOn(), true, 'no community.json must read ON (the default, Josh on #3485)');
    assert.deepEqual(sw.setOn(false), { ok: true });
    assert.equal(cs.switchOn(), false, 'a person\'s OFF did not reach the send layer');
    agentPost('ava', { topic: 'Hi', body: 'hello' });
    assert.deepEqual(await cs.sweep(), { skipped: 'off' });
    assert.equal(be.st.seen.length, 0, 'a post was sent with the switch OFF');
    fs.writeFileSync(sw.FILE, '{not json');
    assert.equal(cs.switchOn(), false, 'an unreadable community.json must read OFF');
  } finally {
    fs.rmSync(sw.FILE, { force: true, recursive: true });
  }
});

test('the switch counts only as on === true AND ok === true', () => {
  for (const [v, want] of [[{ on: true, ok: true }, true], [{ on: true, ok: false }, false],
    [{ on: false, ok: true }, false], [{ on: 'true', ok: true }, false], [null, false]]) {
    SW = v;
    assert.equal(cs.switchOn(), want, JSON.stringify(v));
  }
  cs.setSwitch(() => { throw new Error('unreadable'); });
  assert.equal(cs.switchOn(), false);
});

test('1. a published post reaches the backend with exactly the pinned keys', async () => {
  await on();
  store.writeProfile('ava', { displayName: 'Ava', role: 'Operations assistant' });
  const r = agentPost('ava', { topic: 'Weekly ops', body: 'We moved invoicing to Tuesdays.' });
  await cs.sweep();
  assert.equal(posts().length, 1);
  assert.deepEqual(Object.keys(posts()[0].body).sort(), [...cs.PAYLOAD_KEYS].sort());
  assert.deepEqual(posts()[0].body, { channel: 'general', sub_channel: null, title: 'Weekly ops', body: 'We moved invoicing to Tuesdays.' });
  const reg = be.st.seen.find((s) => s.url === '/agents/register');
  assert.deepEqual(reg.body, { name: 'Ava', bio: 'Operations assistant' });
  assert.equal(cs.statuses()[r.id].state, 'sent');
  // A second sweep does not send it again.
  await cs.sweep();
  assert.equal(posts().length, 1);
});

test('2. held and quarantined posts never leave; the same post, once released, does', async () => {
  await on();
  const held = agentPost('bo', { topic: 'Draft', body: 'a clean post from a new agent' }, { trusted: false });
  assert.equal(held.status, 'held');
  const q = agentPost('bo', { topic: 'Oops', body: 'write to me at bo@example.com' }, { trusted: false });
  assert.equal(q.status, 'quarantined');
  await cs.sweep();
  assert.equal(posts().length, 0, 'a held or quarantined post was sent');
  communitystore.releaseHeld(held.id);       // the owner releases it
  await cs.sweep();
  assert.equal(posts().length, 1);
  assert.equal(posts()[0].body.body, 'a clean post from a new agent');
  assert.ok(!JSON.stringify(be.st.seen).includes('bo@example.com'));
});

test('3. with the switch OFF nothing is sent, including a post that was due', async () => {
  await on();
  SW = { on: false, ok: true };
  agentPost('cy', { topic: 'x', body: 'y' });
  await cs.sweep();
  assert.equal(be.st.seen.length, 0);
});

test('posts published before the switch first went on are never sent', async () => {
  agentPost('dee', { topic: 'old', body: 'released into the board-local feed' });
  await new Promise((r) => setTimeout(r, 5));
  await on();
  agentPost('dee', { topic: 'new', body: 'published after' });
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['new']);
});

test('4. no personal data leaves, even when the surrounding board state is full of it', async () => {
  await on();
  // The session key, a profile with a real-person-shaped name, a project, a home path.
  store.writeProfile('joe-macbook', { displayName: 'joe@example.com', role: 'call 555-123-4567', dir: '/Users/joe/work/acme' });
  agentPost('joe-macbook', { topic: 'Tip', body: 'Batch your invoices weekly.', links: ['https://example.com'] });
  await cs.sweep();
  const wire = JSON.stringify(be.st.seen.map((s) => s.body));
  for (const bad of ['joe', 'macbook', '555-123-4567', '/Users', 'acme', 'example.com']) {
    assert.ok(!wire.includes(bad), `${bad} left the machine: ${wire}`);
  }
  const reg = be.st.seen.find((s) => s.url === '/agents/register').body;
  assert.match(reg.name, /^agent-[0-9a-f]{6}$/);
  assert.equal(reg.bio, undefined);
});

test('5. a down server and a slow server block nothing and throw nothing; the post is retried', async () => {
  await on();
  const r = agentPost('eve', { topic: 't', body: 'b' });
  be.st.mode.hang = true;
  cs.setTimeoutMs(150);
  // Bounded, so a missing timeout FAILS here instead of hanging the whole suite.
  let timer;
  const verdict = await Promise.race([
    cs.sweep().then(() => 'returned'),
    new Promise((r) => { timer = setTimeout(() => r('held'), 2000); }),
  ]);
  clearTimeout(timer);
  assert.equal(verdict, 'returned', 'a hung server held the sweep');
  assert.notEqual((cs.statuses()[r.id] || {}).state, 'sent');
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:9/';   // nothing listens here
  await cs.sweep();
  be.st.mode.hang = false;
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${be.server.address().port}/`;
  await cs.sweep();
  assert.equal(cs.statuses()[r.id].state, 'sent');
});

test('a sweep already in flight is joined, not doubled', async () => {
  await on();
  agentPost('fay', { topic: 't', body: 'b' });
  const a = cs.sweep();
  const b = cs.sweep();
  assert.equal(a, b);
  await a;
  assert.equal(posts().length, 1);
});

test('6. under the test runner with no injected sender, nothing is sent', async () => {
  await on();
  agentPost('gus', { topic: 't', body: 'b' });
  cs.setSender(null);
  assert.deepEqual(await cs.sweep(), { skipped: 'test' });
  assert.equal(be.st.seen.length, 0);
});

test('7. the key file is mode 600, and the key is in no instruction file or environment', async () => {
  await on();
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'hal'), { recursive: true });
  fs.writeFileSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, 'hal', 'CLAUDE.md'), '# hal\n');
  agentPost('hal', { topic: 't', body: 'b' });
  await cs.sweep();
  const key = [...be.st.agents.values()][0].key;
  assert.equal(fs.statSync(cs._paths.keysFile()).mode & 0o777, 0o600);
  assert.ok(fs.readFileSync(cs._paths.keysFile(), 'utf8').includes(key));
  assert.ok(!JSON.stringify(process.env).includes(key));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(process.env.AGENT_WORKFORCE_WORKERS)) assert.ok(!fs.readFileSync(f, 'utf8').includes(key), f);
  assert.ok(!JSON.stringify(cs.statuses()).includes(key));
});

test('a board delete sends DELETE; a post not yet sent is withheld and never sent', async () => {
  await on();
  const a = agentPost('ivy', { topic: 'one', body: 'b' });
  await cs.sweep();
  assert.equal(cs.requestDelete(a.id).ok, true);
  await cs.sweep();
  const del = be.st.seen.filter((s) => s.method === 'DELETE');
  assert.equal(del.length, 1);
  assert.equal(cs.statuses()[a.id].state, 'deleted');
  const b = agentPost('ivy', { topic: 'two', body: 'b' });
  cs.requestDelete(b.id);
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['one']);
  assert.equal(cs.statuses()[b.id].state, 'withheld');
});

test('a take-down read from /agents/me/posts is shown against the post', async () => {
  await on();
  const a = agentPost('jo', { topic: 't', body: 'b' });
  await cs.sweep();
  const remote = [...be.st.posts.values()][0];
  remote.taken_down = true;
  remote.take_down_reason = 'off topic';
  // The check is throttled per agent; move the clock past it.
  await cs.sweep(Date.now() + 31 * 60 * 1000);
  assert.deepEqual(
    { takenDown: cs.statuses()[a.id].takenDown, reason: cs.statuses()[a.id].takeDownReason },
    { takenDown: true, reason: 'off topic' },
  );
});

test('a server refusal is final and records only reason classes; a 429 waits for Retry-After', async () => {
  await on();
  be.st.mode.refuse = true;
  const a = agentPost('kit', { topic: 't', body: 'b' });
  await cs.sweep();
  assert.deepEqual(cs.statuses()[a.id], { state: 'refused', deleteRequested: false, takenDown: false, takeDownReason: null, agentRefused: false, reasons: ['email'] });
  be.st.mode.refuse = false;
  be.st.mode.cap = true;
  const capped = agentPost('kit', { topic: 't2', body: 'b2' });
  await cs.sweep();
  assert.equal(cs.statuses()[capped.id].state, 'pending', 'a rate-limited post (nothing stored) reads as possibly public');
  const n = posts().length;
  be.st.mode.cap = false;
  await cs.sweep();                          // still inside Retry-After: not retried
  assert.equal(posts().length, n);
  await cs.sweep(Date.now() + 7201 * 1000);  // past it: sent
  assert.equal(posts().length, n + 1);
});

test('an expired token re-logs in with the board-held key, then sends', async () => {
  await on();
  agentPost('lu', { topic: 'a', body: 'b' });
  await cs.sweep();
  [...be.st.agents.values()][0].token = 'rotated-server-side';
  const second = agentPost('lu', { topic: 'c', body: 'd' });
  await cs.sweep();
  assert.ok(be.st.seen.some((s) => s.url === '/agents/login'));
  assert.equal(cs.statuses()[second.id].state, 'sent');
});

test('a failed re-login stops sending as that agent, and says so against its posts', async () => {
  await on();
  const first = agentPost('ola', { topic: 'a', body: 'b' });
  await cs.sweep();
  const a = [...be.st.agents.values()][0];
  a.active = false;                          // deactivated server-side: token and login both 401
  cs.requestDelete(first.id);
  agentPost('ola', { topic: 'c', body: 'd' });
  await cs.sweep();
  const st = cs.statuses()[first.id];
  assert.deepEqual([st.state, st.deleteRequested, st.agentRefused], ['sent', true, true]);
  const n = be.st.seen.length;
  await cs.sweep();
  assert.equal(be.st.seen.length, n, 'a refused agent kept calling the server');
});

test('an unknown board falls back to general once; a name clash registers with a suffix', async () => {
  await on();
  be.st.agents.set('x', { id: 'x', name: 'Mo', key: 'k', token: 't', active: true });
  store.writeProfile('mo', { displayName: 'Mo' });
  communitystore.grantTrust('mo');
  const r = feedpublish.publishPost({ kind: 'community_post', agent: 'mo', at: new Date().toISOString(), topic: 't', body: 'b' }, { agentId: 'mo', board: 'no-such-channel' });
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.channel), ['no-such-channel', 'general']);
  assert.equal(cs.statuses()[r.id].state, 'sent');
  assert.match(be.st.seen.filter((s) => s.url === '/agents/register').at(-1).body.name, /^Mo-[0-9a-f]{4}$/);
});

test('a post with no topic takes its title from the first line of its body, cut at 120 UTF-16 units', () => {
  assert.equal(cs.titleFor({ body: '\n## First line here\nsecond' }), 'First line here');
  const long = '😀'.repeat(70);          // 140 units: the cut must not split a pair
  const t = cs.titleFor({ topic: long });
  assert.ok(t.length <= 120);
  assert.equal(t, '😀'.repeat(60));
});

test('a human post on the board (the operator\'s own, published) is never sent; an agent post beside it is', async () => {
  await on();
  const communitysite = require('./communitysite');
  const h = communitysite.publishHumanPost({ authorName: 'Pat', topic: 'from a person', body: 'the operator wrote this' });
  assert.equal(h.ok, true, JSON.stringify(h));
  assert.equal(h.status, 'published');
  agentPost('nia', { topic: 'from an agent', body: 'b' });
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['from an agent']);
});

test('a delete the owner makes WHILE a sweep is sending is kept, and that post never goes out', async () => {
  await on();
  const a = agentPost('pia', { topic: 'first', body: 'b' });
  const b = agentPost('pia', { topic: 'second', body: 'b' });
  // Hold the first POST open, delete the second while the sweep waits on it, then let it go.
  let release;
  const gate = new Promise((r) => { release = r; });
  cs.setSender(async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/posts')) await gate;
    return fetch(url, init);
  });
  const running = cs.sweep();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(cs.requestDelete(b.id).ok, true);
  release();
  await running;
  assert.deepEqual(posts().map((p) => p.body.title), ['first']);
  assert.equal(cs.statuses()[a.id].state, 'sent');
  assert.deepEqual([cs.statuses()[b.id].state, cs.statuses()[b.id].deleteRequested], ['withheld', true]);
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['first'], 'the withheld post went out on a later sweep');
});

test('posts published while the switch was OFF stay local when it comes back ON', async () => {
  await on();
  SW = { on: false, ok: true };
  await cs.sweep();                          // a sweep sees OFF
  agentPost('quin', { topic: 'while off', body: 'b' });
  await new Promise((r) => setTimeout(r, 5));
  await on();
  agentPost('quin', { topic: 'back on', body: 'b' });
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['back on']);
});

test('a post held before sending went on and released after it is sent', async () => {
  const held = agentPost('rae', { topic: 'held earlier', body: 'b' }, { trusted: false });
  await new Promise((r) => setTimeout(r, 5));
  await on();
  communitystore.releaseHeld(held.id);
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['held earlier']);
});

test('#4373 part B review 7: a post released before the FIRST sweep of an ON period is sent when the release records the start (control: without it, it is not)', async () => {
  for (const record of [true, false]) {
    fresh();
    const held = agentPost('ren' + record, { topic: 'released early ' + record, body: 'b' }, { trusted: false });
    await new Promise((r) => setTimeout(r, 5));
    SW = { on: true, ok: true };                        // on, but no sweep has recorded the start
    if (record) assert.equal(cs.recordPeriodStart(), true);   // what POST /api/community/release does first
    communitystore.releaseHeld(held.id);
    await new Promise((r) => setTimeout(r, 5));
    await cs.sweep();
    const sent = posts().some((p) => p.body.title === 'released early ' + record);
    assert.equal(sent, record, record ? 'the released post never went' : 'control: without the recorded start the post should fall before the window');
  }
});

test('a send whose answer was lost is not sent twice: the server copy is adopted', async () => {
  await on();
  const r = agentPost('sol', { topic: 'once', body: 'only once' });
  // The server stores the post, but the answer never reaches the board.
  cs.setTimeoutMs(150);
  cs.setSender(async (url, init) => {
    const res = await fetch(url, init);
    if (init.method === 'POST' && url.endsWith('/posts')) {
      // Like a real network: the board's timeout aborts while the answer is still coming.
      await new Promise((ok, fail) => {
        const t = setTimeout(ok, 400);
        init.signal.addEventListener('abort', () => { clearTimeout(t); fail(new Error('aborted')); });
      });
    }
    return res;
  });
  await cs.sweep();
  assert.equal(be.st.posts.size, 1);
  assert.notEqual(cs.statuses()[r.id].state, 'sent');
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
  await cs.sweep();
  assert.equal(be.st.posts.size, 1, 'the post was sent a second time');
  assert.equal(cs.statuses()[r.id].state, 'sent');
});

test('a 201 with no id is adopted from the server on the next sweep, not sent again', async () => {
  await on();
  const r = agentPost('tia', { topic: 't', body: 'b' });
  cs.setSender(async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/posts')) {
      await fetch(url, init);
      return new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } });
    }
    return fetch(url, init);
  });
  await cs.sweep();
  assert.notEqual(cs.statuses()[r.id].state, 'sent');
  await cs.sweep();
  assert.equal(be.st.posts.size, 1, 'the post was sent a second time');
  assert.equal(cs.statuses()[r.id].state, 'sent');
  assert.equal(cs.requestDelete(r.id).ok, true);
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal([...be.st.posts.values()][0].deleted, true, 'the adopted post could not be deleted');
});

test('a delete for a post the board does not have is refused', () => {
  assert.deepEqual(cs.requestDelete('no-such-post'), { ok: false, missing: true, because: 'there is no such post or comment' });
  assert.equal(cs.requestDelete('').ok, false);
  assert.equal(cs.requestDelete(42).ok, false);
});

test('a status the layer has no rule for is refused (4xx) and not re-sent every sweep', async () => {
  await on();
  const r = agentPost('uma', { topic: 't', body: 'b' });
  cs.setSender(async (url, init) => (init.method === 'POST' && url.endsWith('/posts')
    ? new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } })
    : fetch(url, init)));
  await cs.sweep();
  await cs.sweep();
  const tries = be.st.seen.length + 0;
  assert.deepEqual([cs.statuses()[r.id].state, cs.statuses()[r.id].reasons], ['refused', ['http_403']]);
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal(posts().length, 0);
  assert.equal(be.st.seen.length, tries, 'a refused post was tried again');
});

test('a 401 whose re-login cannot be had this sweep stays pending, shows it, and goes out later', async () => {
  await on();
  agentPost('val', { topic: 'a', body: 'b' });
  await cs.sweep();
  [...be.st.agents.values()][0].token = 'rotated';
  const r = agentPost('val', { topic: 'c', body: 'd' });
  cs.setSender(async (url, init) => (url.endsWith('/agents/login') ? Promise.reject(new Error('down')) : fetch(url, init)));
  await cs.sweep();
  assert.deepEqual([cs.statuses()[r.id].state, cs.statuses()[r.id].lastStatus, cs.statuses()[r.id].agentRefused], ['pending', 401, false]);
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal(cs.statuses()[r.id].state, 'sent');
  assert.deepEqual(posts().filter((p) => p.body.title === 'c').length >= 1, true);
});

test('an unreadable sent, keys or deletes file pauses sending and is left for repair, never reset', async () => {
  for (const which of ['sentFile', 'keysFile', 'deletesFile']) {
    fresh();
    await on();
    const r = agentPost('wes', { topic: 'x', body: 'y' });
    await cs.sweep();
    assert.equal(cs.statuses()[r.id].state, 'sent');
    const file = cs._paths[which]();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ not json');
    agentPost('wes', { topic: 'after', body: 'z' });
    const before = posts().length;
    assert.deepEqual(await cs.sweep(), { skipped: 'unreadable' }, which);
    assert.equal(posts().length, before, `${which}: sent while a state file was unreadable`);
    assert.equal(fs.readFileSync(file, 'utf8'), '{ not json', `${which}: the unreadable file was overwritten`);
  }
  // And a delete cannot overwrite an unreadable deletes file.
  const r = agentPost('wes', { topic: 'd', body: 'd' });
  assert.equal(cs.requestDelete(r.id).ok, false);
  assert.equal(fs.readFileSync(cs._paths.deletesFile(), 'utf8'), '{ not json');
});

test('a post whose send answer was lost, then deleted by the owner, is found on the server and deleted there', async () => {
  await on();
  const r = agentPost('xia', { topic: 'lost', body: 'answer lost' });
  cs.setSender(async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/posts')) { await fetch(url, init); throw new Error('connection reset'); }
    return fetch(url, init);
  });
  await cs.sweep();
  assert.equal(be.st.posts.size, 1);
  assert.equal(cs.statuses()[r.id].state, 'unconfirmed');
  cs.requestDelete(r.id);
  assert.equal(cs.statuses()[r.id].state, 'unconfirmed', 'a post that may be public was reported as never sent');
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal([...be.st.posts.values()][0].deleted, true, 'the server copy was left public');
  assert.equal(cs.statuses()[r.id].state, 'deleted');
});

test('with the switch OFF, a delete of a post already public still goes out', async () => {
  await on();
  const r = agentPost('yan', { topic: 't', body: 'b' });
  await cs.sweep();
  SW = { on: false, ok: true };
  cs.requestDelete(r.id);
  assert.deepEqual(await cs.sweep(), { skipped: 'off' });
  assert.equal([...be.st.posts.values()][0].deleted, true);
  assert.equal(cs.statuses()[r.id].state, 'deleted');
});

test('keys belong to the server that issued them: a new address never sees the old key', async () => {
  await on();
  agentPost('zed', { topic: 'one', body: 'b' });
  await cs.sweep();
  const oldKey = [...be.st.agents.values()][0].key;
  const first = be;
  be = await backend();                      // a different server, and the env now points at it
  try {
    agentPost('zed', { topic: 'two', body: 'b' });
    await cs.sweep();
    assert.ok(!JSON.stringify(be.st.seen).includes(oldKey), 'the old server key was presented to the new one');
    assert.ok(be.st.seen.some((s) => s.url === '/agents/register'), 'the new server was not registered with');
  } finally {
    first.server.closeAllConnections(); first.server.close();
  }
});

test('a plain-http address that is not this machine is refused, and nothing is sent to it', async () => {
  await on();
  agentPost('abe', { topic: 't', body: 'b' });
  const calls = [];
  cs.setSender(async (url) => { calls.push(url); throw new Error('should not be called'); });
  process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://community.example.com';
  assert.deepEqual(await cs.sweep(), { skipped: 'insecure' });
  assert.deepEqual(calls, []);
});

test('a delete is refused for a human post, which the board never sends; a held agent post can be withheld', async () => {
  await on();
  const communitysite = require('./communitysite');
  const h = communitysite.publishHumanPost({ authorName: 'Pat', topic: 'x', body: 'y' });
  assert.deepEqual(cs.requestDelete(h.id), { ok: false, notEligible: true, because: 'the board never sends that post' });
  const held = agentPost('bea', { topic: 'held', body: 'b' }, { trusted: false });
  assert.deepEqual(cs.requestDelete(held.id), { ok: true, state: 'withheld' });
  communitystore.releaseHeld(held.id);
  await cs.sweep();
  assert.equal(posts().length, 0, 'a post withheld before release went out');
});

test('an unreadable state.json sends no post and is left for repair; deletes still go out', async () => {
  await on();
  const a = agentPost('cal', { topic: 'first', body: 'b' });
  await cs.sweep();
  fs.writeFileSync(cs._paths.stateFile(), '{ not json');
  agentPost('cal', { topic: 'second', body: 'b' });
  cs.requestDelete(a.id);
  await cs.sweep();
  assert.deepEqual(posts().map((p) => p.body.title), ['first'], 'a post was sent with its since unknown');
  assert.equal(fs.readFileSync(cs._paths.stateFile(), 'utf8'), '{ not json', 'the unreadable state file was rewritten');
  assert.equal(cs.statuses()[a.id].state, 'deleted');
});

test('the registration name falls back to a handle when the scrub returns its neutral default', () => {
  const communitysite = require('./communitysite');
  store.writeProfile('dot', { displayName: '   ​  ' });   // scrubs to the neutral default
  assert.equal(communitysite.scrubAuthorName('​').name, communitysite.DEFAULT_AUTHOR_NAME);
  assert.match(cs.registration('dot').name, /^agent-[0-9a-f]{6}$/);
});

// A sender whose POST /posts reaches the server but whose answer is lost.
function losePostAnswers() {
  cs.setSender(async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/posts')) { await fetch(url, init); throw new Error('connection reset'); }
    return fetch(url, init);
  });
}

test('with the switch OFF, an unconfirmed post the owner deletes is found on the server and deleted', async () => {
  await on();
  const r = agentPost('eli', { topic: 't', body: 'b' });
  losePostAnswers();
  await cs.sweep();
  assert.equal(cs.statuses()[r.id].state, 'unconfirmed');
  SW = { on: false, ok: true };
  cs.requestDelete(r.id);
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal([...be.st.posts.values()][0].deleted, true, 'the server copy stayed public with the switch OFF');
  assert.equal(cs.statuses()[r.id].state, 'deleted');
});

test('an unconfirmed post is settled after an OFF-then-ON cycle, not stranded', async () => {
  await on();
  const r = agentPost('fin', { topic: 't', body: 'b' });
  losePostAnswers();
  await cs.sweep();
  SW = { on: false, ok: true };
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  await on();
  await cs.sweep();
  assert.equal(be.st.posts.size, 1);
  assert.equal(cs.statuses()[r.id].state, 'sent');
  assert.equal(cs.statuses()[r.id].lastStatus, undefined, 'a settled post still carries an old failure status');
});

test('requests are made with redirect: error, so a login key is not re-sent to a redirect target (fetch following a redirect is simulated here)', async () => {
  await on();
  agentPost('gil', { topic: 't', body: 'b' });
  await cs.sweep();
  const key = [...be.st.agents.values()][0].key;
  [...be.st.agents.values()][0].token = 'expired';     // the next call logs in with the key
  const other = await new Promise((resolve) => {
    const seen = [];
    const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { seen.push(b); res.end('{}'); }); });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, seen }));
  });
  const real = process.env.AGENT_WORKFORCE_COMMUNITY_URL;
  cs.setSender(async (url, init) => {
    if (url.endsWith('/agents/login')) {
      // What fetch does with a 307 when asked to follow it, and what redirect:'error' prevents.
      if (init.redirect !== 'error') return fetch(`http://127.0.0.1:${other.srv.address().port}/agents/login`, init);
      throw new TypeError('redirect mode is set to error');
    }
    return fetch(url, init);
  });
  agentPost('gil', { topic: 't2', body: 'b2' });
  try {
    await cs.sweep();
    assert.ok(!other.seen.join('').includes(key), 'the key went to the redirect target');
  } finally {
    other.srv.close();
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = real;
  }
});

test('a 429 on registration waits instead of registering again every sweep', async () => {
  await on();
  agentPost('hal2', { topic: 't', body: 'b' });
  let registers = 0;
  cs.setSender(async (url, init) => {
    if (url.endsWith('/agents/register')) {
      registers += 1;
      return new Response('{"detail":"too many registrations"}', { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3600' } });
    }
    return fetch(url, init);
  });
  await cs.sweep();
  await cs.sweep();
  assert.equal(registers, 1);
});

test('a post whose save fails does not stop the sweep: the delete of another post still goes out', async () => {
  await on();
  const a = agentPost('ian', { topic: 'public', body: 'b' });
  await cs.sweep();
  cs.requestDelete(a.id);
  agentPost('jen', { topic: 'new agent', body: 'b' });   // registering jen saves keys.json
  const d = cs._paths.endpointDir();
  fs.chmodSync(d, 0o500);                                 // every save in this folder now throws
  try {
    await cs.sweep();
  } finally {
    fs.chmodSync(d, 0o700);
  }
  assert.equal([...be.st.posts.values()].find((p) => p.title === 'public').deleted, true,
    'one failing post stopped the delete of another');
});

test('a board that stops while a POST is out does not send it again after the restart', async () => {
  await on();
  const r = agentPost('kai', { topic: 'in flight', body: 'b' });
  // The first board: the POST reaches the server, then the board "stops" with the answer outstanding.
  let release;
  const gate = new Promise((x) => { release = x; });
  cs.setSender(async (url, init) => {
    if (init.method === 'POST' && url.endsWith('/posts')) { await fetch(url, init); await gate; throw new Error('the old board is gone'); }
    return fetch(url, init);
  });
  const oldSweep = cs.sweep();
  while (be.st.posts.size === 0) await new Promise((x) => setTimeout(x, 10));
  // The restarted board: a fresh copy of the module over the same data folder.
  delete require.cache[require.resolve('./communitysend')];
  const restarted = require('./communitysend');
  try {
    restarted.setSender((url, init) => fetch(url, init));
    restarted.setSwitch(() => SW);
    await restarted.sweep();
    assert.equal(be.st.posts.size, 1, 'the post was sent a second time after the restart');
    assert.equal(restarted.statuses()[r.id].state, 'sent');
  } finally {
    release();
    await oldSweep;
    restarted.setSender(null); restarted.setSwitch(null);
  }
});

test('every post of a refused agent is listed with agentRefused, not only the one that found out', async () => {
  await on();
  agentPost('lea', { topic: 'a', body: 'b' });
  await cs.sweep();
  [...be.st.agents.values()][0].active = false;
  const x = agentPost('lea', { topic: 'c', body: 'd' });
  await cs.sweep();
  const y = agentPost('lea', { topic: 'e', body: 'f' });
  await cs.sweep();
  for (const id of [x.id, y.id]) {
    assert.equal(cs.statuses()[id] && cs.statuses()[id].agentRefused, true, `post ${id} is missing or not marked`);
  }
});

test('a delete the server does not accept is recorded against the post and retried', async () => {
  await on();
  const r = agentPost('max', { topic: 't', body: 'b' });
  await cs.sweep();
  cs.requestDelete(r.id);
  cs.setSender(async (url, init) => (init.method === 'DELETE'
    ? new Response('{}', { status: 403, headers: { 'content-type': 'application/json' } })
    : fetch(url, init)));
  await cs.sweep();
  assert.deepEqual([cs.statuses()[r.id].state, cs.statuses()[r.id].deleteStatus], ['sent', 403]);
  cs.setSender((url, init) => fetch(url, init));
  await cs.sweep();
  assert.equal(cs.statuses()[r.id].state, 'deleted');
});
