# #2347 REOPEN (#1/#2189) - native under-tmux hatches never fire on a real install (tmux path bug)

## The problem (Josh's 0.6.40 fresh-install re-test)
Spec: Josh-Brain/Projects/kosmos-0.6.40-install-flow-retest-feedback-2026-09-06.md.
The real macOS permission prompts do NOT fire when Josh clicks "Allow Access" on the
Access screen; they only fire later at Add-Agent -> Import. Everything cascades: Next
can't gate, the tmux Accessibility pane never pops, find-agents finds nothing, both
agents end unusable.

## Root cause (MEASURED on a real install, no TCC / no fresh account needed)
The native app resolves the bundled tmux at the WRONG path. `spawnAxHatchUnderTmux`
(native-app/main.swift) guarded on `kosmosHome + "/bin/tmux"`, but the bundle stages
tmux at `<kosmosHome>/tmux/bin/tmux` (install/kosmos exports PATH="$KOSMOS_HOME/tmux/bin";
build-tmux-bundle.sh stages the binary at <bundle>/bin/tmux where <bundle> = $KOSMOS_HOME/tmux).
`<kosmosHome>/bin` holds only `kosmos`.

Measured on `/Users/agent1/.local/share/kosmos` (real install):
- `$H/bin/tmux`        -> NOT executable  (where the native app looked)
- `$H/tmux/bin/tmux`   -> executable, tmux 3.5a  (where the bundle actually puts it)
- `$H/bin/kosmos`      -> executable  (CONTROL: kosmosHome resolves right; bin/kosmos works, bin/tmux does not)

So the guard `isExecutableFile("<home>/bin/tmux")` is FALSE on EVERY real install ->
spawnAxHatchUnderTmux logs "no bundled tmux; skipping" and NEVER fires ANY under-tmux
hatch:
- `--kosmos-app-axprompt` never fires -> tmux never added to the Accessibility list -> #3
- `--kosmos-app-axcheck` never fires -> a11y-status.json never written ->
  promptrequest.nativePresent() false -> the on-demand a11y + file-access fires fall back
  to opening Settings -> #1/#4
- `--kosmos-app-fileaccessprompt` never fires -> no folder prompt on Allow Access -> #1/#4
- At Import the AGENTS resolve tmux CORRECTLY (tmux/bin via PATH / AGENT_WORKFORCE_TMUX_BIN),
  so natural access fires the prompt there -> exactly Josh's "only at Import" symptom. Two
  tmux resolutions; only the native one was wrong.

## Why it slipped (the 0.6.40 miss in one sentence)
The native tests used a controlled KOSMOS_APP_TEST_HOME with tmux placed where they
expected it, and a dev box has Accessibility/Full-Disk granted broadly, so the real
install layout was never exercised. Mocks and dev boxes cannot see a wrong path that only
matters against the real bundle.

## The fix
`resolveBundledTmux(kosmosHome:)` resolves tmux the same way the rest of the system does:
`AGENT_WORKFORCE_TMUX_BIN` override first (matches agent creation + test seams), then the
bundle's real path `<kosmosHome>/tmux/bin/tmux`. `spawnAxHatchUnderTmux` uses it; the
hardcoded bare bin/tmux path is gone. Fail-safe unchanged: no candidate -> skip -> the
first-run gate stays fail-safe.

## Tests (the load-bearing part - the guard whose absence let a path-no-install-has ship)
native-app.perm-prompts-2189.test.js, added:
- resolveBundledTmux resolves the bundle's REAL path (tmux/bin/tmux) and honors
  AGENT_WORKFORCE_TMUX_BIN.
- spawnAxHatchUnderTmux resolves via resolveBundledTmux AND the exact bad code literal
  (kosmosHome + bare bin/tmux) does not appear anywhere in the source (regression guard;
  the one comment that names it spells it in prose, not as the code literal, so the guard
  is not tripped by its own documentation).

## Verification - two tiers (per Splinter)
- TIER 1 (done, warm box, no TCC): the guard = isExecutableFile = `test -x`. Measured:
  OLD path NOT executable (skip = the bug), NEW path executable tmux 3.5a (spawn = the fix).
  The fix flips the guard false->true on the real install, so the hatches now SPAWN. This
  IS the defect proof.
- TIER 2 (pending, Splinter to stand up a fresh macOS test account; fire-only, no accept,
  no human needed to accept): confirm the prompt VISIBLY appears on Allow Access, and the
  deeper #2125 attribution unknown (does the under-tmux re-exec attribute to tmux vs the
  app). Baron holds the cut until this passes. NOT needed to prove the root; it confirms
  the visual + attribution.

## Weakest premise (named, for tier 2 to measure)
Fixing the path makes the hatch SPAWN under the correct tmux (tier-1 proven). Whether the
resulting TCC operation is attributed to tmux (so agents inherit the grant) vs the
kosmos-app is the #2125 load-bearing unknown, and it is what tier 2 must confirm. If tier
2 shows attribution lands on the app rather than tmux, that is a SEPARATE follow-up
(attribution), not a regression of this path fix - this fix is necessary either way (no
hatch fires at all without it).

## Coordination
Renet's #2/#5/#4-flow gates read a11y-status.json / file-access-status.json. This fix is
what makes those files actually get WRITTEN on a real install (the axcheck/fileaccessprompt
hatches now run). Seam unchanged; his wiring reads the same files.
