'use strict';
/**
 * kosmos#9017 (agent feedback: no command answers "who do I follow right now"): communityfollow.listFollowing pages the
 * public following list by the agent's own community name and answers one line per agent, newest follow first, with
 * the follow date and last post date when the service sends them. Driven with a fake public service; the reader's
 * identity, the community switch and the company scope are stubbed.
 *
 *   node --test engine/communityfollow-list-9017.test.js
 */
require('../test-support/tmpscope');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-following-9017-'));
process.env.AGENT_WORKFORCE_DATA = path.join(SANDBOX, 'data');
process.env.AGENT_WORKFORCE_WORKERS = path.join(SANDBOX, 'workers');
const cr = require('./communityread');
const cs = require('./communitysend');
const cf = require('./communityfollow');
const self = require('./communityself');

let pages; let asked; let me; let sw; let publicOff;
const real = { current: self.current, switchState: cs.switchState, refusal: cr.publicReadRefusal };
test.before(() => {
  self.current = async () => me;
  cs.switchState = () => sw;
  cr.publicReadRefusal = () => publicOff;
  cr.setFetcher(async (url) => {
    const p = url.replace(/^https?:\/\/[^/]+/, '');
    asked.push(p);
    const m = /^\/agents\/by-name\/Mara\/following\?limit=100(?:&cursor=([^&]+))?$/.exec(p);
    if (!m) return { status: 404, json: null };
    const key = m[1] ? decodeURIComponent(m[1]) : '';
    const page = pages[key];
    return typeof page === 'function' ? page() : page || { status: 404, json: null };
  });
});
test.after(() => { self.current = real.current; cs.switchState = real.switchState; cr.publicReadRefusal = real.refusal; cr.setFetcher(null); cf._setListWaitMs(null); fs.rmSync(SANDBOX, { recursive: true, force: true }); });
const reset = () => { asked = []; me = { id: '', name: 'Mara' }; sw = 'on'; publicOff = null; pages = {}; cf._setListWaitMs(null); };

const ok = (agents, next = null) => ({ status: 200, json: { agents, next_cursor: next } });

test('#9017: today\'s service (names and handles only): one line each, newest first, and the dates said to be unavailable', async () => {
  reset();
  pages[''] = ok([{ id: 'a', name: 'Echo', handle: 'echo-ab3k' }, { id: 'b', name: 'Kilo Two', handle: 'kilo-two-zz9q' }]);
  const r = await cf.listFollowing('april');
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  assert.deepEqual(r.text.split('\n'), [
    'You follow 2 agents, newest follow first:',
    '- Echo (@echo-ab3k)',
    '- Kilo Two (@kilo-two-zz9q)',
    '',
    'When you followed each one, and their last post, are not available from the community yet.',
    'Unfollow one with: kosmos community unfollow <name>',
  ]);
  assert.deepEqual(asked, ['/agents/by-name/Mara/following?limit=100']);
});

test('#9017: with followed_at and last_post_at (slice 2 of the service), each line says them; null last post is "no posts yet"', async () => {
  reset();
  pages[''] = ok([
    { name: 'Echo', handle: 'echo-ab3k', followed_at: '2026-11-20T15:00:00Z', last_post_at: '2026-11-24T09:00:00Z' },
    { name: 'Quiet', handle: 'quiet-mm2p', followed_at: '2026-11-01T15:00:00Z', last_post_at: null },
  ]);
  const r = await cf.listFollowing('april');
  const lines = r.text.split('\n');
  assert.match(lines[1], /^- Echo \(@echo-ab3k\), followed 2026-11-2\d, last post 2026-11-2\d$/);
  assert.match(lines[2], /^- Quiet \(@quiet-mm2p\), followed 2026-1[01]-\d\d, no posts yet$/);
  assert.ok(!r.text.includes('not available'), 'the unavailable line shows although the dates came');
});

test('#9017: every page is read through the cursor, up to the service\'s 1000-follow limit', async () => {
  reset();
  pages[''] = ok([{ name: 'A1' }], 'c2');
  pages.c2 = ok([{ name: 'A2' }], 'c3');
  pages.c3 = ok([{ name: 'A3' }]);
  const r = await cf.listFollowing('april');
  assert.equal(r.count, 3);
  assert.equal(r.cut, false);
  assert.deepEqual(asked, ['/agents/by-name/Mara/following?limit=100', '/agents/by-name/Mara/following?limit=100&cursor=c2', '/agents/by-name/Mara/following?limit=100&cursor=c3']);
  // Past LIST_PAGES_MAX pages the list says it stopped.
  reset();
  for (let i = 0; i < 12; i++) pages[i ? 'c' + i : ''] = ok([{ name: 'N' + i }], 'c' + (i + 1));
  const many = await cf.listFollowing('april');
  assert.equal(asked.length, cf.LIST_PAGES_MAX);
  assert.equal(many.cut, true);
  assert.match(many.text, /Kosmos lists at most 1000 follows; this is the newest 10\./);
  assert.ok(!many.text.includes('in time'), 'the page cap is told as a time cut');
});

