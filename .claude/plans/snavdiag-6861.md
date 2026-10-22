# snavdiag-6861: render-snav-head-4979 names what hides the Settings nav on a timeout

Card: kosmos#6861 (nightly full browser-check run not green on main; claimed: icecreamkitty).

## Problem
The consolidated-view arm of docs/browser-checks/render-snav-head-4979.js times out on the CI runner in webkit only (the
`#s-nav button[data-go="mac"]` stays hidden for 20 s after the Settings link), at 1000px or 1280px, never locally. Four
reds so far. The Playwright timeout says only "resolved to hidden", so no red has said WHICH ancestor hides it.

## Decision
A diagnostic, not a fix. In the same evaluate as the Settings click (no added round-trip before it) the check starts
recording #panel-settings's `hidden` attribute (a MutationObserver with old values, one entry per change of state, `shown@ms` / `hidden@ms` from the click, timed per callback,
so a show and a re-hide in the same task are both kept). On that wait's timeout ONLY (a TimeoutError; anything else is
rethrown as itself), it fails with a short `<tag>: Settings nav hidden: {...}` so the driver's 200-character summary
keeps the first fields: `seq` (the first entry and the latest six when it runs long), then every hiding ancestor up to
#panel-projects, then
#panel-projects, whether the button exists and its size, #panel-settings's parent, which overlay holds the column, the
body classes and query string, the page errors this arm collected, and Playwright's own "resolved to" lines. The probe
has its own 5 s cap.

What it can tell apart: Settings never opened (`seq` never shows `shown`) from opened and hidden again (`shown@x`, then
`hidden@y`), a throw in the handler (`pageErrors`), a missing or zero-size button (`exists`, `rect`). It names the
mechanism, not necessarily the root cause behind it.

Rejected: a retry of the Settings click (would hide a real product race where the link sometimes does not open
Settings); a longer timeout (20 s is already long, and the button stays hidden, not slow).

## Proof
Two arms through the machine queue: the committed check passes (arm 1); a throwaway detached worktree with a mutant
that hides #panel-settings right after the click fails with
`hiddenBy:["#panel-settings[hidden] display=none visibility=visible"]` (arm 2). The first arm-2 attempt ran the
committed tree, not the mutant: browser-checks.sh freezes a copy of the last commit (#758), and said so in its log.

## Weakest premise
That the next red comes from the same wait. If the runner flake moves to another wait, this says nothing about it. And
the driver's summary cuts each reason at 200 characters, so the full line is in the job's streamed log, not the summary.
