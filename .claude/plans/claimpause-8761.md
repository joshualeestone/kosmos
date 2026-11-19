# claimpause-8761: a kosmos-ci runner that pauses while Mortals' machine claim is live (kosmos#8761, PR half)

Card: kosmos#8761. Agreed with PigeonPete (m4897, 15:13 CST 11-19): I build the PR (the pause and its test); he keeps the
Mortals install (kosmos-ci user, install, register, keepalive, before/after measurement) after this PR and the 0.8.11 cut.

## Finished means
1. A runner can be told to watch a machine-claim file (Mortals: /Users/mortalkombat/.cache/kosmos-run-markers/machine-claim,
   readable by a standard user: home 750 group staff, marker dir 755, PigeonPete measured). While that file holds a LIVE
   claim, the runner takes no new job: it finishes the job it has, then its service is stopped; when the claim clears or
   expires it is started again. No red jobs by design (waiting inside a job times out at suite's 45 min, PigeonPete's point 2), except the unmeasured race named below.
2. A test proves both arms with a stand-in launchctl/pgrep: live claim + idle -> stopped; live claim + job running ->
   left alone until idle; no claim, expired claim, malformed claim -> started; a claim held by ANOTHER user's live pid
   reads as live (the control below).
3. The script's header says exactly how to install it (a LaunchAgent, every 60 s). DECIDED: no ci-runner-setup.sh stage
   in this PR: the install is PigeonPete's half, and that 1,560-line staged tool deserves its own reviewed change.
   Rejected: adding the stage here (doubles the review surface for an install nobody runs before the 0.8.11 cut ends).

## Traps measured (15:2x CST, this Mac)
- `kill -0 <pid>` as a different user than the claim's holder gives EPERM and rc 1, the same rc as a dead pid; so
  `_kosmos_machine_claim_active` (tools/lib/cut-guard.sh) run as kosmos-ci reads every live cut claim as crashed. Use
  `ps -p <pid> -o pid=` (alive rc 0, dead rc 1), control: pid 1. Posted on #8761.
- `_kosmos_marker_dir` follows HOME: the claim path must be named explicitly (KOSMOS_CI_CLAIM_FILE).
- The claim's 5-field shape and fail-open rules (fewer than 5 fields, non-numeric pid/exp -> no claim) must match
  cut-guard.sh; read-only here: never rm the foreign claim.

## Design (decided; weakest premise below)
- A watcher, not the job-started hook: a hook that refuses fails the job red.
- Stop the way the keepalive stage already does it while idle (read tools/ci-runner-setup.sh ~lines 600-930: a SIGTERM
  so the Listener ends its GitHub session, KeepAlive {SuccessfulExit:false} does not restart a clean exit). Start with
  launchctl kickstart of the gui/<uid> label. LaunchAgent mode only first; daemon mode (system domain, root) cannot be
  stopped by kosmos-ci: refuse or document.
- Race: a job the Listener accepted but has not handed to a Worker yet is cancelled by the stop. Its length is NOT measured;
  it is armed at the start of every cut. Documented in the header as open.

## Weakest premise
That stopping the Listener cleanly while idle never loses an already-assigned job. To measure in the test only by stand-in;
real behaviour on Mortals is PigeonPete's install check.

## Tests
- tools/test-ci-runner-claim-pause-8761.sh (48 checks at run time, in test:shell; macOS-only in tools/shell-macos-only.txt). Perturbed (15:41 CST, on c9156b8d2e): liveness
  as `kill -0` instead of `ps -p` fails the live-claim checks; restored from HEAD.

## Decided in review
- An unreadable claim (closed folder, not a file, no read permission) changes NOTHING and exits 1 every tick: not "no
  claim", which would restart a runner this pause stopped while the cut may still hold the box. Rejected: fail open as
  cut-guard does (cut-guard's caller is the claim's own user; here a permissions change is the likely cause).
- A loaded KeepAlive true is refused before any stop (read as ci-runner-setup.sh's loaded_always). [Round 2 had a 90 s
  timer here; SUPERSEDED by round 4: the marker holds the pid it stopped.]
- Tests: (counts below are run-time; current: see Tests above.) Round 3: no Listener is waited on (setup refuses the same state); a claim clearing while the stopped runner is still ending keeps the marker (else the runner stays down).
- Round 4: the marker holds the pid it stopped, so "still ending" is that pid, however long it takes (the 90 s timer
  could lose the restart); the claim must be gone on two ticks in a row before a restart (a cut can release and claim
  again between phases). Open, in the header: a new pid during a claim ends the pause for that claim; a box with no
  marker folder yet exits 1 until its first cut. Check counts are run-time counts (a loop runs one check 7 times).
- Round 5: listed in tools/shell-macos-only.txt (plutil, launchd, ps of pid 1; it cannot pass on Linux); the clear
  rule needs 50 s between the two clear ticks (a hand-run tick); a state that holds is logged once; times carry the
  zone; the header says what a planted marker can really do.
- Round 6: the SIGTERM-exits-0 premise is named in the header as a measurement PigeonPete's install must make on the
  box; a clear time ahead of now restarts the wait; the 50 s boundary is pinned at 49 and 50 (perturbed: -lt 49 fails).
- Round 7: the "not set up" check ran with the real HOME and wrote ~/.kosmos-ci/claim-pause/last-said on this Mac
  (found by the reviewer, removed: it held only that one line, created 15:58); now sandboxed, and a check asserts
  nothing lands in the real home. Logging wording corrected (exit codes repeat, lines are logged once).
- Round 8 (the cap): an unreadable tick now resets the two-clear-ticks rule (tested, perturbed); "never a red job"
  became "by design, except the unmeasured race"; the test's call log is cleared per case. Fixed AFTER the last
  review round, so unreviewed.
