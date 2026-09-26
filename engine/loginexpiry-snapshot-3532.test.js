'use strict';
/* #3532: integration coverage for the snapshot() login-expiry glue -- the pane-filter
 * (isNamedOurs), the per-account grouping, and the TTL cache wiring in
 * status.computeLoginAdvisories. The pure detector (serviceNameFor/refreshExpiryFor/
 * ccdFromPsEnv/agentAdvisories/cachedAdvisories) is covered in loginexpiry.test.js; this
 * covers the wiring the reviewer flagged, with the impure tmux+ps CCD resolver and the
 * keychain read injected so nothing touches the real fleet.
 *   node --test loginexpiry-snapshot-3532.test.js
 * Pane fixtures use test-support/fleet.line (never hand-typed tab lines -- fixture-discipline). */
const { test } = require('node:test');
const assert = require('node:assert');
const status = require('./status');
const fleet = require('../test-support/fleet');

const DAY = 86400000;
const paneOf = (spec) => status.parsePanes(fleet.line(spec))[0];

test('computeLoginAdvisories: filters non-ours panes, groups ours by the credential they read', () => {
  const now = 1_000_000_000_000;
  const panes = [
    paneOf({ session: 'angel-discord', pane: '0.0' }),
    paneOf({ session: 'mona-discord', pane: '0.1' }),
    paneOf({ session: 'randomshell', pane: '0.0', command: 'zsh' }),   // NOT ours -> must be excluded
  ];
  // Controls: the fixture actually exercises the filter (else the exclusion below is vacuous).
  assert.equal(status.isNamedOurs(panes[0]), true, 'angel-discord is ours');
  assert.equal(status.isNamedOurs(panes[2]), false, 'randomshell is not ours');

  const ccdByName = { angel: '/Users/agent1/.claude', mona: '/Users/agent1/.claude' };
  const readCcd = (a) => ccdByName[a.name];   // both bots on the explicit-default CCD -> 2a1a4199
  const readCred = (svc) => (svc === 'Claude Code-credentials-2a1a4199'
    ? JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 2 * DAY } }) : null);
  const cache = { at: 0, value: [] };

  const out = status.computeLoginAdvisories(panes, now, { readCcd, readCred, cache });
  assert.equal(out.length, 1);                                  // one credential -> one advisory
  assert.deepEqual(out[0].agents.slice().sort(), ['angel', 'mona']);
  assert.ok(!out[0].agents.includes('randomshell'));           // the non-ours pane was filtered out
  assert.equal(out[0].daysLeft, 2);
  assert.equal(out[0].severity, 'warn');
  assert.equal(out[0].service, 'Claude Code-credentials-2a1a4199');
});

test('#3568: an agent on another program (antigravity, codex) is never named in a Claude login warning', () => {
  const now = 1_000_000_000_000;
  const DAY = 24 * 3600 * 1000;
  const agyPane = paneOf({ session: 'gem-discord', pane: '0.0' }); agyPane.runner = 'antigravity';
  const codexPane = paneOf({ session: 'cx-discord', pane: '0.1' }); codexPane.runner = 'codex';
  const claudePane = paneOf({ session: 'angel-discord', pane: '0.2' });
  // Every pane resolves to the SAME bare Claude credential, which is what an agy pane without a
  // CLAUDE_CONFIG_DIR would read as: without the filter all three would be named.
  const readCcd = () => null;
  const readCred = () => JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 2 * DAY } });
  const out = status.computeLoginAdvisories([agyPane, codexPane, claudePane], now, { readCcd, readCred, cache: { at: 0, value: [] } });
  const named = out.flatMap((a) => a.agents);
  assert.ok(named.includes('angel'), 'CONTROL: the Claude agent is still warned: ' + JSON.stringify(out));
  assert.ok(!named.includes('gem'), 'an Antigravity agent was named in a Claude login warning');
  assert.ok(!named.includes('cx'), 'a Codex agent was named in a Claude login warning');
});

test('computeLoginAdvisories: a second call within the TTL serves from the injected cache (no re-resolve)', () => {
  const now = 1_000_000_000_000;
  const panes = [paneOf({ session: 'angel-discord' })];
  let ccdCalls = 0;
  const readCcd = () => { ccdCalls++; return '/Users/agent1/.claude'; };
  const readCred = () => JSON.stringify({ claudeAiOauth: { refreshTokenExpiresAt: now + 1 * DAY } });
  const cache = { at: 0, value: [] };
  const a = status.computeLoginAdvisories(panes, now, { readCcd, readCred, cache });
  const b = status.computeLoginAdvisories(panes, now + 1000, { readCcd, readCred, cache }); // within TTL
  assert.equal(ccdCalls, 1, 'the CCD resolver ran once; the second call served the cached value');
  assert.deepEqual(a, b);
});

test('computeLoginAdvisories: no ours panes -> empty (nothing to warn about)', () => {
  const now = 1_000_000_000_000;
  const panes = [paneOf({ session: 'randomshell', command: 'zsh' })];
  const out = status.computeLoginAdvisories(panes, now, {
    readCcd: () => { throw new Error('should not be called for a non-ours pane'); },
    readCred: () => null,
    cache: { at: 0, value: [] },
  });
  assert.deepEqual(out, []);
});
