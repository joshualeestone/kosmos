---
pre_challenge: true
method: challenge-loop
branch: stopmark-6651
diff_hash: 9cebda02e735eb03e7ed512eddc233cb53f522b53722b319b23ddfb69c8142d4
validation: passed (Mortals)
subdir_audit: passed
timestamp: 2026-10-20T03:34:44Z
iterations: 12
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 12, fresh blind reviewers alternating opus and sonnet. **Converged:** yes; iteration 12, on 830859c4 after the rebase onto main, reported NO NEW FINDINGS. **Fixed:** every finding of iterations 1 to 11, one fix commit per iteration. **Asked:** 0.
**The design changed twice under review:**
- Iteration 3: an attributed marker body cannot be written on a full disk. The design now uses an empty file's name, which can.
- Iteration 7: an age rule against the marker misread kills. Leftovers are now judged by the board's last start.

Decisions and the accepted residuals are in .claude/plans/stopmark-6651.md.

**Validation, measured:**
- Mortals full suite at 830859c4: 22341 tests, 22024 passed, 0 failed, 317 skipped, recorded clean.
- tools/test-stopmark-6651.sh: 77 PASS. It covers a real filled disk image, dash, setup.sh's decision lines run under dash set -eu, and the real watchdog.
- Neighbours green: test-update-putback-4818 33/33, test-setup-pause-sandbox-4651, test-board-watchdog-2955, test-board-foreground-2956, install.linux-board-4920.test.js 32/32, test-connector-currency-windows-6628.
- Every fix was checked by a mutant that turned a test red, then restored.

### Per-Iteration Breakdown

The reviewers' own reports, copied from this session's Claude Code transcript (2026-10-19), with paths made repo-relative and em dashes replaced (house style). Nothing else is edited.

#### Iteration 1
**Reviewer model:** opus

The review of `stopmark-6651` (HEAD 2ea60551) found one blocker, two warnings and one nit.

The three tests you named all pass on this branch: `test-stopmark-6651` (all passed), `test-board-watchdog-2955` (0 failures) and `test-update-putback-4818` (33 passed). None of them covers findings 1 to 3.

