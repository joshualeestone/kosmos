# tasknum-5175: kosmos task add says the new task's number

Ask: #5175 (from #5152 slice 0 review round 3). Splinter 2026-10-03 15:04: Mona Lisa builds it, both CLIs, a test each.

## Done looks like
- install/kosmos and tools/windows/kosmos-cli.js answer "Task N added to <project>..." with N the number the board
  stored. The board answers {"task":{"number":N,...}}, number as the task's first key (engine/tasks.js).
- An answer with no usable number (missing, a string, 0, a fraction, a number only inside the sentence) keeps the
  old sentence, "Task added to ...", never a wrong or blank number.
  - Mac reads only the fixed leading position: digits starting 1-9 and ending the value (followed by , or }).
  - Windows needs a positive integer.
- cli.task-number-5175.test.js: both CLIs against a real board (the number said = the stored one, counting up, with
  and without --who), and against a stand-in board for the odd answers.

## Measured
- New file 4/4.
- Run against main's CLIs: both "says the number" tests red.
- Mutant (Mac accepts a leading 0): the Mac fallback test reds.
- Related: cli.task-who-4887, cli.task-2662, cli.agent-token-verbs-4491, cli.unknown-flag-4889: 140/140.
- All 23 tools.windows-kosmos-cli*.test.js: 300/300.
- No test or doc quoted the old sentence except an old plan file.

## Not done here
- Doctrine v24 still says "run kosmos task list right after and note your number". Still correct, now redundant;
  changing it is a doctrine bump, for later.
