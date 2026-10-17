# lostphone-6402 (kosmos#6402)

Seen on Josh's screenshot 2026-10-17 11:26 (0.7.55, switch off): "Lost your phone?" is followed directly by "Join
Corporate Account", so the page reads as if joining a company is what you do about a lost phone.

## Cause
The devices block ends with the quiet "Lost your phone?" link (#5791 moved it there), and the company block (#5531)
starts 16px below it with no edge between them. Nothing separates two unrelated sections.

## Change
web/index.html: the company block (#plus-org) is ruled off with the same hairline as the pane's foot (.plus-foot):
border-top 1px rgba(255,255,255,.1) and 14px padding. Its 16px margin is unchanged, so the pane's spacing rule (gap
under the list at most 22px, render-plus-panel-3829) still holds.

## Decided
- A rule, not a label. Rejected: showing a "Your company" label over the button (the card's suggestion). Josh ruled
  on 10-08 that a person with no company sees one quiet line, not an Enterprise box, and #5791 removed that label;
  Josh 10-17: no new lines on the interface. Rejected: moving Lost your phone? back to the foot (Josh 10-10 moved it
  out of the foot on purpose).

## Weakest premise
That a hairline is enough separation at a glance on the blue pane. If Josh still reads them as one, the next step is
spacing, not words.

## Tests
render-plus-panel-3829.js: on a connected pane the company block shows (control) and carries a 1px solid top rule,
below Lost your phone?.
