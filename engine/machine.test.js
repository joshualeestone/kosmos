'use strict';

/**
 * The "Checking your computer" screen, and the two ways it lies if you write it
 * the obvious way.
 *
 *     node --test engine/machine.test.js
 */

const test = require('node:test');
const assert = require('node:assert');
const machine = require('./machine');
/* win32-board-copy: this file is the Mac contract (pmset, /Applications, open -R), so it
   states its platform rather than inheriting the host's; the Windows arms live in
   engine/machine.win32-sleep.test.js. */
machine.setPlatform('darwin');

/* ---------------------------------------------------------------------------
   Fixtures, and where each one came from — because a fixture whose provenance
   nobody recorded is a guess with a filename.
--------------------------------------------------------------------------- */

/**
 * CAPTURED, verbatim, from `pmset -g custom` on the Mac mini this was written
 * on. A desktop: one section, because there is no battery to print a second one
 * for. Note `disksleep 10` sitting two lines under `sleep 0` — that pair is the
 * trap the parser exists to survive.
 */
const DESKTOP_AWAKE = `AC Power:
 Sleep On Power Button 1
 autorestartatconnect 0
 lowpowermode         0
 standby              0
 ttyskeepawake        1
 powernap             1
 displaysleep         0
 womp                 1
 networkoversleep     0
 sleep                0
 tcpkeepalive         1
 autorestart          1
 disksleep            10
`;

/** The same capture with the one value changed, which is the case it is for. */
const DESKTOP_SLEEPS = DESKTOP_AWAKE.replace(' sleep                0', ' sleep                10');

/**
 * ⚠️ RECONSTRUCTED, NOT CAPTURED. This machine is a Mac mini and has no
 * battery, so it can never print a `Battery Power` section — which is precisely
 * why the laptop path needs a fixture rather than a live read. The shape is
 * `pmset -g custom`'s documented two-section output: same keys, printed once
 * per power source, battery first.
 *
 * Said out loud because a fixture presented as measured, that was not, is how a
 * test ends up pinning the author's idea of a laptop instead of a laptop.
 */
const LAPTOP_SLEEPS_ON_BATTERY = `Battery Power:
 lidwake              1
 standby              1
 halfdim              1
 sleep                10
 displaysleep         2
 disksleep            10

AC Power:
 lidwake              1
 standby              1
 halfdim              1
 sleep                0
 displaysleep         10
 disksleep            10
`;

const LAPTOP_ALWAYS_AWAKE = LAPTOP_SLEEPS_ON_BATTERY.replace(' sleep                10', ' sleep                0');

/**
 * ⚠️ A REAL EXECUTABLE, not this test file. These fixtures used `__filename` —
 * a `.js` file with no execute bit — as a stand-in for a binary, which passed
 * for exactly as long as the check only asked whether something existed at the
 * path. It does not stand in for a binary, and the moment the probe started
 * asking whether it could be RUN, three tests were pinning a machine where
 * Claude is a text file.
 */
const REAL_BIN = '/bin/sh';

const okRunner = () => ({ ok: true, stdout: '' });
const deadRunner = () => ({ ok: false, because: 'command not found' });

/* ---------------------------------------------------------------------------
   Sleep
--------------------------------------------------------------------------- */

test('a Mac that never sleeps is reported as never sleeping', () => {
  const got = machine.sleepCheck(DESKTOP_AWAKE);
  assert.equal(got.state, 'ok', got.title);
  assert.match(got.title, /does not go to sleep/);
});

test('`disksleep 10` is not read as "this Mac sleeps after 10 minutes"', () => {
  /**
   * ⚠️ THE ONE THAT WOULD HAVE SHIPPED. `pmset` prints `disksleep`,
   * `displaysleep` and `sleep` in the same block, so a substring match for
   * `sleep\\s+(\\d+)` finds the "sleep            10" inside `disksleep 10` — on
   * a machine set never to sleep at all.
   *
   * The control first: the fixture really does contain the trap, so this test
   * cannot pass by being run against something that never had it.
   */
  assert.match(DESKTOP_AWAKE, /disksleep\s+10/,
    'the fixture no longer contains the trap this test is about');
  assert.match(DESKTOP_AWAKE, /^ sleep\s+0$/m,
    'the fixture no longer has a machine that never sleeps');

  const got = machine.sleepCheck(DESKTOP_AWAKE);
  assert.equal(got.state, 'ok',
    'a Mac set never to sleep was told its agents stop, because a substring of '
    + 'disksleep was read as the sleep setting');
  assert.ok(!/10/.test(got.title), `the disk-sleep value reached the screen: ${got.title}`);
});

test('`Sleep On Power Button 1` is not read as a sleep setting either', () => {
  // A three-word key with a number after it, in the same block. The parser takes
  // two-token lines only, so this one is skipped rather than misread as `sleep 1`.
  assert.match(DESKTOP_AWAKE, /Sleep On Power Button 1/,
    'the fixture no longer contains the second trap');
  assert.equal(machine.sleepCheck(DESKTOP_AWAKE).state, 'ok');
});

test('a Mac that sleeps after ten minutes says so, with the number', () => {
  const got = machine.sleepCheck(DESKTOP_SLEEPS);
  assert.equal(got.state, 'attention');
  assert.match(got.title, /10 minutes/);
  assert.match(got.detail, /System Settings/,
    'told somebody their machine sleeps without telling them where to change it');
});

test('a laptop that sleeps on battery is a warning, not a pass', () => {
  /**
   * ⚠️ THE CASE THE WIREFRAME'S DASHED NOTE IS ABOUT, and the one a check that
   * reads only the first section it finds gets wrong. Plugged in this machine
   * never sleeps; the person closes it at five o'clock and everything stops.
   */
  const got = machine.sleepCheck(LAPTOP_SLEEPS_ON_BATTERY);
  assert.equal(got.state, 'attention',
    'a laptop that stops working the moment it is unplugged was reported as fine, '
    + 'because its AC section says it never sleeps');
  assert.match(got.detail, /on battery/i);
  assert.match(got.detail, /10 minutes/);
});

test('a laptop set never to sleep on either power source passes', () => {
  const got = machine.sleepCheck(LAPTOP_ALWAYS_AWAKE);
  assert.equal(got.state, 'ok', got.title);
  assert.match(got.detail, /battery/i,
    'said nothing about the battery on the one kind of machine that has one');
});

test('output we cannot parse is unknown, never "fine"', () => {
  for (const junk of ['', 'pmset: command not found', 'AC Power:\n', '{"sleep": 0}']) {
    const got = machine.sleepCheck(junk);
    assert.equal(got.state, 'unknown',
      `unreadable pmset output (${JSON.stringify(junk)}) was reported as a state, not as `
      + 'us being unable to read it');
  }
});

test('a laptop whose battery section we cannot read is unknown, not fine', () => {
  // ⚠️ The half-answer. AC says never sleep, so the naive read is "ok" — but the
  // section that decides what happens when they unplug it is the unreadable one.
  const half = 'Battery Power:\n lidwake              1\n\nAC Power:\n sleep                0\n';
  const got = machine.sleepCheck(half);
  assert.equal(got.state, 'unknown',
    'the half we could read was reported as the whole answer');
  assert.match(got.detail, /battery/i);
});

test('a pmset that will not run at all does not become a passing check', () => {
  // appDirs sandboxed like every sibling: nothing here can flip on the real
  // /Applications, but a test that touches the real machine at all is one
  // more thing a reviewer must reason about.
  const os2 = require('node:os');
  const path2 = require('node:path');
  const fs2 = require('node:fs');
  const empty = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'kosmos-pmset-'));
  const got = machine.check({ runner: deadRunner, claudeBin: REAL_BIN, tmuxBin: REAL_BIN, appDirs: [empty, empty] });
  fs2.rmSync(empty, { recursive: true, force: true });
  const sleep = got.checks.find((c) => c.key === 'sleep');
  assert.equal(sleep.state, 'unknown');
  assert.equal(got.unknown >= 1, true);
});

test('the reassuring half of the battery answer is not asserted unchecked', () => {
  /**
   * ⚠️ MEASURED. This branch ran BEFORE the AC value was tested, so a laptop set
   * to sleep after ten minutes on AC, whose battery section could not be read,
   * was told "It does not go to sleep while it is plugged in." The verdict was
   * safely `unknown` the whole time, which is why it went unnoticed for a
   * while: the false thing was the sentence, not the state.
   */
  const acSleeps = 'Battery Power:\n lidwake              1\n\nAC Power:\n sleep                10\n';
  const got = machine.sleepCheck(acSleeps);
  assert.doesNotMatch(got.detail, /does not go to sleep while it is plugged in/,
    'told somebody their Mac stays awake on AC when the reading said it sleeps after ten minutes');

  /**
   * ⚠️ AND THE HALF WE DID READ IS REPORTED. The first correction of this branch
   * fixed the false sentence but left the answer at `unknown` with nothing but
   * the battery mentioned -- so a measured, actionable "this sleeps after ten
   * minutes plugged in" was thrown away because a DIFFERENT reading failed.
   * Half the answer was read and none of it was said.
   */
  assert.equal(got.state, 'attention',
    'a known, actionable sleep setting was demoted to "we could not tell" because the '
    + 'battery section was unreadable');
  assert.match(got.title, /10 minutes/);
  assert.match(got.detail, /battery/i,
    'stopped saying that the battery half is still unread');

  // The control: when AC really was read as never-sleep, it DOES say so.
  const acFine = 'Battery Power:\n lidwake              1\n\nAC Power:\n sleep                0\n';
  const fine = machine.sleepCheck(acFine);
  assert.equal(fine.state, 'unknown');
  assert.match(fine.detail, /does not go to sleep while it is plugged in/,
    'stopped saying the one true half it had actually checked');
});

