# #2429 - Add-member modal: close before the board refresh so the empty-state never flashes

## What finished looks like
After a successful add-member, the modal closes and the person never sees the free-agent picker's
empty-state line ("every agent we can see is already on it"). The board still refreshes to show the
new member. Browser-check passes and discriminates against the old order; challenge-loop converges;
PR merges on green.

## Root cause (Josh, 0.6.45, screenshot 8.56.58; routed by Splinter)
The modal already closed on success, but `addMemberToProject` did `await loadProjects()` (which
repaints the open project detail, and thus the modal's own free-agent picker) BEFORE the
`#pj-one-add-go` handler's `amClose()`. When the just-added agent was the last free one,
`paintFreeAgentPicker`'s empty-state option flashed into the still-open picker, then the modal
closed: Josh's "it blipped out and then said 'everyone can already see on it'".

## Change (web/index.html)
- `addMemberToProject` no longer refreshes the board itself (dropped the internal `await
  loadProjects()`); it returns true on a clean POST and the CALLER refreshes in the order that
  surface needs.
- The modal handler (`#pj-one-add-go`) closes FIRST on success, THEN refreshes: `amClose(); loadProjects();`
  so the repaint lands on a hidden picker (no flash).
- The settings-door caller (`#pjs-add-pick` change) now refreshes after a successful add
  (`if (await addMemberToProject(...)) await loadProjects()`), preserving its prior refresh behavior;
  it has no modal, so order does not matter there.

## Scope decision (weakest premise)
Splinter relayed "drop that line entirely". I fixed the POST-ADD flash (Josh's concrete complaint).
The same empty-state line ALSO shows when a person deliberately opens Add-member while everyone is
already on the project -- a legitimate case Josh's own words carve out ("no reason I ever need to
see this screen UNLESS we need to have the modal"). I kept the line for that case (dropping it there
would leave a blank picker with no explanation). If Josh/Mona want the line gone in that case too,
the cleaner move is to disable the Add-member entry when there are no free agents -- a small
follow-up, noted on the card.

## Test
- `docs/browser-checks/render-addmem-flash-2429.js`: seeds one free agent, opens the modal, stubs the
  add POST + the /api/projects refresh, and asserts the modal closes, the empty-state never flashes
  while the modal is open, and the refresh runs after the close. Negative-control verified: the old
  order fails both the flash and ordering assertions. Wired into the runner; reason-grep 69->70;
  README row added.
