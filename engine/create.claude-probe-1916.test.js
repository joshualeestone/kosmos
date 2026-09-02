'use strict';
/**
 * #1916: the REAL `claude -p` probe path (defaultClaudeProbe -> claudeAccountLive),
 * exercised without the setClaudeProbe stub. A fake `claude` binary stands in for
 * the real one (AGENT_WORKFORCE_CLAUDE_BIN, the seam runners.resolveBin honours),
 * so the subprocess machinery -- exit-code derivation, timeout + SIGKILL, and
 * partial-output survival -- is measured, not just the classifier.
 *
 * 🛑 Seals AGENT_WORKFORCE_HOME before requiring anything (suite rule).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-claude-probe-1916-'));
const BIN = nodePath.join(SANDBOX, 'claude-fake');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = BIN;

const create = require('./create');
const sub = require('./subscription');

// A fake `claude` whose behaviour is set per-test via env, so one script covers
// success, a real 401 exit, and a hang that prints its 401 before being killed.
fs.writeFileSync(BIN, `#!/bin/sh
case "$FAKE_MODE" in
  ok)   echo ok; exit 0;;
  dead) echo 'Please run /login · API Error: 401 OAuth access token has expired.' >&2; exit 1;;
  hang) echo 'API Error: 401 OAuth access token has expired.'; sleep 5; exit 1;;
  flagcheck) case "$*" in *--strict-mcp-config*) echo ok; exit 0;; *) echo 'MISSING --strict-mcp-config'; exit 1;; esac;;
  *)    exit 0;;
esac
`, { mode: 0o755 });

test.after(() => {
  create.setClaudeProbe(null);
  delete process.env.AGENT_WORKFORCE_CLAUDE_PROBE_TIMEOUT_MS;
  delete process.env.FAKE_MODE;
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch { /* best effort */ }
});

test('#1916 probe: a real exit-0 call is CONNECTED', async () => {
  process.env.FAKE_MODE = 'ok';
  assert.equal(await create.claudeAccountLive(null), sub.STATE.CONNECTED);
});

test('#1916 probe: a real non-zero exit printing a 401 is NONE', async () => {
  process.env.FAKE_MODE = 'dead';
  assert.equal(await create.claudeAccountLive(null), sub.STATE.NONE);
});

test('#1916 probe: a HUNG probe is killed at the timeout, and its already-printed 401 still reads NONE', async () => {
  /* Proves the timeout + SIGKILL path AND partial-output survival: the fake
     prints its 401 then sleeps 5s; with a 600ms timeout it is killed, and the
     captured stdout still classifies as dead rather than being discarded. */
  process.env.FAKE_MODE = 'hang';
  process.env.AGENT_WORKFORCE_CLAUDE_PROBE_TIMEOUT_MS = '600';
  const started = Date.now();
  const state = await create.claudeAccountLive(null);
  const elapsed = Date.now() - started;
  delete process.env.AGENT_WORKFORCE_CLAUDE_PROBE_TIMEOUT_MS;
  assert.equal(state, sub.STATE.NONE, 'a killed-at-timeout dead probe lost its printed 401');
  assert.ok(elapsed < 4000, 'the probe was not killed at the timeout (took ' + elapsed + 'ms)');
});

test('#1916 probe: the probe passes --strict-mcp-config so a broken CONNECTOR cannot false-refuse a live account', async () => {
  /* The fake exits 0 only if --strict-mcp-config is in its argv, so CONNECTED
     here proves defaultClaudeProbe isolates the probe from the account's MCP
     servers -- otherwise a connector's expired-token diagnostics would land in
     the classified output and read the live account as dead. */
  process.env.FAKE_MODE = 'flagcheck';
  assert.equal(await create.claudeAccountLive(null), sub.STATE.CONNECTED,
    'defaultClaudeProbe did not pass --strict-mcp-config (a broken connector could false-refuse a live account)');
});

test('#1916 probe: an unrunnable claude binary is UNKNOWN (fail-open), never dead', async () => {
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = nodePath.join(SANDBOX, 'no-such-claude');
  try {
    assert.equal(await create.claudeAccountLive(null), sub.STATE.UNKNOWN);
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev; }
});
