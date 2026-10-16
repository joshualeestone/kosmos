'use strict';

/**
 * kosmos#6309: this month's tokens for a family's usage cap (engine/usagecap.js). Every Claude transcript and its
 * helpers' files count, each message once by its id, from the 1st of the month in the cap's zone; the count keeps its
 * own cache, so the swarm's daily meter reading the same file is unchanged by it.
 *
 *   node --test engine/usagecap-6309.test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOTS = [];
const tmp = (p) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), p)); ROOTS.push(d); return d; };
process.env.AGENT_WORKFORCE_DATA = tmp('aw-usecap-data-');
process.env.AGENT_WORKFORCE_TUNNEL_STATE = tmp('aw-usecap-tunnel-');
process.env.HOME = tmp('aw-usecap-home-');
const CONFIG = tmp('aw-usecap-config-');
process.env.AGENT_WORKFORCE_CONFIG_ROOT = CONFIG;
test.after(() => { for (const d of ROOTS) fs.rmSync(d, { recursive: true, force: true }); });

const swarm = require('./swarm');
const orgpolicy = require('./orgpolicy');
const usagecap = require('./usagecap');

const NOW = Date.UTC(2026, 9, 16, 12);             // 16 October 2026, noon UTC
const OCT1 = Date.UTC(2026, 9, 1);
const iso = (ms) => new Date(ms).toISOString();
const line = (id, at, n) => JSON.stringify({
  type: 'assistant', timestamp: iso(at),
  message: { id, stop_reason: 'end_turn', usage: { input_tokens: n, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } },
}) + '\n';

/* One root with a session file, its helper's file, a non-transcript file and a file last touched last month. */
function seed(root) {
  const dir = path.join(root, 'projects', 'p1');
  fs.mkdirSync(path.join(dir, 's1', 'subagents'), { recursive: true });
  const main = path.join(dir, 's1.jsonl');
  // m1 is written as three content blocks, one line each: it counts once. m0 is from September: it counts nothing.
  fs.writeFileSync(main, line('m0', OCT1 - 1000, 7000) + line('m1', OCT1 + 1000, 100) + line('m1', OCT1 + 1000, 100)
    + line('m1', OCT1 + 1000, 100) + line('m2', NOW - 60_000, 20));
  fs.writeFileSync(path.join(dir, 's1', 'subagents', 'h1.jsonl'), line('h1', NOW - 120_000, 3));
  fs.writeFileSync(path.join(dir, 'notes.txt'), line('x1', NOW - 1000, 50000));
  const old = path.join(dir, 's0.jsonl');
  fs.writeFileSync(old, line('o1', NOW - 1000, 90000));            // a lying timestamp in a file untouched since September
  fs.utimesSync(old, (OCT1 - 5000) / 1000, (OCT1 - 5000) / 1000);
  for (const f of [main, path.join(dir, 's1', 'subagents', 'h1.jsonl')]) fs.utimesSync(f, (NOW - 1000) / 1000, (NOW - 1000) / 1000);
  return main;
}

test('the month counts each message once, helpers included, nothing from before the 1st or outside a transcript', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-r1-');
  seed(root);
  const m = usagecap.monthTokens('UTC', NOW, [root]);
  assert.deepEqual(m, { tokens: 123, complete: true, since: OCT1 });
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 123, 'a second count adds nothing it already counted');
  assert.equal(usagecap.monthTokens('America/Chicago', NOW, [tmp('aw-usecap-empty-')]).tokens, 0, 'no transcripts is zero');
});

test('the month in the cap zone: Chicago starts 5 hours after UTC, so a line between the two counts only in UTC', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-tz-');
  const dir = path.join(root, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.jsonl'), line('a', OCT1 + 60 * 60 * 1000, 40) + line('b', NOW - 1000, 2));
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 42, 'CONTROL: UTC counts both');
  usagecap.resetForTests();
  assert.equal(usagecap.monthTokens('America/Chicago', NOW, [root]).tokens, 2);
});

test('a new month starts again at zero, and counts what is written after the 1st', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-roll-');
  const main = seed(root);
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 123, 'CONTROL: October');
  const NOV2 = Date.UTC(2026, 10, 2);
  fs.appendFileSync(main, line('n1', NOV2 - 1000, 9));
  fs.utimesSync(main, NOV2 / 1000, NOV2 / 1000);
  assert.deepEqual(usagecap.monthTokens('UTC', NOV2, [root]), { tokens: 9, complete: true, since: Date.UTC(2026, 10, 1) });
});

