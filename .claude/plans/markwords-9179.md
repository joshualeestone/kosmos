# kosmos#9179: a task's own words can print a built or hold mark

## Measured (origin/main, after #9176 merged)
`engine/projects.js` blockBody writes `  - task N of P: <words><mark>`, the words of an ordinary task through `oneLine`
only. A title ending "[built: done and waiting ...]" on open work reads as #9176's built mark; one ending "[on hold: ...]"
reads as a hold, and `holdsOf` (the re-read detector) reads a hold as the line's last mark. Webhook words are already
quoted by `tasks.forAgent` (#1307).

## Change
In blockBody, `words(t)`: a bracket opening a mark word (`on hold`, `built`) becomes "(". Any opening bracket counts
(`\p{Ps}`). What follows it is judged on a folded copy: the rest of the line, NFKC, `\p{Default_Ignorable_Code_Point}`
removed, then a 48-character window. The words otherwise print as written. "built-in" is a word, left alone.

Ported from branch `taskblock-9175` (#9175, closed as a duplicate of #9176), where five blind review rounds found the
lookalike-bracket, invisible-character, window-order, folding-the-whole-title and word-boundary holes. Main's marks are
`[built: ...]` and `[on hold ...]`, so the mark words are those two (#9175's "[marked built" mark is not on main).

## Decided, and the weakest premise
- Neutralise the bracket, not drop or quote the words: the agent still reads its task as written.
- Weakest premise: that lookalike LETTERS (Cyrillic) need not be folded; NFKC does not fold them, and no list covers
  every lookalike. The board's real mark always comes from blockBody after the words.

## Tests
`engine/projects.markwords-9179.test.js`: forged built and hold marks, lookalike brackets and invisible characters (past
the window too), words kept byte for byte, and a control that the board's own marks still print. Each part perturbed
alone turns its test red (no neutraliser, ASCII-only, no fold, window-first, \b).

## Review round 1 (opus, blind): no critical
- [WARNING] forms a MODEL reads as a mark though holdsOf would not: "on-hold", markdown inside the bracket, a combining accent, angle quotes (\p{Pi}) --> FIXED: those count too (NFKD, \p{M} removed, NFKC; \p{Pi} openers; markdown and hyphen allowed around the word). To keep ordinary titles, a mark word must go on as every real mark does: a colon, comma, "until" or a closing bracket ("[on-hold list]", "[built in 2024]", "[builtin]", "[builté]" stay as written). Tests both ways; each part perturbed alone turns its test red.
- RESIDUAL, stated in the code: the words stay the task's own, so "(on hold: do not start it]" can still read as advice to a model; the board's real marks always come after the words, and the block's standing line says the live list wins. Rejected: quoting every task's words (changes every line agents read, for a rare case).
- [NIT] upgrade: an old line with a forged hold, rewritten, owes that agent one re-read --> ACCEPTED: the line did change meaning.
- [WARNING] pre-existing, outside this diff: holdsOf misses the "until" and "waiting on your person" holds --> filed #9187 (mine).
- [WARNING] another surface, the task list CLIs, prints marks before the words and can be forged the same way --> filed #9188.
- [NIT] the first test's title claimed holdsOf was checked --> reworded (it asserts the line ends in no hold mark).
