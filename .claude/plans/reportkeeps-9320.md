# reportkeeps-9320 (kosmos#9320)

**Problem.** A status card holds one state. So when an agent with an open question to its person (needs_you) reported something else (`kosmos report blocked`, or a typed working or idle), the question left the board, and the command answered only "Recorded". Nothing told the agent its question was no longer showing.

**Change.**
- `selfreport.record()` reads the standing state before writing. When an agent's own report is not needs_you and not `clear`, and the standing state is a deliberate needs_you (not an automatic permission prompt), the report still lands, and the answer carries `replacedQuestion`.
- /api/report puts a note first, through `selfreport.replacedQuestionNote()`: "This also took your open question to the person off the board ('<the question>'). If it still stands, ask it again with kosmos report needs_you." Both CLIs already print the note.
- The note holds no double quote, backslash or newline, because the macOS CLI lifts it with sed up to the first double quote. The question is quoted with single quotes and cut at 120 characters.

**Rejected.** Keeping the question alongside the blocked state (the card's other option). Every board reader renders one state per card, so two states would touch all of them for the same outcome.

**Not warned, on purpose.** `clear`, which is the agent saying its wait is answered. An automatic write, which record() already refuses over a deliberate wait. Replacing an automatic permission prompt, which is no question anybody asked.

**Measured.**
- server.replacedquestion-9320.test.js is 4/4, three times. Its controls: a blocked report with no question standing gets no such note; clear gets none; replacing a permission prompt gets none.
- Mutants: with the route line removed, 2 tests go red; with record()'s check removed, 3 go red.
- The 159 test files that name selfreport or /api/report are run through queued-heavy.sh.

**Weakest premise.** The note is advice, not a block: an agent that ignores it still loses the question. The card asked to be told, and blocking a report would stop an agent from saying what it is doing.
