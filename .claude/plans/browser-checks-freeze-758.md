# tools/browser-checks.sh freezes its own tree, closing the general form of the render-reload-toast bug (#758)

Branch `browser-checks-freeze-758`. Follows `toast-engine-pin-758` (kosmos#813, merged), which fixed the ONE check that was visibly failing; this fixes the class Splinter named it as: "every browser check runs against a checkout that other agents are merging into while it runs."

## What happened, and the scope this closes

`tools/browser-checks.sh`'s `boot_board` launches `node server.js` with only DATA directories sandboxed (`AGENT_WORKFORCE_DATA`/`WORKERS`/`LAUNCH`/`PROJECTS`) -- the CODE is read straight from `$REPO`, which resolves to wherever the script was invoked from. `server.js`'s `engineFreshness()` legitimately reports staleness the moment any required file's mtime moves past process start, so if the checkout it's reading from gets touched by a concurrent merge while the board is up, the board's own self-reported freshness flips underneath every check that shares it.

**This is already closed for a real release cut.** `tools/release.sh` freezes a detached worktree at the bump sha (`tools/lib/release-freeze.sh`, #597/#611) and reassigns `REPO="$BUILD"` (line 134) BEFORE invoking `browser-checks.sh` (line 168, `cd "$REPO" && bash tools/browser-checks.sh`) -- so `browser-checks.sh`'s own `REPO="$(cd "$(dirname "$0")/.." && pwd)"` already resolves to the frozen tree during an actual release, and `boot_board` is already isolated there. That's why the 0.5.25 release gate ran render-reload-toast clean.

**It is NOT closed for a direct invocation.** Mona Lisa's red run was `bash tools/browser-checks.sh` run directly against the shared, mutable checkout (not through `release.sh`), which is exactly what an agent does to check page-layer work before committing. That path has no freeze at all, and it's what this fixes.

## What changed

`tools/browser-checks.sh`, right after `REPO` is first resolved:
- Detects whether it's already running from a detached-HEAD tree (`git -C "$REPO" symbolic-ref -q HEAD` fails) -- the signature of `release.sh`'s own freeze. If so, it is ALREADY isolated: no second freeze, no behavior change, no added time on the path that is already time-pressured (a 25-minute cut).
- Otherwise (a normal branch checkout -- the vulnerable case), sources `tools/lib/release-freeze.sh` and calls `release_freeze` on its OWN current HEAD sha, reassigns `REPO` to the frozen worktree, and registers `release_thaw` in the existing `cleanup()` EXIT trap (which already removes `RUN_DIR` and kills server pids -- one more line, not a new trap).
- **Loud, not silent, about the one real behavior change**: if the source checkout has uncommitted changes at the moment of freezing, prints a clear line naming that the run will test the LAST COMMIT, not the working tree -- this file's own stated philosophy ("a page gate that cannot find a browser and passes anyway... block by default") applies here too. Before this change, a direct run always saw uncommitted edits; after, it only does when the checkout happens to be clean already. An agent iterating on an uncommitted page change and expecting to see it in the check needs to know why they didn't.

## Finished when

- Run normally (clean checkout, no concurrent merge): behavior and pass/fail results are unchanged from before this branch.
- **The inverted control (Splinter/Ice Cream Kitty's suggestion, the same shape as `toast-engine-pin-758`'s reproduction, run in reverse):** boot the suite, touch a required file in the SHARED checkout mid-run, and confirm the FROZEN board's `/api/status` does NOT report itself stale -- proving the freeze actually holds, not just that it was added.
- A dirty source checkout prints the loud warning and still runs (against the last commit), rather than silently testing something other than what a caller thinks it is testing.
- `release.sh`'s own path (already frozen) is unaffected: detected and skipped, not double-frozen.

## Not in this change

Deciding which of the 27 unwired checks belong in the release gate (#812's other half) -- that decision is more informative once run against an isolated tree, which is why it comes after this.
