# recordshelp-7991: say the records limits in the help text

Card: #7991, split from #7978 item 4. `kosmos records set` caps a status at 80 characters and said so only when refusing.

## Change
Both CLIs' usage lines end with the limits for name, status, source and label. A test keeps the sentence equal to the constants in `engine/records.js`.

## Decisions
- **Call: written out, and pinned by a test.** The card asks for "the one constant". A shell script cannot read a JS constant without starting node for a usage line, and the Windows CLI talks to the board rather than requiring the engine. Rejected: fetching the limits from the board, since usage has to print with no board. The test is what stops them drifting.
- **Call: all four,** since the card asks whether the others want the same, and one sentence covers them.
- **Not `engine/defaults.js`:** agents' instructions mention the verb, and adding limits there costs every agent's instruction file for a rule the refusal already states.

## Weakest premise
That usage is where a person or agent looks before the refusal. It prints on `--help` and on a wrong call. An agent that writes a long status correctly formed still learns from the refusal.
