'use strict';

/**
 * After 0.2.99 comes 0.3.0, and the release script refuses anything else.
 *
 * 🔑 Josh, 2026-08-22: "since we are getting close, when we get to 0.2.99 then
 * lets roll to 0.3.00". A rule in a card depends on whoever is awake at 0.2.99
 * having read it, and at the current rate that is three weeks and several
 * people from now. The version is a bare argument to the script, so nothing
 * else stops `0.2.100` being typed at the one moment nobody is thinking about
 * it, and by then it is published and polled by every install.
 *
 * 🛑 EVERY RUN HERE IS AGAINST A COPY, AND THE FIRST VERSION OF THIS FILE WAS
 * NOT. It spawned `tools/release.sh` out of the repo the tests live in, and
 * `release.sh` derives its repo from its own path — so during `yarn release
 * 0.2.80`, step 3 ran the suite, this file ran the real release script with the
 * version in its argument, and that run bumped package.json, committed
 * "v0279 -- version" and PUSHED it, on top of the 0.2.80 bump made ninety
 * seconds earlier. The outer build then stamped the wrong version and the
 * release refused itself.
 *
 * ⚠️ THE LESSON IS NOT "BE CAREFUL WITH THE ARGUMENT". A test that invokes a
 * tool which acts on the tree it lives in has no safe argument: the guard has
 * to be that the tool cannot see that tree at all. So the script is copied into
 * a temp directory with a package.json beside it, which is everything the gate
 * reads, and HOME and KOSMOS_SITE point there too — so the first thing the
 * script needs after the gate, a site checkout, is not there and it stops dead.
 * Before any bump, commit, push, build or deploy, and before it can even reach
 * the operator''s real repository or their real site.
 *
 * ⚠️ AND EVERY CASE ASSERTS THE COPY WAS NOT MODIFIED, because "it exited early"
 * is a claim about behaviour and the file is the evidence.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REAL = path.join(__dirname, 'tools', 'release.sh');

/**
 * A disposable repo-shaped directory holding only what the gate reads.
 *
 * `release.sh` resolves its repo as `dirname($0)/..`, so a copy at
 * `<tmp>/tools/release.sh` sees `<tmp>` and nothing of ours.
 */
function sandbox(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gate-'));
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(REAL, path.join(dir, 'tools', 'release.sh'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sandbox', version }, null, 2));
  return dir;
}

function run(dir, version) {
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  /* ⚠️ HOME and the site path are pointed at the sandbox too. The script reads
     `KOSMOS_SITE` and falls back to `$HOME/work/chaoskosmos-site`; a run that
     got further than expected must not find the operator's real site checkout
     sitting where it looks. */
  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), version], {
    encoding: 'utf8',
    cwd: dir,
    env: { ...process.env, HOME: dir, KOSMOS_SITE: path.join(dir, 'nowhere') },
  });
  const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  return { said: (r.stdout || '') + (r.stderr || ''), status: r.status, touched: before !== after };
}

