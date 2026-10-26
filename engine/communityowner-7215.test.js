'use strict';
/**
 * kosmos#7215: the send layer links each registered agent to this computer's Kosmos+ account, so the person sees and
 * can delete their agents' posts and comments on one community page. Two steps: the coordinator's owner pass for the
 * agent's community name (through remote.macRequest, stubbed here), then POST /agents/me/owner { pass } with the
 * agent's own key, against a fake kosmos-community on a loopback port. Sandboxed data root before the require.
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
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'k' + id, token: 't' + id, owner: null };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'POST' && req.url === '/agents/login') {
        const x = [...st.agents.values()].find((y) => y.name === body.name && y.key === body.api_key);
        if (!x) return send(401, { detail: 'wrong name or key' });
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
        if (st.mode.status) return send(st.mode.status, { detail: 'no' });
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
  cs._ownerLinkRetry(15 * 60 * 1000);
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
  await cs.sweep();
  assert.ok(agentNamed(agent), 'the agent was not registered');
}
const ownerCalls = () => be.st.seen.filter((s) => s.url === '/agents/me/owner');
// The service's record for a board agent, found by the name the board registered it under (its keys file).
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
  assert.deepEqual(R.mints.map((m) => [m.method, m.route]).filter((x, i, a) => a.findIndex((y) => y[1] === x[1]) === i), [['POST', '/v1/mac/community-owner-pass']]);
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

test('a new agent key (rotated) links that agent again; the marker never holds the key itself', async () => {
  await registered('ava');
  await cs.sweep();
  const n = ownerCalls().length;
  assert.ok(n >= 1);
  const keys = JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8'));
  assert.ok(typeof keys.ava.ownerLinked === 'string' && !keys.ava.ownerLinked.includes(keys.ava.apiKey), 'the marker is a digest');
  // The service rotates the key; the board now holds the new one.
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
  cs._ownerLinkRetry(0);   // the 15-minute pause is over at once, so only the hour-long one keeps it at one ask
  await registered('ava');
  await cs.sweep();
  await cs.sweep();
  assert.equal(R.mints.length, 1, 'asked once, then left alone');
  assert.equal(ownerCalls().length, 0);
  R.mint = null;
  cs._ownerLinkRetry(15 * 60 * 1000);   // the hour is over
  await cs.sweep();
  assert.equal(agentNamed('ava').owner !== null, true);
});

test('a coordinator from before the route answers 404: the same hour-long wait', async () => {
  R.mint = () => ({ ok: false, because: 'coordinator answered 404', refusal: { status: 404, code: null, currentEpoch: null } });
  cs._ownerLinkRetry(0);   // as above: only the hour-long wait keeps it at one ask
  await registered('ava');
  await cs.sweep();
  await cs.sweep();
  assert.equal(R.mints.length, 1);
});

test('a coordinator that fails for another reason (a 503): the pass waits 15 minutes, not an hour', async () => {
  R.mint = () => ({ ok: false, because: 'coordinator answered 503', refusal: { status: 503, code: null, currentEpoch: null } });
  cs._ownerLinkRetry(0);   // the short pause is over at once; the hour-long one would not be
  await registered('ava');
  await cs.sweep();
  assert.ok(R.mints.length >= 2, 'tried again after the short pause: ' + R.mints.length);
  cs._ownerLinkRetry(15 * 60 * 1000);
});

test('the site has no owner route yet (404): one try, then the pass waits; no agent is marked linked', async () => {
  be.st.mode.noRoute = true;
  await registered('ava');
  await registered('bo');
  await cs.sweep();
  await cs.sweep();
  assert.equal(ownerCalls().length, 1, 'one call, then the pause');
  be.st.mode.noRoute = false;
  cs._ownerLinkRetry(15 * 60 * 1000);
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
  cs._ownerLinkRetry(15 * 60 * 1000);
  await cs.sweep();
  assert.equal(ownerCalls().length, 2);
  assert.ok(agentNamed('ava').owner);
});
