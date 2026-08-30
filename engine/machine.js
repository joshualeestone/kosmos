'use strict';

/**
 * What first run can tell somebody about their own computer.
 *
 * This is the wireframe's "Checking your computer" screen — screen 7, the one
 * the requirements call the highest-risk in the set, because it is where a
 * person finds out whether the thing they just installed will actually work
 * while they are not looking at it.
 *
 * ⚠️ EVERY CHECK HAS THREE ANSWERS: `ok`, `attention`, and `unknown`. That is
 * this codebase's one rule arriving on a new surface. A check that cannot run
 * must not report the machine as fine, because "your agents will keep working"
 * is the single most expensive sentence on this screen to get wrong: somebody
 * closes the lid on a week of work believing it.
 *
 * ⚠️ AND NOTHING HERE CHANGES ANYTHING. The drawn wireframe puts a "Change this
 * for me" button beside the sleep setting. Changing it is `sudo pmset`, and this
 * server runs as the user with no way to ask for a password — so that button
 * offers something it cannot do, which is the exact defect the rest of this
 * codebase is written against. The check says what it found and where to change
 * it. Deliberate deviation from the drawing, not an omission.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const create = require('./create');

const STATE = { OK: 'ok', ATTENTION: 'attention', UNKNOWN: 'unknown' };

/**
 * ⚠️ Injectable so the tests never depend on the power settings of whatever
 * machine runs the suite — and, more to the point, so the laptop cases can be
 * tested at all on a Mac mini, which has no battery and therefore never prints
 * the section the laptop answer is about.
 */
function run(cmd, args) {
  try {
    /**
     * ⚠️ `maxBuffer` RAISED. `launchctl print gui/<uid>` emits 107 KB on this
     * machine against a 1 MB default, and a busier login session can pass it --
     * at which point `execFileSync` throws and a perfectly healthy machine
     * reports "we could not tell whether your agents will start themselves".
     * It fails to the safe side, but it fails for a reason that has nothing to
     * do with the question.
     */
    return { ok: true, stdout: execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, because: String((err && err.message) || err) };
  }
}

/* ===========================================================================
   Sleep
   =========================================================================== */

/**
 * ⚠️ `pmset -g` IS THE WRONG COMMAND, AND IT IS WRONG ON THIS MACHINE RIGHT NOW.
 * Measured, on the box this was written on:
 *
 *     $ pmset -g
 *      sleep   0 (sleep prevented by Claude, caffeinate, powerd)
 *
 * That block is headed "Currently in use". It is what some *running process* has
 * asserted, not what the machine is set to. A Mac configured to sleep after ten
 * minutes reports `sleep 0` there for as long as something holds a caffeinate —
 * and the moment that process exits, it sleeps. So a check keyed on `pmset -g`
 * tells somebody their agents will keep working, and they stop that afternoon.
 *
 * `pmset -g custom` is the setting. That is the one to read.
 */
function parsePmset(text) {
  const sections = new Map();
  let current = null;
  for (const raw of String(text || '').split('\n')) {
    const header = raw.match(/^(\S[^:]*):\s*$/);
    if (header) {
      current = header[1].trim();
      sections.set(current, new Map());
      continue;
    }
    if (!current) continue;
    /**
     * ⚠️ EXACTLY TWO TOKENS, AND THE KEY MATCHED WHOLE.
     *
     * `pmset` prints `disksleep 10` and `displaysleep 0` and `Sleep On Power
     * Button 1` in the same block as `sleep`. A substring match for `sleep\s+(\d+)`
     * finds the "sleep 10" inside `disksleep              10` — so a machine with
     * the default disk-sleep setting and no system sleep at all would be told its
     * agents stop after ten minutes. Wrong in the alarming direction, on the
     * screen that is entirely about trust.
     */
    const kv = raw.match(/^\s+(\S+)\s+(\S+)\s*$/);
    if (kv) sections.get(current).set(kv[1], kv[2]);
  }
  return sections;
}

/** Minutes until sleep for one power source, or null when it did not say. */
function sleepMinutes(section) {
  if (!section || !section.has('sleep')) return null;
  const raw = section.get('sleep');
  /**
   * ⚠️ PLAIN DECIMAL DIGITS, WHICH IS WHAT `pmset` PRINTS. Anything else is a
   * reading we did not understand, and this module's whole job is not turning
   * one of those into an assertion.
   *
   * Two versions of this were too generous. `Number.isFinite` accepted `-5`,
   * which is neither zero nor greater than zero, so it fell through every
   * branch into "This Mac does not go to sleep". Tightening to
   * `Number.isInteger(n) && n >= 0` then still accepted `0x10`, which `Number`
   * happily reads as 16 — so an uninterpretable value came out as the confident
   * sentence "This Mac goes to sleep after 16 minutes". Both failed by being
   * clever about input, in the direction of saying something.
   */
  if (!/^\d+$/.test(String(raw))) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}

