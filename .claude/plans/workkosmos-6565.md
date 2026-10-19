# workkosmos-6565: a family's Settings no longer says "your work Kosmos"

Card: #6565 (found measuring #6251 on a family-enrolled board).

## Change
- web/index.html `plusOrgIn`: for a family only, "your work Kosmos for" becomes "in", so the
  joined line reads "This Kosmos is in <family>." A company's line is unchanged. Comment above
  the function now lists every rewording it makes.
- Page-only rule: no engine/orgenroll.js sentence says "your work Kosmos for", so the
  page/engine parity test (#6251) is unaffected.

## Tests
- web.familysay-6251.test.js: new #6565 test (family line exact, no "work Kosmos"; CONTROL company
  line and null org unchanged; "your company" -> "your family" still holds). Red with the rule
  removed (scratch-copy mutation).
- docs/browser-checks/render-org-family-6239.js R4: the accepted family's joined line is exactly
  "This Kosmos is in The Rivera family." README row updated.

## Beyond the card's line
- Every other "your work Kosmos" the page builds reads "your family's Kosmos" for a family: both leave-refused lines
  and the stopped-reporting line, each now passed through plusOrgIn. Pinned by count in web.familysay-6251.test.js
  (4 wrapped, 9 in all, comments included), so a new unwrapped page sentence fails.
- The same rule is in the engine's inKind, so the engine sentences that go through inKind say it too: ~482, ~666,
  and NOCONFIRM (~640, via inKind on the move path and inside undoFirstJoin, which ~620 and ~643 reach with orgKind); the parity test now includes a "your work Kosmos" phrase, so the two copies cannot drift.

## Not done, filed as #6567
- Engine sentences that go through neither (orgenroll ~461, ~541, two SAY codes) and the page's stoppedFor
  note (~51673, written when the page no longer knows the kind) still say "work Kosmos" to a family.
