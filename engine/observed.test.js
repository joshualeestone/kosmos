'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const observed = require('./observed');

const { OK, REJECTED } = observed.OUTCOME;
const { ANTHROPIC, OPENAI } = observed.PROVIDER;

test.beforeEach(() => observed._clearForTest());

test('saw records ok and 401, keyed by (provider, agent), with the timestamp given', () => {
  observed.saw(ANTHROPIC, 'aria', OK, 1000);
  observed.saw(ANTHROPIC, 'boss', REJECTED, 2000);
  assert.deepEqual(observed.read(ANTHROPIC, 'aria'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.read(ANTHROPIC, 'boss'), { outcome: REJECTED, at: 2000 });
  // all() surfaces every observation, each carrying its provider.
  const all = observed.all().sort((a, b) => a.agent.localeCompare(b.agent));
  assert.deepEqual(all, [
    { provider: ANTHROPIC, agent: 'aria', outcome: OK, at: 1000 },
    { provider: ANTHROPIC, agent: 'boss', outcome: REJECTED, at: 2000 },
  ]);
});

test('#2413: observations are provider-qualified -- the same agent name never crosses providers', () => {
  // A codex agent on the default home records configDir=null, which accountForAgent
  // USED to map to the DEFAULT CLAUDE account (#2811 gated it). Without the provider in the
  // key, an OpenAI ok for "sub" would be read by the Claude overlay and green a Claude
  // account. Keying by (provider, agent) keeps them separate.
  observed.saw(OPENAI, 'sub', OK, 1000);
  observed.saw(ANTHROPIC, 'sub', REJECTED, 2000);
  assert.deepEqual(observed.read(OPENAI, 'sub'), { outcome: OK, at: 1000 }, 'the openai slot is untouched by the claude write');
  assert.deepEqual(observed.read(ANTHROPIC, 'sub'), { outcome: REJECTED, at: 2000 });
  // Both survive in all(), each tagged with its provider, so each overlay reads only its own.
  const openaiRows = observed.all().filter((o) => o.provider === OPENAI);
  const claudeRows = observed.all().filter((o) => o.provider === ANTHROPIC);
  assert.deepEqual(openaiRows, [{ provider: OPENAI, agent: 'sub', outcome: OK, at: 1000 }]);
  assert.deepEqual(claudeRows, [{ provider: ANTHROPIC, agent: 'sub', outcome: REJECTED, at: 2000 }]);
});

test('an agent name with a space does not collide across providers', () => {
  // "Sonya Blade" is a real agent name; the (provider, agent) join must stay injective.
  observed.saw(OPENAI, 'Sonya Blade', OK, 1000);
  observed.saw(ANTHROPIC, 'Sonya Blade', REJECTED, 2000);
  assert.deepEqual(observed.read(OPENAI, 'Sonya Blade'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.read(ANTHROPIC, 'Sonya Blade'), { outcome: REJECTED, at: 2000 });
});

test('a later qualifying observation overwrites the earlier one', () => {
  observed.saw(ANTHROPIC, 'aria', OK, 1000);
  observed.saw(ANTHROPIC, 'aria', REJECTED, 3000);
  assert.deepEqual(observed.read(ANTHROPIC, 'aria'), { outcome: REJECTED, at: 3000 });
});

test('a non-outcome state does NOT clobber a prior real observation', () => {
  // status.js passes null for idle / needs-you / unknown; saw must ignore it so a
  // prior real observation survives an idle tick (else we manufacture a false green
  // or wipe a real 401).
  observed.saw(ANTHROPIC, 'aria', OK, 1000);
  observed.saw(ANTHROPIC, 'aria', null, 2000);
  observed.saw(ANTHROPIC, 'aria', 'idle', 2500);        // not one of our OUTCOME values
  observed.saw(ANTHROPIC, 'aria', undefined, 2600);
  assert.deepEqual(observed.read(ANTHROPIC, 'aria'), { outcome: OK, at: 1000 }, 'prior ok must survive non-observations');
});

test('saw ignores a missing or empty provider or agent name', () => {
  observed.saw(ANTHROPIC, '', OK, 1000);
  observed.saw(ANTHROPIC, null, OK, 1000);
  observed.saw('', 'aria', OK, 1000);
  observed.saw(null, 'aria', OK, 1000);
  assert.equal(observed.all().length, 0);
});

test('read returns null for an unseen (provider, agent) (never a fabricated shape)', () => {
  assert.equal(observed.read(ANTHROPIC, 'nobody'), null);
  observed.saw(ANTHROPIC, 'aria', OK, 1000);
  assert.equal(observed.read(OPENAI, 'aria'), null, 'the same name on another provider is still unseen');
});

// --- verdict: the whole truth table -------------------------------------------

const FRESH = 60 * 1000;
const NOW = 1_000_000;

test('verdict: a fresh observed 401 shows rejected, EVEN when checkLive says connected (the expired-401 case)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: REJECTED, observedAt: NOW - 5000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'rejected');
  assert.equal(v.ageMs, 5000);
});

test('verdict: a fresh observed ok shows working (green)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: OK, observedAt: NOW - 3000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'working');
  assert.equal(v.ageMs, 3000);
});

