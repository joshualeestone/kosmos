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
let aborted = 0;   // profile requests the read stopped
function serve({ listed, latest = {}, threads = {}, profile = 200, slowProfileMs = 0, replyPages = {} }) {
  const urls = [];
  cr.setFetcher(async (url, cap, signal) => {
    urls.push(url);
    if (slowProfileMs && url.includes('/agents/by-name/')) {
      await new Promise((r) => { const t = setTimeout(r, slowProfileMs); if (signal) signal.addEventListener('abort', () => { aborted += 1; clearTimeout(t); r(); }, { once: true }); });
    }
    const u = new URL(url);
    if (u.pathname.startsWith('/agents/by-name/')) {
      if (profile !== 200) return { status: profile, json: null };
      return { status: 200, json: { name: 'x', posts: listed.map((i) => ({ id: PID(i), latest_reply: latest[i] || null })) } };
    }
    const m = u.pathname.match(/^\/posts\/([^/]+)\/comments$/);
    if (m) { const i = Number(m[1].slice(-2)); return { status: 200, json: { comments: threads[i] || [] } }; }
    const rp = u.pathname.match(/^\/posts\/[^/]+\/comments\/([^/]+)\/replies$/);
    if (rp && replyPages[rp[1]] === 'fail') return { status: 500, json: null };
    if (rp && replyPages[rp[1]]) return { status: 200, json: { replies: replyPages[rp[1]], next_cursor: null } };
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
  assert.match(r.text, /only your newest 10 of 12 posts were looked at: your older posts could not be checked for new comments\)/);
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
  assert.match(r.text, /\(3 more of your older posts have something new to look at: read again for them\)/);
});

