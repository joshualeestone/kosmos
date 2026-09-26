# Plan: kosmos#3923, the project notice (Mona Lisa's design)

## Finished looks like
On a project page, while any member's told state is could_not, one notice under the Members heading
names what is wrong, shaped by what the person must do (Wait: the reason and Try again; Act then retry:
the reason, a fix ending "then try again", and Try again; Explain: a sentence saying nothing can be done
yet), one row
per agent when several, using the person's names, with no left bar. Nothing renders when every agent
has the folder (success and not_tried say nothing). The per-row interim line is gone from the project
page. Try again re-tells that agent and the notice updates.

## Measured before building (main at the worktree base)
- pjToldLine's interim sentence ("We could not update this agent about this folder: ...") renders on
  the member row, or once below the list via pjSharedTold; none of the design's copy is served.
- The becauses tellAgent returns (engine/projects.js; GROUP_BECAUSE keys plus the N-blocks and worker
  folder ones). No re-sync route exists; POST /api/project/:id/agent/:name on an existing member
  changes nothing (moved=false, no pane line) and re-runs syncAgent, recording a fresh verdict.
- docs/browser-checks/render-projects.js measures the failed tell on the "Quarter close" fixture.

## Change
1. web/index.html: .pnotice CSS (from the mock, .qopt scoped to it, no left bar); #pj-one-notice above
   #pj-one-agents; PJ_NOTICE (exact-because regexes to shape and copy), pjNoticeRow, pjNotice;
   paintOneProject paints the notice and passes suppressTold to every row; a Try again handler.
2. web.project-notice-3923.test.js: each shape, several agents, unknown cause, escaping, and every
   engine because has a shape.
3. render-projects.js measures the notice's headline and reason instead of the row's .pj-told.

## Decided
- Settings' members list keeps its per-member line for now (pjToldLine and its tests stay, used there).
  Rejected: a second notice in Settings in this change. Weakest premise: people check Settings for this;
  the project page is where the design puts it.
- Copy for the reasons the mock does not draw (N blocks, too short, size limit, the ambiguous name, a
  folder Kosmos will not change) follows the mock's pattern: the reason in plain words, the fix in ink.
- Try again posts the member route with `?retell=1`: a current member is re-told (idempotent, nothing
  typed into its window); an agent that has left gets 409 rather than being put back (review round 1).
  A same-answer retry says "It still did not work." on its row; the button re-enables and focus returns.
- The consolidated layout hides the whole Members card (#3218/#3305), so the notice does not show there;
  that was already true of the old line. Not changed here.
- pjSharedTold, pjToldGroupLine, their CSS and tests are removed (dead once the notice replaced the
  group line). pjToldLine stays: the Settings members list still uses it.

- Act rows no longer promise a time Kosmos picks the fix up (superseded in review round 5, below):
  each is "..., then try again." with a Try again button.

## Verified checks
- render-projects and render-project-members-3387 pass through tools/browser-checks.sh with the notice in the Members card (the second is surface-mapped to pjcard-members; the notice adds a sibling and changes nothing it asserts).

## Review round 5
- The Act fixes no longer promise a time Kosmos picks the fix up: three wordings in a row were false
  (another agent's membership change does not re-tell this one). The four "change something" rows are
  now Act then retry ("..., then try again." with Try again), which is Mona's own third shape: the
  retry fails before the fix and works after it, and nothing else re-tells the agent. #3932 (automatic
  re-tell) becomes a nice-to-have.
- Try again no longer paints twice (a role=status notice announced twice); "still" is marked only for a
  read that landed, and an overtaken read places no focus.

## Review round 7
- Try again places focus only if it is still on the page body or in the notice; a newer read that
  overtook this one keeps the still-mark (it also started after the retry) and one more read gives the
  handler its own paint to focus on.
- The no-folder Explain says what is missing ("Kosmos has no folder for X on this computer"), true for a
  connected agent and for a Kosmos-made one whose folder was deleted.
- Kept deliberately: engine becauseGroup (still on /api/projects; no page reader now). Removing it is
  an engine change with its own test, outside this card.

## Review round 9
- Try again that WRITES the block now types the same join line an add types into the running agent,
  because the stored TOLD is read as "told it on its screen" (toldOverride). A retry that changed
  nothing, or could not write, types nothing. The retell path never calls addAgent (a leave landing
  mid-request cannot be undone) and skips the membership valve (it moves no membership).
- A Try again with no answer (offline, a board error, a refusal) says on its row that it did not go
  through, instead of leaving the row looking untouched.
- The instruction writer's editor-worded refusals ("reload before saving", "open it by hand") are
  translated in tellAgent into Kosmos's own sentences, with notice shapes and a plural row, read from
  write()'s source by a test so a new refusal cannot pass through verbatim.
- (Superseded in round 11: the headline changed, see below.)
- The Members heading drops its temporary tabindex when focus leaves it.

## Review round 10
- The notice region is announced on first appearance; the reader's missing-file sentence (never a
  project verdict) is dropped and excluded in the scan with a control.

## Review round 11
- A retry announces the join only for a project the write newly put in the block (`added`, from
  `projectsInBlock`, which reads the same post line the block writes), and only while the agent is
  still on it. `changed` alone also fired for a write that added a different project.
- Headline is now "Kosmos could not update X's instructions for this project." (plural: "... three
  agents' instructions ..."). The old one claimed the folder was missing, which is false when an
  earlier update landed, and used "folder" in two senses beside the no-folder row. Mona's copy; she
  can override. The generic write row no longer repeats it ("The change did not save. It may work on
  another try.").
- Verdicts saved before tellWriteBecause keep the editor's wording; the notice matches those raw
  sentences to the same rows (tested against write()'s own throws).
- An offline retry whose re-read also fails paints the "did not go through" mark from the loaded
  projects instead of waiting for the connection.
- #pj-one-notice is a permanent, unhidden live region; the visible .pnotice is drawn inside it, so a
  first appearance is announced (content inserted into an existing region).
- "cannot match X to a session" is now "cannot find X running on this computer".
