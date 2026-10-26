# restorereview-5536: the review list before a restored agent is enabled (kosmos#5536 slice 4a)

Design: #5536 comment 6407859949 (sections 2 and 6 of the card). A snapshot never holds Kosmos's store, so a restored
agent is files only; what can act on the successor's accounts is what those files tell a model to do, written by
someone who may be hostile. This module produces the list a person reads, one agent at a time, before enabling it.

## The call
- `engine/restorereview.js` `reviewAgent({ name, files, templates? })`: each instruction file (CLAUDE.md,
  CLAUDE.local.md, AGENTS.md, GEMINI.md) diffed in order (LCS, blank lines included) against the closest built-in role
  template; every other file wholly added; every added line returned with its text; removed template lines per
  instruction file; flags on added lines (url, credential, schedule, invisible, hides, long); `unreviewed` for anything
  not fully read; `flagged` true when anything at all needs a look. It decides nothing.
- Comparison is on the text as written: leading whitespace kept, only spaces and tabs collapsed, no NFKC, no stripping
  of invisible characters, lines split where Markdown splits them (LF, CR, CRLF). NFKC, tag-character decoding and
  defanging apply only to the copy the flag patterns search.
- No Markdown parser: after the first added line that could open a hiding region (backtick, square bracket, tag-like
  '<', '~~~', '-->'), or an added or removed blank line, or a removed template marker, every later template line counts
  as removed.
- A name is written into the baseline only if it has a strict name shape; otherwise the placeholder stays and every
  line holding the name is added.
- Budgets: 512 KB per file, 4 MB in all (instruction files first), 200,000 lines and 1 MB of characters tested, 4 KB
  per line tested, flags capped per kind. Past any budget the rest is listed and the file is unreviewed.

## Review rounds (blind, security-focused, one fresh reviewer each; stopped at the 8-round cap, not converged)
1. B: the name entered the baseline (newline payload); two quadratic patterns; cut or non-text files read clean.
2. B: invisible tag characters stripped before comparing; a set baseline ignored order and file.
3. B: a sentence-shaped name; W: shown window off the match, budget order, cost.
4. B: indented blocks and fence/comment desyncs hid rules; W: quadratic opens, contract, name.
5. B: tag names listed (div hidden, svg, <?); W: cost per line.
6. B: link titles and code spans over several lines; W: line budget order.
7. B: NFKC folded a full-width fence; a deleted template fence re-paired the rest; W: backtracking cost.
8. B: U+2028 split lines Markdown does not; W: blank lines left out of the diff.
All fixed; each round's commit message lists its changes.

## Rejected
- A Markdown parser for hidden regions: three rounds showed a hostile file can always desynchronise it.
- Folding (NFKC, invisible stripping) before comparison: each fold let different text compare equal.
- A clean result when anything was not read.

## Residuals, stated
- Noise: a member who adds a bracket, a backtick, a placeholder or a blank line to an instruction file makes every
  later template line show as removed.
- A plain four-word name is written into the baseline, so the screen must show the name as unreviewed content.
- The 4 KB per-line test cap's cost role is not pinned by an arm (no input stayed slow without it).
- Flags are hints: a missed flag for an unusual phrasing still leaves the line listed as added.

## Weakest premise
That the screen will honour the header's contract (show every added line and every removed one, treat unreviewed as
unread, render invisible code points visibly). Slice 4c builds it; this module cannot enforce it.
