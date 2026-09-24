'use strict';
/* #3532: login-expiry detector (keychain refreshTokenExpiresAt).
 *   node --test loginexpiry.test.js
 * The service-name hashes below are byte-exact from the box measured 2026-09-23
 * (sha256 of the absolute config-dir path, first 8 hex). No test touches the real
 * keychain: readCred is injected. */
const { test } = require('node:test');
const assert = require('node:assert');
const le = require('./loginexpiry');

const HOME = '/Users/agent1';
const DAY = le.DAY_MS;

test('serviceNameFor: default dir -> bare name', () => {
  assert.equal(le.serviceNameFor(null, { homeDir: HOME }), 'Claude Code-credentials');
  assert.equal(le.serviceNameFor('/Users/agent1/.claude', { homeDir: HOME }), 'Claude Code-credentials');
});

test('serviceNameFor: custom dirs -> measured sha256 first-8-hex suffixes', () => {
  const cases = {
    '/Users/agent1/.claude-account-b': 'Claude Code-credentials-29fc2894',
    '/Users/agent1/.claude-account-c': 'Claude Code-credentials-9d3fe9ea',
    '/Users/agent1/.claude-account-d': 'Claude Code-credentials-bc18eb8e',
    '/Users/agent1/.claude-account-e': 'Claude Code-credentials-c747add5',
  };
  for (const [dir, want] of Object.entries(cases)) {
    assert.equal(le.serviceNameFor(dir, { homeDir: HOME }), want, dir);
  }
});

test('serviceNameFor: a trailing slash resolves to the same suffix (path.resolve)', () => {
  assert.equal(
    le.serviceNameFor('/Users/agent1/.claude-account-d/', { homeDir: HOME }),
    'Claude Code-credentials-bc18eb8e');
});

test('refreshExpiryFor: returns ONLY the timestamp number, never the tokens', () => {
  const readCred = () => JSON.stringify({
    claudeAiOauth: {
      accessToken: 'SECRET-ACCESS', refreshToken: 'SECRET-REFRESH',
      expiresAt: 1790245051509, refreshTokenExpiresAt: 1790348181509,
    },
  });
  const got = le.refreshExpiryFor('/x/.claude-account-d', { readCred, homeDir: HOME });
  assert.equal(got, 1790348181509);
  assert.equal(typeof got, 'number');           // not an object -> no token can leak
});

test('refreshExpiryFor: missing field / null / throw / malformed -> null (fail soft)', () => {
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => JSON.stringify({ claudeAiOauth: {} }), homeDir: HOME }), null);
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => null, homeDir: HOME }), null);
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => { throw new Error('keychain locked'); }, homeDir: HOME }), null);
  assert.equal(le.refreshExpiryFor('/x', { readCred: () => 'not json', homeDir: HOME }), null);
});

test('advisoriesFor: only accounts within the window, soonest first', () => {
  const now = 1_000_000_000_000;
  const readCred = (svc) => {
    // account-d expires in 2 days, account-e in 30 days
    if (svc.endsWith('bc18eb8e')) return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 2 * DAY } });
    if (svc.endsWith('c747add5')) return JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 30 * DAY } });
    return null;
  };
  const out = le.advisoriesFor({
    now, warnWithinDays: 5, readCred, homeDir: HOME,
    accounts: [
      { configDir: '/Users/agent1/.claude-account-e', account: 'e', agents: ['x'] },
      { configDir: '/Users/agent1/.claude-account-d', account: 'd', agents: ['mona', 'leo', 'shredder'] },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].account, 'd');
  assert.equal(out[0].daysLeft, 2);
  assert.equal(out[0].severity, 'warn');
  assert.deepEqual(out[0].agents, ['mona', 'leo', 'shredder']);
});

test('advisoriesFor: already-expired account is urgent + flagged expired', () => {
  const now = 1_000_000_000_000;
  const readCred = () => JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now - 1 * DAY } });
  const out = le.advisoriesFor({
    now, readCred, homeDir: HOME,
    accounts: [{ configDir: '/Users/agent1/.claude-account-d', agents: ['a'] }],
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
    : null; // account-c unreadable
  const out = le.advisoriesFor({
    now, readCred, homeDir: HOME,
    accounts: [
      { configDir: '/Users/agent1/.claude-account-c', agents: ['bad'] },
      { configDir: '/Users/agent1/.claude-account-d', agents: ['good'] },
    ],
  });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].agents, ['good']);
  assert.equal(out[0].severity, 'urgent');
});

test('severityFor thresholds', () => {
  assert.equal(le.severityFor(5), 'notice');
  assert.equal(le.severityFor(4), 'notice');
  assert.equal(le.severityFor(3), 'warn');
  assert.equal(le.severityFor(2), 'warn');
  assert.equal(le.severityFor(1), 'urgent');
  assert.equal(le.severityFor(0), 'urgent');
});
