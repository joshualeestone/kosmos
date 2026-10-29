# reactgap-7420: tappable reaction lines touch at their tap areas (kosmos#7420, Mona Lisa's review of #7553)

Mona Lisa, 10-29 on #7553's shots: under an agent's message the gap between two lines of reactions was about 26 pt,
against 6 pt under the person's. Cause: each tappable reaction carries a 44 pt tall tap area (the person's own are plain
chips, nothing to tap), and FlowLayout added its 6 pt on top of that. Her ruling: keep 44 pt; no gap between the tap
areas, so they touch (about 20 pt visible). Not 36 pt, and no overlap (a tap at the seam must not land on the wrong one).

## Finished looks like
- FlowLayout takes an optional rowSpacing (nil keeps spacing for both). ReactionPills passes 0 when its pills can be
  tapped, 6 when they cannot. The tap area stays 44 pt. The room's reactions (28 pt chips, no tap area) are unchanged.

## Verify
- All nine LogicTests scripts (room: the line gap source guard with a mutation control), repo readers of ios/, Debug and
  Release builds, simulator shots light and dark with KOSMOS_SAMPLE_REACTIONS=many.

## Review
- Round 1 (opus, blind): no blocker. Warning taken: at the accessibility text sizes a pill is taller than 44 pt, so with no line gap the capsules would touch; 3 pt of vertical padding inside the 44 pt frame keeps a gap there and changes nothing below 44 pt (source-guarded). Nits accepted: the guard reads source, not layout (the shots show it); the 0 rides on toggle != nil, which always comes with the 44 pt frame today (commented).
- Shots after the change (iPhone 17e, light and dark, ~/work/design-shots/kosmos-7420-reactgap/): about 20 pt between the agent's lines, as ruled.