test('a binary we cannot LOOK at is unknown, not "not installed"', () => {
  /**
   * ⚠️ THE ARM THAT COULD NEVER FIRE. Written around `fs.existsSync`, which
   * never throws — it swallows every error and answers false. So an unreadable
   * parent directory came out as the flat claim "an agent made now would not
   * start", which is cannot-see rendered as a checked negative.
   *
   * A directory with no execute permission is the cheapest real reproduction:
   * stat through it fails EACCES rather than ENOENT.
   */
  const fs = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  const dir = fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aw-perm-'));
  const inner = nodePath.join(dir, 'inner');
  fs.mkdirSync(inner);
  const hidden = nodePath.join(inner, 'claude');
  fs.writeFileSync(hidden, '#!/bin/sh\n');
  fs.chmodSync(hidden, 0o755);   // executable, so the ONLY obstacle is the parent dir
  fs.chmodSync(inner, 0o000);
  try {
    // The control: it really is unreadable in a way that is NOT "absent".
    let code = null;
    try { fs.statSync(hidden); } catch (err) { code = err.code; }
    if (code === null || code === 'ENOENT') return;   // running as root; nothing to test

    // ⚠️ tmuxBin, not claudeBin (#979): Claude Code no longer drives this
    // row's verdict, so pointing the unreadable path at it would assert
    // `unknown` on a check that now correctly answers `ok`.
    const got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: hidden });
    assert.equal(got.state, 'unknown',
      'a path we could not read was reported as a definite "not installed"');
    assert.match(got.detail, /could not see it|did not work/);
  } finally {
    fs.chmodSync(inner, 0o755);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------------------------------------------------------------------------
   Installed
--------------------------------------------------------------------------- */

test('the installed check asks the same question creation asks', () => {
  /**
   * ⚠️ NOT A SECOND DEFINITION. Creation resolves Claude and tmux through
   * `create.binPaths`; if this check looked them up on PATH instead it would
   * answer "not installed" on this very machine, where the board runs under
   * launchd with a PATH that has no `~/.local/bin` in it — while creation works.
   */
  const create = require('./create');
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'machine.js'), 'utf8');
  assert.match(src, /create\.binPaths\(/,
    'machine.js no longer asks create.binPaths, so "is it installed" has been forked');
  // ⚠️ Matched against CODE, not prose. The first version of this line forbade
  // the word "which", which appears in six explanatory comments in that file —
  // so it failed on the sentence explaining why the rule exists. A test that
  // reads the commentary is testing the commentary.
  assert.ok(!/['"]which['"]|process\.env\.PATH|AGENT_WORKFORCE_CLAUDE_BIN/.test(src),
    'machine.js resolves the binaries itself again instead of asking create.binPaths');
  assert.equal(typeof create.binPaths, 'function');
});

test('a missing REQUIRED thing says what a PERSON can do, and still records where we looked', () => {
  const good = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(good.state, 'ok');

  const bad = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: '/definitely/not/here/tmux' });
  assert.equal(bad.state, 'attention');

  /* ⭐ THIS ASSERTION USED TO REQUIRE THE OPPOSITE, and moved with #1019 rather
     than being loosened. It read `assert.match(bad.title, /tmux/)`, which was
     defensible while this row could produce three different sentences and this
     was rarely the one you saw. #979 stopped requiring Claude Code, leaving
     tmux the only required part, so that sentence became THE failure headline
     of the screen -- and it names an implementation detail a reader cannot act
     on. */
  assert.ok(!/tmux/i.test(bad.title),
    'the headline names how Kosmos runs agents instead of what is wrong: ' + bad.title);
  assert.match(bad.title, /cannot start agents/);

  /* The remedy has to be in the sentence, and it has to be one that WORKS: the
     installer places tmux as a private copy inside KOSMOS_HOME, so a missing
     one means Kosmos's own files are damaged and reinstalling does put it
     back. */
  assert.match(bad.detail, /Reinstalling Kosmos/);

  /* 📌 AND THE PATH SURVIVES, at the end. The previous version of this test
     argued for it in as many words and that argument still holds for support,
     just not as the headline. */
  assert.match(bad.detail, /\/definitely\/not\/here\/tmux/,
    'told somebody something is missing without saying where it looked, which is the '
    + 'one piece of information that lets anybody diagnose it');
  assert.ok(!/Claude/.test(bad.title), 'named a thing that is present as missing');

  /* ⭐ AND THE WORD IS NOT THE NOUN OF THE SENTENCE EITHER. The path still
     contains it, unavoidably, because the file really does live at
     `<home>/tmux/bin/tmux` and showing an altered path would be worse than
     showing one containing a term. What must not happen is a sentence
     ADDRESSED to a person taking it as its subject. */
  assert.ok(!/for tmux|tmux is not|tmux at /.test(bad.detail),
    'a sentence written for a person takes tmux as its subject: ' + bad.detail);
  assert.match(bad.detail, /the part that runs agents/);
});

test('⭐ #979: a Mac with no Claude Code is OK, and its absence is still REPORTED', () => {
  /* 🛑 THIS ASSERTION IS INVERTED FROM WHAT THIS FILE USED TO SAY. Claude Code
     sat beside tmux as a thing the MACHINE needs, whichever provider was
     chosen, so somebody who picked GPT was told their Mac was missing
     something it does not need -- on the screen whose job is to say whether
     they can proceed. They can: an OpenAI agent runs on codex and never
     touches the Claude binary. Josh, 2026-08-26 10:32.

     ⚠️ AND THE FACT IS NOT DELETED WITH THE REQUIREMENT. The Connect step has
     to know whether pressing Connect will download anything, so presence is
     published on `present` and simply stops deciding the verdict. */
  const got = machine.installedCheck({ claudeBin: '/definitely/not/here/claude', tmuxBin: REAL_BIN });
  assert.equal(got.state, 'ok', 'a GPT-only Mac is told it is missing something it does not need');
  assert.doesNotMatch(got.title + ' ' + got.detail, /Claude/,
    'the row still names Claude Code to somebody who may never want it');
  assert.equal(got.present.claude, false, 'the fact went with the requirement');
  assert.equal(got.present.tmux, true);

  // CONTROL: present is a real reading, not a constant. Same call, real path.
  const has = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(has.present.claude, true,
    'present answers false for everything, so the assertion above proves nothing');
});

test('#979: an unrunnable Claude Code reads absent in `present`, and still does not block', () => {
  /* Present means RUNNABLE here too, or Connect would skip installing over a
     directory named claude. The #133 trap, on the informational side. */
  const fs2 = require('node:fs');
  const np = require('node:path');
  const dir = fs2.mkdtempSync(np.join(require('node:os').tmpdir(), 'mach979-'));
  try {
    const asDir = np.join(dir, 'claude');
    fs2.mkdirSync(asDir);
    const got = machine.installedCheck({ claudeBin: asDir, tmuxBin: REAL_BIN });
    assert.equal(got.state, 'ok', 'an unrunnable Claude Code blocked a machine that does not need it');
    assert.equal(got.present.claude, false, 'a directory named claude read as present');
  } finally {
    fs2.rmSync(dir, { recursive: true, force: true });
  }
});

test('something at the path is not the same as something we could run', () => {
  /**
   * ⚠️ BOTH OF THESE PASSED AS "Everything it needs to run is installed" while
   * the probe only asked whether anything was there. A directory called
   * `claude`, or a `claude` with no execute bit, produces a launchd job that
   * starts and fails silently — nothing on screen, nothing running, and a
   * setup screen that said it would work.
   */
  const fs2 = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  const dir = fs2.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aw-exec-'));
  try {
    const asDirTmux = nodePath.join(dir, 'tmuxdir');
    fs2.mkdirSync(asDirTmux);
    const notExec = nodePath.join(dir, 'tmux');
    fs2.writeFileSync(notExec, '#!/bin/sh\n');
    fs2.chmodSync(notExec, 0o644);

    // The controls: both really are present, which is what made them pass.
    assert.ok(fs2.existsSync(asDirTmux) && fs2.existsSync(notExec),
      'the fixture no longer contains things that exist but cannot be run');

    /* ⚠️ NARROWED (#979). This used to point claudeBin at the directory and
       tmuxBin at the non-executable file and assert BOTH were named. Claude
       Code no longer decides this row, so the both-named half moved to the
       `present` assertions in the #979 tests above. The original point is
       untouched and still driven, twice: a thing that EXISTS but cannot RUN
       is not installed. */
    let got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: asDirTmux });
    assert.equal(got.state, 'attention', 'a directory named tmux was reported as installed');
    assert.match(got.detail, /tmux/);

    got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: notExec });
    assert.equal(got.state, 'attention', 'a tmux with no execute bit was reported as installed');
    assert.match(got.detail, /tmux/);
  } finally {
    fs2.rmSync(dir, { recursive: true, force: true });
  }
});

test('an unreadable REQUIRED probe is unknown, not a definite "not installed"', () => {
  /**
   * ⚠️ THE SIBLING OF THE SLEEP FIX, UNFIXED FOR A WHILE. With Claude
   * genuinely absent and tmux unreadable, the early return on the unreadable
   * one won by arriving first: the whole check came back "We could not check
   * what is installed", naming only tmux, and `attention` fell to zero — so the
   * screen said nothing needed doing while Claude Code was definitively not
   * there. Half the answer was read and none of it was reported.
   */
  const fs2 = require('node:fs');
  const nodeOs = require('node:os');
  const nodePath = require('node:path');
  const dir = fs2.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aw-both-'));
  const inner = nodePath.join(dir, 'inner');
  fs2.mkdirSync(inner);
  const blocked = nodePath.join(inner, 'tmux');
  fs2.writeFileSync(blocked, '#!/bin/sh\n');
  fs2.chmodSync(blocked, 0o755);
  fs2.chmodSync(inner, 0o000);
  try {
    // The control: unreadable in a way that is NOT "absent", or there is no test.
    let code = null;
    try { fs2.statSync(blocked); } catch (err) { code = err.code; }
    if (code === null || code === 'ENOENT') return;    // root; nothing to test

    /* ⚠️ RE-AIMED (#979), and what it guards is unchanged. The original pairing
       (Claude absent + tmux unreadable) cannot be built any more: only tmux
       decides this row, so there is no second required part to be the other
       half. What is still true and still worth pinning is the sleep-fix
       sibling this test was written for -- an unreadable REQUIRED probe
       reports as UNKNOWN rather than as a definite "not installed" -- plus the
       new half, that an informational part still answers even when the
       required probe could not be read. */
    const got = machine.installedCheck({ claudeBin: '/definitely/not/here/claude', tmuxBin: blocked });
    assert.equal(got.state, 'unknown',
      'an unreadable required probe was reported as a definite "not installed"');
    assert.match(got.detail, /could not check|did not work/,
      'the sentence does not say we could not look, so a person reads it as a finding');
    assert.equal(got.present.tmux, null, 'we could not look, which is not the same as absent');
    assert.equal(got.present.claude, false,
      'the informational part stopped answering when the required probe could not be read');
  } finally {
    fs2.chmodSync(inner, 0o755);
    fs2.rmSync(dir, { recursive: true, force: true });
  }
});

test('a sleep value we cannot interpret is unknown, not "never sleeps"', () => {
  // ⚠️ `Number.isFinite` accepted -5, which is neither zero nor greater than
  // zero, so it fell through every branch into the pass: "This Mac does not go
  // to sleep". A reading we did not understand became a positive assertion.
  for (const v of ['-5', '1.5', 'never', '0x10', '+5', '']) {
    const got = machine.sleepCheck(`AC Power:\n sleep                ${v}\n`);
    assert.equal(got.state, 'unknown', `sleep=${v} was interpreted rather than refused`);
  }
  // The control: a value we DO understand still reads as a pass.
  assert.equal(machine.sleepCheck('AC Power:\n sleep                0\n').state, 'ok');
});

