# Needs you lights the project the question is about (#763, engine half)

Branch `needs-you-project-763`. Splinter's ruling 22:47 CDT on Josh's 22:05 report: Needs you lights only the project the question belongs to; the report carries the project; unattributed questions surface on the Agents page instead of lighting everything. Any new phrasing for agents goes behind the change and is shown to Splinter before it enters anyone's instructions. Screen half: Mona Lisa.

## What happened

Josh created "Christmas marketing plan"; four of seven project tiles turned to Needs you with nothing inside. A project's `needsYou` counted every member whose own state was `needs_you`; an agent's state is one value, not one per project, so its agents' first question lit every project they belonged to. Nothing was posted anywhere (the rooms were empty, the tile prints only its pill).

## What changed

- `engine/selfreport.js`: a report may carry `project` (a project id, capped at 120). Reading carries the last named project forward, so the permission hook's project-less `needs_you` inherits the project the agent last said it was on; `stopped` clears it (nothing from a previous run leaks).
- `engine/status.js`: a reported `needs_you` carries `project` onto the merged state; the agent's card carries `stateProject` (null for a scraped question or a report that named none).
- `engine/projects.js`: `summary.needsYou` counts questions about THIS project (`stateProject === project.id`); `summary.needsYouElsewhere` counts members who need you about something else (for a screen that wants to say so). The member row carries `stateProject`.
- `server.js`: `/api/report` passes `project`. `install/kosmos`: `kosmos report ... --project <project-id>`.
- Tests: selfreport (record, carry-forward, stop clears, cap), status (reconcile carries it; scraped and non-question states do not), projects (the summary through the real seam: a recorded report, a roster built by the status engine; the same agent on a second project lights nothing there; the unattributed case), server (the route keeps it; end to end to `/api/projects`).

## Finished when

- A `needs_you` report naming project A lights A's tile count and not B's, for an agent on both.
- A `needs_you` with no project, after no earlier report named one, lights no project; the agent still shows `needs_you` on the Agents page.
- The hook's permission `needs_you` (no project of its own) lights the project the agent last reported working on.
- `kosmos report needs_you --project <id> "..."` sends the field (CLI control with a curl shim, in the proof).

## Behind the change (not in this PR)

Teaching agents to say `--project <id>` (or "task N of <project>"): the wording goes to Splinter first, Josh confirms in the morning. Until agents say it, tiles light only for questions the hook or the agent attribute; that is the ruling.

## Not in this change

The screen (what a tile says with `needsYouElsewhere`); the number-only task join in `claimFor` (carded separately); a project on the phone notification (`notify.happened` for `needs_you` does not carry it yet).

## Blind review round 1, what changed (decisions under the ruling's direction: fewer false lights, never a missing one; inferences admit themselves)

- A carried-forward project ADMITS ITSELF: `projectInferred` on the reading, `stateProjectInferred` on the card and the member row, `needsYouInferred` in the summary (Splinter 23:05: a tile lit by a guess and one lit by a statement must be tellable apart in the data).
- `started` clears the carried project as `stopped` does: a crash leaves no `stopped` row, and the next run must not light the old run's project on its first question. Cost, stated: the hook reports `started` on every session start, compaction and resume included, so after each the hook's questions go unattributed until the agent names a project again. A missed light, never a wrong one.
- The carry-forward is bounded by the 64 KB tail the reading looks at (about 400 to 500 rows; under a working day at the hook's one-heartbeat-a-minute throttle). Past it the reading says no project, never a wrong one; a test pins that direction.
- A question read off the screen (Claude's own prompt, which no report mentions) beside a report that named or inherited a project is about that project as far as anyone can tell, marked inferred; the same inference the hook's question gets. Before this it lit nothing.
- `needsYouElsewhere` (about ANOTHER project) is kept apart from `needsYouUnattributed` (about none), so a screen sentence about another project is never said of a question about none.
- The route keeps `project` only when it is a string.
- Screen consequence for Mona Lisa's half: with today's page, a project whose only member needs Josh about another project (or about none) shows the pill "Nothing running"; the engine ships the two counts for the sentence that replaces it.
- Deferred: the phone notification (`notify.happened` for `needs_you`) does not carry the project yet; `--project` must precede the sentence, like the three existing flags.
