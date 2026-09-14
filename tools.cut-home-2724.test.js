/**
 * The cut runs with an EMPTY home, so its gates stop reading the live fleet (#2724).
 *
 * The class: `tools/release.sh` runs on a box that is also running real agents and
 * carrying a live board, roster and data root. Several cut-time gates read that
 * live state instead of the tree they froze, so a cut reds on what the machine
 * happens to be doing. Each instance was fixed one at a time (#2259, #2124, the
 * #2696 area, #2718) and they keep arriving, because any NEW gate that reads the
 * store is a new instance.
 *
 * 🔑 THE PROPERTY THAT ACTUALLY MATTERS IS NOT THAT THE SCRIPT CONTAINS A LINE.
 * It is that the variable is EXPORTED, so a gate SUBPROCESS sees it, and that it
 * is exported BEFORE the gates run. A test that greps the source for
 * `AGENT_WORKFORCE_HOME=` passes on a plain assignment (no export, invisible to
 * every child) and on a line moved below the suite gate (isolating nothing). Both
 * of those are the defect, so the arms below drive the real script and read the
 * value out of a CHILD PROCESS.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL = path.join(__dirname, 'tools', 'release.sh');

/* `release.sh` resolves its repo as `dirname($0)/..`, so a copy at
   `<tmp>/tools/release.sh` sees `<tmp>` and nothing of ours. Same shape as
   tools.release-gate.test.js's sandbox. */
