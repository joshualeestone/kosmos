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
On main the new test fails with `hb.md"});`, ``esc.md`});`` and `h.md` listed; here all 45 receipt tests pass,
including #9323's two timing tests (32,000 headers on a line, 16,000 alternating openers).

## Weakest premise
Baron's last commit (e42e56801c: a first member that is not the patch, the escape arm, an unterminated string, one-pass
blanking) landed after his last review, and his full validation never ran; both are done here.
