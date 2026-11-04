# dfail-7887: the daemon stage's printed put-back and move-aside name the true cause when they fail

Card: kosmos#7887 (round 8 of Renet's #7877 follow-up). Agreed with Renet (Fleet Builders m2677): she merged #7877
first (main f1ccfdd077), and this branches off main from there.

## Why
Two failure lines in commands the operator pastes named a cause they had not checked:
1. A probe like `sudo test -e X` exits non-zero both when X is absent and when sudo itself did not run (a cancelled
   password prompt), so "nothing done: X is not there (already put back / moved aside)" could be false.
2. In the printed put-back, every failure with the retired file still there said the agent "is there and not the
   same as it". That is false when nothing was written (the retired file typed by hand is empty, which
   `newest_retired` never names but an operator can type; Renet measured it), and when the copy was good and only
   the final `sudo rm` of the retired file failed.

## Call
- `put_back_cmd` builds the command from two parts (the steps, then the failure branch) instead of one printf. On
  failure, the branch looks before it names a cause:
  - retired file there, no agent: "NOT finished; nothing was written: R is kept, and is empty or could not be read";
  - retired file there, agent there, not empty and byte for byte the same: "put back, but R could not be removed:
    sudo rm R";
  - retired file there, agent there and different: the existing message, unchanged;
  - retired file not found: "nothing done: ... (already put back, or never parked), or the check could not run".
- An empty agent is never "the same": a `cat` that failed compares empty with empty, so the same-branch also
  requires the agent to be non-empty. (Found by the existing pbfail arm: without it, a failed copy read as "put back".)
- The printed move-aside's last branch says "or the check could not run" too.
- Wording avoids the word "sudo" in the could-not-run phrase, because the test runs pasted commands with "sudo "
  stripped, and a message that says "sudo" would be tested in a form no operator sees.
- NIT: `runner_plist` reads `! -L` before `-f`.

## Rejected
- Testing sudo first (`sudo -v`) in the pasted command. Not because it prompts again (the failure branch is up to four
  sudo calls and can prompt again too, after a cancelled prompt), but because sudo working at the start says nothing
  about the step that failed; the branch looks at the files after the failure instead.

## Tests (tools/test-ci-runner-daemon-7001.sh)
- New arms, each building the state and running the printed text: an empty retired file (nothing was written, both
  files as they were); a good copy with a failing rm (put back, names the rm, both files the same); a sudo that never
  runs, for the put-back and for the move-aside (could-not-run, nothing moved).
- teeshort's printed put-back is pasted and puts the agent back; pllink gets a positive control (a regular plist at
  that name is read, and the log records it).
- Five perturbations of the stage, each red at its own arm.

## Weakest premise
That the probes after a failure run with sudo working. The first probe tells "not there" from "could not check"
only by saying both; if sudo works for the first probe and fails for the next, the second probe's message can still
name the wrong cause. That needs a sudo that fails half way through one paste.

## Challenge round 1 (opus), fixed in the next commit
- The no-agent line blamed the retired file whenever the agent was missing, also when R was good and the agent's
  folder was missing or a sudo step was refused. It now checks `test -s R` first: a good R says the agent was not
  written (folder missing or not writable, or a sudo step did not run). Arm pbnofolder (red without the probe).
- mvnosudo could not fail for its stated reason (the agent was already gone); the agent is now in place first, and
  the arm asserts it stays.
- The plan's reason for rejecting `sudo -v` was wrong (the branch re-prompts too); corrected above.
- Nits taken: "was not removed" (it also fires on a re-paste where rm never ran); `test -f R` before anything is
  copied (a directory passes `test -s`); the long comment wrapped; a pin on the printed failure branch with its real
  sudo text, so who runs each probe cannot change unseen (the stripped-sudo arms cannot see it).

## Challenge round 2 (sonnet, whole branch), fixed in the next commit
- A folder typed as the retired path stopped the paste at `test -f`, but the failure branch tested only `-e`, so it
  said the agent could not be written. The outer probe is now `test -f`, and a new arm says "R is not a plain file
  (a folder?)". Arm pbdir; red with the old probe.