function sleepCheck(text) {
  const sections = parsePmset(text);
  const ac = sections.get('AC Power');
  const battery = sections.get('Battery Power');

  const acSleep = sleepMinutes(ac);
  const battFirst = battery ? sleepMinutes(battery) : null;

  if (acSleep === null) {
    /**
     * ⚠️ AND THE OTHER HALF, IN THIS DIRECTION TOO. The "report the known half
     * first" fix was made below for an unreadable BATTERY section and not here
     * for an unreadable AC one — so a laptop whose battery section says it
     * sleeps after ten minutes, with an AC section we could not parse, came
     * back as a flat "we could not tell whether this Mac goes to sleep",
     * throwing away a measured and actionable finding. The same defect,
     * mirrored, in the same function.
     */
    if (battFirst !== null && battFirst > 0) {
      return {
        key: 'sleep',
        state: STATE.ATTENTION,
        title: `This computer goes to sleep on battery after ${battFirst} ${battFirst === 1 ? 'minute' : 'minutes'}`,
        detail: 'Your agents stop when it sleeps. We could not read what it does while it is '
          + 'plugged in, which may be different. You can see both in System Settings, under '
          + 'Battery.',
      };
    }
    return {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not tell whether this computer goes to sleep',
      detail: (battFirst === 0
        // ⚠️ The half we DID read, for the same reason the branches below say
        // theirs. Discarding a clean battery reading because the AC section was
        // unreadable is the same shape, one more time.
        ? 'It does not go to sleep on battery. What it does while it is plugged in is the part '
          + 'we could not read. '
        : 'This is the setting that decides whether your agents keep working when you '
          + 'walk away, so it is worth knowing. ')
        + 'You can see it in System Settings, under Lock Screen on a desktop or Battery on '
        + 'a laptop.',
    };
  }

  /**
   * ⚠️ THE PRESENCE OF A `Battery Power` SECTION IS HOW WE KNOW IT IS A LAPTOP.
   * `pmset -g custom` prints that block only where there is a battery to print
   * it for. This was measured on a Mac mini, which prints `AC Power` alone.
   *
   * It matters because a laptop has TWO answers and the second one is the one
   * that bites: plugged in at a desk it never sleeps, and the person closes it
   * at five o'clock and carries it home. The wireframe's dashed note is about
   * exactly that case.
   */
  const batterySleep = battery ? sleepMinutes(battery) : null;

  /**
   * ⚠️ THE KNOWN HALF IS REPORTED FIRST. This test used to sit BELOW the
   * unreadable-battery branch, so a laptop set to sleep after ten minutes on AC
   * whose battery section could not be read said only "we could not tell what
   * this Mac does on battery" -- dropping a measured, actionable finding
   * because a *different* reading failed. Half the answer was read and none of
   * it was reported.
   */
  if (acSleep > 0) {
    return {
      key: 'sleep',
      state: STATE.ATTENTION,
      title: `This computer goes to sleep after ${acSleep} ${acSleep === 1 ? 'minute' : 'minutes'}`,
      detail: 'Your agents stop when it sleeps and start again when you wake it. If you want '
        + 'them getting on with things while you are away, change Sleep to Never in System '
        + 'Settings.'
        // ⚠️ The other power source, when there is one and it differs. Reporting
        // only the AC number on a laptop that sleeps after one minute on battery
        // names the longer of the two intervals and leaves the biting one unsaid.
        + (battery && batterySleep === null
          ? ' We could not read what it does on battery, which may be different again.'
          : (battery && batterySleep > 0 && batterySleep !== acSleep
            ? ` On battery it sleeps after ${batterySleep} ${batterySleep === 1 ? 'minute' : 'minutes'}.`
            : '')),
    };
  }

  if (battery && batterySleep === null) {
    /**
     * ⚠️ THE REASSURING HALF OF THIS SENTENCE IS ITSELF A CLAIM, AND IT USED TO
     * BE MADE WITHOUT CHECKING.
     *
     * This branch ran before `acSleep > 0` was tested, so on a laptop set to
     * sleep after ten minutes on AC — with an unreadable battery section — it
     * said "It does not go to sleep while it is plugged in." Measured. The
     * *state* was safely `unknown` the whole time, which is exactly why it went
     * unnoticed: the wrong thing was the prose, not the verdict.
     *
     * So the plugged-in half is only asserted when it was actually read as zero.
     */
    return {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not tell what this computer does on battery',
      detail: (acSleep === 0
        ? 'It does not go to sleep while it is plugged in. What it does on battery is the '
        : 'What this computer does on battery is the ')
        + 'part we could not read, and that is the part that matters if you carry it home.',
    };
  }

  if (battery && batterySleep > 0) {
    return {
      key: 'sleep',
      state: STATE.ATTENTION,
      title: 'This computer keeps working plugged in, and sleeps on battery',
      detail: `Plugged in it never sleeps. On battery it sleeps after ${batterySleep} `
        + `${batterySleep === 1 ? 'minute' : 'minutes'}, and your agents stop with it. `
        + 'A laptop you close at five o\'clock is not a computer that stays on: if you want '
        + 'them working overnight, leave this one open and plugged in, or use a Mac that '
        + 'stays switched on.',
    };
  }

  return {
    key: 'sleep',
    state: STATE.OK,
    title: 'This computer does not go to sleep',
    detail: battery
      ? 'Plugged in or on battery, it stays awake, so your agents keep working while you are away.'
      : 'So your agents keep working while you are away.',
  };
}

/* ===========================================================================
   The things it needs installed
   =========================================================================== */

/**
 * ⚠️ ASKS `create.binPaths`, WHICH IS WHAT CREATION ITSELF ASKS. Looking up
 * `claude` on PATH instead would be a second definition of "is it installed",
 * and it would disagree: this server runs under launchd with a PATH that does
 * not include `~/.local/bin`, so `which claude` answers no on a machine where
 * creation works perfectly. A check that looks somewhere else than the code it
 * is vouching for is worse than no check.
 */