function sandbox(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix || 'kosmos-cuthome-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(REAL, path.join(dir, 'tools', 'release.sh'));
  /* ⚠️ THE LIBS ARE NOT OPTIONAL HERE, and this is the trap that makes a sandbox
     arm silently measure nothing. `release.sh` sources `tools/lib/cut-guard.sh`
     and friends, and under `set -e` a missing source KILLS THE RUN at that line.
     tools.release-gate.test.js copies only release.sh and is fine, because every
     refusal it asserts happens EARLIER than the sourcing. The cut home is set up
     LATER, so an arm about it needs the libs or it is asserting on a script that
     died before reaching the code under test. */
  fs.cpSync(path.join(__dirname, 'tools', 'lib'), path.join(dir, 'tools', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sandbox', version: '0.6.55' }, null, 2));
  /* The script refuses at line ~205 without a site checkout, which is BEFORE the
     cut home is set up. Give it a shaped-but-empty one so the run reaches the
     part these arms are about. */
  fs.mkdirSync(path.join(dir, 'site', 'dist'), { recursive: true });
  /* TMPDIR must not equal HOME: the cut refuses to derive its home from a TMPDIR that
     is a real directory, and these arms run with HOME pointed at the sandbox root. */
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  return dir;
}

/* The env every arm runs under.

   Two guards sit between the site check and the cut home and would otherwise stop
   every run here:

   - the live-HARNESS refusal, bypassed with the script's own documented
     KOSMOS_CUT_IGNORE_HARNESS.
   - the live-CUT refusal, which asks `pgrep` whether a `bash tools/release.sh` is
     running. 🛑 THAT ONE IS NOT HYPOTHETICAL AND IT COST A RED SUITE: these arms
     PASS ALONE AND FAIL IN THE FULL SUITE, because tools.release-gate.test.js is
     spawning its own sandbox copies of release.sh concurrently and pgrep sees
     them. (That file never trips the guard itself: every refusal it asserts
     happens at the version gate, ABOVE where the guard is even sourced.) So the
     arms here are pinned to cut-guard.sh's OWN documented seam, KOSMOS_CUT_PROBE
     ("so the guard can be shown red and green without a cut"), pointed at a stub
     that reports no cut. That makes these arms independent of whatever else on
     this shared Mac happens to be running, which a bypass flag would also do but
     less precisely: the seam exercises the real exclusion logic, the flag skips it.

   HOME is sandboxed too, which also keeps the guard's run-marker directory
   (${HOME}/.cache/kosmos-run-markers) inside the fixture rather than the
   operator's real one. */
function envFor(dir, bin, extra) {
  const env = {
    ...process.env,
    HOME: dir,
    TMPDIR: path.join(dir, 'tmp'),
    PATH: bin + path.delimiter + process.env.PATH,
  };
  /* 🛑 CLEAR THE TWO VARIABLES THESE ARMS ARE ABOUT, or they are decided by the
     environment instead of by the script. This is not hypothetical and it is the
     exact defect this whole change exists to fix, reproduced inside the file that
     asserts the fix:

     step 3 of release.sh runs `yarn test` WITH AGENT_WORKFORCE_HOME exported, so on
     a real cut this file inherits it. The opt-out arm asserts the child saw
     `<unset>`; under the cut it sees the cut's own home and the arm reds, the #2006
     isolation rerun reproduces it (same exported env), it is classified a real red,
     and THE CUT ABORTS AT STEP 3.

     Measured before the fix: 6/6 pass with no ambient value, 5/6 with one set.

     The plan's original measurement table could not see it, and the arithmetic says
     why: the "+ test fixes" arm ran 5930 tests (without this file) and the final arm
     ran 5936 (without an ambient home), so the one combination that describes a real
     cut was the one combination never measured. */
  /* ⚠️ CLEAR BY CONSTRUCTION, NOT BY ENUMERATION. Naming the two variables round 1
     happened to find leaves the next one live, and round 2 found it one variable over:
     an ambient `KOSMOS_CUT_CHANNEL=bogus` made release.sh refuse at line 37, long before
     the cut home, and six of eight arms failed on a value that has nothing to do with
     what they assert. (It failed LOUD, via the reached-step-1 guards, and cannot happen
     during a real cut because release.sh validates the channel itself. It is still the
     round-1 BLOCKER's shape, and a list of two names is not a defence against the third.)

     So: drop every KOSMOS_* and AGENT_WORKFORCE_* the parent happens to carry, then put
     back exactly the ones these arms need. A variable this file does not name cannot
     decide its result. */
  for (const k of Object.keys(env)) {
    if (k.startsWith('KOSMOS_') || k.startsWith('AGENT_WORKFORCE_')) delete env[k];
  }
  env.KOSMOS_CUT_IGNORE_HARNESS = '1';
  env.KOSMOS_CUT_PROBE = path.join(dir, 'bin', 'no-cut-probe');
  env.KOSMOS_SITE = path.join(dir, 'site');
  /* Pinned rather than inherited: the cut guard refuses on EITHER the pgrep arm (which
     KOSMOS_CUT_PROBE covers) OR a marker-file arm that reads
     ${KOSMOS_RUN_MARKER_DIR:-$HOME/.cache/kosmos-run-markers}. These arms were safe only
     because HOME is sandboxed above, which moved that directory as a side effect. Saying
     it out loud means a later edit to HOME cannot silently let a real cut's markers
     refuse them. */
  env.KOSMOS_RUN_MARKER_DIR = path.join(dir, 'run-markers');
  return { ...env, ...(extra || {}) };
}

/* rc=1 with no output is cut-guard.sh's "nothing matched", i.e. a clean no-cut. */
function writeProbe(bin) {
  const probe = path.join(bin, 'no-cut-probe');
  fs.writeFileSync(probe, '#!/bin/sh\nexit 1\n');
  fs.chmodSync(probe, 0o755);
}

/**
 * Run the real script far enough to pass the version gate and reach step 1.
 *
 * 🔑 THE FAKE `git` IS THE INSTRUMENT, not scenery. Step 1's first act is
 * `git -C "$REPO" fetch origin -q`. A stub earliest on PATH prints what the
 * CHILD sees in its environment, which is the only way to tell an `export` from
 * a bare assignment. It then exits non-zero so the cut stops there and never
 * touches anything.
 *
 * TMPDIR is pointed INTO the sandbox on purpose: the script derives its cut home
 * from TMPDIR, so this keeps the test off the shared path a real cut would use
 * (a test must not wipe a running cut's home).
 */
function runToStep1(extraEnv) {
  const dir = sandbox();
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'),
    '#!/bin/sh\necho "CHILD_SEES=[${AGENT_WORKFORCE_HOME-<unset>}]"\nexit 9\n');
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  writeProbe(bin);
  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), '0.6.56'], {
    encoding: 'utf8', cwd: dir, env: envFor(dir, bin, extraEnv),
  });
  return { dir, said: (r.stdout || '') + (r.stderr || '') };
}

