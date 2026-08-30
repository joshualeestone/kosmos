/**
 * Direct contract tests for `installClaudeCode`, the function #997 extracted
 * out of `runFlow`.
 *
 * 🛑 WHY A SEPARATE FILE RATHER THAN MORE CASES IN connect.test.js: everything
 * there drives the sequence THROUGH `runFlow`, so it exercises the install and
 * asserts on the BOARD's state. That is the right test for the flow and it
 * cannot fail on the thing this file is about -- the RESULT CONTRACT a second
 * caller reads. A Windows runner and a non-Claude runner are exactly that
 * second caller, and they will never go through `runFlow`.
 *
 * ⚠️ The repo's `engine.reachable.test.js` cannot cover this gap: its
 * `if (!tested) continue;` short-circuit means an export nobody tests is
 * skipped BY CONSTRUCTION, so an untested export looks identical to a
 * thoroughly tested one.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const nodePath = require('node:path');
const crypto = require('node:crypto');

const SANDBOX = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'install997-'));
process.env.AGENT_WORKFORCE_DATA = nodePath.join(SANDBOX, 'data');

const connect = require('./connect');

function serveRelease(t, { version, binary, checksum }) {
  const paths = {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({
      platforms: { [connect.platformKey()]: { checksum } },
    }),
    [`/${version}/${connect.platformKey()}/claude`]: () => binary,
  };
  const server = http.createServer((req, res) => {
    const answer = paths[req.url];
    if (!answer) { res.writeHead(404); res.end(); return; }
    const body = Buffer.isBuffer(answer()) ? answer() : Buffer.from(answer());
    res.writeHead(200, { 'content-length': body.length });
    res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      t.after(() => server.close());
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

/** Every hook a no-op, so each test overrides only the one it is about. */
const stubs = (over = {}) => ({
  cancelled: () => false,
  maySweepDownloads: () => true,
  wantsProgress: () => true,
  onPhase: () => {},
  onProgress: () => {},
  ...over,
});

async function withRelease(t, over = {}, opts = {}) {
  const binary = crypto.randomBytes(32 * 1024);
  const checksum = opts.badChecksum
    ? crypto.createHash('sha256').update('not the binary').digest('hex')
    : crypto.createHash('sha256').update(binary).digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE =
    await serveRelease(t, { version: '9.9.5', binary, checksum });
  const binPath = nodePath.join(SANDBOX, `claude-bin-${crypto.randomBytes(4).toString('hex')}`);
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = binPath;
  // setRunner BEFORE setDryRun: the module refuses to leave dry-run with no
  // injected runner, which is a guard worth keeping and worth ordering around.
  //
  // ⚠️ THE DEFAULT RUNNER MUST ACTUALLY CREATE THE BINARY. A stub that merely
  // reports `{ok:true}` leaves the sequence's own `fs.accessSync(..., X_OK)`
  // check failing, so the SUCCESS arm silently becomes a failure arm and a
  // control asserting `ok === true` cannot pass. Found by that control failing.
  connect.setRunner(opts.runner || ((file, args) => {
    if (args && args[0] === 'install') {
      fs.writeFileSync(binPath, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(binPath, 0o755);
    }
    return { ok: true, stdout: '' };
  }));
  connect.setDryRun(false);
  t.after(() => {
    connect.setRunner(null);
    connect.resetForTests();
    delete process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE;
    delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  });
  return connect.installClaudeCode(stubs(over));
}

// ── the three return shapes ─────────────────────────────────────────────────

test('a cancelled install returns the CANCELLED shape, not a failure', async (t) => {
  // Cancel lands after the download, which is the path that used to be a bare
  // `return` inside runFlow and was silently dropped in the first extraction.
  let calls = 0;
  const res = await withRelease(t, { cancelled: () => ++calls > 1 });
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true, 'a cancellation must be distinguishable from a failure');
});

test('the cancelled shape carries a message, so a caller that ignores the flag cannot render undefined', async (t) => {
  let calls = 0;
  const res = await withRelease(t, { cancelled: () => ++calls > 1 });
  // This is the exact expression a naive second caller writes.
  assert.equal(typeof res.message, 'string');
  assert.notEqual(res.message, undefined);
  assert.ok(res.message.length > 0);
});

test('a failed install returns the FAILURE shape with a message, and is NOT marked cancelled', async (t) => {
  const res = await withRelease(t, {}, {
    runner: (file, args) => (args && args[0] === 'install')
      ? { ok: false, stdout: '', stderr: 'install exploded' }
      : { ok: true, stdout: '' },
  });
  assert.equal(res.ok, false);
  assert.ok(!res.cancelled, 'a real failure must not be mistaken for a cancellation');
  assert.match(res.message, /did not finish setting itself up/);
});

// ── the hook contract ───────────────────────────────────────────────────────

test('a missing hook throws AT ENTRY rather than inside a data listener', async () => {
  for (const missing of ['cancelled', 'maySweepDownloads', 'wantsProgress', 'onPhase', 'onProgress']) {
    const hooks = stubs();
    delete hooks[missing];
    await assert.rejects(
      () => connect.installClaudeCode(hooks),
      (err) => err instanceof TypeError && new RegExp(missing).test(err.message),
      `omitting ${missing} must fail loudly at entry`,
    );
  }
});

test('CONTROL: the full stub set does NOT throw the entry TypeError', async (t) => {
  // Without this arm the test above would pass even if the guard rejected
  // everything, including correct callers.
  const res = await withRelease(t, {});
  assert.ok(res && typeof res.ok === 'boolean', 'a complete hook set must get past the guard');
});

test('#458: maySweepDownloads is consulted on the DOWNLOAD-FAILURE path, separately from cancelled', async (t) => {
  /**
   * The two predicates look like duplicates and collapsing them reintroduces
   * #458: a CANCELLED flow's rejection arrives here after cancel's own sweep
   * has already run, and it must still be allowed to sweep its own `.part`.
   *
   * ⚠️ This must drive a FAILING download. My first version of this test
   * asserted the sweep on the happy path, where it is never reached -- the
   * hook lives only in the catch block. That version failed honestly and said
   * so, which is the only reason it is written correctly now.
   */
  const seen = { cancelled: 0, sweep: 0 };
  const res = await withRelease(t, {
    cancelled: () => { seen.cancelled += 1; return false; },
    maySweepDownloads: () => { seen.sweep += 1; return true; },
  }, { badChecksum: true });

  assert.equal(res.ok, false);
  assert.ok(!res.cancelled, 'a checksum refusal is a failure, not a cancellation');
  assert.ok(seen.sweep > 0, 'maySweepDownloads() must be consulted on the failure path');
});

test('CONTROL: the sweep hook is NOT consulted when the download succeeds', async (t) => {
  // Without this arm the test above cannot tell "consulted on failure" from
  // "consulted always", and the #458 distinction would be unobservable.
  const seen = { sweep: 0 };
  const res = await withRelease(t, {
    maySweepDownloads: () => { seen.sweep += 1; return true; },
  });
  assert.equal(res.ok, true, 'this arm must be the SUCCESS case or it proves nothing');
  assert.equal(seen.sweep, 0, 'the sweep belongs to the failure path only');
});
