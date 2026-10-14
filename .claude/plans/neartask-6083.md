# kosmos#6083: near-identical tasks added in the same minute

## Change
engine/tasks.js adds `isNearTitle`, `nearOpen` and `NEAR_TASK_WINDOW_MS` (10 minutes). server.js task add appends a
weak note naming an open, lower-numbered task whose title is near the new one and that was added inside the window,
with the same project, people, parent, detail and done-when, and not on hold or under way. The note says to close
this new one only if it is the same ask, otherwise to ignore it. It comes first, so #5319's copyable command still
ends the line. #5319's exact-text note is unchanged, and a task it already names is not named twice.

## Near
Near means the same words in the same order, with case and the sentence marks at word ends set aside. Every
other character stays in its word, in its place, so swapped symbols are never near. A question mark counts. It also covers that same
sequence with ONE word added or dropped, but only when:
- the word is on a filler allow-list (now, please, pls, asap, the, an, soon, quickly, kindly, urgently), and
- both titles have 3 or more words.

It is never near when the numbers, the symbols, the negating words (English, German, French, Spanish, Portuguese)
or the flags differ.

## Decided
- No names guard. It refused the report's own case. Keeping word order covers swapped places instead.
- An allow-list, not a deny-list. A deny-list of meaning words leaked in reviews 1 to 3; under an allow-list, an
  unlisted word is a miss, which costs only today's behaviour.
- "a" is not filler, because it is often a label. "now" and "soon" are filler.
- Reordered titles are a deliberate miss. Two-word titles never take a word more.

## Weakest premise
That the report's pairs differ only by filler. The report's actual titles are not on the card; only their shapes are.

## Evidence
- server.task-near-6083: pure rows covering the near pairs and every #5319 counterexample, nearOpen fixture rows, a
  route test, a plural-note route test, and two concurrent adds. With server.task-same-text-5319: 9/9.
- Mutants red their tests: no filler allow-list; no done-when match; "a" put back on the list; the old word trim; "?" as a sentence mark.

## Review
1. opus: 2 warnings and 3 concerns, fixed in ce28a939a.
2. sonnet: 2 warnings and concerns, fixed in f315dc6d8.
3. opus: 1 warning (deny-list leak) and concerns, fixed in 8cd3fb26e.
4. sonnet: 1 warning ("a" is a label), fixed in 7b1a402db.
5. opus: 2 warnings (symbols compared as a set; combining marks trimmed) and a concern ("?" set aside), fixed in
   28d73bfbc with the plural note tested and "ignore this note".
6. sonnet: 2 warnings (a wrapped flag was not a flag; an en-dash minus was set aside), fixed in efc40355b.
7. opus: 1 warning (".5" near "5") and concerns, fixed in 1c73d4d14; it also exposed that my review-5 replace-all had removed
   #5319's own-parent guard in sameTextOpen. Restored; the branch removes no line of #5319's function.
8. sonnet: no blocker or warning; #5319 unchanged, checked by reading the whole diff. Converged.
