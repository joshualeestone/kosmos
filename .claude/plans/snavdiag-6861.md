# snavdiag-6861: render-snav-head-4979 names what hides the Settings nav on a timeout

Card: kosmos#6861 (nightly full browser-check run not green on main; claimed: icecreamkitty).

## Problem
The consolidated-view arm of docs/browser-checks/render-snav-head-4979.js times out on the CI runner in webkit only (the
`#s-nav button[data-go="mac"]` stays hidden for 20 s after the Settings link), at 1000px or 1280px, never locally. Four
reds so far. The Playwright timeout says only "resolved to hidden", so no red has said WHICH ancestor hides it.

## Decision
A diagnostic, not a fix. In the same evaluate as the Settings click (so no round-trip is added before it, and wrapped
so it can never stop the click), the check sets up three records on the page:
- `seq`: #panel-settings's `hidden` attribute over time (a MutationObserver with old values, one entry per change of
  state, ms from the click per callback; a show and a re-hide in one task are both kept; first entry plus the latest
  six when long);
- `by`: who set it (that one element's own `hidden` setter, delegating to the real one, notes the first stack frame
  that is not itself; the last three entries);
- `atClick`: whether body was consolidated at the click (the handler branches on it) and whether a capturing listener
  on the link saw the click.

On that wait's timeout ONLY (a TimeoutError; anything else is rethrown as itself) it fails with one line,
`<tag>: Settings nav hidden: {seq, atClick, by, hiddenBy, exists, rect, settingsParent, column, body, url, pageErrors}`
plus Playwright's "resolved to" lines. `hiddenBy` lists the hiding ancestors up to #panel-projects, with visibility
reported only where it starts. The probe has its own 5 s cap.

What it can tell apart: the click never reached the link, or ran with the tab layout (`atClick`); Settings never
opened (`seq` has no `shown`); opened and hidden again, and by which function (`seq`, `by`); a throw in the handler
(`pageErrors`); a missing or zero-size button (`exists`, `rect`). The driver's summary cuts each reason at 200
characters, so it shows only the first fields; the whole line is in the job's streamed log.

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
