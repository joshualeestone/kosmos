# chatfiles-7016: the native chat shows an agent's files and opens them in Quick Look (slice 3b, part 2 of 3)

Card: kosmos#7016. Part 1 (questions and permission prompts) is .claude/plans/chatask-7016.md (PR #7021). Design:
Mona Lisa's slice 3b spec, section 3 (~/work/workers/monalisa/ios-design-2026-10-19/slice3b/SPEC.md). Route
contracts: ~/.cache/claude-handoffs/7016-board-routes.md.

## Plan
Finished looks like: an agent's file shows as a card inside its bubble (spec section 3: a 64 pt row, a picture for an
image or a PDF with a preview, else a symbol, the name truncated in the middle, "PDF · 2.4 MB"), and a tap fetches it
from the Mac through the kept sign-in and opens it in Quick Look; while it fetches a spinner, and when it cannot,
"Could not open it. Try again." with the tap retrying.
- BoardLogic: `Attachment`, `parseAttachments` (pjFiles; only /api/ addresses), `fileWord` (pjFileWord), `sizeText`
  (pjSize), `attachmentMeta`, `wordsShown` (pjWords: no words when they are only the file names), `hasThumbnail`,
  `fileSymbol`, `attachmentRequest`, `savedName`.
- BoardClient: `fetchFile` (saved in Environment.files, a temporary folder, encrypted while locked on iOS; the gate's
  sign-in page is no file), `loadThumbnail` (once per run), both dropped with the chats, opened files removed from disk.
- ChatFiles.swift (new): `FilesBubble`, `FileCard`. ChatView: the cards, `.quickLookPreview`, the time on the last of a run.
- Decided: only an agent's files draw natively; a file the person sent keeps its way-through row (the spec leaves the
  person's files out of this part). Weakest premise: that Quick Look opens every kind the Mac sends; one it cannot
  shows Quick Look's own "cannot preview" with share, which still lets the person save it.

## Validation
- ios/LogicTests pass; mutants for the address filter, the preview filter, the sign-in-page check, removing opened files,
  the words rule, the once-per-run picture and the saved name go red.
- Debug simulator build with -warn-long-expression-type-checking=100; Release has no sample code.
- Shots, light and dark: 5-files and 5b-file-failed in ~/work/design-shots/kosmos-7016/.
