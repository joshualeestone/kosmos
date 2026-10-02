# #4937: the project Documents screen, one list at a time

**Done looks like:** on a served build, opening a project's Documents shows the project folder's files
first, and one tap on "From this conversation" switches to the conversation's files; the conversation's
list no longer stacks above the folder's and pushes it down.

## Josh, #admin 2026-10-01 20:56, verbatim
"As this page gets longer and longer, the "From the conversation" files are going to push them all the
way down the page. Let's do a segment controller at the top that says "From this conversation" or "In
the project folder" and delete or default to "In the project folder.""

## Change (web/index.html)
- A segmented control above the lists: "In the project folder" | "From this conversation", in the app's
  own segmented style (the `.cons-agents-lay` class the agents' Grid / Org chart switch uses), as a
  radiogroup with roving tabindex and the same keys (arrows move and choose, wrapping; Home, End).
- `#pj-docs-view[data-docseg]` drives two CSS rules: the folder's count, list, pager and sentence show
  only on the folder segment; the conversation's list only on its own.
- The "From the conversation" / "In the project folder" headings no longer show: the control names the
  two sources (#131's "said apart" holds).
- Every open starts on the folder; the control shows only when the conversation has files.

## Decided
- Always open on the folder; no per-project memory. The card asks for memory only "if that is what the
  rest of Kosmos does for tabs", and it does not: the app remembers global looks and layouts
  (kosmos-look, kosmos.layout.agents), not a per-item tab.
- No control when the conversation has no files: a switch to an empty list is a dead control.
- Rejected: counts inside the segment labels (Josh's words are the labels).

- Known trade-off: the switch appears after the conversation's read, which runs beside the folder's, so
  when the room answers last the switch pushes the folder list down about 45px. Reserving its space would
  shift the page the other way whenever the conversation has no files. Accepted.
- A failed Open in Finder switches to the folder's segment, where its sentence lives (the button names
  the folder). Below 400px wide the two segments share the row (at 320px the switch was 344px in a 296px
  view and the page scrolled sideways, measured on both engines).

## Weakest premise
That hiding the control when the conversation has no files is right. If Josh wants the switch always
visible for consistency, the one `hidden` toggle goes and the empty segment needs a sentence.

## Evidence
- docs/browser-checks/render-docs-seg-4937.js (hermetic, both engines, plus a 320px phone arm): 29 PASS;
  red on main.
- node --test browser-checks-*, web.*, tools.browser-checks-*: 2351/2351.
- Surface gate: render-consolidated-nav-4345, render-subback-4586, render-subview-cleanup-3502 pass on
  this branch.
