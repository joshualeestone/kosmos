# qhgroup-9118 review record (kosmos#9118 slice A1: a main turn's command stops with its wrapper)

Every round was a fresh blind reviewer. Each fix landed with an arm, and each arm was checked red against the
previous round's script (or a targeted mutation) before it counted.

- Round 1 (0ada1ae2af): 0 B, 1 MAJOR, 4 MINOR, 4 NIT. MAJOR: the stop also ran after a NORMAL exit, with a false
  "signalled" line -> stop only when the wrapper ends early. MINOR: 08 grace octal error; a terminal-reading command
  hung in the background (-> keep the foreground with a terminal); a KILL to the caller's group orphaned the command
  (-> watcher in its own group); default grace unpinned. Renewer HUP NIT fixed.
- Round 2 (f98d5b029b): 0 B, 1 MAJOR, 4 MINOR. MAJOR: the watcher watched the LEADER, not the group -> group.
  MINOR: a "Killed: 9" job report in every main turn (-> disown); the fork-to-$! window (-> record, never ignore);
  a controlling terminal with stdio redirected (-> foreground); no stdin arm for the background path.
- Round 3 (9e593c1ec6): 0 B, 1 MAJOR, 2 MINOR. MAJOR: ALRM/USR1/USR2 released the claim and left the command (-> key the
  stop on QH_DONE, not the signal). MINOR: posix-mode /dev/tty probe (measured: not broken inside the && / || list;
  made a subshell anyway); the watcher's second grace (documented).
- Round 4 (05484f7966): 0 B, 0 MAJOR, 3 MINOR. Release-after-stop and the watcher's end unpinned (-> arms, each red on
  a mutation); ALRM/USR recorded during the fork.
- Round 5 (bb83d9acc7): 0 B, 1 MAJOR (test only), 3 MINOR. MAJOR: the ALRM arm went red once under load (-> 5 s grace,
  90 s exit bound, release asserted on its own; 160/160 twice, the second at load 74). MINOR: ALRM/USR ignored during
  the cleanup; kill -l signal numbers; a comment that overclaimed; USR1/HUP arms.
- Round 6 (0de5d75f83): 0 B, 0 MAJOR, 4 MINOR. Three test races (trap before fork, KILL after the watcher exists,
  wider grace margin); grace clamped to the claim's sure remaining life (new arm).
- Round 7 (ce597d2e05): 0 B, 0 MAJOR, 3 MINOR. A regression of this branch (RENEW_SEC=08 octal in the clamp, new arm);
  clock deadlines in both grace loops; the caller's-group KILL trade stated in the comment.
- Round 8 (27ac7ddf5e): see below.

Accepted, stated in the PR: after a SIGKILL of the wrapper, the claim reads free while the watcher stops the command
(up to about 5 s plus the grace). A microsecond window between the command's fork and the watcher's fork leaves a
SIGKILL there unwatched.
- Round 8 (27ac7ddf5e, the last under the 8-round cap): 1 BLOCKER, 0 MAJOR, 2 MINOR, 3 NIT. BLOCKER: the tty and ctty
  arms used BSD `script -q /dev/null cmd`, which util-linux script (CI's Linux shards run this file) rejects, so both
  would be red on every Linux run. FIXED after round 8: a small ttyrun helper uses the BSD form on macOS and
  `script -qec "<cmd>" /dev/null` elsewhere; 162/162 on this Mac. NOT re-reviewed (cap reached); the PR's Linux shell
  shards are the proof, and the merge waits for them. Also unproven until then: the other #9118 arms on Linux (bash 5).
  MINOR, accepted: a KILL to the caller's group leaves the command's cleanup running while the claim reads free
  (bounded: about 5 s plus the grace; documented); date +%s whole seconds can shorten a tiny grace by up to 1 s.
