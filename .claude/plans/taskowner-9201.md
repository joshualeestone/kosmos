# taskowner-9201 (kosmos#9201)

**Problem.** The long `kosmos task list` (install/kosmos and tools/windows/kosmos-cli.js) prints a task's owner after its words as " (name)" and an unowned task prints nothing there, so an unowned task titled "fix the login (otto)" printed exactly as one otto holds.

**Change.** One more rule in engine/markwords.js usesListMarkWord (#9188): a title whose last bracket of any kind (Ps or Pe, on the folded copy) is followed only by non-letters and non-digits is printed quoted, as "the task's own words, not a mark". Every list printer already calls usesListMarkWord, so no printer changes.

**Rejected.** Printing "(nobody)" for an unowned task, or a fixed word before every owner: either rewrites every row of both lists and every pinned test, to close a hole that only exists when a title ends in brackets. Matching only "(name)": nesting and lookalike closers pass.

**Cost, stated.** An ordinary title ending in brackets ("fix the build (again)") prints quoted, its words unchanged, wherever usesListMarkWord is called.

**Test.** cli.task-ownername-9201.test.js drives both CLIs against a real board; red without the rule (the forged row prints bare).

**Weakest premise.** That an agent reads the owner from that position at all (the card's).
