# readonlyon-4455: the installed app is read-only by default (kosmos#4455)

## Why
#4449 made the installed `app/` folder read-only so an agent's edit is refused (a tester's board went stale after an
agent edited the installed app). It shipped switched OFF, because an installer from before #4449 cannot remove a
read-only app. The card turns it on one release after the lifting reached the `/setup` people run. Production served
0.7.45, which carries the lifting, at 09:29 CDT on 2026-10-13 (Angel, on the card). This is the release after.

## Change
- `install/setup.sh`: the default is ON. `KOSMOS_READONLY_APP=0` is the off switch (unset, empty or anything else
  is on).
- `install/setup.sh`, the swap (condition 3): all three parts are lifted and CHECKED before any is removed. A part
  that holds something rm cannot remove refuses the update with nothing removed.
- `tools/test-update-locked-app-4455.sh`, in `test:shell`: drives the shipped block against a sandbox install.
- `tools/test-install.sh`: the default check is inverted (switch truly unset: read-only), and the update after it
  runs with `=0` and must leave the app writable.
- `release/whats-new-pool.json`: one line for the next release. `engine/defaults.js`: a comment.

## The three conditions recorded on the card
1. **Take the runtime-writes measurement again.** On this computer's own install, 0.7.45, updated by the real updater
   at 09:40:22 and its board started at 09:40:33 with the fleet's agents on it. Read at 09:47: 0 entries under `app/`,
   `runtime/` or `bin/` changed or modified after the board started (`find ... -newercm board.started-at`, and
   `-newermm`). Control: the same search over the rest of the install finds `logs/board.log`, `logs/install.log`,
   `logs/install.status` and `logs/board-watchdog.state`. **That is seven minutes.** It is read again before the proof
   and the later reading is the one that counts. By reading: no code outside the installer addresses a write at the
   app folder (searched `engine/`, `server.js`, `bin/`, `tools/` and `install/`).
   **Second reading, 11:15 CDT, 95 minutes after the board started:** still 0 under `app/`, `runtime/` and `bin/`, by
   change time and by modification time. The control finds 8 entries changed elsewhere in the install (the logs).
   NOT in this measurement: an agent being created. None was in those 95 minutes (no worker folder is newer than
   the board's start). #4449's original measurement did include one, on 0.7.06; on 0.7.45 that part rests on the
   reading that nothing in the engine addresses a write at the app folder, and on review 5 tracing the one copy
   OUT of the app at an agent's creation (`engine/create.js`, which sets each copy's mode itself).
2. **The sandbox harnesses.** Swept by a subagent, every file under `tools/`, the root and `engine/` tests, the
   browser checks and the workflows. Three things run the real installer far enough to lock an app:
   `tools/test-install.sh` (already ran with the switch on, and lifts before each of its own edits),
   `tools/clean-machine.sh` (lifts before it removes) and the Linux workflow (removes only through `--uninstall`,
   which lifts). The eight candidates the card names only extract blocks of the installer's text, or run
   `--uninstall` over a hand-built folder. Nothing needed changing. **A reading, not a run**: the full suite is the
   measurement.
3. **Check the lift before removing anything.** Built, with a test. What the test taught me: my first version asked
   "is anything stuck?" only after a failed chmod, and a locked file went straight through, because chmod leaves a
   file that is already writable alone and exits 0. Locked files are now searched for directly.

## Decided
- **A failed chmod alone does not refuse.** A file somebody else owns, in a folder this user may write to, is removed
  fine, and refusing there would break updates that work today. Refused only when one of two things is found: a
  locked or append-only entry (macOS), or a folder WITH SOMETHING IN IT that this user may not read, write or
  search. An empty such folder is not refused (rm removes it through its parent; review 1 measured the old updater
  getting through it). One corner stays refused: an empty folder find cannot even open reads as not empty.
