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
const store = require('./store');

function serveRelease(t, { version, binary, checksum }, opts = {}) {
  const paths = {
    '/latest': () => version,
    [`/${version}/manifest.json`]: () => JSON.stringify({
      platforms: { [connect.platformKey()]: { checksum } },
    }),
    [`/${version}/${connect.platformKey()}/claude`]: () => binary,
  };
  const server = http.createServer((req, res) => {
    if (opts.dieMidStream && req.url === `/${version}/${connect.platformKey()}/claude`) {
      // Promise a megabyte, deliver 64KB, then kill the socket. This is the only
      // way to leave a `.part` on disk for the catch-block sweep to act on: a
      // 404 never creates one, and a checksum refusal unlinks its own.
      res.writeHead(200, { 'content-length': 1024 * 1024 });
      res.write(Buffer.alloc(64 * 1024, 7));
      setTimeout(() => { try { res.destroy(); } catch { /* already gone */ } }, 30);
      return;
    }
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
  const st = { done: false, cancelledCalls: 0, chunks: 0 };
  st.hooks = {
    cancelled: () => { st.cancelledCalls += 1; return st.done; },
    onProgress: (got, total) => { st.chunks += 1; if (total && got >= total) st.done = true; },
  };
  return st;
}

async function withRelease(t, over = {}, opts = {}) {
  const binary = crypto.randomBytes(opts.bytes || 32 * 1024);
  const checksum = opts.badChecksum
    ? crypto.createHash('sha256').update('not the binary').digest('hex')
    : crypto.createHash('sha256').update(binary).digest('hex');
  process.env.AGENT_WORKFORCE_CLAUDE_DOWNLOAD_BASE =
    await serveRelease(t, { version: '9.9.5', binary, checksum },
      { dieMidStream: opts.dieMidStream });
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
  // 📌 INERT ONCE A RUNNER IS INJECTED: run() returns runner(...) before it ever
  // consults DRY_RUN. Kept because the guard it trips is worth exercising, not
  // because this call changes what the sequence does.
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

test('a resolver that THROWS at the post-install gate fails cleanly instead of escaping', async (t) => {
  /* 🛑 THIS PINS THE ONE PRODUCTION BEHAVIOUR THIS BRANCH CHANGED WITHOUT AN ARM.
     The post-install gate used to build its failure message with `claudeBinPath()`,
     which is `resolveBin('claude').bin`. If the try entered the catch BECAUSE
     `resolveBin` threw, that same call threw again FROM INSIDE THE HANDLER and
     escaped `installClaudeCode` entirely: no `fail()` returned, and the downloaded
     file never unlinked. The path is now captured defensively before the guard.

     ⚠️ A reviewer found this was the only changed production behaviour on the branch
     with zero coverage, on a branch that added a both-directions arm for every other
     changed site. Found by grep: neither this file nor connect.hookwiring-1569
     drove that path, with a passing control (12 files reference willInstall).

     The failure is a RESOLVER throw, so the arm has to make the resolver throw. */
  const runners = require('./runners.js');
  const origResolve = runners.resolveBin;
  runners.resolveBin = () => { throw new Error('simulated resolver failure'); };
  try {
    const res = await withRelease(t, {});
    assert.equal(res.ok, false, 'a throwing resolver must produce a failure, not a success');
    assert.notEqual(res.cancelled, true, 'a resolver failure is not a cancellation');
    assert.match(String(res.detail || res.because || JSON.stringify(res)), /could not resolve the expected path/,
      'the failure message did not carry the defensive fallback, so the handler probably '
      + 'rebuilt the path with the same call that threw');
  } finally {
    runners.resolveBin = origResolve;
  }
});

test('CONTROL: the same flow with a working resolver succeeds', async (t) => {
  /* Without this, the arm above passes for any reason at all, including a flow that
     fails long before the post-install gate. */
  const res = await withRelease(t, {});
  assert.equal(res.ok, true,
    'the control install failed, so the throwing-resolver arm above proves nothing');
});


test('a cancelled install returns the CANCELLED shape AND never runs the installer', async (t) => {
  /**
   * 🛑 THE SHAPE ALONE DOES NOT PIN THIS BRANCH, AND ASSERTING ONLY THE SHAPE
   * LET A REAL MUTATION THROUGH. Measured: replacing the post-download
   * `if (hooks.cancelled())` with `if (false)` left EVERY test here and in
   * connect.test.js GREEN -- because the SECOND cancel site, after the
   * install child has already run, returns the same `{ok:false,cancelled:true}`.
   * So the flow emitted INSTALLING and EXECUTED THE INSTALLER for somebody who
   * had cancelled, and every assertion still passed.
   *
   * ✅ What separates the two sites is observable side effects, not the result:
   * the earlier branch must produce NO installing phase and NO install child.
   */
  const c = cancelWhenDownloadCompletes();
  const phases = [];
  const ran = [];
  const res = await withRelease(t, { ...c.hooks, onPhase: (p) => phases.push(p) }, {
    runner: (file, args) => { if (args && args[0] === 'install') ran.push(file); return { ok: true, stdout: '' }; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true, 'a cancellation must be distinguishable from a failure');
  assert.deepEqual(phases, [connect.PHASE.DOWNLOADING],
    'a flow cancelled after the download must never announce INSTALLING');
  assert.deepEqual(ran, [],
    'a flow cancelled after the download must never execute the installer');
  assert.deepEqual(downloadsMatching(/^claude-/), [],
    'a cancelled flow must not strand the 281MB binary it had already fetched');
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
  /**
   * 🛑 COUNT PROGRESS CALLS, NOT CANCEL CALLS, AND THE DIFFERENCE IS THE WHOLE
   * POINT OF THIS ARM. `cancelled()` fires once per chunk PLUS once at the
   * post-download check, so N chunks give N+1 calls and `cancelledCalls > 1` is
   * satisfied by a SINGLE-CHUNK download -- the exact delivery this test exists
   * to rule out. Measured: 32KB -> 1 chunk, cancelledCalls 2, guard passes.
   * `onProgress` fires exactly once per chunk, so it is the honest counter.
   */
  assert.ok(c.chunks > 1, `this arm must actually span multiple chunks (saw ${c.chunks})`);
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
  // ⚠️ `detail` IS PART OF THE DOCUMENTED CONTRACT and nothing asserted it.
  // Measured: `fail = (message, detail) => ({ ok: false, message })` was green
  // across the whole suite. It is what becomeStuck renders as the stuck
  // screen's `tail`, which is the field that turned out to carry the real
  // cause in kosmos#1551, so a second caller that drops it loses the diagnosis.
  assert.match(res.detail, /install exploded/,
    'the failure detail must carry the installer output, not be dropped');
});

// ── the hook contract ───────────────────────────────────────────────────────

test('a missing hook throws AT ENTRY, before any phase is written', async () => {
  for (const missing of ['cancelled', 'maySweepDownloads', 'wantsProgress', 'onPhase', 'onProgress']) {
    // ⚠️ A SHARED COUNTER, NOT THE onPhase RECORDER. When `missing` is
    // 'onPhase' the recorder is the very hook being deleted, so an assertion on
    // it is true by construction and that one iteration proves nothing.
    let fired = 0;
    const hooks = stubs({ onPhase: () => { fired += 1; }, onProgress: () => { fired += 1; } });
    delete hooks[missing];
    await assert.rejects(
      () => connect.installClaudeCode(hooks),
      (err) => err instanceof TypeError && new RegExp(missing).test(err.message),
      `omitting ${missing} must fail loudly at entry`,
    );
    // "AT ENTRY" is the half of the name that was previously aspirational:
    // without this, the guard could fire late and the test would not notice.
    assert.equal(fired, 0, `omitting ${missing} must abort before any hook fires`);
  }
});

test('CONTROL: the full stub set gets past the entry guard and SUCCEEDS', async (t) => {
  const res = await withRelease(t, {});
  assert.equal(res.ok, true, 'a complete hook set must reach the success path');
  // The success path deletes the downloaded artifact too, once it is installed.
  assert.deepEqual(downloadsMatching(/^claude-/), [],
    'a successful install must not leave the downloaded binary behind');
});

test('onPhase announces INSTALLING BEFORE the installer runs, not after', async (t) => {
  /**
   * 🛑 THE SEQUENCE ALONE IS HALF THE CONTRACT, AND THE MISSING HALF IS THE ONE
   * A PERSON SEES. Measured: moving `hooks.onPhase(PHASE.INSTALLING)` to AFTER
   * the `run(..., ['install'])` call leaves the WHOLE SUITE GREEN while
   * asserting the sequence, because the order of the two phase events is
   * unchanged. Under the real caller the board would then sit on DOWNLOADING
   * for the entire three-minute install and flip to INSTALLING for a
   * microsecond at the end.
   *
   * ✅ ONE ORDERED LOG, not two lists. Interleaving phase events with runner
   * calls is what makes "before" assertable at all; two separate arrays can
   * only ever show sequence within each.
   */
  const log = [];
  const res = await withRelease(t, { onPhase: (p) => log.push(`phase:${p}`) }, {
    runner: (file, args) => {
      if (args && args[0] === 'install') log.push('run:install');
      fs.writeFileSync(process.env.AGENT_WORKFORCE_CLAUDE_BIN, '#!/bin/sh\nexit 0\n');
      fs.chmodSync(process.env.AGENT_WORKFORCE_CLAUDE_BIN, 0o755);
      return { ok: true, stdout: '' };
    },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(log, [
    `phase:${connect.PHASE.DOWNLOADING}`,
    `phase:${connect.PHASE.INSTALLING}`,
    'run:install',
  ], 'INSTALLING must be announced before the installer executes, not after');
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

  /**
   * 🛑 THE COUNTS CANNOT PROVE THIS WENT MID-DOWNLOAD, AND AN EARLIER VERSION OF
   * THIS ASSERTION PRETENDED THEY COULD. Cancelling after the first chunk aborts
   * the stream, so only one progress event ever fires -- identical counts to a
   * single-chunk download cancelled afterwards. THE SWEEP IS THE DISCRIMINATOR:
   * it is reached only from the download-failure catch, so seeing it consulted
   * is what proves the abort happened in flight.
   */
  assert.ok(seen.sweep > 0, 'maySweepDownloads() must be consulted on a CANCELLED flow (#458)');
  assert.ok(!res.ok);
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

// ── arms the suite never drove before ───────────────────────────────────────

test('a download whose checksum does not match is a FAILURE, not a cancellation', async (t) => {
  // Also the only user of withRelease's badChecksum branch, which was
  // implemented and then orphaned when the #458 test stopped needing it.
  const res = await withRelease(t, {}, { badChecksum: true });
  assert.equal(res.ok, false);
  assert.ok(!res.cancelled, 'a refused checksum is a failure');
  assert.match(res.message, /could not download/);
});

test('an install that reports success but leaves no runnable binary is caught', async (t) => {
  /**
   * The `accessSync` arm. Verified untested before this: its message string
   * matched 0 test files against 1 for its sibling 'did not
   * finish setting itself up' -- BOTH figures taken on `main`, so the contrast
   * is within one tree. (On this branch they read 1 and 2, because this file
   * adds one of each; quoting one figure from each tree is not a comparison.) It is the case where the vendor installer exits 0 and puts the
   * binary somewhere we do not expect, which is indistinguishable from success
   * unless something checks the disk.
   */
  const res = await withRelease(t, {}, {
    runner: () => ({ ok: true, stdout: '' }),   // reports success, creates nothing
  });
  assert.equal(res.ok, false);
  assert.ok(!res.cancelled);
  /* ⚠️ ANCHORED ON THE STABLE HALF. This asserted the full old wording and went
     red when #1580 widened the message to cover a directory at that path, which
     is exactly right in kind but not what this test is about. It is about the
     ARM, so it matches the part that identifies the arm. */
  /* 🛑 #1570: THE SECOND ALTERNATIVE WAS DEAD AND IT IS GONE. It was the pre-#1580
     wording, kept when the message widened. Measured against the three `fail()`
     calls in `installClaudeCode`: none emits it, so that arm could never match.
     A regex alternative that cannot fire is not harmless - it makes the assertion
     LOOK like it covers two messages when one of them does not exist, which is the
     same use-versus-mention confusion the card is about, one layer along.
     ⚠️ The remaining half is still the one that identifies the ARM rather than the
     full sentence, which is what the note above is about and is unchanged. */
  assert.match(res.message, /cannot find anything runnable/);
  assert.deepEqual(downloadsMatching(/^claude-/), [],
    'a failed access check must not strand the downloaded binary');
  /**
   * ⚠️ AND THE 281MB GOES TOO. Measured, both arms: deleting the unlink from
   * this catch leaves `claude-9.9.5-darwin-arm64` behind, stranding a binary
   * per attempt -- the failure `engine/connect.test.js:216` prevents for the
   * sibling `!inst.ok` path, which had no guard on this one.
   *
   * 📌 I PREVIOUSLY WROTE THAT THIS ASSERTION WAS IMPOSSIBLE. It is not, and
   * the MEASURED cause is worth more than the line, because it was neither the
   * reason I gave nor the reason offered when I was corrected.
   *
   * 🛑 MY MUTATION WAS HITTING A DIFFERENT UNLINK. I located the branch by
   * searching for its message text, and that string ALSO APPEARS IN A COMMENT
   * two hundred lines earlier which quotes the wording. The backward search
   * from that comment landed on the post-download CANCEL unlink, so I was
   * deleting a line this test never reaches, seeing no change, and concluding
   * the assertion could not work. Anchoring on `return fail('Claude said it...`
   * instead turns it red immediately.
   *
   * ⭐ SEARCHING FOR A USER-FACING STRING FINDS THE COMMENT THAT QUOTES IT.
   * Anchor a mutation on the CALL, never on the message. And a comment
   * asserting a guard is impossible is worse than a missing guard, because
   * nobody re-derives it.
   */

});

test('cancel landing WHILE THE INSTALL CHILD RUNS returns the cancelled shape', async (t) => {
  // The second cancelled site, distinct from the post-download one: the person
  // clicks cancel after the download finished and while the installer is
  // executing. No test in the suite drove this path.
  let installStarted = false;
  const res = await withRelease(t, {
    cancelled: () => installStarted,
  }, {
    runner: (file, args) => { if (args && args[0] === 'install') installStarted = true; return { ok: true, stdout: '' }; },
  });
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true, 'a cancel during install is a cancellation, not a failure');
  assert.deepEqual(downloadsMatching(/^claude-/), [],
    'a cancel during install must not strand the downloaded binary either');
});

/**
 * ⚠️ TWO WRONG VEHICLES FOR TESTING THE SWEEP, BOTH TRIED, BOTH RECORDED.
 *
 * 1. A CHECKSUM REFUSAL: `download()` unlinks its own `.part` at
 *    connect.js:530 before throwing, so nothing is left and both arms match.
 * 2. A PLANTED STALE PARTIAL FROM ANOTHER VERSION: `download()` has its own
 *    PRE-download sweep that is NOT gated by the hook, so it clears the
 *    planted file before the failure happens. Measured: both arms empty.
 *
 * ✅ Only a genuine MID-STREAM DEATH leaves a `.part` at the moment the catch
 * block runs. Measured, both arms: true -> directory empty, false -> the
 * `.part` survives. That is what makes the hook's ANSWER observable rather
 * than merely its being CONSULTED.
 */
function downloadsMatching(re) {
  const dir = nodePath.join(store.ROOT, 'downloads');
  try { return fs.readdirSync(dir).filter((f) => re.test(f)); } catch { return []; }
}

function partialsIn() {
  const dir = nodePath.join(store.ROOT, 'downloads');
  try { return fs.readdirSync(dir).filter((f) => f.endsWith('.part')); } catch { return []; }
}

test('maySweepDownloads TRUE clears the partial left by a mid-stream death', async (t) => {
  const res = await withRelease(t, { maySweepDownloads: () => true }, { dieMidStream: true });
  assert.equal(res.ok, false, 'this arm needs the download to fail so the sweep is reached');
  assert.deepEqual(partialsIn(), [], 'a true maySweepDownloads must clear the partial');
});

test('CONTROL: maySweepDownloads FALSE leaves that partial in place', async (t) => {
  // Without this arm the pair pins only that the hook is CONSULTED. A mutation
  // that called the hook and then swept unconditionally would stay green.
  const res = await withRelease(t, { maySweepDownloads: () => false }, { dieMidStream: true });
  assert.equal(res.ok, false);
  assert.ok(partialsIn().length > 0, 'a false maySweepDownloads must suppress the sweep');
});

test('the cancel check runs BEFORE the wantsProgress gate, not behind it', async (t) => {
  /**
   * ⚠️ A LOAD-BEARING ORDERING WITH NO GUARD BEHIND IT UNTIL NOW. Measured:
   * moving the cancel check behind the `wantsProgress` gate survives every
   * other test in the repo. Under the real caller `wantsProgress` is
   * `mem.phase === PHASE.DOWNLOADING` and `cancel()` writes `PHASE.IDLE`, so a
   * cancelled download would stop self-aborting at chunk granularity and run
   * to completion. It is also the ordering this file's own fixture comment
   * depends on for being chunk-count independent.
   *
   * With wantsProgress FALSE, cancelled() must still be consulted every chunk.
   * If the gate came first, it would never be consulted at all.
   */
  let cancelledCalls = 0;
  await withRelease(t, {
    wantsProgress: () => false,
    cancelled: () => { cancelledCalls += 1; return false; },
  }, { bytes: 512 * 1024 });
  assert.ok(cancelledCalls > 2,
    `cancelled() must be consulted per chunk even when progress is gated off (saw ${cancelledCalls})`);
});
