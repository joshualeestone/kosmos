# waitswords-8577: task list --all waits-on words, the review-cap follow-ups from #8576

Addresses kosmos#8577 (April's #8576, PR #8578). Small and reversible.

## Done
1. **A project id stored twice never makes a hold read as met** (server.js, the --all list's `activityOf`). The lookup for `holdUntilMet` kept only the last record of a repeated id while the rows came from every record, so a held row could be checked against a record where the task it waits on is missing. Such an id now gets no answer; the CLI then says "waits on task N to close", true for either record. Chosen over tagging each row with its record: smaller, and a repeated id is a damaged store, where saying less is right.
2. **A held task in a paused project says both** (engine/tasklist.js `waitsWords`): "; its project is paused too", as `stateWords` already says. A plain hold in a paused project says "its project is paused".
3. **Nits:** a person's hold with an unmet condition keeps "(held by the person)"; the built check is `typeof x.builtAt === 'string' && x.builtAt`, as `tasks.listGroup`; the real-board CLI tests expect the activity word from the calendar day their setup ran (`ACT()`), so a run across local midnight passes.

## Tests
- engine/tasklist.next-8576.test.js: three new tests (paused plus held, four shapes and a control; a person's hold with a condition; builtAt shapes). Red on main's tasklist.js, the six older tests green.
- cli.task-list-across-7057.test.js: a real-board test that stores one id twice (a later record without the awaited task) and asserts the row still waits; red on main's server.js ("a repeated project id made the hold read as met"). It is last in the file and puts the store back.
- cli.task-list-mine-7992.test.js and -across-7057: `ACT()` for the activity word.

## Weakest premise
That nothing else reads `holdUntilMet` for a repeated id expecting an answer. Only the --all list sends it (#8576).

## Would change my mind
A real store with a repeated id that someone needs the met state for; then tag each row with its record instead.
