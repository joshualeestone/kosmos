# sleepctl-6730: convert the remaining long-lived bare sleep controls in test-*.sh (#6710 follow-up)

Card: kosmos#6730. Built ON origin/sleep-controls-6710 (Kano's #6710, pushed 09:42, no PR yet): the guard
tools/test-sleep-control-guard-6710.sh and its allowlist exist only there, and this card's done-when is removing the
allowlist entries. So this PR merges AFTER #6710's.

## What changes
Every must-stay-alive control named on the card is a `perl -e 'select(undef, undef, undef, N)'` bounded wait (no
"sleep" in its command line, so a stray `pkill -f sleep` cannot end it; it still ends by itself), and all eight
#6730 entries leave the guard's allowlist (the two #6671 entries stay, Kano's to remove).
- test-browser-run-guard.sh: the four stand-ins, AND the decoy script's foreground `sleep 30` (line 116, not on the
  card: its child is what a stray pkill would end, taking the decoy with it). The fixture check that waits for the
  stand-in to show (`ps ... in sleep*`) matches `perl*` now, in lockstep.
- test-cut-claim-renew-5134.sh, test-pause-foreign-board-964.sh, test-stopmark-6651.sh, test-restart-local-board.sh
  (the timed `( sleep 11; ... ) &` fixture: the perl wait is the same 11 s; the arm's "waited past 10 s" assertion
  still holds).
- test-site-autodeploy-5589.sh: all twelve, INCLUDING the KOSMOS_AUTODEPLOY_DEPLOY command-under-test hangs. Judgment:
  those hangs are what the autodeploy's timeout must kill, and each arm then asserts on that pid with kill -0; a stray
  pkill ending the hang early would let the arm pass for the wrong reason, so they are controls too. Nothing in the
  file matches them by command text (the `(^|/)sleep $Z26` count at 379/387 is a different, fractional sleep).
- test-connector-verbs.sh: the stub scripts' `exec sleep 300` / `sleep 300 &` AND the leak matcher at line 112 in
  lockstep (`grep -qF 'select(undef, undef, undef, 300)'`). That matcher runs only on a leak, so it was MEASURED: a
  real stand-in's `ps -o command=` reads `perl -e select(undef, undef, undef, 300)` -> MATCH; CONTROL pid 1
  (/sbin/launchd) -> NOMATCH. (A first control against my own shell matched because its command line holds the
  whole probe; that is the probe, not the matcher.)
- test-data-root-1511.sh: NOT converted, `# sleep-control-ok` with the reason. Its `sleep 37` is the PRODUCT's old
  watchdog shape that the check hunts (pgrep -fx 'sleep 37'), not a control of the test; converting it blinds the
  regression guard. (The guard never flagged it; the card asked for the decision.)

## Rejected
- Converting the autodeploy command-under-test hangs only "where the command line is asserted": none is, and every
  one is a pid the arm asserts is alive or killed, so all are controls.
- Removing data-root's `sleep 37` matcher: it is the latent guard's whole purpose.

## Weakest premise
That nothing outside these files matches the stand-ins by "sleep" text. Checked per file (every grep/pgrep/pkill/ps
reference to sleep listed and read); not checked across the rest of tools/.

## Tests (each run directly, one at a time)
- test-sleep-control-guard-6710.sh: all checks pass with the eight entries removed (before the conversions it named
  every site, 7 files).
- browser-run-guard rc 0 (and KOSMOS_BC_REALPATH=1 rc 0); pause-foreign-board 12/0; stopmark all passed;
  restart-local-board ALL PASS (the slow arm included); site-autodeploy ALL PASS (93 s); connector-verbs 27/0.
- cut-claim-renew-5134: first run FAILED one arm I did not touch ("the claim was not renewed during a long step", a
  timing arm) at load average 26; the unchanged file passed once; the converted file then passed 3 of 3. Recorded as
  a load flake of an untouched arm.
- data-root-1511: 4 failures (fallback-leaf and symlink CONTROL arms), IDENTICAL on origin/main's copy run in place,
  so not this change: a direct run from this shell picks up the real environment.
- No perl waits left behind after the runs (checked with ps).