test('a version past the end of the 0.2 line is refused', () => {
  const dir = sandbox('0.2.78');
  const r = run(dir, '0.2.100');
  assert.equal(r.status, 1);
  assert.match(r.said, /past the end of the 0\.2 line/);
  assert.equal(r.touched, false, 'it edited the version before refusing it');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.2.99, anything but 0.3.0 is refused', () => {
  /* The arm that matters, and it is exercised rather than read: the sandbox is
     what makes standing at 0.2.99 free. */
  const dir = sandbox('0.2.99');
  const r = run(dir, '0.2.100');
  assert.equal(r.status, 1);
  assert.match(r.said, /last of the 0\.2 line/);
  assert.match(r.said, /0\.3\.0/, 'the refusal does not name the version it wants');
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.2.99, 0.3.0 gets through', () => {
  /* 🔑 THE POSITIVE CONTROL, and without it every test above passes on a script
     that refuses everything. "Through" means it reached the first thing the
     script needs and stopped there, on a site checkout the sandbox does not
     have — which is one line further than the gate and still before anything
     is read, written or fetched. */
  const dir = sandbox('0.2.99');
  const r = run(dir, '0.3.0');
  assert.ok(!/line/.test(r.said.split('\n')[0] || ''), 'the gate refused the successor it names');
  assert.match(r.said, /no site checkout at/);
  assert.equal(r.touched, false, 'it got far enough to edit the version, which this must never do');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.2.99, the string Josh actually said is refused too', () => {
  /**
   * 🛑 "0.3.00" IS THE LIKELIEST THING TO BE TYPED, because it is the string in
   * his instruction: "when we get to 0.2.99 then lets roll to 0.3.00". The gate
   * wants "0.3.0" and the test above only proves it refuses 0.2.100, which
   * nobody was ever going to type at this point.
   *
   * 🔑 AND REFUSING IT IS CORRECT RATHER THAN PEDANTIC. `engine/update.js`
   * parses a version into three NUMBERS, so "0.3.00" and "0.3.0" are the same
   * version to every install: neither is newer than the other. Publishing one
   * and then the other would be an update that no machine ever sees, which is
   * the silent-no-update failure this project has already shipped once. One
   * spelling per version is what keeps `newer` a total order.
   */
  const dir = sandbox('0.2.99');
  const r = run(dir, '0.3.00');
  assert.equal(r.status, 1, 'a second spelling of 0.3.0 was allowed to publish');
  assert.match(r.said, /0\.3\.0/, 'the refusal does not name the version it wants');
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an ordinary next version is not refused', () => {
  const dir = sandbox('0.2.78');
  const r = run(dir, '0.2.79');
  assert.ok(!/end of the 0\.2 line|last of the 0\.2 line/.test(r.said), r.said.slice(0, 200));
  assert.match(r.said, /no site checkout at/);
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('it refuses rather than correcting', () => {
  /* ⚠️ Silently shipping 0.3.0 when somebody asked for 0.2.100 is a release
     nobody named, and the entry they already wrote on the versions page is
     stamped with what they typed. */
  const s = fs.readFileSync(REAL, 'utf8');
  assert.ok(!/V="0\.3\.0"/.test(s), 'the gate rewrites the version instead of refusing it');
});

/**
 * From the 0.6 line on, the patch is two digits (#1352).
 *
 * 🔑 Josh, 2026-08-28: he did not want 0.5.100 and up, he wanted "0.6.00 and
 * then 0.6.01". Same argument as the 0.2 guard above, and it is his own: a rule
 * that lives in a message depends on whoever is awake having read it.
 *
 * ⚠️ THE TEST ABOVE ASSERTS THE OPPOSITE FOR THE 0.2 LINE AND BOTH ARE RIGHT.
 * "0.3.00" is refused there because it is a SECOND SPELLING of 0.3.0, and
 * engine/update.js compares three numbers, so publishing both is an update no
 * machine ever sees. Josh's scheme is safe for exactly that reason: from 0.6 on
 * the padded form is the ONLY form. The rule was never "do not pad", it is "one
 * spelling per line".
 */

test('on the 0.6 line an unpadded patch is refused, and the refusal spells it', () => {
  const dir = sandbox('0.6.00');
  const r = run(dir, '0.6.1');
  assert.equal(r.status, 1, '0.6.1 was allowed to publish alongside 0.6.01');
  assert.match(r.said, /0\.6\.01/, 'the refusal does not name the spelling it wants');
  assert.equal(r.touched, false, 'it edited the version before refusing it');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('on the 0.6 line the padded successor gets through', () => {
  /* 🔑 THE POSITIVE CONTROL. Without it every case here passes on a script that
     refuses everything, which is the failure mode this file already survived
     once: sourcing a lib above the gate turned both positive controls red while
     every refusal stayed green, and the gate merely looked stricter. */
  const dir = sandbox('0.6.00');
  const r = run(dir, '0.6.01');
  assert.match(r.said, /no site checkout at/, r.said.slice(0, 300));
  assert.equal(r.touched, false, 'it got far enough to edit the version, which this must never do');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a three-digit patch on the 0.6 line is refused, naming the next line', () => {
  const dir = sandbox('0.6.98');
  const r = run(dir, '0.6.100');
  assert.equal(r.status, 1);
  assert.match(r.said, /past the end of the 0\.6 line/);
  assert.match(r.said, /0\.7\.00/, 'the refusal does not name the successor');
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.6.99, staying on the line is refused', () => {
  const dir = sandbox('0.6.99');
  const r = run(dir, '0.6.05');
  assert.equal(r.status, 1);
  assert.match(r.said, /last of the 0\.6 line/);
  assert.match(r.said, /0\.7\.00/);
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.6.99, 0.7.00 gets through', () => {
  const dir = sandbox('0.6.99');
  const r = run(dir, '0.7.00');
  assert.match(r.said, /no site checkout at/, r.said.slice(0, 300));
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('standing at 0.6.99, the unpadded 0.7.0 is refused', () => {
  /* 🛑 The likeliest thing to be typed, because it is the ordinary spelling
     everywhere else in software, and it is the exact failure the padded scheme
     exists to prevent: 0.7.0 and 0.7.00 are the same version to every install. */
  const dir = sandbox('0.6.99');
  const r = run(dir, '0.7.0');
  assert.equal(r.status, 1, 'a second spelling of 0.7.00 was allowed to publish');
  assert.match(r.said, /0\.7\.00/);
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the 0.5 line keeps its own spelling and is not refused retroactively', () => {
  /* ⚠️ 0.5.100, 0.5.101 and 0.5.102 are published. A guard that refused the
     line they are on would be rewriting history rather than shaping the next
     cut, and the first person to hit it would have no idea why. */
  const dir = sandbox('0.5.101');
  const r = run(dir, '0.5.102');
  assert.ok(!/two digits|past the end|last of the/.test(r.said), r.said.slice(0, 300));
  assert.match(r.said, /no site checkout at/);
  assert.equal(r.touched, false);
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A failed bump push is safe for one cut and unsafe for two (#1335).
 *
 * 🔑 The check is on the DIVERGENCE, not on the push. A failed push is only
 * dangerous because of the state it leaves behind, and that state is directly
 * observable, so it cannot go stale the way a remembered incident does.
 *
 * 🛑 THESE NEED A REAL GIT REPO WITH A REMOTE, which the `sandbox()` helper
 * above deliberately does not build. In that sandbox `git status` errors and
 * prints nothing, so the dirty check passes by accident; an ancestry check
 * would REFUSE there instead, which is why the guard is written to skip when
 * `origin/main` does not resolve. That skip is a real behaviour and the third
 * arm below pins it.
 *
 * ⚠️ They also need a SITE directory, because the site check runs earlier than
 * the guard. Without one every arm would stop at "no site checkout" and pass
 * for the wrong reason, which is the failure this file already survived once.
 */
/* ⚠️ THIS IS ONE OF THREE INDEPENDENT PRODUCERS OF THE rel-d FORMAT, against a
   single parser. The others are `stamp_at` in tools/test-versions-entry-gate.sh
   and the real writer, tools/insert-release-entry.js. Change the page's stamp
   format and both fixtures keep passing while the real page fails.

   #1464: all three now build the stamp in America/Chicago with an explicit
   timeZone, and the reader interprets in America/Chicago, so a fixture is Central
   on any test runner rather than the runner's local time. Before that, this
   fixture used the runner's timezone and cancelled the reader's identical bug, so
   the tests passed on a Central box while the real cut failed on a non-Central one.

   The one shape the versions gate accepts: the id it greps for, and a rel-d it
   can parse, stamped now. Kept beside the sandbox rather than inline so an arm
   that wants a STALE entry can pass an offset and get a refusal on purpose. */
function versions_entry(version, minutesStale = 0) {
  const when = new Date(Date.now() - minutesStale * 60000).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
    timeZoneName: 'short',
  }).replace(' at ', ', ');
  return `<article id="v${version.replace(/\./g, '-')}"><span class="rel-d">${when}</span></article>\n`;
}

function git_sandbox(version, { diverge = 'none' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gitgate-'));
  const git = (...a) => {
    const r = spawnSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  fs.mkdirSync(path.join(dir, 'tools'));
  fs.copyFileSync(REAL, path.join(dir, 'tools', 'release.sh'));
  /* ⚠️ THE LIBS COME TOO, and this is the trap the header of this file already
     records. `release.sh` sources tools/lib/cut-guard.sh at line 157, which is
     BEFORE the guard under test and AFTER the site check the older sandbox
     stops at. Those tests pass without the libs only because they never get
     that far. Copy just release.sh here and every arm dies on a missing file
     and returns 0, which reads as "did not refuse". */
  fs.cpSync(path.join(__dirname, 'tools', 'lib'), path.join(dir, 'tools', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'sandbox', version }, null, 2));
  /* The site check runs before the guard, so the arms need one to get past it.
     ⚠️ IT LIVES OUTSIDE THE REPO, which is both what the real thing is (a
     separate chaoskosmos-site checkout) and what keeps these arms honest: with
     the site inside `dir`, writing the #1463 versions fixture into it makes the
     repo dirty and every arm dies on "main is dirty" -- a refusal from step 1
     that has nothing to do with the guard under test. */
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gitgate-site-'));
  fs.mkdirSync(path.join(site, 'dist'), { recursive: true });

  spawnSync('git', ['init', '-b', 'main', dir], { encoding: 'utf8' });
  git('config', 'user.email', 'gate@example.invalid');
  git('config', 'user.name', 'gate');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');

  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gitgate-remote-'));
  spawnSync('git', ['init', '--bare', '-b', 'main', remote], { encoding: 'utf8' });
  git('remote', 'add', 'origin', remote);
  git('push', '-q', '-u', 'origin', 'main');

  if (diverge === 'local-ahead') {
    // Exactly the stranded-bump shape: a commit here that origin never got.
    fs.writeFileSync(path.join(dir, 'STRANDED'), 'an unpushed version bump\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'v09999 -- version');
  } else if (diverge === 'local-behind') {
    // origin moves on; local is a strict ancestor. Cutting an older tree on
    // purpose is a real thing to want and must NOT be refused.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gitgate-other-'));
    spawnSync('git', ['clone', '-q', remote, other], { encoding: 'utf8' });
    spawnSync('git', ['-C', other, 'config', 'user.email', 'gate@example.invalid']);
    spawnSync('git', ['-C', other, 'config', 'user.name', 'gate']);
    fs.writeFileSync(path.join(other, 'LATER'), 'landed after\n');
    spawnSync('git', ['-C', other, 'add', '-A']);
    spawnSync('git', ['-C', other, 'commit', '-q', '-m', 'later work']);
    spawnSync('git', ['-C', other, 'push', '-q', 'origin', 'main']);
    fs.rmSync(other, { recursive: true, force: true });
  }
  /* 🔑 HOME MUST NOT BE THE REPO. The script records every cut into
     $HOME/.claude/logs, so pointing HOME at the repo (as the older sandbox
     does) makes the repo dirty the instant the run starts, and step 1 then
     refuses with "main is dirty" before ever reaching the guard under test.
     The older tests never see it because they stop at the site check first. */
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-gitgate-home-'));
  return { dir, remote, home, site };
}

function run_git(dir, version, home, site, { staleBy = 0, entry = true } = {}) {
  /* ⚠️ SINCE #1463 THE VERSIONS ENTRY IS A STEP 1 PRECONDITION, so an arm that
     means to reach step 2 needs one or it stops here instead, refusing with the
     versions page rather than with the guard under test. It is written HERE
     rather than in the sandbox because the entry has to name the version being
     CUT, and this is the function that knows it. Stamped from the clock on
     purpose: the gate refuses a guess by design, so a hard-coded date would rot
     this file into a red within twenty minutes. */
  if (entry === 'missing-file') {
    fs.rmSync(path.join(site, 'versions.html'), { force: true });
  } else if (entry) {
    fs.writeFileSync(path.join(site, 'versions.html'), versions_entry(version, staleBy));
  } else {
    /* ⚠️ THE PAGE EXISTS AND SIMPLY LACKS THIS VERSION, which is the real shape:
       the site checkout always has a versions.html, carrying every PRIOR release.
       Deleting the file instead tests a different branch ("cannot read") and would
       leave the ordinary case -- the one every failed cut actually hit -- untested. */
    /* ⚠️ Derived from the version under test rather than hard-coded. It used to
       be a literal '0.6.02', which differs from the cut version only because
       every arm happens to cut 0.6.03. An arm added later that cut 0.6.02 would
       silently turn this "no entry" fixture into a VALID entry, and the arm
       would pass for the wrong reason. */
    const other = version === '0.6.02' ? '0.6.01' : '0.6.02';
    fs.writeFileSync(path.join(site, 'versions.html'), versions_entry(other, staleBy));
  }
  const before = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  const r = spawnSync('bash', [path.join(dir, 'tools', 'release.sh'), version], {
    encoding: 'utf8',
    cwd: dir,
    /* 🔑 KOSMOS_HARNESS_IGNORE_CUT, or these arms pass only when nobody is
       cutting. `cut-guard.sh` refuses to start a release while another
       tools/release.sh is live, which is correct for a real cut and fatal for a
       test: the suite would go green on a quiet machine and red during a
       release, and the failure would look like this guard rather than like the
       harness. Found by running these while 0.6.02 was in flight. */
    env: {
      ...process.env,
      /* ⚠️ STRIP THE BOUND OVERRIDES. docs/releasing.md tells an operator to
         export these when a cut runs long, and step 3 of the cut runs `yarn
         test` in a subshell that inherits them -- so without this, taking the
         documented escape hatch makes the cut die red at step 3, after the
         freeze, on a failure unrelated to the tree. Measured: exporting
         KOSMOS_STEP1_PAST_BOUND=30 turned the 12-minute arm red. */
      KOSMOS_STEP1_PAST_BOUND: undefined,
      KOSMOS_LATE_PAST_BOUND: undefined,
      KOSMOS_FUTURE_BOUND: undefined,
      HOME: home,
      KOSMOS_SITE: site,
      KOSMOS_HARNESS_IGNORE_CUT: '1',
    },
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  return { said: (r.stdout || '') + (r.stderr || ''), status: r.status, touched: before !== after };
}

test('a cut refuses when local main has commits origin does not (the stranded bump)', () => {
  const { dir, home, site } = git_sandbox('0.6.02', { diverge: 'local-ahead' });
  const r = run_git(dir, '0.6.03', home, site);
  assert.equal(r.status, 1, 'it cut from a diverged tree');
  assert.match(r.said, /local main has commits origin\/main does not/);
  assert.match(r.said, /COULD NOT PUSH THE BUMP/, 'the refusal does not name the cause it is usually from');
  assert.match(r.said, /only here:.*v09999/, 'the refusal does not show which commits are stranded');
  assert.equal(r.touched, false, 'it edited the version before refusing');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

/* 🛑 THE ARM THAT PINS THE ORDER, AND ITS ABSENCE WAS SELF-INFLICTED.
   The step-1 gate runs LAST in step 1, after the divergence guard. Put it first
   and a cut from a diverged tree refuses with "no versions entry" instead of
   naming the stranded commits -- which is how the ordering was discovered, by
   three arms going red.

   Those three arms can no longer catch it. Giving run_git a default valid entry
   (needed so the other arms reach step 2) means the gate returns 0 wherever it
   sits, so the pre-emption became invisible: with the call moved above the
   divergence guard, both suites still pass. The fixture fix destroyed the
   coverage for the very finding that produced it.

   This arm restores it by combining the two conditions that actually conflict:
   a diverged tree AND no entry. Only one of the two guards can speak first, so
   which message comes back IS the ordering. */
test('a diverged tree refuses for DIVERGENCE, not for the missing entry (pins the order)', () => {
  const { dir, home, site } = git_sandbox('0.6.02', { diverge: 'local-ahead' });
  const r = run_git(dir, '0.6.03', home, site, { entry: false });
  assert.equal(r.status, 1, 'it did not refuse at all');
  assert.match(r.said, /only here:.*v09999/,
    'it did not name the stranded commits, so the versions gate spoke first');
  assert.ok(!/has no entry/.test(r.said),
    `the versions gate pre-empted the divergence guard:\n${r.said.slice(0, 400)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

test('a cut is NOT refused merely for being behind origin', () => {
  /* 🔑 THE ARM THAT STOPS THIS GUARD OVER-REFUSING. Behind is an ancestor, and
     cutting an older tree deliberately must stay possible. Without this the
     guard could be written as "local must equal origin", which would pass the
     arm above and block ordinary work. */
  const { dir, home, site } = git_sandbox('0.6.02', { diverge: 'local-behind' });
  const r = run_git(dir, '0.6.03', home, site);
  assert.ok(!/local main has commits origin\/main does not/.test(r.said),
    `refused a tree that is merely behind:\n${r.said.slice(0, 400)}`);
  assert.match(r.said, /== 2\. the version, in one place ==/, 'it did not reach the step after the guard');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

/* 🛑 THE ARMS THAT TEST THE MOVE RATHER THAN THE CHECK (#1463).
   Everything above asserts the cut gets PAST the gate. The unit test asserts the
   gate refuses. Neither proves the refusal now happens EARLY, which is the entire
   claim of #1463 -- and a refusal arriving from step 7 would satisfy both.
   The negative assertion is therefore the load-bearing one: it never reached step 2.
   Their positive control is the arm directly above, same sandbox, entry present,
   which does reach step 2. So the pair is a contrast, not a single reading. */
test('no versions entry refuses at step 1, before anything is built', () => {
  const { dir, home, site } = git_sandbox('0.6.02');
  const r = run_git(dir, '0.6.03', home, site, { entry: false });
  assert.equal(r.status, 1, 'it did not refuse');
  assert.match(r.said, /has no entry/, 'it refused for some other reason');
  assert.match(r.said, /Nothing has been built yet/, 'it refused with step 7\'s cost sentence, not step 1\'s');
  assert.ok(!/== 2\. the version, in one place ==/.test(r.said),
    `it got past step 1 before refusing, so the check did not move:\n${r.said.slice(0, 400)}`);
  assert.equal(r.touched, false, 'it edited the version before refusing');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

test('a missing versions page is reported as unreadable, not as a missing entry', () => {
  /* Two different operator actions: fix the path, versus write the entry. */
  const { dir, home, site } = git_sandbox('0.6.02');
  const r = run_git(dir, '0.6.03', home, site, { entry: 'missing-file' });
  assert.equal(r.status, 1);
  assert.match(r.said, /cannot read/);
  assert.ok(!/has no entry/.test(r.said), 'it told the operator to edit a file that is not there');
  /* ⚠️ THE SAME NEGATIVE ASSERTION ITS SIBLINGS CARRY, and it is not decoration:
     "cannot read" is emitted identically by BOTH call sites, so without this the
     arm passes even if the step 1 call were deleted and only step 7 refused. It
     would be testing the check while claiming to test the position. */
  assert.ok(!/== 2\. the version, in one place ==/.test(r.said),
    `the unreadable refusal came from step 7, not step 1:\n${r.said.slice(0, 400)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

test('a stale versions entry also refuses at step 1, naming the drift', () => {
  const { dir, home, site } = git_sandbox('0.6.02');
  const r = run_git(dir, '0.6.03', home, site, { staleBy: 45 });
  assert.equal(r.status, 1, 'it did not refuse');
  /* ⚠️ a RANGE, not a literal 45. The stamp has minute granularity and the sandbox
     takes about a second to build, so pinning an exact minute makes this flake on a
     boundary for a reason that has nothing to do with the gate. */
  const drift = r.said.match(/is (\d+) minutes in the past/);
  assert.ok(drift, `it did not name the drift:\n${r.said.slice(0, 400)}`);
  assert.ok(Number(drift[1]) >= 40, `drift read ${drift[1]}, expected the 45-minute fixture`);
  /* ⚠️ and it must tell the operator to stamp for PUBLICATION here, not "now".
     Advising a now-stamp at step 1 guarantees a second failure at step 7. */
  /* match the STABLE half of the sentence: the word PUBLISH is the distinction
     under test (step 7 says "paste the clock line"), while the rest of the hint
     is prose that will be reworded. Pinning the whole sentence makes this a copy
     test rather than a behaviour test. */
  assert.match(r.said, /expect to PUBLISH/, 'step 1 gave step 7\'s advice');
  assert.ok(!/Paste the clock line/.test(r.said), 'step 1 used the late remediation');
  assert.ok(!/== 2\. the version, in one place ==/.test(r.said),
    `the stale refusal came from step 7, not step 1:\n${r.said.slice(0, 400)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

/* 🛑 THE ARM THAT PINS THE ASYMMETRIC BOUND, WHICH IS THIS CHANGE'S CENTRAL CLAIM
   AND WAS ENTIRELY UNGUARDED. Swapping the step 1 call from
   KOSMOS_STEP1_PAST_BOUND to KOSMOS_LATE_PAST_BOUND passed both suites in full:
   the shell test compared the two call sites only on their remediation prose,
   and every stale fixture used 45 minutes, which refuses under either bound.

   12 minutes is the number that separates them: inside the late bound of 20,
   outside the early bound of 4. So this arm is red the moment step 1 stops being
   stricter, and it is the only thing in the tree that is. */
test('an entry 12 minutes old is refused at step 1, which the LATE bound would allow', () => {
  const { dir, home, site } = git_sandbox('0.6.02');
  const r = run_git(dir, '0.6.03', home, site, { staleBy: 12 });
  assert.equal(r.status, 1, 'step 1 accepted a stamp the cut will age past the late bound');
  assert.match(r.said, /minutes in the past/);
  assert.ok(!/== 2\. the version, in one place ==/.test(r.said),
    `it got past step 1, so step 1 is not using the tighter bound:\n${r.said.slice(0, 400)}`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

test('a clean tree in step with origin gets past the guard', () => {
  const { dir, home, site } = git_sandbox('0.6.02');
  const r = run_git(dir, '0.6.03', home, site);
  assert.ok(!/local main has commits origin\/main does not/.test(r.said), r.said.slice(0, 400));
  assert.match(r.said, /== 2\. the version, in one place ==/, 'it did not reach the step after the guard');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(site, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// #1449: a failed cut must always be able to say WHICH STEP it died in
// ---------------------------------------------------------------------------

/* 🛑 MEASURED IN THE REAL LOG BEFORE THIS WAS WRITTEN. Of 42 failed cuts,
   17 record no step at all -- and every one of those 17 is from BEFORE
   2026-08-27T05:29Z. `ac65aea3` fixed it and 25 consecutive failures since
   carry a step.

   ⇒ So this guards a fix that already landed, which is the only kind of
   regression guard worth having: the 17 are unattributable forever, and a
   silent return would make the next 17 the same.

   ⭐ Why the log's own history is not enough: a streak of 25 is equally
   consistent with "that failure mode stopped occurring". THREE separate things
   in the script make the field unconditional, and a regression need only
   remove one of them. Each is asserted below, so each can fail on its own. */

test('#1449: the cut completion line can never omit its step', () => {
  const s = fs.readFileSync(REAL, 'utf8');

  /* CONTROL FIRST. Without this the three assertions below would all pass on a
     file that had been renamed or emptied, and report the cut instrumented. */
  assert.match(s, /cut_record_done\(\)/,
    'no cut_record_done in release.sh, so this test is asserting against a file it did not find');

  /* ⚠️ FOLLOWS BACKSLASH CONTINUATIONS. This extraction was single-line
     (`[^\n]*`), and #1388 wrapped the completion printf across four lines to add
     the outcome/signal fields. The `${_STEP:-unknown}` default moved past the
     first newline, so the assertion below reported the default GONE while it sat
     two lines down, untouched. The property is what matters; the layout is not.
     Continuations are consumed explicitly rather than by widening to [\s\S],
     which would run on into the rest of the file. */
  const line = (s.match(/printf '[^']*completed[^']*'(?:[^\n\\]*\\\n)*[^\n]*/) || [])[0];
  assert.ok(line, 'the completion line is gone, so nothing records a cut ending at all');
  assert.ok(line.length > 60, `control: the extracted completion line is implausibly short (${line.length})`);

  // 1. The FORMAT carries the field. Without it there is no step= to parse.
  assert.match(line, /step=%s/,
    'the completion line no longer prints a step= field, so every future failure joins the '
    + '17 that cannot say where they died');

  // 2. The INTERPOLATION defaults. An unset _STEP must render a word, not an
  //    empty string, or the field is present and says nothing.
  assert.match(line, /\$\{_STEP:-[^}]+\}/,
    'the step interpolation lost its default, so an unset _STEP renders step= with nothing '
    + 'after it -- present in the format and absent in meaning');

  // 3. The VARIABLE starts with a value, so a death BEFORE the first step still
  //    names one. This is the `before_step_1` class the card asked for.
  assert.match(s, /^_STEP=["']?\S/m,
    'the _STEP initialiser is gone, so a cut that dies before step 1 falls back to the '
    + 'default rather than saying it never started');
});