test('a zone whose month starts earlier counts the lines already passed (the cache reads the file again)', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-tzmove-');
  const dir = path.join(root, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  // 2 hours after the UTC month began: before Chicago's (5 hours later), after Tokyo's (9 hours earlier).
  fs.writeFileSync(path.join(dir, 'a.jsonl'), line('a', OCT1 + 2 * 60 * 60 * 1000, 40) + line('b', NOW - 1000, 2));
  assert.equal(usagecap.monthTokens('America/Chicago', NOW, [root]).tokens, 2, 'CONTROL: Chicago\'s month has only b');
  assert.equal(usagecap.monthTokens('Asia/Tokyo', NOW, [root]).tokens, 42, 'a cap moved to an earlier zone lost the lines already read');
});

test('swarm.readFile reads a file again when `since` moves earlier (a day start after a zone change)', () => {
  const root = tmp('aw-usecap-earlier-');
  const main = seed(root);
  const c = new Map();
  assert.equal(swarm.readFile(main, NOW - 3600e3, NOW, undefined, c).tokens, 20, 'CONTROL: the last hour has only m2');
  assert.equal(swarm.readFile(main, OCT1, NOW, undefined, c).tokens, 120, 'an earlier start kept its read position and lost m1');
});

test('a message copied into a second file (a resumed or forked session) counts once in the month', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-fork-');
  const dir = path.join(root, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.jsonl'), line('m1', NOW - 5000, 100) + line('m2', NOW - 4000, 7));
  fs.writeFileSync(path.join(dir, 'b.jsonl'), line('m1', NOW - 5000, 100) + line('m3', NOW - 1000, 5));   // b resumed a
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 112, 'a copied message was counted twice');
  usagecap.resetForTests();
});

test('a transcript rewritten shorter mid-month is counted again, its messages not lost to the shared set', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-rewrite-');
  const dir = path.join(root, 'projects', 'p');
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'a.jsonl');
  fs.writeFileSync(f, line('m1', NOW - 5000, 100) + line('m2', NOW - 4000, 7));
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 107, 'CONTROL');
  fs.writeFileSync(f, line('m1', NOW - 5000, 100));   // rewritten shorter
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 100, 'a rewritten file\'s messages were skipped as already seen');
  usagecap.resetForTests();
});

test('a session untouched this month: its helpers\' folder is not read (old sessions are most of a computer)', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-oldsub-');
  const dir = path.join(root, 'projects', 'p');
  fs.mkdirSync(path.join(dir, 'old', 'subagents'), { recursive: true });
  const old = path.join(dir, 'old.jsonl');
  fs.writeFileSync(old, line('o', OCT1 - 1e6, 1));
  fs.utimesSync(old, (OCT1 - 1e6) / 1000, (OCT1 - 1e6) / 1000);
  fs.writeFileSync(path.join(dir, 'old', 'subagents', 'h.jsonl'), line('h', NOW - 1000, 9));
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 0, 'an old session\'s helpers\' folder was listed');
  fs.utimesSync(old, NOW / 1000, NOW / 1000);
  usagecap.resetForTests();
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 9, 'CONTROL: a session written this month has its helpers read');
  usagecap.resetForTests();
});

test('a caller\'s own cache is never swept per read (a month can hold every transcript; sweeping each read is quadratic)', () => {
  const root = tmp('aw-usecap-sweep-');
  const main = seed(root);
  const mine = new Map();
  for (let i = 0; i < 300; i++) mine.set('/old/' + i, { touched: 0 });     // 300 entries untouched for a long time
  swarm.readFile(main, OCT1, NOW, undefined, mine);
  assert.equal(mine.size, 301, 'a caller\'s cache was swept');
});

test('the swarm daily count on the same file is unchanged by a month count (the month keeps its own cache)', () => {
  usagecap.resetForTests();
  swarm.resetForTests();
  const root = tmp('aw-usecap-swarm-');
  const main = seed(root);
  const day = Date.UTC(2026, 9, 16);
  const before = swarm.readFile(main, day, NOW).tokens;
  assert.equal(before, 20, 'CONTROL: today has only m2');
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 123);
  assert.equal(swarm.readFile(main, day, NOW).tokens, before, 'the day count after a month count');
  assert.equal(usagecap.monthTokens('UTC', NOW, [root]).tokens, 123, 'the month count after a day count');
});

