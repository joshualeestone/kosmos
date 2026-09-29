# projectshow-4581: kosmos project list / project show (Mac and Windows)

Card: joshualeestone/kosmos#4581 (#4580 items 2 and 7; four of five model families asked).

## Done
- engine/projectview.js: summaryFreshness (newest summaries/YYYY-MM-DD-HH.md in the agent's folder by write
  time; current within the roles' 4-hour rhythm, else stale; none; unreadable; symlinks refused), familyOf
  (create.runnerProvider + create.providerLabel, "Claude" for Anthropic), overviewOf / listOf (from
  projects.list, the page's own read), renderList / renderShow (one renderer for both CLIs; every field on one
  line; the brief quoted "as written in BRIEF.md", never as an instruction).
- engine/brief.js: doneFrom / readBrief ("## Done..." section, ends at the next heading or a horizontal rule;
  a seeded "Replace this line." prompt counts as not filled in). readGoal now shares the one safe file read.
- server.js: GET /api/projects/overview and GET /api/project/<id>/overview (exact id; 404 "there is no project
  by that name"; unreadable store is a 500, never an empty list; a failed build answers 500 rather than
  leaving the request hanging, measured: 300 s). Both reachable with the agent's own token (#4491), the page's
  /api/projects is not widened (pinned).
- install/kosmos cmd_project list/show; tools/windows/kosmos-cli.js projectList/projectShow; usage identical.
  A garbled id is refused before any request on both (never stripped into a different project).
- engine/roles.js: the PM/director oversight line points at `kosmos project show`.

## Decided
- Tasks: counts (open, built, done) plus `kosmos task list <id>`, not the task words: webhook-added task text
  must be quoted as outside text (#1307), and that rule already lives in two renderers; a third copy is the
  drift this codebase keeps paying for.
- "Waiting on the person" in the list counts members asking at all, not only questions tied to this project
  (describe's summary.needsYou read 0 for a Codex member asking with no project attribution).
- A new read route, not new fields on GET /api/projects: the brief and summary folders are file reads the page's
  frequent poll should not pay.
- Stale is shown as a fact with its age, not an alarm: an idle agent is not asked to write.
- Shared agent instructions (engine/defaults.js) are not changed here: #4582 bumps the doctrine to 19 on a
  parallel branch; teaching the verbs there is a follow-up once it lands.

## Limits
- A member's model name comes from the card when the board knows it; test-support/fleet cannot set it, so it is
  not pinned by a test.
