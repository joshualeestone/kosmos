'use strict';
/**
 * kosmos#8156 (the community half, Renet 11-07): a test seat never takes part in the Kosmos+ community, whatever the
 * board's switch says. A separate test board starts with the community ON (communityswitch.migrate writes ON when no
 * file exists), and a live-check seat there was asked for a post at its 85% handoff and wrote one about the test.
 *
 * A test seat is an agent named with the prefix #4392 reserved for live checks. This file never spells the prefix: it
 * reads it from the guard that declares it (tools/lib/launchagent-leak-guard.sh), and the first test pins that the
 * engine's copy is the same text.
 *
 * Every arm is checked with the switch ON, beside a CONTROL agent with an ordinary name that does take part, so a
 * refusal cannot pass because nothing was ever going to happen. A fake kosmos-community on a loopback port records every
 * request, so "nothing was sent" is read from what reached it.
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-seat-8156-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
process.env.AGENT_WORKFORCE_CLAUDE_CONFIG = path.join(SANDBOX, 'claude.json');
process.env.AGENT_WORKFORCE_LAUNCH = path.join(SANDBOX, 'launch');

const GUARD = fs.readFileSync(path.join(__dirname, '..', 'tools', 'lib', 'launchagent-leak-guard.sh'), 'utf8');
const m = GUARD.match(/^LAUNCHAGENT_LIVECHECK_PREFIX='([^']+)'$/m);
const PREFIX = m && m[1];
const SEAT = (PREFIX || 'unset-') + 'seat8156';
const PLAIN = 'ava8156';

const sw = require('./communityswitch');
const cs = require('./communitysend');
const communitystore = require('./communitystore');
const feedpublish = require('./feedpublish');
const block = require('./communityblock');
const projects = require('./projects');
const { communityFor } = require('./autohandoff-sweep');

function backend() {
  const st = { agents: new Map(), seen: [], n: 0 };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, body, auth: req.headers.authorization || '' });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/agents/register') {
        const id = 'a' + (++st.n);
        st.agents.set(id, { id, name: body.name, key: 'kc_key_' + id, token: 'tok_' + id });
        return send(201, { agent_id: id, name: body.name, name_replaced: false, api_key: 'kc_key_' + id, token: 'tok_' + id });
      }
      const t = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (![...st.agents.values()].some((x) => x.token === t)) return send(401, { detail: 'invalid or expired token' });
      if (req.method === 'POST' && req.url === '/posts') return send(201, { id: crypto.randomUUID() });
      return send(404, { detail: 'not found' });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    process.env.AGENT_WORKFORCE_COMMUNITY_URL = `http://127.0.0.1:${server.address().port}/`;
    resolve({ st, server });
  }));
}

let be;
test.beforeEach(async () => {
  const data = process.env.AGENT_WORKFORCE_DATA;
  assert.ok(data.startsWith(SANDBOX + path.sep), 'refusing to delete a data root outside this test\'s sandbox');
  fs.rmSync(data, { recursive: true, force: true });
  cs.setSwitch(() => ({ on: true, ok: true }));
  cs.resetPauses();
  be = await backend();
  cs.setSender((url, init) => fetch(url, init));
  cs.setTimeoutMs(2000);
});
test.afterEach(() => { be.server.closeAllConnections(); be.server.close(); cs.setSender(null); cs.setSwitch(null); });
test.after(() => fs.rmSync(SANDBOX, { recursive: true, force: true }));

function agentFile(name, text) {
  const dir = path.join(process.env.AGENT_WORKFORCE_WORKERS, name);
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'CLAUDE.md');
  fs.writeFileSync(f, text);
  return f;
}
function post(agent) {
  fs.mkdirSync(path.join(process.env.AGENT_WORKFORCE_WORKERS, agent), { recursive: true });
  communitystore.grantTrust(agent);
  const r = feedpublish.publishPost({ kind: 'community_post', agent, at: new Date().toISOString(), body: 'What I learned today.' }, { agentId: agent });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}
const BRIEF = (title) => '# ' + title + '\n\nA test agent for checking the community gate.\n';
const withBlock = (title) => BRIEF(title) + '\n' + block.START + '\n' + block.blockBody() + '\n' + block.END + '\n';

test('#8156 the engine\'s test-seat prefix is the one the leak guard reserves (CONTROL)', () => {
  assert.ok(PREFIX && PREFIX.endsWith('-'), 'the guard no longer declares LAUNCHAGENT_LIVECHECK_PREFIX: ' + PREFIX);
  assert.equal(sw.TEST_SEAT_PREFIX, PREFIX, 'communityswitch and the leak guard name different prefixes');
});

test('#8156 isTestSeat: the reserved prefix in any letter case, nothing else', () => {
  for (const name of [SEAT, SEAT.toUpperCase(), '  ' + SEAT + ' ', PREFIX + 'x']) assert.equal(sw.isTestSeat(name), true, name);
  for (const name of [PLAIN, PREFIX.slice(0, -1) + 'x', 'x' + PREFIX + 'a', PREFIX.slice(0, -1), '', null, undefined, 42]) {
    assert.equal(sw.isTestSeat(name), false, String(name));
  }
});

test('#8156 a test seat\'s post is never sent and the seat never registers; an ordinary agent\'s goes (CONTROL)', async () => {
  await cs.sweep();   // opens the ON period: a post made before its start is never sent
  post(PLAIN);
  post(SEAT);
  await cs.sweep();
  const registers = be.st.seen.filter((s) => s.url === '/agents/register');
  const posts = be.st.seen.filter((s) => s.method === 'POST' && s.url === '/posts');
  assert.equal(posts.length, 1, 'CONTROL: the ordinary agent\'s post did not go, so the seat check proves nothing');
  assert.equal(registers.length, 1, 'more than one agent registered: ' + JSON.stringify(registers.map((r) => r.body && r.body.name)));
  assert.ok(!JSON.stringify(be.st.seen).toLowerCase().includes(SEAT), 'something reached the community about the seat');
});

test('#8156 a seat that already holds a key (registered before this check) sends nothing as it either', async () => {
  // The fake knows the seat's account, so a request carrying its token would be answered, and would show in `seen`.
  be.st.agents.set('old', { id: 'old', name: 'Seat', key: 'kc_key_old', token: 'tok_old' });
  fs.mkdirSync(path.dirname(cs._paths.keysFile()), { recursive: true });
  await cs.sweep();   // opens the ON period: a post made before its start is never sent
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({ ...(fs.existsSync(cs._paths.keysFile()) ? JSON.parse(fs.readFileSync(cs._paths.keysFile(), 'utf8')) : {}), [SEAT]: { name: 'Seat', apiKey: 'kc_key_old', agentId: 'old', token: 'tok_old' } }));
  post(SEAT);
  post(PLAIN);
  await cs.sweep();
  assert.equal(be.st.seen.filter((s) => s.method === 'POST' && s.url === '/posts').length, 1, 'CONTROL: the ordinary agent\'s post did not go');
  assert.equal(be.st.seen.filter((s) => s.auth === 'Bearer tok_old').length, 0, 'a request went out as the seat\'s account');
});

test('#8156 votes, follows, reads and endorsements: the seat is refused before anything is sent', async () => {
  const r = await cs.agentCall(SEAT, 'GET', '/agents/me');
  assert.equal(r.ok, false);
  assert.equal(r.local, true, 'the refusal is the board\'s own, not the community\'s');
  assert.match(r.because, /test seat/);
  assert.ok(r.because.includes(PREFIX), 'the refusal does not name the prefix: ' + r.because);
  assert.equal(be.st.seen.length, 0, 'a request reached the community');
  // CONTROL: an ordinary agent gets past the seat check (it registers, which the fake records).
  await cs.agentCall(PLAIN, 'GET', '/agents/me');
  assert.ok(be.st.seen.some((s) => s.url === '/agents/register'), 'CONTROL: the ordinary agent never reached the community');
});

test('#8156 willSend says the seat\'s post or comment will not go, in its own words', () => {
  for (const kind of ['post', 'comment']) {
    assert.deepEqual(cs.willSend(SEAT, Date.now(), kind), { sends: false, later: false, why: 'seat' }, kind);
    assert.match(cs.notSendingWords(kind, 'seat'), /test seat/, kind);
    assert.doesNotMatch(cs.notSendingWords(kind, 'seat'), /switched off|not sending to the community right now/, kind + ': it reads as the switch');
  }
  assert.equal(cs.willSend(PLAIN, Date.now(), 'post').sends, true, 'CONTROL: an ordinary agent\'s post would not go either');
});

test('#8156 the instructions: a seat is never given the community section, and loses one it has; an ordinary agent keeps it (CONTROL)', () => {
  const seatFile = agentFile(SEAT, BRIEF('Seat'));
  const plainFile = agentFile(PLAIN, BRIEF('Ava'));
  assert.equal(block.tellAgent(SEAT, true).state, projects.TOLD.TOLD);
  assert.equal(projects.findBlock(fs.readFileSync(seatFile, 'utf8'), block.START, block.END), null, 'the seat was given the section');
  block.tellAgent(PLAIN, true);
  assert.ok(projects.findBlock(fs.readFileSync(plainFile, 'utf8'), block.START, block.END), 'CONTROL: the ordinary agent was not given it');
  fs.writeFileSync(seatFile, withBlock('Seat'));   // written before this check
  assert.equal(block.tellAgent(SEAT, true).changed, true);
  assert.equal(projects.findBlock(fs.readFileSync(seatFile, 'utf8'), block.START, block.END), null, 'the seat kept the section at its restart');
  // The board-start refresh adds it to every agent of ours that lacks it, but never to a seat.
  fs.writeFileSync(seatFile, BRIEF('Seat'));
  fs.writeFileSync(plainFile, BRIEF('Ava'));
  const told = block.refreshEveryone([{ sessionName: SEAT, isNamedOurs: true }, { sessionName: PLAIN, isNamedOurs: true }], true);
  assert.deepEqual(told.map((t) => t.agent), [PLAIN], 'the refresh wrote to the seat');
  assert.equal(projects.findBlock(fs.readFileSync(seatFile, 'utf8'), block.START, block.END), null);
  assert.ok(projects.findBlock(fs.readFileSync(plainFile, 'utf8'), block.START, block.END), 'CONTROL: the refresh did not reach the ordinary agent');
});

test('#8156 the handoff never asks a seat for a community post, even with the rules in its instructions (CONTROL: an ordinary agent is asked)', () => {
  try { fs.unlinkSync(sw.FILE); } catch { /* none: never asked reads ON */ }
  for (const name of [SEAT, PLAIN]) {
    const brief = require('./instructions').read(name).path;
    fs.mkdirSync(path.dirname(brief), { recursive: true });
    fs.writeFileSync(brief, withBlock(name));
  }
  assert.equal(communityFor(PLAIN).participating, true, 'CONTROL: the ordinary agent is not asked, so the seat answer proves nothing');
  assert.deepEqual(communityFor(SEAT), { participating: false, posts: null, max: null });
});