test('a bounded first count says it is not complete and catches up over later calls', () => {
  const root = tmp('aw-usecap-slow-');
  seed(root);
  usagecap.resetForTests({ perCallBytes: 200 });
  const first = usagecap.monthTokens('UTC', NOW, [root]);
  assert.equal(first.complete, false);
  assert.ok(first.tokens < 123, `a partial count: ${first.tokens}`);
  let m = first;
  for (let i = 0; i < 20 && !m.complete; i++) m = usagecap.monthTokens('UTC', NOW, [root]);
  assert.deepEqual(m, { tokens: 123, complete: true, since: OCT1 });
});

/* The policy in force comes from a signed bundle, as orgpolicy.refresh applies it. */
const coordinator = crypto.generateKeyPairSync('ed25519');
const PINNED = coordinator.publicKey.export({ format: 'jwk' }).x;
let version = 0;
function apply(policy) {
  version += 1;
  const secs = Math.floor(NOW / 1000);
  const body = 'KST1.' + Buffer.from(JSON.stringify({ typ: 'org_policy', v: 1, org: 'org-1', version, iat: secs - 10, exp: secs + 86400, policy })).toString('base64url');
  fs.writeFileSync(orgpolicy.BUNDLE(), body + '.' + crypto.sign(null, Buffer.from(body, 'ascii'), coordinator.privateKey).toString('base64url'));
  const r = orgpolicy.refresh({ now: secs, pinned: PINNED });
  assert.equal(r.refused, null, 'CONTROL: the bundle applies');
}

test('capAllows: open with no cap or under it, refused at it with the policy sentence; an incomplete count is recounted', () => {
  fs.rmSync(path.join(CONFIG, 'projects'), { recursive: true, force: true });
  seed(CONFIG);                                                      // 123 tokens this month
  usagecap.resetForTests();
  assert.deepEqual(usagecap.capAllows(NOW), { ok: true }, 'no policy: open');

  apply({ usage_cap: { monthly_tokens: 1000, warn_pct: 10, tz: 'UTC' } });
  usagecap.resetForTests();
  const c = usagecap.capInForce(NOW);
  assert.equal(c.used, 123);
  assert.equal(c.warn, true, '12 percent is past a 10 percent heads-up');
  assert.deepEqual(usagecap.capAllows(NOW), { ok: true }, 'under the cap: open');

  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'UTC' } });
  const no = usagecap.capAllows(NOW + 1);
  assert.equal(no.ok, false, 'the memo is keyed on the cap, so a lower cap is read at once');
  assert.match(no.because, /123 of 100 tokens/);
  assert.match(no.because, /opens again on the 1st \(UTC time\)/);

  // A board restart: the cache is gone, the month's saved count is not. The short count never reads below it.
  usagecap.resetForTests({ perCallBytes: 200, keepFloor: true });
  const short = usagecap.capInForce(NOW);
  assert.equal(short.complete, false, 'CONTROL: the first count after a restart is short');
  assert.equal(short.used, 123, 'a restart under-counted the month while catching up');
  assert.equal(usagecap.capAllows(NOW).ok, false, 'a restart let a child over the cap message again');
  assert.equal(usagecap.capInForce(NOW + 1).complete, false, 'a short count is kept a moment, not recounted per message');
  let last;
  for (let i = 1; i <= 20; i++) { last = usagecap.capInForce(NOW + i * usagecap.MEMO_SHORT_MS); if (last.complete) break; }
  assert.deepEqual([last.used, last.complete], [123, true], 'the count did not catch up over later calls');
  usagecap.resetForTests({ perCallBytes: 200 });
  assert.ok(usagecap.capInForce(NOW).used < 123, 'CONTROL: with no saved count the first count is short');
  // A zone change mid-month after a restart: the saved count is still this month's, so it stays the floor.
  usagecap.resetForTests();
  assert.equal(usagecap.capInForce(NOW).used, 123, 'CONTROL: a full count saved under UTC');
  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'Asia/Tokyo' } });
  usagecap.resetForTests({ perCallBytes: 200, keepFloor: true });
  const moved = usagecap.capInForce(NOW);
  assert.equal(moved.complete, false, 'CONTROL: the new zone\'s first count is short');
  assert.ok(moved.used >= 123, `a zone change reopened the cap while the count caught up: ${moved.used}`);
  // A move to a zone whose month starts LATER (Chicago, 5 hours after UTC): once the new count is full it replaces the
  // UTC one, which held 100 tokens from before Chicago's month began.
  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'UTC' } });
  usagecap.resetForTests();
  assert.equal(usagecap.capInForce(NOW).used, 123, 'CONTROL: the UTC month');
  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'America/Chicago' } });
  usagecap.resetForTests({ perCallBytes: 200, keepFloor: true });
  assert.ok(usagecap.capInForce(NOW).used >= 123, 'CONTROL: while Chicago\'s count catches up, the UTC count holds the cap up');
  let full;
  for (let i = 1; i <= 20; i++) { full = usagecap.capInForce(NOW + i * usagecap.MEMO_SHORT_MS); if (full.complete) break; }
  assert.deepEqual([full.complete, full.used], [true, 23], 'a later zone kept the earlier zone\'s hours for the rest of the month');
  // The same move with the board running (no restart, the cache kept): the count is not zeroed and saved as the floor.
  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'UTC' } });
  usagecap.resetForTests();
  assert.equal(usagecap.capInForce(NOW).used, 123, 'CONTROL: the UTC month, cache warm');
  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'America/Chicago' } });
  const warm = usagecap.capInForce(NOW + 1);
  assert.deepEqual([warm.complete, warm.used, warm.over], [true, 23, false], 'a running board zeroed the month on a move to a later zone');
  assert.equal(usagecap.capInForce(NOW + usagecap.MEMO_MS + 2).used, 23, 'and saved that as the floor');
  // A new month does not inherit last month's count: November's own first count is short, and stays below October's.
  const NOV2 = Date.UTC(2026, 10, 2);
  const nov = path.join(CONFIG, 'projects', 'p1', 'nov.jsonl');
  fs.writeFileSync(nov, [1, 2, 3, 4, 5].map((i) => line('n' + i, NOV2 - i * 1000, 10)).join(''));
  fs.utimesSync(nov, NOV2 / 1000, NOV2 / 1000);
  usagecap.resetForTests({ perCallBytes: 200, keepFloor: true });
  const november = usagecap.capInForce(NOV2);
  assert.equal(november.complete, false, 'CONTROL: November\'s first count is short');
  assert.ok(november.used < 123, `November inherited October's count: ${november.used}`);
  usagecap.resetForTests();
});