function installedCheck(opts) {
  const { claudeBin, tmuxBin } = create.binPaths(opts);
  /**
   * 🛑 CLAUDE CODE IS REPORTED, NOT REQUIRED (#979, Josh 2026-08-26 10:32:
   * "we assume that not everybody is going to have Claude Code... we're not
   * forcing people to have Claude Code as part of the installer").
   *
   * This row used to list Claude Code beside tmux as a thing the MACHINE
   * needs, whichever provider the person picked. So somebody who chose GPT
   * was told their Mac was missing something it does not need, on the screen
   * whose job is to say whether they can proceed. They can: an OpenAI agent
   * runs on codex and never touches the Claude binary.
   *
   * ⚠️ THE FACT STAYS, ONLY THE FRAMING GOES. "Is Claude Code on this Mac" is
   * true and useful even when it is not a requirement -- the Connect step
   * needs it to know whether pressing Connect will download anything. What
   * was wrong was the word REQUIRED sitting next to it. So it is probed
   * exactly as before and published on `present`; it just no longer decides
   * the verdict.
   *
   * ⚠️ tmux IS still required, for every provider: it is how Kosmos runs any
   * agent at all. The two are not symmetrical and this list is where that is
   * recorded.
   */
  const { codexBin } = create.binPaths(opts);
  /* ⚠️ THE LABEL IS WHAT A PERSON READS, AND IT USED TO BE "tmux" (#1019). The
     key stays `tmux` -- it is a stable identifier and `present.tmux` is read
     elsewhere -- but the LABEL reaches sentences, and this row is now the only
     one that can produce a warning, so "We looked for tmux at ..." became the
     failure sentence of the whole screen.
     📌 The path still carries the word, because the file really does live at
     `<home>/tmux/bin/tmux` and showing a path you have altered would be worse
     than showing one that contains a term. What changes is that the word is no
     longer the NOUN of a sentence addressed to a person, which is what the two
     standing rulings are about. The Claude Code row beside this one has read
     "Claude Code" rather than "claude" since it was written; this is that. */
  const parts = [['tmux', 'the part that runs agents', tmuxBin, true]];
  /**
   * ⚠️ BOTH RUNNERS, and the keys are STABLE IDENTIFIERS rather than the
   * display labels. Two reasons, both learned the hard way in this file:
   *
   *   - #979 was filed because Josh picked OPENAI on a fresh Mac and nothing
   *     happened, so a presence map that answers for Claude and not codex
   *     omits the runner the card is about.
   *   - the labels are the same strings the row's sentences are built from,
   *     so a copy edit would silently rename a JSON key. The consumer then
   *     reads `undefined`, which is falsy, which reads as ABSENT -- collapsing
   *     the null-vs-false distinction the rest of this function exists to
   *     protect. `label` stays for the sentences; `key` is the contract.
   */
  const informational = [
    ['claude', 'Claude Code', claudeBin, false],
    ['codex', 'Codex', codexBin, false],
  ];

  const missing = [];
  const unreadable = [];
  const unusable = [];
  /* One probe, both lists: `present` gets an answer for every part, and the
     buckets that drive the verdict get only the required ones. Probing them
     twice would be two definitions of "installed", which is the mistake this
     function's own header warns about. */
  const present = Object.create(null);
  for (const [key, label, bin, required] of [...parts, ...informational]) {
    /**
     * ⚠️ `statSync`, NOT `existsSync`, AND THE DIFFERENCE IS THE WHOLE POINT OF
     * THE CATCH.
     *
     * `fs.existsSync` never throws: it swallows every error internally and
     * answers `false`. So the `unknown` arm written around it was unreachable
     * code, and an unreadable parent directory — a permissions error, a
     * disconnected mount — came out of it as the flat claim "Claude Code is not
     * where we expected it. An agent made now would not start."
     *
     * That is *we could not look* rendered as a checked negative, in the module
     * whose header says that is the one thing not to do. It shipped because the
     * guard was new code and nothing tested it, which is the other rule.
     *
     * `statSync` throws, so the three answers are real: ENOENT is genuinely
     * absent, anything else is us being unable to see.
     */
    /**
     * ⚠️ AND THE SAME PATH RULE CREATION USES. `createAgent` refuses a path
     * carrying a quote or a newline outright; without this, such a path passed
     * step 2 as "Everything it needs to run is installed" and was refused by
     * creation two screens later.
     */
    /**
     * ⚠️ ITS OWN BUCKET, because "We looked for tmux at <path>" is a sentence
     * about an action nobody took. We refuse these on sight; if the binary
     * really is sitting at that path, the person checks, finds it exactly where
     * the screen says it is not, and the actual cause -- a quote or a newline in
     * the path -- is never named anywhere.
     */
    if (create.unusablePath(bin)) { present[key] = null; if (required) unusable.push({ label, bin }); continue; }

    /**
     * ⚠️ TWO PROBES, BECAUSE `EACCES` MEANS TWO DIFFERENT THINGS HERE and
     * collapsing them puts one of them on the wrong side of the rule.
     *
     *   - `EACCES` from the STAT means we could not traverse to the path at all
     *     — an unreadable parent, a disconnected mount. That is *we could not
     *     look*, and it must not render as a finding.
     *   - `EACCES` from the ACCESS means we looked, we found it, and it is not
     *     runnable. That is a real finding.
     *
     * The first version of this ran them in one try and treated every `EACCES`
     * as "missing", which quietly undid the whole reason the probe moved off
     * `existsSync` in the first place.
     */
    let st;
    try {
      st = fs.statSync(bin);
    } catch (err) {
      if (err && err.code === 'ENOENT') { present[key] = false; if (required) missing.push({ label, bin }); continue; }
      /**
       * ⚠️ RECORDED, NOT RETURNED. Returning here threw away whatever the OTHER
       * probe had already established: with Claude genuinely absent and tmux
       * unreadable, the whole check came back "We could not check what is
       * installed", naming only tmux — and `attention` dropped to zero, so the
       * screen said nothing needed doing while Claude was definitively missing.
       * 📌 That pairing can no longer be built (#979 left one required
       * part), so the illustration is history rather than a live case. The
       * decision it justifies, continue rather than return, is unchanged and
       * is what a second required part would rely on.
       *
       * That is the identical defect `sleepCheck` above documents fixing, in
       * its sibling function, written the same afternoon. Half the answer was
       * read and none of it was reported.
       */
      // `null`, not false: we could not look, which is not the same as absent.
      present[key] = null;
      if (required) unreadable.push({ label, bin, because: String((err && err.message) || err) });
      continue;
    }

    /**
     * ⚠️ A FILE WE COULD ACTUALLY RUN, not merely something at that path.
     * `statSync` alone succeeds for a DIRECTORY named `claude` and for a file
     * with no execute bit — both of which came back as "There is nothing else
     * for you to go and find", on the screen whose job is promising the thing
     * will work. launchd would then start the job and it would fail silently,
     * which is the worst available outcome: nothing on screen, nothing running.
     */
    if (!st.isFile()) { present[key] = false; if (required) missing.push({ label, bin }); continue; }
    try {
      fs.accessSync(bin, fs.constants.X_OK);
      present[key] = true;
    } catch {
      // A file with no execute bit is not runnable, so it is not present here.
      // ⚠️ BUT X_OK IS NOT RUNNABILITY (#1567). A truncated launcher left by a
      // cancelled `claude install` passes X_OK and is NOT runnable; only
      // connect.js's `--version` probe catches that, and Connect re-downloads on
      // it. So `present: true` here means "the file is on this computer and
      // executable", NOT "it runs". The copy below is worded to match that, and
      // must not vouch for runnability the cheap check cannot see.
      present[key] = false;
      if (required) missing.push({ label, bin });
    }
  }

  if (!missing.length && !unreadable.length && !unusable.length) {
    return {
      key: 'installed',
      state: STATE.OK,
      /* #1567: was "Everything it needs is installed" / "Nothing for you to go
         and find", the pack's screen-4 row. This check confirms the files are
         PRESENT (statSync + X_OK), not that they RUN, and a truncated launcher
         passes X_OK, so the old line vouched for a binary Connect then
         re-downloads. Softened to a presence claim, which is true in both cases;
         Connect does the runnability check. Josh's screen-4 wording ruling: this
         is a conservative honesty fix, the final phrasing is his to set live. */
      title: 'Everything it needs is on this computer',
      detail: 'Nothing for you to go and find.',
      present,
    };
  }

  /**
   * ⚠️ THREE BUCKETS, AND EVERY ONE OF THEM GETS SAID.
   *
   * This is the third time this one function has dropped a finding on the
   * floor by returning early. `unreadable` beat `missing` first; then
   * `unusable` was added as its own bucket — with its own early return, ahead
   * of both — so `installedCheck({claudeBin: '/nowhere/claude', tmuxBin:
   * "/opt/home'brew/bin/tmux"})` reported ONLY the quoted tmux path and never
   * mentioned that Claude Code was absent. Measured. Reachable in real life by
   * a home directory with an apostrophe in it.
   *
   * ⚠️ DO NOT RUN THAT REPRO AND CONCLUDE THE FIX REGRESSED (#979). That
   * exact call now produces that exact output, and it is CORRECT: Claude
   * Code is no longer a required part, so not naming it is the point rather
   * than the bug. The example is kept because the reasoning it justifies,
   * collect every bucket and return once, is unchanged.
   *
   * `sleepCheck` above documents fixing this same shape twice. The lesson that
   * did not travel is that the fix has to be structural: assemble the sentence
   * from whatever is in each bucket, rather than picking a winner and
   * returning.
   */
  const problems = missing.length || unusable.length;
  const parts_ = [];
  if (missing.length) {
    parts_.push('We looked for ' + missing.map((m) => `${m.label} at ${m.bin}`).join(', and ') + '.');
  }
  if (unusable.length) {
    parts_.push('The path set for '
      + unusable.map((u) => `${u.label} is ${u.bin}`).join(', and the one for ')
      + '. A quote, a backslash or a line break in a path is something we will not pass on to '
      + 'the parts of macOS that start an agent, whatever is at the end of it.');
  }
  if (unreadable.length) {
    parts_.push(`We could not check ${unreadable.map((u) => u.label).join(' or ')} at all.`);
  }

  if (!problems) {
    return {
      key: 'installed',
      state: STATE.UNKNOWN,
      title: 'We could not check what is installed',
      detail: unreadable.map((u) => `Looking for ${u.label} at ${u.bin} did not work (${u.because})`).join(', and ')
        + '. That does not mean anything is missing, only that we could not see it.',
      present,
    };
  }

  /* 🛑 THE HEADLINE NAMES THE CONSEQUENCE, NOT THE COMPONENT (#1019, and I
     carded the regression before shipping it). Until #979 this row could
     produce three different sentences and rarely produced this one. #979
     correctly stopped requiring Claude Code, which left tmux as the ONLY
     required part -- so "tmux is not where we can use it" was promoted from an
     edge case to THE failure sentence of this screen.

     ⚠️ AND IT IS THE WRONG NOUN FOR THE READER. tmux is how Kosmos runs agents;
     a person reading it learns nothing they can act on. This codebase already
     carries two rulings that the word must not reach a person, one of them
     citing Josh being handed a `tmux` command and getting `command not found`.

     📌 THE PATH IS STILL SAID, at the end. `engine/machine.test.js` argues for
     it in as many words -- "the one piece of information that lets anybody fix
     it" -- and that argument was written when tmux might have been the person's
     own Homebrew copy. It is not any more: `bin/kosmos` exports
     AGENT_WORKFORCE_TMUX_BIN as `$KOSMOS_HOME/tmux/bin/tmux`, a private copy
     the installer places unconditionally. So the path is support detail rather
     than an instruction, and it goes after the remedy instead of instead of one. */
  const named = [...missing, ...unusable].map((x) => x.label);
  /* ⚠️ THE TWO BUCKETS KEEP DIFFERENT REMEDIES, because reinstalling only fixes
     one of them. A MISSING part means Kosmos's own files were damaged, and a
     reinstall genuinely puts them back. An UNUSABLE PATH means the place Kosmos
     is installed contains a quote, a backslash or a line break -- reinstalling
     to that same place would reproduce it exactly, so offering a reinstall
     there would be advice that cannot work, which is the defect this card is
     about wearing different clothes. */
  const remedy = missing.length && !unusable.length
    ? 'Reinstalling Kosmos puts it back: open installkosmos.com and click Download for '
      + 'macOS. Your agents and settings stay on this computer; installing again does '
      + 'not remove them.'
    : 'Kosmos is installed somewhere it cannot start agents from. Installing it again to a '
      + 'folder with no quotes, backslashes or line breaks in its name is what fixes this.';
  return {
    key: 'installed',
    state: STATE.ATTENTION,
    title: 'Kosmos cannot start agents on this computer',
    detail: 'Something it needs is not where it should be, so an agent made now would not '
      + 'start. ' + remedy + ' ' + parts_.join(' '),
    present,
  };
}