test('#2724: the cut announces a cut-only home, and a GATE SUBPROCESS actually sees it', () => {
  const { dir, said } = runToStep1();

  /* The run must have reached step 1, or every assertion below is about a script
     that stopped earlier for an unrelated reason (a vacuous pass). */
  assert.match(said, /CHILD_SEES=\[/,
    'the run never reached step 1, so this arm proves nothing about the cut home: ' + said.slice(0, 400));

  const seen = /CHILD_SEES=\[([^\]]*)\]/.exec(said)[1];
  assert.notEqual(seen, '<unset>',
    'AGENT_WORKFORCE_HOME did not reach the gate subprocess, so it was assigned but never exported: the isolation is invisible to every gate');
  assert.equal(seen, path.join(dir, 'tmp', 'kosmos-cut-home'),
    'the child saw a different home than the one derived from TMPDIR');
});

test('#2724: the home the cut hands its gates EXISTS and is EMPTY', () => {
  const { dir, said } = runToStep1();
  assert.match(said, /cut-only home:/, 'the cut did not say what home it was using');
  const home = path.join(dir, 'tmp', 'kosmos-cut-home');
  assert.ok(fs.existsSync(home), 'the cut named a home it never created');
  assert.deepEqual(fs.readdirSync(home), [],
    'the cut home is not empty, so a gate can still read state left in it');
});

test('#2724 CONTROL: the cut home is NOT the operator home, which is the whole point', () => {
  const { dir, said } = runToStep1();
  const seen = /CHILD_SEES=\[([^\]]*)\]/.exec(said)[1];
  assert.notEqual(seen, os.homedir(),
    'the gates were handed the real home, so nothing is isolated');
  assert.notEqual(seen, dir,
    'the cut home is the sandbox HOME itself rather than a separate empty leaf');
});

test('#2724: a pre-existing cut home is EMPTIED, so one cut cannot read the last one leftovers', () => {
  /* The dir is deliberately a fixed leaf rather than a fresh mktemp, so a failed
     cut leaves it behind to inspect. That is only safe if the NEXT cut wipes it:
     otherwise state from a previous cut is exactly the live state this card is
     about, one cut removed. */
  const dir = sandbox('kosmos-cuthome-pre-');
  const home = path.join(dir, 'tmp', 'kosmos-cut-home');
  fs.mkdirSync(path.join(home, 'Library'), { recursive: true });
  fs.writeFileSync(path.join(home, 'leftover.json'), '{"from":"the last cut"}');

  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nexit 9\n');
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  writeProbe(bin);
  const pre = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), '0.6.56'], {
    encoding: 'utf8', cwd: dir, env: envFor(dir, bin),
  });
  const said = (pre.stdout || '') + (pre.stderr || '');
  assert.match(said, /cut-only home:/,
    'the run never reached the cut-home block, so the leftover surviving proves nothing: ' + said.slice(0, 400));

  assert.ok(fs.existsSync(home), 'the cut removed the home and did not recreate it');
  assert.deepEqual(fs.readdirSync(home), [],
    'a previous cut leftover survived into this cut, which is the same leak one cut removed');
});

test('#2724: KOSMOS_CUT_LIVE_HOME=1 opts out, and the opt-out is the ONLY difference', () => {
  const { said } = runToStep1({ KOSMOS_CUT_LIVE_HOME: '1' });

  /* 🛑 THE DISCRIMINATING HALF. "The line is absent" is also what a script that
     aborted three steps earlier prints, so absence alone would pass on a broken
     script. Assert the run still reached step 1 before reading the absence. */
  assert.match(said, /CHILD_SEES=\[/,
    'the opt-out run never reached step 1, so its silence about the cut home proves nothing');
  assert.doesNotMatch(said, /cut-only home:/,
    'KOSMOS_CUT_LIVE_HOME=1 did not opt out; the cut still redirected the home');

  const seen = /CHILD_SEES=\[([^\]]*)\]/.exec(said)[1];
  assert.equal(seen, '<unset>',
    'the opt-out left AGENT_WORKFORCE_HOME exported anyway, so it opts out of the message and not the behaviour');
});

