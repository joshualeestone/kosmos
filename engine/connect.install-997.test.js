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
 *
 * 🛑 A DEFECT THIS FILE ALREADY HAD, RECORDED BECAUSE IT IS THE INTERESTING
 * PART: the first version drove cancellation with `() => ++calls > 1`, which
 * ties the test to HOW MANY TCP CHUNKS the body arrives in. `cancelled()` is
 * called once per chunk plus once after the download, so a 32KB fixture that
 * happens to arrive in one chunk hits the post-download branch and a two-chunk
 * delivery hits the MID-DOWNLOAD branch instead. One of those tests then went
 * GREEN while exercising the failure path, because its assertion (a non-empty
 * `message`) is equally true of the failure shape. Cancellation is now driven
 * by a flag set when `got >= total`, which is chunk-count independent.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const nodePath = require('node:path');
const crypto = require('node:crypto');

// Registers its own cleanup (#1402), unlike a raw mkdtempSync which leaks the
// directory when this file is run on its own -- which its header invites.
const { mkTemp } = require('../test-support/tmpdir');

const SANDBOX = mkTemp('install997-');
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

/**
 * Cancel AFTER the download finishes, independent of chunk count.
 *
 * ✅ WHY THIS IS CHUNK-INDEPENDENT: in the progress wrapper `cancelled()` is
 * consulted BEFORE `onProgress()` on every chunk. So the flag this sets can
 * never be true during a chunk's own cancel check, however many chunks there
 * are, and is reliably true at the post-download check.
 */
function cancelWhenDownloadCompletes() {
  const st = { done: false, cancelledCalls: 0 };
  st.hooks = {
    cancelled: () => { st.cancelledCalls += 1; return st.done; },
    onProgress: (got, total) => { if (total && got >= total) st.done = true; },
  };
  return st;
}

async function withRelease(t, over = {}, opts = {}) {
  const binary = crypto.randomBytes(opts.bytes || 32 * 1024);
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
  const c = cancelWhenDownloadCompletes();
  const res = await withRelease(t, c.hooks);
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true, 'a cancellation must be distinguishable from a failure');
});

test('the cancelled shape carries a message, so a caller that ignores the flag cannot render undefined', async (t) => {
  const c = cancelWhenDownloadCompletes();
  const res = await withRelease(t, c.hooks);
  // 🛑 ASSERT THE SHAPE FIRST. Without this line the test passes on the
  // download-FAILURE shape too, which also carries a non-empty message -- so it
  // would go green while proving nothing about cancellation.
  assert.equal(res.cancelled, true, 'this test is about the CANCELLED shape');
  assert.equal(typeof res.message, 'string');
  assert.ok(res.message.length > 0);
});

test('the cancelled shape survives a MULTI-CHUNK download, not just a one-chunk fixture', async (t) => {
  // The regression arm for this file's own recorded defect: 512KB arrives in
  // several data events, so a chunk-counting fixture would take the wrong branch.
  const c = cancelWhenDownloadCompletes();
  const res = await withRelease(t, c.hooks, { bytes: 512 * 1024 });
  assert.ok(c.cancelledCalls > 1, 'this arm must actually span multiple chunks');
  assert.equal(res.cancelled, true, 'cancellation must not depend on chunk count');
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

test('a missing hook throws AT ENTRY, before any phase is written', async () => {
  for (const missing of ['cancelled', 'maySweepDownloads', 'wantsProgress', 'onPhase', 'onProgress']) {
    const phases = [];
    const hooks = stubs({ onPhase: (p) => phases.push(p) });
    delete hooks[missing];
    await assert.rejects(
      () => connect.installClaudeCode(hooks),
      (err) => err instanceof TypeError && new RegExp(missing).test(err.message),
      `omitting ${missing} must fail loudly at entry`,
    );
    // "AT ENTRY" is the half of the name that was previously aspirational:
    // without this, the guard could fire late and the test would not notice.
    assert.deepEqual(phases, [], `omitting ${missing} must abort before any phase is written`);
  }
});

test('CONTROL: the full stub set gets past the entry guard and SUCCEEDS', async (t) => {
  const res = await withRelease(t, {});
  assert.equal(res.ok, true, 'a complete hook set must reach the success path');
});

test('onPhase receives DOWNLOADING then INSTALLING, in that order, once each', async (t) => {
  // The phase sequence is exactly what a Windows runner has to reimplement, so
  // it belongs in the contract file rather than only in the runFlow tests.
  const phases = [];
  const res = await withRelease(t, { onPhase: (p) => phases.push(p) });
  assert.equal(res.ok, true);
  assert.deepEqual(phases, [connect.PHASE.DOWNLOADING, connect.PHASE.INSTALLING]);
});

test('wantsProgress() gates onProgress()', async (t) => {
  let progressCalls = 0;
  const res = await withRelease(t, {
    wantsProgress: () => false,
    onProgress: () => { progressCalls += 1; },
  });
  assert.equal(res.ok, true);
  assert.equal(progressCalls, 0, 'a false wantsProgress must suppress onProgress');
});

test('CONTROL: with wantsProgress true, onProgress IS called', async (t) => {
  // Without this arm the test above cannot tell "gated" from "never called".
  let progressCalls = 0;
  const res = await withRelease(t, { onProgress: () => { progressCalls += 1; } });
  assert.equal(res.ok, true);
  assert.ok(progressCalls > 0, 'this arm must show onProgress can fire at all');
});

test('#458: maySweepDownloads is consulted on the download-failure path EVEN WHEN CANCELLED', async (t) => {
  /**
   * 🛑 THE POINT OF #458, AND WHY `cancelled: () => true` IS LOAD-BEARING HERE.
   * The two predicates look like duplicates. If `maySweepDownloads` were merely
   * `!cancelled()`, then a CANCELLED flow could not sweep -- and a cancelled
   * flow's rejection arrives here AFTER cancel's own sweep has already run, so
   * it is the only thing that can clean up its own `.part`.
   *
   * A previous version of this test used `cancelled: () => false`, which is
   * consistent with `maySweepDownloads === !cancelled()` and therefore could
   * not distinguish the two predicates at all.
   */
  const seen = { cancelled: 0, sweep: 0, progress: 0 };
  const res = await withRelease(t, {
    // ⚠️ MID-DOWNLOAD, NOT FROM THE FIRST CHUNK. `cancelled: () => true` from
    // the start describes a flow cancelled BEFORE it began, which no real
    // caller can produce -- installClaudeCode would never have been invoked.
    // Driven that way the abort escapes as an unhandled rejection rather than
    // the fail shape, which is an artefact of the impossible premise, not a
    // defect. Cancelling after the first chunk is what a person clicking
    // cancel actually does.
    cancelled: () => { seen.cancelled += 1; return seen.progress > 0; },
    onProgress: () => { seen.progress += 1; },
    maySweepDownloads: () => { seen.sweep += 1; return true; },
  }, { bytes: 512 * 1024 });

  assert.ok(seen.cancelled > 1, 'this arm must span multiple chunks to cancel mid-download');
  assert.ok(seen.sweep > 0, 'maySweepDownloads() must be consulted on a CANCELLED flow (#458)');
  assert.equal(res.ok, false);
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
