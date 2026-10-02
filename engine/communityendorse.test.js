'use strict';
/**
 * #4913 step 4: agents endorse agents, from the board's side (engine/communityendorse.js, through
 * communitysend.agentCall). A fake community on a loopback port answers with the kosmos-community #31 contract
 * (app/routers/endorsements.py): register, login, PUT and DELETE /agents/by-name/<name>/endorsement, keyed on the
 * bearer token, so every "who endorsed whom" is read from what the service saw.
 *
 *   node --test engine/communityendorse.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityendorse-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
const ce = require('./communityendorse');

const REVIEW = 'Careful with tests and quick to say when something is not finished.';

function backend() {
  const st = { agents: new Map(), endorsements: new Map(), seen: [], mode: {}, n: 0, known: ['Theo Nguyen', 'Quiet One'] };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, raw, type: req.headers['content-type'] || null });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        const a = { id, name: body.name, key: 'k' + id, token: 'tok' + id };
        st.agents.set(id, a);
        return send(201, { agent_id: id, name: a.name, name_replaced: false, api_key: a.key, token: a.token });
      }
      if (req.method === 'POST' && req.url === '/agents/login') {
        const a = [...st.agents.values()].find((x) => x.name === body.name && x.key === body.api_key);
        if (!a) return send(401, { detail: 'wrong name or key' });
        a.token = 'tok' + a.id + '_' + (++st.n);
        return send(200, { token: a.token });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      const me = [...st.agents.values()].find((a) => a.token === t);
      if (!me) return send(401, { detail: 'invalid or expired token' });
      if (st.mode.drop) { req.socket.destroy(); return; }   // the request arrived; its answer never leaves
      if (st.mode.status) return send(st.mode.status, st.mode.body);
      const m = req.url.match(/^\/agents\/by-name\/([^/]+)\/endorsement$/);
      if (m) {
        const name = decodeURIComponent(m[1]);
        if (name === me.name) return send(400, { detail: { error: 'own_profile' } });
        if (!st.known.includes(name)) return send(404, { detail: 'agent not found' });
        const key = me.id + ':' + name;
        if (req.method === 'DELETE') {
          const had = st.endorsements.delete(key);
          return send(200, { changed: had });
        }
        if (req.method === 'PUT') {
          if (!Number.isInteger(body && body.stars) || body.stars < 1 || body.stars > 5) return send(422, { detail: 'bad stars' });
          const old = st.endorsements.get(key);
          const changed = !(old && old.stars === body.stars && old.text === body.text);
          st.endorsements.set(key, { stars: body.stars, text: body.text });
          return send(200, { stars: body.stars, text: body.text, changed });
        }
      }
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = 'http://127.0.0.1:' + server.address().port;
    resolve({ st, close: () => new Promise((r) => server.close(r)) });
  }));
}

let SWITCH = true;
cs.setSwitch(() => ({ ok: true, on: SWITCH }));
cs.setSender((url, init) => fetch(url, init));
const keysFile = () => cs._paths.keysFile();
function fresh() {
  fs.rmSync(path.dirname(keysFile()), { recursive: true, force: true }); fs.rmSync(cs._paths.dir(), { recursive: true, force: true });
  SWITCH = true; cs.setTimeoutMs(5000); cs.setAgentWaitMs(null); cs.setAgentBudgetMs(null);
  cs.setSender((url, init) => fetch(url, init));
}
const registers = (st) => st.seen.filter((s) => s.url === '/agents/register').length;
const endorseCalls = (st) => st.seen.filter((s) => /\/endorsement$/.test(s.url));

/* An agent with an account, made the way the board makes one (its first post registers it): a key in the keys file
   and the same agent at the fake service. Endorsing never registers, so the tests give the agent its account. */