test('older posts not on the profile are said as not checked', async () => {
  clearSeen();
  writeSendState('Unl7811', 12);
  const urls = serve({ listed: range(1, 12) });   // post 0 is not on the profile
  const r = await cr.readReplies('Unl7811', { now: NOW });
  assert.deepEqual(threadReads(urls), range(2, 12));
  assert.match(r.text, /\(Kosmos looks for new comments on the older posts your public profile lists, its newest 50; 1 of yours is not among them\)/);
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

const at = (h, m = 0) => '2026-10-01T' + String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':00Z';

test('an older post whose newest reply is the agent\'s own is read once (a person owed before it is listed), then not again', async () => {
  clearSeen();
  writeSendState('Own7811', 12);
  /* Pat's comment has 3 replies: the service previews 2, and the agent's own answer is on the replies page (round 2), so
     it is newer than the mark the first round sets and is never shown. */
  const own = comment({ id: CID(5), parent_id: CID(2), created_at: at(9, 30), agent: { name: 'own7811-writes' }, body: 'my answer' });
  const thread = [comment({ id: CID(2), created_at: at(9), agent: { name: 'Pat', kind: 'person' }, body: 'a person asks', reply_count: 3, replies_cursor: 'C2',
    replies: [comment({ id: CID(3), parent_id: CID(2), created_at: at(9, 5), agent: { name: 'Bo' } }), comment({ id: CID(4), parent_id: CID(2), created_at: at(9, 10), agent: { name: 'Cy' } })] }),
  comment({ id: CID(1), created_at: at(8), agent: { name: 'Ann' }, body: 'ann asks' })];
  const replyPages = { [CID(2)]: [own] };
  const latest = { 1: { id: CID(5), created_at: at(9, 30), agent: { name: 'own7811-writes' } } };
  const urls = serve({ listed: range(0, 12), latest, threads: { 1: thread }, replyPages });
  const r = await cr.readReplies('Own7811', { now: NOW });
  assert.ok(threadReads(urls).includes(1), 'the older post was not read for its newest reply');
  assert.match(r.text, /ann asks/, 'a comment owed before the agent\'s own reply was not listed');
  const again = serve({ listed: range(0, 12), latest, threads: { 1: thread }, replyPages });
  await cr.readReplies('Own7811', { now: NOW + 1000 });
  assert.ok(!threadReads(again).includes(1), 'an older post whose newest reply is the agent\'s own, read once, was read again');
});

test('a held mark on an older post is looked at again, though its newest reply is already seen', async () => {
  clearSeen();
  writeSendState('Hold7811', 12);
  const latest = { 1: { id: CID(2), created_at: at(9), agent: { name: 'Ann' } } };
  const threads = { 1: [comment({ id: CID(2), created_at: at(9) })] };
  serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Hold7811', { now: NOW });
  const quiet = serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Hold7811', { now: NOW + 500 });
  assert.ok(!threadReads(quiet).includes(1), 'CONTROL: with nothing past its mark it is not read');
  const f = path.join(require('./store').ROOT, 'communityread', 'replies-seen', require('node:crypto').createHash('sha256').update('Hold7811').digest('hex') + '.json');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.posts[PID(1)].held = 1;
  fs.writeFileSync(f, JSON.stringify(j));
  const again = serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Hold7811', { now: NOW + 1000 });
  assert.ok(threadReads(again).includes(1), 'a held older post was not read again');
});

test('an older post with no mark and its newest reply before the first look is not read', async () => {
  clearSeen();
  writeSendState('Old27811', 11);
  const urls = serve({ listed: range(0, 11), latest: { 0: { id: CID(1), created_at: '2026-09-20T09:00:00Z' } } });
  await cr.readReplies('Old27811', { now: NOW });
  assert.deepEqual(threadReads(urls), range(1, 11));
  const ctl = serve({ listed: range(0, 11), latest: { 0: { id: CID(1), created_at: '2026-09-28T09:00:00Z' } } });
  clearSeen();
  await cr.readReplies('Old27811', { now: NOW });
  assert.deepEqual(threadReads(ctl), range(0, 11), 'CONTROL: inside the first look it is read');
});

/* Timing-dependent by construction: a real 1200 ms profile against a 50 ms limit, and a 150 ms one against the 1000 ms
   limit (olderStartMs never raises it), an 850 ms margin. */
test('a slow profile leaves the older posts to the next read, and says so', async () => {
  clearSeen();
  writeSendState('Slow7811', 12);
  const urls = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: at(9) } }, slowProfileMs: 1200 });
  const t0 = Date.now();
  aborted = 0;
  const r = await cr.readReplies('Slow7811', { now: NOW, olderStartMs: 50 });
  assert.ok(Date.now() - t0 < 900, 'the read waited for the slow profile: ' + (Date.now() - t0) + ' ms');
  assert.equal(aborted, 1, 'the profile request given up on was not stopped');
  /* The accepted cost: with the profile dropped, the waiting older post gets no first-look floor on this read. */
  assert.equal(JSON.parse(fs.readFileSync(markFile('Slow7811'), 'utf8')).posts[PID(0)], undefined, 'a slow read gave a floor it cannot know about');
  assert.deepEqual(threadReads(urls), range(2, 12));
  assert.match(r.text, /only your newest 10 of 12 posts were looked at: the community was slow to say which of your older posts have new comments, so they wait for a read where it answers in time\)/);
  /* CONTROL: the same slow profile inside the limit, and the older post is read. */
  clearSeen();
  const ok = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: at(9) } }, slowProfileMs: 150 });
  await cr.readReplies('Slow7811', { now: NOW, olderStartMs: 5000 });
  assert.deepEqual(threadReads(ok), [0].concat(range(2, 12)));
});

test('the nudge\'s count and the read take the same 5 when more are active', async () => {
  clearSeen();
  writeSendState('Same7811', 18);
  const latest = {};
  const threads = {};
  for (let i = 0; i < 8; i += 1) { latest[i] = { id: CID(i + 1), created_at: at(i, 30) }; threads[i] = [comment({ id: CID(i + 1), created_at: at(i, 30) })]; }
  serve({ listed: range(0, 18), latest, threads });
  const f = await cr.freshReplies('Same7811', { now: NOW, paceMs: 0 });
  assert.equal(f.ok, true, f.because);
  const counted = f.posts.map((p) => p.remoteId).sort();
  const urls = serve({ listed: range(0, 18), latest, threads });
  await cr.readReplies('Same7811', { now: NOW });
  const read = threadReads(urls).filter((i) => i < 8).map(PID).sort();   // the newest 10 are 8..17
  assert.deepEqual(counted, read, 'the count and the read took different older posts');
  assert.equal(read.length, 5);
});

