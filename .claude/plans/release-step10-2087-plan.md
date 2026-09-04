# Plan: release.sh step 10 must be non-fatal (kosmos#2087)

Branch: `release-step10-2087` · Repo: joshualeestone/kosmos (local checkout `~/work/agent-workforce`)

## The bug (found by Baron Draxum cutting 0.6.27, 2026-09-03)

The 0.6.27 cut PUBLISHED successfully - step 8 deployed, step 9/9b-9e verified the
served bytes (latest.json, the pkg triple + checksum + notarisation, /setup) from
inside AND outside the network. Then it exited 1 at **step 10** ("the board on THIS
Mac, if it runs from this repo"):

```
THE LOCAL BOARD DID NOT COME BACK ON 0.6.27 WITHIN 45s (last answer: 'none')
```

The board recovered on its own moments later (it now serves 0.6.27). The 45s window
was just too short under the box's load. But `release.sh` runs `set -euo pipefail`,
so `bash tools/restart-local-board.sh` failing aborted the cut, and `cut_record_done`
wrote `outcome=failed step=_10._the_board_on_THIS_Mac served=1` - a misleading red on
a successful production publish, and a non-zero exit that can trip downstream
rollback/alerting.

## The call (the card gave two candidates; I decide)

**Option 1: make step 10 NON-FATAL.** By the time step 10 runs the artifact is live
and step 9 has verified it; step 10 is a post-publish, THIS-Mac-only convenience
(restart the developer's own board so it stops serving the previous code, #360). A
slow or stuck local board on the release machine is not part of "did we ship correct
bytes", so it must not mark a good publish failed. Chosen over option 2 (a
longer/retry window) because even a longer window can false-red under enough load,
and the deeper point stands: this check is post-publish and local. Option 2's
throttle pattern is #2044's lane.

## Scope decision
Non-fatal is applied **in a scoped wrapper for release.sh step 10**, NOT in
`restart-local-board.sh`, whose exit code its own test (`test-restart-local-board.sh`)
and any other caller still rely on. Changing that script's exit behaviour globally
would be a wider blast radius than the bug.

Step 11 (the installed-CLI refresh, a real #1758 fix) is DELIBERATELY still fatal -
it refuses on a stale install it cannot refresh, which IS a real defect. Only step 10
(the board) becomes non-fatal; making step 10 non-fatal also ensures step 11 now runs
even when the local board was slow (previously the set -e abort skipped it).

## Changes
- **`tools/lib/board-restart-nonfatal.sh`** (new, sourceable, the tools/lib pattern):
  `board_restart_or_warn <script>` runs the restart; on failure it WARNS loudly (the
  dev should check their own board) and returns 0, so the cut outcome reflects the
  publish. `bash "$script" || rc=$?` disarms the caller's set -e for exactly that
  command.
- **`tools/release.sh`**: sources the lib beside the other cut libs; step 10 calls
  `board_restart_or_warn "$MAIN_REPO/tools/restart-local-board.sh"` instead of a bare
  `bash`.
- **`tools/test-board-restart-nonfatal-2087.sh`** (new) + wired into `package.json`
  `test:shell` beside `test-restart-local-board.sh`.

## Tests / verification
- `tools/test-board-restart-nonfatal-2087.sh`: a success returns 0 with no warning; a
  FAILING restart returns 0 with a loud #2087 warning naming the exit code; **under
  `set -e` (as release.sh runs) the caller CONTINUES past a failing restart** (the
  control that can return the dangerous answer - reproduces release.sh's context);
  and a control that the helper actually INVOKES the script. ALL PASS.
  Perturbation-verified: reverting the helper to a bare `bash "$script"` reds the
  set-e arm ("the caller aborted on a failing restart"). `bash -n` clean on the lib,
  release.sh, and the test. `package.json` remains valid JSON.
- No test asserts release.sh's step-10 line content; frozen-roots runs on `engine`
  only, so the `tools/` change is not gated there.

## Rejected
- Option 2 (longer/retry 45s window) alone - can still false-red under load; the
  post-publish-local point is the real fix. Its throttle pattern is #2044.
- Making `restart-local-board.sh` itself non-fatal - wider blast radius; other
  callers and its own test trust its exit code.

## Weakest premise
A GENUINELY stuck local board (not just slow) now records `outcome=ok` with only a
loud warning, not a red. Accepted deliberately: the cut's outcome is about the
published artifact, which step 9 verified; a stuck THIS-Mac board is a local problem
the warning surfaces, and users self-update from the verified artifact regardless.
