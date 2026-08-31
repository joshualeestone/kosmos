'use strict';
/**
 * WOULD CONNECTING CLAUDE HAVE TO DOWNLOAD IT FIRST? (#1556)
 *
 * 🛑 THE CLIENT ASKED AND THE SERVER NEVER ANSWERED. `frClaudeInstallNeeded()` reads
 * `willInstall` and FAILS OPEN when it is absent, so the 281MB download prompt was
 * shown to everybody, including people who already have a working Claude Code. The
 * consumer was correct; the field was unbuilt.
 *
 * 🛑 THE TWO ERRORS ARE NOT EQUAL, AND THAT ASYMMETRY IS THE DESIGN:
 *
 *   we say TRUE  and it was false  ->  one needless confirm dialog
 *   we say FALSE and it was true   ->  AN UNANNOUNCED 281MB DOWNLOAD
 *
 * Josh asked for the confirm step by name. So every arm below that could produce the
 * second answer is checked, and the cheap `accessSync` runs EVERY time so it can only
 * ever move the verdict toward "yes, we will install".
 *
 * ⭐ THE THIRD ARM IS THE WHOLE POINT AND IT IS THE ONE A SIMPLER FIX WOULD MISS. A
 * truncated or half-written launcher passes `X_OK` forever. "A file is there" is not
 * "it runs", and only `--version` separates them. A fix that checked existence alone
 * would report "installed" for a binary that cannot start, which is exactly the
 * harmful direction.
 */
