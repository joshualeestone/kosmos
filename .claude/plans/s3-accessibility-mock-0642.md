# s3-accessibility-mock-0642 — S3 tmux step depicts Accessibility, not Login Items

## Source
Josh 0.6.42 fresh-macOS re-test, item #1 (design side). AX fork DECIDED = KEEP (Josh, 2026-09-07
~00:05 CDT): keep the accessibility ask, because agents need the tmux Accessibility grant at
RUNTIME to act on the user's behalf in a project, so grab it up front WITH context during install
rather than springing it mid-project on a white-collar user with zero explanation.

Routed by Splinter; copy + browser-check spec from Mona Lisa (design owner). I own the fr-pane-3
`.s3-win` file edit + build + PR; Mona is out of the file (removed her worktree).

## The defect
The S3 "Kosmos never sleeps" tmux step (web/index.html fr-pane-3, step 2) reproduced the WRONG
macOS pane: its `.s3-win` mock titled **"Login Items & Extensions"** with the row **"tmux / Allow
in the background"**. But the tmux grant is **Privacy & Security > Accessibility** ("control your
computer"). The wrong mock sent Josh to Login Items (screenshot 10.57.49), where tmux was not
listed. The code comment at ~8156 already knew "tmux row -> Accessibility"; only the mock lagged.

## What finished looks like
- The S3 tmux `.s3-win` titles **"Accessibility"** and the row sub-text is **"Control your
  computer"** (Mona's exact copy), keeping the per-app toggle switch (`.s3-sw`, matching the real
  macOS Accessibility pane and the sibling Energy window).
- S4's `s4-*` pane STILL says "Login Items & Extensions" (correct — that is the bash
  background-activity grant, a different thing). Not touched.
- The step-cap "2 · when prompted, switch TMUX to On" stays (accurate for the toggle).
- `render-firstrun-stepcap-gear-0640.js` gains three arms (title == "Accessibility" not "Login
  Items"; sub == "Control your computer" not "Allow in the background"; a control that S4 still
  says "Login Items"), each red-verified against the pre-fix page.
- Full node suite green.

## Scope (NOT mine)
The tmux permission MECHANISM and install-flow wiring (the real prompts firing on Allow Access, the
gate on a confirmed grant, tmux appearing in the Accessibility list) are Kitty (mechanism) + Renet
(wiring) per the 0.6.42 routing — this card is ONLY the `.s3-win` depiction. The `.s3-gate-row`
data-gate="tmux" wiring and the "Turn On" button behavior are unchanged.

## Changes
1. `web/index.html` fr-pane-3 tmux `.s3-win`: `.s3-title` "Login Items & Extensions" ->
   "Accessibility"; `.s3-mtxt small` "Allow in the background" -> "Control your computer"; a comment
   explaining the grant + the S4-stays-Login-Items boundary.
2. `docs/browser-checks/render-firstrun-stepcap-gear-0640.js`: three new arms (4/5/6) targeting the
   tmux window by its "tmux" label (robust to the two `.s3-win` blocks), plus the S4 control.

## Weakest premise
That "Accessibility" (the pane name) is the right title, not "Privacy & Security" (the parent
list). Mona ruled the pane name, matching how the sleep window titles "Energy". If Josh wants the
parent-list name, it is a one-word change.
