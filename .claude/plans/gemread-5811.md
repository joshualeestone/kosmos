# gemread-5811: the "(set to X)" decision reads nothing the snapshot has not already read

Card: #5811 (follow-up to #5804, raised by four of its review rounds). Stacked on gemmodel-5804; rebases onto main
once #5804 merges.

## What
- engine/create.js: `plannedModelOfJob(job)`, the pure half of `plannedModelOf(name)` (which now calls it), so a
  caller that already holds the job does not read it again.
- engine/status.js `readGeminiSession`: it already reads the job to find the session; a found session now also carries
  `planned` (plannedModelOfJob of that same job).
- engine/status.js snapshot row: `geminiSeen` = `{ modelAt, planned }` for a Gemini pane whose session was found, null
  otherwise (and null on the paneless builder). It never reaches the page: server.js builds the page's row field by field.
- engine/geminimodelswitch.js `settingModelName(name, deps)`: deps may now be PARTIAL (the given ones override the real
  ones), so the server passes only what the snapshot carries (settingModelNameOfRow).
- engine/geminimodelswitch.js `settingModelNameOfRow(a)`: with no `geminiSeen`, null (the snapshot could not read the
  session, so neither could a second read on the same tick); otherwise `planned` and `session` come from the row
  (`a.model`, `geminiSeen`). server.js `settingGeminiModel` keeps its gate and calls it.
  The run start stays tmux's (cached per poll, SESSION_CACHE) and the display name is pure.

## Result
Per running Gemini agent per poll: 0 extra job reads and 0 extra session parses (were 1 and 1).

## Not here
Same answer as #5804 in every case; no wording change, no Windows change.

## Weakest premise
That the snapshot's session read and the decision should see the same moment: they now do by construction (before,
the second read could see a newer reply than the model shown, a harmless but real mismatch this removes).

## Tests
engine/geminimodelswitch-5811.test.js: partial deps override, the server's deps give the same answers as #5804's cases,
and the server path calls neither the job reader nor the session reader (counting seams, with a control that counts).
create.plannedModelOfJob unit cases. Source pins for the row field and the server wiring (update #5804's wiring pin).