- The header comment of put_back_cmd described only the old failure lines; it now says when removal is advised and
  what "put back, but R was not removed" means.
- The who-runs-each-probe pin now covers the outer probes too (pbwho2).
- Not changed: the move-aside's "not there (already moved aside), or the check could not run" (a refused sudo with the
  agent still there is covered by the second clause).

## Challenge round 3 (opus, whole branch, no plan file), fixed in the next commit
- BLOCKER: an empty retired file with a good agent in place reached the "not the same" branch, which advised
  `rm` of the agent; the next paste then stopped on the empty file, and the only good copy was gone. That branch now
  advises removing the agent only when the retired file is not empty; otherwise it says there is nothing to put back
  and the agent is kept. Arm pbemptyagent (red without the guard). The header's promise ("never advises removing the
  only good copy") was false until this.
- The printed move-aside gets the same look-before-naming branch: with the agent still there, a retired file the same
  as it says "moved aside, but the agent was not removed" and names the rm; a different one is named for removal; none
  says nothing was copied. Arms mvrm and mvdiff.
- KOSMOS_CI_RETIRED_DIR and KOSMOS_CI_DAEMON_DIR are now held to the CI_HOME character rule: both are pasted into root
  commands, and a quote in one would turn the rest of a printed line into code. Arm quotedir.
- Test hygiene: the stale "not the privilege split" comment; mvnosudo writes its own sudo stand-in; pbdir compares its
  whole output.
- Not changed: pbnofolder keeps `tail -n 1`, because tee's own error line comes first and the operator sees it too.

## Challenge round 4 (sonnet, whole branch, no plan file), fixed in the next commit
- Two lines could still advise removing a good copy. The move-aside's "different file at the name" line called it
  "empty, or cut short" and advised `sudo rm R`, though R can be a complete earlier parked copy (a paste that worked,
  then a svc.sh install, then the same paste again). The put-back's "agent differs" line advised `rm` of the agent,
  which can be a newer install. Both now move instead of remove: R is renamed to R.earlier in the root-owned dir (kept;
  newest_retired never names it, its suffix is not a stamp), and a differing agent is to be moved aside with the
  printed move-aside first. The header comment now states the exact rule: removal is advised only for a file with a
  non-empty, byte-identical twin.
- Not changed: the order of the two hedges in "not there (...), or the check could not run"; a dangling symlink at the
  agent path in a pasted command (the stage refuses one before printing; a job changing it between print and paste is
  the accepted race).

## Challenge round 5 (opus, whole branch, no plan file), fixed in the next commit
- BLOCKER, mine from round 4: the put-back's "agent differs" line sent the operator to "the move-aside this stage
  prints", which no state that prints a put-back ever prints, and which cannot move an empty agent anyway; pbfail
  pinned that dead end because no arm followed the advice. Now split: an EMPTY agent is to be removed (it holds
  nothing; pbfail, then pbok follows it); a non-empty different agent gets an inline command that moves it, as the
  CI user, to $CI_HOME/<label>.plist.newer (outside LaunchAgents, so a login never loads it), only if that name is
  free. pbover pins it; pbfollow follows it and puts the parked agent back with the newer one kept; pbnoclobber shows
  the rename never overwrites.
- The move-aside's `.earlier` rename is guarded with `test ! -e`, and says to rerun the stage for a new stamp if that
  name is taken too (an unguarded mv destroyed a parked copy in the reviewer's run). mvfollow follows it.
- "nothing was copied ... paste this again" could loop forever; it now says to look at the folder as root if it fails
  the same way.
- The dir seams must be absolute paths, and the refusal names the variable (reldir; quotedir asserts the name).
- The header comment states the exact rule: removal only for an empty file, or one with a non-empty byte-identical
  twin; a file that differs is renamed to a name checked free first.
- Lesson: an arm that pins advice text is not a test of the advice. The follow-through arms are.
