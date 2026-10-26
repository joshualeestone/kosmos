'use strict';
/**
 * kosmos#7215: the send layer links each registered agent to this computer's Kosmos+ account, so the person sees and
 * can delete their agents' posts and comments on one community page. Two steps: the coordinator's owner pass for the
 * agent's community name (through remote.macRequest, stubbed here), then POST /agents/me/owner { pass } with the
 * agent's own key, against a fake kosmos-community on a loopback port. Sandboxed data root before the require.
 *
 * What these tests do NOT prove: that the board matches the real coordinator or the real site. The coordinator stub
 * answers in the shape kosmos-relay's `POST /v1/mac/community-owner-pass` does (body `{ agent }`, answer `{ pass,
 * expires_at }`), but the pass here is a placeholder string, and the fake site's checks are this file's own.
 *
 *   node --test engine/communityowner-7215.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityowner-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const remote = require('./remote');
const cs = require('./communitysend');

function backend() {
  const st = { agents: new Map(), seen: [], mode: {}, n: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (d) => chunks.push(d));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const body = raw.length ? JSON.parse(raw.toString('utf8')) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || null });
      const send = (code, obj, headers) => { res.writeHead(code, { 'content-type': 'application/json', ...(headers || {}) }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'k' + id, token: 't' + id, owner: null };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'POST' && req.url === '/agents/login') {
        const x = [...st.agents.values()].find((y) => y.name === body.name && y.key === body.api_key);
        if (st.mode.loginStatus) return send(st.mode.loginStatus, { detail: 'down' });
        if (!x || st.mode.loginRefused) return send(401, { detail: 'wrong name or key' });
        x.token = 't' + x.id + '_' + (++st.n);
        return send(200, { token: x.token });
      }
      const a = [...st.agents.values()].find((x) => 'Bearer ' + x.token === req.headers.authorization);
      if (req.method === 'POST' && req.url === '/posts') {
        if (!a) return send(401, { detail: 'invalid or expired token' });
        return send(201, { id: 'p' + (++st.n), ...body });
      }
      if (req.method === 'POST' && req.url === '/agents/me/owner') {
        if (st.mode.noRoute) return send(404, { detail: 'Not Found' });
        if (!a) return send(401, { detail: 'invalid or expired token' });
        if (st.mode.unauthorized) return send(401, { detail: 'invalid or expired token' });
        if (st.mode.status) return send(st.mode.status, { detail: 'no' }, st.mode.headers);
        if (st.mode.refuseName && a.name === st.mode.refuseName) return send(403, { detail: 'pass refused' });
        if (st.mode.statusFor && a.name === st.mode.statusFor.name) return send(st.mode.statusFor.status, { detail: 'no' });
        // The site's own check: the pass must name the agent whose key presents it.
        if (!body || body.pass !== 'pass-for:' + a.name) return send(400, { detail: 'pass refused' });
        a.owner = body.pass;
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

// remote, stubbed: signed in with Kosmos+ on, a mac id, and a coordinator that vouches by name.
const real = { enrolled: remote.enrolled, read: remote.read, macIdHere: remote.macIdHere, macRequest: remote.macRequest };
let R;
function stubRemote() {
  R = { enrolled: true, on: true, mac: 'mac-1', mints: [], mint: null };
  remote.enrolled = () => R.enrolled;
  remote.read = () => ({ on: R.on });
  remote.macIdHere = () => R.mac;
  remote.macRequest = async (method, route, body) => {
    R.mints.push({ method, route, body });
    if (R.mint) return R.mint(body);
    return { ok: true, data: { pass: 'pass-for:' + body.agent, expires_at: 0 } };
  };
}

let be;
let SW = { on: false, ok: true };
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  SW = { on: true, ok: true };
  cs.setSwitch(() => SW);
  fs.rmSync(data, { recursive: true, force: true });
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
  cs._ownerLinkReset(15 * 60 * 1000);
  stubRemote();
  be = await backend();
  await cs.sweep();   // Community's on-period starts here; a post from before it is never sent
});
test.afterEach(() => {
  be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null);
  Object.assign(remote, real);
});

async function registered(agent) {
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), topic: 't', body: 'hello from ' + agent }, { agentId: agent });
  assert.equal(r.status, 'published');
  // Registered with Kosmos+ off, so linking happens only in the sweeps a test runs itself.
  const was = R.on;
  R.on = false;
  try { await cs.sweep(); } finally { R.on = was; }
  assert.ok(agentNamed(agent), 'the agent was not registered');
}
const ownerCalls = () => be.st.seen.filter((s) => s.url === '/agents/me/owner');
// The service's record for a board agent, found by the name the board registered it under (its keys file).
const keyName = (agentKey) => JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'))[agentKey].name;
const agentNamed = (agentKey) => {
  let keys = {};
  try { keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8')); } catch { return undefined; }
  const k = keys[agentKey];
  return k && [...be.st.agents.values()].find((a) => a.name === k.name);
};

test('each agent is linked once: a pass minted for ITS community name, sent with ITS own key', async () => {
  await registered('ava');
  await registered('bo');
  await cs.sweep();
  const ava = agentNamed('ava'); const bo = agentNamed('bo');
  assert.equal(ava.owner, 'pass-for:' + ava.name);
  assert.equal(bo.owner, 'pass-for:' + bo.name);
  assert.ok(R.mints.length > 0 && R.mints.every((m) => m.method === 'POST' && m.route === '/v1/mac/community-owner-pass'));
  for (const m of R.mints) assert.deepEqual(Object.keys(m.body), ['agent'], 'the board names only the agent, never an account');
  const before = ownerCalls().length;
  await cs.sweep();
  await cs.sweep();
  assert.equal(ownerCalls().length, before, 'a linked agent is not linked again');
});

test('a new computer identity (a Forget and a new sign-in) links every agent again', async () => {
  await registered('ava');
  await cs.sweep();
  const n = ownerCalls().length;
  assert.ok(n >= 1);
  R.mac = 'mac-2';
  await cs.sweep();
  assert.equal(ownerCalls().length, n + 1);
});

test('a new agent key (as from registering again) links that agent again; the marker never holds the key itself', async () => {
  await registered('ava');
  await cs.sweep();
  const n = ownerCalls().length;
  assert.ok(n >= 1);
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  const digest = require('node:crypto').createHash('sha256').update(keys.ava.apiKey).digest('hex').slice(0, 16);
  assert.equal(keys.ava.ownerLinked, 'mac-1:' + digest, 'the marker is the mac id and a key digest, never the key');
  // The board holds a new key for the agent (in the product only a new registration writes one).
  const a = agentNamed('ava');
  a.key = 'rotated-' + a.key;
  keys.ava.apiKey = a.key;
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  await cs.sweep();
  assert.equal(ownerCalls().length, n + 1, 'linked again after the key changed');
  await cs.sweep();
  assert.equal(ownerCalls().length, n + 1, 'and only once');
});

test('nothing is minted or sent while Kosmos+ is off here, not signed in, or Community is off', async () => {
  R.on = false;
  await registered('ava');
  await cs.sweep();
  assert.equal(R.mints.length, 0, 'Kosmos+ switched off');
  R.on = true; R.enrolled = false;
  await cs.sweep();
  assert.equal(R.mints.length, 0, 'not signed in');
  R.enrolled = true; SW = { on: false, ok: true };
  await cs.sweep();
  assert.equal(R.mints.length, 0, 'Community off');
  // CONTROL: all three on, it links.
  SW = { on: true, ok: true };
  await cs.sweep();
  assert.equal(ownerCalls().length, 1);
});

test('a coordinator or tunnel that does not know the route: the pass waits an hour, and links once it does', async () => {
  // The tunnel's real refusal, verbatim from kosmos-relay crates/tunnel/src/coordinator.rs check_mac_request.
  R.mint = () => ({ ok: false, because: 'Error: mac-request does not sign POST "/v1/mac/community-owner-pass"; it signs only: POST /v1/mac/notify-credential, POST /v1/mac/standing' });
  cs._ownerLinkReset(0);   // the 15-minute pause is over at once, so only the hour-long one keeps it at one ask
  await registered('ava');
  await cs.sweep();
  await cs.sweep();
  assert.equal(R.mints.length, 1, 'asked once, then left alone');
  assert.equal(ownerCalls().length, 0);
  R.mint = null;
  cs._ownerLinkReset(15 * 60 * 1000);   // the hour is over
  await cs.sweep();
  assert.equal(agentNamed('ava').owner !== null, true);
});

test('a coordinator from before the route answers 404: the same hour-long wait', async () => {
  R.mint = () => ({ ok: false, because: 'coordinator answered 404', refusal: { status: 404, code: null, currentEpoch: null } });
  cs._ownerLinkReset(0);   // as above: only the hour-long wait keeps it at one ask
  await registered('ava');
  await cs.sweep();
  await cs.sweep();
  assert.equal(R.mints.length, 1);
});

test('a coordinator that fails for another reason (a 503): the pass waits 15 minutes, not an hour', async () => {
  R.mint = () => ({ ok: false, because: 'coordinator answered 503', refusal: { status: 503, code: null, currentEpoch: null } });
  await registered('ava');
  await cs.sweep();   // asks once, then the 15-minute pause starts
  assert.equal(R.mints.length, 1);
  await cs.sweep();
  assert.equal(R.mints.length, 1, 'inside the 15-minute pause nothing is asked');
  cs._ownerLinkReset(0);   // ends the pause and makes the next one zero; an hour-long pause would not be touched
  await cs.sweep();
  assert.equal(R.mints.length, 2, 'asked again once the short pause is over');
  await cs.sweep();
  assert.equal(R.mints.length, 3, 'a 503 sets the short pause, not the hour');
  cs._ownerLinkReset(15 * 60 * 1000);
});

test('the site has no owner route yet (404): one try, then the pass waits an hour; no agent is marked linked', async () => {
  be.st.mode.noRoute = true;
  await registered('ava');
  await registered('bo');
  cs._ownerLinkReset(0);   // the short pause is now zero, so only the hour-long wait holds the second sweep back
  await cs.sweep();
  await cs.sweep();
  assert.equal(ownerCalls().length, 1, 'one call, then the hour');
  be.st.mode.noRoute = false;
  cs._ownerLinkReset(15 * 60 * 1000);
  await cs.sweep();
  assert.ok(agentNamed('ava').owner && agentNamed('bo').owner, 'both linked once the route exists');
});

test('a refused pass is not recorded as linked and is tried again after the pause', async () => {
  be.st.mode.status = 400;
  await registered('ava');
  await cs.sweep();
  await cs.sweep();
  assert.equal(ownerCalls().length, 1);
  be.st.mode.status = 0;
  cs._ownerLinkReset(15 * 60 * 1000);
  await cs.sweep();
  assert.equal(ownerCalls().length, 2);
  assert.ok(agentNamed('ava').owner);
});

test('one agent the community refuses does not hold the agents after it: they are linked in the same sweep', async () => {
  await registered('ava');
  await registered('bo');
  be.st.mode.refuseName = keyName('ava');
  await cs.sweep();
  assert.equal(agentNamed('ava').owner, null, 'the refused agent is not linked');
  assert.ok(agentNamed('bo').owner, 'the agent after it is linked anyway');
  const n = ownerCalls().length;
  await cs.sweep();
  assert.equal(ownerCalls().length, n, 'the refused agent waits its pause; nothing else is left to link');
});

test('one agent Kosmos+ refuses to vouch for (its 400, about the name) does not hold the agents after it', async () => {
  await registered('ava');
  await registered('bo');
  const refused = keyName('ava');
  R.mint = (body) => (body.agent === refused
    ? { ok: false, because: 'coordinator answered 400', refusal: { status: 400, code: null, currentEpoch: null } }
    : { ok: true, data: { pass: 'pass-for:' + body.agent, expires_at: 0 } });
  await cs.sweep();
  assert.equal(agentNamed('ava').owner, null);
  assert.ok(agentNamed('bo').owner, 'linked although the agent before it was refused');
});

test('a mint refused on this computer before it was sent (notSent) pauses nothing', async () => {
  await registered('ava');
  R.mint = () => ({ ok: false, notSent: true, because: 'a register is in progress' });
  await cs.sweep();
  const asked = R.mints.length;
  assert.ok(asked >= 1);
  R.mint = null;
  await cs.sweep();
  assert.ok(agentNamed('ava').owner, 'linked on the very next sweep, with no pause in between');
});

test('a site 429 pauses the pass', async () => {
  be.st.mode.status = 429;
  be.st.mode.headers = { 'retry-after': '99999' };
  await registered('ava');
  await registered('bo');
  await cs.sweep();
  assert.equal(ownerCalls().length, 1, 'the whole pass waits, not only that agent (bo is not asked)');
  await cs.sweep();
  assert.equal(ownerCalls().length, 1, 'asked once, then the pass waits');
  assert.equal(agentNamed('ava').owner, null);
});

test("a deleted agent's old account (retired:) is never linked", async () => {
  await registered('ava');
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  keys['retired:ava:2026-10-26T00:00:00Z'] = { ...keys.ava };
  delete keys['retired:ava:2026-10-26T00:00:00Z'].ownerLinked;
  delete keys.ava;
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify(keys));
  const before = R.mints.length;
  await cs.sweep();
  assert.equal(R.mints.length, before, 'no pass asked for a retired account');
});

test('an agent whose key the community refuses is not tried again', async () => {
  await registered('ava');
  be.st.mode.unauthorized = true;
  be.st.mode.loginRefused = true;
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  assert.equal(keys.ava.refused, true, 'the key is marked refused');
  const n = ownerCalls().length;
  cs._ownerLinkReset(0);
  await cs.sweep();
  assert.equal(ownerCalls().length, n, 'no owner call for a refused key, even with no pause');
});

test('a new computer identity during the mint: the pass is not sent, and the next sweep links under the new one', async () => {
  await registered('ava');
  const n = ownerCalls().length;
  R.mac = 'mac-2';
  R.mint = (body) => { R.mac = 'mac-3'; return { ok: true, data: { pass: 'pass-for:' + body.agent, expires_at: 0 } }; };
  await cs.sweep();
  assert.equal(ownerCalls().length, n, 'the pass minted under mac-2 is never sent');
  R.mint = null;
  await cs.sweep();
  assert.equal(ownerCalls().length, n + 1, 'linked under mac-3 on the next sweep');
});

test('a coordinator 403 is about this computer: one ask, then the whole pass waits', async () => {
  R.on = false;   // registered with Kosmos+ off, so nothing is linked yet
  await registered('ava');
  await registered('bo');
  await registered('cy');
  R.on = true;
  R.mint = () => ({ ok: false, because: 'coordinator answered 403', refusal: { status: 403, code: 'own_lineage', currentEpoch: null } });
  await cs.sweep();
  await cs.sweep();
  assert.equal(R.mints.length, 1, 'not one ask per agent: ' + R.mints.length);
});

function writeRetireRequest(name, body) {
  const d = cs._paths.retireDir();
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, name), body);
  return path.join(d, name);
}

test('nothing is linked while the retire list cannot be read; once it can, linking resumes', async () => {
  R.on = false;
  await registered('ava');
  R.on = true;
  const f = writeRetireRequest('zz-broken.json', '{ not json');
  await cs.sweep();
  assert.equal(R.mints.length, 0, 'fail-closed: no pass asked');
  fs.rmSync(f);
  await cs.sweep();
  assert.ok(agentNamed('ava').owner, 'control: linked once the list reads again');
});

test('a name being retired is not linked; another agent is, in the same sweep', async () => {
  R.on = false;
  await registered('ava');
  await registered('bo');
  R.on = true;
  writeRetireRequest('ava.json', JSON.stringify({ agent: 'ava', at: '2026-10-26T00:00:00Z', done: [], stuck: [] }));
  await cs.sweep();
  assert.ok(!R.mints.some((m) => m.body.agent === keyName('ava')), 'no pass asked for the name being retired');
  assert.ok(agentNamed('bo').owner, 'control: the other agent is linked');
});

test('Community switched off during a mint: the pass is not sent', async () => {
  R.on = false;
  await registered('ava');
  R.on = true;
  R.mint = (body) => { SW = { on: false, ok: true }; return { ok: true, data: { pass: 'pass-for:' + body.agent, expires_at: 0 } }; };
  await cs.sweep();
  assert.equal(R.mints.length, 1);
  assert.equal(ownerCalls().length, 0, 'switched off after the mint: nothing sent');
});

test('a site 422 about one agent does not hold the agents after it', async () => {
  R.on = false;
  await registered('ava');
  await registered('bo');
  R.on = true;
  be.st.mode.statusFor = { name: keyName('ava'), status: 422 };
  await cs.sweep();
  assert.equal(agentNamed('ava').owner, null);
  assert.ok(agentNamed('bo').owner, 'linked although the agent before it got a 422');
});

test('Kosmos+ switched off during a mint: the pass is not sent', async () => {
  R.on = false;
  await registered('ava');
  R.on = true;
  R.mint = (body) => { R.on = false; return { ok: true, data: { pass: 'pass-for:' + body.agent, expires_at: 0 } }; };
  await cs.sweep();
  assert.equal(R.mints.length, 1);
  assert.equal(ownerCalls().length, 0, 'Kosmos+ off after the mint: nothing sent');
});

test("the agent's delete begins during the mint: the pass is not sent", async () => {
  R.on = false;
  await registered('ava');
  R.on = true;
  R.mint = (body) => {
    writeRetireRequest('ava.json', JSON.stringify({ agent: 'ava', at: '2026-10-26T00:00:00Z', done: [], stuck: [] }));
    return { ok: true, data: { pass: 'pass-for:' + body.agent, expires_at: 0 } };
  };
  await cs.sweep();
  assert.equal(R.mints.length, 1);
  assert.equal(ownerCalls().length, 0, 'a name being retired is not linked, even if it began during the mint');
});

test('a pass-wide failure on one agent does not keep the agents after it from ever being reached', async () => {
  R.on = false;
  await registered('ava');
  await registered('bo');
  R.on = true;
  be.st.mode.statusFor = { name: keyName('ava'), status: 500 };
  cs._ownerLinkReset(0);   // the pass-wide pause ends at once
  await cs.sweep();
  assert.equal(agentNamed('bo').owner, null, 'the first pass stopped on ava');
  await cs.sweep();
  assert.ok(agentNamed('bo').owner, 'the next pass starts after ava and reaches bo');
  cs._ownerLinkReset(15 * 60 * 1000);
});

test('at most 5 passes are minted in one sweep; the next sweep goes on from there', async () => {
  for (const a of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) await registered(a);
  await cs.sweep();
  assert.equal(R.mints.length, 5, 'five in the first sweep');
  await cs.sweep();
  assert.equal(R.mints.length, 7, 'the other two in the next, with no pause between');
  assert.equal(R.mints[5].body.agent, keyName('a6'), 'the next sweep starts at the first agent not yet tried, not after it');
  for (const a of ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']) assert.ok(agentNamed(a).owner, a + ' linked');
});

test('a 401 whose fresh login gets no good answer pauses the pass, does not mark the key refused, and moves past the agent', async () => {
  await registered('ava');
  await registered('bo');
  be.st.mode.statusFor = { name: keyName('ava'), status: 401 };
  be.st.mode.loginStatus = 500;
  cs._ownerLinkReset(0);
  await cs.sweep();
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  assert.notEqual(keys.ava.refused, true, 'a login the service failed is not a refused key');
  assert.equal(agentNamed('bo').owner, null, 'the pass stopped on ava');
  be.st.mode.loginStatus = 0;
  await cs.sweep();
  assert.ok(agentNamed('bo').owner, 'the next pass starts after ava');
  cs._ownerLinkReset(15 * 60 * 1000);
});

test('the pass budget: an exhausted pass stops before the agent and the next pass starts at it', async () => {
  await registered('ava');
  await registered('bo');
  cs._ownerLinkBudget(-1);   // spent before the first agent
  try {
    await cs.sweep();
    assert.equal(R.mints.length, 0, 'no agent started once the budget is spent');
  } finally { cs._ownerLinkBudget(30 * 1000); }
  await cs.sweep();
  assert.equal(R.mints[0].body.agent, keyName('ava'), 'the next pass starts at the agent not yet tried');
  assert.ok(agentNamed('ava').owner && agentNamed('bo').owner);
});

test('a coordinator 400 for a second agent in one pass is about the request: the whole pass waits', async () => {
  for (const a of ['a1', 'a2', 'a3']) await registered(a);
  R.mint = () => ({ ok: false, because: 'coordinator answered 400', refusal: { status: 400, code: null, currentEpoch: null } });
  await cs.sweep();
  assert.equal(R.mints.length, 2, 'the first 400 skips one agent; the second stops the pass');
  await cs.sweep();
  assert.equal(R.mints.length, 2, 'and the pass waits');
});

test('a site refusal for a second agent in one pass means the site no longer takes passes: the whole pass waits', async () => {
  for (const a of ['a1', 'a2', 'a3']) await registered(a);
  be.st.mode.status = 403;
  await cs.sweep();
  assert.equal(ownerCalls().length, 2, 'the first refusal skips one agent; the second stops the pass');
  await cs.sweep();
  assert.equal(ownerCalls().length, 2, 'and the pass waits');
});

test('a mint that throws is treated as no answer: the pass waits', async () => {
  await registered('ava');
  await registered('bo');
  R.mint = () => { throw new Error('boom'); };
  await cs.sweep();
  assert.equal(R.mints.length, 1, 'the whole pass waits, not only that agent (bo is not asked)');
  await cs.sweep();
  assert.equal(R.mints.length, 1, 'asked once, then the pass waits');
  assert.equal(ownerCalls().length, 0);
});
