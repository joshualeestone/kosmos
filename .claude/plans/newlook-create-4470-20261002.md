# newlook-create-4470: Create an agent (New agent) in the new look, behind the switch

Card: kosmos#4470. The card's page order (project page, Agents, Tasks, an agent's page, Settings, phone) is built
(slices up to newlook-phone-4470, all converged, not yet merged). This is the next screen a person meets: New agent.
Stack on newlook-phone-4470 (or on main once the stack lands).

STEP 0, BEFORE ANY CSS (memory: read rulings before mocking a screen; Josh's approved designs are built verbatim):
read the rulings on the create flow: #4935 (Josh 0.7.16: Create a Team's spacing and widths match Create an Agent),
#4557 / #4709 (Team flow), #3946 (Swarm create), #4554 (Single / Team / Swarm first screen). Anything Josh ruled about
layout, spacing, the RECOMMENDED badge or the selected card's look stays exactly as ruled; this slice changes only what
the new look changes everywhere else (edges, capitals, button shape).

Measured (2026-10-02 14:20, mobile-shots create-single vs a temporary nl-create-single, desktop + iPhone 15 light;
shots ~/work/design-shots/newlook-create-4470/): with the look on the step already reads close to the look (grey option
cards on the white page). What still reads as today's app:
1. Each option card has a hairline edge. The look's cards have none (slices 3 and 4). Drop it; the grey alone bounds
   the card on white.
2. The selected card's 2px ink outline and its check mark: KEEP. They mark the choice by shape, not colour.
3. "Continue" is the gold rectangle; the drawing's main action is a gold pill ("Post"), as #tsk-new and the controls
   slice made it. 999px.
4. The RECOMMENDED badge: KEEP AS IS (decided at STEP 0, below).
Also check the other create steps (kind picker, Team, Swarm, the outcome step) for the same four, in one pass.

mobile-shots: add nl-create-single (and nl-create-team / nl-create-swarm) permanently, newLook(page) then the
create-* steps. render-newlook-4470: CREATE_LOOK arm (an option card's edge, the selected card's outline width, Continue's
radius, the badge's case; on, chosen Dark, 390, and the off control). Negative control before claiming it.

STEP 0 DONE (2026-10-02 14:30, read in the cards and beside the create-flow markup in web/index.html ~14667-14730):
- The rulings are structural: the order (recommended role, "pick another role" with its menu opening in place,
  "describe it yourself"; Josh 2026-08-22), native radios grouped by name (#178), rows filled from /api/roles.
- The Recommended pill: Josh took it off on 2026-08-22 ("less is more") and asked for it BACK on 2026-08-24 21:12
  (#737) after looking at the design pack beside the app; "the later ruling wins". Its form is pack-sourced and
  his eye approved it there, and no new-look drawing shows it, so restyling it would re-open a ruling: keep it.
- No ruling names the option cards' edge or Continue's shape: items 1 and 3 go ahead as planned; item 2 keeps.

As built (14:40): items 1 and 3 as planned, scoped to #panel-create under the look; a card under the pointer keeps
today's edge. render-newlook-4470 gains CREATE_LOOK (resting edge, chosen edge, Continue's corners; on in light, dark
and 390, and the off control). 253/253; without the CSS exactly the 3 new on arms fail. mobile-shots gains
nl-create-single (desktop and iPhone 15, light and dark, 0 overflow).

Review R1 (opus) 0B 4W 0C 3N:
- WARNING: "every step's main button is a pill" was false for Team (#team-seeded-go and the org chart's are plain
  .btn.uprime, not .big), so Single and Team disagreed, against Josh's #4935 (Team matches Single). Now every
  .btn.uprime in #panel-create. Arm: Team's and Create's buttons (round-0 CSS: Team 10px, red).
- WARNING: the kind picker's cards (.nak-btn) kept their hairline while the next step dropped it. Now both, at rest.
  Arm (round-0 CSS: the hairline, red).
- WARNING: drift: this plan promised team shots and a badge read. The badge read is DROPPED (STEP 0 keeps the badge);
  nl-create-team is now in mobile-shots (desktop and iPhone 15, 0 overflow).
- WARNING: nothing guarded the hover edge or the other steps: a real hover on a resting card (edge kept, both themes),
  the mouse parked before the resting read (NIT taken), the kind picker and Team/Create buttons read.
- NIT taken: the comment records the role menu's own edged box (it holds fields) and the 1.09:1 resting boundary.
Validation now: 255/255; round-0 control 252/255 (kind edge and Team's corners red).

Review R2 (sonnet) 0B 2W 0C 2N:
- WARNING (plan drift): nl-create-swarm is DROPPED on purpose: the Swarm card shows only on a board that can run
  swarms, and the existing create-swarm shot already fails on one that cannot. The kind picker's Swarm card gets the
  same rule as its siblings and is read through the first .nak-btn (the rule is one selector).
- WARNING: the pill reaches the small inline gold buttons too (Preview the team, Bring it in): intended, since every
  button in the look is a pill (the controls slice). The comment now says "every gold button"; the arm reads
  #orgchart-preview.
- NIT taken: a note that on touch a tapped card can keep :hover (and its edge) until the next tap.

Review R3 (opus) 0B 2W 0C 4N:
- WARNING: gold buttons were pills and the plain ones beside them square (Read it / Cancel, Create the team / Back to
  the list...): every button in #panel-create (.btn, .btn-quiet) is now a pill, shape only; plain buttons keep their
  fill and edge (on the white page the edge is their boundary). Arm: #orgchart-edit (round-2 CSS: 10px, red).
- WARNING: the hover probe left the page scrolled, skipped silently when no card was found, and could leave panels
  shown if a step threw: scroll, panels and the probe id are now saved and always put back (finally), and a missing
  card is a failure.
- NITs taken: the mouse parked before the before-read too; the hover exemption gated on :not(:disabled) as today's
  gold hover is; the long comment line rewrapped. NIT left: no arm for the kind picker's hover or a chosen card under
  the pointer (same selector).
Validation now: 255/255 (round-2 control 252/255: the plain button's corners).