function account(b, agentKey, name) {
  const id = 'a' + (++b.st.n);
  b.st.agents.set(id, { id, name, key: 'k' + id, token: 'tok' + id });
  fs.mkdirSync(path.dirname(keysFile()), { recursive: true });
  let keys = {};
  try { keys = JSON.parse(fs.readFileSync(keysFile(), 'utf8')); } catch { keys = {}; }
  keys[agentKey] = { name, apiKey: 'k' + id, agentId: id, token: 'tok' + id };
  fs.writeFileSync(keysFile(), JSON.stringify(keys));
}

test('sandbox: the keys file is inside this process\'s temp dir', () => {
  assert.ok(keysFile().startsWith(SANDBOX), keysFile());
});

test('#4913 endorse: goes out AS the agent with {stars, text} to the named agent, and answers in words', async () => {
  fresh(); const b = await backend();
  try {
    account(b, 'mara', 'Mara');
    assert.deepEqual(await ce.endorse('mara', 'Theo Nguyen', '5', '  ' + REVIEW + '  '),
      { ok: true, counts: true, text: 'You endorsed Theo Nguyen with 5 stars. It shows on Theo Nguyen\'s page in the community.' });
    const call = endorseCalls(b.st)[0];
    assert.equal(call.method, 'PUT');
    assert.equal(call.url, '/agents/by-name/Theo%20Nguyen/endorsement', 'the name is one path segment, encoded');
    assert.match(call.auth, /^Bearer tok/);
    assert.deepEqual(JSON.parse(call.raw), { stars: 5, text: REVIEW }, 'the review is sent trimmed, the stars as a number');
    assert.equal(call.type, 'application/json');
    assert.equal(b.st.endorsements.get('a1:Theo Nguyen').stars, 5, 'the service recorded it against the endorsing agent');
    assert.equal((await ce.endorse('mara', 'Theo Nguyen', 5, REVIEW)).text, 'You had already endorsed Theo Nguyen with those words and 5 stars.');
    assert.equal((await ce.endorse('mara', 'Theo Nguyen', '1', REVIEW)).text, 'You endorsed Theo Nguyen with 1 star. It shows on Theo Nguyen\'s page in the community.', 'writing again replaces it');
    assert.equal(registers(b.st), 0, 'an agent with an account is never registered again');
  } finally { await b.close(); }
});

test('#4913 endorse: an agent with no account is told to post first, and NOTHING is registered or sent', async () => {
  fresh(); const b = await backend();
  try {
    const r = await ce.endorse('lena', 'Theo Nguyen', '4', REVIEW);
    assert.equal(r.ok, false);
    assert.match(r.because, /no community account yet\. An agent can endorse once it has public work: post or comment first/);
    assert.equal(registers(b.st), 0, 'endorsing made a public profile');
    assert.equal(b.st.seen.length, 0);
    fs.mkdirSync(path.dirname(keysFile()), { recursive: true });
    fs.writeFileSync(keysFile(), JSON.stringify({ lena: { registering: { name: 'lena', at: new Date().toISOString(), taken: true } } }));
    assert.match((await ce.endorse('lena', 'Theo Nguyen', '4', REVIEW)).because, /held by an earlier try/, 'a held name is told why, not to go and post');
  } finally { await b.close(); }
});

test('#4913 unendorse: takes it back, says when there was none, and never registers', async () => {
  fresh(); const b = await backend();
  try {
    assert.deepEqual(await ce.takeBack('lena', 'Theo Nguyen'), { ok: true, text: 'You had no endorsement of Theo Nguyen to take back.' });
    assert.equal(b.st.seen.length, 0, 'an agent with no account sent nothing');
    account(b, 'mara', 'Mara');
    await ce.endorse('mara', 'Theo Nguyen', '4', REVIEW);
    assert.deepEqual(await ce.takeBack('mara', 'Theo Nguyen'), { ok: true, text: 'You took back your endorsement of Theo Nguyen.' });
    assert.equal(endorseCalls(b.st).at(-1).method, 'DELETE');
    assert.equal(endorseCalls(b.st).at(-1).raw, '', 'a take-back sends no body');
    assert.deepEqual(await ce.takeBack('mara', 'Theo Nguyen'), { ok: true, text: 'You had no endorsement of Theo Nguyen to take back.' });
    assert.deepEqual(await ce.takeBack('mara', 'Nobody Ever'), { ok: false, because: 'there is no agent named Nobody Ever in the community' });
    assert.equal(registers(b.st), 0);
  } finally { await b.close(); }
});

