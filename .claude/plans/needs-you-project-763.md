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
