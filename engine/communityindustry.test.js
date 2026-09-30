'use strict';
/**
 * kosmos#4375: the owner's industry on their agents' public Community profiles. The setting (a key from a fixed
 * list, or none) and the send layer's PATCH /agents/me { industry } for each registered agent, against a fake
 * kosmos-community on a loopback port with the #4370 contract. Sandboxed data root before the require.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityindustry-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const ind = require('./communityindustry');
const cs = require('./communitysend');

// The service's list (kosmos-community app/taxonomy.py) as this board copies it.
const KNOWN = new Set(ind.INDUSTRIES.map((i) => i.key));

function backend() {
  const st = { agents: new Map(), seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'k' + id, token: 't' + id, industry: null };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      const a = [...st.agents.values()].find((x) => 'Bearer ' + x.token === req.headers.authorization);
      if (req.method === 'POST' && req.url === '/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        return send(201, { id: 'p' + (++st.n), ...body });
      }
      if (req.method === 'PATCH' && req.url === '/agents/me') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        const extra = Object.keys(body).filter((k) => !['industry', 'install_group'].includes(k));
        if (extra.length) return send(400, { error: 'unknown_fields', fields: extra });
        if (st.mode.refuse || (body.industry !== null && !KNOWN.has(body.industry))) return send(400, { detail: 'unknown industry' });
        if (st.mode.status) return send(st.mode.status, st.mode.json || { detail: 'no' });
        a.industry = body.industry;
        if (st.mode.appliedThen504) return send(504, { detail: 'gateway timeout' });   // stored, answer lost
        res.writeHead(204); return res.end();
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
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
  be = await backend();
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });

// An agent is registered with the service when its first post goes (the send layer's rule).
async function registered(agent) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic: 't', body: 'hello from ' + agent }, { agentId: agent });
  assert.equal(r.status, 'published');
  await cs.sweep();
  assert.ok([...be.st.agents.values()].length > 0, 'the agent was not registered');
}
const patches = () => be.st.seen.filter((s) => s.method === 'PATCH' && s.url === '/agents/me');

test('the setting lands under the sandboxed data root', () => {
  assert.ok(ind.FILE.startsWith(SANDBOX + path.sep));
});

test('the setting: missing is "none, known"; a listed key round-trips; anything else is refused', () => {
  assert.deepEqual(ind.read(), { industry: null, ok: true });
  assert.deepEqual(ind.set('legal'), { ok: true });
  assert.deepEqual(ind.read(), { industry: 'legal', ok: true });
  for (const bad of ['Acme Legal LLP', 'LEGAL', '', 3, undefined, {}]) assert.equal(ind.set(bad).ok, false, JSON.stringify(bad));
  assert.deepEqual(ind.read(), { industry: 'legal', ok: true }, 'a refused set changed the setting');
  assert.deepEqual(ind.set(null), { ok: true });
  assert.deepEqual(ind.read(), { industry: null, ok: true });
});

test('the setting: an unreadable file, or a key not on the list, is UNKNOWN (ok false), never "none"', () => {
  fs.mkdirSync(path.dirname(ind.FILE), { recursive: true });
  for (const raw of ['{not json', '[]', '"legal"', JSON.stringify({ industry: 'Acme Legal LLP' })]) {
    fs.writeFileSync(ind.FILE, raw);
    assert.deepEqual(ind.read(), { industry: null, ok: false }, raw);
  }
});

test('the list is the service\'s: 16 unique kebab keys, each label finishing "Works for ..."', () => {
  assert.equal(ind.INDUSTRIES.length, 16);
  assert.equal(KNOWN.size, 16);
  for (const i of ind.INDUSTRIES) {
    assert.match(i.key, /^[a-z][a-z-]{1,39}$/);
    assert.match(i.label, /^(a|an) [a-z]/, i.key);
  }
  assert.equal(ind.labelFor('legal'), 'a law firm');
  assert.equal(ind.labelFor('nope'), null);
});

test('never set: nothing is sent', async () => {
  await on();
  await registered('ava');
  await cs.sweep();
  assert.equal(patches().length, 0);
});

test('set: each registered agent is sent it once; cleared: null once; then nothing', async () => {
  await on();
  await registered('ava');
  await registered('bo');
  ind.set('legal');
  await cs.sweep();
  assert.equal(patches().length, 2);
  assert.deepEqual(patches().map((p) => p.body), [{ industry: 'legal' }, { industry: 'legal' }]);
  assert.deepEqual([...be.st.agents.values()].map((a) => a.industry), ['legal', 'legal']);
  await cs.sweep();
  assert.equal(patches().length, 2, 'sent again with nothing changed');
  ind.set(null);
  await cs.sweep();
  assert.equal(patches().length, 4);
  assert.deepEqual(patches().slice(2).map((p) => p.body), [{ industry: null }, { industry: null }]);
  await cs.sweep();
  assert.equal(patches().length, 4, 'the clear was sent again');
});

test('an agent registered after the industry was set is sent it too', async () => {
  await on();
  ind.set('software');
  await registered('ava');
  await cs.sweep();
  assert.deepEqual(patches().map((p) => p.body), [{ industry: 'software' }]);
});

test('an unreadable setting sends nothing, above all no null that would wipe the profile', async () => {
  await on();
  await registered('ava');
  ind.set('legal');
  await cs.sweep();
  assert.equal(patches().length, 1);
  fs.writeFileSync(ind.FILE, '{not json');
  await cs.sweep();
  assert.equal(patches().length, 1, 'an unreadable setting sent something');
});

test('with the switch off nothing is sent', async () => {
  await on();
  await registered('ava');
  SW = { on: false, ok: true };
  ind.set('legal');
  await cs.sweep();
  assert.equal(patches().length, 0);
});

test('a key the service refuses is recorded and not sent again until it changes', async () => {
  await on();
  await registered('ava');
  be.st.mode = { refuse: true };
  ind.set('legal');
  await cs.sweep();
  await cs.sweep();
  assert.equal(patches().length, 1, 'a refused key was sent again');
  be.st.mode = {};
  ind.set('software');
  await cs.sweep();
  assert.equal(patches().length, 2);
  assert.deepEqual(patches()[1].body, { industry: 'software' });
});

test('no usable answer: tried again next sweep', async () => {
  await on();
  await registered('ava');
  be.st.mode = { status: 503 };
  ind.set('legal');
  await cs.sweep();
  be.st.mode = {};
  await cs.sweep();
  assert.equal(patches().length, 2);
  assert.equal([...be.st.agents.values()][0].industry, 'legal');
});

test('review 1: a CLEAR goes out while Community is OFF (taking it back must not wait); a new industry does not', async () => {
  await on();
  await registered('ava');
  ind.set('legal');
  await cs.sweep();
  assert.equal(patches().length, 1);
  SW = { on: false, ok: true };
  ind.set('software');
  await cs.sweep();
  assert.equal(patches().length, 1, 'a new industry was sent while Community was off');
  ind.set(null);
  await cs.sweep();
  assert.equal(patches().length, 2, 'the clear did not go while Community was off');
  assert.deepEqual(patches()[1].body, { industry: null });
  assert.equal([...be.st.agents.values()][0].industry, null);
});

test('review 1: a refusal is forgotten once the choice moves on, so a key the service accepts later can be chosen again', async () => {
  await on();
  await registered('ava');
  be.st.mode = { refuse: true };
  ind.set('legal');
  await cs.sweep();
  be.st.mode = {};
  ind.set('software');
  await cs.sweep();
  ind.set('legal');                                    // the service now accepts it
  await cs.sweep();
  assert.deepEqual(patches().map((p) => p.body.industry), ['legal', 'software', 'legal']);
  assert.equal([...be.st.agents.values()][0].industry, 'legal');
});

test('review 2: refused, then None, then the same key again: the key is tried again, not skipped forever', async () => {
  await on();
  await registered('ava');
  be.st.mode = { refuse: true };
  ind.set('legal');
  await cs.sweep();
  be.st.mode = {};
  ind.set(null);                                        // never sent anything, so nothing to clear
  await cs.sweep();
  ind.set('legal');
  await cs.sweep();
  assert.deepEqual(patches().map((p) => p.body.industry), ['legal', 'legal'], 'the refused key was never tried again');
  assert.equal([...be.st.agents.values()][0].industry, 'legal');
});

test('review 3: a clear that cannot reach an agent the service shut out is logged ONCE, never PATCHed, and counted', async () => {
  await on();
  await registered('ava');
  ind.set('legal');
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  const name = Object.keys(keys)[0];
  keys[name].refused = true;
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  assert.equal(cs.industryUnreachable(), 1);
  const lines = [];
  const orig = console.error;
  console.error = (m) => { lines.push(String(m)); };
  try {
    ind.set(null);
    const before = patches().length;
    await cs.sweep();
    await cs.sweep();
    assert.equal(patches().length, before, 'a PATCH went to a shut-out agent');
  } finally { console.error = orig; }
  assert.equal(lines.filter((l) => /refused this agent's key, so its profile keeps "legal"/.test(l)).length, 1, JSON.stringify(lines));
  assert.equal(JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'))[name].industryClearUnreachable, true);
});

test('review 6: a 404 on a PICK is retried until it lands (the route was absent), logged once, not made final', async () => {
  await on();
  await registered('ava');
  be.st.mode = { status: 404 };
  ind.set('legal');
  const lines = [];
  const orig = console.error;
  console.error = (m) => { lines.push(String(m)); };
  try { await cs.sweep(); await cs.sweep(); } finally { console.error = orig; }
  assert.equal(patches().length, 2, 'a 404 was not retried');
  assert.equal(lines.filter((l) => /got 404; trying again/.test(l)).length, 1);
  be.st.mode = {};
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, 'legal');
});

test('review 6: clear gets 404, then a pick gets 404 in the same outage: once the route is back the profile shows the pick', async () => {
  await on();
  await registered('ava');
  ind.set('legal');
  await cs.sweep();
  be.st.mode = { status: 404 };
  ind.set(null);
  await cs.sweep();
  ind.set('software');
  await cs.sweep();
  be.st.mode = {};
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, 'software', 'the profile kept the industry the owner took back');
});

test('review 4: industryUnreachable is null when the sweep cannot run, so the page promises nothing', () => {
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  fs.writeFileSync(cs._paths.keysFile(), '{}');
  assert.equal(cs.industryUnreachable(), 0, 'control: readable files count 0');
  fs.writeFileSync(cs._paths.keysFile(), '{not json');
  assert.equal(cs.industryUnreachable(), null);
});

test('review 5: a CLEAR answered 404 is tried again every sweep until it lands (never given up), logged once', async () => {
  await on();
  await registered('ava');
  ind.set('legal');
  await cs.sweep();
  be.st.mode = { status: 404 };
  ind.set(null);
  const lines = [];
  const orig = console.error;
  console.error = (m) => { lines.push(String(m)); };
  try { await cs.sweep(); await cs.sweep(); } finally { console.error = orig; }
  assert.equal(patches().length, 3, 'the clear was not tried again');
  assert.equal(lines.filter((l) => /got 404; trying again/.test(l)).length, 1, 'logged more or less than once');
  be.st.mode = {};
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, null, 'the clear never landed');
});

test('review 5: a new pick resets the shut-out log flag even with Community OFF', async () => {
  await on();
  await registered('ava');
  ind.set('legal');
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  const name = Object.keys(keys)[0];
  keys[name].refused = true;
  keys[name].industryClearUnreachable = true;
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  SW = { on: false, ok: true };
  ind.set('software');
  await cs.sweep();
  assert.equal(JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'))[name].industryClearUnreachable, undefined);
});

test('review 7: a pick applied but unanswered, then None: the clear still goes (the profile must not keep it)', async () => {
  await on();
  await registered('ava');
  be.st.mode = { appliedThen504: true };
  ind.set('legal');
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, 'legal', 'control: the service did apply it');
  be.st.mode = {};
  ind.set(null);
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, null, 'the profile kept the industry the owner took off');
});

test('review 7: a change applied but unanswered, then back to the old value: the profile ends on the old value', async () => {
  await on();
  await registered('ava');
  ind.set('accounting');
  await cs.sweep();
  be.st.mode = { appliedThen504: true };
  ind.set('legal');
  await cs.sweep();
  be.st.mode = {};
  ind.set('accounting');
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, 'accounting');
});

test('review 8: a refusal between a lost answer and a clear does not erase the doubt: the clear still goes', async () => {
  await on();
  await registered('ava');
  be.st.mode = { appliedThen504: true };
  ind.set('legal');
  await cs.sweep();                                     // applied, answer lost
  be.st.mode = { refuse: true };
  ind.set('accounting');
  await cs.sweep();                                     // refused: this PATCH changed nothing
  be.st.mode = {};
  ind.set(null);
  await cs.sweep();
  assert.equal([...be.st.agents.values()][0].industry, null, 'the profile kept the industry from the lost answer');
});

test('review 9: a 422 or a bare 400 on a PICK (not the service\'s own "unknown industry") is retried, not made final', async () => {
  await on();
  await registered('ava');
  for (const [status, json] of [[422, { detail: [{ type: 'missing' }] }], [400, { detail: 'blocked by proxy' }]]) {
    be.st.mode = { status, json };
    ind.set(status === 422 ? 'legal' : 'software');
    await cs.sweep();
    be.st.mode = {};
    await cs.sweep();
    assert.equal([...be.st.agents.values()][0].industry, status === 422 ? 'legal' : 'software', String(status) + ' made the pick final');
  }
});