- **A refusal leaves the app as it found it.** The lift opens the app to look. An app that was read-only before the
  lift is made read-only again, so a refused update does not leave it open to an agent's edit (review 2). One that
  was writable stays writable (review 3): locking an older install's app on a REFUSED update would be this change
  reaching an old version of Kosmos that nobody has measured read-only.
- **The lift is `u+rwX`, not `u+w`.** rm needs read and search as well as write to empty a folder (review 1).
- **The folder walk runs only where the lift failed.** One `test` per folder; the usual update never pays it. The
  locked-file search runs on every update on macOS: measured at under 0.01 s on this install (341 entries).
- **Off is `=0`, not "anything but 1".** Unset must mean on, so the old spelling of the test would have read an
  unknown value as off.
- **Uninstall is unchanged.** It lifts and removes; on a locked file it stops partway, as it does today. Not this
  card's condition; said under residuals.

## Weakest premise
That no `/setup` older than 0.7.45 is still being served or run. An installer from before #4449, meeting an app this
one locked, dies at its own `rm -rf` with the board paused, and I cannot make an old installer behave. 0.7.45 has
been the served `/setup` for hours, not days. Whoever merges this decides when it ships: it reaches people at the
next release cut after the merge. If `/setup` is ever rolled back below 0.7.45 after that, those installs need
`chmod -R u+w` on the app folder by hand. The card's "also decide" (guard `/setup` rollbacks below #4449) is the
release lane's and is not built here.

## Residuals
- Linux with a read-only app has not been run by anyone. The Linux workflow installs with the new default for the
  first time on this branch's CI, and uninstalls. Its one update is over a WRITABLE 0.7.27 install, so an update
  over a LOCKED app on Linux stays unrun after that workflow too.
- The locked-file search is macOS only (the flags are BSD's). NOT found ahead of time, so the update still fails
  partway on them as it does today: an immutable file on Linux (`chattr +i`), a deny-delete ACL, another user's file
  in a sticky folder.
- A same-user agent can still `chmod` its way past. The app's instructions to agents are the other half (#4449).

## What would change this
A report of an update that died with "Permission denied" under the app folder; a runtime writer under `app/` showing
up in the second measurement; the Linux workflow going red on this branch.

## Verify
- `sh tools/test-update-locked-app-4455.sh`: 31 passed, run under the installer's own `set -eu` and pipefail lines
  (extracted from the shipped file). Its CONTROL arm runs the old line on the locked fixture and loses `bin` before
  stopping at `app`.
- Eight mutants of the installer, each in a scratch copy, BASE green first, each red BY ITS OWN ARM: the search given
  back the fallback that clears what it found (NOISY); `! -empty` taken out (EMPTY); the lift back to `u+w` (both
  NOREAD arms); the locked-file search switched off (LOCKED and RELOCK); the refusal's `return 1` removed (NODIR,
  NOISY, LOCKED); the lock not put back on refusal (RELOCK, the read-only arm); the lock put on whatever the app
  was before (RELOCK, the writable arm); the search test taken out of the folder walk (NOSEARCH).
  **An eighth mutant is GREEN and is meant to be:** the `|| true` inside the two substitutions taken out. It changes
  nothing while the function is called with `||` after it, which both the installer and the test do (review 2
  measured this; I had described NOISY as proving it).
- Every `install*.test.js` (23 files): 218 pass. `bash tools/test-install-static.sh`: 23 passed.
- The what's-new tests (4 files): 54 pass. (My first wording was 151 characters; the window allows 140.) The line no
  longer says how to remove Kosmos: nobody has emptied a Trash holding a read-only app (review 1).
- `tools.shell-shard-4317.test.js`, `tools.every-test-runs.test.js`: 22 pass.
- NOT RUN YET: `tools/test-install.sh` against the flip, the rest of the shell suite, the Linux workflow. Queued
  again (see the last section).

