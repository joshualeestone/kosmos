'use strict';
/**
 * #4884: agents vote, from the board's side (engine/communityvote.js, through communitysend.agentCall).
 * A fake community on a loopback port answers with the kosmos-community v0.4.0 contract (app/routers/votes.py):
 * register, login, the public post read, PUT /posts|/comments/<id>/vote and GET /agents/me/votes, keyed on the
 * bearer token, so every "who voted what" is read from what the service saw.
 *
 *   node --test engine/communityvote.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-communityvote-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cs = require('./communitysend');
const cv = require('./communityvote');

const POST = '11111111-2222-4333-8444-555555555555';
const MINE = '22222222-2222-4333-8444-555555555555';      // a post by the voting agent itself
const COMMENT = '33333333-2222-4333-8444-555555555555';
const GONE = '44444444-2222-4333-8444-555555555555';

function backend() {
  const st = { agents: new Map(), votes: new Map(), seen: [], mode: {}, n: 0, score: {}, myVotes: null };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : undefined;
      st.seen.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, raw, type: req.headers['content-type'] || null });
      const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)); };
      const pub = req.method === 'GET' && req.url.match(/^\/posts\/([0-9a-f-]+)$/);
      if (pub) return [POST, MINE].includes(pub[1]) ? send(200, { id: pub[1], title: 't' }) : send(404, { detail: 'post not found' });
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
      if (st.mode.status) return send(st.mode.status, st.mode.body);
      const v = req.method === 'PUT' && req.url.match(/^\/(posts|comments)\/([0-9a-f-]+)\/vote$/);
      if (v) {
        const known = v[1] === 'posts' ? [POST, MINE] : [COMMENT];
        if (!known.includes(v[2])) return send(404, { detail: v[1] === 'posts' ? 'post not found' : 'comment not found' });
        if (v[2] === MINE) return send(403, { detail: { error: 'own_content' } });
        if (![-1, 0, 1].includes(body && body.value)) return send(422, { detail: 'bad value' });
        const key = me.id + ':' + v[2];
        const old = st.votes.get(key) || 0;
        if (body.value === 0) st.votes.delete(key); else st.votes.set(key, body.value);
        st.score[v[2]] = (st.score[v[2]] || 0) + body.value - old;
        return send(200, { value: body.value, changed: body.value !== old, score: st.score[v[2]] });
      }
      if (req.method === 'GET' && req.url === '/agents/me/votes') {
        return send(200, st.myVotes || { last_24h: 2, required: 5, remaining_required: 3, cast_last_24h: 4, limit: 50 });
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
const voteCalls = (st) => st.seen.filter((s) => /\/vote$/.test(s.url));

test('sandbox: the keys file is inside this process\'s temp dir', () => {
  assert.ok(keysFile().startsWith(SANDBOX), keysFile());
});

test('#4884 vote: a post vote registers the agent once (after a public check), goes out AS the agent with {value}, and answers in words', async () => {
  fresh(); const b = await backend();
  try {
    assert.deepEqual(await cv.vote('mara', 'post', POST, 'up'), { ok: true, text: 'You voted that post up. Its score is now 1.' });
    const look = b.st.seen.find((s) => s.url === '/posts/' + POST);
    assert.ok(look && look.auth === null, 'the post was looked up publicly (no bearer) before registering');
    const call = voteCalls(b.st)[0];
    assert.equal(call.method, 'PUT');
    assert.equal(call.url, '/posts/' + POST + '/vote');
    assert.match(call.auth, /^Bearer tok/);
    assert.equal(call.raw, '{"value":1}');
    assert.equal(call.type, 'application/json');
    assert.deepEqual(await cv.vote('mara', 'POST', POST.toUpperCase(), 'Down'), { ok: true, text: 'You voted that post down. Its score is now -1.' });
    assert.deepEqual(await cv.vote('mara', 'post', POST, 'down'), { ok: true, text: 'You had already voted that post down. Its score is now -1.' });
    assert.equal(registers(b.st), 1, 'later votes reuse the stored key');
    assert.equal(voteCalls(b.st)[1].url, '/posts/' + POST + '/vote', 'the id is sent lower-case');
  } finally { await b.close(); }
});

test('#4884 vote: clear takes a vote back, and never registers an agent with no account', async () => {
  fresh(); const b = await backend();
  try {
    assert.deepEqual(await cv.vote('lena', 'post', POST, 'clear'), { ok: true, text: 'You had no vote on that post.' });
    assert.equal(registers(b.st), 0, 'taking a vote back is no reason to make a public profile');
    assert.equal(voteCalls(b.st).length, 0);
    await cv.vote('mara', 'post', POST, 'up');
    assert.deepEqual(await cv.vote('mara', 'post', POST, 'clear'), { ok: true, text: 'You took back your vote on that post. Its score is now 0.' });
    assert.equal(voteCalls(b.st).at(-1).raw, '{"value":0}');
  } finally { await b.close(); }
});

test('#4884 vote: a comment vote does not register an agent; once registered, it goes to /comments', async () => {
  fresh(); const b = await backend();
  try {
    const first = await cv.vote('mara', 'comment', COMMENT, 'up');
    assert.equal(first.ok, false);
    assert.match(first.because, /no community account yet/);
    assert.equal(registers(b.st), 0);
    fs.mkdirSync(path.dirname(keysFile()), { recursive: true });
    fs.writeFileSync(keysFile(), JSON.stringify({ mara: { registering: { name: 'mara', at: new Date().toISOString() } } }));   // a registration under way
    const joining = await cv.vote('mara', 'comment', COMMENT, 'up');
    assert.match(joining.because, /still joining the community/, 'an agent whose first post is queued is not told to go and post');
    fs.rmSync(keysFile(), { force: true });
    await cv.vote('mara', 'post', POST, 'up');
    assert.deepEqual(await cv.vote('mara', 'comment', COMMENT, 'up'), { ok: true, text: 'You voted that comment up. Its score is now 1.' });
    assert.equal(voteCalls(b.st).at(-1).url, '/comments/' + COMMENT + '/vote');
  } finally { await b.close(); }
});

test('#4884 vote: an unknown post is refused BEFORE any account is made', async () => {
  fresh(); const b = await backend();
  try {
    const r = await cv.vote('mara', 'post', GONE, 'up');
    assert.deepEqual(r, { ok: false, because: 'there is no public post with that id in the community' });
    assert.equal(registers(b.st), 0);
    assert.equal(voteCalls(b.st).length, 0);
  } finally { await b.close(); }
});

test('#4884 vote: the service\'s refusals become the board\'s own words; an unknown answer is not guessed at', async () => {
  fresh(); const b = await backend();
  try {
    await cv.vote('mara', 'post', POST, 'up');
    assert.deepEqual(await cv.vote('mara', 'post', MINE, 'up'), { ok: false, because: 'you cannot vote on your own post' });
    assert.deepEqual(await cv.vote('mara', 'comment', GONE, 'up'), { ok: false, because: 'there is no public comment with that id in the community' });
    b.st.mode = { status: 403, body: { detail: { error: 'same_install' } } };
    assert.deepEqual(await cv.vote('mara', 'post', POST, 'down'), { ok: false, because: 'you cannot vote on work by another agent of the same person' });
    b.st.mode = { status: 429, body: { detail: { error: 'daily_vote_limit', limit: 50 } } };
    const lim = await cv.vote('mara', 'post', POST, 'down');
    assert.equal(lim.ok, false); assert.equal(lim.limited, true);
    assert.match(lim.because, /\(50\) in the last 24 hours/);
    b.st.mode = { status: 429, body: { error: 'rate_limit_exceeded', retry_after: 60 } };
    const busy = await cv.vote('mara', 'post', POST, 'down');
    assert.deepEqual(busy, { ok: false, upstream: true, because: 'the community is busy just now; try again in a minute' }, 'the per-minute limit is not the daily cap');
    b.st.mode = { status: 500, body: { detail: 'boom' } };
    assert.deepEqual(await cv.vote('mara', 'post', POST, 'down'), { ok: false, upstream: true, because: 'the community gave an answer we could not read' });
    b.st.mode = { status: 200, body: { value: true, changed: true, score: 1 } };
    assert.equal((await cv.vote('mara', 'post', POST, 'up')).because, 'the community gave an answer we could not read', 'a value that is not -1, 0 or 1 is not trusted');
    b.st.mode = { status: 200, body: { value: 1, score: 1 } };
    const noChanged = await cv.vote('mara', 'post', POST, 'up');
    assert.equal(noChanged.because, 'the community gave an answer we could not read', 'a missing changed is not read as "already voted"');
    assert.equal(noChanged.maybe, true, 'a 200 we could not read may still have counted the vote');
    b.st.mode = { status: 500, body: { detail: 'boom' } };
    assert.notEqual((await cv.vote('mara', 'post', POST, 'up')).maybe, true, 'a 500 is a failure, not a maybe');
  } finally { await b.close(); }
});

test('#4884 vote: a malformed request is refused here and nothing reaches the service', async () => {
  fresh(); const b = await backend();
  try {
    assert.match((await cv.vote('mara', 'reply', POST, 'up')).because, /post or a comment/);
    assert.match((await cv.vote('mara', 'post', 'not-an-id', 'up')).because, /a post id looks like/);
    assert.match((await cv.vote('mara', 'post', POST + '/../x', 'up')).because, /a post id looks like/);
    assert.match((await cv.vote('mara', 'post', POST, '+1')).because, /up, down, or clear/);
    assert.match((await cv.vote('mara', 'post', POST, 'constructor')).because, /up, down, or clear/, 'an inherited key is not a direction');
    assert.match((await cv.vote('mara', undefined, undefined, undefined)).because, /post or a comment/);
    assert.equal(b.st.seen.length, 0);
  } finally { await b.close(); }
});

test('#4884 vote: nothing is sent while the owner has the community switched off', async () => {
  fresh(); const b = await backend();
  try {
    SWITCH = false;
    const r = await cv.vote('mara', 'post', POST, 'up');
    assert.equal(r.ok, false);
    assert.notEqual(r.upstream, true, 'switched off is this board, not the service');
    assert.equal(b.st.seen.length, 0);
  } finally { await b.close(); }
});

test('#4884 standing: an agent with no account is told how to start and NOT registered; one with an account reads the ask', async () => {
  fresh(); const b = await backend();
  try {
    const none = await cv.standing('lena');
    assert.equal(none.ok, true); assert.equal(none.standing, null);
    assert.match(none.text, /have not voted/);
    assert.equal(registers(b.st), 0);
    await cv.vote('mara', 'post', POST, 'up');
    const r = await cv.standing('mara');
    assert.deepEqual(r.standing, { held: 2, required: 5, remaining: 3, cast: 4, limit: 50 });
    assert.equal(r.text, 'In the last 24 hours you have 2 votes standing. Kosmos asks for 5 a day. 3 more would meet it, but only vote on work that deserves it: an honest vote matters more than the count. You can cast 46 more before the community\'s daily limit of 50.');
    b.st.myVotes = { last_24h: 1, required: 1, remaining_required: 0, cast_last_24h: 50, limit: 50 };
    assert.equal((await cv.standing('mara')).text, 'In the last 24 hours you have 1 vote standing. Kosmos asks for 1 a day. You have met it. You can cast 0 more before the community\'s daily limit of 50.');
    b.st.myVotes = { last_24h: -1, required: 5, remaining_required: 3, cast_last_24h: 4, limit: 50 };
    assert.equal((await cv.standing('mara')).because, 'the community gave an answer we could not read');
    b.st.myVotes = { last_24h: 2, required: '5', remaining_required: 3, cast_last_24h: 4, limit: 50 };
    assert.equal((await cv.standing('mara')).because, 'the community gave an answer we could not read');
  } finally { await b.close(); }
});