/* ===========================================================================
   Starting themselves
   =========================================================================== */

/**
 * Whether the part of macOS that starts things at login can be reached at all.
 *
 * ⚠️ This is a WEAKER claim than the wireframe's "your agents will start
 * themselves", and deliberately so. What we can establish from here is that
 * `launchctl` answers for this login session — which is what every agent's job
 * is registered with. Whether a particular agent comes back after a reboot is a
 * claim about a reboot we have not done.
 */
function restartCheck(runner) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) {
    return {
      key: 'restart',
      state: STATE.UNKNOWN,
      // The pack's unknown row, verbatim, at the pack's length.
      title: 'We could not check whether agents start themselves',
      detail: 'Not the same as it being wrong. We could not look.',
    };
  }
  const got = runner('/bin/launchctl', ['print', `gui/${uid}`]);
  if (got.ok) {
    /**
     * ⚠️ THE COPY IS JOSH'S, VERBATIM (2026-08-17 screen-4 annotation), AND
     * HIS RULING SUPERSEDED THE OLD HEDGE. History, kept because this string
     * has flipped twice: the first version claimed "Your agents will start
     * themselves" over a probe that only established launchctl answers for
     * this login session; the hedged rewrite ("set to", plus an out-loud
     * caveat about agents other programs started) fixed that and was then
     * replaced by Josh's plainer wording. What survives of the hedge is the
     * word HERE: "Agents made here" scopes the claim to agents Kosmos makes,
     * which is exactly what the launchctl probe supports -- an adopted agent
     * some other program started may have no launchd job, and this sentence
     * no longer claims otherwise. The detail's "come back on their own" is a
     * will-claim about those same Kosmos-made agents; Josh ruled the plain
     * form knowingly, so do not re-hedge it without his word.
     */
    return {
      key: 'restart',
      state: STATE.OK,
      // Josh's wording, verbatim (2026-08-17 screen-4 annotation).
      title: 'Agents made here automatically restart themselves',
      detail: 'They come back on their own after this computer restarts.',
    };
  }
  /**
   * ⚠️ UNKNOWN, NOT ATTENTION, and this one was miscounted by the module that
   * documents the miscount. `launchctl` failing to answer does not establish
   * that anything is wrong with the jobs — it establishes that we could not ask.
   * Reporting it as `attention` puts a thing-we-could-not-read into the count of
   * things-that-need-doing, which `check()` keeps separate precisely so that
   * "two things need your attention" is never half false.
   */
  return {
    key: 'restart',
    state: STATE.UNKNOWN,
    title: 'We could not check whether agents start themselves',
    detail: 'Not the same as it being wrong. We could not look.',
  };
}

