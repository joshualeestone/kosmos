# #9096 item 5: the re-read pointer leaves out lines that changed only in spacing or punctuation

## Problem (agent feedback 11-25, on the card)
The instruction-change pointer (engine/instructionreread.js changedLines) prints every changed line. Most of a day's
diff was rewording, and telling the two kinds apart took the agent longest. The list also ended in "more changed than
fits here", which forced several --how reads.

## Change
- A removed line and the line that replaced it, in the same run, are compared after normalising three things: spacing
  after the indentation, a single full stop directly after a word, and curly quotes to straight ones.
- Never normalised (reviews 1 and 2): a line inside a code fence or with a backtick span (compared exactly); ? ! ; :
  and any comma; a mark standing alone (`git add .`, `cd ..`); stacked dots (`main..`); leading indentation.
- A pair that is equal after that is counted and not printed.
- One note says how many lines were left out: "Not shown: N lines that changed only in spacing or punctuation (the rule
  reads the same)." It travels with the moved-line notes (kosmos#8743), so the room accounting, the cut and the
  only-notes return all handle it as they handle those.
- Runs left empty are dropped, so no empty fence is printed.

## Narrow on purpose
- Case still counts (-d against -D), and so do hyphens (--no-reply against --noreply) and every other symbol (> against
  <). A dot inside a word or path (a.b/c) still counts.
- Telling a paraphrase from a change in meaning needs judgement, so it is not attempted.
- A rewrapped paragraph moves line boundaries, so its lines do not pair up and are still printed. That part of the
  feedback stays open.

## Rejected
- Case-insensitive matching: a flag can differ by case alone.
- Stripping all punctuation: hyphens carry flags.

## Tests
engine/instructionreread-rewordonly-9096.test.js has 4 tests. A real change prints beside 2 counted lines; curly vs
straight quotes is wording only; CONTROLS: a flag, a case change, a symbol and a path dot still print; an unchanged
file prints nothing and a real change carries no note. With main's instructionreread.js, 2 of the 4 fail.
All 18 files that load the module: 759 tests, 0 fail.

## Reviews
- Round 1: BLOCKER, the normaliser stripped lone and stacked marks and ? ! ; : (git add ., cd .., ! cmd, Delete it?).
  Fixed: only . and , after a word. SHOULD: indentation was spacing. Fixed. NIT: the moved-heading sentence after a
  hidden line. Fixed (movedOf). NIT: an all-wording notice says lines are listed. Left (harmless).
- Round 2: SHOULD, stacked dots after a word (main..). Fixed: a single full stop only. SHOULD: a comma is syntax in
  code (JSON, args). Fixed: commas always count. NIT: quotes and spacing inside code. Fixed: code lines and backtick
  lines are compared exactly. NIT: a markdown hard break (trailing two spaces). Left (the rule reads the same).

## Weakest premise
That a pair matched by position inside one run is a reworded rule and not two different rules. The match needs the
normalised text to be equal, so a false pair would be two rules that read the same anyway.
