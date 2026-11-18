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
- Weakest premise: agents discover the flag through the note and help only; no agent instruction names
  `feedback list` today, so there is nothing else to update.

## Status
- [x] engine mineLines/noneOfYoursWords + listNote hint
- [x] install/kosmos and tools/windows/kosmos-cli.js
- [x] tests: engine/feedback-listmine-8698.test.js, cli.feedback-2037, tools.windows-kosmos-cli-verbs