/* ===========================================================================
   The screen
   =========================================================================== */

/**
 * The could-not-look answer, defined ONCE. The /api/machine route's degraded
 * catch path publishes this same row, and a second hand-copied literal there
 * went stale the moment this wording moved.
 */
function appLocationUnknown() {
  return {
    key: 'app-location',
    state: STATE.UNKNOWN,
    title: 'We could not check where the Kosmos icon is',
    detail: 'Nothing is wrong. Type Kosmos into Spotlight, the magnifying glass at the '
      + 'top right of your screen, and it will find it.',
  };
}

/**
 * Where the Kosmos icon actually IS, looked up rather than remembered.
 *
 * ⚠️ WHY THIS EXISTS (orientation spec, 2026-08-14): the installer's APP_DIR
 * is a shell variable that was never persisted, so the app had no idea where
 * its own icon landed -- and the icon legitimately lands in three places:
 * /Applications (the account could write there), ~/Applications (fallback,
 * measured on the first real clean-machine run when the tester concluded the
 * install "did not put it in my applications"), or nowhere. A screen saying
 * "it is in your Applications folder" without looking would be a state
 * nobody checked rendered as fact.
 *
 * ⚠️ EXISTENCE, not provenance, deliberately: this check says "we found a
 * Kosmos here" when a Kosmos.app directory is present, and does not try to
 * prove the bundle is this install's the way install/kosmos's bundle_is_ours
 * does. The spec weighed this: an honest "we found one" beats a provenance
 * proof that lands a healthy machine in unknown.
 *
 * Four answers, per the spec's table, in this module's check shape:
 * found in /Applications (ok), found in ~/Applications (ok, its own title,
 * because the path differs and the installer already words it this way),
 * found in neither (attention -- with the sentence that absence-of-finding
 * is not absence: "That is not the same as it not being there"), and could
 * not look (unknown -- "Nothing is wrong").
 *
 * `opts.appDirs` overrides the two real folders so tests never depend on
 * this machine's actual /Applications -- the same injection shape as
 * opts.runner and opts.pmset.
 *
 * Known limit, not an oversight: the installer accepts KOSMOS_SYS_APP_DIR
 * and KOSMOS_APP_DIR overrides, and those shell variables are never
 * persisted -- so a machine installed to a custom folder reads attention
 * here. The copy stays honest about exactly that ("That is not the same as
 * it not being there").
 */
