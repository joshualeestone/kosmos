# #3967: remove the fading gold edge on unread messages, for now (Josh, 2026-09-26 09:01)

## Finished looks like
- No gold edge is drawn on a newly arrived (unread) message on any surface that used it: agent bubbles in
  DMs and project rooms (.msg-bd[data-unread]) and the setup assistant's replies (.asp-m[data-unread]).
- Everything that decides what is unread is untouched: data-unread is still set and cleared by the
  script (UNREAD_EDGE), and --unread-edge keeps its light, dark and navy values, so the edge can come back.
- A CSS note at the removed rules says it was removed on Josh's 09-26 call because the inset shadow on
  the bubble box does not follow the bubble's tail (the ::before wing), and how it can return: drawn
  around the tail too. The note describes the old rules in words (no rule literals in a comment, which
  the forced-dark theme generator can misread).

## Calls
- Both surfaces, not only the bubbles with tails: the card says every surface using the highlight, and
  one gold edge on the assistant but not on DMs would read as inconsistent.
- The unread MARK stays (not the drawing): the read tracking still works and is still tested, so
  bringing the edge back is CSS only.

## Tests
- docs/browser-checks/render-unread-edge-3743.js: the arms that read the drawn edge (U1 colour, U2 fade,
  U14 dark and navy, U15 the assistant) now pin that nothing is drawn; every arm about the mark (set on
  unread, cleared once read, history never marked, window focus, tall messages, rooms, the assistant)
  is unchanged and passes.
- Before/after shots: the same check's screenshots against main's page and this branch.
