# teamnames-8092: short, easy to type names when making a team (#8092, a user's request on the public board)

Design call on the card (Mona Lisa): build the user's first two asks as one small thing, not the third.
- Each member row on the team step gets an Another name button beside its name box: a short name (3 to 5 plain letters,
  from many places) that is not on the board, not elsewhere in the team, not one letter from either, and not the one it
  has now.
- Use short names, above the rows, does the same for every row, before the team starts (after, a failed row has Another).
- No toggle (a setting for a once-per-team choice). Regional bias not built: Kosmos would have to guess a region.
- Use short names replaces names the person typed too, as its words say; a replaced name comes back only by typing
  it. Follow-up on the card: leave rows the person typed in alone.
- The board's names are read once when the team opens, best effort: a press before they arrive, or a failed read,
  avoids only the team's own names, and Make's check still refuses a taken one.
- Both are offered only while names can change; Make still runs the engine's own taken-name check.

Finished looks like: on the team step, Another name and Use short names give short free names, the made agents carry
them, and both go once the team starts; phone width keeps the name box usable. Checked in
docs/browser-checks/render-teamcreate-4557.js (chromium and webkit).
Weakest premise: that short is what makes a name easy to type (an unfamiliar short name is still unfamiliar).
