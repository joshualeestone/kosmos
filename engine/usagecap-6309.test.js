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

test('a bounded first count says it is not complete, catches up over later calls, and is never memoised short', () => {
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

  usagecap.resetForTests({ perCallBytes: 200 });
  assert.equal(usagecap.capInForce(NOW).complete, false, 'CONTROL: the first count is short');
  let last;
  for (let i = 0; i < 20; i++) { last = usagecap.capInForce(NOW + i); if (last.complete) break; }
  assert.equal(last.used, 123, 'a short count is not kept for a minute: the next calls catch up');
  usagecap.resetForTests();
});

test('capAllows throws on a damaged policy record, as quietAllows does, so the gate decides', () => {
  fs.mkdirSync(path.dirname(orgpolicy.APPLIED()), { recursive: true });
  fs.writeFileSync(orgpolicy.APPLIED(), '{ not json');
  usagecap.resetForTests();
  assert.throws(() => usagecap.capAllows(NOW));
});
