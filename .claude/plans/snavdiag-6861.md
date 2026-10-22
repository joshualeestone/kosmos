# snavdiag-6861: render-snav-head-4979 names what hides the Settings nav on a timeout

Card: kosmos#6861 (nightly full browser-check run not green on main; claimed: icecreamkitty).

## Problem
The consolidated-view arm of docs/browser-checks/render-snav-head-4979.js times out on the CI runner in webkit only (the
`#s-nav button[data-go="mac"]` stays hidden for 20 s after the Settings link), at 1000px or 1280px, never locally. Four
reds so far. The Playwright timeout says only "resolved to hidden", so no red has said WHICH ancestor hides it.

## Decision
A diagnostic, not a fix: on that timeout the check reports every hiding ancestor (hidden attribute, display none,
visibility hidden), the body classes, the query string, #panel-settings's parent and which consolidated overlay is
showing, then fails with that in its message. The next nightly red then names its cause.

Rejected: a retry of the Settings click (would hide a real product race where the link sometimes does not open
Settings); a longer timeout (20 s is already long, and the button stays hidden, not slow).

## Proof
Two arms through the machine queue: the committed check passes (arm 1); a throwaway detached worktree with a mutant
that hides #panel-settings right after the click fails with
`hiddenBy:["#panel-settings[hidden] display=none visibility=visible"]` (arm 2). The first arm-2 attempt ran the
committed tree, not the mutant: browser-checks.sh freezes a copy of the last commit (#758), and said so in its log.

## Weakest premise
That the next red comes from the same wait. If the runner flake moves to another wait, this says nothing about it.