test('past the heads-up the count is kept only a moment, so crossing the cap refuses within MEMO_SHORT_MS', () => {
  fs.rmSync(path.join(CONFIG, 'projects'), { recursive: true, force: true });
  const main = seed(CONFIG);                                         // 123 tokens
  apply({ usage_cap: { monthly_tokens: 140, warn_pct: 80, tz: 'UTC' } });
  usagecap.resetForTests();
  const near = usagecap.capInForce(NOW);
  assert.deepEqual([near.warn, near.over], [true, false], 'CONTROL: past the heads-up, under the cap');
  fs.appendFileSync(main, line('m9', NOW - 500, 50));
  fs.utimesSync(main, NOW / 1000, NOW / 1000);
  assert.equal(usagecap.capInForce(NOW + 1000).over, false, 'CONTROL: within the short memo the old count stands');
  assert.equal(usagecap.capAllows(NOW + usagecap.MEMO_SHORT_MS + 1000).ok, false, 'crossing the cap near it was not refused within the short memo');
  // Far below the heads-up the minute's memo stands, so the short one is what the heads-up changes.
  apply({ usage_cap: { monthly_tokens: 100000, warn_pct: 80, tz: 'UTC' } });
  usagecap.resetForTests();
  const low = usagecap.capInForce(NOW);
  fs.appendFileSync(main, line('m10', NOW - 400, 50));
  fs.utimesSync(main, NOW / 1000, NOW / 1000);
  assert.equal(usagecap.capInForce(NOW + usagecap.MEMO_SHORT_MS + 1000).used, low.used, 'CONTROL: far from the cap the minute memo holds');
  usagecap.resetForTests();
});