test('#2724: the home is exported BEFORE the suite gate, which is the half a grep cannot see', () => {
  /* A correct export placed below step 3 isolates nothing and looks identical in
     every content-based check. Ordering is the property, so assert on position,
     and assert BOTH anchors matched: if either regex stops matching (the line is
     reworded, the gate is restructured) this must fail loudly rather than compare
     two -1s and pass. */
  const src = fs.readFileSync(REAL, 'utf8');
  /* Anchored to the start of a line, and to a REAL statement rather than any mention:
     `indexOf` on a bare substring takes the FIRST occurrence, and the block above the
     export already names this variable repeatedly in prose. One future comment line
     containing the literal, placed above the suite gate, would satisfy the old form
     no matter where the real export sat. */
  const exportRe = /^\s*export AGENT_WORKFORCE_HOME=/m;
  const m = exportRe.exec(src);
  const exportAt = m ? m.index : -1;
  const suiteAt = src.indexOf('yarn test >"$_suite_log"');
  assert.notEqual(exportAt, -1, 'no `export AGENT_WORKFORCE_HOME=` statement in release.sh: the isolation is gone, or it is a bare assignment no child can see');
  assert.notEqual(suiteAt, -1, 'the step-3 suite gate no longer matches, so this ordering assertion stopped measuring anything');
  assert.ok(exportAt < suiteAt,
    'the cut home is exported AFTER the suite gate runs, so the suite still reads the live fleet');
});

test('#2724: the TMPDIR guard can actually FIRE, which the version it replaced could not', () => {
  /* The first version of this guard asked whether the DERIVED path was `/`, `/tmp` or
     `$HOME`. It never could be: the leaf is always appended. So it read as protection in
     review and could not return the dangerous answer for any value of TMPDIR. The guard
     now asks about TMPDIR itself, and this arm is the proof that it fires. */
  const dir = sandbox('kosmos-cuthome-guard-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nexit 9\n');
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  writeProbe(bin);

  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), '0.6.56'], {
    encoding: 'utf8', cwd: dir,
    /* TMPDIR = the run's own HOME: this is the shape that would have made the previous
       guard run `rm -rf $HOME/kosmos-cut-home` while reporting itself satisfied. */
    env: { ...envFor(dir, bin), TMPDIR: dir, HOME: dir },
  });
  const said = (r.stdout || '') + (r.stderr || '');
  assert.match(said, /refusing to derive the cut-only home from TMPDIR=/,
    'the cut derived its home from a TMPDIR equal to HOME and did not refuse: ' + said.slice(0, 300));
  assert.doesNotMatch(said, /cut-only home:/, 'it refused and then used one anyway');
});

test('#2724: the page gate is EXPLICITLY excluded from the cut home, and says why', () => {
  /* Measured: 7 of the 9 board boot sites in tools/browser-checks.sh do not set
     AGENT_WORKFORCE_HOME, so they read the operator's home for accounts (5 accounts
     ambient, 0 under an empty home), and create.js refuses a Claude create with no
     default account. The page gate was therefore left on the old behaviour rather than
     changed unmeasured. `env -u` is that exclusion, and this arm keeps it deliberate:
     if someone removes it, the page layer silently starts running under the cut home
     and ~25 checks change behaviour with nobody having run them. */
  const src = fs.readFileSync(REAL, 'utf8');
  const line = src.split('\n').find((l) => l.includes('bash tools/browser-checks.sh'));
  assert.ok(line, 'the page gate invocation no longer matches, so this arm stopped measuring anything');
  assert.match(line, /env -u AGENT_WORKFORCE_HOME/,
    'the page gate now inherits the cut home, which is the one gate whose boards were never measured under it');
});