/**
 * ⚠️ THE ARMS IN THIS FILE ARE ORDER-COUPLED, AND NOTHING ENFORCES IT.
 * The first three (no binary / a launcher that runs / one that exists and does not)
 * exercise the REAL `run()` only because they precede the first `connect.setRunner(...)`
 * call further down. Once any arm injects a runner, every later arm runs against the
 * seam, and `setRunner(null)` cannot restore "no runner, not dry" - it forces dry-run
 * back on instead. That interlock is why the dry-run case lives in its own file.
 *
 * ⇒ A REORDER WOULD SILENTLY CONVERT THREE REAL-EXECUTION ARMS INTO SEAM ARMS and
 * nothing would go red. If you add an arm, add it after the injected ones, or move it
 * into its own file the way the dry-run arm is.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { mkTemp } = require('../test-support/tmpdir.js');
const SB = mkTemp('aw-willinstall-1556-');
process.env.AGENT_WORKFORCE_DATA = path.join(SB, 'data');
process.env.AGENT_WORKFORCE_HOME = SB;

const connect = require('./connect');


/** A real executable, because the probe runs a real subprocess. */
function fakeClaude(name, body) {
  const p = path.join(SB, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
  return p;
}

test('#1556: no binary means an install IS needed, decided without a probe', () => {
  delete process.env.AGENT_WORKFORCE_CLAUDE_BIN;
  connect.resetForTests();
  return connect.willInstall().then((w) => {
    assert.equal(w, true, 'a machine with no Claude was told no install is needed');
    /* 📌 A "this finished fast, so the accessSync gate must be gating" assertion used
       to sit here. It could NOT fail for the reason it stated: `run()` on a
       nonexistent path fails with ENOENT in milliseconds rather than at the timeout,
       so the arm stayed green whether or not the gate existed. Removed rather than
       retuned, for the same reason the cache arm below counts probes instead of
       timing them. The `w === true` assertion is what carries this test. */
  });
});

test('#1556: a binary that RUNS means no install is needed', async () => {
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-good', 'echo "1.2.3"; exit 0');
  connect.resetForTests();
  assert.equal(await connect.willInstall(), false,
    'a working Claude was reported as needing a 281MB download');
});

test('#1556 THE POINT: a binary that EXISTS and does NOT run still needs an install', async () => {
  /* X_OK passes on this file. Only the probe can tell. A fix that checked existence
     alone would say "installed" here and start an unannounced download. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-broken', 'exit 1');
  connect.resetForTests();
  assert.equal(await connect.willInstall(), true,
    'a broken launcher was reported as installed, which is the unannounced-download case');
});

test('#1556: the cache is ONE-SIDED, so a binary going missing is noticed at once', async () => {
  /* Cache a positive, then take the binary away WITHOUT clearing the cache. The cheap
     check must override it, because staying cached here is the harmful direction. */
  const bin = fakeClaude('claude-vanishing', 'exit 0');
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bin;
  connect.resetForTests();
  assert.equal(await connect.willInstall(), false, 'the fixture did not cache a positive');
  fs.rmSync(bin);
  assert.equal(await connect.willInstall(), true,
    'a cached positive survived the binary being deleted, so we would download nothing and start nothing');
});

test('#1556: the probe result IS cached, so overlapping callers do not each spawn one', async () => {
  /* 📌 TWO EARLIER DRAFTS OF THIS COMMENT WERE WRONG AND BOTH ARE RECORDED, because a
     wrong rationale reads as checked. The first said "the route calls this on every
     /api/connect GET": that design was abandoned, /api/connect is byte-identical to
     main, and the only consumer is /api/first-run via firstrun.state(). The second
     said "a subprocess per poll", and there is no poll on that route.

     What is true: page boot and "Check again" can overlap, and a cache written after
     an await is not a cache yet, so without this the overlapping callers each pay
     their own subprocess.

     ⚠️ The mangled version of this block was produced by my own comment-rewrapping
     script, which prefixed every continuation line with `/*`. It PARSED, so
     `node --check` was green and nothing caught it. A syntax check is not a
     correctness check for prose. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-slow', 'sleep 0.3; exit 0');
  connect.resetForTests();
  /* ⭐ COUNTED, NOT TIMED. This asserted `warm < cold / 2` against a sleeping
     fixture, which is a proxy for the property and a flaky one: the box this runs
     on already reports suite contention, and a stalled scheduler reds a correct
     cache. Counting probes asserts the actual claim -- "the second call did not
     re-probe" -- and cannot be moved by load. */
  let probes = 0;
  connect.setRunner(async () => { probes += 1; return { ok: true, stdout: '' }; });
  await connect.willInstall();
  assert.equal(probes, 1, 'the cold call did not run the probe');
  await connect.willInstall();
  assert.equal(probes, 1, `the second call re-probed: ${probes} probes for two calls`);
});

test('#1556 concurrent callers share ONE probe, they do not each start their own', async () => {
  /* 🛑 THE CACHE IS WRITTEN AFTER AN AWAIT, so before coalescing every caller
     arriving during a cold probe missed it and spawned its own `claude --version`.
     That is acute when this was served on the 1000ms-timer route; still
     real for page boot overlapping "Check again".

     ⚠️ NOTE WHAT THIS TEST WOULD HAVE DONE BEFORE THE FIX: it fails at 8, not 1.
     Perturbation, measured: remove the in-flight guard and this goes red alone. */
  const sb = fakeClaude('claude-concurrent', 'exit 0');
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = sb;
  connect.resetForTests();
  let probes = 0;
  connect.setRunner(async () => {
    probes += 1;
    await new Promise((r) => setTimeout(r, 30));   // still in flight when the others arrive
    return { ok: true, stdout: '' };
  });
  const answers = await Promise.all(Array.from({ length: 8 }, () => connect.willInstall()));
  assert.equal(probes, 1, `8 concurrent callers started ${probes} probes`);
  assert.deepEqual(answers, Array(8).fill(false), 'the shared probe did not reach every caller');
});
test('#1556: it never throws, whatever the binary does', async () => {
  /* A missing answer must never become a confident one. The route falls back to
     today's behaviour on a rejection, so a throw here would be a silent regression. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = path.join(SB, 'not-a-thing-at-all');
  connect.resetForTests();
  assert.equal(await connect.willInstall(), true);
});

test('#1556 "never throws" covers the RESOLVER too, not just a missing file', async () => {
  /* ⚠️ THE DOC BLOCK PROMISES THIS FUNCTION NEVER THROWS, and the only test for it
     exercised a missing binary. The resolver can throw on its own account (it
     derives a home directory and joins paths before it ever asks about the file),
     and it used to sit OUTSIDE the guard. So the stated property was not the
     property pinned.
     Perturbation, CURRENT AND FOLLOWABLE: hoist the
     `require('./runners').resolveBin('claude')` call out of `willInstall`'s try in
     connect.js, and this arm rejects while the others stay green.
     📌 The recipe used to say "move `claudeBinPath()` back out of the try". #1592
     removed that call from this path, so the one instruction telling a maintainer
     how to prove this arm still works had become unfollowable. The arm itself never
     stopped working: the 1556 wiring swaps `runners.resolveBin`, which is what
     `willInstall` now calls directly. */
  const runners = require('./runners.js');
  const orig = runners.resolveBin;
  runners.resolveBin = () => { throw new Error('resolver exploded'); };
  try {
    connect.resetForTests();
    assert.equal(await connect.willInstall(), true,
      'a resolver failure is an unknown, and every unknown here means an install is needed');
  } finally {
    runners.resolveBin = orig;
    connect.resetForTests();
  }
});

/* 📌 PLACED HERE, NOT WITH THE EARLY ARMS, PER THIS FILE'S HEADER RULE. It was
   originally inserted between arms 2 and 3, before the injected ones. Harmless as
   written (it patches Module._load and injects no runner), but the rule is
   unconditional and the next arm added at that position by analogy may well call
   setRunner, silently converting three real-execution arms into seam arms with
   nothing going red. Sits beside its sibling resolver arm instead. */
test('#1556 "never throws" covers a runners LOAD failure, not only a resolver throw', async () => {
  /* 🛑 THIS PINS A PROPERTY THAT WAS DEFENDED BY A COMMENT ALONE.
     `willInstall` requires `./runners` INSIDE its try on purpose: the try converts
     any failure into a DEFINED answer (install needed), which is the safe direction.
     The same lazy-require shape was correctly HOISTED out of devicedoor.js and
     githubdevice.js, where it sat in a Promise executor that promises never to
     reject, and a sweep following that precedent would hoist this one too.

     ⚠️ THE SIBLING ARM ABOVE CANNOT CATCH THAT. It swaps `runners.resolveBin` on the
     ALREADY-LOADED module object, so by the time it runs `runners` is cached and the
     require cannot fail. It proves the RESOLVER-throw arm and is silent on whether
     the require sits inside the try. So hoisting would have gone green.

     The failure this arm forbids is a LOAD failure, so it has to break the load. */
  const Module = require('module');
  const origLoad = Module._load;
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-loadfail', 'echo "1.2.3"; exit 0');
  connect.resetForTests();
  try {
    /* CONTROL FIRST, so a passing result means something: with runners loadable, a
       real executable answers false. If this ever returns true the arm below proves
       nothing, because every path returns true. */
    assert.equal(await connect.willInstall(), false,
      'control: a runnable launcher should not need an install, so the arm below is not vacuous');

    Module._load = function (request, ...rest) {
      if (request === './runners') throw new Error('simulated runners load failure');
      return origLoad.call(this, request, ...rest);
    };
    connect.resetForTests();
    assert.equal(await connect.willInstall(), true,
      'a runners LOAD failure escaped willInstall instead of resolving to "install needed"; '
      + 'the require was probably hoisted out of the try');
  } finally {
    Module._load = origLoad;
    connect.resetForTests();
  }
});

test('#1556 the cache is keyed on the BINARY, not just on time', async () => {
  /* ⚠️ NOTHING PINNED THIS. Every other arm calls resetForTests() before changing
     the fixture, so no test ever presented a cached verdict for a DIFFERENT path,
     and dropping `probeCache.bin === bin` would have gone unnoticed.

     The failure it guards is the harmful one: a machine whose resolved launcher
     path CHANGES would keep serving the old path's verdict, and the old verdict
     can be `false` while the new path has nothing runnable on it.

     One runner for both arms, deciding from the path it is handed, and NO reset
     between them: the keying is the only thing that can produce the right answer. */
  const good = fakeClaude('claude-keyed-good', 'exit 0');
  const bad = fakeClaude('claude-keyed-bad', 'exit 1');
  connect.resetForTests();
  connect.setRunner(async (file) => ({ ok: file.endsWith('claude-keyed-good'), stdout: '' }));

  process.env.AGENT_WORKFORCE_CLAUDE_BIN = good;
  assert.equal(await connect.willInstall(), false, 'the working launcher was misread');

  process.env.AGENT_WORKFORCE_CLAUDE_BIN = bad;   // deliberately no reset
  assert.equal(await connect.willInstall(), true,
    'a DIFFERENT launcher was served the previous path\'s cached verdict');
});

test('#1556 a probe already in flight must NOT land in the cache after a reset', async () => {
  /* 🛑 THE HOLE THE GENERATION COUNTER CLOSES, AND IT HAD NO TEST UNTIL I PERTURBED
     IT AND WATCHED IT SURVIVE. resetForTests() clears the cache, but a probe that
     was ALREADY RUNNING still resolves afterwards and would write its verdict in.
     The reset seam's own comment argues a partial reset is worse than none, because
     the verdict it carries into the next arm can be the harmful `false`. This is
     that window, so it needed an arm rather than an argument. */
  const good = fakeClaude('claude-gen', 'exit 0');
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = good;
  connect.resetForTests();
  let probes = 0;
  connect.setRunner(async () => {
    probes += 1;
    await new Promise((r) => setTimeout(r, 40));
    return { ok: true, stdout: '' };
  });

  const inFlight = connect.willInstall();   // starts under generation N
  connect.resetForTests();                  // bumps to N+1 while it is still running
  await inFlight;

  const before = probes;
  await connect.willInstall();
  assert.equal(probes, before + 1,
    'the pre-reset probe wrote its verdict into the cache, so the next call was served stale');
});

test('#1556 the cached verdict EXPIRES, and nothing proved that before', async () => {
  /* ⚠️ THE TTL HAD NO SEAM AND NO TEST. Every other arm either hits a warm cache or
     resets it, so nothing ever waited for an entry to age out, and a typo turning
     60000 into 600000 would have been invisible to the whole suite.

     The direction that matters: an expired entry is how a person who INSTALLS Claude
     while the board is open stops being told they need to install it. Without expiry
     that correction never arrives. */
  process.env.AGENT_WORKFORCE_CLAUDE_BIN = fakeClaude('claude-ttl', 'exit 0');
  connect.resetForTests();
  let probes = 0;
  connect.setRunner(async () => { probes += 1; return { ok: true, stdout: '' }; });
  try {
    connect.setProbeTtlForTests(20);
    await connect.willInstall();
    assert.equal(probes, 1, 'the cold call did not probe');
    await connect.willInstall();
    assert.equal(probes, 1, 'the warm call re-probed inside the TTL');
    await new Promise((r) => setTimeout(r, 40));   // past the 20ms TTL
    await connect.willInstall();
    assert.equal(probes, 2, 'the entry never expired, so a launcher installed later is never noticed');
  } finally {
    connect.setProbeTtlForTests();   // back to the real 60s
  }
});
