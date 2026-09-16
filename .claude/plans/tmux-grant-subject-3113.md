# Plan: #3113 - tmux Accessibility row stuck on "Checking..." forever (rebuild under #3075)

## Diagnosis (measured, not a redo of PR #3164)
#3113 was closed by PR #3164 (in 6.70) but Josh's 6.70 verification still shows "Checking..." and the
functional path never works. NOT a ship-gap (PR #3164 IS in 0.6.70) and NOT a regression. It is
INCOMPLETE: PR #3164 fixed the NOT-LISTED render (present:false -> "Not activated" + Turn On), but on
Josh's machine the route never reaches not-listed.

Root cause (= #3075 item 5), confirmed in code: /api/tmux-a11y-status -> a11ystatus.tmuxGrant() ->
create.binPaths().tmuxBin = `AGENT_WORKFORCE_TMUX_BIN || '/opt/homebrew/bin/tmux'`. The board also runs
as a launchd job (com.kosmos.board, RunAtLoad) that does NOT carry AGENT_WORKFORCE_TMUX_BIN, so on a
fresh Mac (no homebrew) binPaths resolves the wrong/non-existent homebrew path. tmux IS granted (the
BUNDLED tmux, screenshot-confirmed #3075 item 1), but its client path != the homebrew path, so `exact`
misses while `rows.some(granted)` is true -> the "a grant exists but not for our binary" cannot-check
branch -> checkable:false -> the neutral "Checking..." pill (which also hides Turn On, so the
functional path is unreachable -- Josh's 2nd point).

## Fix (Splinter-routed: option B, scoped to tmuxGrant, env-independent; do NOT perturb shared binPaths)
In engine/a11ystatus.js `tmuxGrant()`, resolve the BUNDLED tmux deterministically:
  1. opts.tmuxBin (explicit test override) wins.
  2. else the bundled tmux `$installedRoot/tmux/bin/tmux` (update.installedRoot() = $KOSMOS_HOME), if it
     exists -- the env-INDEPENDENT read that fixes the launchd-no-env case.
  3. else the shared, env-aware create.binPaths() (from-source board with no bundle).
Scoped to tmuxGrant's own read; binPaths (shared with agent creation) is untouched, per Splinter.
Keeps #3075 item 5's intent (read the bundled tmux's grant) and strengthens it (works even without the
env var). opts.installedRoot is the new test seam; the production cache is bypassed when it is injected.

## What finished looks like
On an installed board whose launchd process lacks AGENT_WORKFORCE_TMUX_BIN, tmuxGrant reads the BUNDLED
tmux's own TCC row: a granted bundled tmux -> checkable:true/trusted:true (green "Activated"); present
but off -> Turn On; not listed -> advisory. No path-key-mismatch "Checking..." while the bundled tmux
is actually granted.

## Change (agent-workforce)
- engine/a11ystatus.js: tmuxGrant resolves the bundled tmux via installedRoot before the binPaths
  fallback; cache-bypass when opts.installedRoot is injected.
- engine/a11ystatus.test.js: 5 new tests incl. THE REGRESSION (bundled granted + stray homebrew row ->
  green, not cannot-check), present-but-off, not-listed, and the opts.tmuxBin precedence seam.

## Not this PR (separate)
- #3188 (tmux FOLDER-access prompt not firing on first-run) is the sibling card, a different mechanism
  (the Access-step bg-agent must touch a protected folder AS the bundled tmux). Separate PR.
- Optional defense-in-depth (A: add AGENT_WORKFORCE_TMUX_BIN to the com.kosmos.board plist) is NOT in
  this PR -- B alone fixes Josh's report and A risks scope creep (Splinter's call).

## Verify (needs fresh-Mac TCC + Playwright -- Splinter routes the human/clean-box run)
On a real fresh-Mac install where the board runs as the launchd job:
  1. Complete onboarding to the Access/Automation step where the tmux Accessibility row shows.
  2. With tmux GRANTED in System Settings > Privacy > Accessibility, the row must read "Activated"
     (green), NOT "Checking...".
  3. With tmux NOT yet granted, the row must show "Not activated" + a working "Turn On" (not Checking).
  4. Clicking Turn On must fire the macOS Accessibility prompt / open the Accessibility pane so the user
     can grant tmux; the row then live-clears to Activated within a poll tick of the toggle.

## Weakest premise
That the board's launchd process is the one dropping AGENT_WORKFORCE_TMUX_BIN (vs some other env-loss
path). Either way option B is env-independent, so it fixes the class regardless of which launch path
lost the var. The bundled tmux path is $installedRoot/tmux/bin/tmux (update.js:456 layout); if a future
bundle relocates tmux, this resolution and install/kosmos's $_bundled must move together.
