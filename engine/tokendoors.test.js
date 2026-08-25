'use strict';
/** #529: the token doors. One engine, a spec per service; each door checks with the service, keeps mode 600, never answers the token. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.AGENT_WORKFORCE_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-tokendoors-'));
const { SPECS, bySlug, byName, routes } = require('./tokendoors');
const { DIR } = require('./tokendoor');

test('every spec is whole: a pill name, a route slug, a variable name, a place to make the token, a verify call, an accept rule', () => {
  const seenSlug = new Set(); const seenVar = new Set();
  for (const s of SPECS) {
    assert.match(s.slug, /^[a-z0-9-]+$/, s.name + ' slug');
    assert.match(s.envVar, /^[A-Z][A-Z0-9_]*$/, s.name + ' envVar');
    assert.match(s.where, /^https:\/\//, s.name + ' where');
    assert.ok(s.whereText, s.name + ' whereText');
    assert.match(s.verify.url, /^https:\/\//, s.name + ' verify url');
    assert.equal(typeof s.verify.headers('x'), 'object', s.name + ' headers');
    assert.equal(typeof s.accept, 'function', s.name + ' accept');
    assert.ok(!seenSlug.has(s.slug) && !seenVar.has(s.envVar), s.name + ' collides with another door');
    seenSlug.add(s.slug); seenVar.add(s.envVar);
    for (const w of [s.where, s.whereText, s.hint || '']) assert.ok(!w.includes('—'), s.name + ' carries an em dash');
  }
  assert.equal(routes()['Discord'], '/api/svc/discord');
});

test('not connected until a token is held, and what is not a token is refused before the service is asked', async () => {
  const d = bySlug('discord');
  let asked = 0;
  d.setFetcher(async () => { asked += 1; return { ok: true, status: 200, body: { username: 'kittybot' } }; });
  const st = await d.state();
  assert.equal(st.connected, false); assert.equal(st.held, false); assert.equal(st.service, 'Discord'); assert.equal(st.envVar, 'DISCORD_BOT_TOKEN');
  for (const bad of ['', '  ', 'two words', 'short']) {
    const r = await d.connect(bad);
    assert.ok(r.refused, JSON.stringify(bad) + ' was not refused');
  }
  assert.equal(asked, 0, 'the service was asked about something that is not a token');
  d.setFetcher(null);
});

test('a token the service accepts is stored mode 600 under secrets/env by variable name, the state reads who from the service, and the token is never in the answer', async () => {
  const d = byName('Discord');
  const seen = [];
  d.setFetcher(async (req, tok) => { seen.push({ req, tok }); return { ok: true, status: 200, body: { username: 'kittybot' } }; });
  // Not shaped like a real Discord token on purpose: GitHub's push protection
  // refuses a commit carrying one, fake or not (it did, 2026-08-24 21:30).
  const token = 'fake-discord-token-for-this-test-0123456789';
  const st = await d.connect(token);
  assert.equal(st.connected, true); assert.equal(st.who, 'kittybot'); assert.equal(st.refused, undefined);
  assert.ok(!JSON.stringify(st).includes(token), 'the token came back in the state');
  const file = path.join(DIR, 'DISCORD_BOT_TOKEN');
  assert.equal(fs.readFileSync(file, 'utf8'), token + '\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(seen[0].req.headers.Authorization, 'Bot ' + token, 'Discord wants Bot, not Bearer');
  assert.equal((await d.state()).who, 'kittybot', 'the state is read from the service, with the held token');
  await d.forget();
  assert.ok(!fs.existsSync(file)); assert.equal((await d.state()).held, false);
  d.setFetcher(null);
});

test('a token the service rejects is not stored and the door says the service did not accept it; an unreachable service says so', async () => {
  const d = byName('Brave Search');
  d.setFetcher(async () => ({ ok: false, status: 401, body: null }));
  const r = await d.connect('bsa_0123456789abcdef0123456789abcdef');
  assert.equal(r.refused, 'Brave Search did not accept that token');
  assert.ok(!fs.existsSync(path.join(DIR, 'BRAVE_API_KEY')));
  d.setFetcher(async () => { throw new Error('ENOTFOUND'); });
  const r2 = await d.connect('bsa_0123456789abcdef0123456789abcdef');
  assert.match(r2.refused, /could not reach Brave Search/);
  d.setFetcher(null);
});

test('a POST verify carries the body and a JSON content type, and a GraphQL who is read from data.viewer', async () => {
  const d = byName('Fly.io');
  let got = null;
  d.setFetcher(async (req) => { got = req; return { ok: true, status: 200, body: { data: { viewer: { email: 'her@example.com' } } } }; });
  const st = await d.connect('fo1_0123456789abcdef0123456789abcdef');
  assert.equal(got.method, 'POST'); assert.deepEqual(got.body, { query: '{ viewer { email } }' });
  assert.equal(st.who, 'her@example.com');
  await d.forget(); d.setFetcher(null);
});
