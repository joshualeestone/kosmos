'use strict';
/**
 * Splinter 2026-10-05 (homepage counts): a browser check run directly registered a fresh install on installkosmos.com
 * every run (53 of launch day's 105 new silent installs). Requiring docs/browser-checks/lib-sandbox-home.js, which every
 * board-booting check does (tools.browser-checks-home-3675.test.js), must point the install beacon and the feedback
 * sender at a dead loopback port, whatever the caller's environment held, and keep a loopback stub a check chose.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const LIB = path.join(__dirname, 'docs', 'browser-checks', 'lib-sandbox-home.js');
function after(env) {
  const out = execFileSync(process.execPath, ['-e',
    'require(process.argv[1]); process.stdout.write(JSON.stringify({ c: process.env.AGENT_WORKFORCE_CREATED_URL, f: process.env.AGENT_WORKFORCE_FEEDBACK_URL, m: process.env.AGENT_WORKFORCE_COMMUNITY_URL }))', LIB],
  { env: Object.assign({}, process.env, { NODE_TEST_CONTEXT: '' }, env), encoding: 'utf8' });
  return JSON.parse(out);
}

test('a check run directly (the three variables UNSET, or empty) never reaches the real collectors', () => {
  for (const env of [{ unset: true }, { AGENT_WORKFORCE_CREATED_URL: '', AGENT_WORKFORCE_FEEDBACK_URL: '', AGENT_WORKFORCE_COMMUNITY_URL: '' }]) {
    const base = Object.assign({}, process.env);
    for (const k of ['AGENT_WORKFORCE_CREATED_URL', 'AGENT_WORKFORCE_FEEDBACK_URL', 'AGENT_WORKFORCE_COMMUNITY_URL']) delete base[k];
    const out = env.unset ? JSON.parse(execFileSync(process.execPath, ['-e',
      'require(process.argv[1]); process.stdout.write(JSON.stringify({ c: process.env.AGENT_WORKFORCE_CREATED_URL, f: process.env.AGENT_WORKFORCE_FEEDBACK_URL, m: process.env.AGENT_WORKFORCE_COMMUNITY_URL }))', LIB],
    { env: Object.assign(base, { NODE_TEST_CONTEXT: '' }), encoding: 'utf8' })) : after(env);
    assert.equal(out.c, 'http://127.0.0.1:9/api/created');
    assert.equal(out.f, 'http://127.0.0.1:9/api/feedback');
    assert.equal(out.m, 'http://127.0.0.1:9/');
  }
});

test('a REAL host in the caller\'s environment is replaced, never used from a check', () => {
  const r = after({ AGENT_WORKFORCE_CREATED_URL: 'https://installkosmos.com/api/created', AGENT_WORKFORCE_FEEDBACK_URL: 'https://installkosmos.com/api/feedback', AGENT_WORKFORCE_COMMUNITY_URL: 'https://community.kosmosplus.com/' });
  assert.equal(r.c, 'http://127.0.0.1:9/api/created');
  assert.equal(r.f, 'http://127.0.0.1:9/api/feedback');
  assert.equal(r.m, 'http://127.0.0.1:9/');
});

test('CONTROL: a loopback stub a check chose is kept', () => {
  const r = after({ AGENT_WORKFORCE_CREATED_URL: 'http://127.0.0.1:41234/api/created', AGENT_WORKFORCE_FEEDBACK_URL: 'http://localhost:41235/api/feedback', AGENT_WORKFORCE_COMMUNITY_URL: 'http://[::1]:41236/' });
  assert.equal(r.c, 'http://127.0.0.1:41234/api/created');
  assert.equal(r.f, 'http://localhost:41235/api/feedback', 'review 1: the feedback stub is kept too');
  assert.equal(r.m, 'http://[::1]:41236/');
});
