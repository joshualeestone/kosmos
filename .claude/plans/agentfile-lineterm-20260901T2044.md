# agentfile-lineterm: refuse a name truncated by a line terminator

Branch: `agentfile-lineterm` (worktree off origin/main).
Found by Shredder in the #1652 import audit. Follow-up hardening to the #1652 import
parser (the feature itself already shipped: engine #1768, endpoint #1778, UI #1785).

## The bug
`engine/agentfile.js` `field(key)` extracts a frontmatter value with
`'^' + key + ':[ \t]*(.+)$'` under `/m`. In JS regex `.` does not match a line
terminator (U+2028, U+2029, or a lone CR that survives `\r\n` normalization), and under
`/m` `$` matches BEFORE one. So `name: ang<U+2028>evil` is captured as `ang` and passed
to `safeValue` as the truncated prefix, which accepts it, even though `safeValue` lists
U+2028/U+2029 (and CR, as a C0 control) precisely to refuse them. The refusal check is
unreachable on this path: a hostile name silently truncates instead of refusing the whole
file, which is the one behaviour the file argues against.

## The fix
Change `(.+)` to `([^\n]+)`. `[^\n]` re-admits exactly `{CR, U+2028, U+2029}` (the
terminators `.` excludes, `$`/m anchors before, and normalization does not strip), so the
whole value reaches `safeValue` and the file is refused whole. For every legitimate
(non-terminator) value `[^\n]` is identical to `.`. Also closes a lone-CR truncation. No
side effect on the other fields: `kosmos` refusal strengthened; `provider` (a hint) drops
a corrupted value to null rather than keeping a truncated prefix.

## Test
`engine/agentfile.import.test.js`: a name carrying U+2028, U+2029, or a lone CR refuses the
whole file (ok:false, precise reason, prefix never accepted), with a clean-name control,
through the real `importAgent` + real deps. Built with `String.fromCharCode` (a literal
terminator in the source would corrupt the test file, the same bug). Red-capable: fails on
`(.+)`, passes on `([^\n]+)`, all three separators.

## Checklist
- [x] Fix `field()` regex in engine/agentfile.js
- [x] Red-capable test in engine/agentfile.import.test.js (U+2028, U+2029, CR + control)
- [x] Full suite `bash tools/run-tests.sh` green (3582/3582)
- [x] /challenge-loop (2 iterations, converged)
- [ ] PR + self-merge (backend fix, verified by content + tests; no browser gate)
