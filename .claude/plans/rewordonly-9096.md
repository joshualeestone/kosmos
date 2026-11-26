# #9096 item 5: the re-read pointer leaves out lines that changed only in spacing or punctuation

## Problem (agent feedback 11-25, on the card)
The instruction-change pointer (engine/instructionreread.js changedLines) prints every changed line. Most of a day's
diff was rewording, and telling the two kinds apart took the agent longest. The list also ended in "more changed than
fits here", which forced several --how reads.

## Change
- A removed line and the line that replaced it, in the same run, are compared after normalising two things only:
  spacing after the indentation, and a single full stop that ends the line right after a word, ONLY when that line
  ends its paragraph on both sides (the next line is blank, the end, or starts a list item, heading, quote or fence).
- Compared exactly, so never hidden (reviews 1 to 4): code (a fence line or inside a fence, at any indentation or quote
  depth; an indented block of 4 columns, tabs counted to the next stop); any line with a backtick or a quote mark
  (straight or curly); and every other mark: ? ! ; : , a lone mark (`git add .`), stacked dots (`main..`), a full stop
  inside a line, leading indentation, case, hyphens.
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
engine/instructionreread-rewordonly-9096.test.js, 9 tests: a real change prints beside counted lines; CONTROL rows (each a
pair that must print): a flag, a case change, a symbol, a path dot, a lone mark, a negation, a separator, a URL query,
a question, indentation, a git range, commas (JSON, args), backtick spans, a full stop inside a line, a quoted command
outside backticks, a 2-space-plus-tab indent; fences (nested, tab, quoted, indented block, a closer deeper than its
opener + 3); the moved-heading sentence; a cut list keeps the cap and ends with the cut note.
Each review's fix was perturbed and its check went red. All 18 files that load the module: 766 tests, 0 fail.

## Reviews
- Round 1: BLOCKER, the normaliser stripped lone and stacked marks and ? ! ; : (git add ., cd .., ! cmd, Delete it?).
  Fixed: only . and , after a word. SHOULD: indentation was spacing. Fixed. NIT: the moved-heading sentence after a
  hidden line. Fixed (movedOf). NIT: an all-wording notice says lines are listed. Left (harmless).
- Round 2: SHOULD, stacked dots after a word (main..). Fixed: a single full stop only. SHOULD: a comma is syntax in
  code (JSON, args). Fixed: commas always count. NIT: quotes and spacing inside code. Fixed: code lines and backtick
  lines are compared exactly. NIT: a markdown hard break (trailing two spaces). Left (the rule reads the same).

- Round 3: SHOULD, a fence indented 4+ spaces, by a tab, or in a > quote was not seen as code. Fixed (any indentation
  and quote depth). SHOULD: an indented code block. Fixed (4 spaces or a tab is code). NIT: a full stop inside a line
  ("1. Push", "merge. Wait") was stripped. Fixed (end of line only). NIT: no test reaches a pair whose NEW side alone
  is code. Measured: with the new-side flag forced false, every layout I could build still shows the pair, because
  pairs match by position and the fence line itself pairs first. A test that cannot fail was worse than none, so it
  was removed; the flag stays as a guard.

- Round 4: SHOULD, a ``` deeper than its opener + 3 closed the fence early. Fixed. SHOULD: 3 spaces + a tab is an
  indented block. Fixed (tabs to the next stop of 4). NIT: curly quotes in a command outside backticks. Fixed more
  broadly: any line with a quote mark is compared exactly, and curly quotes are no longer normalised at all (each round
  found another Markdown corner, so the rule was narrowed instead of extended). NIT: this Tests section was stale. Fixed.

- Round 5: SHOULD, a line-end full stop inside a hard-wrapped paragraph splits a sentence. Fixed: stripped only where
  the line ends its paragraph on both sides. NIT: a line starting with an inline ```span``` opened a fence. Fixed (a
  backtick opener whose rest holds a backtick is not an opener). My first version of that fix crashed codeOf (a null
  fence read in the closer branch); the new test caught it, the branch is guarded, and the scans now run inside a
  safety net that, if one ever throws, treats every line as code (nothing hidden, the list printed whole). No input
  reaches the net today, so it has no test of its own.

## Weakest premise
That a pair matched by position inside one run is a reworded rule and not two different rules. The match needs the
normalised text to be equal, so a false pair would be two rules that read the same anyway.
