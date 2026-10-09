# donewhenfield-5152: #5152 slice 1, "done when" as its own task field

## Finished looks like
- A task carries `doneWhen`: `null`, or a list of 1 to 3 checks (each a non-empty line of at most 200 characters).
- An agent sets it when it adds a task (`kosmos task add ... --done "<check>"`, up to three times) and changes or clears it later with a new verb (`kosmos task done-when <project-id> <task-number> "<check>" ["<check>" ["<check>"]]`, or `--clear`). Both CLIs: install/kosmos and tools/windows/kosmos-cli.js.
- The routes: `POST /api/project/<id>/tasks` takes `doneWhen`; new `POST /api/project/<id>/task/<n>/done-when` with `{ doneWhen: [...] | null }`.
- `kosmos task list` prints a task's checks, so an agent can read them back.
- The task transcript records it: the `created` row carries the checks, a change writes `done-when-set` / `done-when-cleared`, and the task page's activity list says those in words.

## Decisions (Angel, night shift; Josh's 10-03 11:07 ruling: the agent writes the task and its done-when; the person may edit it with no approval)
- **A list, at most 3, each at most 200 characters.** Mona's LOE says "up to 3 checks". 200 matches SENTENCE_MAX. Refused rather than truncated, the file's rule for every other field.
- **A webhook cannot set it.** Webhook text is outside text (see the webhook branch of create) and Mona's risk list says a webhook still cannot set done-when. The webhook route never passes it, and create refuses it from a webhook so that this is a rule, not a habit.
- **Who may change it:** the screen, or an agent on the project (the create route's `processCaller` + `notOnProjectRefusal`). Not limited to the assignee: Josh's ruling is that the agent writes it, and the agent writing it is often the one that added the task, not the one it is given to.
- **A closed task can't be changed.** Closing ends the work, so changing what done means afterwards would rewrite history. Refused with a sentence (409). Rejected: allowing it like setDue does. A due date is information about the past; a done-when on a closed task is a claim about what was checked.
- **Setting the same list records nothing,** as setDue does.
- **Checks the person set are theirs** (review round 1). A screen write, or a screen add with checks, marks them `doneWhenByPerson`. Any other caller is refused (403) until the person changes or clears them. This matches built's person mark, hold and repeat. Josh's ruling lets the agent write the checks and the person edit them; it does not let the agent being judged rewrite the person's bar.
- **No rate limit on this route**, the same as due and hold. A loop costs one transcript row per real change, and an unchanged list writes nothing. **No setup-guide masking**, the same as task add's sentence and detail (review round 1, both noted rather than built).
- **Not in this slice:** editing or showing the checks on the task page (slice 2), per-check reports (slice 3), the assignee's managed block, and the pane line on assignment.
- **The doctrine line stays as it is in this PR.** Slice 0's line tells agents to write "Done when: 1) ..." into the detail, and that still works. Moving it to `--done` is a follow-up. Every DOCTRINE_VERSION in engine/defaults.js is measured with `claude -p` on test agents before it merges (v24, v25), and engine/doctrine-past.js records each version so that existing agents are offered the change. Rejected: a wording change in this PR without that measurement.

## Weakest premise
That `kosmos task list` is where an agent reads its checks back. If agents mostly learn their tasks from the managed block, the checks also belong there (a follow-up, because it changes every assignee's instructions).

## Review log
- **Round 1 (opus):** 0 blockers, 2 warnings, both fixed.
  - W1: the refusal sentences carried double quotes, which install/kosmos's sed cut at. Reworded with none, and refusal arms added for both CLIs, using the engine's own sentences.
  - W2: an agent could overwrite the person's checks. Now refused, as above.
  - Nits fixed: the Created line shows its checks; a screen change reads "You"; every control character and U+2028/U+2029 are refused; one shell escape helper; HTTP arms for the screen and for a webhook body.
  - Nits decided: no rate limit, no guide masking (see Decisions).

(Plan file note: slice 0 is .claude/plans/donewhen-5152.md, Mona Lisa's, merged; this branch is named donewhenfield-5152 so neither its plan nor its proof shares a path with slice 0.)
