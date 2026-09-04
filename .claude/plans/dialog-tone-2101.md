# Plan: non-hostile rewrite of the self-update dialog (#2101)

Branch: `dialog-tone-2101`. Card: kosmos#2101. Lane: design/content (Mona Lisa).
Coupled but SEPARATE from #2094 (Kitty's code fix, in a PR): #2094 makes relaunch target the fresh
/Applications copy so this dialog fires far less; #2101 is the tone for when it legitimately does.

## Goal

The escalated self-update dialog (`native-app/main.swift`, `showCannotSelfHeal`) no longer reads as
hostile or a dead-end. Josh's literal read of the old copy: "This app cannot update itself. Screw
you, click this button."

## Why the old copy stung

- Headline "This window cannot update itself" states an inability (dead-end).
- "Opening it again has already been tried and did not change that, so Kosmos will stop asking"
  reads as "we give up on you."
- "Installing Kosmos again is what replaces this window" is vague, names no concrete how.

## The rewrite (facts kept, framing changed)

- messageText: "This window is on an older version of Kosmos" (a calm fact, not the hostile
  "cannot update itself").
- informativeText: keeps the honest version facts (\(mine) vs \(theirs)) and the true reassurances
  (agents kept running, nothing needs signing in to again); states plainly that reopening did not
  move it; names the ONE reliable action (download the latest from installkosmos.com and open it).
- Button unchanged ("Keep Working") -- a genuine OK, not a dead-end, once the copy is calm.

## Why the action is DOWNLOAD, not "open from Applications" (corrected by the challenge-loop)

My first draft said "open the up-to-date Kosmos from your Applications folder", reasoning from the
#2094 incident that a fresh /Applications copy exists. That was WRONG about the reachability, and a
blind review caught it. #2094 IS merged (PR #2103, in this base): `offerRelaunch` now relaunches
`freshAppURL` (the /Applications copy). So the case where a fresh copy exists SELF-HEALS on relaunch
and never reaches `showCannotSelfHeal`. This dialog fires only when a relaunch came back to the SAME
version (`staleAdvice == .cannotSelfHeal`), i.e. `freshAppURL` was nil or the /Applications copy is
itself stale -- there is NO fresh copy reachable. Telling the person to open Applications would tell
them to repeat the action that just failed, and asserting "a newer Kosmos is ready" would be false.
The design rules at main.swift:1305-1329 already state this dialog must PROMISE NOTHING and NAME NO
CAUSE (make_app's failure is indistinguishable from inside the app). Downloading the current build
always works regardless of the cause, so it is the honest, reliable action for this exact state.

## Out of scope

`offerRelaunch` (the non-escalated dialog) is already calm and offers "Quit and Open Again"; the
card targets the escalated one. Not changing the reload/relaunch LOGIC (that is #2094).

## Test plan

Copy-only Swift change; button spec untouched. Validated by compiling main.swift with swiftc and
running `--kosmos-app-selftest` (the harness build-kosmos-bundle.sh runs): compiles clean, selftest
"kosmos-app selftest ok". No em dashes. The node/shell suite does not compile main.swift, so the
swiftc+selftest is the meaningful gate; not a web/ change, so the #1720 browser-check gate does not apply.