function appLocationCheck(opts) {
  // ⚠️ A malformed override THROWS rather than silently probing the real
  // machine. The fallback used to require length exactly 2, so a test passing
  // one or three directories by mistake read the operator's real
  // /Applications under a green run -- the exact leak the override exists to
  // prevent.
  let dirs;
  if (opts && opts.appDirs !== undefined) {
    if (!Array.isArray(opts.appDirs) || opts.appDirs.length === 0
        || !opts.appDirs.every((d) => typeof d === 'string' && d.length > 0)) {
      // Non-string elements included: path.join would TypeError inside the
      // look's try, read as errored, and answer a fabricated could-not-look
      // -- the one state this guard exists to keep honest.
      throw new Error('appDirs override must be a non-empty list of folders');
    }
    dirs = opts.appDirs;
  } else {
    dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  }
  // The pack's row, verbatim: "you will find it" tells a person what to do
  // next where "Kosmos is" only reports a fact (screen 1 ruling).
  const TITLES = [
    'You will find it in your Applications folder',
    'You will find it in the Applications folder inside your home folder',
  ];
  const OPEN_FROM_THERE = 'Open it from there whenever you want it. Clicking it starts '
    + 'Kosmos if it is not already running.';
  // ⚠️ An unreadable FIRST folder no longer ends the look. A machine whose
  // /Applications errors EACCES but whose home Applications holds the app was
  // told "we could not check" when a definite yes was one iteration away --
  // could-not-look is the honest LAST answer, never the eager one.
  let errored = false;
  for (let i = 0; i < dirs.length; i++) {
    try {
      const st = fs.statSync(path.join(dirs[i], 'Kosmos.app'));
      // A FILE named Kosmos.app is not the app; keep looking rather than
      // pointing somebody at a thing that will not open.
      if (st.isDirectory()) {
        // Index 0 and 1 are the two real folders; an injected extra gets a
        // title AND detail that name no folder ("from there" would point at
        // a place the title deliberately declines to name).
        const named = i < TITLES.length;
        const title = named ? TITLES[i] : 'We found the Kosmos icon on this computer';
        const detail = named ? OPEN_FROM_THERE
          : 'Open it from where you found it. Clicking it starts Kosmos if it is not already running.';
        return { key: 'app-location', state: STATE.OK, title, detail };
      }
    } catch (err) {
      if (err && err.code === 'ENOENT') continue;
      // Anything but a clean "not there" means we could not complete this
      // look -- remember it and keep going, because a find anywhere is still
      // a find.
      errored = true;
    }
  }
  if (errored) {
    // "Could not look" must never render as "it is not there".
    return appLocationUnknown();
  }
  return {
    key: 'app-location',
    state: STATE.ATTENTION,
    title: 'We could not find the Kosmos icon',
    detail: 'That is not the same as it not being there. Type Kosmos into Spotlight, the '
      + 'magnifying glass at the top right of your screen, and it will find it.',
  };
}

/**
 * Open Finder AT the Kosmos icon -- the pack's "Show me where it is" on the
 * Success screen. Reliability-or-no-button, same rule as the sleep row: the
 * screen only offers this where the look answered ok, and this function
 * re-derives the location itself with the SAME loop discipline as the check
 * (never a path from the request, never a remembered one). A location that
 * cannot be found RIGHT NOW refuses with a sentence rather than opening
 * nothing.
 *
 * ⚠️ The runner seam mirrors projects.setRevealRunner: tests inject, and the
 * production path is execFileSync open -R (an argument array, no shell).
 */
let appRevealRunner = null;
function setAppRevealRunner(f) { appRevealRunner = f; }
function revealApp(opts) {
  let dirs;
  if (opts && opts.appDirs !== undefined) {
    if (!Array.isArray(opts.appDirs) || opts.appDirs.length === 0
        || !opts.appDirs.every((d) => typeof d === 'string' && d.length > 0)) {
      throw new Error('appDirs override must be a non-empty list of folders');
    }
    dirs = opts.appDirs;
  } else {
    dirs = ['/Applications', path.join(os.homedir(), 'Applications')];
  }
  // The check's own loop discipline: ENOENT keeps looking, anything else
  // is remembered as could-not-look -- and could-not-look must never render
  // as "it is not there" (the rule appLocationCheck states at its unknown
  // return). The opener runs OUTSIDE the stat try, so a found icon whose
  // reveal fails reports the reveal failing, never "not found".
  let found = null;
  let errored = false;
  for (let i = 0; i < dirs.length && !found; i++) {
    const candidate = path.join(dirs[i], 'Kosmos.app');
    try {
      if (fs.statSync(candidate).isDirectory()) found = candidate;
    } catch (err) {
      if (!err || err.code !== 'ENOENT') errored = true;
    }
  }
  if (!found) {
    throw new Error(errored
      ? 'we could not look just now, so we cannot say where the icon is'
      : 'we could not find the Kosmos icon just now, so there is nothing to show');
  }
  // The sibling revealFolder's bounds, for the sibling's reason: these run
  // synchronously on the server's event loop, so a hung `open` with no
  // timeout blocks every viewer of the board.
  const run = appRevealRunner
    || ((cmd, args) => execFileSync(cmd, args, { timeout: 5000, stdio: 'ignore' }));
  try {
    run('/usr/bin/open', ['-R', found]);
  } catch (err) {
    // ⚠️ A programming error must not wear the failure's clothes -- the
    // rethrow revealFolder documents (a swallowed ReferenceError once blamed
    // Finder for a missing import, forever, invisibly, while runner-injected
    // tests replaced the exact broken line).
    if (err instanceof ReferenceError || err instanceof TypeError) throw err;
    throw new Error('we found the icon but could not open a Finder window for it');
  }
  return { ok: true };
}

/**
 * @returns {{checks: Array, attention: number, unknown: number,
 *            appLocation: {key: string, state: string, title: string, detail: string}}}
 */