## Review 1 (2026-10-13, default model), at c9aee9941
0 BLOCKER, 6 WARNING, 0 CONVENTION, 6 NIT. Not converged.
- **WARNING, taken (measured by the reviewer):** under the installer's pipefail, a find that exits non-zero made the
  pipeline fail and `|| _stuck_at=""` threw away the path it had found: the update went on. The status is now
  ignored INSIDE the substitution.
- **WARNING, taken:** my test's driver ran the block with neither `set -eu` nor pipefail, which is why it was green
  over that. It now runs under the installer's own two option lines, and has an arm for it (NOISY).
- **WARNING, taken (measured):** a folder this user owns with no read or search bit passed the check (the lift gave
  it write only) and the swap then failed with `bin` gone. The lift is `u+rwX`; the walk tests all three; arm NOREAD.
- **WARNING, taken (measured):** an EMPTY unwritable folder was refused though rm removes it. `! -empty`; arm EMPTY.
- **WARNING x2, taken before the review arrived:** removals in my test spelled with a plain variable, which an empty
  value would aim at the root of the disk. Splinter flagged the same shape in the reviewer's own probe and I fixed
  the test then: every one uses `:?`, and each sandbox install is checked to be inside the sandbox first.
- **NIT, taken:** append-only flags searched too; the residuals name what is still not found.
- **NIT, taken:** the refusal says "locked" and the Finder's box only for a locked entry; a folder this account may
  not change gets its own sentence.
- **NIT, taken:** the header comment says empty is on. **NIT, taken:** the test's trap covers INT and TERM.
- **NIT, taken by removing the claim:** the what's-new line said to use the Trash.
- **NIT, not taken:** an arm in test-install for the EMPTY value. Each arm there is a whole install, and the rule
  ("only 0 is off") is one comparison, read by the reviewer and stated in the header.
- The reviewer found nothing else that reads the switch, and that the later writers under the app (the icon, the
  launcher) each set their own modes. A reading.

## Review 2 (2026-10-13, sonnet), at 64fc0ea89
0 BLOCKER, 2 WARNING, 0 CONVENTION, 3 NIT. Not converged.
- **WARNING, taken, and it corrects me:** I wrote that the `|| true` inside the substitutions is what saves the path
  under pipefail, and that NOISY proves it. The reviewer removed both and all arms stayed green: the call site
  suspends errexit, so the status never mattered. What the first version got wrong was its fallback
  (`|| _stuck_at=""`), which cleared the variable. The comment now says that, NOISY's label says what it does and
  does not depend on, and the green mutant is in the Verify list.
- **WARNING, taken:** a refusal left the app writable (the lift runs first). The lock is put back on refusal, by the
  same function that locks after a swap; two arms (RELOCK), one with the switch at 0.
- **NIT, taken:** the unlock advice says a lock an administrator set needs one to remove it.
- **NIT, stated:** the empty-but-unopenable folder (in Decided).
- **NIT, taken:** the test's extraction check no longer names `u+rwX`, so the write-only-lift mutant reaches the
  NOREAD arm and reds it there.
- The reviewer checked the find expression's precedence on both finds, the block's syntax in both shells, every
  writer under the app after the lock, and every way the switch can arrive. A reading, plus one run of the test.

## Review 3 (2026-10-13, default model), at f4f0a08c5
0 BLOCKER, 1 WARNING, 0 CONVENTION, 5 NIT. Not converged.
- **WARNING, taken:** my refusal path did not "put the lock back", it locked whatever was there. An install from
  before this release would have had its OLD app made read-only by an update that then refused, and the runtime
  measurement covers 0.7.45 only. The app's state is sampled before the lift and restored: read-only again if it
  was, writable if it was. The shared function is gone (one place locks by the switch, the other restores).
- **NIT x2, gone with it:** the arm that read the switch from the environment, and its prefix assignment.
- **NIT, stated in the test's header:** the RELOCK arms are macOS only.
- **NIT, taken:** the what's-new line said an agent "cannot change" the app. A same-user agent can chmod past it,
  as this plan's own residual says. It says the edit is refused.
