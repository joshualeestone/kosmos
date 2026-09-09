# #2587 - the first-run sleep step is ADVISORY (never gates Next)

Branch `sleep-gate-escape` off origin/main b9a72802 (v0.6.51 bump). web/index.html first-run gate lane (mine; same S3 Automation screen as #2451/#2559). CRITICAL onboarding blocker (Nick, first outside tester).

## PIVOT (Josh's ruling in-channel, 2026-09-09 ~13:34 CDT; Mona synthesized + routed to me)
This branch first built a laptop-only "Continue anyway" ESCAPE (converged over 4 blind passes) - then Josh ruled the simpler thing: **do not gate Next on the sleep permission at all**. "Just hit the Next button on that screen and not get stuck." So the escape/button is REMOVED; the sleep step is now ADVISORY (never disables Next) for everyone. The honest note STAYS as information (Mona). Accessibility/tmux STILL gates (my scope call, Splinter-endorsed: sleep is unsatisfiable-on-laptop so gating traps users; Accessibility is satisfiable + required so gating is correct). No forcing flag on other pages (Josh decided against). The Settings box->rules styling is a SEPARATE card #2592 (not this branch). Sleep is already in Settings > This computer (Mona confirmed) - no Settings work here.

## Verified diagnosis (against the code, settles detection-vs-by-design)
NOT a detection bug. `engine/machine.js sleepCheck()` parses `pmset -g custom` and reads BOTH AC Power and Battery Power sections. A laptop with AC-sleep off (user set it) but battery-sleep on lands in the `battery && batterySleep > 0` branch (acSleep 0) -> `state: STATE.ATTENTION`, title "This computer keeps working plugged in, and sleeps on battery." The first-run sleep gate maps ATTENTION -> red "Not activated" -> Next locked. macOS has NO never-sleep-on-battery setting, so no click (incl the gold "Turn On", which just opens the Energy pane) can turn it green on a laptop. Wall with no door.

## What finished looks like (post-pivot)
The first-run sleep step never gates Next: `FR_GATES.sleep` carries `gatesNext:false`, and `frPollGates` only lets a blocked row disable Next when its spec is NOT `gatesNext:false`. So a laptop that sleeps on battery, a desktop that sleeps, or anyone who has not set it can all hit Next; the sleep row stays advisory (Turn On + status for those who want it). On the laptop (battOnly) row the useless Turn On is replaced by the honest note (info only). The Accessibility/tmux gate is unchanged (still disables Next until granted). No "Continue anyway" button, no data-continued. Verified: node test (gatesNext:false, only sleep advisory, no escape markup/handler/CSS), browser-check (blocked sleep -> Next enabled; Accessibility still gates; desktop advisory too), full suite, challenge-loop.

## Mona's copy (she owns wording; refinements below approved by her)
- Post-pivot: the "Continue anyway" BUTTON is REMOVED (Next just works). Only the note remains, as info.
- Note (shown on the laptop / plugged-in-fine, sleeps-on-battery case, in place of the useless Turn On):
  "Your agents keep working while this computer is plugged in and open. They pause when it sleeps or you close the lid, and on a laptop macOS gives no built-in switch to stop that on battery. For overnight work, leave it plugged in and open."
- Two refinements from Mona's first draft, both APPROVED by her (not drift): "this Mac" -> "this computer"
  (the product voice, enforced by engine/machine.test.js's "no live sentence says this Mac" guard, and matching
  the sibling sleep strings); and "no way to stop that on battery" -> "no built-in switch to stop that on
  battery" (honest: there IS a Terminal command, `sudo pmset -a sleep 0`, which is Pete's agent-side Nick
  unstick, but no switch a non-technical person finds, and we deliberately do not send them to Terminal).
- Placement rules from Mona: (1) note ABOVE the button (read the tradeoff before clicking past); (2) do NOT turn the step green/ACTIVATED on Continue - show it as "continued, with a caveat", not a false pass (state-beats-a-message).

## Documented exclusion (iter1 review): the AC-UNREADABLE branch gets no laptop-note, deliberately
machine.js sleepCheck has a second STATE.ATTENTION branch (acSleep===null i.e. the AC/power-adapter section
could not be parsed, with battery sleeping). It is NOT given battOnly. Reason: the note promises
"plugged in it keeps working", which needs a CONFIRMED acSleep===0; an unreadable AC section cannot confirm
it, and unlike the battery-only case that branch still shows "Turn On" (the Energy pane may hold a real AC
fix). A user there resolves the unreadable AC first; if a battery-only sleep then remains, the confirmed
branch shows the note. Rare in practice (pmset almost always prints a readable AC section). Commented at
the branch in engine/machine.js. (Either way the sleep step never gates Next -- this only selects note-vs-TurnOn.)

## Key design constraints
- The sleep step NEVER gates Next (advisory) for anyone (FR_GATES.sleep gatesNext:false); only genuinely-satisfiable gates (Accessibility/tmux, file access) gate. The laptop NOTE appears ONLY for the UNSATISFIABLE (battOnly) state, never a fixable desktop (which keeps Turn On). Distinguishing the two `state:'attention'` sub-states is a machine.js ADDITIVE field (battOnly), not a title string-match.
- No false green: data-granted is set only on the granted state, and battOnly rows are prevented:false, so the sleep row never reads Activated. No "Continue anyway" button / data-continued (removed in the pivot).
- #1720: web/index.html change carries a net browser-check assertion (render-gated-next.js): a blocked sleep row does NOT gate Next, Accessibility STILL gates, the laptop note shows for battOnly, a fixable desktop is advisory too. Node test for the gate logic. Full suite + challenge-loop. LITERAL cd gh pr create.

## Interim (already told the room): Nick keeps it plugged in + open; that is all the step guards.