test('the install check refuses the same paths creation refuses', () => {
  /**
   * ⚠️ THE OTHER HALF OF THE SHARED-DEFINITION FIX. `binPaths` made the two
   * agree about WHERE to look; they still disagreed about which paths are
   * usable at all. `createAgent` rejects a path carrying a quote or a newline
   * outright, so such a path passed step 2 as "Everything it needs to run is
   * installed" and was flatly refused by creation two screens later.
   */
  const create = require('./create');
  const nasty = `/opt/homebrew/bin/tm"ux`;
  assert.equal(create.unusablePath(nasty), true,
    'the fixture is no longer a path creation would refuse');

  const got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: nasty });
  assert.equal(got.state, 'attention',
    'a path creation will refuse was reported as installed and ready');
  /* Moved with #1019: the headline names the consequence, not the component.
     What this test is FOR is that a refusable path is not called ready, and
     that is asserted above. */
  assert.match(got.title, /cannot start agents/);
  assert.ok(!/tmux/i.test(got.title), 'the headline names how Kosmos runs agents: ' + got.title);
});

/* ---------------------------------------------------------------------------
   Starting themselves
--------------------------------------------------------------------------- */

test('launchctl answering is a pass, and launchctl NOT answering is unknown', () => {
  const alive = machine.restartCheck(okRunner);
  assert.equal(alive.state, 'ok');
  /**
   * ⚠️ AND THE PASS DOES NOT OVERCLAIM. All that was established is that
   * launchctl answers for this login session: no plist was opened, no job was
   * listed, and no reboot has happened. The first version said "Your agents
   * will start themselves ... they come back on their own", directly under a
   * comment saying that claim is deliberately weaker than the wireframe's.
   */
  /**
   * ⚠️ AND IT IS A CLAIM ABOUT KOSMOS, NOT ABOUT ANYBODY'S AGENTS. "Your agents
   * are set to start themselves" was FALSE on the adopt path -- the fleet is
   * counted out of `tmux list-panes`, and an agent some other program started
   * may have no launchd job at all. Nothing here opens a plist or looks at one
   * of them, so the sentence is scoped to the agents this app makes, and says
   * out loud whose it is not talking about.
   */
  assert.match(alive.title, /Agents made here/,
    'the pass claims something about agents nobody looked at');
  assert.doesNotMatch(alive.title, /^Your agents/, 'the pass speaks for the whole fleet again');
  // Josh's one-line rewrite (2026-08-17): the scope caveat about other
  // programs' agents left the row with the pack's one-line rhythm.
  assert.match(alive.detail, /come back on their own after this computer restarts/,
    'the ok row lost Josh\'s wording');

  /**
   * ⚠️ UNKNOWN, NOT ATTENTION. This test pinned `attention` in its first
   * version, which would have kept the wrong behaviour in place: launchctl not
   * answering means we could not ask, not that something is wrong. Counting it
   * as attention is exactly the miscount `check()` separates the two counters
   * to avoid.
   */
  const dead = machine.restartCheck(deadRunner);
  assert.equal(dead.state, 'unknown',
    'a check we could not run was counted as a problem needing action');
  // The pack's unknown row, at the pack's length (first-run spec, screen 4).
  assert.match(dead.detail, /could not look/);
});

test('the restart check asks launchctl about THIS login session', () => {
  // gui/<uid>, not the system domain: an agent's job is registered per-login, so
  // asking about anything else would answer a question nobody has.
  let asked = null;
  machine.restartCheck((cmd, args) => { asked = [cmd, args]; return { ok: true, stdout: '' }; });
  assert.equal(asked[0], '/bin/launchctl');
  assert.equal(asked[1][0], 'print');
  assert.match(asked[1][1], new RegExp(`^gui/${process.getuid()}$`));
});

/* ---------------------------------------------------------------------------
   The board's own login job (#2397): the cannot-see-zero arm labelTruthCheck
   deliberately omits. Presence + the standing disable override, never "loaded
   right now" (RunAtLoad reloads a present plist at the next login on its own).
--------------------------------------------------------------------------- */

const nodeOs = require('node:os');
const nodePath2 = require('node:path');
const nodeFs = require('node:fs');