- The reviewer swept for anything that pins the replaced line or counts the switch's name (nothing), and measured
  that the next update and the person's own unlock both work after a re-lock.

## Review 4 (2026-10-13, sonnet), at e2c61a409
0 BLOCKER, 1 WARNING, 0 CONVENTION, 6 NIT. Not converged (a new warning).
- **WARNING, taken:** "was the app read-only" was sampled with `[ -w ]`, which is always true for root, so a root
  run would leave a read-only app open after a refusal. It reads the folder's own mode bit now. The reviewer found
  no root path that matters today (the package installer drops to the person's account first).
- **NIT, stated:** the sample looks at the app's top folder and the restore covers the whole app. If only the top
  folder had been read-only, a refusal makes all of it read-only: stricter than it was, never looser.
- **NIT, taken:** my count of mutants was muddled. Seven red, one green.
- **NIT x4, nothing to change:** another user's app folder, a fresh install with no app, the header's list of arms,
  the hand-written old line in the CONTROL arm.
- Nothing refers to the removed function; the what's-new entry parses and has its neighbours' shape.

## Review 5 (2026-10-13, default model), at b576490ca: converged
0 BLOCKER, 0 WARNING, 0 CONVENTION, 5 NIT. Four taken, in one commit AFTER this review that no reviewer has read:
- a clause in the sampling comment (a sample that cannot be taken counts as read-only, and why that direction);
- one more check in `tools/test-install.sh`: an update over a WRITABLE app ends read-only. That is the shape every
  existing install has at its first update after this ships, and my change to the `=0` arm had left it unchecked;
- the Linux residual, which overstated what the workflow measures;
- the way out for someone an OLD installer leaves stuck goes on the card, because that person's installer prints
  neither this file nor the comment.
Not taken: `app` as a symlink (the installer never makes one).
The reviewer measured the sampling line on this Mac for seven folder modes, and walked each case a real person can
meet: the first update after this ships, the second, one the board starts, a failure after the swap, the uninstall,
hand-edited files under the app. Worst case: the one under Weakest premise, an installer from before 0.7.45 meeting
an app this release locked. Stated, not tested, and nothing guards it.

## The first full validation: RED, and it was mine (2026-10-13, finished 12:03 CDT, at c2a105dc2)
- The node suite: 20109 tests, 19874 passed, 0 failed.
- The shell suite stopped at its 21st command of 234: `tools/test-installer-runnable-guard.sh`. That guard reads
  every `-x` test in the installer and wants the two-step form it can judge (`[ -f P ] && [ -x P ]`), because a
  bare one passes for a folder. My folder walk used a bare one inside a `find`, on a folder, on purpose, and the
  guard cannot tell.
- **So 213 of the 234 shell commands did not run, `tools/test-install.sh` among them.** Nothing about the flip in a
  real install is measured yet.
- Why I did not see it first: I ran the installer's node tests and the static check, not this guard. Five reviewers
  did not run it either; none was told it exists.
- The fix: "may this user search the folder" is asked as "does <folder>/. exist", which needs the search bit to
  answer and is not the spelling the guard reserves. A new arm, NOSEARCH (a folder with read and write and no
  search bit, with a control that rm really cannot empty it), and a mutant that takes the test out: red at NOSEARCH.
- Before queueing again I ran, by name, 29 of the shell suite's commands whose scripts read the installer (the
  guard, both static checks, the plist, postinstall, pkg, report-hook and update tests among them): 29 passed.
  NOT among the 29: the ones that boot a board or a real install (`test-install.sh`, the pause sandbox, the
  put-back, the deploy-site and release tests). Those run in the validation.
- No reviewer has read this commit.

