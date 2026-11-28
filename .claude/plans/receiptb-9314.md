# receiptb-9314: a Codex patch is read from each apply_patch call's own string (kosmos#9314, second slice)

## Finished looks like
The task receipt never lists a wrong file name for a Codex agent's patch: a path is read from inside the string argument
of the `tools.apply_patch(` call it belongs to, so text elsewhere in the script (a shell heredoc, a quote before Begin
Patch) cannot decide where it ends. Where a call's argument is not one literal string, the rest of the script is read as
before, and a path there that ran on into code is left out rather than listed.

## Why a second slice
#9323 (merged) ended a path at the quote just before the nearest `*** Begin Patch`. Five shapes broke that guess: three
found in its own review, and two Baron Draxum measured on main afterwards (a heredoc's closing ' before a later patch
listed `hb.md"});`; an escaped quote before Begin Patch in a backtick patch listed ``esc.md`});``). Baron had built the
principled reader in parallel on receiptquote-9314 (8 review rounds; its plan is .claude/plans/receiptquote-9314.md on
that branch) and handed it over (Fleet Builders, 10:45 CST).

## The change
- engine/receipt.js: Baron's reader, taken whole from receiptquote-9314 at e42e56801c (it replaces #9323's
  codexPatchPaths). Added here: in the whole-script reading, a path that ran on past its real string (a quote then
  `)` `;` `+` `}` `,`) or holds `${` is left out.
- engine/receipt-5153.test.js: #9323's cases stay; Baron's cases run as their own test (agent bdx9314, ids b2d to b2q).
  One #9323 expectation changes: a '-string patch built in a variable and passed by name (`named.md`) is now left out,
  not read, because the whole-script reading cannot see its quote. Left out, never wrong.

## Measured
On main the new test fails with `hb.md"});`, ``esc.md`});`` and `h.md` listed; here all 45 receipt tests pass (35 in
receipt-5153, 10 in receipt-project-6842), including #9323's two timing tests (32,000 headers on a line, 16,000
alternating openers).

## Weakest premise
Baron's last commit (e42e56801c: a first member that is not the patch, the escape arm, an unterminated string, one-pass
blanking) landed after his last review, and his full validation never ran; both are done here.

## Review 1 (opus, measuring)
Linear on every shape timed (to 64k repeats, ten shapes). Fixed: main's filter for a path that swallowed further headers
was dropped (`a.md *** Delete File: b.md` listed as one file); the 32,000-header test had stopped exercising it (a space
before the first header, so the new line anchor never matched), now with a newline variant. A member string with no
header is skipped for the call's next `key:` string (`{cwd:'x', patch:'...'}` lost its patch). In the whole-script
reading a stop at the assumed " counts only where code follows it (`a"b.md` in a '-string was cut to `a`). The
concatenation check skips any run of whitespace, not 64 characters. Mutation: with the swallowed-header filter removed,
two tests go red.

Residual, accepted: in the whole-script reading (a patch passed by name, or built in pieces) a '-string name that itself
holds `")` or `", ` followed by more is cut there (`odd").md` reads `odd`). No realistic file name has that; main read
these right through #9323's opener guess, whose five failure modes are why this reader replaced it. And a '-string
patch passed by name whose last path ends at its quote (`last.md'`) is left out.