/* A launch-dir seam with the board plist present or absent. Returns a cleanup. */
function withLaunchDir(withBoard, fn) {
  const dir = nodeFs.mkdtempSync(nodePath2.join(nodeOs.tmpdir(), 'kosmos-autostart-'));
  if (withBoard) nodeFs.writeFileSync(nodePath2.join(dir, 'com.kosmos.board.plist'), '<plist/>');
  const orig = process.env.AGENT_WORKFORCE_LAUNCH;
  process.env.AGENT_WORKFORCE_LAUNCH = dir;
  try { return fn(dir); }
  finally {
    if (orig === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = orig;
    nodeFs.rmSync(dir, { recursive: true, force: true });
  }
}

const DISABLED_BLOCK = `disabled services = {
\t"io.tailscale.ipn.macsys" => enabled
\t"com.kosmos.board" => disabled
\t"com.kosmos.agent.somebody" => enabled
}`;
const ENABLED_BLOCK = `disabled services = {
\t"io.tailscale.ipn.macsys" => enabled
\t"com.kosmos.agent.somebody" => enabled
}`;

test('#2397: a missing board login job on an INSTALLED machine is attention, not silence', () => {
  withLaunchDir(false, () => {
    const got = machine.boardAutostartCheck(okRunner, { platform: 'darwin', installedRoot: '/opt/kosmos' });
    assert.equal(got.state, machine.STATE.ATTENTION,
      'a deleted board login job read as OK -- the exact cannot-see-zero hole this card closes');
    assert.match(got.title, /will not start itself/);
    assert.match(got.detail, /missing/);
  });
});

test('#2397: no board login job when running FROM SOURCE is benign, not a false alarm', () => {
  withLaunchDir(false, () => {
    const got = machine.boardAutostartCheck(okRunner, { platform: 'darwin', installedRoot: null });
    assert.equal(got.state, machine.STATE.OK, 'a from-source checkout must not be told its login job is missing');
    assert.match(got.title, /from source/);
  });
});

test('#2397: a present-but-turned-off login item is surfaced plainly, never fought', () => {
  withLaunchDir(true, () => {
    // The disable override is exactly what the System Settings Login Items
    // toggle writes; it, not "loaded right now", is what stops a reboot start.
    const disabledRunner = (cmd, args) => {
      if (cmd === '/bin/launchctl' && args[0] === 'print-disabled') return { ok: true, stdout: DISABLED_BLOCK };
      return { ok: true, stdout: '' };
    };
    const got = machine.boardAutostartCheck(disabledRunner, { platform: 'darwin' });
    assert.equal(got.state, machine.STATE.ATTENTION);
    assert.match(got.title, /turned off/);
    // Josh 2026-09-07: do not fight the user -- point them at the toggle, do not
    // promise to flip it back for them.
    assert.match(got.detail, /Login Items/);
    assert.doesNotMatch(got.detail, /we (?:will|have) (?:turned|switched) it (?:on|back)/i);
  });
});

test('#2397: the OLDER macOS disable token (=> true) is also read as turned off, not a false OK', () => {
  // Older `launchctl print-disabled` emitted `=> true`/`=> false` (true == disabled)
  // instead of `=> disabled`/`=> enabled`. Matching only `disabled` would let a
  // genuinely disabled board fall through to OK -- the cannot-see-zero direction.
  withLaunchDir(true, () => {
    const OLD_TOKEN_BLOCK = 'disabled services = {\n\t"com.kosmos.board" => true\n\t"com.other" => false\n}';
    const oldRunner = (cmd, args) => {
      if (cmd === '/bin/launchctl' && args[0] === 'print-disabled') return { ok: true, stdout: OLD_TOKEN_BLOCK };
      return { ok: true, stdout: '' };
    };
    const got = machine.boardAutostartCheck(oldRunner, { platform: 'darwin' });
    assert.equal(got.state, machine.STATE.ATTENTION, 'a `=> true` disabled board fell through to a false OK');
    assert.match(got.title, /turned off/);
  });
});

test('#2397: an UNREADABLE launch dir is unknown (could-not-look), not a false "will not start"', () => {
  // fs.existsSync would collapse an EACCES/ENOTDIR into "the file is not there"
  // and render ATTENTION. A non-ENOENT stat error is a read we could not make, so
  // the row must fail SOFT to unknown -- matching installedCheck / labelTruthCheck.
  // Simulated with a launch path that is a FILE, so stat of <file>/...plist throws
  // ENOTDIR (not ENOENT).
  const os2 = require('node:os');
  const p2 = require('node:path');
  const fs2 = require('node:fs');
  const f = fs2.mkdtempSync(p2.join(os2.tmpdir(), 'kosmos-notdir-'));
  const asFile = p2.join(f, 'launch-as-file');
  fs2.writeFileSync(asFile, 'x'); // a regular file where a dir is expected
  const orig = process.env.AGENT_WORKFORCE_LAUNCH;
  process.env.AGENT_WORKFORCE_LAUNCH = asFile;
  try {
    const got = machine.boardAutostartCheck(okRunner, { platform: 'darwin', installedRoot: '/opt/kosmos' });
    assert.equal(got.state, machine.STATE.UNKNOWN, 'an unreadable launch dir was rendered as a checked negative');
    assert.match(got.title, /could not check/i);
  } finally {
    if (orig === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = orig;
    fs2.rmSync(f, { recursive: true, force: true });
  }
});

test('#2397: a present, enabled board login job is a pass', () => {
  withLaunchDir(true, () => {
    const enabledRunner = (cmd, args) => {
      if (cmd === '/bin/launchctl' && args[0] === 'print-disabled') return { ok: true, stdout: ENABLED_BLOCK };
      return { ok: true, stdout: '' };
    };
    const got = machine.boardAutostartCheck(enabledRunner, { platform: 'darwin' });
    assert.equal(got.state, machine.STATE.OK);
    assert.match(got.title, /starts itself/);
  });
});

test('#2397: a present job whose disable-state we could not read still passes (presence is the signal)', () => {
  // RunAtLoad brings a present plist back at the next login unless a standing
  // disable override says otherwise. If we could not read that override, the
  // file's presence is the reboot-bearing fact -- do not manufacture an alarm.
  withLaunchDir(true, () => {
    const got = machine.boardAutostartCheck(deadRunner, { platform: 'darwin' });
    assert.equal(got.state, machine.STATE.OK);
  });
});

test('#2397: not currently loaded is NOT "turned off" -- only a disable override is', () => {
  // A present plist with no disable override (started by hand this session, or
  // run from source beside a plist) still RunAtLoads next login. print-disabled
  // simply does not list it -> enabled by default -> must read OK, not attention.
  withLaunchDir(true, () => {
    const notListedRunner = (cmd, args) => {
      if (cmd === '/bin/launchctl' && args[0] === 'print-disabled') return { ok: true, stdout: ENABLED_BLOCK };
      return { ok: false };
    };
    const got = machine.boardAutostartCheck(notListedRunner, { platform: 'darwin' });
    assert.equal(got.state, machine.STATE.OK, 'present-but-not-loaded was misread as the user turning it off');
  });
});

test('#2397: the check never mutates launchd -- it only ever reads print-disabled', () => {
  withLaunchDir(true, () => {
    const calls = [];
    const spy = (cmd, args) => { calls.push([cmd, ...(args || [])]); return { ok: true, stdout: ENABLED_BLOCK }; };
    machine.boardAutostartCheck(spy, { platform: 'darwin' });
    // Non-vacuous: on the present-path the check MUST probe launchctl at least
    // once, so a future refactor that short-circuits the runner cannot let this
    // guard pass by making zero calls.
    assert.ok(calls.length >= 1, 'the check made no launchctl call, so the never-mutates loop below is vacuous');
    for (const c of calls) {
      const verb = c[1];
      assert.equal(verb, 'print-disabled', `a health check must not run a mutating launchctl verb: ${c.join(' ')}`);
      assert.ok(!/^(enable|disable|bootstrap|bootout|stop|start|load|unload|kickstart)$/.test(verb),
        `mutating verb reached the board-autostart check: ${verb}`);
    }
  });
});

test('#2397 / #570: a platform with nothing true to say has the row omitted (null), not a false state', () => {
  /* ⚠️ THIS USED TO ASSERT THE OPPOSITE FOR win32, AND THAT WAS THE BUG. #2397
     read "no launchd" as "no answer", so a Windows Settings screen never raised
     the subject -- while the true answer was "the board does not come back" for
     every Windows board ever run (WINDOWS-ROADMAP §3c, BLOCKER 4). win32 now has
     a real substrate to read (the board's Scheduled Task, engine/win32board.js)
     and therefore a real row; the omission is for platforms where we still have
     nothing true to say. Its own rows are pinned in
     engine/machine.win32-autostart-570.test.js. */
  assert.equal(machine.boardAutostartCheck(okRunner, { platform: 'linux' }), null);
  // And check() must filter a null row rather than render an empty one.
  const os2 = require('node:os');
  const p2 = require('node:path');
  const fs2 = require('node:fs');
  const empty = fs2.mkdtempSync(p2.join(os2.tmpdir(), 'kosmos-win-'));
  const got2 = machine.check({ pmset: DESKTOP_AWAKE, claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: okRunner, appDirs: [empty, empty], platform: 'linux' });
  fs2.rmSync(empty, { recursive: true, force: true });
  assert.ok(got2.checks.every((c) => c && c.key && c.state), 'a null row leaked into checks');
  assert.ok(!got2.checks.some((c) => c.key === 'autostart'), 'the autostart row rendered on a platform we cannot read');
});

test('#570: win32 DOES get an autostart row, and check() renders it (the silence was the blocker)', () => {
  const os2 = require('node:os');
  const p2 = require('node:path');
  const fs2 = require('node:fs');
  const empty = fs2.mkdtempSync(p2.join(os2.tmpdir(), 'kosmos-win-'));
  /* `boardTask` injected: no test may shell a real schtasks (this branch's rule 2). */
  const got = machine.check({
    pmset: DESKTOP_AWAKE, claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: okRunner, appDirs: [empty, empty],
    platform: 'win32',
    boardTask: { task: 'Kosmos\\board', bundle: true, registered: false, enabled: false, running: false, claimed: false, removeHint: 'schtasks /Delete /F /TN "Kosmos\\board"' },
  });
  fs2.rmSync(empty, { recursive: true, force: true });
  const row = got.checks.find((c) => c.key === 'autostart');
  assert.ok(row, 'a Windows board that will not come back must not be silent about it');
  assert.equal(row.state, machine.STATE.ATTENTION);
});

/* ---------------------------------------------------------------------------
   The whole screen
--------------------------------------------------------------------------- */

test('five checks come back, and the two kinds of not-ok are counted apart', () => {
  // app-location gets DETERMINISTIC dirs: without appDirs this test would
  // read this machine's real /Applications and pass or fail by whether the
  // machine running the suite happens to have Kosmos installed.
  const os = require('node:os');
  const nodePath = require('node:path');
  const fs = require('node:fs');
  const sb = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-check-'));
  fs.mkdirSync(nodePath.join(sb, 'Kosmos.app'));
  // The label check reads the launch-dir seam; point it at an empty sandbox
  // so this test cannot go red or green by the operator's real jobs.
  const origLaunch = process.env.AGENT_WORKFORCE_LAUNCH;
  process.env.AGENT_WORKFORCE_LAUNCH = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-launch-'));
  const got = machine.check({
    pmset: DESKTOP_SLEEPS,             // one real problem
    claudeBin: REAL_BIN,
    tmuxBin: REAL_BIN,
    runner: okRunner,
    appDirs: [sb, sb],
    // #2397: pin platform so the autostart row is present cross-platform, and
    // installedRoot null so the empty-sandbox board absence reads as
    // from-source (OK, benign) rather than a missing-job attention -- keeping
    // the attention/unknown counts below about the rows this test is measuring.
    platform: 'darwin',
    installedRoot: null,
  });
  fs.rmSync(sb, { recursive: true, force: true });
  if (origLaunch === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = origLaunch;
  // Five since the board-autostart row joined (#2397, the cannot-see-zero arm).
  assert.equal(got.checks.length, 5);
  assert.deepEqual(got.checks.map((c) => c.key), ['installed', 'sleep', 'restart', 'labels', 'autostart']);
  assert.equal(got.attention, 1);
  assert.equal(got.unknown, 0);
  // Beside the rows, never among them: where the app sits has no bearing on
  // whether an agent runs, so it must not join what step 2 counts and step 4
  // captions as "an agent made now may not run until that is sorted".
  assert.equal(got.appLocation.state, machine.STATE.OK);

  /**
   * ⚠️ NOT ADDED TOGETHER. "Two things need your attention" over one real
   * problem and one thing we could not read is a sentence that is false about
   * half of what it counts — and it is false in the direction that makes a
   * person go looking for a problem that does not exist.
   */
  const sb2 = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-check2-'));
  // #1794: the `labels` check also reads the launch-dir seam (machine.js
  // launchDir(): AGENT_WORKFORCE_LAUNCH else $HOME/Library/LaunchAgents), so
  // the mixed call needs the SAME empty sandbox `got` used above. Without it,
  // the restore two lines up leaves the real value in place, `labels` reads the
  // operator's real ~/Library/LaunchAgents, and this test passes on a box that
  // has a com.kosmos.board job (e.g. Agent1s) but fails on a clean runner where
  // it does not (`labels` -> unknown, unknown count 1 -> 2). Set/restore mirrors
  // `got` above so a failing assertion below cannot leak the env either.
  const origLaunch2 = process.env.AGENT_WORKFORCE_LAUNCH;
  const launchSb2 = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-launch2-'));
  process.env.AGENT_WORKFORCE_LAUNCH = launchSb2;
  const mixed = machine.check({
    pmset: 'nonsense',
    // tmuxBin is the missing one (#979): Claude Code no longer makes this row
    // attention, so pointing the absent path at it would leave nothing for
    // the count assertions below to count.
    claudeBin: REAL_BIN,
    tmuxBin: '/nope/tmux',
    runner: okRunner,
    // Deliberately EMPTY, so the app-location answer is attention -- and the
    // counts below prove that attention is not added to the rows'. Folding it
    // in is exactly how the wizard came to state a false cause on the
    // fresh-install path.
    appDirs: [sb2, sb2],
    // #2397: keep the autostart row OK (from-source) so it does not perturb the
    // attention/unknown counts this block measures.
    platform: 'darwin',
    installedRoot: null,
  });
  fs.rmSync(sb2, { recursive: true, force: true });
  fs.rmSync(launchSb2, { recursive: true, force: true });
  if (origLaunch2 === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = origLaunch2;
  assert.equal(mixed.attention, 1);
  assert.equal(mixed.unknown, 1);
  assert.equal(mixed.appLocation.state, machine.STATE.ATTENTION,
    'the premise of the count assertion above: app-location IS attention here, and still not counted');
});

test('every check reports one of exactly three states, and always says something', () => {
  // A guard on the shape rather than on any one message: a check that returns a
  // state the screen has no branch for renders as nothing at all.
  // appDirs pinned to an empty sandbox: a stat of the machine's real
  // /Applications is read-only and shape-safe, but a test that touches the
  // real machine at all is one more thing a reviewer must reason about.
  const os = require('node:os');
  const nodePath = require('node:path');
  const empty = require('node:fs').mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-shape-'));
  const runs = [
    machine.check({ pmset: DESKTOP_AWAKE, claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: okRunner, appDirs: [empty, empty] }),
    machine.check({ pmset: LAPTOP_SLEEPS_ON_BATTERY, claudeBin: '/nope', tmuxBin: '/nope', runner: deadRunner, appDirs: [empty, empty] }),
    machine.check({ pmset: 'junk', claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: deadRunner, appDirs: [empty, empty] }),
  ];
  require('node:fs').rmSync(empty, { recursive: true, force: true });
  for (const got of runs) {
    // The shape rule covers appLocation too: it renders through the same row
    // grammar on step 5, so a state the screen has no branch for is the same
    // nothing-at-all there as in the rows.
    for (const c of [...got.checks, got.appLocation]) {
      assert.ok(['ok', 'attention', 'unknown'].includes(c.state), `bad state: ${c.state}`);
      assert.ok(c.title && c.title.length > 0, `${c.key} has no title`);
      assert.ok(c.detail && c.detail.length > 0, `${c.key} has no detail`);
    }
  }
});

test('nothing in here changes a setting', () => {
  /**
   * ⚠️ The wireframe draws a "Change this for me" button. Doing it needs
   * `sudo pmset`, which this server cannot ask for — so the button would offer
   * something it cannot do. This pins the decision: if somebody adds the write
   * later it has to be a deliberate act, not a quiet one.
   */
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'machine.js'), 'utf8');
  assert.ok(!/pmset['"\s,\]]*.*(-a|-b|-c)\b/.test(src.replace(/\*.*$/gm, '')),
    'machine.js now runs pmset with a setting flag, which writes power settings');
  assert.ok(!/\bsudo\b/.test(src.replace(/^\s*\*.*$/gm, '')),
    'machine.js now shells out to sudo');
});

test('an unreadable AC section does not throw away a readable battery one', () => {
  /**
   * ⚠️ THE SAME DEFECT, MIRRORED, IN THE SAME FUNCTION. The "report the known
   * half first" fix was made for an unreadable BATTERY section and not for an
   * unreadable AC one, so a laptop whose battery section says it sleeps after
   * ten minutes came back as a flat "we could not tell whether this Mac goes
   * to sleep" — discarding a measured, actionable finding because a different
   * reading failed.
   */
  const acJunk = 'Battery Power:\n sleep                10\n\nAC Power:\n sleep                x\n';
  const got = machine.sleepCheck(acJunk);
  assert.equal(got.state, 'attention',
    'a known battery sleep setting was demoted to "we could not tell" by an unreadable AC section');
  assert.match(got.title, /battery/i);
  assert.match(got.title, /10 minutes/);
  assert.match(got.detail, /could not read what it does while it is plugged in/,
    'said nothing about the half it genuinely could not read');

  // The control: with BOTH unreadable there really is nothing to report.
  const bothJunk = 'Battery Power:\n sleep                y\n\nAC Power:\n sleep                x\n';
  assert.equal(machine.sleepCheck(bothJunk).state, 'unknown',
    'invented a finding out of two unreadable sections');

  // #2587: this AC-unreadable branch is the DOCUMENTED exclusion (machine.js:165) -- the
  // note's most important NEGATIVE case. It must NOT carry battOnly, because the advisory
  // sleep step's honest note promises "plugged in it keeps working" and an unreadable AC
  // cannot confirm that; the row keeps "Turn On" instead. Pin the flag's absence at both
  // layers so a later edit that shows the note on an unconfirmable premise fails loudly.
  assert.ok(!got.battOnly, 'the AC-unreadable branch must not set battOnly (its plugged-in state is unconfirmed)');
  assert.equal(machine.sleepGate({ pmset: acJunk }).battOnly, false,
    'sleepGate must not flag the AC-unreadable branch as the laptop-note (battOnly) case');
});

test('when both power sources sleep, the shorter one is not left unsaid', () => {
  // ⚠️ Reporting only the AC number on a laptop that sleeps after a minute on
  // battery names the longer of the two intervals and hides the one that bites.
  const got = machine.sleepCheck('Battery Power:\n sleep                1\n\nAC Power:\n sleep                5\n');
  assert.equal(got.state, 'attention');
  assert.match(got.title, /5 minutes/);
  assert.match(got.detail, /On battery it sleeps after 1 minute/,
    'the shorter interval went unmentioned');
});

test('a path we refuse on sight is not described as a path we looked at', () => {
  /**
   * ⚠️ "We looked for tmux at <path>" is a sentence about an action nobody
   * took. These are refused on sight — so if the binary really is at that path,
   * the person checks, finds it exactly where the screen says it is not, and
   * the actual cause (a quote in the path) is named nowhere at all.
   */
  const quoted = `/opt/home${String.fromCharCode(39)}brew/bin/tmux`;
  const create = require('./create');
  assert.equal(create.unusablePath(quoted), true, 'the fixture is no longer a refused path');

  const got = machine.installedCheck({ claudeBin: REAL_BIN, tmuxBin: quoted });
  assert.equal(got.state, 'attention');
  assert.ok(!/We looked for/.test(got.detail),
    'claimed to have looked at a path it refused on sight');
  assert.match(got.detail, /quote|backslash|line break/,
    'never names the character that is actually the problem');
  assert.match(got.title, /cannot start agents/);
  /* ⭐ AND THE REMEDY MUST NOT BE A PLAIN REINSTALL HERE. An unusable path means
     the place Kosmos is installed carries a quote, a backslash or a line break.
     Reinstalling to that same place reproduces it exactly, so "reinstall" would
     be advice that cannot work -- the same defect as the sentence this card
     replaced, in different clothes. */
  assert.ok(!/Reinstalling Kosmos puts it back/.test(got.detail),
    'offered a reinstall for a fault a reinstall to the same folder would reproduce');
  assert.match(got.detail, /folder with no quotes/);
});

test('a refused path is SAID rather than dropped, and an unchosen provider is not named', () => {
  /**
   * ⚠️ THE THIRD TIME THIS FUNCTION DROPPED A FINDING BY RETURNING EARLY.
   * `unreadable` beat `missing` first; then `unusable` was added with its own
   * early return AHEAD of both, so a genuinely absent Claude went unmentioned
   * whenever the tmux path happened to carry a quote. Measured, and reachable
   * in real life by a home directory with an apostrophe in it.
   *
   * The two earlier fixes were local; this asserts the structural property, so
   * a fourth bucket added later cannot quietly reintroduce it.
   */
  /* 🛑 THIS TEST LOST ITS SUBJECT TO #979, AND SAYING SO IS THE POINT.
     It asserted that TWO required findings (a definitely-absent Claude and a
     refused tmux path) are BOTH said rather than the first one winning. With
     Claude Code demoted to informational there is exactly ONE required part,
     and one part lands in exactly one bucket, so two simultaneous required
     findings can no longer be constructed at all.

     ⚠️ THE MACHINERY IS KEPT, NOT REMOVED, and that is a deliberate trade: it
     is correct code that three separate incidents paid for, and a second
     required part is a plausible future. But it is now UNREACHABLE by test,
     which is a real cost and is recorded on the plan rather than left for
     someone to discover as dead code.

     What is still reachable, and still worth pinning, is the half that does
     not need two parts: a refused path is SAID rather than silently dropped,
     and the informational part is not named at somebody who never chose it. */
  const quoted = `/opt/home${String.fromCharCode(39)}brew/bin/tmux`;
  const got = machine.installedCheck({ claudeBin: '/definitely/not/here/claude', tmuxBin: quoted });
  assert.equal(got.state, 'attention');
  assert.match(got.detail, /home.brew\/bin\/tmux/,
    'the refused path went unmentioned, which is how it went unfixed');
  assert.doesNotMatch(got.title + ' ' + got.detail, /Claude/,
    'an absent Claude Code was named to somebody who may only want GPT');
  assert.equal(got.present.claude, false,
    'and the fact is still reported, it just no longer accuses');
});

test('the app-location check looks in both folders and answers all four states', () => {
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'kosmos-apploc-'));
  const sys = path.join(sb, 'Applications');
  const home = path.join(sb, 'home-Applications');
  fs.mkdirSync(sys); fs.mkdirSync(home);

  // Nowhere: attention, with the absence-is-not-absence sentence. macOS keeps the
  // Spotlight wording; a non-mac platform must NOT get it (kosmos#2086: a Windows
  // user was shown "Spotlight" on the first-run screen). Platform is passed
  // explicitly so both branches are asserted regardless of the test host's OS.
  const none = machine.appLocationCheck({ appDirs: [sys, home], platform: 'darwin' });
  assert.equal(none.state, machine.STATE.ATTENTION);
  assert.match(none.detail, /not the same as it not being there/);
  assert.match(none.detail, /Spotlight/);
  /* win32-board-copy: a NON-mac platform, not Windows specifically. Windows no longer
     looks in Applications folders at all (W-16: it reports the Kosmos folder, asserted
     in machine.win32-sleep.test.js), so the neutral-wording arm is Linux-shaped now. */
  const noneWin = machine.appLocationCheck({ appDirs: [sys, home], platform: 'linux' });
  assert.equal(noneWin.state, machine.STATE.ATTENTION, 'the state is the same off macOS; only the wording changes');
  assert.match(noneWin.detail, /not the same as it not being there/);
  assert.doesNotMatch(noneWin.detail, /Spotlight|the Dock|Applications folder/,
    'a Windows user was shown a macOS-only instruction on the first-run screen (#2086)');

  // In the system folder: ok, the plain Applications title.
  fs.mkdirSync(path.join(sys, 'Kosmos.app'));
  const there = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(there.state, machine.STATE.OK);
  assert.match(there.title, /your Applications folder/);
  assert.ok(!/home folder/.test(there.title));

  // In the home folder only: ok, the home-folder title (the installer's own
  // wording for the fallback that confused the first clean-machine tester).
  fs.rmdirSync(path.join(sys, 'Kosmos.app'));
  fs.mkdirSync(path.join(home, 'Kosmos.app'));
  const homey = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(homey.state, machine.STATE.OK);
  assert.match(homey.title, /inside your home folder/);

  // A FILE named Kosmos.app is not the app: keep looking, find the real one.
  fs.rmdirSync(path.join(home, 'Kosmos.app'));
  fs.writeFileSync(path.join(sys, 'Kosmos.app'), 'not an app');
  fs.mkdirSync(path.join(home, 'Kosmos.app'));
  const past = machine.appLocationCheck({ appDirs: [sys, home] });
  assert.equal(past.state, machine.STATE.OK, 'a file wearing the name must not stop the look');
  assert.match(past.title, /inside your home folder/);

  // An unreadable FIRST folder does not end the look: the app sitting in the
  // second one is still a definite yes. (This is the recovered half of the
  // could-not-look rule; the eager-unknown version told this machine "we
  // could not check" with the answer one iteration away.)
  // ⚠️ Skipped as root, stated loudly: root stats through mode 000, so the
  // sealed folder stops sealing and both this case and the blind one below
  // would assert against a premise that does not hold.
  const sealed = path.join(sb, 'sealed');
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    console.log('  (running as root: sealed-folder cases skipped, mode 000 does not seal for root)');
  } else {
    try {
      fs.mkdirSync(sealed, { mode: 0o000 });
      const recovered = machine.appLocationCheck({ appDirs: [path.join(sealed, 'Applications'), home] });
      assert.equal(recovered.state, machine.STATE.OK,
        'an unreadable first folder must not eat a find in the second');

      // Could not look ANYWHERE it mattered: unknown, and the copy insists
      // nothing is wrong. Home is emptied first -- with the app still there,
      // this case would be the recovered one above.
      fs.rmdirSync(path.join(home, 'Kosmos.app'));
      const blind = machine.appLocationCheck({ appDirs: [path.join(sealed, 'Applications'), home] });
      assert.equal(blind.state, machine.STATE.UNKNOWN);
      assert.match(blind.detail, /Nothing is wrong/);
    } finally {
      // In a finally: an assertion throw between mkdir and here used to leave
      // an unreadable folder in tmp that rmSync could not remove.
      try { fs.chmodSync(sealed, 0o755); } catch { /* never made */ }
    }
  }

  // The injected-extra branch (a third directory) renders copy that names
  // no folder in title OR detail -- reachable only from tests, which is
  // exactly why a test has to be the thing that renders it.
  fs.mkdirSync(path.join(home, 'Kosmos.app'), { recursive: true });
  const extra = machine.appLocationCheck({ appDirs: [sys, sys, home] });
  assert.equal(extra.state, machine.STATE.OK);
  assert.match(extra.title, /found the Kosmos icon on this computer/);
  assert.ok(!/folder/.test(extra.title), 'the extra-dir title must name no folder');
  assert.match(extra.detail, /from where you found it/);
  fs.rmSync(path.join(home, 'Kosmos.app'), { recursive: true, force: true });

  // A malformed override THROWS rather than silently probing the real machine.
  assert.throws(() => machine.appLocationCheck({ appDirs: [] }), /non-empty list of folders/);
  assert.throws(() => machine.appLocationCheck({ appDirs: sys }), /non-empty list of folders/);
  // A non-string ELEMENT is the half that matters: path.join would TypeError
  // inside the look and fabricate a could-not-look no test would question.
  assert.throws(() => machine.appLocationCheck({ appDirs: [123] }), /non-empty list of folders/);

  fs.rmSync(sb, { recursive: true, force: true });
});

