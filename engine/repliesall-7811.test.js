'use strict';
/*
 * kosmos#7811: an agent with more than 10 posts has its older ones read too when they have something new, told by one
 * public profile read (each listed post's latest_reply), at most REPLIES_OLDER_MAX of them a read. The nudge's count
 * takes the same set. A profile that cannot be read keeps the newest 10 and says so; posts past the profile's list are
 * said as not checked. Sandboxed data root before any require; no network (an injected fetcher).
 *
 *   node --test engine/repliesall-7811.test.js
 */
require('../test-support/tmpscope'); // #4273
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-repliesall-'));
process.env.AGENT_WORKFORCE_DATA = SANDBOX;
const cs = require('./communitysend');
const cr = require('./communityread');
cs.setSwitch(() => ({ on: true, ok: true }));

const NOW = Date.parse('2026-10-01T12:00:00Z');
const PID = (i) => 'e1000000-0000-4000-8000-0000000000' + String(i).padStart(2, '0');   // post i, newer with i
const CID = (n) => 'c0000000-0000-4000-8000-0000000000' + String(n).padStart(2, '0');
const comment = (o = {}) => ({ id: CID(1), parent_id: null, created_at: '2026-10-01T09:00:00Z', state: 'live', agent: { name: 'Ann', role: 'x' }, body: 'a comment', reply_to_name: null, ...o });

function writeSendState(agent, n) {
  const p = cs._paths;
  fs.mkdirSync(path.dirname(p.sentFile()), { recursive: true });
  const sent = {};
  for (let i = 0; i < n; i += 1) sent['p' + i] = { state: 'sent', agent, remoteId: PID(i), sentAt: '2026-09-30T' + String(i).padStart(2, '0') + ':00:00Z' };
  fs.writeFileSync(p.sentFile(), JSON.stringify(sent));
  fs.writeFileSync(p.keysFile(), JSON.stringify({ [agent]: { name: agent.toLowerCase() + '-writes', remoteId: 'x', apiKey: 'K', token: 'T' } }));
}
function clearSeen() { try { fs.rmSync(path.join(require('./store').ROOT, 'communityread', 'replies-seen'), { recursive: true, force: true }); } catch { /* none */ } }
/* The service: a profile listing `listed` post ids (latest_reply from `latest`), and threads from `threads`. */
function serve({ listed, latest = {}, threads = {}, profile = 200 }) {
  const urls = [];
  cr.setFetcher(async (url) => {
    urls.push(url);
    const u = new URL(url);
    if (u.pathname.startsWith('/agents/by-name/')) {
      if (profile !== 200) return { status: profile, json: null };
      return { status: 200, json: { name: 'x', posts: listed.map((i) => ({ id: PID(i), latest_reply: latest[i] || null })) } };
    }
    const m = u.pathname.match(/^\/posts\/([^/]+)\/comments$/);
    if (m) { const i = Number(m[1].slice(-2)); return { status: 200, json: { comments: threads[i] || [] } }; }
    return { status: 404, json: null };
  });
  return urls;
}
const threadReads = (urls) => urls.filter((u) => /\/comments\?order=newest/.test(u)).map((u) => Number(u.match(/\/posts\/([^/]+)\//)[1].slice(-2))).sort((a, b) => a - b);
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);

test('an older post with a new comment is read and its comment shown; a quiet older one is not read', async () => {
  clearSeen();
  writeSendState('Old7811', 12);   // posts 0..11; the newest 10 are 2..11
  const urls = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: '2026-10-01T09:00:00Z' } },
    threads: { 0: [comment({ id: CID(1), body: 'on an old post' })] } });
  const r = await cr.readReplies('Old7811', { now: NOW });
  assert.equal(r.ok, true, r.because);
  assert.deepEqual(threadReads(urls), [0].concat(range(2, 12)), 'not the newest 10 and the one older post with something new');
  assert.match(r.text, /on an old post/);
  assert.doesNotMatch(r.text, /only your newest/);
  /* CONTROL: read again, the old post's mark is at its newest reply, so it is not read again. */
  const again = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: '2026-10-01T09:00:00Z' } } });
  await cr.readReplies('Old7811', { now: NOW + 1000 });
  assert.deepEqual(threadReads(again), range(2, 12), 'an older post with nothing past its mark was read again');
});

test('a profile that cannot be read keeps the newest 10 and says the older posts were not checked', async () => {
  clearSeen();
  writeSendState('Bad7811', 12);
  const urls = serve({ listed: [], profile: 503 });
  const r = await cr.readReplies('Bad7811', { now: NOW });
  assert.deepEqual(threadReads(urls), range(2, 12));
  assert.match(r.text, /only your newest 10 of 12 posts were looked at: your older posts could not be checked for new comments just now/);
});

test('past REPLIES_OLDER_MAX older posts with something new, the newest activity is read first and the rest are said', async () => {
  clearSeen();
  writeSendState('Many7811', 18);   // newest 10 are 8..17; older 0..7
  const latest = {};
  for (let i = 0; i < 8; i += 1) latest[i] = { id: CID(i + 1), created_at: '2026-10-01T0' + i + ':30:00Z' };   // older i is newer activity with i
  const urls = serve({ listed: range(0, 18), latest });
  const r = await cr.readReplies('Many7811', { now: NOW });
  assert.equal(cr.REPLIES_OLDER_MAX, 5);
  assert.deepEqual(threadReads(urls), range(3, 18), 'not the 5 older posts with the newest activity');
  assert.match(r.text, /\(3 more of your older posts have new comments: read again for them\)/);
});

test('older posts past the profile\'s list are said as not looked at', async () => {
  clearSeen();
  writeSendState('Unl7811', 12);
  const urls = serve({ listed: range(1, 12) });   // post 0 is not on the profile
  const r = await cr.readReplies('Unl7811', { now: NOW });
  assert.deepEqual(threadReads(urls), range(2, 12));
  assert.match(r.text, /\(your oldest post is past what Kosmos can check for new comments, so it is not looked at\)/);
});

test('ten posts or fewer make no profile read at all', async () => {
  clearSeen();
  writeSendState('Few7811', 10);
  const urls = serve({ listed: range(0, 10) });
  await cr.readReplies('Few7811', { now: NOW });
  assert.equal(urls.filter((u) => u.includes('/agents/by-name/')).length, 0);
  assert.deepEqual(threadReads(urls), range(0, 10));
});

test('the nudge\'s count takes the same older post, and a profile it cannot read makes it partial', async () => {
  clearSeen();
  writeSendState('Nud7811', 12);
  serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: '2026-10-01T09:00:00Z' } },
    threads: { 0: [comment({ id: CID(1), body: 'on an old post' })] } });
  const f = await cr.freshReplies('Nud7811', { now: NOW, paceMs: 0 });
  assert.equal(f.ok, true, f.because);
  assert.deepEqual(f.posts.map((p) => [p.remoteId, p.ids]), [[PID(0), [CID(1)]]], 'the older post\'s owed comment was not counted');
  serve({ listed: [], profile: 503 });
  const bad = await cr.freshReplies('Nud7811', { now: NOW, paceMs: 0 });
  assert.equal(bad.ok, false);
  assert.equal(bad.partial, true, 'an unread profile did not make the count partial');
});
