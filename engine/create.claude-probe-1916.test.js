'use strict';
require('../test-support/tmpscope'); // this file's temp dirs, removed when it exits (#9104)
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
/* kosmos#9269: the fake claude below is a node script (claude-fake.js). The probe starts a .js path through this node
   (engine/tunnelcommand.js), and Windows counts a .js as runnable by its extension, so every arm runs on every platform. */
const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'create-claude-probe-1916-'));
const BIN = nodePath.join(SANDBOX, 'claude-fake.js');
process.env.AGENT_WORKFORCE_HOME = nodePath.join(SANDBOX, 'home');
fs.mkdirSync(process.env.AGENT_WORKFORCE_HOME, { recursive: true });
process.env.AGENT_WORKFORCE_CLAUDE_BIN = BIN;

const create = require('./create');
const sub = require('./subscription');

// A fake `claude` whose behaviour is set per-test via env, so one script covers
// success, a real 401 exit, and a hang that prints its 401 before being killed.
fs.writeFileSync(BIN, `#!/usr/bin/env node
'use strict';
const out = (t) => process.stdout.write(t + '\\n');
const err = (t) => process.stderr.write(t + '\\n');
const args = process.argv.slice(2).join(' ');
switch (process.env.FAKE_MODE) {
  case 'ok': out('ok'); process.exitCode = 0; break;
  case 'dead': err('Please run /login · API Error: 401 OAuth access token has expired.'); process.exitCode = 1; break;
  case 'hang': out('API Error: 401 OAuth access token has expired.'); setTimeout(() => process.exit(1), 5000); break;
  case 'flagcheck':
    if (args.includes('--strict-mcp-config')) { out('ok'); process.exitCode = 0; } else { out('MISSING --strict-mcp-config'); process.exitCode = 1; }
    break;
  case 'configdir': {
    const got = process.env.CLAUDE_CONFIG_DIR || '';
    const want = process.env.FAKE_EXPECT_CONFIGDIR || '';
    if (got === want) { out('ok'); process.exitCode = 0; } else { out('WRONG CONFIGDIR: got [' + got + '] want [' + want + ']'); process.exitCode = 1; }
    break;
  }
  default: process.exitCode = 0;
}
`, { mode: 0o755 });
fs.chmodSync(BIN, 0o755);   // the umask can take bits writeFileSync's mode asked for

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

test('#1916 probe: a LABELLED dir is passed to the child as CLAUDE_CONFIG_DIR', async () => {
  /* The auth-critical scoping for a labelled account: the child must be probed
     against THAT dir, or the probe would measure the wrong account (accept a dead
     labelled / refuse a live one). The fake exits 0 only if its CLAUDE_CONFIG_DIR
     equals what we asked for. */
  process.env.FAKE_MODE = 'configdir';
  process.env.FAKE_EXPECT_CONFIGDIR = '/some/labelled/dir';
  try {
    assert.equal(await create.claudeAccountLive('/some/labelled/dir'), sub.STATE.CONNECTED,
      'the probe did not pass the labelled configDir to the child');
  } finally { delete process.env.FAKE_EXPECT_CONFIGDIR; }
});

test('#1916 probe: the DEFAULT DELETES CLAUDE_CONFIG_DIR even when the PARENT has one set (env leak guard)', async () => {
  /* April's env-leak point: `{...process.env}` inherits the caller's
     CLAUDE_CONFIG_DIR (this box carries one), so OMITTING the key is NOT the same
     as the child not having it. defaultClaudeProbe DELETES it for the default, so
     the child probes the TRUE default, not the caller's account. Set a sentinel
     in the parent and assert the child sees it empty; a regression to "omit"
     would leak the sentinel and red this. */
  const prevCfg = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/parent/leaked/dir';
  process.env.FAKE_MODE = 'configdir';
  process.env.FAKE_EXPECT_CONFIGDIR = '';
  try {
    assert.equal(await create.claudeAccountLive(null), sub.STATE.CONNECTED,
      'the default probe leaked the caller\'s CLAUDE_CONFIG_DIR instead of deleting it');
  } finally {
    delete process.env.FAKE_EXPECT_CONFIGDIR;
    if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prevCfg;
  }
});

test('#1916 probe: an unrunnable claude binary is UNKNOWN (fail-open), never dead', async () => {
  const prev = process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = nodePath.join(SANDBOX, 'no-such-claude');
  try {
    assert.equal(await create.claudeAccountLive(null), sub.STATE.UNKNOWN);
  } finally { process.env.AGENT_WORKFORCE_CLAUDE_BIN = prev; }
});
