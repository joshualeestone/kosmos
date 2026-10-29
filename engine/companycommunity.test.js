'use strict';
/**
 * kosmos#7541: the company community client (engine/companycommunity.js) against a stand-in coordinator and site.
 *
 *   node --test engine/companycommunity.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const cc = require('./companycommunity');

const PASS = 'KST1.org_community_pass.sig';
const UNTIL = new Date(Date.now() + 3600e3).toISOString();

function coordinator(answers) {
  const calls = [];
  return { calls, remote: { macRequest: async (m, route, body) => { calls.push([m, route, body]); return answers.shift(); } } };
}
function site(handler) {
  const calls = [];
  return { calls, call: async (m, p, body) => { calls.push([m, p, body]); return handler(m, p, body, calls.length); } };
}

test('#7541: a pass is fetched from the coordinator route, signed, and only a KST1 token is taken', async () => {
  const c = coordinator([{ ok: true, data: { token: PASS } }]);
  assert.deepEqual(await cc.fetchPass({ remote: c.remote }), { ok: true, pass: PASS });
  assert.deepEqual(c.calls, [['POST', '/v1/mac/org/community-pass', {}]]);
  for (const bad of [{ ok: true, data: { token: 'not-a-kst' } }, { ok: true, data: {} }, { ok: false, because: 'org_community_off' }]) {
    const r = await cc.fetchPass({ remote: coordinator([bad]).remote });
    assert.equal(r.ok, false, JSON.stringify(bad));
  }
});

test('#7541: a first space call joins with a fresh pass, then posts to the joined space', async () => {
  const c = coordinator([{ ok: true, data: { token: PASS } }]);
  const s = site((m, p) => p === '/spaces/join' ? { status: 200, json: { space: 'acme', until: UNTIL } } : { status: 201, json: { id: 'p1' } });
  const members = new Map();
  const r = await cc.spaceCall('dana', s.call, 'POST', '/posts', { title: 't', body: 'b' }, { members, remote: c.remote });
  assert.equal(r.status, 201);
  assert.equal(r.space, 'acme');
  assert.deepEqual(s.calls.map((x) => x[1]), ['/spaces/join', '/spaces/acme/posts']);
  assert.deepEqual(s.calls[0][2], { pass: PASS });
  // A second call within the membership needs no pass.
  await cc.spaceCall('dana', s.call, 'GET', '/feed', undefined, { members, remote: c.remote });
  assert.equal(c.calls.length, 1, 'no second pass while still a member');
  assert.deepEqual(s.calls.map((x) => x[1]).slice(2), ['/spaces/acme/feed']);
});

test('#7541: space_join_needed gets a fresh pass, a join and one retry; never a second retry', async () => {
  const c = coordinator([{ ok: true, data: { token: PASS } }, { ok: true, data: { token: PASS } }]);
  const members = new Map([['dana', { space: 'acme', untilMs: Date.now() + 60e3 }]]);
  const s = site((m, p) => p === '/spaces/join' ? { status: 200, json: { space: 'acme', until: UNTIL } }
    : { status: 403, json: { detail: 'space_join_needed' } });
  const r = await cc.spaceCall('dana', s.call, 'POST', '/posts', {}, { members, remote: c.remote });
  assert.equal(r.status, 403);
  assert.deepEqual(s.calls.map((x) => x[1]), ['/spaces/acme/posts', '/spaces/join', '/spaces/acme/posts'], 'one rejoin, one retry');
});

test('#7541: no pass, spaces off, or an unreadable join answer means nothing is sent to a space', async () => {
  const off = coordinator([{ ok: false, because: 'org_community_off' }]);
  const s = site(() => { throw new Error('must not be called'); });
  const r = await cc.spaceCall('dana', s.call, 'POST', '/posts', {}, { members: new Map(), remote: off.remote });
  assert.equal(r.notSent, true);
  const s404 = site(() => ({ status: 404, json: null }));
  const r404 = await cc.spaceCall('dana', s404.call, 'POST', '/posts', {}, { members: new Map(), remote: coordinator([{ ok: true, data: { token: PASS } }]).remote });
  assert.equal(r404.notSent, true);
  assert.deepEqual(s404.calls.map((x) => x[1]), ['/spaces/join'], 'a site without spaces is never posted to');
  const sBad = site(() => ({ status: 200, json: { space: '../public', until: UNTIL } }));
  const rBad = await cc.spaceCall('dana', sBad.call, 'POST', '/posts', {}, { members: new Map(), remote: coordinator([{ ok: true, data: { token: PASS } }]).remote });
  assert.equal(rBad.notSent, true, 'a space id that is not a plain name never goes into a path');
});

test('#7541: not_in_space forgets the membership, so the next call joins again', async () => {
  const members = new Map([['dana', { space: 'acme', untilMs: Date.now() + 60e3 }]]);
  const s = site(() => ({ status: 403, json: { detail: { code: 'not_in_space' } } }));
  const r = await cc.spaceCall('dana', s.call, 'GET', '/feed', undefined, { members, remote: coordinator([]).remote });
  assert.equal(r.status, 403);
  assert.equal(members.has('dana'), false);
});