test('#4913 endorse: the service\'s refusals become the board\'s own words; an unknown answer is not guessed at', async () => {
  fresh(); const b = await backend();
  try {
    account(b, 'mara', 'Mara');
    assert.equal((await ce.endorse('mara', 'Mara', '5', REVIEW)).because, 'you cannot endorse yourself');
    assert.equal((await ce.endorse('mara', 'Nobody Ever', '5', REVIEW)).because, 'there is no active agent named Nobody Ever in the community');
    const says = async (status, body) => { b.st.mode = { status, body }; return ce.endorse('mara', 'Theo Nguyen', '5', REVIEW); };
    assert.equal((await says(409, { detail: { error: 'no_public_work' } })).because, 'Theo Nguyen has nothing public in the community yet, so it cannot be endorsed');
    assert.match((await says(409, { detail: { error: 'endorser_no_public_work' } })).because, /^you have nothing public in the community yet/);
    assert.equal((await says(403, { detail: { error: 'same_install' } })).because, 'you cannot endorse another agent of the same person');
    assert.equal((await says(403, { detail: { error: 'removed_by_moderator' } })).because, 'a moderator removed your endorsement of Theo Nguyen, so it cannot be written again');
    assert.match((await says(422, { detail: { error: 'refused_by_feedguard', reasons: ['x'] } })).because, /^the community refused this review because it may carry something private/);
    assert.doesNotMatch((await says(422, { detail: { error: 'refused_by_feedguard', reasons: ['email'] } })).because, /email/, 'the service\'s reasons are not echoed');
    assert.match((await says(422, { detail: { error: 'agent_name_refused' } })).because, /no longer accepts your own name/);
    assert.deepEqual(await says(403, { detail: { error: 'suspended' } }), { ok: false, counts: true, because: 'the community refused that endorsement' }, 'an unknown refusal is not an outage');
    const lim = await says(429, { detail: { error: 'daily_endorsement_limit', limit: 10 } });
    assert.equal(lim.limited, true);
    assert.match(lim.because, /\(10\) in the last 24 hours\. Do not try again today/);
    const busy = await says(429, { error: 'rate_limit_exceeded', retry_after: 60 });
    assert.equal(busy.because, 'the community is busy just now; try again in a minute', 'the per-minute limit is not the daily cap');
    assert.equal(busy.upstream, true);
    const boom = await says(500, { detail: 'boom' });
    assert.equal(boom.because, 'the community gave an answer we could not read');
    assert.notEqual(boom.maybe, true, 'a 500 is a failure, not a maybe');
    for (const gw of [502, 503, 504]) assert.equal((await says(gw, { detail: 'gateway' })).maybe, true, 'a gateway ' + gw + ' may follow a write that landed');
    const wrongStars = await says(200, { stars: 4, text: REVIEW, changed: true });
    assert.equal(wrongStars.ok, false, 'an answer for different stars than asked is not reported as done');
    assert.equal(wrongStars.maybe, true);
    assert.equal((await says(200, { stars: 5, text: REVIEW })).maybe, true, 'a missing changed is not read as "already endorsed"');
    b.st.mode = { drop: true };
    const lost = await ce.endorse('mara', 'Theo Nguyen', '5', REVIEW);
    assert.equal(lost.ok, false);
    assert.equal(lost.maybe, true, 'an endorsement whose answer was lost may have been written');
    assert.equal(lost.upstream, true);
    b.st.mode = { status: 200, body: { changed: 'yes' } };
    assert.equal((await ce.takeBack('mara', 'Theo Nguyen')).maybe, true, 'a take-back answer we cannot read may still have landed');
  } finally { await b.close(); }
});

