# diagfields-5959: the diagnostics file carries the card's word and when the agent last worked (#5959)

Card: joshualeestone/kosmos#5959. Slice 4 (#6041) shipped the diagnostics file without two fields because they came
from slices 1 and 2, which were not on main yet. Both are now (#6035, #6021), so each agent in the file gains:
- `card.label`: the card's word as the page shows it (`engine/cardlabel.labelOf`, the same function `kosmos report
  show` uses), so a builder reads what the person saw ("Question", "Sign-in isn't working"), not only the raw state.
  A throw reads as null, never as a missing file.
- `lastWorked`: the card's `{ at, why }` from status.js `lastWorkedOf`, those two fields only (null when the card has none:
  no pane, or a pane that is not ours).
- `report.askedAt`: when a waiting question was first made (selfreport's askedAt, #5943), the time report show ages a
  stale report from.
All three are times or the page's own words: nothing the agent or the person wrote, so the file's rule (states and
failures, not the conversation) holds, and they pass through the same redactor as everything else.

Test: engine/diagnostics-5959.test.js, on real fleet cards with the slice 1/2 values injected (the label is derived
from the card's own fields), a check that a real board card carries lastWorked in that shape, that a card without one gives null,
and that a field added to it is not carried. Weakest premise: `lastWorked` is read off the roster card (safeRoster maps snapshot cards, which
carry it); a card shape that drops it would read null, the honest value, not a wrong time.
