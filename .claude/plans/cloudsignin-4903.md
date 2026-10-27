# kosmos#4903 S5 design pass (branch cloudsignin-4903)

Mona Lisa's design review of S5 (card comment 6433522198, 24 shots in ~/work/design-shots/kosmos-4903-s5/). Notes 1-3
are this branch; note 4 (the Claude row's Connect stays live during a sign-in, on the Mac too) is outside S5 and left
for the first-run owner (said on the card, 6433561948).

## Built (2026-10-26 23:1x)
1. On a cloud machine the sign-in link is the PRIMARY button: gold, no underline, full width in the phone layout. It
   rendered white because `#firstrun .btn` (1,1,0) outranks `.btn.uprime` (0,2,0), the same trap the confirm panel
   hit; fixed by a rule scoped to `#firstrun #fr-conn-url`. Settings' link was already gold; it lost its underline.
2. The sentence above the link says "below" once the link is painted and "Its link appears here in a moment" only
   while it is not (frCloudSigninDetail). The link can arrive inside a phase with no rebuild, so frConnPaintUrl (first
   run) and acctClaudePaintUrl (Settings) re-say it. The phase sits in the span's id, so the test harness's fake
   elements need no getAttribute.
3. On a cloud machine the code field has the placeholder "Paste the code from Claude" (aria-describedby the sentence)
   instead of the repeated label. The Mac keeps its label (a code is the exception there).
Browser check docs/browser-checks/render-cloud-signin-4903.js (gated.txt + README): measures the computed gold against
the card's own --gold-bright, no underline, full width at 393 and 700, not at 1280, the sentence with no link and
after a late link, the placeholder; CONTROL: the Mac's white link and its label. Red (white, underlined) with the rule
removed; red at 700 with the old 600px breakpoint.

## Review 1 (23:2x): 0 blockers, 2 warnings, 3 nits, all fixed
- W1: the hidden live region (first run) and Settings' visible line still said the link was coming while it was on
  screen. signinSay(table, phase, hasUrl) now returns the screen's sentence on a cloud machine.
- W2: Settings' gold link was underlined. NITs: the breakpoint is the app's 720px; aria-describedby on the code
  field; the browser check gained no-link, late-link, 700px and a desktop control.

## Review 2 (23:5x): 0 blockers, 2 warnings, 3 nits
- W1 FIXED: first run's spoken line had no test (forcing hasUrl false passed everything). Now asserted for both
  phases, link and no link (mutant red).
- W2 FIXED: in Settings, the link appearing or going inside a phase replaced whatever sentence was on screen,
  including the reason a code failed. It now re-says only when the generic sentence is what is showing (tested with a
  reason on screen; mutant red).
- NITs: aria-describedby and its target asserted (mutant red); Settings' underline fix asserted in source (the
  browser check cannot open Settings' Add a provider panel, which Mona Lisa's script could not either). Settings'
  #acct-code keeps its own placeholder ("Sign-in code"), already without a second label.
