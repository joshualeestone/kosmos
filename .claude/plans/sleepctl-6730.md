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

## Review round 1 (blind, opus)
- [WARNING] a control in a touched file was missed: test-pause-foreign-board-964's stub server.js ran a foreground
  `sleep 30`, whose death would end OURPID and send the "our board" arms down the foreign path --> CONVERTED (the
  same shape as the browser decoy). My premise only grepped for sleep MATCHERS, never for foreground children: a
  missed class, named here. 12/0.
- [WARNING] my `# sleep-control-ok` on its own comment line was inert (the guard's opt-out is per line) and read as
  an exemption in force --> reworded as a plain note that the guard does not flag a pgrep line.
- [WARNING] data-root's failure path ran `pkill -fx 'sleep 37'`, ending any agent's sleep 37 on the box (#6710's own
  hazard) --> REMOVED; the leak is still reported, a leaked one ends by itself in 37 s, and the KOSMOS_HOME=$FAKE
  pkill (a unique path) stays.
- [NIT] three comments still said "sleep" of perl waits --> FIXED. [NIT] browser-run-guard's decoy wait outlives its
  arm by up to 30 s (older than this branch; it ends by itself) --> NOT CHANGED.
- Reruns: pause-foreign 12/0; guard passes; the three comment-edited files parse; data-root the same 4 failures as
  main's copy in place.

## Review round 2 (blind, sonnet)
- [WARNING] test-site-autodeploy's test 26 fetch hang (`ext::sleep $Z26`) is the same command-under-test class as the
  deploy hangs and was left bare; my plan had called its matcher "a different, fractional sleep" without saying why
  the hang itself stayed --> CONVERTED with its matchers in lockstep: the remote runs `perl -e
  select(undef,undef,undef,$Z26)` (no spaces: ext:: splits on them), and the leftover count and its control match it
  ANCHORED (`^(/usr/bin/)?perl -e select\(...$Z26\)$`). First attempt used grep -F and counted ITSELF (its own
  command line holds the text: "1 left", red); anchoring fixed it. MEASURED in a throwaway repo: during a fetch the
  wait is alive as `/usr/bin/perl -e select(undef,undef,undef,4321.77)` (counted 1; git's own `git remote-ext ...`
  line is not counted), and 0 after it is killed. Test ALL PASS, its control included.
- [NIT] test 30's deploy-under-test `sleep 4; exit 0`: a stray pkill ends it with rc 0, which the arm also passes
  on, so it cannot pass for a wrong reason --> NOT CHANGED (under the 5 s threshold, and harmless).

## Review round 3 (blind, opus)
- [WARNING] test 26's leftover regex allowed only `perl` or `/usr/bin/perl`, and the control started a bare `perl`,
  while git runs the remote by the full PATH it resolves: on a box whose first perl is Homebrew's or a CI image's, a
  leaked hang would never be counted while the control still passed --> FIXED: `^([^ ]*/)?perl -e select\(...\)$`,
  and the control starts `"$(command -v perl)"`, the form git produces. MEASURED: a full-path live wait counted 1, 0
  after; of three sample lines (a Homebrew perl, the grep's own line, git's remote-ext line) only the perl matches.
  Test ALL PASS.
- The whole-diff re-check found nothing else.

## Review round 4 (blind, sonnet): converged
- No new issues in substance. [NIT] two connector-verbs comments ("300 s sleep"; "perl waits only for", which now
  reads as the stand-in rather than the timeout wrapper) --> FIXED (comments only). [NIT] data-root's
  `pgrep -fx 'sleep 37'` can count another agent's sleep 37 (a false red, never a kill) --> NOT CHANGED: pre-existing,
  the latent guard's purpose, and the box-wide pkill beside it is already gone.

## Validation (on 3d41e354, tree untouched throughout)
- 22524 tests, 3 failed, none this branch's (it changes only tools/test-*.sh; the node suite never runs them):
  engine/musefront.test.js "a long turn keeps saying working" and engine/remove.test.js "a burst of failing restarts
  waits once" each passed run alone (load timing); engine/communityfollow.test.js #4774 W1 fails on CLEAN origin/main
  too (3/3 alone at load 42-50): a 20 ms slack against a 100 ms timeout, filed as kosmos#6754. AUDIT_RC 0. The shell
  suite this card changes was run test by test above (every touched test green alone; data-root's 4 identical to main).