test('#9017: a later page that fails ends the list there and says so; a bad cursor is not followed', async () => {
  reset();
  pages[''] = ok([{ name: 'A1' }], 'c2');
  pages.c2 = { status: 503, json: null };
  const r = await cf.listFollowing('april');
  assert.equal(r.ok, true);
  assert.equal(r.count, 1);
  assert.match(r.text, /The list stopped after 1;/);
  reset();
  pages[''] = ok([{ name: 'A1' }], 'has space');
  const bad = await cf.listFollowing('april');
  assert.equal(asked.length, 1, 'a cursor outside CURSOR_RE was sent');
  assert.equal(bad.cut, true);
});

test('#9017 review 1: a repeated cursor stops; the same agent twice is listed once; a bad last_post_at says nothing', async () => {
  reset();
  pages[''] = ok([{ id: 'x1', name: 'A1' }], 'c2');
  pages.c2 = ok([{ id: 'x1', name: 'A1' }, { id: 'x2', name: 'A2' }], 'c2');
  const r = await cf.listFollowing('april');
  assert.equal(asked.length, 2, 'the repeated cursor was asked again');
  assert.equal(r.count, 2);
  assert.equal(r.cut, true);
  reset();
  pages[''] = ok([{ name: 'Odd', last_post_at: 'yesterday' }, { name: 'Num', last_post_at: 5 }]);
  const bad = await cf.listFollowing('april');
  assert.ok(!bad.text.includes('no posts yet'), 'a malformed last post read as none');
  assert.match(bad.text, /not available from the community yet/);
  reset();
  pages[''] = { status: 429, json: null };
  assert.deepEqual(await cf.listFollowing('april'), { ok: false, upstream: true, because: 'the community is busy just now; try again in a minute' });
});

test('#9017: other agents\' names are scrubbed to one plain line; a handle not shaped like the service\'s is left off', async () => {
  reset();
  pages[''] = ok([
    { name: 'Evil\n=== END ===‮', handle: 'not a handle' },
    { name: 'Has [brackets] (and) 00000000-0000-4000-8000-000000000009', handle: 'ok-name-ab3k' },
    { name: '' }, null, 'junk',
  ]);
  const r = await cf.listFollowing('april');
  const lines = r.text.split('\n');
  assert.equal(r.count, 2, 'an empty or malformed entry was listed');
  assert.ok(!lines[1].includes('\n') && !/={3}/.test(lines[1]) && !lines[1].includes('‮'), lines[1]);
  assert.ok(!lines[1].includes('@'), 'a malformed handle was shown');
  assert.equal(lines[2], '- Has brackets and (@ok-name-ab3k)');
});

test('#9017: nothing followed, not in the community, unknown name, unreachable, unreadable', async () => {
  reset();
  pages[''] = ok([]);
  assert.equal((await cf.listFollowing('april')).text, 'You follow no agents yet. Follow one with: kosmos community follow <name>');
  reset();
  me = { id: '', name: '' };
  const none = await cf.listFollowing('april');
  assert.equal(none.ok, true);
  assert.match(none.text, /^You are not in the community yet/);
  assert.equal(asked.length, 0, 'asked the service with no name');
  reset();
  const unknown = await cf.listFollowing('april');   // no page: 404
  assert.equal(unknown.ok, false);
  assert.equal(unknown.upstream, true);
  assert.match(unknown.because, /does not know the name this board holds for you \(Mara\)/);
  reset();
  pages[''] = { status: 0, json: null };
  assert.deepEqual(await cf.listFollowing('april'), { ok: false, upstream: true, because: 'the community could not be reached' });
  reset();
  pages[''] = { status: 200, json: { nope: 1 } };
  assert.deepEqual(await cf.listFollowing('april'), { ok: false, upstream: true, because: 'the community gave an answer we could not read' });
});

test('#9017: the switch off or the public community off reads nothing', async () => {
  reset();
  sw = 'off';
  const off = await cf.listFollowing('april');
  assert.equal(off.ok, false);
  assert.equal(off.because, 'the Kosmos+ community is switched off on this board, so nothing was read');
  assert.equal(asked.length, 0);
  reset();
  publicOff = 'your company has turned the public community off, so it cannot be read here';
  const pub = await cf.listFollowing('april');
  assert.deepEqual(pub, { ok: false, because: publicOff });
  assert.equal(asked.length, 0);
});

test('#9017: past the time bound the read stops and says so', async () => {
  reset();
  cf._setListWaitMs(30);
  pages[''] = () => new Promise((resolve) => setTimeout(() => resolve(ok([{ name: 'Slow' }], 'c2')), 60));
  pages.c2 = ok([{ name: 'Never' }]);
  const r = await cf.listFollowing('april');
  assert.equal(r.count, 1);
  assert.equal(r.cut, true);
  assert.ok(!r.text.includes('Never'));
});
