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
  // The site check runs before the guard, so the arms need one to get past it.
  fs.mkdirSync(path.join(dir, 'site', 'dist'), { recursive: true });

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
  return { dir, remote, home };
}

function run_git(dir, version, home) {
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
      HOME: home,
      KOSMOS_SITE: path.join(dir, 'site'),
      KOSMOS_HARNESS_IGNORE_CUT: '1',
    },
    timeout: 60000,
    killSignal: 'SIGKILL',
  });
  const after = fs.readFileSync(path.join(dir, 'package.json'), 'utf8');
  return { said: (r.stdout || '') + (r.stderr || ''), status: r.status, touched: before !== after };
}

test('a cut refuses when local main has commits origin does not (the stranded bump)', () => {
  const { dir, home } = git_sandbox('0.6.02', { diverge: 'local-ahead' });
  const r = run_git(dir, '0.6.03', home);
  assert.equal(r.status, 1, 'it cut from a diverged tree');
  assert.match(r.said, /local main has commits origin\/main does not/);
  assert.match(r.said, /COULD NOT PUSH THE BUMP/, 'the refusal does not name the cause it is usually from');
  assert.match(r.said, /only here:.*v09999/, 'the refusal does not show which commits are stranded');
  assert.equal(r.touched, false, 'it edited the version before refusing');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a cut is NOT refused merely for being behind origin', () => {
  /* 🔑 THE ARM THAT STOPS THIS GUARD OVER-REFUSING. Behind is an ancestor, and
     cutting an older tree deliberately must stay possible. Without this the
     guard could be written as "local must equal origin", which would pass the
     arm above and block ordinary work. */
  const { dir, home } = git_sandbox('0.6.02', { diverge: 'local-behind' });
  const r = run_git(dir, '0.6.03', home);
  assert.ok(!/local main has commits origin\/main does not/.test(r.said),
    `refused a tree that is merely behind:\n${r.said.slice(0, 400)}`);
  assert.match(r.said, /== 2\. the version, in one place ==/, 'it did not reach the step after the guard');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a clean tree in step with origin gets past the guard', () => {
  const { dir, home } = git_sandbox('0.6.02');
  const r = run_git(dir, '0.6.03', home);
  assert.ok(!/local main has commits origin\/main does not/.test(r.said), r.said.slice(0, 400));
  assert.match(r.said, /== 2\. the version, in one place ==/, 'it did not reach the step after the guard');
  fs.rmSync(dir, { recursive: true, force: true });
});
