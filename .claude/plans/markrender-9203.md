# markrender-9203 (kosmos#9203)

**Problem.** engine/markwords.js usesListMarkWord is a hand-built list of the task list's mark words. Nothing kept it complete: a mark added to a printer later would be forgeable by a task's own title.

**Change.** cli.task-listmarks-render-9203.test.js renders a fixture per mark state through the four real printers (compactLines, acrossLines, the Windows taskList with a stub context, install/kosmos's long-list program lifted out of the script). Every bracket group outside the title must be caught by usesListMarkWord set mid-title (the [N] label and the owner's exact names allowed through), and the row's unbracketed words must be the printer's fixed columns. A second test checks the fixtures reach every field the printers read (a source-text scan whose seen and unseen read forms are listed in the test header). The markwords.js header comment now says what #9188 calls.

**Rejected.** Splitting groups on commas (turns harmless parts red); a scan that tries to cover every possible read form (a text heuristic cannot; the unseen forms are listed instead, with guards that fail loudly on the common renames).

**Weakest premise.** The field scan reads source text, so a printer rewritten in a form outside its stated list can pass unchecked.