/* ---- the Open-sleep-settings capability ---------------------------------

   ⚠️ RELIABILITY-OR-NO-BUTTON is the contract (Josh's rule for this row): a
   button that lands a person on the wrong System Settings pane is worse than
   no button, so the capability is claimed ONLY when the pane provably exists
   on THIS machine. macOS panes are ExtensionKit appexes on disk, so presence
   is checkable, and the pane id is read from the appex's own Info.plist
   rather than guessed from a version table:

     macOS 26.5.2 (measured on this machine, 2026-08-16): the power pane is
     PowerPreferences.appex carrying com.apple.Battery-Settings.extension,
     desktop and laptop alike. Opening x-apple.systempreferences:<that id>
     was verified by PROCESS, with a negative control: a bogus pane id opens
     Settings without launching the pane appex; the real id launches
     PowerPreferences with the id in its launch arguments.

     Older macOS (the 13.5 floor through the pre-merge layouts) shipped
     com.apple.Energy-Saver-Settings.extension on desktops. Not verifiable on
     this machine; it is in the accepted set, and a machine with NEITHER
     extension on disk simply gets no button, which is the safe failure the
     contract asks for.

   The scan is cached for the process lifetime: the OS does not change under
   a running board, and the alternative is two `defaults` subprocesses per
   /api/machine call. */
const SLEEP_PANE_IDS = [
  'com.apple.Battery-Settings.extension',
  'com.apple.Energy-Saver-Settings.extension',
];
const EXTENSIONS_DIR = '/System/Library/ExtensionKit/Extensions';
let SLEEP_PANE_CACHE;   // undefined = not probed; null = probed, none found

/**
 * ⚠️ THE CACHE BELONGS TO THE REAL WORLD ONLY. A supplied runner or lister
 * (tests) bypasses it in both directions -- neither reading a cached answer
 * some other runner produced nor writing its own answer into the cache --
 * because caching the FIRST caller's injected world silently decided
 * `settings` for every later caller with a different one, and made test
 * order load-bearing.
 */
function sleepPaneUrl(runner, lister) {
  const injected = Boolean(runner || lister);
  if (!injected && SLEEP_PANE_CACHE !== undefined) return SLEEP_PANE_CACHE;
  const r = runner || run;
  const list = lister || ((dir) => fs.readdirSync(dir));
  const remember = (v) => { if (!injected) SLEEP_PANE_CACHE = v; return v; };
  let names;
  try {
    names = list(EXTENSIONS_DIR)
      .filter((n) => n.endsWith('.appex') && /power|energy|battery/i.test(n));
  } catch {
    return remember(null);
  }
  for (const n of names) {
    const res = r('/usr/bin/defaults', ['read', path.join(EXTENSIONS_DIR, n, 'Contents', 'Info'), 'CFBundleIdentifier']);
    if (!res.ok) continue;
    const id = String(res.stdout || '').trim();
    if (SLEEP_PANE_IDS.includes(id)) {
      return remember('x-apple.systempreferences:' + id);
    }
  }
  return remember(null);
}

/** Open the pane. The URL is ALWAYS derived here, never taken from a caller:
    the route that fronts this must not become a way for a page to `open`
    arbitrary URLs on the machine. */
function openSleepSettings(runner, lister) {
  const url = sleepPaneUrl(runner, lister);
  if (!url) return { ok: false, because: 'we could not find the sleep settings screen on this computer' };
  const r = runner || run;
  const res = r('/usr/bin/open', [url]);
  return res.ok
    ? { ok: true }
    : { ok: false, because: 'System Settings did not open' };
}

/* Test hook: the cache makes the probe once-per-process, which is right in
   production and wrong in a test that wants to exercise both worlds. */
function resetSleepPaneCache() { SLEEP_PANE_CACHE = undefined; }

/* ── the Accessibility pane (kosmos#1344) ────────────────────────────────────
   Josh, 2026-08-28 from the fresh-machine install: "I'd love to see a message
   to say 'Turning accessibility on so that Kosmos agents can work on this
   computer' and have a button to open that setting so that they can okay it as
   well."

   🛑 PROBED, NOT HARDCODED, for the same reason the sleep pane is: the pane's
   bundle identifier moved between macOS versions, and a stale one opens System
   Settings to nowhere. A button that appears to work is the exact failure this
   product is written against, and the design pack says it in its own words
   about "Keep in Dock": the instruction would look correct on the page and fail
   in front of the person.

   ⚠️ WHAT THIS DOES NOT DO: it does not report whether accessibility is GRANTED.
   Nothing in this engine can read that (it is a TCC fact, reachable from the
   native app and not from node), so no caller may render a tick, a "you have
   already done this", or hide the button once granted. A screen claiming a
   permission state nobody checked is the defect this codebase is built against.
   The button offers a door; it never claims what is behind it. */
const A11Y_PANE_IDS = [
  'com.apple.settings.PrivacySecurity.extension',
  'com.apple.preference.security',
];
let A11Y_PANE_CACHE;   // undefined = not probed; null = probed, none found

/* The cache rule is `sleepPaneUrl`'s, deliberately copied rather than shared:
   an injected runner or lister bypasses it in BOTH directions, so a test's
   world is never cached for the next caller and test order stays irrelevant. */
function a11yPaneUrl(runner, lister) {
  const injected = Boolean(runner || lister);
  if (!injected && A11Y_PANE_CACHE !== undefined) return A11Y_PANE_CACHE;
  const r = runner || run;
  const list = lister || ((dir) => fs.readdirSync(dir));
  const remember = (v) => { if (!injected) A11Y_PANE_CACHE = v; return v; };
  let names;
  try {
    names = list(EXTENSIONS_DIR)
      .filter((n) => n.endsWith('.appex') && /privacy|security/i.test(n));
  } catch {
    return remember(null);
  }
  for (const n of names) {
    const res = r('/usr/bin/defaults', ['read', path.join(EXTENSIONS_DIR, n, 'Contents', 'Info'), 'CFBundleIdentifier']);
    if (!res.ok) continue;
    const id = String(res.stdout || '').trim();
    if (A11Y_PANE_IDS.includes(id)) {
      /* The anchor selects Accessibility inside Privacy & Security. */
      return remember('x-apple.systempreferences:' + id + '?Privacy_Accessibility');
    }
  }
  return remember(null);
}

/** Open the pane. The URL is ALWAYS derived here, never taken from a caller:
    the route that fronts this must not become a way for a page to `open`
    arbitrary URLs on the machine. */
