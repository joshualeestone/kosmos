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
  return {
    ...process.env,
    HOME: dir,
    TMPDIR: dir,
    PATH: bin + path.delimiter + process.env.PATH,
    KOSMOS_SITE: path.join(dir, 'site'),
    KOSMOS_CUT_IGNORE_HARNESS: '1',
    KOSMOS_CUT_PROBE: path.join(dir, 'bin', 'no-cut-probe'),
    ...(extra || {}),
  };
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
  assert.equal(seen, path.join(dir, 'kosmos-cut-home'),
    'the child saw a different home than the one derived from TMPDIR');
});

test('#2724: the home the cut hands its gates EXISTS and is EMPTY', () => {
  const { dir, said } = runToStep1();
  assert.match(said, /cut-only home:/, 'the cut did not say what home it was using');
  const home = path.join(dir, 'kosmos-cut-home');
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
  const home = path.join(dir, 'kosmos-cut-home');
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
  const exportAt = src.indexOf('export AGENT_WORKFORCE_HOME=');
  const suiteAt = src.indexOf('yarn test >"$_suite_log"');
  assert.notEqual(exportAt, -1, 'no `export AGENT_WORKFORCE_HOME=` in release.sh: the isolation is gone, or it is a bare assignment no child can see');
  assert.notEqual(suiteAt, -1, 'the step-3 suite gate no longer matches, so this ordering assertion stopped measuring anything');
  assert.ok(exportAt < suiteAt,
    'the cut home is exported AFTER the suite gate runs, so the suite still reads the live fleet');
});