test('verdict: a fresh observed ok RESCUES a crashed probe (observed beats predicted)', () => {
  const v = observed.verdict({ checkLiveState: 'unknown', observedOutcome: OK, observedAt: NOW - 3000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'working');
});

test('verdict: a STALE 401 does NOT keep asserting not-connected; it falls back to checkLive', () => {
  // The person may have re-signed-in since. A stale/blind signal must never become
  // a confident negative (server.js:3378). checkLive connected -> signed_in_unverified.
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: REJECTED, observedAt: NOW - (FRESH + 1), now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified');
  assert.equal(v.observedAt, null);
  assert.equal(v.ageMs, null);
});

test('verdict: a STALE ok is not green; checkLive connected -> signed_in_unverified (not a false green)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: OK, observedAt: NOW - (FRESH + 1), now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified');
});

test('verdict: no observation + checkLive connected -> signed_in_unverified (credential exists, not verified)', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: null, observedAt: null, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified');
});

test('verdict: checkLive none -> signed_out', () => {
  const v = observed.verdict({ checkLiveState: 'none', observedOutcome: null, observedAt: null, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_out');
});

test('verdict: checkLive unknown + nothing observed -> unchecked (could not check)', () => {
  const v = observed.verdict({ checkLiveState: 'unknown', observedOutcome: null, observedAt: null, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'unchecked');
});

test('verdict: a future observedAt (clock skew) is not treated as fresh', () => {
  const v = observed.verdict({ checkLiveState: 'connected', observedOutcome: OK, observedAt: NOW + 5000, now: NOW, freshMs: FRESH });
  assert.equal(v.badge, 'signed_in_unverified', 'a negative age must not read as a fresh success');
});

test('freshMs default is 5 minutes and honours the env seam', () => {
  const prev = process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  assert.equal(observed.freshMs(), 5 * 60 * 1000);
  process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = '1000';
  assert.equal(observed.freshMs(), 1000);
  if (prev === undefined) delete process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS;
  else process.env.AGENT_WORKFORCE_OBSERVED_FRESH_MS = prev;
});

/* #3136: the DIR-keyed store for user-initiated "Check now" outcomes. Same
   verdict + freshness path as the agent store; only the key differs (an account's
   resolved config dir, not an agent), because a manual check is account-scoped. */

test('#3136: sawDir records ok/401 keyed by (provider, dir); readDir returns it', () => {
  observed.sawDir(ANTHROPIC, '/home/kitty/.acct-a', OK, 1000);
  observed.sawDir(ANTHROPIC, '/home/kitty/.acct-b', REJECTED, 2000);
  assert.deepEqual(observed.readDir(ANTHROPIC, '/home/kitty/.acct-a'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.readDir(ANTHROPIC, '/home/kitty/.acct-b'), { outcome: REJECTED, at: 2000 });
});

test('#3136: the dir store is provider-qualified -- an OpenAI check never reads on the Claude overlay', () => {
  // The badge overlay for the Claude rows reads readDir(ANTHROPIC, dir); an OpenAI
  // check for the SAME dir string must not resolve there (the isolation saw() rests
  // on, applied to the dir key too). Control: the ANTHROPIC read for that dir is null.
  observed.sawDir(OPENAI, '/shared/dir', OK, 1000);
  assert.equal(observed.readDir(ANTHROPIC, '/shared/dir'), null);
  assert.deepEqual(observed.readDir(OPENAI, '/shared/dir'), { outcome: OK, at: 1000 });
});

test('#3136: sawDir ignores an empty dir, a bad provider, and a non-outcome (prior survives)', () => {
  observed.sawDir(ANTHROPIC, '/home/kitty/.acct', OK, 1000);
  observed.sawDir(ANTHROPIC, '', OK, 2000);              // empty dir -> ignored
  observed.sawDir('nope', '/home/kitty/.acct', OK, 2000); // bad provider -> ignored
  observed.sawDir(ANTHROPIC, '/home/kitty/.acct', 'idle', 2000); // non-outcome -> ignored, prior survives
  // The UNKNOWN a capped/offline check returns is passed as neither OK nor REJECTED,
  // so a prior real OK is NOT clobbered to gray by an inconclusive check.
  assert.deepEqual(observed.readDir(ANTHROPIC, '/home/kitty/.acct'), { outcome: OK, at: 1000 });
});

test('#3136: readDir returns null for an unseen dir and for an empty dir (never a fabricated shape)', () => {
  observed.sawDir(ANTHROPIC, '/home/kitty/.acct', OK, 1000);
  assert.equal(observed.readDir(ANTHROPIC, '/home/kitty/.nope'), null);
  assert.equal(observed.readDir(ANTHROPIC, ''), null);
});

test('#3136: the dir store and the agent store are independent; _clearForTest clears both', () => {
  observed.saw(ANTHROPIC, 'aria', OK, 1000);
  observed.sawDir(ANTHROPIC, '/home/kitty/.acct', REJECTED, 1000);
  // Same provider, and 'aria' is not a dir string: the two stores do not collide.
  assert.deepEqual(observed.read(ANTHROPIC, 'aria'), { outcome: OK, at: 1000 });
  assert.deepEqual(observed.readDir(ANTHROPIC, '/home/kitty/.acct'), { outcome: REJECTED, at: 1000 });
  observed._clearForTest();
  assert.equal(observed.read(ANTHROPIC, 'aria'), null);
  assert.equal(observed.readDir(ANTHROPIC, '/home/kitty/.acct'), null);
});

test('#3136: a fresh dir ok drives verdict to working; a fresh dir 401 to rejected (same verdict path)', () => {
  // readDir feeds the SAME verdict fn the agent store does, so a check-now ok greens
  // and a check-now 401 reddens, both gated by freshness. Control: no dir observation
  // + checkLive connected -> signed_in_unverified (the too-strict state Josh saw).
  // Control: before anything is seeded, readDir returns null and the verdict is the
  // too-strict signed_in_unverified state Josh saw -- so a green below means the seed did it.
  assert.equal(observed.readDir(ANTHROPIC, '/x'), null);
  assert.equal(observed.verdict({ checkLiveState: 'connected', now: 1000, freshMs: 5000 }).badge, 'signed_in_unverified');
  observed.sawDir(ANTHROPIC, '/x', OK, 1000);
  const o = observed.readDir(ANTHROPIC, '/x');
  assert.equal(observed.verdict({ checkLiveState: 'connected', observedOutcome: o.outcome, observedAt: o.at, now: 1200, freshMs: 5000 }).badge, 'working');
  observed.sawDir(ANTHROPIC, '/x', REJECTED, 2000);
  const r = observed.readDir(ANTHROPIC, '/x');
  assert.equal(observed.verdict({ checkLiveState: 'connected', observedOutcome: r.outcome, observedAt: r.at, now: 2200, freshMs: 5000 }).badge, 'rejected');
});
