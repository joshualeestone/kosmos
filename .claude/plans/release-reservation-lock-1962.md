# kosmos#1962 -- a machine-reservation claim so a release can quiet the box

## The problem (Josh, verbatim)
"I'm hoping you push hard and get a lot out of smaller faster releases if possible." The 0.6.23 cut
took two hours of wall clock for seventeen minutes of build, almost all of it one human-scale
activity: asking agents to stop using the machine, one at a time, by name. An external hold list on
an 18-agent box is always incomplete. And the cost does NOT shrink with the release -- ten small
releases cost ten times the coordination -- so "smaller faster releases" is blocked on this.

Why the box has to be quiet is real, not superstition: measured on unchanged code by three people, the
same file failed 8 reds under concurrent gates and passed 22/22 alone; a contender live gave 3 FAIL,
box idle gave 11 PASS.

## Scope: Option A (the reservation lock). Option B (offload to another mini) is scoped separately.
Josh's own recommendation: "A first, B as the destination." A needs no new hardware and captures most
of the benefit.

## What exists (build on it, do not duplicate)
`tools/lib/cut-guard.sh` (#1796) already provides the machine-wide primitive: markers at
`$HOME/.cache/kosmos-run-markers/<type>.<pid>`, cookie-based self-exclusion (a run excludes ITSELF by
an exported cookie, not a process-tree walk), and dead-pid self-cleaning. Its guards
(`kosmos_refuse_if_cut_live`, `_browser_run_live`, `_harness_live`) already make a second
CUT/BROWSER/HARNESS *run* refuse. `release.sh` marks itself `cut` and refuses a second cut.

**The gap:** an agent's ordinary `yarn test` (`tools/run-tests.sh`) never consults any of this, so it
runs and contends during a cut. `run-tests.sh` only REPORTS contention (`seen_before`), never refuses.
That ordinary run is exactly the tenant the hold list kept missing.

## Done looks like (from the card)
1. A release can CLAIM the machine for N minutes; other gate scripts see the claim and refuse with a
   clear message naming who holds it AND until when.
2. The claim is VISIBLE (a file) so anyone can ask "who has the box?".
3. It EXPIRES on its own -- a crashed cut must not park the fleet.
4. Control that returns the dangerous answer: with a claim held, a second gate must actually REFUSE.
   Today nothing refuses.

## The change

### `tools/lib/cut-guard.sh` -- the claim primitive (new functions, additive)
ONE well-known file `$DIR/machine-claim` (not pid-suffixed: a second cut is already refused, so at
most one legit claim). Body one line: `<cookie> <pid> <expires_epoch> <host> <label>`. Written
atomically (temp + `mv`) so a consult never reads a half-written line.

- `kosmos_claim_machine [minutes]` -- create/refresh OUR claim (default 30 min). Reuses/exports
  `KOSMOS_MACHINE_CLAIM_COOKIE` so the holder identity is stable across refreshes and inherited by
  child gate runs (self-exclusion). release.sh calls it at start and RENEWS at each step.
- `kosmos_release_machine` -- remove the claim ONLY if it is ours (cookie match). Never touches a
  foreign claim. From release.sh's EXIT trap.
- `_kosmos_machine_claim_active` (internal) -- echo `cookie pid expires host label` of the ACTIVE
  claim or nothing; self-clean a claim whose holder PID is dead OR whose expiry has passed. A
  malformed/partial line is treated as NO claim and left in place (a concurrent writer will overwrite).
- `kosmos_refuse_if_machine_claimed <what>` -- the gate consult. If an active claim exists that is not
  ours -> print a refusal naming the holder pid, label, and `until <HH:MM>` and return 1; else 0.
  Honors `KOSMOS_IGNORE_MACHINE_CLAIM=1`. FAIL-OPEN on any read/parse trouble.
- `kosmos_machine_claim_status` -- one human line: reserved by (pid, label) until HH:MM, or "no
  release holds the machine right now." The "who has the box?" answer.

**Three things free the box, all in the safe direction** (an error refuses a foreign gate a bit too
long, never corrupts a release): holder releases on exit; holder pid dead (crash); claim expires (hung
-but-alive step, renewed per step so a healthy long cut never lapses).

**FAIL-OPEN is load-bearing:** a gate must never refuse because the claim FILE is broken -- that would
wedge the very fleet this protects. Only a well-formed, live-holder, unexpired, FOREIGN claim refuses.

### `tools/release.sh` -- hold the claim
- After the existing refuse checks (~line 208, before step 1): `kosmos_claim_machine <N>`.
- `step()` renews the claim each phase (guarded `command -v`), so a healthy cut of any length keeps
  the box; a stuck step lets the window lapse.
- Add `kosmos_release_machine` to BOTH EXIT traps (line 90 and the fuller line-379 trap), so any exit
  frees the box promptly; expiry is the backstop for the tiny pre-claim window.

### `tools/run-tests.sh` -- the gate that now refuses (the #4 control)
Source `cut-guard.sh` and, right after `BEFORE="$(seen_before)"` (line 52) and before the node suite
(line 103), call `kosmos_refuse_if_machine_claimed "this test run" || exit 1`. This is THE gate every
agent runs as pre-PR validation. release.sh runs `yarn test` as its own step 3 but holds the claim
(cookie exported), so its child self-excludes and proceeds; a foreign agent refuses.

### `tools/who-has-the-box.sh` -- the visibility answer (#2)
A tiny script that sources cut-guard.sh and prints `kosmos_machine_claim_status`, so anyone can ask.

### Tests: `tools/test-machine-claim-1962.sh`
Driven with `KOSMOS_RUN_MARKER_DIR` pointed at a temp dir. Arms:
- **THE CONTROL (dangerous answer):** a live FOREIGN claim (a real alive pid, unexpired, foreign
  cookie) -> `kosmos_refuse_if_machine_claimed` returns non-zero AND the message names the holder pid
  and an "until HH:MM". Today nothing refuses; this proves it now does.
- Positive control: OUR OWN cookie -> returns 0 (proceeds). Proves self-exclusion, so release.sh's own
  gates are not refused.
- Expiry: a claim with `expires_epoch` in the PAST -> proceeds AND the file is self-cleaned.
- Dead holder: a claim whose pid is dead -> proceeds AND self-cleaned.
- Malformed / empty / missing file -> proceeds (FAIL-OPEN) and does NOT delete a malformed file.
- `KOSMOS_IGNORE_MACHINE_CLAIM=1` -> proceeds even under a live foreign claim.
- `kosmos_release_machine` removes OUR claim; does NOT remove a foreign claim.
- `kosmos_machine_claim_status` prints the holder + until for an active claim, and the "no release"
  line otherwise.
- Atomicity smoke: a claim written by `kosmos_claim_machine` is a single well-formed line.
Register in `package.json` `test:shell`.

## Decision record (for the card)
- **Call:** build the claim ON cut-guard.sh's proven marker+cookie+dead-pid patterns, add time-expiry
  + a gate-refuse; wire release.sh (hold) and run-tests.sh (the every-agent gate that now refuses).
- **Rejected:** (a) a new independent lock lib (duplicates cut-guard's stale-holder/self-exclusion,
  which the header warns is the hard part). (b) making run-tests.sh WAIT rather than refuse -- the
  card's #4 control demands refuse, and a wait could hang an agent for a whole cut; refuse + a clear
  "until HH:MM" + the IGNORE override is lower-risk. (c) reusing the pid-only cut marker without
  expiry -- a hung-but-alive cut would park the fleet forever; the card explicitly wants self-expiry.
- **Weakest premise:** that per-step renewal keeps a healthy long cut claimed. If a single step legit
  runs longer than the window, the claim lapses and a foreign gate could start mid-cut. Mitigated by a
  generous default (30 min: no single release step approaches that; the whole build is ~17 min) and by
  the fact that the failure direction is safe (a released-too-early claim costs a contended run, not a
  corrupted release). Tunable via `KOSMOS_MACHINE_CLAIM_MINUTES`.
- **Blast radius:** run-tests.sh is every agent's pre-PR validation. The consult is FAIL-OPEN and
  cookie-excluded, so a broken claim file or a release's own child never refuses; only a live foreign
  unexpired claim does, which is the intended behavior. Covered by the test's fail-open + self-exclude
  arms.
