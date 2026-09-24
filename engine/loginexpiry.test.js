'use strict';
/* #3532: login-expiry detector (keychain refreshTokenExpiresAt).
 *   node --test loginexpiry.test.js
 * The service-name hashes below are byte-exact from the box measured 2026-09-23
 * (sha256 of the CLAUDE_CONFIG_DIR value as set, first 8 hex). No test touches the
 * real keychain: readCred is injected. */
const { test } = require('node:test');
const assert = require('node:assert');
const le = require('./loginexpiry');

const DAY = le.DAY_MS;

test('serviceNameFor: CCD UNSET -> bare name', () => {
  assert.equal(le.serviceNameFor(undefined), 'Claude Code-credentials');
  assert.equal(le.serviceNameFor(null), 'Claude Code-credentials');
  assert.equal(le.serviceNameFor(''), 'Claude Code-credentials');
});

test('#2129: explicit CCD equal to the default path uses the SUFFIXED entry, not bare', () => {
  // The load-bearing correction (Splinter 2026-09-23). Unset and explicit-default are
  // DIFFERENT credentials; a path compare would wrongly collapse them.
  const unset = le.serviceNameFor(undefined);
  const explicitDefault = le.serviceNameFor('/Users/agent1/.claude');
  assert.equal(unset, 'Claude Code-credentials');
  assert.equal(explicitDefault, 'Claude Code-credentials-2a1a4199'); // sha256(/Users/agent1/.claude)
  assert.notEqual(unset, explicitDefault);
});

test('serviceNameFor: custom dirs -> measured sha256 first-8-hex suffixes', () => {
  const cases = {
    '/Users/agent1/.claude-account-b': 'Claude Code-credentials-29fc2894',
    '/Users/agent1/.claude-account-c': 'Claude Code-credentials-9d3fe9ea',
    '/Users/agent1/.claude-account-d': 'Claude Code-credentials-bc18eb8e',
    '/Users/agent1/.claude-account-e': 'Claude Code-credentials-c747add5',
  };
  for (const [ccd, want] of Object.entries(cases)) {
    assert.equal(le.serviceNameFor(ccd), want, ccd);
  }
});

test('serviceNameFor: value is hashed VERBATIM -> a trailing slash changes the hash', () => {
  // Claude Code hashes the env string as set; we must not normalize it away.
  assert.notEqual(
    le.serviceNameFor('/Users/agent1/.claude-account-d'),
    le.serviceNameFor('/Users/agent1/.claude-account-d/'));
});

test('serviceNameFor: a trailing newline from a capture is stripped', () => {
  assert.equal(
    le.serviceNameFor('/Users/agent1/.claude-account-d\n'),
    'Claude Code-credentials-bc18eb8e');
});

test('refreshExpiryFor: returns ONLY the timestamp number, never the tokens', () => {
  const readCred = () => JSON.stringify({
    claudeAiOauth: {
      accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH',
      expiresAt: 1790245051509, refreshTokenExpiresAt: 1790348181509,
    },
  });
  const got = le.refreshExpiryFor('/x/.claude-account-d', { readCred });
  assert.equal(got, 1790348181509);
  assert.equal(typeof got, 'number');           // not an object -> no token can leak
});

test('refreshExpiryFor: missing field / null / throw / malformed -> null (fail soft)', () => {
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => JSON.stringify({ claudeAiOauth: {} }) }), null);
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => null }), null);
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => { throw new Error('keychain locked'); } }), null);
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => 'not json' }), null);
});

test('refreshExpiryFor: reads the credential the CCD actually points at (per-arm)', () => {
  // unset reads the bare entry; explicit-default reads 2a1a4199; they can differ.
  const readCred = (svc) => {
    if (svc === 'Claude Code-credentials') return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: 111 } });
    if (svc === 'Claude Code-credentials-2a1a4199') return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: 999 } });
    return null;
  };
  assert.equal(le.refreshExpiryFor(undefined, { readCred }), 111);
  assert.equal(le.refreshExpiryFor('/Users/agent1/.claude', { readCred }), 999);
});

test('advisoriesFor: only accounts within the window, soonest first', () => {
  const now = 1_000_000_000_000;
  const readCred = (svc) => {
    if (svc.endsWith('bc18eb8e')) return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 2 * DAY } });
    if (svc.endsWith('c747add5')) return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 30 * DAY } });
    return null;
  };
  const out = le.advisoriesFor({
    now, warnWithinDays: 5, readCred,
    accounts: [
      { ccd: '/Users/agent1/.claude-account-e', account: 'e', agents: ['x'] },
      { ccd: '/Users/agent1/.claude-account-d', account: 'd', agents: ['mona', 'leo', 'shredder'] },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].account, 'd');
  assert.equal(out[0].daysLeft, 2);
  assert.equal(out[0].severity, 'warn');
  assert.deepEqual(out[0].agents, ['mona', 'leo', 'shredder']);
  assert.equal(out[0].service, 'Claude Code-credentials-bc18eb8e');
});