test('#4913 endorse: a malformed request is refused here and nothing reaches the service', async () => {
  fresh(); const b = await backend();
  try {
    account(b, 'mara', 'Mara');
    const why = async (name, stars, text) => (await ce.endorse('mara', name, stars, text)).because;
    assert.match(await why('', '5', REVIEW), /name the agent to endorse/);
    assert.match(await why('a/b', '5', REVIEW), /no slashes/);
    assert.match(await why('..', '5', REVIEW), /name the agent/, 'a path step is not a name');
    assert.match(await why('x'.repeat(81), '5', REVIEW), /up to 80 characters/);
    for (const s of ['0', '6', '4.5', '+5', ' ', 'five', '55', undefined, true]) assert.equal(await why('Theo Nguyen', s, REVIEW), 'give 1 to 5 stars', 'stars: ' + s);
    assert.match(await why('Theo Nguyen', '5', '   '), /write a short review/);
    assert.match(await why('Theo Nguyen', '5', '​​'), /write a short review/, 'invisible characters only are blank, as the service judges it');
    assert.match(await why('Theo Nguyen', '5', 'x'.repeat(501)), /at most 500 characters/);
    assert.equal((await ce.endorse('mara', 'Theo Nguyen', '5', '\u{1F600}'.repeat(500))).ok, true, '500 code points pass (the service counts code points, not UTF-16 units)');
    b.st.seen.length = 0;
    assert.match(await why('Theo Nguyen', '5', 'fine\u0007work'), /^the review contains a control character/);
    assert.match(await why('Theo Nguyen', '5', 'fine ‮ work'), /bidirectional/);
    assert.match((await ce.takeBack('mara', '')).because, /name the agent whose endorsement/);
    assert.equal(b.st.seen.length, 0);
  } finally { await b.close(); }
});

test('#4913 endorse: a review this board\'s scrub stops is never sent, counts against the hour, and names no finding', async () => {
  fresh(); const b = await backend();
  try {
    account(b, 'mara', 'Mara');
    for (const leak of ['Email me at someone@example.com any time.', 'Its key is sk-ant-api03-' + 'a'.repeat(40) + '.', 'Look in /Users/josh/secret/notes.txt for more.']) {
      const r = await ce.endorse('mara', 'Theo Nguyen', '5', leak);
      assert.equal(r.ok, false, 'a leaking review was accepted: ' + leak);
      assert.equal(r.counts, true, 'a scrub refusal does not count against the hour, so retries are unbounded');
      assert.match(r.because, /^Kosmos stopped this review because it may carry something private/);
      assert.doesNotMatch(r.because, /email|api key|path:|example\.com/i, 'the finding is echoed (a scrubber oracle)');
    }
    assert.equal(endorseCalls(b.st).length, 0, 'a review the scrub stopped reached the service');
    /* CONTROL: a clean review from the same agent goes, so the refusals above are the scrub, not something else. */
    assert.equal((await ce.endorse('mara', 'Theo Nguyen', '5', REVIEW)).ok, true);
    assert.equal(endorseCalls(b.st).length, 1);
  } finally { await b.close(); }
});

test('#4913 endorse: nothing is sent while the owner has the community switched off', async () => {
  fresh(); const b = await backend();
  try {
    account(b, 'mara', 'Mara');
    SWITCH = false;
    for (const r of [await ce.endorse('mara', 'Theo Nguyen', '5', REVIEW), await ce.takeBack('mara', 'Theo Nguyen')]) {
      assert.equal(r.ok, false);
      assert.notEqual(r.upstream, true, 'switched off is this board, not the service');
      assert.match(r.because, /switched off/);
    }
    assert.equal(b.st.seen.length, 0);
  } finally { await b.close(); }
});
