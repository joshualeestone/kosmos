# prepushbc-7192: run the two browser-check gates before a push (kosmos#7192)

Owner: Ice Cream Kitty (night-shift card, mod 7 == 3).

## Change
- `.githooks/pre-push` (bash): for a push that sends the checked-out branch, and only when that branch changes web/
  against origin/main, runs `kosmos_browser_check_gate` (#1720) then `kosmos_browser_check_surface_gate` (#2518),
  each sourced in a subshell exactly as tools/run-tests.sh does. A red gate refuses the push with the gate's own message
  and one line naming which gate; `git push --no-verify` skips it once.
- `tools/test-prepush-gates-7192.sh`, added to `test:shell`.
- CLAUDE.md's `.githooks/` row names the new hook.

## Decided
- Only the checked-out branch: both gates read origin/main...HEAD, so checking another pushed ref against HEAD would
  judge the wrong change. Another branch is left to CI.
- The web/ pre-check: a branch with no web/ change pays one `git diff --quiet` and nothing else.
- Same functions as run-tests.sh, not a copy, so the hook and CI cannot disagree.
- bash, not sh: the gate libraries are bash.

## The card's premise, measured
`core.hooksPath` is `.githooks` on this Mac's `~/work/agent-workforce` (worktrees inherit it). The existing hooks say to
wire it once per clone; this one is under the same line. A clone without it pays nothing and is caught by CI as today.

## Weakest premise
That the gates stay fast. Today they are git and grep over the branch's diff; a future gate that grows slower would make
every web/ push slower too.

## Checks
- tools/test-prepush-gates-7192.sh, in a throwaway repo with an origin: no web/ change passes; the coarse gate refuses a
  bare web/ change and names itself (CONTROL: trailers pass); the surface gate refuses a token change whose owning check
  was not updated (CONTROL: updating that check passes); a push of another branch is not checked against the checkout
  (CONTROL: the checked-out bad branch is refused).
- Mutations, each red: checking the checkout instead of the pushed branch; not running the gates.

## Iteration 3 (sonnet)
- W1 a stale local origin/main counted other people's newer web/ commits as this branch's and refused a push CI would
  pass -> FIXED: one quiet `git fetch origin main` before the gates (a failure, offline, leaves the ref as it was).
  Test: a branch rebased onto a main this clone has not fetched, changing only a README; the arm fails without the
  fetch (measured: mutant red) and a control asserts the hook moved origin/main. The first version of that arm gave
  the other person's commit its own trailers, so it passed with or without the fetch; caught by the mutation.
- W2 a wip/ backup push of unfinished web/ work was refused -> FIXED: a push to refs/heads/wip/* is not checked
  (test, mutant red). A tag at HEAD stays checked (iteration 1's decision).
- N3 a gate that crashes and a gate that refuses both block -> accepted: it happens only on a broken checkout, and
  blocking there is the safe direction.
- N4 untested shapes -> the stale origin/main is now tested; outside a work tree exits 0 (fail-open, by design).

## Iteration 4 (opus)
- W1 the fetch could prompt for a password or key mid-push, or stall -> FIXED: GIT_TERMINAL_PROMPT=0, ssh BatchMode,
  and http.lowSpeedLimit/Time so a stalled connection gives up.
- W2 every push of HEAD paid a fetch -> FIXED: diff first against the base as it is (a stale base only over-counts, so
  clean there is clean fresh), fetch only when that diff shows web/ changes, then diff again (test: no fetch on a
  no-web/ push; mutant red).
- W3 a failed fetch (offline, or another worktree's fetch holding the shared ref) was silent, and a stale-base refusal
  read as the branch's fault -> FIXED: the refusal adds that origin main could not be fetched and the base may be
  behind (test with origin unreachable; mutant red).
- N4 an annotated tag at HEAD arrives as the tag object's id and slipped past -> FIXED: peeled to its commit (test with
  a control that the tag is its own object; mutant red).
- N5 a --dry-run push also fetches -> accepted: a hook cannot tell a dry run, and a fetch moves only the tracking ref.
- N6 the hook hard-coded origin/main while the gates honour KOSMOS_BCG_BASE -> FIXED: the same base; the fetch runs
  only for origin/main.
- N7 no test for a wip/ ref beside the real branch -> added.