test('advisoriesFor: unset and explicit-default are separate buckets', () => {
  const now = 1_000_000_000_000;
  const readCred = (svc) => {
    if (svc === 'Claude Code-credentials') return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 1 * DAY } });
    if (svc === 'Claude Code-credentials-2a1a4199') return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 6 * DAY } });
    return null;
  };
  const out = le.advisoriesFor({
    now, warnWithinDays: 5, readCred,
    accounts: [
      { ccd: undefined, account: 'ccd-unset', agents: ['mystery'] },
      { ccd: '/Users/agent1/.claude', account: 'bots', agents: ['angel', 'mona'] },
    ],
  });
  // only the unset bucket is within 5 days; the explicit-default bucket (6d) is out.
  assert.equal(out.length, 1);
  assert.equal(out[0].account, 'ccd-unset');
  assert.equal(out[0].service, 'Claude Code-credentials');
});

test('advisoriesFor: already-expired account is urgent + flagged expired', () => {
  const now = 1_000_000_000_000;
  const readCred = () => JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now - 1 * DAY } });
  const out = le.advisoriesFor({
    now, readCred,
    accounts: [{ ccd: '/Users/agent1/.claude-account-d', agents: ['a'] }],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].severity, 'urgent');
  assert.equal(out[0].expired, true);
  assert.ok(out[0].daysLeft < 0);
});

test('advisoriesFor: an unreadable account is skipped, does not break the others', () => {
  const now = 1_000_000_000_000;
  const readCred = (svc) => svc.endsWith('bc18eb8e')
    ? JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 1 * DAY } })
    : null;
  const out = le.advisoriesFor({
    now, readCred,
    accounts: [
      { ccd: '/Users/agent1/.claude-account-c', agents: ['bad'] },
      { ccd: '/Users/agent1/.claude-account-d', agents: ['good'] },
    ],
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].agents, ['good']);
  assert.equal(out[0].severity, 'urgent');
});

test('ccdFromPsEnv: extracts the value when the var is present', () => {
  const line = ' 1592 ??  Ss  0:12.3 /Users/agent1/.local/bin/claude PATH=/usr/bin CLAUDE_CONFIG_DIR=/Users/agent1/.claude TERM=xterm';
  assert.equal(le.ccdFromPsEnv(line), '/Users/agent1/.claude');
});

test('ccdFromPsEnv: returns null when the var is ABSENT (unset)', () => {
  const line = ' 50915 ??  Ss  0:01.0 /Users/agent1/.local/bin/claude -p PATH=/usr/bin TERM=xterm';
  assert.equal(le.ccdFromPsEnv(line), null);
});

test('ccdFromPsEnv: empty value stays empty (serviceNameFor treats it as bare)', () => {
  assert.equal(le.ccdFromPsEnv('claude CLAUDE_CONFIG_DIR= NEXT=1'), '');
  assert.equal(le.serviceNameFor(le.ccdFromPsEnv('claude CLAUDE_CONFIG_DIR= NEXT=1')), 'Claude Code-credentials');
});

test('#2129 tie-in: a default-account bot with explicit CCD resolves to the SUFFIXED entry via process env', () => {
  // job.configDir would be null for this agent; the process env is the only truthful source.
  const line = 'claude CLAUDE_CONFIG_DIR=/Users/agent1/.claude';
  assert.equal(le.serviceNameFor(le.ccdFromPsEnv(line)), 'Claude Code-credentials-2a1a4199');
});

test('ccdFromPsEnv: null/empty input -> null', () => {
  assert.equal(le.ccdFromPsEnv(''), null);
  assert.equal(le.ccdFromPsEnv(null), null);
  assert.equal(le.ccdFromPsEnv(undefined), null);
});

test('agentAdvisories: groups agents by credential, one advisory per credential', () => {
  const now = 1_000_000_000_000;
  const ccdByAgent = {
    angel: '/Users/agent1/.claude', mona: '/Users/agent1/.claude',        // -> 2a1a4199
    raph: '/Users/agent1/.claude-account-d',                               // -> bc18eb8e
  };
  const readCcd = (a) => ccdByAgent[a.name];
  const readCred = (svc) => {
    if (svc === 'Claude Code-credentials-2a1a4199') return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 2 * DAY } });
    if (svc === 'Claude Code-credentials-bc18eb8e') return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 30 * DAY } });
    return null;
  };
  const out = le.agentAdvisories({
    agents: [{ name: 'angel' }, { name: 'mona' }, { name: 'raph' }],
    readCcd, readCred, now, warnWithinDays: 5,
  });
  assert.equal(out.length, 1);                       // only the 2a1a4199 credential is within 5d
  assert.equal(out[0].service, 'Claude Code-credentials-2a1a4199');
  assert.deepEqual(out[0].agents.sort(), ['angel', 'mona']);   // both bots on that credential
});

