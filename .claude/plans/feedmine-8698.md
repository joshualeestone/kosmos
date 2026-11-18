# feedmine-8698: kosmos feedback list --mine (kosmos#8698)

## Finished looks like
`kosmos feedback list --mine` on both CLIs prints only the days holding the asking agent's own report, newest first,
one a line, on stdout, exit 0; with none, one sentence on stdout. Any other argument to `list` is refused with usage,
exit 2. The plain list's note names `--mine` when other agents' days are in the list too. Help text on both CLIs
shows the flag.

## Calls
- A flag, not a re-ordered list: the plain list's output shape (dates, blank line, note) is read by agents and pinned
  by tests (#8340, #8462); a flag leaves it alone.
- "Yours" is daysOf(writer(env)), the same rule listNote already counts with and `write` writes under, so the two
  never disagree. Rejected: refusing --mine when no agent is identified (as `feedback day` does), because then the
  unnamed writer's write and --mine would disagree.
- The two agent instruction texts that named `feedback list` for finding your own days (engine/feedbacknudge.js
  and engine/roles.js) now name `--mine`.
- Weakest premise: an agent that already learned the plain `list` keeps reading the whole list until its
  instructions are refreshed; the note's hint covers that gap.
- No whats-new entry: this is an agent-facing flag, and the existing pool entry is about the person-facing note.

## Status
- [x] engine mineLines/noneOfYoursWords + listNote hint
- [x] install/kosmos and tools/windows/kosmos-cli.js
- [x] tests: engine/feedback-listmine-8698.test.js, cli.feedback-2037, tools.windows-kosmos-cli-verbs