test('#2086: findAppHint gives macOS the Spotlight wording and every other platform neutral wording', () => {
  // The macOS branch keeps the Spotlight instruction.
  assert.match(machine.findAppHint('darwin'), /Spotlight/);
  // Every non-mac platform must carry NO macOS-only instruction. This is the
  // control that can return the dangerous answer: if the gate were absent,
  // findAppHint('win32') would still say Spotlight and this reds.
  assert.doesNotMatch(machine.findAppHint('win32'), /Spotlight|the Dock|Applications folder/);
  assert.doesNotMatch(machine.findAppHint('linux'), /Spotlight|the Dock|Applications folder/);
  // And the two branches genuinely differ (the gate is live, not two copies of
  // one string).
  assert.notEqual(machine.findAppHint('darwin'), machine.findAppHint('win32'));
});

test('the app-location answer rides BESIDE the machine report, never among its rows', () => {
  const os = require('node:os');
  const nodePath = require('node:path');
  const fs = require('node:fs');
  // Deterministic dirs and a stubbed runner: this test used to read the real
  // /Applications and shell out to the real launchctl under a green run.
  const empty = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'kosmos-join-'));
  const got = machine.check({ pmset: 'sleep 0', claudeBin: REAL_BIN, tmuxBin: REAL_BIN, runner: okRunner, appDirs: [empty, empty] });
  fs.rmSync(empty, { recursive: true, force: true });
  assert.equal(got.appLocation.key, 'app-location',
    'the /api/machine payload must carry the app-location answer for first-run step 5');
  assert.ok(!got.checks.some((c) => c.key === 'app-location'),
    'in the rows, step 2 counts it and step 4 captions it as a reason an agent may not run');
});

