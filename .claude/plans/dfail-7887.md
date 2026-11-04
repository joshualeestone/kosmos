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
