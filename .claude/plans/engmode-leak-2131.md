# #2131 - Terminal/agent pane leaks onto Projects + conversation with Engineering mode OFF

## The bug (Josh, live test v0.6.28, screenshots in #admin 1545465657188028446)
Part 1: the terminal / agent-terminal state shows on the Projects screen (bottom) and the
conversation tab even though Engineering (Advanced) mode is OFF. It should be gated on
Engineering/Advanced mode.
Part 2 (no UI to answer a blocked Claude Code prompt): LARGELY RESOLVED by #2129's
trust-folder auto-accept. So this card is really just Part 1, the gating leak.

## Mechanism (investigated in web/index.html)
- Engineering mode is the page-wide flag `ENG_ON`, read from `/api/engmode` (`refreshEngMode`,
  ~15678). Applied by `pjApplyEngMode()` (~15964).
- `pjApplyEngMode` gates the SINGLE-PROJECT raw terminal container `.pj-viewport`
  (`vp.hidden = !ENG_ON`) and the one-to-one box `#pj-thread`. So the single project page's
  terminal IS correctly hidden in Off.
- The terminal TEXT element is `.pj-screen`. It renders in THREE contexts:
  1. inside `.pj-viewport` -> gated (hidden in Off). Correct.
  2. inside `.pj-question` (the question panel) -> DELIBERATELY stays visible in Off
     ("safety, not chrome", ~15972): when an agent is WAITING on an answer you must see the
     terminal to answer it. `pjApplyEngMode` explicitly does NOT hide the question panel.
  3. inside `.qask` (the detail/conversation question-ask; `.qask .pj-screen`, ~3983).

## The likely leak + the SAFETY CONSTRAINT
The leak is a `.pj-screen` surface showing on the Projects screen / conversation tab in a
NON-question context (no agent is asking) while `ENG_ON` is false. Candidates: the `.qask`
detail surface, or a navigation path that shows a viewport/screen without calling
`pjApplyEngMode`.
🛑 The fix MUST NOT hide the question panel (`.pj-question`) in Off - that panel is
safety-critical (it is how a waiting agent gets answered) and is intentionally exempt from
the eng-mode gate. So the fix is narrow: gate the CHROME terminal surfaces (the ones showing
when nobody is asking) on `ENG_ON`, exactly as `.pj-viewport` is, WITHOUT touching the
question-panel exemption.

## Next step (reproduce from the system, do not ask for the screenshots)
Boot the board (server.js in-process, like docs/browser-checks/render-a11y-gate-2125.js),
install a fake agent whose state carries terminal/screen content but is NOT asking a question,
set eng-mode OFF, navigate to the Projects screen + the conversation tab, and assert the
terminal (`.pj-screen`/`.pj-viewport`) is NOT visible - while a SEPARATE arm with an agent
that IS asking confirms the question panel STAYS visible (the safety control). That repro pins
the exact leaking element; the fix gates it on `ENG_ON`; the check becomes the browser-check.

## Deeper finding: the detail/conversation view
- `#d-qask` (~6426, a `.qask`, hidden by default) is the DETAIL view's question-ask; its
  `#d-qask-text` is a `.pj-screen` shown when an agent in the detail/conversation view is
  asking. Safety-when-asking, like the project question panel - must STAY in Off.
- The detail thread paint already reads `ENG_ON` for the "Its whole screen is below."
  pointer (~32233), so the detail view knows the flag.
- So both the project and detail views have (a) a safety question terminal that stays in Off
  and (b) chrome viewport/screen surfaces gated on ENG_ON. The leak is a chrome surface on
  the Projects screen / conversation tab that is NOT gated (or a nav path that shows it
  without re-applying the gate). The repro below pins WHICH.

## Worktree
engmode-leak-2131 (off origin/main). Frontend-only, browser-test-verifiable here (no
fresh-install needed).

## Status 2026-09-04 ~22:45: mechanism mapped, reproduction is the next build step.
Next: write a server-boot browser-check (model on docs/browser-checks/render-a11y-gate-2125.js)
that installs an agent carrying viewport/screen state but NOT asking, eng-mode OFF, navigates
to Projects + the conversation/detail tab, and asserts the terminal is hidden; a sibling arm
with an ASKING agent asserts the question panel STAYS (the safety control). That pins the leak;
gate it on ENG_ON; the check ships as the browser-check.

## Reproduction state injection (from test-support/fleet.js)
- `fleet.agent(name, { state: 'working', screen: '<terminal text>' })` = the CHROME case:
  a working agent with terminal output that should be HIDDEN in Off. This is the leak arm.
- `fleet.agent(name, { state: 'needs_you', ... })` = the SAFETY case: an asking agent whose
  question panel must STAY visible in Off. This is the control arm.
- Harness: set the sandbox env vars, `fleet.install([...])`, `srv.start(0)`, navigate to the
  project page + the agent detail/conversation view, read `.pj-viewport`/`.pj-screen`
  computed visibility with ENG_ON false, and assert chrome hidden + question-panel shown.
- Open question for the repro to answer: which render path shows the terminal WITHOUT the
  ENG_ON gate (a project-page path missing pjApplyEngMode, or the detail/conversation view's
  own screen surface). Then gate exactly that path on ENG_ON.

## OUTCOME 2026-09-04 ~23:15: bug does NOT reproduce on current main -> shipping a regression guard
Controlled server-boot browser probe (a working agent + a project, eng-mode toggled):
- eng-mode OFF: .pj-viewport, #pj-thread, and the detail #d-window are ALL hidden, on both
  the project page and the agent-detail/conversation view.
- eng-mode ON (the CONTROL proving the probe can see the terminal): .pj-viewport + #pj-thread
  become VISIBLE.
So eng-ON shows the terminal and eng-OFF hides it - the gating is correct on current main. The
reported v0.6.28 leak is already fixed (the eng-mode gating was hardened by #370/#965/#2047
since). Same class as the stale-card / stale-worktree bug filings.

Decided (not building a speculative fix against fixed code): ship a REGRESSION GUARD instead.
docs/browser-checks/render-engmode-gate-2131.js asserts eng-OFF hides the terminal on both
views, the eng-ON control makes the SAME elements visible (so OFF is not vacuous), and the
SAFETY arm pins the exemption the fix must never break (an ASKING agent keeps #d-qask visible
in Off). 8 checks, a population floor, wired into browser-checks.sh + README. #2131 can be
verify-and-closed on the next fresh 0.6.31 build. No web/index.html change (nothing to fix).