test('the sleep-pane capability: derived from disk by id, refusing honestly, never caller-named', () => {
  const machine = require('./machine');
  try {
    // With a runner that answers the accepted id, the URL is built FROM THE
    // ID THE PLIST ANSWERED, not from a table keyed on anything else.
    machine.resetSleepPaneCache();
    const asked = [];
    const url = machine.sleepPaneUrl((cmd, args) => {
      asked.push([cmd, args]);
      return { ok: true, stdout: 'com.apple.Battery-Settings.extension\n' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(url, 'x-apple.systempreferences:com.apple.Battery-Settings.extension');
    assert.ok(asked.every(([cmd]) => cmd === '/usr/bin/defaults'), 'the probe ran something other than defaults');

    // An id OUTSIDE the accepted set is not a pane we claim: no button, no
    // guessing (reliability-or-no-button).
    machine.resetSleepPaneCache();
    const none = machine.sleepPaneUrl(
      () => ({ ok: true, stdout: 'com.apple.SomethingElse.extension\n' }),
      () => ['FakePowerPane.appex']);
    assert.equal(none, null, 'an unrecognised pane id produced a URL');

    // A dir with no matching appex, and a dir that cannot be read at all:
    // both are the no-button world, never a throw (the safe failure).
    assert.equal(machine.sleepPaneUrl(() => { throw new Error('runner must not be called'); }, () => []), null);
    assert.equal(machine.sleepPaneUrl(() => { throw new Error('runner must not be called'); }, () => { throw new Error('EACCES'); }), null);

    // ⚠️ And an injected world never touches the cache in either direction:
    // the real probe after an injected one answers from the real machine,
    // not from the injection.
    machine.resetSleepPaneCache();
    machine.sleepPaneUrl(() => ({ ok: true, stdout: 'com.apple.Battery-Settings.extension' }), () => ['FakePowerPane.appex']);
    const realAfterInjected = machine.sleepPaneUrl();
    const realFresh = (machine.resetSleepPaneCache(), machine.sleepPaneUrl());
    assert.equal(realAfterInjected, realFresh, 'an injected probe wrote the cache the real world then read');

    // openSleepSettings derives the URL itself and hands `open` exactly that
    // string; with no pane it refuses with its sentence and runs nothing.
    machine.resetSleepPaneCache();
    let opened = null;
    const ok = machine.openSleepSettings((cmd, args) => {
      if (cmd === '/usr/bin/defaults') return { ok: true, stdout: 'com.apple.Energy-Saver-Settings.extension' };
      opened = [cmd, args];
      return { ok: true, stdout: '' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(ok.ok, true);
    assert.deepEqual(opened, ['/usr/bin/open', ['x-apple.systempreferences:com.apple.Energy-Saver-Settings.extension']]);

    machine.resetSleepPaneCache();
    let ran = 0;
    const refused = machine.openSleepSettings((cmd) => {
      if (cmd === '/usr/bin/defaults') return { ok: false, stdout: '' };
      ran += 1;
      return { ok: true, stdout: '' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(refused.ok, false);
    assert.match(refused.because, /could not find the sleep settings screen/);
    assert.equal(ran, 0, 'open ran with no pane found');
  } finally {
    machine.resetSleepPaneCache();
  }
});

test('the sleep-pane filter matches STEM names a whole-word filter misses (0.6.41 robustness)', () => {
  const machine = require('./machine');
  try {
    // The discriminating case is `Batteries.appex`: it contains `batter` but NOT
    // the whole word `battery`, so the OLD `/power|energy|battery/` dropped it
    // before the id check ever ran -- exactly how a real macOS could leave the
    // button unable to find its pane. `PowerManagement.appex` (has `power`) and
    // `EnergySaver.appex` (has `energy`) already matched the old substring filter;
    // they stay here as belt-and-suspenders coverage, not as proof of the widening.
    for (const name of ['Batteries.appex', 'PowerManagement.appex', 'EnergySaver.appex']) {
      machine.resetSleepPaneCache();
      const url = machine.sleepPaneUrl(
        () => ({ ok: true, stdout: 'com.apple.Battery-Settings.extension\n' }),
        () => [name]);
      assert.equal(url, 'x-apple.systempreferences:com.apple.Battery-Settings.extension',
        'a stem-named power pane (' + name + ') was not probed');
    }

    // The wider net still cannot claim a WRONG pane: the closed id set decides.
    machine.resetSleepPaneCache();
    assert.equal(
      machine.sleepPaneUrl(() => ({ ok: true, stdout: 'com.apple.batteryui.BatterySettingsIntents\n' }),
        () => ['BatterySettingsIntentsExtension.appex']),
      null, 'a battery-named appex with an unrecognised id produced a URL');

    // The refusal now tells the person how to do it by hand, so an unrecognised
    // macOS is completable rather than a dead button.
    machine.resetSleepPaneCache();
    const refused = machine.openSleepSettings((cmd) => {
      if (cmd === '/usr/bin/defaults') return { ok: false, stdout: '' };
      return { ok: true, stdout: '' };
    }, () => ['FakePowerPane.appex']);
    assert.equal(refused.ok, false);
    assert.match(refused.because, /Open System Settings/);
    assert.match(refused.because, /automatic sleep/);
    assert.doesNotMatch(refused.because, /\u2014/, 'failure copy must not contain an em dash');
  } finally {
    machine.resetSleepPaneCache();
  }
});

test('the sleep row carries the settings flag from the same probe', () => {
  const machine = require('./machine');
  try {
    machine.resetSleepPaneCache();
    const got = machine.check({
      pmset: DESKTOP_AWAKE,
      lister: () => ['FakePowerPane.appex'],
      runner: (cmd) => (cmd === '/usr/bin/defaults'
        ? { ok: true, stdout: 'com.apple.Battery-Settings.extension' }
        : { ok: true, stdout: '' }),
    });
    const sleep = got.checks.find((c) => c.key === 'sleep');
    assert.equal(sleep.settings, true, 'the pane exists but the row does not offer the button');

    machine.resetSleepPaneCache();
    const without = machine.check({
      pmset: DESKTOP_AWAKE,
      lister: () => ['FakePowerPane.appex'],
      runner: (cmd) => (cmd === '/usr/bin/defaults' ? { ok: false, stdout: '' } : { ok: true, stdout: '' }),
    });
    const sleep2 = without.checks.find((c) => c.key === 'sleep');
    assert.equal(sleep2.settings, false, 'no pane found but the row still offers the button');
  } finally {
    machine.resetSleepPaneCache();
  }
});

test('revealApp opens Finder at the icon it re-derives, and refuses honestly when there is none', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-reveal-'));
  fs.mkdirSync(nodePath.join(dir, 'Kosmos.app'));
  let empty = null;
  let args = null;
  machine.setAppRevealRunner((cmd, a) => { args = [cmd, a]; });
  try {
    // Found: open -R at the RE-DERIVED path, nothing from any caller.
    const got = machine.revealApp({ appDirs: [dir] });
    assert.deepEqual(got, { ok: true });
    assert.deepEqual(args, ['/usr/bin/open', ['-R', nodePath.join(dir, 'Kosmos.app')]]);

    // A FILE named Kosmos.app is not the app; the refusal sentence says
    // what to do, not what threw.
    empty = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-reveal-none-'));
    fs.writeFileSync(nodePath.join(empty, 'Kosmos.app'), 'not a bundle');
    args = null;
    assert.throws(() => machine.revealApp({ appDirs: [empty] }), /could not find the Kosmos icon just now/);
    assert.equal(args, null, 'a refusal ran the opener anyway');

    // The same malformed-override guard as the check.
    assert.throws(() => machine.revealApp({ appDirs: [] }), /non-empty list of folders/);

    // Errored is NOT not-found: a folder we cannot read refuses with the
    // could-not-look sentence, never the not-there one. (Mode 000 does not
    // seal for root, same caveat as the render harness's blind fixture.)
    const sealed = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'aw-reveal-sealed-'));
    fs.chmodSync(sealed, 0o000);
    try {
      args = null;
      assert.throws(() => machine.revealApp({ appDirs: [nodePath.join(sealed, 'Applications')] }),
        /could not look just now/);
      assert.equal(args, null, 'a could-not-look refusal ran the opener anyway');
    } finally {
      fs.chmodSync(sealed, 0o755);
      fs.rmSync(sealed, { recursive: true, force: true });
    }
  } finally {
    machine.setAppRevealRunner(null);
    // Leaked sandboxes are how one test's world becomes another's -- the
    // server suite's after-hook says why; this test holds the same line.
    fs.rmSync(dir, { recursive: true, force: true });
    if (empty) fs.rmSync(empty, { recursive: true, force: true });
  }
});

test('labelTruthCheck: a registered Kosmos label pointing anywhere but its real file goes red, and unregistered is not a hijack', () => {
  const os = require('node:os');
  const fs = require('node:fs');
  const nodePath = require('node:path');
  const home = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'lt-home-'));
  const launch = nodePath.join(home, 'Library', 'LaunchAgents');
  fs.mkdirSync(launch, { recursive: true });
  fs.writeFileSync(nodePath.join(launch, 'com.kosmos.board.plist'), 'x');
  fs.writeFileSync(nodePath.join(launch, 'com.kosmos.agent.anna.plist'), 'x');
  const origLaunch2 = process.env.AGENT_WORKFORCE_LAUNCH;
  process.env.AGENT_WORKFORCE_LAUNCH = launch;
  try {
    const answers = {
      'com.kosmos.board': `gui/501/com.kosmos.board = {\n\tpath = ${nodePath.join(launch, 'com.kosmos.board.plist')}\n\tstate = running\n}`,
      'com.kosmos.agent.anna': `gui/501/com.kosmos.agent.anna = {\n\tpath = /private/tmp/kosmos-clean-XYZ/home/Library/LaunchAgents/com.kosmos.agent.anna.plist\n\tstate = not running\n}`,
    };
    const runner = (cmd, args) => {
      const label = String(args[1] || '').split('/').pop();
      return answers[label] ? { ok: true, stdout: answers[label] } : { ok: false, stdout: '' };
    };
    const row = machine.labelTruthCheck(runner);
    assert.equal(row.state, machine.STATE.ATTENTION, JSON.stringify(row));
    assert.match(row.detail, /com\.kosmos\.agent\.anna is registered from \/private\/tmp\/kosmos-clean-XYZ/);
    /* Control the healthy way round: both labels honest -> OK, so the alarm
       can come off. */
    answers['com.kosmos.agent.anna'] = `gui/501/com.kosmos.agent.anna = {\n\tpath = ${nodePath.join(launch, 'com.kosmos.agent.anna.plist')}\n\tstate = running\n}`;
    assert.equal(machine.labelTruthCheck(runner).state, machine.STATE.OK);
    /* Unregistered (launchctl print fails) is not a hijack: a stopped agent
       with no job is #150's story, not this row's. */
    const offRunner = () => ({ ok: false, stdout: '' });
    assert.equal(machine.labelTruthCheck(offRunner).state, machine.STATE.OK);
  } finally {
    if (origLaunch2 === undefined) delete process.env.AGENT_WORKFORCE_LAUNCH; else process.env.AGENT_WORKFORCE_LAUNCH = origLaunch2;
  }
});

/* kosmos#1004 (Josh: call it "this computer", not "this Mac"). A COUNT, not a
   spot-check, and the count is the whole point: the first pass at this changed
   FOUR sentences and was reported done, while TWELVE live strings still said
   "this Mac". Nobody was careless -- the four that were fixed were the four
   somebody had looked at, and a spot-check cannot tell you about the ones you
   did not think to open. So this asserts the absence across the file.
   ⚠️ COMMENTS ARE EXEMPT ON PURPOSE. Three of them quote what an older
   sentence used to print, and rewording those falsifies a record rather than
   fixing copy -- the same distinction as editing a bug report to match the
   fix. The classifier below is deliberately crude and errs toward INCLUDING a
   line: a false positive costs someone thirty seconds, a false negative is
   exactly the failure this test exists to stop. */
/* kosmos#1270 EXTENDS THE SAME COUNT TO THE OTHER TWO SURFACES THAT SPEAK.
   The guard below was written for this file under #1004 and did its job here.
   It could not see `web/index.html` (34 live sentences) or `engine/runners.js`
   (3), which is how a page went on saying "this Mac" under a navigation label
   reading "This computer" for weeks.
   ⚠️ COMMENTS ARE LEFT ALONE ON PURPOSE, here and there. They quote Josh, cite
   old rulings, and rewriting the words inside a quotation falsifies the record.
   The count is over what a PERSON reads. */
/* The files that say sentences to a PERSON. #1270 shipped this list with two
   entries while its own title said "every live sentence", and the gap was not
   theoretical: twelve live sentences in server.js and seven engine modules
   still said "this Mac" afterwards, and this test was green the whole time.
   ⚠️ A GUARD NARROWER THAN THE CLASS IT NAMES IS THE FAILURE IT WAS WRITTEN TO
   PREVENT, arriving by a different door. It reports clean about the half it can
   see, and its existence is what stops anyone looking again.
   📌 install/, native-app/ and tools/ are DELIBERATELY ABSENT and carded
   separately: the installer and the Mac app run only on macOS, so "this Mac" may
   be correct there, and that is a judgement rather than a sweep.
   📌 engine/defaults.js is absent for a different reason: its one live use is
   agent instruction text about the macOS permission box that names "tmux", which
   is macOS-specific in substance. Renaming it would not make it true on Windows,
   it would make it a wrong sentence about a prompt that does not exist there. */
const OTHER_SPEAKING_FILES = [
  'web/index.html', 'engine/runners.js', 'server.js', 'engine/devicedoor.js',
  'engine/remote.js', 'engine/create.js', 'engine/projects.js',
  'engine/attachments.js', 'engine/openaiaccounts.js', 'engine/trust.js',
];
test('no live sentence in the other speaking files says "this Mac" either', () => {
  const fs2 = require('node:fs'); const path2 = require('node:path');
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, ' ')
                        .replace(/^\s*(?:\/\/|\*).*$/gm, ' ')
                        .replace(/<!--[\s\S]*?-->/g, ' ');
  const bad = [];
  for (const f of OTHER_SPEAKING_FILES) {
    /* ⚠️ `..` BECAUSE THIS SUITE LIVES IN engine/, NOT AT THE ROOT. My first
       version joined against __dirname and read engine/web/index.html, which
       does not exist, so readFileSync THREW and the test failed with no message
       naming a file. A throw before the assertion looks exactly like a real
       finding and tells you nothing, which cost a round trip to notice. */
    const live = strip(fs2.readFileSync(path2.join(__dirname, '..', f), 'utf8'));
    /* 🛑 CASE-INSENSITIVE, AND THAT IS NOT TIDINESS. The first version matched
       `/this Mac/` only, so it could not see "This Mac" at the start of a
       sentence -- which is exactly where prose puts it. One such sentence
       survived #1270 in a JS-built string, said "This Mac keeps the key" beside
       "kept in one file on this computer" on the same door, and BROKE THE 0.5.95
       CUT at the page layer. A browser check reading the rendered DOM found it;
       every source check reported clean. */
    const n = (live.match(/[Tt]his Mac/g) || []).length;
    if (n) bad.push(`${f}: ${n}`);
    /* 🔑 A FLOOR ON THE POPULATION, per file, the same rule the machine.js arm
       below already keeps: a zero from a file that was renamed, moved or read
       wrong is indistinguishable from a zero from a clean file. Every file in
       this list speaks to a person, so every one of them must contain the
       replacement phrase at least once. */
    if (!/[Tt]his computer/.test(live)) {
      bad.push(`${f}: says neither phrase, so this check did not look at a speaking file`);
    }
  }
  assert.deepEqual(bad, [], 'these files still say "this Mac" to a person: ' + bad.join(', '));
});

test('no live sentence in this file still says "this Mac"', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'machine.js'), 'utf8');
  /* 🔑 A FLOOR ON THE POPULATION, per Angel (2026-08-26 20:01): a check that
     COUNTS OCCURRENCES and asserts zero says "I looked and found none" and "I
     did not look" in the same words. Without this a renamed class, a broken
     read or a changed spelling finds nothing, reports clean, and the check
     quietly stops being a check. */
  const positives = (src.match(/this computer/g) || []).length;
  assert.ok(positives >= 8,
    `only ${positives} "this computer" sentences found. The rename produced twelve; this low means the wording changed or the file being read is not the one that matters, and an absence check on an unread file always passes`);
  const live = src.split('\n')
    .map((line, i) => [i + 1, line])
    .filter(([, line]) => line.includes('this Mac'))
    .filter(([, line]) => {
      const t = line.trimStart();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    });
  assert.deepEqual(live, [],
    'these lines still say "this Mac" to a person:\n' + live.map(([n, l]) => '  ' + n + ': ' + l.trim()).join('\n'));
});

