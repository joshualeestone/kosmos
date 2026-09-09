# #2587 - sleep step "Continue anyway" escape for the unsatisfiable-laptop case

Branch `sleep-gate-escape` off origin/main b9a72802 (v0.6.51 bump). web/index.html first-run gate lane (mine; same S3 Automation screen as #2451/#2559). CRITICAL onboarding blocker (Nick, first outside tester).

## Verified diagnosis (against the code, settles detection-vs-by-design)
NOT a detection bug. `engine/machine.js sleepCheck()` parses `pmset -g custom` and reads BOTH AC Power and Battery Power sections. A laptop with AC-sleep off (user set it) but battery-sleep on lands in the `battery && batterySleep > 0` branch (acSleep 0) -> `state: STATE.ATTENTION`, title "This computer keeps working plugged in, and sleeps on battery." The first-run sleep gate maps ATTENTION -> red "Not activated" -> Next locked. macOS has NO never-sleep-on-battery setting, so no click (incl the gold "Turn On", which just opens the Energy pane) can turn it green on a laptop. Wall with no door.

## What finished looks like
On the first-run sleep step, when (and ONLY when) the sleep gate is in the unsatisfiable-laptop state (plugged-in-fine, sleeps-on-battery), the user gets an honest note + a "Continue anyway" control that unlocks Next. It does NOT flip the step to green/ACTIVATED (state beats a message - it is honestly still not-activated; show "continued, with a caveat"). A fixable desktop (goes to sleep on AC, `acSleep > 0`) is UNAFFECTED: no escape, Turn On still fixes it, gate still gates. Verified by node test + browser-check + challenge-loop.

## Mona's final copy (authoritative, use verbatim; she owns/refines)
- Button label: **Continue anyway**
- Note (shown ABOVE the button, ONLY in the plugged-in-fine / sleeps-on-battery case):
  "Your agents keep working while this Mac is plugged in and open. They pause when it sleeps or you close the lid, and on a laptop macOS gives no way to stop that on battery. For overnight work, leave it plugged in and open."
- Placement rules from Mona: (1) note ABOVE the button (read the tradeoff before clicking past); (2) do NOT turn the step green/ACTIVATED on Continue - show it as "continued, with a caveat", not a false pass (state-beats-a-message).

## Key design constraints
- The escape must appear ONLY for the UNSATISFIABLE state, never for a fixable desktop (where Turn On works and the gate should still gate). Distinguishing the two `state:'attention'` sub-states must NOT be a title string-match (fragile). Likely add a minimal ADDITIVE field to machine.js sleepCheck's unsatisfiable-laptop branch (e.g. `fixable:false` / `battOnly:true`) - machine.js is Renet's module, so coordinate/flag Renet (additive, low-risk). Confirm via the Explore map whether the web already has a clean signal.
- Continue advances Next WITHOUT setting data-granted on the sleep gate (no false green). Next's gate condition must accept "sleep gate continued" as a distinct, honest pass.
- #1720: web/index.html change needs a net browser-check assertion. Extend/author a check driving the sleep-gate laptop state -> asserts the escape shows + Continue unlocks Next + the step is NOT shown as green. Node test for the gate logic. Full suite + challenge-loop. LITERAL cd gh pr create.

## Interim (already told the room): Nick keeps it plugged in + open; that is all the step guards.
