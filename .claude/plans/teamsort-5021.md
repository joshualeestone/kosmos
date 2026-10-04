# teamsort-5021: Create a Team's "Choose a team" menu under headings, A to Z (kosmos#5021)

## Done when
New Agent > Team's "Choose a team" menu shows its teams under headings, A to Z inside each, on a served build: with
today's catalogue, Business then Personal and family; once the catalogue gives teams a `group` (April, kosmos-catalogue),
those headings. A browser check on the real menu shows both, red on main.

## Why it looked unordered (measured)
The page sorted the teams by `rank` alone, and ranks restart within each kind, so business and personal teams
interleaved: Josh saw no order at all.

## Decided
- Step 1 ships alone: headings from the field every catalogue already has, `kind`: "Business" and "Personal and
  family", business first, A to Z inside (localeCompare, case-insensitive).
- Step 2 is the catalogue's: a `group` on every team (my ten groups, on #5021; Josh can rename them). The board reads it
  now: engine/teamseed.js list() passes it through when it is a name and drops it otherwise, and the menu uses it as
  the heading; a team with none (or a malformed one) sits under its kind. engine/catalogue.js deliberately does NOT
  check it: a field that only sets a heading must not make a new board refuse the whole catalogue (roles and teams)
  while old boards, which ignore the key, take it. The catalogue's own build check (April) is where a bad one is
  refused. (Round 1 changed this from refusing a malformed group, which April had asked for; she is told why.)
- Headings are A to Z within each kind, not in the catalogue's order (the role picker uses the catalogue's order of
  first appearance): Josh asked for alphabetical at minimum. If the catalogue should set the order, use first
  appearance instead (one line). So the data needs no
  further board change when it lands, and data without a reader breaks nothing (unknown keys are ignored).
- Group order: business groups first, then personal, each A to Z; teams A to Z inside a group.

## Rejected
- Grouping in the board's code by a hard-coded team list: it would drift from the downloaded catalogue, which adds
  teams without a release.
- Keeping the rank order inside a heading: the rank is the catalogue's sense of popularity, which nobody can see in
  the menu; A to Z is what Josh asked for at minimum.

## Weakest premise
That A to Z beats the catalogue's popularity order inside a group. If Josh wants the most common teams first, sort
by rank inside each heading instead (one line).

## Verified
- docs/browser-checks/render-teamsort-5021.js: 15 PASS (chromium, webkit).
- engine/teamseed.test.js: a named group passes, trimmed; '', '   ', 5 and null are dropped.
- engine/catalogue.download-4632.test.js: a catalogue with any of those groups still loads (red with a strict rule,
  measured).
