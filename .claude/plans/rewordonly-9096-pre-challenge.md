---
pre_challenge: true
method: challenge-loop
branch: rewordonly-9096
diff_hash: a76a960334aad4314ace53cb1af7b4959d6bd1866924b3dc1955e2223d23b931
validation: passed
subdir_audit: passed
timestamp: 2026-11-26T13:52:00Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6 blind review rounds, each a fresh agent given the diff and the card. From round 2 on, each was also told what the earlier rounds found, and asked to judge the code itself.
**Converged:** Yes. Round 6 found 0 BLOCKERs and 0 SHOULDs. It fuzzed 300,000 random pairs, a 2 MB line and a 1,990-line run with no crash. One of its NITs is fixed, and the other is left, with the reason in the plan.
**Change:** engine/instructionreread.js `changedLines`. A removed line and its replacement in one run are counted in one note ("Wording only, so left out: N lines ... (the rule reads the same).") and not printed when both of these hold:
- the only difference is spacing, or one full stop at the end of a line that ends its paragraph on both sides;
- neither line is code (a fence line or inside a fence, an indented block, a backtick) or contains a quote mark.
The scans fail safe: if one throws, nothing is hidden. Full detail of every round: .claude/plans/rewordonly-9096.md.

## Validation
- Full validation on this Mac (validation_log_run_or_skip), head b164665901: node suite 0 fail; test:shell 4 shards all green; "validation PASSED for stack=typescript hash=a76a960334aa", status clean.
- engine/instructionreread-rewordonly-9096.test.js: 11 tests. Every review fix was perturbed, and its check went red. One check that could not fail (a pair where only the new side is code, which no layout reaches) was removed and recorded. All 18 files that load the module: 766 tests, 0 fail.
- Subdir audit: the branch changes no subdirectory CLAUDE.md.

### Per-Iteration Breakdown
#### Iteration 1
- BLOCKER: lone and stacked marks and ? ! ; : were stripped (git add ., cd .., ! cmd, Delete it?) --> FIXED
- SHOULD: indentation was treated as spacing --> FIXED
- NIT: the moved-heading sentence after a hidden line --> FIXED (movedOf). NIT: an all-wording notice says lines are listed --> LEFT (harmless)
#### Iteration 2
- SHOULD: stacked dots after a word (main..) --> FIXED (a single full stop only)
- SHOULD: a comma is syntax in code (JSON, args) --> FIXED (commas always count)
- NIT: quotes and spacing inside code --> FIXED (fence and backtick lines compared exactly). NIT: markdown hard break --> LEFT
#### Iteration 3
- SHOULD: a nested, tab-indented or quoted fence was not code --> FIXED. SHOULD: an indented code block --> FIXED
- NIT: a full stop inside a line was stripped --> FIXED (end of line only). NIT: no test reaches a new-side-only code pair --> measured unreachable; the misleading test removed
#### Iteration 4
- SHOULD: a closer deeper than its opener + 3 closed the fence --> FIXED. SHOULD: 3 spaces + a tab is an indented block --> FIXED
- NIT: curly quotes in a command outside backticks --> FIXED more broadly (any quote mark means compare exactly; curly quotes no longer normalised)
#### Iteration 5
- SHOULD: a line-end full stop in a hard-wrapped paragraph splits a sentence --> FIXED (only where the line ends its paragraph on both sides)
- NIT: an inline ```span``` opened a fence --> FIXED. My first fix crashed codeOf; the new test caught it, the branch was guarded, and the scans were made fail-safe.
#### Iteration 6: CONVERGED
- NIT: the note and the cut note both began "Not shown:" --> FIXED. NIT: spacing inside raw HTML <pre> --> LEFT (rare in instruction files)

## Weakest premise
That spacing and a final full stop are where much of the noise is. If most rewording is real paraphrase, the note rarely fires.