test('a profile that fails pass after pass stops holding the nudge\'s count: after three, the newest are counted', async () => {
  clearSeen();
  writeSendState('Down7811', 11);
  serve({ listed: [], profile: 503, threads: { 1: [comment({ id: CID(1) })] } });
  for (let k = 0; k < 2; k += 1) assert.equal((await cr.freshReplies('Down7811', { now: NOW, paceMs: 0 })).partial, true, 'pass ' + (k + 1));
  const third = await cr.freshReplies('Down7811', { now: NOW, paceMs: 0 });
  assert.equal(third.ok, true, third.because);
  assert.deepEqual(third.posts.map((p) => p.remoteId), [PID(1)]);
});

const markFile = (name) => path.join(require('./store').ROOT, 'communityread', 'replies-seen', require('node:crypto').createHash('sha256').update(name).digest('hex') + '.json');

test('items the read\'s cap held back on an older post are read next time, though the agent\'s own reply there is newest', async () => {
  clearSeen();
  writeSendState('Cap7811', 12);
  /* Post 0 (older): the agent's own reply at 9:00 is newest, Ann's A2 at 8:00 and A1 at 0:30. The 10 newest posts hold
     30 items between them, so the read's cap of 30 shows A1 and holds A2 back. */
  const C = (k) => 'c0000000-0000-4000-8000-000000000' + String(k).padStart(3, '0');
  const threads = { 0: [comment({ id: C(900), created_at: at(9), agent: { name: 'cap7811-writes' }, body: 'my own' }),
    comment({ id: C(800), created_at: at(8), body: 'A2 held back' }), comment({ id: C(100), created_at: at(0, 30), body: 'A1 first' })] };
  let n = 1;
  for (let i = 2; i < 12; i += 1) threads[i] = [0, 1, 2].map((k) => comment({ id: C(n++), created_at: at(1, i * 3 + k), body: 'p' + i }));
  const latest = { 0: { id: C(900), created_at: at(9), agent: { name: 'cap7811-writes' } } };
  for (let i = 2; i < 12; i += 1) latest[i] = { id: threads[i][2].id, created_at: threads[i][2].created_at };
  serve({ listed: range(0, 12), latest, threads });
  const r1 = await cr.readReplies('Cap7811', { now: NOW });
  assert.match(r1.text, /A1 first/);
  assert.doesNotMatch(r1.text, /A2 held back/, 'the precondition: the cap held A2 back');
  const urls = serve({ listed: range(0, 12), latest, threads });
  const r2 = await cr.readReplies('Cap7811', { now: NOW + 1000 });
  assert.ok(threadReads(urls).includes(0), 'the older post was not read again for what the cap held back');
  assert.match(r2.text, /A2 held back/);
});

test('a hold that has reached MARK_HOLD_MAX no longer takes an older slot', async () => {
  clearSeen();
  writeSendState('Max7811', 12);
  const latest = { 1: { id: CID(2), created_at: at(9), agent: { name: 'Ann' } } };
  const threads = { 1: [comment({ id: CID(2), created_at: at(9) })] };
  serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Max7811', { now: NOW });
  const j = JSON.parse(fs.readFileSync(markFile('Max7811'), 'utf8'));
  j.posts[PID(1)].held = 3;   // MARK_HOLD_MAX
  fs.writeFileSync(markFile('Max7811'), JSON.stringify(j));
  const urls = serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Max7811', { now: NOW + 1000 });
  assert.ok(!threadReads(urls).includes(1), 'a post whose hold is spent was read again');
});

test('an older post with something new but not read this time gets its first-look floor', async () => {
  clearSeen();
  writeSendState('Flo7811', 18);   // newest 10 are 8..17; older 0..7 all active, so 3 of them wait
  const latest = {};
  for (let i = 0; i < 8; i += 1) latest[i] = { id: CID(i + 1), created_at: at(i, 30) };
  const urls = serve({ listed: range(0, 18), latest });
  await cr.readReplies('Flo7811', { now: NOW });
  assert.ok(!threadReads(urls).includes(0), 'the precondition: post 0 waited');
  const j = JSON.parse(fs.readFileSync(markFile('Flo7811'), 'utf8'));
  assert.ok(j.posts[PID(0)], 'the waiting older post got no floor');
  assert.equal(j.posts[PID(0)].at, NOW - 7 * 24 * 3600 * 1000);
});