1. [CHALLENGE] **BLOCKER**. `install/setup.sh:3851-3852`, with `install/kosmos` `write_stop_marker` (cmd_stop's not-running branch, about line 2051). An update now overwrites a person's stop with an installer's pause, so a failed or killed update later starts a board the person turned off.
   - **Scenario:** a person ran `kosmos stop`, so `board.stopped` is empty. Or the computer is a connect computer, which `_kosmos_mode_keeps_board_off` covers. In both cases `_kosmos_was_running=no`, but setup.sh still runs `KOSMOS_STOP_BY_INSTALL="$$ &lt;lstart&gt;" kosmos stop --force` unconditionally. The board is down, so cmd_stop's else branch calls `write_stop_marker`, which moves `install &lt;pid&gt; &lt;start&gt;` over the person's empty marker.
   - **What follows:** if the run then fails (any die, including the #2055 pause aborts) or is killed, neither the put-back nor `_kosmos_clear_own_marker` touches the marker, because both are armed only when `was_running=yes`. Line 5128's empty rewrite is never reached. Once setup.sh exits, the watchdog, board-run or an agent's start reads the marker as stranded, moves it aside, and the board starts.
   - **Connect computers:** the board plist is installed there (#4356), and neither the watchdog nor board-run checks the mode. A connect computer gets a running board.
   - **Measured:** with the extracted `write_stop_marker` and `stop_marker_stranded`, an empty marker followed by the update pause's write became `install 57279 Mon Oct 19 20:01:58 2026`. Once that sh had exited, the verdict was "stranded".
   - **Fix:** attribute only when this run owns the pause, i.e. `KOSMOS_STOP_BY_INSTALL` is set only when `_kosmos_was_running=yes`. Also make `write_stop_marker` keep an existing marker rather than replace it with an attributed one, e.g. `[ -e "$STOP_MARKER" ] &amp;&amp; return 0` in the install arm.
   - **Test to add:** person's empty marker, then an attributed stop on a down board, must still read "stands".

2. [CHALLENGE] **WARNING**. `install/kosmos` `stop_marker_stranded`, `bin/board-watchdog.sh:136` and `install/setup.sh:3850`. `ps -o lstart=` prints local time, which depends on the `TZ` of whoever calls it, so a live installer can read as gone.
   - **Measured** on this Mac, same pid, three calls:
     - default (`TZ=America/Chicago`): `Mon Oct 19 20:02:08 2026`
     - `TZ=UTC`: `Tue Oct 20 01:02:08 2026`
     - `TZ=America/New_York`: `Mon Oct 19 21:02:08 2026`
   - **Scenario:** a person whose shell sets a `TZ` that differs from the system zone (e.g. `TZ=UTC` in their rc) runs the install line. The watchdog and board-run run under launchd with no `TZ`. When setup.sh re-bootstraps the board job, board-run's RunAtLoad fires, or the watchdog ticks, and the strings differ. The pause of a live update is moved aside, and launchd's PathState KeepAlive starts the board mid-update. That is the worst outcome on the list.
   - **Fix:** use `LC_ALL=C TZ=UTC0 ps -o lstart= ...` in the writer and in both readers, keeping the byte-equal twin check. Add a test that writes the marker under one `TZ` and reads it under another.
   - Seconds rounding, DST and a start near midnight do not change the output for a fixed start time on macOS, because the start time is a fixed wall-clock value rendered by `localtime`.

3. [CHALLENGE] **WARNING**. `install/kosmos` `stop_marker_stranded` and its watchdog twin. When `ps` cannot run, the empty result is read as "installer gone", so a broken instrument clears a live pause.
   - **Measured:** under `sandbox-exec` with `(deny process-info*)(allow process-info* (target same-sandbox))`, `/bin/ps` fails with "Operation not permitted", rc 126, and prints nothing. Outside the sandbox the same live pid printed its lstart.
   - **Scenario:** an agent runs `kosmos start` from a sandboxed shell (#4636 and #4651 treat that as a real case) while an update is paused and the health probe reads "down". `agent_board_guard` then clears the live installer's marker, and launchd starts the board mid-update. It needs a sandbox that blocks `ps` but lets the probe and the move in `KOSMOS_HOME` through, so the severity is conditional.
   - **Fix:** if `ps` prints nothing, return 1 (the pause stands) unless a control succeeds, e.g. `ps -o lstart= -p $$` is non-empty or `kill -0 "$pid"` returns ESRCH. Never treat empty output as proof the installer has gone.

4. [CHALLENGE] **NIT**. Reasoned from how Linux procps works, not measured (this is a Mac). On Linux, `lstart` is the boot time from `/proc/stat` plus the process's start ticks. The boot-time value moves when the wall clock is stepped, for example an NTP sync on a freshly booted machine, and older procps derived it from uptime with one-second jitter. An agent's `kosmos start` on Linux could then read a live installer as gone.
   - **Fix:** the same as finding 3, by preferring `kill -0` plus a tolerant comparison. Or compare `/proc/&lt;pid&gt;/stat` field 22 (start ticks, which do not move) on Linux, and keep `lstart` for macOS.

One check came back clean: `$$` inside `${var:+...}` and inside a command substitution under dash is the script's own pid, which is the process that owns the EXIT trap, including under `curl | sh`. A prefix assignment is not word-split, and `${line#* }` keeps the inner double space of a padded day.

#### Iteration 2
**Reviewer model:** sonnet

Two new findings, both WARNING. I found no BLOCKER. I ran `tools/test-stopmark-6651.sh` and it passes. I did not run the two neighbouring suites, and I could not test the Linux `/proc` path on this macOS machine.

1. [CHALLENGE] WARNING, install/kosmos:171-175 and bin/board-watchdog.sh (`stop_marker_stranded`, same text). A connect computer's off board can be started by a stranded update pause.
   - `setup.sh` attributes the pause only when `_kosmos_mode_keeps_board_off` was false at the start (setup.sh:3842).
   - The person can switch the computer to connect through the app's first screen during the run. setup.sh re-reads the mode at 3775 and 5125 for this reason.
   - If the run is killed after that switch and before line 5137 truncates the marker to empty, the marker still reads "install P T".
   - Nothing in `stop_marker_stranded` consults the mode, and `cmd_board_run` has no mode check. So the watchdog, `board-run` or an agent's `kosmos start` moves the marker aside and starts the board on a connect computer.
   - This is the outcome the card cares most about. It is a narrow window, but it needs a kill, which is exactly the case this branch targets.
   - Fix: in all three call sites, return 1 (not stranded) when `$KOSMOS_HOME/mode` says the board should stay off. `_kosmos_board_decide` and `_kosmos_mode_keeps_board_off` have the exact rule. For the watchdog, read the `mode` file directly: anything other than `run` or `both`, or unreadable, means the marker stands. Add a test with `mode=connect` and a dead installer that expects the marker to stay.

2. [CHALLENGE] WARNING, install/kosmos:187-190 and the same lines in bin/board-watchdog.sh. The gone-installer check depends on the language of an error message, and a dead pid is the normal path.
   - A dead pid makes `ps -p` print nothing, so `live` is empty.
   - The code then relies on `kill -0` printing text that matches `*"o such process"*`.
   - Measured on macOS: bash, dash, `/bin/kill` and zsh all print some form of "No such process" (zsh lowercases it). The pattern matches all of them. macOS `strerror` is English-only.
   - On Linux, glibc localizes `strerror`. Under `LANG=fr_FR`, `kosmos start` or `board-run` prints "Aucun processus de ce type", the pattern misses, and the stranded marker is never cleared. This fails safe, so the bug is only that the feature silently doesn't work.
   - Fix: prefix `LC_ALL=C` on the `kill -0`. Better, on Linux use `/proc` presence instead of text: `[ -d /proc/self ] &amp;&amp; [ ! -e "/proc/$pid" ]` means gone. Keep the kill text check only as the fallback for systems without `/proc`.

3. [CHALLENGE] NIT, install/kosmos:190, setup.sh:3857 and the test. The token format differs between readers on Linux when `/proc/&lt;pid&gt;` is unreadable for the reader.
   - This can happen with `hidepid=` mounts, or if the installer and the reader run as different users.
   - The writer's token is `proc:N`, but the reader falls back to the `ps` lstart string. Those never match, so a live installer reads as "another process" and its pause is cleared.
   - Fix: if the marker's token starts with `proc:` and the reader cannot read `/proc/$pid/stat`, treat it as unknowable and keep the pause. The test never exercises the `/proc` branch (nothing in the test covers `proc:`), so the Linux path is reasoned, not measured.

Checked and fine:
- **`/proc` parsing:** the greedy `s/^.*) //` plus `awk $20` is the right field for names containing ") ".
- **`ps` on macOS:** under `TZ=UTC0` it prints UTC (same process: UTC 01:07:38 versus local 20:07:38). Trailing padding is trimmed. The padded-day double space survives `read -r` unchanged.
- **Token match:** setup.sh's inline token is textually identical to `start_token` on both platforms.
- **`write_stop_marker` early return:** nothing uses the marker's mtime. A grep over the three files found no `-nt`, `-ot`, `stat` or `find`.
- **A person's `kosmos stop`:** with no env, the `*)` branch truncates an install marker to empty, so a person's stop overrides it correctly.

#### Iteration 3
**Reviewer model:** opus

1. [CHALLENGE] BLOCKER, install/kosmos:85-86 (write_stop_marker). On a full disk the attributed marker falls back to the empty one, so the card's own incident is still not fixed.
   - Scenario, measured: I built an 8 MB APFS image in scratch, filled it, then tried both writes.
     - `: &gt; marker` succeeded (0 bytes).
     - `printf 'install 12345 Mon Oct 19 21:21:56 2026\n' &gt; tmp` failed with "No space left on device" and left an empty file.
   - So when the disk is full, write_stop_marker takes its `|| { ...; : &gt; "$STOP_MARKER"; }` arm and writes the empty marker. Readers take that as a person's stop and never clear it.
   - The card's run B paused at 21:21:57 "inside the full-disk window". Run A had just failed because the disk was full, and B is believed to have died under ENOSPC. With this branch, B would write the same 0-byte marker and the board stays off, as it did on 19 Oct.
   - restore_stop_marker (install/kosmos:132) has the same weakness: on a full disk, `&gt;` truncates and the printf fails, so it turns an installer's pause into a person's stop.
   - Fix: carry the attribution in a file NAME, which needs no data block. In the same test, an empty file named `board.stopped.by-install.12345.Mon_Oct_19_21:21:56_2026` was created successfully. An xattr failed with ENOSPC, so that is not an alternative.
     - Write the empty marker as now, plus an empty sibling whose name holds the pid and token.
     - The plain (person) branch of write_stop_marker removes any `board.stopped.by-install.*`.
     - The readers treat an empty marker as attributed only while exactly one sibling exists.
     - Add a full-disk arm to the test. A small hdiutil image works, or a stub that makes the data write fail.

2. [CHALLENGE] WARNING, install/setup.sh:3842 with install/kosmos:87. A second install run can wash a stranded pause into a person's stop.
   - Scenario: run B is killed and leaves "install B ...". Before the watchdog's next 30 s tick (or at any time on Linux, which has no watchdog), the person pastes the install line again (run C), as the failure message tells them to.
   - C sees a marker, so `_kosmos_was_running=no` and C passes no attribution. C's `kosmos stop --force` takes the not-running branch, and the plain write_stop_marker truncates B's marker to empty.
   - If C then fails too (the disk is still full), neither its put-back nor its own-marker clear is armed. The board stays off for good, where without C it would have been cleared.
   - Fix: in setup.sh's was-running check, treat a marker that stop_marker_stranded calls stranded as absent. Then C adopts the pause, attributes it, and its put-back covers it. A smaller alternative: an installer that has no attribution of its own leaves an existing attributed marker untouched.

3. [CHALLENGE] NIT, bin/board-watchdog.sh:153-160 and install/kosmos:136-138. Check-then-move race against a person's stop.
   - stop_marker_stranded reads the marker, runs ps and kill, then `mv -f` moves whatever file is there at that moment.
   - If a person's `kosmos stop` truncates the marker to empty in that gap, their empty marker is moved aside and the board starts.
   - Fix: after the mv, read the aside file again. If it is not the same "install &lt;pid&gt; &lt;start&gt;" line just judged stranded, move it back.

4. [CHALLENGE] NIT, bin/board-watchdog.sh:153-163. The comment is false in one case.
   - It says "then the usual down-streak logic brings the board back". But the clear runs before gate 2, so with no board plist (auto-restart off, or mid-uninstall) the watchdog moves the marker aside and then exits at gate 2. Nothing brings the board back, and an agent's start is no longer refused.
   - Fix: move the clear after gate 2, or reword the comment.

5. [CHALLENGE] NIT, install/kosmos:1495. An agent's refused start still releases the board.
   - The stranded clear runs before the #5450 cooldown and claim checks. If the cooldown refuses, the marker is already gone, so launchd's PathState starts the board anyway, while the agent is told it "may not start it again yet".
   - The result is harmless (the watchdog would clear it too), but the message is wrong.
   - Fix: do the clear after the cooldown and claim pass, or word the refusal for this case.

6. [CHALLENGE] NIT, tools/test-stopmark-6651.sh section 4. These checks only look at the source text, so some can pass when the behaviour is wrong.
   - The agent-start check is a bare grep, which would pass with the clear placed after the refusal.
   - "attributes only when pausing a running board" is a within-12-lines proximity check.
   - Nothing runs setup.sh's inline token code against start_token. I compared them by hand: same output today, including under TZ=Asia/Tokyo and LANG=fr_FR. But the test does not pin them equal, so a later change to one would make readers misjudge a live installer as gone, with no red test.
   - Fix: pin setup.sh's token lines against start_token by running both on one live pid, as the twin check already does for the watchdog. Drive agent_board_guard against a stub, as the watchdog section does.

I also ran tools/test-stopmark-6651.sh and it passed. The scratch disk image is detached and deleted.

#### Iteration 4
**Reviewer model:** sonnet

1. [CHALLENGE] BLOCKER, install/setup.sh:3936. Under dash, `: &gt; "$_kosmos_pause_name" 2&gt;/dev/null || _kosmos_pause_name=""` kills the whole installer when the file cannot be created. This is the exact failure the card targets.
   - **Cause:** `:` is a POSIX special builtin. dash aborts a non-interactive shell on a redirection error in one, and neither `||` nor `2&gt;/dev/null` stops that. /bin/sh is dash on Debian and Ubuntu, so this hits the supported Linux path.
   - **Measured:** `/bin/dash -c 'x=/nonexistent/dir/f; : &gt; "$x" 2&gt;/dev/null || x=""; echo handled'` prints the error and never prints "handled". The `{ : &gt; "$x"; } 2&gt;/dev/null || ...` form exits silently the same way. macOS `/bin/sh` and `/bin/bash` (3.2) print "handled".
   - **Scenario:** a full disk, an exhausted inode table or an unwritable `$KOSMOS_HOME` gives ENOSPC or EACCES on the create. setup.sh exits right there, before `kosmos stop`, with no die message, and the trap's put-back has nothing armed. The fallback `_kosmos_pause_name=""` is dead code on dash.
   - **Why the tests missed it:** the full-disk test in tools/test-stopmark-6651.sh only runs under macOS bash and SKIPs elsewhere. The shared block is `eval`ed in bash only, and no test runs setup.sh's creation line under dash.
   - **Fix:** use `if ( : &gt; "$_kosmos_pause_name" ) 2&gt;/dev/null; then :; else _kosmos_pause_name=""; fi`. I measured it handled under dash, including with `set -eu`. `printf '' &gt; f` also works, but dash prints its error to stderr.
   - **Test:** add a dash run, for example `sh -c` over the setup.sh lines against an unwritable dir, or the block plus a creation under `/bin/dash` when it exists.

2. [CHALLENGE] WARNING, install/setup.sh:3925-3926 and 3932-3937. The adoption branch removes the old stranded names before this run's own name exists.
   - **Scenario:** a run killed or out of disk between line 3926 and 3936 leaves `board.stopped` with zero names. That reads as a person's stop, which is the original bug again. It also happens when step 3936 fails, per finding 1.
   - **Fix:** create this run's name first, and only then remove the old names. Better, skip the removal and let the old names go aside through the normal clear. Note that `_kosmos_marker_ours` and the put-back already cover adoption.
   - **Side note:** `kosmos_stranded_pause` is evaluated twice (the `elif` and the pipe), which is a harmless TOCTOU.

3. [CHALLENGE] WARNING, install/kosmos:1684 (`cmd_start`). Only `kosmos stop` and a later update remove name files. `kosmos start` removes the marker but leaves any `board.stopped.by-install.*`.
   - **Scenario:** update A is killed, leaving marker plus name A. A person runs `kosmos start`, so the marker goes but name A stays. Anything that later writes `board.stopped` without going through `cmd_stop` is then misread as a stranded pause, and a dead name needs only `mode=run` to qualify. Examples are the restore-on-refusal paths at install/kosmos:1635 and 1696, or any older `kosmos stop` binary.
   - **Second effect:** one unreadable or ambiguous leftover name (a sandbox where `ps` is denied, or a stray `board.stopped.by-install.foo`) makes every future stranded pause "stand", until a person happens to stop.
   - **Fix:** in `cmd_start`, next to line 1684, run `rm -f "$STOP_MARKER".by-install.*`. A start means any earlier attribution is moot.

4. [CHALLENGE] WARNING, shared block, `kosmos_installer_gone` (setup.sh around 3716-3727, same text in the other two files). A token written with one method and read with the other counts as "gone".
   - **Scenario:** a Linux reader (`/proc` present) meets a name written with an `lstart` token. The `case "$2" in proc:*)` guard does not fire for a non-`proc:` recorded token, so the final comparison sees `proc:NNN != Mon_...` and returns 0 ("gone") for a LIVE installer. That clears a live update's pause.
   - **How it arises:** the writer could not read `/proc/$$/stat` but `ps` worked, or the home directory is shared across namespaces.
   - **Related case:** with `hidepid=2` or a different pid namespace, `[ -e /proc/$1 ]` is false for a live process, so the pause also reads as gone. This is rarer.
   - **Fix:** if the families differ, return 1. That means recorded `proc:*` against a live non-`proc:` token, and also recorded non-`proc:` against a live `proc:` token. Only a same-family mismatch should count as "another process".

5. [CHALLENGE] NIT, shared block `kosmos_clear_stranded_pause`. The clear opens a window with no marker, between `mv board.stopped` aside and the put-back of a person's marker.
   - **Scenario:** a person's `kosmos stop` removes the names and writes a new marker. The in-flight clear moves that marker aside, and launchd PathState or a systemd path unit relaunches `board-run` in the gap. The marker comes back afterwards, but the board is already up, and the person's stop may already have finished.
   - **Why it's narrow:** it needs a stop landing in a few milliseconds. The put-back comment promises more than this guarantees.
   - **Fix:** note it in the comment, or re-check for names before the move as well as after.

6. [CHALLENGE] NIT, shared block line `_kcs_aside=...stranded.$(date +%s)`. Evidence files (`board.stopped.stranded.&lt;ts&gt;` and `.by-install.*`) are never pruned. Two clears in the same second also share one aside name, and `mv -f` overwrites the first.
   - **Fix:** use `$(date +%s).$$` and cap the count, for example keep the newest few.

7. [CHALLENGE] NIT, tools/test-stopmark-6651.sh, section 4. The callers are tested only by line order (awk on `cmd_stop`, `agent_board_guard`, and the setup.sh trap).
   - **Gap:** nothing behaviourally proves that `KOSMOS_STOP_BY_INSTALL=1 kosmos stop` keeps names while a plain stop removes them, nor that the trap removes the name on exit.
   - **Gap:** nothing executes the Linux `/proc` branches of `kosmos_start_token` and `kosmos_installer_gone`, or the dash path. I confirmed the block itself runs correctly under dash, /bin/sh and bash 3.2 with `set -eu`, a KOSMOS_HOME containing a space, a glob that matches nothing, and the `| while` adoption form.
   - **Fix:** stub the CLI and exercise the `cmd_stop` env-var branch with a throwaway KOSMOS_HOME, and run the block under `/bin/dash` when it exists.

**Checked, no finding**
- The four test scripts you named pass under /bin/bash 3.2: stopmark-6651 38 PASS, board-watchdog-2955 47, update-putback-4818 33, setup-pause-sandbox-4651 35, with no FAIL.
- Nothing else in the repo globs `board.stopped*`. `engine/linuxboard.js`, `native-app/main.swift`, `tools/windows/KosmosLauncher.cs` and the install tests use the exact path only.
- A person's stop is covered: `cmd_stop` is the only marker writer for it, and both of its write sites strip names first.
- Old/new version mixes fail safe: an old `kosmos stop` ignores the env var, and a killed update before the file swap is read by old readers that ignore names.
- Mid-run `kosmos restart --force` and the connect-mode `stop` in setup.sh at 5339, 5603 and 5798 only strip this run's name while the marker is not meant to stand.

I did not edit, commit, push or post anything.

#### Iteration 5
**Reviewer model:** opus

I found five new findings: one WARNING and four NITs. Nothing I found lets a plain person's stop, or a board the mode keeps off, get started directly. But finding 1 lets a live update's pause be cleared while that update is still running.

I ran tools/test-stopmark-6651.sh (all pass), test-board-watchdog-2955.sh (0 failures) and test-update-putback-4818.sh (33/33). Separately I ran the shared block under /bin/bash 3.2 with `set -euo pipefail`, on a stranded-pause home and on a full 5 MB disk image. In both it detects and clears correctly. The here-documents still worked on the full disk, even with a 70 KB body. The image is detached and the scratch dir is removed.

1. [CHALLENGE] WARNING, install/setup.sh:3941-3950 (naming block) with :3930-3938 (was_running / adopt). Reasoned from source, not run.
   - **Scenario:** update U1 pauses a running board, so the marker and U1's name exist. Update U2 starts while U1 is alive; there is no install lock, and the card shows two installs 16 s apart.
   - U2 sees the marker. The pause is not stranded, because U1 is live, so `_kosmos_was_running` stays `no`. U2 therefore makes no name, and its `KOSMOS_STOP_BY_INSTALL=1` stop keeps only U1's name.
   - U1 is then killed, which is the card's exact way of dying. U1's name now reads as gone, so the pause reads as stranded while U2 is still mid-download or mid-swap.
   - The watchdog clears it, and launchd's PathState KeepAlive relaunches board-run as soon as the marker is gone. So the board starts during U2's file swap, which is what the pause exists to prevent.
   - At U2's end, `kosmos start --force` (setup.sh:5243) finds it healthy and says "already running". The board keeps whatever code it loaded mid-swap.
   - Before this branch, the marker held until U2's own final start brought up the new build.
   - **Fix:** when the marker U2 finds carries live by-install names (an update's pause, not a person's stop), U2 creates its own name too. It should not set `was_running=yes`, because the put-back belongs to U1. The pause then stands while any installer is alive, and still reads as stranded once all are gone. The iteration-1 concern does not apply: a person's stop has no names, so it still gets none.

2. [CHALLENGE] NIT, install/kosmos:1558 and :1570.
   - **Scenario:** an agent's start is judged stranded at the top of `agent_board_guard`, and the clear runs only after the cooldown and claim. If, in that window, a person's stop lands (it removes the names) or a new update adopts the pause (adds a live name), the clear correctly returns 1. The clear puts a person's marker back.
   - But `|| true` throws that verdict away. `cmd_start` then removes the marker and every name, including a live update's, and starts the board.
   - The window is milliseconds and about as wide as the pre-branch check-to-rm window, so this is not a regression. But the clear's put-back protection does nothing for this caller.
   - **Fix:** `kosmos_clear_stranded_pause agent-start || { [ -f "$STOP_MARKER" ] &amp;&amp; { say "&lt;the stopped-on-purpose refusal&gt;"; exit 1; }; }`

3. [CHALLENGE] NIT, install/kosmos:237 (`restore_stop_marker`). Measured.
   - Under the CLI's `set -euo pipefail`, if `: &gt; "$_n"` fails for a name, the `&amp;&amp;` list's final command fails inside the pipeline's subshell. pipefail carries that out, and errexit ends the CLI right there, because the call sites run it as a plain `then` body.
   - The `die` message on the line after ("Nothing was started or stopped; run this from a shell that can reach it") is lost, and any later names are not put back.
   - I ran it with one name in a missing directory: exit 1 and no output, whether that name came first or last in the list.
   - It can happen on the #4636 path itself: a write-sandboxed shell, where cmd_start's rm also failed, so the names are listed and cannot be re-truncated.
   - **Fix:** `[ -n "$_n" ] &amp;&amp; { : &gt; "$_n"; } 2&gt;/dev/null || true` inside the loop, matching the function's own "return 0" intent.

4. [CHALLENGE] NIT, install/setup.sh:5228 together with the adoption branch at :3933-3938. Reasoned.
   - Adopted names are left in place on purpose, and this run's EXIT trap removes only its own name. A clean run that ends with the board kept off on purpose by `_kosmos_off_for_foreign` writes the marker at :5228 with mode run|both. The old adopted names are still there with their installer gone, so the pause reads as stranded.
   - The watchdog or board-run then clears the marker that #4676 meant to hold "until you run 'kosmos start'". Our board then comes up by itself once the other install frees the port. Connect and unreadable modes are safe because of the mode check.
   - **Fix:** record the adopted names and have `_kosmos_on_exit` remove them along with `_kosmos_pause_name`. A killed run still leaves both sets, so it still reads as stranded. Alternatively, remove `board.stopped.by-install.*` just before the :5228 write.

5. [CHALLENGE] NIT, shared block, install/kosmos:224 (same text in setup.sh and board-watchdog.sh). Measured.
   - On a full disk, the log `printf ... &gt;&gt; board-watchdog.log 2&gt;/dev/null || true` fails with ENOSPC. bash 3.2's printf builtin keeps its buffered text, which is later written to the caller's stdout.
   - My full-disk run printed the "cleared a stranded update pause" line twice on stdout. So an agent's `kosmos start` or board-run output gets stray log lines in exactly the card's full-disk case. Only cosmetic.
   - **Fix:** run it in a subshell, `( printf ... &gt;&gt; "$KOSMOS_HOME/logs/board-watchdog.log" ) 2&gt;/dev/null || true`. This is reasoned, not measured: the subshell's leftover buffer should die with it instead of reaching stdout.

#### Iteration 6
**Reviewer model:** sonnet

[CHALLENGE] 1. WARNING, install/setup.sh:3944 and the shared block (`kosmos_stranded_pause`, about 3745-3762). Names an older `kosmos` leaves behind can make a person's stop read as a stranded pause.

This is reasoned from the source, not run. Main's `kosmos start` removes only `board.stopped`. Main's `kosmos stop` removes no names, because they do not exist there. The chain:
- (a) A new setup.sh run A names its pause, then is killed before it swaps in the new CLI. Killing it is the card's own case. `bin/kosmos` and the watchdog are still the old ones, so nothing clears anything.
- (b) The person or an agent runs the old `kosmos start`. The marker goes and the name stays.
- (c) The person later makes a deliberate stop with the old CLI. The marker is plain and the stale name is still there.
- (d) The next update B finds marker, a gone name and mode run. It adopts the pause as "stranded". Its final start then brings up a board the person stopped on purpose. The matrix harness below confirms this case: `marker=1 names=gone mode=run` gives was_running=yes and adopted.

The failure is the one the card forbids. The window is narrow: it needs a pre-swap kill and then an old-CLI start and an old-CLI stop. It closes once every machine runs the new CLI.

Fix: make the update's name newer than its marker. After `kosmos stop` returns, re-touch the name with `( : &gt; "$_kosmos_pause_name" ) 2&gt;/dev/null || true`. In `kosmos_stranded_pause`, treat a name as stranded only if `! [ "$KOSMOS_HOME/board.stopped" -nt "$name" ]`. That test is plain `test` and works in dash. A marker rewritten later by any stop then stands. If you decide not to build it, record the window as accepted.

[CHALLENGE] 2. NIT, install/setup.sh (the join comment and the test label "the pause holds while either runs"), tools/test-stopmark-6651.sh:224-225.

The claim is true only when the first update is killed. If update A finishes normally, its final `kosmos start` runs `rm -f "$STOP_MARKER" "$STOP_MARKER".by-install.*` (install/kosmos:1718). That removes the marker and B's name, so B finishes its swap under a started board. A's failure put-back does the same. This is the same as before the branch, so it is not a regression. The comment and the test name overclaim. Fix: say "holds against a killed peer", or have A's put-back and start leave names whose pid is live.

[CHALLENGE] 3. NIT, tools/test-stopmark-6651.sh:218-231.

The setup.sh branches (adopt, join, name-create) are checked only by grep and awk line order on the source, so they cannot fail on behaviour. I extracted the real decision lines into a dash `set -eu` harness (scratch only) and ran marker x names (none, live, gone, mixed, malformed) x mode (none, run, connect). Every row came out as designed:
- Marker absent: was_running and own name, except mode connect, which gets neither.
- Marker with gone names and mode run: adopt.
- Marker with a live, mixed or malformed name and mode run: join.
- Marker with no names: nothing.

So there is no code bug, only missing coverage. Fix: add a test that sources that fragment, as my harness did.

[CHALLENGE] 4. NIT, the shared block, Linux arm of `kosmos_start_token`.

The `proc:&lt;ticks&gt;` token counts ticks since boot and carries no boot identity. After a reboot, a different process could get the same pid at the same tick and read as the old live installer. That is possible mainly for early-boot processes. The result fails safe: the pause stands, which is the old behaviour. Fix: append `/proc/sys/kernel/random/boot_id` to the token (hyphens would need mapping to `_`), or note it as accepted. The Linux arms are reasoned, not measured, as the plan already says.

Checked and found fine:
- The new lines under dash with `set -eu`.
- The EXIT trap's `while` loop with `|| true`.
- The shared block parses identically in all three files.
- Mode parsing matches `_kosmos_mode_keeps_board_off`.
- The clear and race logic.
- The watchdog's gate order.
- The agent-start paths.

Tests run, all green: test-stopmark-6651 (54 PASS), test-board-watchdog-2955, test-update-putback-4818 (33/33) and test-setup-pause-sandbox-4651. I touched no live board and edited nothing.

My harness is at <scratch>/h/run.sh.

#### Iteration 7
**Reviewer model:** opus

Three new findings: two WARNINGs and a NIT, each measured under /bin/dash and /bin/sh against the shared block taken from install/setup.sh, in a throwaway KOSMOS_HOME in scratch. The branch's own test still passes (65 PASS, rc=0).

What I checked and found sound:
- **Same-second stop and touch.** On this Mac, dash, /bin/sh (bash 3.2) and bash all compare `-nt` in whole seconds, and only zsh uses nanoseconds. Equal times give "not newer", so the name still supports the pause, which is the right answer.
- **A rewrite of an existing empty marker.** On APFS, `: &gt;` over an existing empty marker does move its mtime, so a later stop over an existing marker is seen.
- **A live update.** Its pause always stands, because the liveness check returns before the age rule is reached.
- **The update's own later writes.** The config-decided-off write (setup.sh:5251) and the foreign-port write both rewrite the marker after the touch. If the update is then killed, the name is older and the pause stands, which is the intended answer. The put-back, the update's own start, restart and the connect-stop all remove the names.
- **restore_stop_marker.** It writes the marker first and the names after, so the restored names still support the pause.

1. [CHALLENGE] WARNING, install/setup.sh:3975 (`touch "$_kosmos_pause_name"`): `touch` creates the name again after a person's stop removed it, so a person's stop reads as stranded.
   - **Scenario:** the installed CLI is already this version (any update after the first). The update creates its name and calls `kosmos stop`, which writes the marker and then waits for the board to exit. During that wait a person runs `kosmos stop`, which removes every name (install/kosmos:2033) and writes the marker. The update's stop returns and `touch` makes the name again, now newer than the person's marker. If the update is then killed before its EXIT trap, `kosmos_stranded_pause` returns 0 and the watchdog, board-run or an agent's start brings up a board the person stopped.
   - **Measured:** "RESULT: person's stop reads as STRANDED". The control with `touch -c` reads "stands".
   - Before iteration 6, the person's stop removed the name for good.
   - **Fix:** `touch -c` (POSIX: never creates). Then update the exact-line pin at tools/test-stopmark-6651.sh:262 and add this row to the test.

2. [CHALLENGE] WARNING, install/setup.sh:3971-3975, and the shared-block comment at :3762 ("the name is never older than its own marker"): an update killed while its own stop is running is now read as a person's stop.
   - **Scenario:** the name is created, then the CLI starts up and `cmd_stop` writes the marker (install/kosmos:2034), then waits for the board to exit. The touch runs only after that wait. If the update is killed during the wait (a SIGKILL, a hangup, or a timeout while a busy board is slow to stop), the name keeps its creation time. Once the marker write falls in a later second than the name's creation, the marker is `-nt` the name, so the name supports nothing and the pause stands. That is the card's bug coming back for this kill point.
   - On a shell whose `-nt` uses nanoseconds (I believe bash 5 and recent dash on Linux, but I did not measure that), the marker is always newer, so it would happen every time. The setup.sh adoption path runs on Linux too.
   - **Measured** (killed after the marker write, before the touch, 10 runs per gap; the gap stands in for the CLI's startup time):

     | Gap before the marker write | Pause wrongly stands |
     |---|---|
     | 0.05 s | 2 of 10 |
     | 0.3 s | 4 of 10 |
     | 0.6 s | 8 of 10 |

     Same numbers under dash and /bin/sh.
   - Iteration 5's adoption has the same exposure: the stop rewrites the marker, so the adopted names become older too.
   - **Fix options:**
     - Keep the name's mtime at or above the marker's for the whole stop: run the stop in the background and `touch -c` the name every 0.5 s until the stop's pid exits.
     - Apply the age rule only when the marker is newer than the name by more than the stop's longest wait.
     - At minimum, correct the comment and record this kill window in the plan and on the card as a known gap.

3. [CHALLENGE] NIT, install/setup.sh:3975: a clock stepped back between the stop and the touch makes the name older than its own marker.
   - The result is "stands", the safe direction (the board stays off, as before the card). With second-resolution compares it takes a step of more than 1 s.
   - **Fix:** `touch -c -r "$KOSMOS_HOME/board.stopped" "$_kosmos_pause_name"` copies the marker's exact time, so the two are equal whatever the clock does. This also covers finding 1.

The scripts I used are in <scratch>/r7: run.sh (finding 1), run2.sh (finding 2), and block.sh (the shared block they load).

#### Iteration 8
**Reviewer model:** sonnet

1. [CHALLENGE] WARNING, install/setup.sh:3952 (the join branch). It tests `ls board.stopped.by-install.*` is non-empty and calls that "another update's LIVE pause". It never checks that any name is live or newer than `board.started-at`. Iteration 7's rule now classifies leftovers, but this branch ignores it.
   - Failure scenario: the marker is a person's stop, written by an older kosmos, whose `stop` does not remove names. Beside it sits a leftover name from a killed update (dead pid, older than the last start).
   - I measured the first half with the setup.sh shared block under `/bin/sh`. `kosmos_stranded_pause` returns "person", so branch 2 does not fire. The branch-3 `ls` test is still true.
   - A new update B then takes the join path with `_kosmos_was_running=no`. It creates its own fresh name `NB` and runs its stop, which keeps names.
   - If B is killed or dies under a full disk, the state is the marker, `NB` (gone, newer than the last start) and the leftover. That reads as stranded, so the watchdog, `board-run` or an agent start restarts a board the person had stopped.
   - I did not run that second half end to end. It follows from reading `kosmos_stranded_pause`.
   - This is the exact failure iteration 6 and 7 set out to prevent, reached through a different caller. It needs the old-kosmos stop window the plan already names, so I rate it a WARNING, not a BLOCKER.
   - Fix: gate the join on a name whose installer is provably live. Loop the names, parse pid and token, and require `kosmos_installer_gone` to return non-zero. Alternatively require a name newer than `board.started-at`, as the shared block does.

2. [CHALLENGE] NIT, install/kosmos:254-257 (`restore_stop_marker`). It recreates the names with `: &gt; name`, so every restored name gets a fresh mtime.
   - Failure scenario: a refused start (the paths at 1673 and 1737) restores a leftover name that was older than `board.started-at`. The leftover is now newer than the last start and counts as support again. The marker it sits beside is then read as stranded, and the next watchdog tick starts a board a person stopped.
   - This needs a leftover plus a person's marker, so it is narrow. It is also the same old-CLI window as item 1.
   - Fix: restore by moving the names aside before removal (keeping their mtimes), or `touch -r &lt;started-at&gt;`. Or simply do not restore names whose mtime is older than `board.started-at`.

The rest of the brief checked out:

- **Writers of `board.started-at`:** only `_mark_board_started` in install/kosmos writes it, at four call sites (systemd restart, launchd kickstart, the direct nohup start, and `board-run` at 1985). Nothing else in the repo writes it. The `.test.js` hits are fixtures.
- **Pause ended without a write (healthy early return):** `cmd_start` can return early at the `healthy` check without writing. In that case the marker and names are already removed. The state is "no marker", which is not stranded, so I found no bad outcome.
- **Write during a pause without a start:** the writes sit after the marker check, the agent clear and the cooldown. `board-run` writes only after its marker refusal and clear. A relaunch in the window between name creation and the stop's marker write could make a name look old. That window is a fraction of a second, and it matters only if the update is then also killed. I judge it too small to report.
- **Same-second `-nt`:** only a mixed old-CLI stop plus a killed update could reach it, so it adds nothing beyond the accepted item.
- **Final start and put-back:** both write after the name exists, and the trap then removes the name. A kill between the final start and the trap leaves a leftover with no marker, which is correct.
- **Test run:** `tools/test-stopmark-6651.sh` passed.

#### Iteration 9
**Reviewer model:** opus

**[CHALLENGE] 1. WARNING.** install/setup.sh:3958-3967 (the adopt and join branches) together with :3973-3981 (the name is made only when a start token comes back).

The adopt and join decisions both assume this run will have a name of its own. When `kosmos_start_token $$` returns nothing, the run goes ahead with no name. The shared block's own comment names the case where that happens: ps cannot run, as in a sandboxed shell, which an update typed into an agent's shell can be. The watchdog runs under launchd with a working ps, so it judges the other names as gone and clears the pause while this update is still live and mid-swap. That is a live update's pause cleared, and it is worse than before this card: a bare marker was never cleared by anything.

- **Adopt, measured** (in scratch, shared block extracted from setup.sh, ps stubbed to fail for update A only):
  1. Marker plus the name of a killed update Z (gone, newer than board.started-at).
  2. A takes the adopt branch, gets an empty token and makes no name.
  3. The watchdog's `kosmos_stranded_pause` says yes, and `kosmos_clear_stranded_pause watchdog` moves the marker aside while A is live.
  4. The watchdog then brings the old board up during A's file swap.
- **Join, measured:**
  1. Update A is live (a real `sleep` pid) with its name and the marker.
  2. Update B, with ps failing, joins through `kosmos_live_pause` and gets no name.
  3. A is killed.
  4. The watchdog clears while B is live (marker gone).
  5. This is iteration 5's two-update problem coming back whenever the joining run cannot name itself.
- **Fix, either of:**
  - (a) In the adopt and join branches, require a name before taking the branch. If `_kosmos_pause_name` ends up empty, move the adopted names aside now (a bare marker is the pre-card state, and the put-back covers a failure). For a join with no name, there is nothing safe to remove, so fall to (b).
  - (b) When no token is available, name the run with a sentinel token such as `board.stopped.by-install.&lt;pid&gt;.unknown`. Teach `kosmos_installer_gone` that this token counts as gone only when `kill -0` says "No such process". Never compare it against a ps or /proc token, because that comparison would call a live run gone.

  Then add a matrix row with ps failing in the updater's shell only.

**[CHALLENGE] 2. NIT.** install/setup.sh:3973-3984 (the name is written before the stop writes the marker).

This only happens during the changeover to this version:

1. An update is killed between creating its name and its `kosmos stop` writing the marker. The window is a few lines, before the file swap, so the old CLI is still on disk.
2. The board keeps running and the name is newer than board.started-at, so it is not a leftover.
3. A person later stops the board through that old CLI, which does not remove names.
4. That marker now reads as stranded, so the next new update adopts it. If that update fails, its put-back starts a board the person stopped. (A successful update starts it anyway, which was already true before this card.)

Very narrow: it needs a kill in a window of a few lines, an old-CLI stop, and a failing update. Fix: record it under iteration 7's accepted changeover residuals. Or have the adopt branch ignore a name whose mtime is far older than the marker's mtime, for example more than a few minutes, since an update's own stop follows its name within seconds.

On the rest, nothing new: I went through the stranded, live, leftover, adopted and joined combinations against a person's stop or start through the new or old CLI, a refused start (including the `_await_board_up` restore), a killed update, overlapping updates, the clear racing a stop, the native app's `holdBoardStopped`, and mode reads. Each one lands on behaviour that was already there before this card, or on an item the plan already records or accepts. `tools/test-stopmark-6651.sh` passes on this branch. Nothing was edited, committed or posted. My simulation scripts are in <scratch>/it9.

#### Iteration 10
**Reviewer model:** sonnet

[CHALLENGE] 1. BLOCKER, `tools/test-setup-pause-sandbox-4651.sh:37` (it fails against `install/setup.sh:3961-3998`)

I ran the neighbouring tests. `test-stopmark-6651.sh` passes, as do `test-board-watchdog-2955.sh` and `test-update-putback-4818.sh` (33 passed, 0 failed). `tools/test-setup-pause-sandbox-4651.sh` fails with 32 failures on this branch. The same unmodified test passes with 0 failures on main (`~/work/kosmos`).

- **Cause:** the test extracts only the `if [ "$FRESH_INSTALL" = "no" ] ... fi` block from `setup.sh` and runs it in a harness. That block now calls `kosmos_start_token` and `kosmos_stranded_pause` and reads `$_kosmos_adopted_names` under `set -u`. None of these exist in the harness, so it dies with `kosmos_start_token: command not found` and `_kosmos_adopted_names: unbound variable`.
- **Why it matters:** `package.json` line 16 (`test:shell`) runs this test, so CI goes red. The test also exercises the real pause and sandbox paths. Those assertions are currently unevaluated, so the sandbox-pause behaviour of this branch is untested.
- **Fix:** have the harness extract and define the `# BEGIN kosmos#6651 shared block` through `# END` text. It should also initialise `_kosmos_join_pause=no` and `_kosmos_adopted_names=""`, the same way `test-stopmark-6651` extracts the decision lines. Alternatively, make the setup.sh block tolerate those names being undefined (`${_kosmos_adopted_names:-}` in the condition). The first option is cleaner.

On the iteration 9 items you asked about, I found nothing real.

- **"unknown" token:** I traced the `kill -0` "No such process" match under dash and bash, the Linux `/proc` path, and a live reused pid keeping the pause. All fall on the safe side.
- **Unnamed-adopt rule:** it is consistent with the recorded residuals.

2. NIT, `install/setup.sh:4000-4003` (unnamed-adopt)

The moved-aside file is named `board.stopped.by-install.&lt;pid&gt;.&lt;tok&gt;.unnamed-adopt`. It still matches the `board.stopped.by-install.*` glob, and its token contains a ".". `kosmos_stranded_pause` then does `return 1` on the malformed name, so a later stranded pause is never recognised until a `kosmos start` or `kosmos stop` removes it. It only arises when the name could not be created (no inode), so it is a rare double fault. A fix is to rename it outside the glob, for example `board.stopped.unnamed-adopt.&lt;pid&gt;.&lt;tok&gt;`.

No other finding is new.

#### Iteration 11
**Reviewer model:** opus

**Iteration 11 (fresh blind CTO lens) on stopmark-6651 at local HEAD 72ce1271c1.** I found no other test that this branch breaks, and no new defect in the shell code. The only new item is a merge conflict.

**How I hunted.** I grepped the whole repo for tests that read, pin, slice or execute `install/setup.sh`, `install/kosmos` or `bin/board-watchdog.sh`. I also grepped origin/main for every line the branch removes or changes in those three files, which finds any test pinning the old text. Besides the ones already handled in iteration 10 (`install.linux-board-4920.test.js:352` and `tools/test-update-putback-4818.sh:282`), two more tests pin those lines:
- `cli.startedby-5450.test.js:110` looks up `rm -f "$STOP_MARKER"` inside `cmd_start`. It still matches, because the new line `rm -f "$STOP_MARKER" "$STOP_MARKER".by-install.*` starts with that text and keeps the order the test checks.
- `install.linux-board-4920.test.js:429` (the uninstall test) looks for the stop text near the KillMode line. The uninstall stop itself is unchanged, so it still matches.

**What I ran.** I ran everything in two scratch copies (HEAD and origin/main), never in the worktree. I used a fake HOME and stub `launchctl` and `systemctl` so nothing could reach the real home or a live board. The worktree is still clean and the copies are deleted.
- **Shell tests, HEAD:** 16 harnesses, all rc=0, each with its own all-pass summary line. This includes ones the plan does not list: test-board-supervised-detect-2956, test-board-supervised-linux-4918, test-ssh-keychain-note-2600 (it slices `cmd_start`), test-pause-foreign-board-964 and test-update-abort-2055 (both slice setup.sh's pause block), test-update-locked-app-4455, test-install-static (23/23), test-kosmos-addr-reclaim-3079, test-install-board-paths-2870, test-supervisor-env and test-kosmos-help-exit0-3036. I also reran the five the plan lists (test-board-watchdog-2955, test-update-putback-4818, test-setup-pause-sandbox-4651, test-board-foreground-2956 and test-stopmark-6651 at 77/77).
- **Node tests:** the 186 `*.test.js` files that reference the three scripts or `board.stopped`, run with bare `node --test`. Both trees gave 3967 tests, 3901 pass, 22 fail, 44 skipped, and the failing test names are the same on both. Those 22 are caused by running outside the test runner: the Windows CLI, task-add and temp-root tests need the runner's setup. None of them comes from this branch.
- **Not run:** `tools/test-install.sh`, which is heavy and runs the whole install end to end. The queued Mortals validation is the only thing covering it.

**Findings**

1. [CHALLENGE] WARNING, `package.json:16` (`test:shell`): the branch no longer merges into current origin/main. `git merge-tree --write-tree HEAD origin/main` reports a content conflict in `package.json`. Since the merge base (ee19dfef8d), main's 8a6816a8bc (wincurrency-6628) added `bash -n tools/test-connector-currency-windows-6628.sh &amp;&amp; bash tools/test-connector-currency-windows-6628.sh` to the same one-line `test:shell` script where this branch adds `bash tools/test-stopmark-6651.sh`. Origin/main is 36 commits ahead of the merge base.
   - **Failure scenario:** the queued Mortals full-suite run tests a base 36 commits old, and `/create-pr` or merge-on-green stops on the conflict. Once the branch is rebased, that run no longer covers what will merge (the rebase-orphans-every-recorded-run bulletin), and the merged result, with both entries in `test:shell`, was never validated.
   - **Fix:** rebase onto origin/main and keep both additions in `test:shell`. Then rerun test-stopmark-6651 and `tools/test-connector-currency-windows-6628.sh`, and count the Mortals validation only if it ran on the rebased sha. Its value as a check of the shell logic is unaffected: none of the 36 commits touch `install/setup.sh`, `install/kosmos`, `bin/board-watchdog.sh` or the three tests the branch edits.

I found nothing else new.

#### Iteration 12
**Reviewer model:** sonnet

NO NEW FINDINGS

- **Rebase:** `package.json` is valid JSON. `test:shell` keeps main's entries, including `test-tar-owner-gate-6562.sh`, and appends `bash tools/test-stopmark-6651.sh` as the last entry. The setup-pause-sandbox and update-putback entries are intact. The diff against `origin/main` touches only the nine files expected: the three shared-block files, the two neighbouring tests, the new test, `install.linux-board-4920.test.js`, the plan and `package.json`.
- **Test runs:** I ran these four on HEAD, all green.
  - `test-stopmark-6651.sh`: all passed.
  - `test-board-watchdog-2955.sh`: 0 failures.
  - `test-update-putback-4818.sh`: 33 passed, 0 failed.
  - `test-setup-pause-sandbox-4651.sh`: 0 failures.
- **Hunt:** I read the three-way shared block and the setup, `kosmos` and watchdog call sites. I found nothing new and real beyond the recorded and accepted items. Checked and cleared:
  - The EXIT trap captures `$?` before it removes the names. Removing the name ahead of the put-back leaves no gap, because the put-back removes `board.stopped` before it starts the board.
  - Every `kosmos stop` in `setup.sh` is covered. The two without `KOSMOS_STOP_BY_INSTALL` are uninstall and connect mode, and in neither case does a pause need to stand.
  - The unset-variable, glob and `-nt` handling in the shared block holds for dash and bash.
  - `_n` in `cmd_start` does not collide with other uses.
  - The prune of stranded evidence copes with `.` characters in names.

I did not touch the worktree, and I ran nothing against a live board.