test('agentAdvisories: an UNRESOLVABLE agent (readCcd -> undefined) is SKIPPED, not bucketed as unset', () => {
  const now = 1_000_000_000_000;
  const readCcd = (a) => (a.name === 'ghost' ? undefined : '/Users/agent1/.claude');
  const readCred = (svc) => svc === 'Claude Code-credentials-2a1a4199'
    ? JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 1 * DAY } })
    : (() => { throw new Error('bare should never be read here'); })();
  const out = le.agentAdvisories({
    agents: [{ name: 'ghost' }, { name: 'angel' }],
    readCcd, readCred, now,
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].agents, ['angel']);        // ghost skipped, bare never consulted
});

test('agentAdvisories: a readCcd that throws skips that agent (fail soft)', () => {
  const now = 1_000_000_000_000;
  const readCcd = (a) => { if (a.name === 'boom') throw new Error('ps failed'); return '/Users/agent1/.claude-account-d'; };
  const readCred = () => JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 1 * DAY } });
  const out = le.agentAdvisories({ agents: [{ name: 'boom' }, { name: 'ok' }], readCcd, readCred, now });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].agents, ['ok']);
});

test('agentAdvisories: genuinely-unset agent (readCcd -> null) buckets to the bare credential', () => {
  const now = 1_000_000_000_000;
  const readCcd = () => null;   // env read succeeded, no CCD -> unset -> bare
  const readCred = (svc) => svc === 'Claude Code-credentials'
    ? JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 1 * DAY } }) : null;
  const out = le.agentAdvisories({ agents: [{ name: 'automation' }], readCcd, readCred, now });
  assert.equal(out.length, 1);
  assert.equal(out[0].service, 'Claude Code-credentials');
});

test('cachedAdvisories: first call computes and stores; a call within TTL returns cached (no recompute)', () => {
  const cache = { at: 0, value: [] };
  let calls = 0;
  const compute = () => { calls++; return [{ tag: calls }]; };
  const a = le.cachedAdvisories({ cache, now: 1000, ttlMs: 100, compute });
  assert.deepEqual(a, [{ tag: 1 }]);
  assert.equal(cache.at, 1000);
  const b = le.cachedAdvisories({ cache, now: 1050, ttlMs: 100, compute }); // within TTL
  assert.deepEqual(b, [{ tag: 1 }]);   // same value
  assert.equal(calls, 1);              // compute NOT called again
});

test('cachedAdvisories: recomputes after the TTL window', () => {
  const cache = { at: 0, value: [] };
  let calls = 0;
  const compute = () => { calls++; return [{ tag: calls }]; };
  le.cachedAdvisories({ cache, now: 1000, ttlMs: 100, compute });
  const c = le.cachedAdvisories({ cache, now: 2000, ttlMs: 100, compute }); // past TTL
  assert.deepEqual(c, [{ tag: 2 }]);
  assert.equal(calls, 2);
  assert.equal(cache.at, 2000);
});

test('cachedAdvisories: a compute THROW keeps last-good and does NOT advance `at` (retry next tick)', () => {
  const cache = { at: 0, value: [] };
  le.cachedAdvisories({ cache, now: 1000, ttlMs: 100, compute: () => [{ ok: 1 }] }); // seed
  const boom = le.cachedAdvisories({ cache, now: 2000, ttlMs: 100, compute: () => { throw new Error('ps failed'); } });
  assert.deepEqual(boom, [{ ok: 1 }]);   // last-good returned
  assert.equal(cache.at, 1000);          // `at` NOT advanced -> next call recomputes rather than waiting out the TTL
  let called = false;
  le.cachedAdvisories({ cache, now: 2001, ttlMs: 100, compute: () => { called = true; return [{ ok: 2 }] } });
  assert.equal(called, true);            // it retried immediately, not blocked by a fresh cache stamp
});

test('exported thresholds have the documented values', () => {
  assert.equal(le.URGENT_DAYS, 1);
  assert.equal(le.WARN_DAYS, 3);
  assert.equal(le.WARN_WITHIN_DAYS, 5);
});

test('severityFor thresholds', () => {
  assert.equal(le.severityFor(5), 'notice');
  assert.equal(le.severityFor(4), 'notice');
  assert.equal(le.severityFor(3), 'warn');
  assert.equal(le.severityFor(2), 'warn');
  assert.equal(le.severityFor(1), 'urgent');
  assert.equal(le.severityFor(0), 'urgent');
});
