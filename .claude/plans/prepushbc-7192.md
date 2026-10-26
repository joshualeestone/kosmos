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