## Main merged in (2026-10-13, 14:15 CDT, fb554545f5)
The 0.7.46 cut ran while this waited, so this was to ride 0.7.47 (it then missed that cut too: see the next
section, it is labelled 0.7.48 now). One conflict, in `release/whats-new-pool.json` (main
gained entries at the same place): resolved by taking main's file whole and adding this branch's one entry to it,
checked by parsing (main's 39 items unchanged, 40 after), with `since` moved to 0.7.47 (since moved again, to 0.7.48). After the merge: the pool's
tests 54 pass, the installer check's test 31 pass, the runnable guard 0 failures, the static check 23 pass.
0.7.45 has now been the served `/setup` for about five hours. The weakest premise is unchanged by that.

## Main merged in again (2026-10-13, 19:17 CDT, origin/main 7ea5a5c78d)
The 0.7.47 cut started (about 18:20) with this branch still unmerged, because `tools/test-install.sh` has not run on
it yet. So it missed 0.7.47 and its What's New entry is labelled 0.7.48. The branch was 67 commits behind. One
conflict again, the same file and the same place, resolved the same way: main's `release/whats-new-pool.json`
taken whole, this branch's one entry appended with `since` 0.7.48, checked by parsing (main's 44 items and
`lastProd` unchanged, 45 after; the only diff against main's file is the one added entry).
The second full validation below was at 94ec9aec9, before this merge. It does not cover this head: a third runs
after this commit, and its result is recorded at the end of this file.

## The second full validation: passed, and what it does NOT cover (2026-10-13, finished 15:57 CDT, at 94ec9aec9)
- Type-check, lint, the node suite (20187 tests, 19952 passed, 0 failed), the shell suite (234 commands, none
  failed), the build. Exit 0. The runnable guard and this branch's own test are among the 234.
- **`tools/test-install.sh` is NOT among them, and I had believed it was.** The shell suite runs `bash -n` on it, a
  syntax check. The harness itself, which installs for real into a sandbox, runs at a release cut (the install
  gate in `tools/release.sh`) and needs built bundles in `dist/`. It has not run on this branch.
- That is the test whose default check this branch inverts and to which it adds two checks. So the claim "the
  installed app is read-only by default after a real install, and `=0` leaves it writable" is measured NOWHERE yet.
- No PR until it has run green here. If it first ran at the next cut and was red, it would stop a release.

## The install test has now run, on Mortals (2026-10-13, 20:27 CDT)
`tools/test-install.sh` ran for the first time on this branch, on Mortals, from bundles built from the branch
(`KOSMOS_ALLOW_MINOS=1 KOSMOS_NOTARIZE=0`, Developer ID signed, inside a tmux session there: from a bare ssh
shell the signing fails and no bundle is built).
- **The gate form (`KOSMOS_INSTALL_GATE=1`, what a release cut runs) at 83e1349de2: 165 passed, 0 failed.** It
  stops before the probe blocks, so NONE of this branch's three checks is in it. I had planned to run only this
  form and would have called the branch measured on a run that never reached its own checks.
- **The full form at 83e1349de2: 410 passed, 1 failed.** The failure was this branch's own check, "an update over a
  writable app leaves the new app read-only". The check was wrong, not the installer: it ran after the fallback
  install, which goes to a different sandbox home, so it looked at the app the `=0` update had left writable.
  Written in review and never run until now.
- **Fixed in 6c4d1eccd8:** the check is a second update of the SAME install with the switch unset, straight after
  the `=0` update. **The full form at 6c4d1eccd8: 413 passed, 0 failed**, with all three `#4455` checks in the log
  (the default is read-only; `=0` leaves it writable; an update over a writable app ends read-only).
- What that rests on: the bundles were built at 83e1349de2 and only `tools/test-install.sh` changed after, so the
  rerun did not rebuild them. One run of each form. Logs: `~/.cache/ick-validation/ick-4455-installtest-*.log`
  on Mortals, the gate one copied to Agent1s.