test('deleting a transcript after a full count does not lower the month (tokens used cannot be un-used)', () => {
  usagecap.resetForTests();
  const root = tmp('aw-usecap-del-');
  const main = seed(root);
  const policy = { usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'UTC' } };
  assert.equal(usagecap.capNow(policy, NOW, [root]).used, 123, 'CONTROL: the full count');
  fs.rmSync(main);
  usagecap.resetForTests({ keepFloor: true });
  const after = usagecap.capNow(policy, NOW, [root]);
  assert.equal(after.complete, true, 'CONTROL: the recount finished');
  assert.deepEqual([after.used, after.over], [123, true], 'a deleted transcript reopened the cap');
  usagecap.resetForTests();
  assert.ok(usagecap.capNow(policy, NOW, [root]).used < 123, 'CONTROL: with no saved count the deletion does lower the count');
  usagecap.resetForTests();
  const monthRoot = tmp('aw-usecap-month-');
  seed(monthRoot);
  // The month it names (relay review: a count carried into November must not read as November's).
  assert.equal(usagecap.capNow(policy, NOW, [monthRoot]).month, '2026-10');
  assert.equal(usagecap.capNow({ usage_cap: { ...policy.usage_cap, tz: 'Pacific/Kiritimati' } }, NOW, [monthRoot]).month, '2026-10', 'UTC+14: the 1st starts on Sep 30 in UTC');
  assert.equal(usagecap.capNow({ usage_cap: { ...policy.usage_cap, tz: 'Etc/GMT+12' } }, Date.UTC(2026, 10, 1, 11), [monthRoot]).month, '2026-10', 'UTC-12: still October at 11:00 UTC on Nov 1');
  usagecap.resetForTests();
});

test('on the board the gate never counts: a worker thread does, and the gate reads its count', async () => {
  fs.rmSync(path.join(CONFIG, 'projects'), { recursive: true, force: true });
  const dir = path.join(CONFIG, 'projects', 'live');
  fs.mkdirSync(dir, { recursive: true });
  // The worker counts on the real clock: a line from now, never before this UTC month began.
  const now = Date.now();
  const at = Math.max(now - 60e3, Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1));
  fs.writeFileSync(path.join(dir, 's.jsonl'), line('w1', at, 150));
  apply({ usage_cap: { monthly_tokens: 100, warn_pct: 80, tz: 'UTC' } });
  usagecap.resetForTests({ worker: true });
  const first = usagecap.capInForce(Date.now());
  assert.deepEqual([first.used, first.complete, first.known], [0, false, false],
    'the gate counted inline: the message path read the transcripts itself');
  assert.equal(usagecap.capAllows(Date.now()).ok, true, 'CONTROL: before the worker has counted, a new board is open (a known limit)');
  const until = Date.now() + 10000;
  while (!(usagecap.latestForTests() && usagecap.latestForTests().complete) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  assert.ok(usagecap.latestForTests(), 'the worker never posted a count');
  const c = usagecap.capInForce(Date.now());
  assert.deepEqual([c.used, c.over], [150, true], JSON.stringify(c));
  assert.equal(usagecap.capAllows(Date.now()).ok, false, 'the worker\'s count did not reach the gate');
  assert.equal(usagecap.capReport(orgpolicy.currentStrict(), Date.now()).used, 150, 'the rollup reads the worker\'s count too');
  // A process that is not the board starts no counter: it reads the saved count (150, saved by the board above).
  usagecap.resetForTests({ worker: true, board: false, keepFloor: true });
  const elsewhere = usagecap.capInForce(Date.now());
  assert.deepEqual([elsewhere.used, elsewhere.known], [150, true], 'CONTROL: the saved count');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(usagecap.latestForTests(), null, 'a process that is not the board started a counter');
  usagecap.resetForTests({ worker: true, keepFloor: true });
  usagecap.capInForce(Date.now());
  // The cap taken out: the worker stops and its count goes.
  apply({ quiet_hours: null });
  assert.deepEqual(usagecap.capInForce(Date.now()), { capped: false });
  assert.equal(usagecap.latestForTests(), null, 'a board with no cap kept its counter');
  usagecap.resetForTests();
  fs.rmSync(path.join(CONFIG, 'projects'), { recursive: true, force: true });
});

test('capAllows throws on a damaged policy record, as quietAllows does, so the gate decides', () => {
  fs.mkdirSync(path.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), '{ not json');
  usagecap.resetForTests();
  assert.throws(() => usagecap.capAllows(NOW));
});
