# cut-3b-render-fixes -- unblock the 0.6.56 staging cut (two STALE render checks)

## Why
Baron's 0.6.56 STAGING cut (frozen sha a334c5b2) aborted at step 3b on two render checks in my
lane. Both reproduced deterministically (light+dark, low load), so real, not flake. Diagnosed
against origin/main @ a334c5b2: BOTH are STALE checks (the product changed deliberately and the
checks were not updated), NOT regressions. No product fix and no styles-card author needed.

## Fix 1: render-prompter-label-1843 (STALE expected copy)
The check hard-coded the Prompter slider's expected aria-label as
'Ask me to check on any agent that has stopped'. The product now renders aria-label
'Check on your agents' -- a deliberate change in commit 006a962b (#2632/#2771: "Prompter toggle
copy no longer promises an undeliverable nudge"). The new name is descriptive and MATCHES the
visible <b>Check on your agents</b> label, so it is a proper accessible name, NOT an a11y
regression (the slider did not lose its name). Fix: update the expected string to
'Check on your agents' (+ a comment recording #2632/#2771).

## Fix 2: render-pj-clear-2575 (STALE -- control moved to Engineering-mode-only)
The check opened a project in the DEFAULT (Engineering-off) view and expected the
"Not waiting? Clear it" button reachable. It failed with hit=false and page.click timeout.
Root cause (measured by walking the button's ancestor chain): the button is NOT covered -- it has
a 0x0 box because its ancestor #pj-thread is display:none. That is DELIBERATE: #2691 (Josh
2026-09-10) moved the clear control into the Engineering-mode-only #pj-thread box
(pjApplyEngMode sets `box.hidden = !ENG_ON`). The sibling render-engmode-gate-2131 already asserts
#pj-thread is hidden in Off and visible in On, confirming the intended behaviour. A real
default-view user does not see the clear button by design (a waiting agent is signalled in the
roster and answered via the detail view #d-qask).
Fix: the check now (a) stubs /api/engmode -> {on:true} and (b) after the question paints, enables
Engineering mode through the app's own refreshEngMode()/pjApplyEngMode() and waits for #pj-thread
to be visible, before the reachability + click scenarios. This preserves the check's full intent
(paint -> click -> loadThread wiring of the clear control) in the mode where the control now lives.
All 17 assertions pass headless.

## Verification
- render-prompter-label-1843: HEADED=0 run green (light + dark).
- render-pj-clear-2575: HEADED=0 run green (all 17).
- Blast radius: grep of docs/browser-checks confirms no OTHER check asserts the old prompter aria
  or the default-view clear button, so no sibling reds next at 3b.

## Weakest premise
That the cut's 3b step runs the same code path these standalone HEADED=0 runs exercise. Mitigation:
both checks are in the no-board driver loop and the run is deterministic; the standalone green is
the same assertion set 3b runs. What would change my mind: 3b redding on either after this merge
(then re-diagnose against the actual 3b invocation).

## Steps
1. Fix both checks. [done]
2. challenge-loop to convergence; proof file.
3. PR to joshualeestone/kosmos (literal cd; no --reviewer; no em dash).
4. CI green -> squash-merge -> tell Baron so he re-cuts 0.6.56 -> remove worktree.
