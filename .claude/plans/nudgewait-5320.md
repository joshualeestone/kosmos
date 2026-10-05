# nudgewait-5320: the Prompter's nudge names needs_you for a wait on the person (kosmos#5320)

## Measured first: most of the card already shipped
- `kosmos project pause` (#4982, 8fc306fd8) and the Prompter/Assigner skipping a paused project (#4788, ba2f2baea) are
  both ancestors of 0.7.22's pin 2c39de6ea, and the nudge already names `kosmos project pause <id>` when the person
  asked in the room (engine/agentnudge.js nudgeText, #4771 review 2).
- What is still live is the report's Finding 1 (~/.cache/claude-handoffs/josh-reports-1005/kosmos-audit-board-status-tasks.md):
  the nudge's only suggestion for any wait is `kosmos report blocked --on <what> --owner <who>`. An agent waiting on its
  person filled in the person's name and chose `blocked`, which heartbeat.js does not chase, instead of `needs_you`,
  which reaches the person on its own notify path (heartbeat.js). recommender.js (default OFF) also acts on a needs_you,
  but only one that names its project (stuckRow drops a missing or carried-over stateProject).

## Change
`engine/agentnudge.js` nudgeText: "Pick it up, or say what you are waiting on: another agent, a deploy or a review:
kosmos report blocked --on <what> --owner <who>; your person's answer or decision: kosmos report needs_you "<your
question>"", with `--project <id>` before the question when the project id is safe (the same check as the pause
hint), so the Recommender can act on it when it is on. The needs_you form is the one the agent instructions already teach (engine/defaults.js:124). The quotes stay:
an unquoted question ending in `?` fails in zsh ("no matches found").

## Tests
engine/agentnudge.test.js: a #5320 test pins both suggestions and a control that the old one-suggestion text is gone; the
two quote-count assertions go from 2 to 4 (the template's own two; the person's words still add none, which is what they
guard). 29/29; against origin/main's agentnudge.js 26 pass, 3 fail. Longest possible nudge: 822 characters (chat cap 10000).

## Rejected
- Making `blocked --owner` refuse or warn on a person's name (the report's option b): the CLI cannot tell a person's name
  from an agent's or a team's reliably, and a wrong refusal blocks a correct report.
- A new state for "my person paused this": the pause verb already exists and is named in the same nudge.

## Weakest premise
That the nudge is where agents pick the wrong state. It is where this report's agent picked it (verified against the
source by the reporter); the agent instructions may still steer some to blocked elsewhere.
