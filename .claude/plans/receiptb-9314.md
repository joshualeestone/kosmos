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
- engine/receipt-5153.test.js: #9323's cases stay; Baron's cases run as their own test (agent bdx9314, ids b2d to b2q; b2r to b2z were added by reviews 1 to 3).
  (Review 2 put #9323's `named.md` expectation back: a patch passed by name is read from its own literal now.)

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

## Review 2 (sonnet, measuring)
A 20,000-script fuzz against main: wrong names 87 here against 6,105 on main, but left-out names up from 0 to 1,611,
nearly all patches held in a variable in a ' or backtick string. Fixed by reading, when a call's argument is not a
literal, every string literal whose text starts with `*** Begin Patch` with its own quote (a literal counts only where
JavaScript can start one, so a heredoc word's closing quote, `<<'EOF'\n*** Begin Patch`, is not an opener). That reads
`named.md`, `a"b2.md` and `x"}}_c.md` whole, which the first slice and review 1 had left out or cut. A patch line may be
indented (a template literal). The span check is a moving pointer, so it stays linear (61 ms at 64k mixed calls).

Residual, accepted: a first member string that holds a header but is not the patch (`{note:"*** Update File: nn.md",
patch:...}`) is taken for the patch; Codex does not write that. A shell heredoc's own path is listed when the script also
has a non-literal call (as main listed it).

## Review 3 (opus, measuring)
Fuzz of 20,000 to 30,000 scripts per seed against main: wrong names about 2,650 here against 4,400 on main (most, on
both, are header text in comments or log strings read by the whole-script fallback; without that noise, 274 against
691); left out about 550 to 600 against 630 to 650. Two regressions it found are fixed: blanking with spaces let a
header-shaped string elsewhere run across a blanked string and swallow a real header (about 100 ordinary names left out);
strings are now blanked with newlines. A call written inside a patch held in a variable was read as a call and its span
overlapped the literal's; such calls are now dropped. Also: `]` in the run-on rule, and `| & ? !` before a literal.
Tests b2y (realn.md listed) and b2z (fakev.md not) fail on the commit before. Timing unchanged (linear, 13 shapes).
Residual, accepted: a ' or backtick piece read by the fallback with a name holding `")` (`o'k").md` reads `o'k`), fewer
than main; an escaped `\\n` before a header in an added line is read as a line start, as on main.