test('#2724: an ambient KOSMOS_* or AGENT_WORKFORCE_* cannot decide what these arms measure', () => {
  /* The round-1 BLOCKER was an arm whose verdict came from the environment. Round 2 found
     the same shape one variable over (KOSMOS_CUT_CHANNEL). This arm is the general form:
     it drives the script with a spread of hostile ambient values and asserts the cut home
     still comes out of the script. If envFor ever goes back to deleting a named list,
     this fails. */
  const hostile = {
    KOSMOS_CUT_CHANNEL: 'bogus',
    KOSMOS_CUT_LIVE_HOME: '1',
    KOSMOS_RUN_MARKER_DIR: '/nonexistent/markers',
    KOSMOS_CUT_SELF_PID: '1',
    AGENT_WORKFORCE_HOME: '/nonexistent/ambient-home',
    AGENT_WORKFORCE_DATA: '/nonexistent/ambient-data',
  };
  const dir = sandbox('kosmos-cuthome-amb-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'),
    '#!/bin/sh\necho "CHILD_SEES=[${AGENT_WORKFORCE_HOME-<unset>}]"\nexit 9\n');
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  writeProbe(bin);

  /* The hostile values go in the PARENT, which is what a real cut does to this file. */
  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), '0.6.56'], {
    encoding: 'utf8', cwd: dir, env: envFor(dir, bin),
  });
  const said = (r.stdout || '') + (r.stderr || '');
  assert.match(said, /CHILD_SEES=\[/, 'the run did not reach step 1: ' + said.slice(0, 300));
  const seen = /CHILD_SEES=\[([^\]]*)\]/.exec(said)[1];
  assert.equal(seen, path.join(dir, 'tmp', 'kosmos-cut-home'),
    'the child saw something other than the script-derived cut home');

  /* And the control that makes the above mean something: the same hostile values present
     in this process's own env, proving envFor is what neutralises them rather than their
     simply being absent. */
  const saved = {};
  for (const [k, v] of Object.entries(hostile)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    const r2 = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), '0.6.56'], {
      encoding: 'utf8', cwd: dir, env: envFor(dir, bin),
    });
    const said2 = (r2.stdout || '') + (r2.stderr || '');
    assert.match(said2, /CHILD_SEES=\[/,
      'an ambient KOSMOS_*/AGENT_WORKFORCE_* value reached the script and changed where it stopped: ' + said2.slice(0, 300));
    const seen2 = /CHILD_SEES=\[([^\]]*)\]/.exec(said2)[1];
    assert.equal(seen2, path.join(dir, 'tmp', 'kosmos-cut-home'),
      'an ambient value decided the cut home instead of the script');
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('#2724: a RELATIVE TMPDIR is refused, because the exported home would follow each gate cwd', () => {
  const dir = sandbox('kosmos-cuthome-rel-');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nexit 9\n');
  fs.chmodSync(path.join(bin, 'git'), 0o755);
  writeProbe(bin);
  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), '0.6.56'], {
    encoding: 'utf8', cwd: dir, env: { ...envFor(dir, bin), TMPDIR: 'reltmp' },
  });
  const said = (r.stdout || '') + (r.stderr || '');
  assert.match(said, /refusing to derive the cut-only home from a RELATIVE TMPDIR/,
    'a relative TMPDIR was accepted, so AGENT_WORKFORCE_HOME would resolve against each gate own cwd: ' + said.slice(0, 300));
  assert.doesNotMatch(said, /cut-only home:/, 'it refused and then used one anyway');
});

test('#2724: the operator-facing line does NOT claim the fleet roster is isolated', () => {
  /* Round 1 corrected this overclaim in the comments and the plan and MISSED the emitted
     string, which is the only one a person reads at cut time. Pinned so it cannot drift
     back: the comment and the message have to keep agreeing. */
  const src = fs.readFileSync(REAL, 'utf8');
  const line = src.split('\n').find((l) => l.includes('echo "cut-only home:'));
  assert.ok(line, 'the cut-home announcement no longer matches, so this arm stopped measuring anything');
  assert.doesNotMatch(line, /read no live fleet state/,
    'the emitted line still claims the gates read no live fleet state; the roster and the config-root scan are NOT isolated by this change');
  assert.match(line, /NOT isolated/,
    'the emitted line no longer says what this change does not cover');
});
