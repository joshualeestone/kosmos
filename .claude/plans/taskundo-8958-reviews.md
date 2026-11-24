# taskundo-8958: review record (kosmos#8958 slice B5), base 856324a450

| Round | Reviewer | Commit | Findings | What was done |
|---|---|---|---|---|
| 1 | opus, blind | 68c880baf1 | 0 B, 3 W, 6 N | all fixed but N8 (the list is locked while its undo is out: on purpose, in the plan) |
| 2 | opus, blind | 8e2849b4ec | 0 B, 3 W, 4 N | all fixed |
| 3 | sonnet, blind | 03dc4533f9 | 0 B, 3 W, 4 N | N6 fixed; the rest answered below |

Round 3, not changed:
- W1 (a file edited after the plan was read is undone with the other agent's work): does not happen. engine/undo.js plan()
  marks a file changed after the close `changed-since`, which is not choosable, before it looks at `shared`; `shared` and
  `other-task` count edits up to the close only.
- W2 (nothing done, every file left): the board's words and the board's end; the line is true, and the page opened again
  offers again.
- W3 (closed again while the undo is out): the answer is kept on purpose (round 1's W1). That the Mac acts on the newer
  close's plan in that window needs the server to check which close the list was for: noted on the card.
- N4 (a failed read after Cancel hides the offer for 30 s) and N5 (off is asked again only when the page is opened again):
  as the board.
- N7 (a throw after part of the work answers 400): the server's, from before this slice.