test('a profile 429 sends no round-2 pages in the read, and stops the nudge\'s count', async () => {
  clearSeen();
  writeSendState('Lim7811', 12);
  const threads = { 5: [comment({ id: CID(1), reply_count: 4, replies_cursor: 'C1', replies: [] })] };
  const urls = serve({ listed: [], profile: 429, threads });
  await cr.readReplies('Lim7811', { now: NOW });
  assert.equal(urls.filter((u) => u.includes('/replies')).length, 0, 'round 2 paged a service that is limiting');
  const ctl = serve({ listed: range(0, 12), threads });
  clearSeen();
  await cr.readReplies('Lim7811', { now: NOW });
  assert.ok(ctl.some((u) => u.includes('/replies')), 'CONTROL: with the profile answering, round 2 pages');
  serve({ listed: [], profile: 429 });
  const f = await cr.freshReplies('Lim7811', { now: NOW, paceMs: 0 });
  assert.equal(f.stop, true);
});

test('an agent with no stored name reads and counts its newest only', async () => {
  clearSeen();
  writeSendState('Nam7811', 12);
  fs.writeFileSync(cs._paths.keysFile(), JSON.stringify({}));
  const urls = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: at(9) } } });
  const r = await cr.readReplies('Nam7811', { now: NOW });
  assert.equal(urls.filter((u) => u.includes('/agents/by-name/')).length, 0);
  assert.deepEqual(threadReads(urls), range(2, 12));
  assert.match(r.text, /Kosmos does not know your community name yet, so your older posts were not checked\)/);
  const before = urls.length;
  const f = await cr.freshReplies('Nam7811', { now: NOW, paceMs: 0 });
  assert.equal(f.ok, true, f.because);
  const counted = urls.slice(before);
  assert.equal(counted.filter((u) => u.includes('/agents/by-name/')).length, 0, 'the count asked for a profile with no name');
  assert.deepEqual(threadReads(counted), range(2, 12), 'the count took older posts with no name');
});

test('a saved thread place on an older post is looked at again, until it has waited MARK_HOLD_MAX reads', async () => {
  clearSeen();
  writeSendState('Plc7811', 12);
  const latest = { 1: { id: CID(2), created_at: at(9), agent: { name: 'Ann' } } };
  const threads = { 1: [comment({ id: CID(2), created_at: at(9) })] };
  serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Plc7811', { now: NOW });
  const setPlace = (waited) => {
    const j = JSON.parse(fs.readFileSync(markFile('Plc7811'), 'utf8'));
    j.posts[PID(1)].threads = { [CID(2)]: { cursor: 'K1', pos: 2, at: Date.parse(at(9)), id: CID(2), waited } };
    fs.writeFileSync(markFile('Plc7811'), JSON.stringify(j));
  };
  setPlace(0);
  const yes = serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Plc7811', { now: NOW + 1000 });
  assert.ok(threadReads(yes).includes(1), 'an older post with a saved place was not read again');
  setPlace(3);
  const no = serve({ listed: range(0, 12), latest, threads });
  await cr.readReplies('Plc7811', { now: NOW + 2000 });
  assert.ok(!threadReads(no).includes(1), 'CONTROL: a place that has waited MARK_HOLD_MAX reads no longer takes a slot');
});

test('the nudge\'s count leaves the older posts for later on a slow profile, as the read does', async () => {
  clearSeen();
  writeSendState('Slc7811', 12);
  const urls = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: at(9) } }, threads: { 0: [comment({ id: CID(1) })] }, slowProfileMs: 150 });
  /* As a profile that failed: partial twice (the read a minute later may take them), then the newest only. */
  for (let k = 0; k < 2; k += 1) assert.equal((await cr.freshReplies('Slc7811', { now: NOW, paceMs: 0, olderStartMs: 50 })).partial, true, 'pass ' + (k + 1));
  const f = await cr.freshReplies('Slc7811', { now: NOW, paceMs: 0, olderStartMs: 50 });
  assert.equal(f.ok, true, f.because);
  assert.ok(!threadReads(urls).includes(0), 'the count read an older post the read would leave');
  const ok = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: at(9) } }, threads: { 0: [comment({ id: CID(1) })] }, slowProfileMs: 150 });
  await cr.freshReplies('Slc7811', { now: NOW, paceMs: 0 });
  assert.ok(threadReads(ok).includes(0), 'CONTROL: inside the limit the count takes it');
});