function openAccessibilitySettings(runner, lister) {
  const url = a11yPaneUrl(runner, lister);
  if (!url) return { ok: false, because: 'we could not find the accessibility screen on this computer' };
  const r = runner || run;
  const res = r('/usr/bin/open', [url]);
  return res.ok
    ? { ok: true }
    : { ok: false, because: 'System Settings did not open' };
}

/* Test hook, same reason as its sibling's. */
function resetA11yPaneCache() { A11Y_PANE_CACHE = undefined; }

/* ── the label-truth check (#224's trap, found live 2026-08-23) ──────────
   launchd has no sandbox: a harness (or anything) can register a plist from
   a temp directory over a real Kosmos label, and every liveness probe stays
   green while nothing will survive a crash. The predicate that can always
   go red, per Splinter's framing: not "does the job exist" (true forever
   once installed) but "does any registered Kosmos label point at a file
   OTHER than the one in the real LaunchAgents folder". Reads only; fails
   soft to unknown, never to a false alarm. */
function labelTruthCheck(runner) {
  /* The product's own launch-dir seam, the same one the installer honours:
     a sandboxed suite sets AGENT_WORKFORCE_LAUNCH and this check then reads
     ITS dir, never the operator's real LaunchAgents (#332's law: a test must
     not be green or red by what the operator's machine happens to hold). */
  const launchDir = process.env.AGENT_WORKFORCE_LAUNCH
    || path.join(process.env.HOME || '', 'Library', 'LaunchAgents');
  let labels = [];
  try {
    labels = fs.readdirSync(launchDir)
      .filter((f) => /^com\.kosmos\..*\.plist$/.test(f) || f === 'com.kosmos.board.plist')
      .map((f) => f.replace(/\.plist$/, ''));
  } catch {
    return { key: 'labels', state: STATE.UNKNOWN,
      title: 'We could not check the background jobs',
      detail: 'We could not read the folder this computer keeps them in. That tells us about the folder, not the jobs.' };
  }
  if (!labels.length) {
    return { key: 'labels', state: STATE.OK,
      title: 'Background jobs are as installed',
      detail: 'No Kosmos background jobs are registered on this computer yet.' };
  }
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  if (uid === null) {
    return { key: 'labels', state: STATE.UNKNOWN,
      title: 'We could not check the background jobs',
      detail: 'We could not tell which user this computer is running Kosmos as.' };
  }
  const impostors = [];
  for (const label of labels) {
    const out = runner('/bin/launchctl', ['print', `gui/${uid}/${label}`]);
    if (!out.ok || typeof out.stdout !== 'string') continue; // unregistered is not a hijack
    const m = out.stdout.match(/^\s*path = (.+)$/m);
    if (!m) continue;
    const registered = m[1].trim();
    const real = path.join(launchDir, `${label}.plist`);
    if (registered !== real) impostors.push({ label, registered });
  }
  if (!impostors.length) {
    return { key: 'labels', state: STATE.OK,
      title: 'Background jobs are as installed',
      detail: 'Every Kosmos background job on this computer points at its own real file.' };
  }
  const one = impostors[0];
  return { key: 'labels', state: STATE.ATTENTION,
    title: (impostors.length === 1 ? 'A background job' : impostors.length + ' background jobs')
      + ' got replaced by something else',
    detail: `${one.label} is registered from ${one.registered} instead of its file in Library/LaunchAgents. `
      + 'Whatever registered it will not survive a restart, and the real one is not running. '
      + 'Restarting this computer puts the real one back; if this keeps happening, tell us.' };
}

function check(opts) {
  const runner = (opts && opts.runner) || run;

  const pm = (opts && typeof opts.pmset === 'string')
    ? { ok: true, stdout: opts.pmset }
    : runner('/usr/bin/pmset', ['-g', 'custom']);

  const sleepRow = pm.ok ? sleepCheck(pm.stdout) : {
      key: 'sleep',
      state: STATE.UNKNOWN,
      title: 'We could not read this computer\'s sleep settings',
      detail: 'That setting decides whether your agents keep working when you walk away. You '
        + 'can see it in System Settings, under Lock Screen on a desktop or Battery on a laptop.',
  };
  // The button's gate travels ON the row (reliability-or-no-button): true
  // only when the pane was found on disk by id, whatever the row's state.
  // An injected runner probes fresh every time (no cache in either
  // direction); only the real runner's answer is cached for the process.
  sleepRow.settings = sleepPaneUrl((opts && opts.runner) ? runner : undefined, opts && opts.lister) !== null;

  const checks = [
    installedCheck(opts),
    sleepRow,
    restartCheck(runner),
    labelTruthCheck(runner),
  ];

  return {
    checks,
    // ⚠️ Counted separately, because the screen must never add them together.
    // "Two things need your attention" over one real problem and one thing we
    // could not read is a sentence that is false about half of what it counts.
    attention: checks.filter((c) => c.state === STATE.ATTENTION).length,
    unknown: checks.filter((c) => c.state === STATE.UNKNOWN).length,
    // ⚠️ Its OWN field, deliberately not one of `checks`. Where the app sits
    // has no bearing on whether an agent runs, so folding it into the rows
    // step 4 counts and the step-6 endings caption made the wizard state a
    // false cause: "We could not find the Kosmos icon. An agent made now may
    // not run until that is sorted" -- on exactly the fresh-install path
    // this check exists for. The step-1 Success screen is its one consumer.
    // Separating it at the SOURCE means no screen has to remember to
    // exclude it.
    appLocation: appLocationCheck(opts),
  };
}

module.exports = { check, parsePmset, sleepCheck, installedCheck, appLocationCheck, appLocationUnknown, restartCheck, labelTruthCheck, sleepPaneUrl, openSleepSettings, resetSleepPaneCache, a11yPaneUrl, openAccessibilitySettings, resetA11yPaneCache, revealApp, setAppRevealRunner, STATE };
