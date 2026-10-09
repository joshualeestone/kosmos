# filespvwait-5703: render-files-preview-4997 stops needing a WebKit retry (kosmos#5703)

## Done looks like
The check reads a list's row only after the list's own painter has had the chance to draw it, so the 5 s poll
superseding the check's paint no longer fails the first open. A painter that never draws the row still fails.

## Cause
2 of 6 nightly full runs retried this check, both at "d-files-list: the photo.png row was drawn by this list's own
painter" (own:false, WebKit). The agent page's 5 s poll (and the project's pjLoadDocs tick) can start a newer paint
while the check's awaited paint is in flight; the older paint's epoch is superseded and it returns without drawing.

## Decided
- Fix the check, not the page: a person sees the row one poll later; the epoch guard is correct.
- Wait up to 3 s only for files the board lists (F6's link out never comes, so it does not wait).
- Weakest premise: the cause is reasoned from the code; a local run cannot reproduce a 1-in-3 WebKit timing race.
  The next nightly runs are the measurement.