/* ─────────────────────────────────────────────────────────────────────────
   #2304/#570: installedCheck is platform-injected (like create.unusablePath).
   On Windows there is no tmux; the #570 port runs agents through the Claude CLI,
   so the runner is the required substrate. Before this, installedCheck required
   tmux on every platform and told a Windows user their computer could not run
   agents. Both branches are asserted from this Mac via the `platform` opt.
   ───────────────────────────────────────────────────────────────────────── */

test('#2304 Windows: the runner present is OK even with no tmux (the reported bug)', () => {
  const got = machine.installedCheck({ platform: 'win32', claudeBin: REAL_BIN, tmuxBin: '/definitely/not/here/tmux' });
  assert.equal(got.state, 'ok', 'a Windows box with the runner present must NOT be told it cannot run agents');
  assert.equal(got.present.claude, true, 'the runner is present');
  // The tmux requirement, the Homebrew path, and the macOS-download remedy must
  // not appear on a Windows OK verdict.
  assert.doesNotMatch(got.title + ' ' + got.detail, /tmux|homebrew|\/opt\/homebrew|macOS|Download/i,
    'no tmux / macOS remedy fires when the Windows runner is present');
});

test('#2304 CONTROL: on macOS the identical input still requires tmux (the fix is win32-scoped)', () => {
  // Same bins as the reported-bug case, only the platform differs: macOS still
  // requires tmux, so this must be attention. If the win32 branch had leaked to
  // darwin, this would flip to ok and the discriminator would be lost.
  const got = machine.installedCheck({ platform: 'darwin', claudeBin: REAL_BIN, tmuxBin: '/definitely/not/here/tmux' });
  assert.equal(got.state, 'attention', 'macOS still requires tmux');
});

test('#2304 CONTROL: on macOS a GPT-only box (no Claude, tmux present) is still OK, unchanged', () => {
  const got = machine.installedCheck({ platform: 'darwin', claudeBin: '/definitely/not/here/claude', tmuxBin: REAL_BIN });
  assert.equal(got.state, 'ok', 'the #979 GPT-only behaviour is untouched on macOS');
});

test('#2304 Windows: a missing runner is attention and names the runner, never tmux or a Homebrew path', () => {
  const got = machine.installedCheck({ platform: 'win32', claudeBin: '/definitely/not/here/claude', tmuxBin: REAL_BIN });
  assert.equal(got.state, 'attention', 'no runner on Windows means an agent cannot start');
  assert.equal(got.present.claude, false, 'the runner is absent');
  const text = got.title + ' ' + got.detail;
  assert.doesNotMatch(text, /tmux|homebrew|\/opt\/homebrew/i,
    'the Windows failure must not name tmux or a Homebrew path (tmux is not probed on win32)');
  assert.match(text, /the part that runs agents/,
    'the failure names the substrate a Windows box actually needs');
  // #2304 defect 2 (NOW FIXED, was a KNOWN FOLLOW-UP): the missing-runner remedy
  // must not point a Windows user at the macOS build, and it is framed around
  // installing the runner rather than reinstalling Kosmos.
  assert.doesNotMatch(text, /Download for macOS|macOS/,
    'the Windows missing-runner remedy must not name the macOS download');
  assert.doesNotMatch(text, /Reinstalling Kosmos/,
    'win32 does not tell the user to reinstall Kosmos (that would not put back a missing runner)');
  assert.match(text, /Install the part that runs agents, then open Kosmos again\./,
    'win32 frames the remedy around installing the runner');
});

