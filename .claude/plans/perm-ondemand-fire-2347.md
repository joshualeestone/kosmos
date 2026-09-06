# #2347 (Josh's 0.6.41 re-test, item A): a11y prompt fires at launch, not on-demand

## The problem (Josh's 0.6.41 fresh-install re-test)
After #2371 fixed the bundled-tmux path (so the under-tmux hatches actually fire), the a11y
permission prompt now fires at LAUNCH -- the first thing Josh sees on install, BEFORE the
Access screen. It must fire ON the Access-screen Allow (on-demand). It also cascaded: the
launch fire activated accessibility at install time, so the later Access-screen tmux step read
"Activated" and Josh skipped the Turn-On flow.

## Root
`native-app/main.swift` `startA11yTrustChecks()` (called at applicationDidFinishLaunching) fired
a once-at-launch `--kosmos-app-axprompt` when not-trusted. Pre-#2371 the wrong tmux path made
`spawnAxHatchUnderTmux` skip silently, so no launch prompt ever appeared. #2371 fixed the path,
so the launch axprompt now actually fires -- at the wrong time.

## The fix
Remove the launch-time axprompt from `startA11yTrustChecks`. The a11y prompt now fires ONLY
on-demand: the Access-screen tmux Turn-On POSTs `/api/a11y-prompt` -> `startPromptRequestWatcher`
fires the axprompt hatch then. Kept the launch axCHECK (it only READS trust via AXIsProcessTrusted
-- no prompt -- and writes a11y-status.json for the first-run Continue gate to poll) + its 60s
timer. Removed the now-dead `a11yPromptFired` flag and `currentlyTrusted()` (they existed only to
decide the one-shot launch prompt; the on-demand axprompt is benign if already trusted -- macOS
no-ops it -- so no pre-check is needed). File-access already fired on-demand only, so it is
unchanged.

## Tests
native-app.a11y-writer-2125.test.js:
- "runtime wiring spawns axcheck UNDER tmux (launch + timer) and does NOT prompt at launch
  (#2347)": re-anchored the slice end (currentlyTrusted is gone) to startPromptRequestWatcher,
  and added an assertion that the axprompt CALL form (hatch: "--kosmos-app-axprompt") is gone
  from startA11yTrustChecks -- matched on the call form, not the bare string, so the explanatory
  comment's prose mention of axprompt does not trip the guard.
- Removed the two tests whose subjects were deleted (the one-shot launch prompt + currentlyTrusted
  freshness). The on-demand axprompt firing is covered by native-app.perm-prompts-2189.test.js
  (the watcher consumes the a11y request and fires the axprompt hatch under tmux) -- still green.
Swift typechecks clean; native suite green (28 tests across a11y-writer + perm-prompts +
instance-guard).

## Verification tiers (same posture as #2371)
- TIER-1 (done): source wiring pinned (launch fires only axcheck, not axprompt; on-demand path
  intact); Swift typecheck; native tests green.
- TIER-2 (Josh's fresh-account re-test): the a11y prompt appears on the Access-screen tmux
  Turn-On (not at launch), and the tmux step reads "Needs Activated" (cascade resolved). Baron
  holds the cut; this rides the next re-test.

## Scope note
This is item A (fire-timing) of Josh's 0.6.41 re-test. Item B (KOSMOS-vs-TMUX identity: the a11y
prompt is labelled KOSMOS because the Accessibility API reports the CALLING binary -- the
kosmos-app -- while file TCC uses the responsible process = tmux) is a SEPARATE, larger rework
(#2125/#2188): the definitive answer (the correct identity is tmux, the KOSMOS label is the bug)
was reported to Splinter/Josh; the fix rides that rework, not this PR.