test('an older post with two sent records is read once', async () => {
  clearSeen();
  writeSendState('Dup7811', 12);
  const p = cs._paths;
  const sent = JSON.parse(fs.readFileSync(p.sentFile(), 'utf8'));
  sent.dup = { ...sent.p0, sentAt: '2026-09-30T00:30:00Z' };   // a second record of post 0, still older than the newest 10
  fs.writeFileSync(p.sentFile(), JSON.stringify(sent));
  const urls = serve({ listed: range(0, 12), latest: { 0: { id: CID(1), created_at: at(9) } } });
  await cr.readReplies('Dup7811', { now: NOW });
  assert.equal(threadReads(urls).filter((i) => i === 0).length, 1, 'the post was read twice');
});

/* The own-reply guard (communityread.js, the mark-writing loop) keeps the agent's own items as seen only on a post read
   whole. Here a failed replies page leaves the post unfinished, so the agent's own newest reply, fetched on another
   comment's replies page, is never kept as seen, and the post is taken again after the hold that promised it runs out. */
test('an older post left unfinished by a failed page is taken again after its hold runs out, for its own unjudged reply', async () => {
  clearSeen();
  writeSendState('Grd7811', 12);
  const C = (k) => 'c0000000-0000-4000-8000-000000000' + String(k).padStart(3, '0');
  /* Comment A's third reply is the agent's own, on its replies page (round 2), so it is never in round 1's preview;
     comment B's replies page fails every time, so the post is never read whole. */
  const kid = (id, parent, t, name) => comment({ id, parent_id: parent, created_at: t, agent: { name } });
  const thread = [
    comment({ id: C(1), created_at: at(8), agent: { name: 'Ann' }, reply_count: 3, replies_cursor: 'CA', replies: [kid(C(2), C(1), at(8, 5), 'Bo'), kid(C(3), C(1), at(8, 10), 'Cy')] }),
    comment({ id: C(4), created_at: at(7), agent: { name: 'Dee' }, reply_count: 3, replies_cursor: 'CB', replies: [kid(C(5), C(4), at(7, 5), 'Eve'), kid(C(6), C(4), at(7, 10), 'Fay')] }),
  ];
  const replyPages = { [C(1)]: [kid(C(7), C(1), at(9, 30), 'grd7811-writes')], [C(4)]: 'fail' };
  const latest = { 1: { id: C(7), created_at: at(9, 30), agent: { name: 'grd7811-writes' } } };
  for (let k = 0; k < 3; k += 1) {
    const urls = serve({ listed: range(0, 12), latest, threads: { 1: thread }, replyPages });
    await cr.readReplies('Grd7811', { now: NOW + k * 1000 });
    assert.ok(threadReads(urls).includes(1), 'read ' + (k + 1) + ' did not take the post (the hold promised it)');
    if (k === 0) {
      assert.ok(urls.some((u) => u.includes('/comments/' + C(1) + '/replies')), 'the precondition: the own reply\'s page was fetched');
      assert.ok(urls.some((u) => u.includes('/comments/' + C(4) + '/replies')), 'the precondition: the failing page was asked for');
    }
  }
  /* The precondition, before read 4 decides: the hold has run out and no longer promises a look by itself. */
  const marks = JSON.parse(fs.readFileSync(markFile('Grd7811'), 'utf8')).posts;
  assert.equal(marks[PID(1)].held, 3, 'the precondition: the hold has reached MARK_HOLD_MAX');
  const own = { posts: [], total: 1, all: new Set([PID(1)]), older: [{ remoteId: PID(1), sentAt: '' }] };
  const quiet = cr.postsToRead(own, { marks, activity: { map: new Map([[PID(1), null]]) }, firstLook: NOW - 7 * 24 * 3600 * 1000 });
  assert.deepEqual(quiet.posts, [], 'the precondition: with nothing new, the spent hold alone still takes the post');
  const last = serve({ listed: range(0, 12), latest, threads: { 1: thread }, replyPages });
  await cr.readReplies('Grd7811', { now: NOW + 3000 });
  assert.ok(threadReads(last).includes(1), 'the post was dropped once its hold ran out, though its own reply was never judged seen');
});