test('#2304 defect-2 CONTROL: the macOS missing-runner remedy is byte-unchanged (full string, not a substring)', () => {
  // The fix is win32-scoped; darwin must keep Josh's existing wording verbatim.
  // Assert the WHOLE remedy sentence, so an edit to any part of it (not only the
  // "Download for macOS" clause) reds -- the test name claims byte-unchanged, so
  // the assertion pins the full bytes rather than a substring of them.
  const DARWIN_MISSING_REMEDY = 'Reinstalling Kosmos puts it back: open installkosmos.com and click Download for '
    + 'macOS. Your agents and settings stay on this computer; installing again does '
    + 'not remove them.';
  // (On darwin, Claude Code is informational, not required, so a missing claude is
  // still OK -- #979. The remedy string only appears on a REAL macOS failure; assert
  // it via a genuinely-missing REQUIRED part: tmux.)
  const tmuxGone = machine.installedCheck({ platform: 'darwin', claudeBin: REAL_BIN, tmuxBin: '/definitely/not/here/tmux' });
  assert.equal(tmuxGone.state, 'attention');
  assert.ok(tmuxGone.detail.includes(DARWIN_MISSING_REMEDY),
    'macOS keeps the exact existing remedy wording, in full');
  const gpt = machine.installedCheck({ platform: 'darwin', claudeBin: '/definitely/not/here/claude', tmuxBin: REAL_BIN });
  assert.equal(gpt.state, 'ok', 'a darwin GPT-only box is unaffected (#979 control)');
});

test('#2304 defect-2 Windows: the unusable-path arm names no macOS and no backslash', () => {
  // A win32 path carrying a QUOTE still reaches the unusable arm (create.unusablePath
  // forbids a quote on every platform; only the backslash is POSIX-only, #1889). Its
  // detail must not say "the parts of macOS" and must not list "a backslash" as
  // forbidden -- on win32 a backslash is the normal separator.
  const got = machine.installedCheck({ platform: 'win32', claudeBin: 'C:\\Program Files\\cl"aude\\claude.exe', tmuxBin: REAL_BIN });
  assert.equal(got.state, 'attention', 'a quoted path is unusable on every platform');
  assert.match(got.detail, /The path set for/, 'it is the unusable-path arm');
  assert.doesNotMatch(got.detail, /the parts of macOS|a backslash|macOS/,
    'the win32 unusable-path detail must not name macOS or forbid a backslash');
  assert.match(got.detail, /the part of this computer that starts an agent/,
    'the win32 noun is platform-correct');
  assert.match(got.detail, /A quote or a line break/,
    'the win32 forbidden-character list omits the backslash');
  // The unusable-path REMEDY is also runner-framed on win32, not Kosmos-framed:
  // an unusable path on win32 is the RUNNER's path, so "reinstall Kosmos" would
  // not move it (the same reasoning as the missing arm).
  assert.doesNotMatch(got.detail, /Kosmos is installed somewhere it cannot start agents from/,
    'the win32 unusable remedy is not the Kosmos-centric macOS sentence');
  assert.match(got.detail, /The part that runs agents is installed somewhere Kosmos cannot start it from/,
    'the win32 unusable remedy names the runner, whose path is the one that is unusable');
});

test('#2304 defect-2 CONTROL: the macOS unusable-path arm is byte-unchanged (full detail + remedy)', () => {
  const got = machine.installedCheck({ platform: 'darwin', claudeBin: REAL_BIN, tmuxBin: '/opt/home"brew/bin/tmux' });
  assert.equal(got.state, 'attention', 'a quoted path is unusable on macOS too');
  // Full trailing clause pinned (not a substring): the detail sentence AND the
  // Kosmos-framed remedy that a macOS user still correctly sees.
  assert.ok(got.detail.includes('A quote, a backslash or a line break in a path is something we will not pass on to the parts of macOS that start an agent, whatever is at the end of it.'),
    'macOS keeps the exact existing unusable-path detail, in full');
  assert.ok(got.detail.includes('Kosmos is installed somewhere it cannot start agents from. Installing it again to a folder with no quotes, backslashes or line breaks in its name is what fixes this.'),
    'macOS keeps the exact existing Kosmos-framed unusable remedy');
});

test('#2304 Windows: a backslash runner path is classified MISSING, not UNUSABLE (unusablePath is injected)', () => {
  // Before installedCheck threaded `platform` into create.unusablePath, a win32
  // path with backslashes was judged by the darwin regex (which rejects `\`) and
  // reported as an UNUSABLE path -- the wrong bucket and the wrong sentence. With
  // create.unusablePath(bin, platform) it is not unusable on win32, so it reaches
  // the runnability probe and a non-existent path is MISSING. Discriminating: it
  // fails if create.unusablePath at the probe loop drops the injected platform.
  // (The runnability probe runners.isRunnable stays host-platform by its
  // single-argument array-callback contract; that is why this fixture path does
  // not need to exist as a win32-runnable .exe.)
  const got = machine.installedCheck({ platform: 'win32', claudeBin: 'C:\\Program Files\\claude\\claude.exe', tmuxBin: REAL_BIN });
  assert.equal(got.state, 'attention', 'the file does not exist on this Mac, so it is missing');
  assert.match(got.detail, /We looked for the part that runs agents at C:\\Program Files\\claude\\claude\.exe/,
    'a win32 backslash path is reported MISSING at that path');
  assert.doesNotMatch(got.detail, /a backslash|The path set for/,
    'a normal win32 backslash path must NOT be misclassified as an unusable path');
});

test('#2304 Windows: tmux is not probed at all (present.tmux is undefined on win32)', () => {
  const got = machine.installedCheck({ platform: 'win32', claudeBin: REAL_BIN, tmuxBin: REAL_BIN });
  assert.equal(got.present.tmux, undefined, 'win32 does not probe tmux, so present carries no tmux key');
  assert.equal(got.present.claude, true, 'the runner is the win32 substrate and is probed');
});

test('#2304 the platform threads through machine.check to the installed sub-check', () => {
  const os2 = require('node:os'); const path2 = require('node:path'); const fs2 = require('node:fs');
  const empty = fs2.mkdtempSync(path2.join(os2.tmpdir(), 'kosmos-2304-'));
  // win32-board-copy: `powercfg: ''` so the win32 sleep arm reads injected text, never the host's powercfg.
  const got = machine.check({ platform: 'win32', claudeBin: REAL_BIN, tmuxBin: '/definitely/not/here/tmux', pmset: 'System-wide power settings:\n', powercfg: '', appDirs: [empty, empty] });
  fs2.rmSync(empty, { recursive: true, force: true });
  const installed = got.checks.find((c) => c.key === 'installed');
  assert.equal(installed.state, 'ok', 'check({platform:win32}) reaches installedCheck: runner present -> ok, not a tmux attention');
});

test('#2304 an empty or unknown platform falls back to the real platform', () => {
  // `(opts && opts.platform) || process.platform`: an empty string is falsy and
  // falls back, so this box (darwin) still requires tmux -- absent tmux is
  // attention, never a silent win32-shaped pass.
  const got = machine.installedCheck({ platform: '', claudeBin: REAL_BIN, tmuxBin: '/definitely/not/here/tmux' });
  assert.equal(got.state, 'attention', 'a falsy platform must not slip into the win32 branch on a Mac');
});
/* ---------------------------------------------------------------------------
   sleepGate: the Screen 3 (Automation) "Prevent sleep" gate verdict. Same
   three-answers discipline as the a11y / file-access gates -- block ONLY on a
   positive `checkable:true, prevented:false`; anything unreadable is
   `checkable:false` and must never gate. Reuses the sleepCheck fixtures so the
   gate mapping is pinned against the same captured/reconstructed pmset text the
   advisory is.
--------------------------------------------------------------------------- */

test('sleepGate: a desktop that does not sleep -> checkable:true, prevented:true', () => {
  assert.deepEqual(machine.sleepGate({ pmset: DESKTOP_AWAKE }), { checkable: true, prevented: true });
});

test('sleepGate: a desktop that sleeps -> checkable:true, prevented:false (it sleeps)', () => {
  const got = machine.sleepGate({ pmset: DESKTOP_SLEEPS });
  assert.equal(got.checkable, true);
  assert.equal(got.prevented, false);
  // #2587: a fixable desktop is NOT battOnly -- "Turn On" can set Sleep to Never, so it is
  // not the laptop-note case; the row shows the ordinary "Not activated" + Turn On (advisory;
  // the sleep step never gates Next either way).
  assert.equal(got.battOnly, false);
});

test('sleepGate: a laptop awake on both power sources -> prevented:true', () => {
  assert.deepEqual(machine.sleepGate({ pmset: LAPTOP_ALWAYS_AWAKE }), { checkable: true, prevented: true });
});

test('sleepGate: a laptop that sleeps on battery -> prevented:false + battOnly:true (the laptop-note case)', () => {
  const got = machine.sleepGate({ pmset: LAPTOP_SLEEPS_ON_BATTERY });
  assert.equal(got.checkable, true);
  assert.equal(got.prevented, false, 'a machine that can sleep somewhere reads prevented:false -- honest');
  // #2587: THIS is the one state macOS gives no GUI switch to clear (a laptop always
  // sleeps on battery), so it carries battOnly:true and the advisory first-run sleep step
  // shows its honest note keyed on it (in place of the useless Turn On). The verdict stays
  // prevented:false (the engine never claims the Kosmos is safe); the web does not gate Next
  // on the sleep step at all (#2587 pivot).
  assert.equal(got.battOnly, true);
});

test('sleepGate: THE DISCRIMINATOR -- not-prevented and uncheckable are different answers', () => {
  const gated = machine.sleepGate({ pmset: DESKTOP_SLEEPS });
  const uncheckable = machine.sleepGate({ pmset: 'pmset: command not found' });
  assert.equal(gated.checkable && gated.prevented === false, true, 'this one gates');
  assert.equal(uncheckable.checkable, false, 'this one does NOT gate (fail-safe)');
});

test('sleepGate: unreadable pmset (junk, empty, failed runner) -> checkable:false, never a throw', () => {
  for (const junk of ['', 'pmset: command not found', 'AC Power:\n', '{"sleep": 0}']) {
    assert.equal(machine.sleepGate({ pmset: junk }).checkable, false, `junk >>${junk}<< must be uncheckable`);
  }
  const deadRunner = () => ({ ok: false, stdout: '', stderr: 'boom' });
  assert.equal(machine.sleepGate({ runner: deadRunner }).checkable, false, 'a failed pmset read is uncheckable, not a gate');
});
