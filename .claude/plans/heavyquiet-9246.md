# kosmos#9246: round-8 follow-ups from the #9217 queued-heavy.sh caller

1. A caller that sets KOSMOS_RUN_MARKER_DIR to the real folder itself (a launchd job, a pinning wrapper) never
   announced. Decided: treat the real folder named explicitly as the real markers, so it announces as unset does;
   the folders are compared as physical paths (`CDPATH= cd -P`), so a trailing slash, `..` or a symlink does not matter;
   queued-heavy has normally made the folder by then (its mkdir -p of the marker folder; where that
   failed, only the exact spelling or unset announces). Rejected: printing an
   "announce off" line whenever the markers are set, because every test points them at a private folder, so the line
   would print in every test's run and say nothing useful there; and naming it only in the plan, which leaves the
   real case silent. Weakest premise: the real folder is $HOME/.cache/kosmos-run-markers. A caller with a different
   HOME (a launchd job run as another user) is judged against its own HOME, which is also what queued-heavy uses. So a
   test with a sandbox HOME that names its own folder explicitly counts as real and announces (review round 1). Unset
   markers under a sandbox HOME already did, so this widens an existing exposure rather than opening one; tests keep
   QUEUED_HEAVY_ANNOUNCE=0 (run-tests.sh and this harness export it). Rejected: judging against the account's passwd
   home, which a test could then only reach through a test-only override.
2. A name holding control characters was reported as "asked the board" while the board refused it. Everything
   normalizeLabel refuses now becomes a space before the cut to 80: the C1 controls, U+061C, U+200B/E/F,
   U+2028/2029, the direction marks and the BOM, matched as UTF-8 bytes so a C locale strips them too (round 1 measured [[:cntrl:]] alone missing them
   there), then the ASCII controls. The spaces it trims (NBSP, U+1680, U+2000-200A, U+202F, U+205F, U+3000) become plain spaces
   too, so the empty and leading-dash checks see them (round 2). All of it is one function, _qh_board_text. NOT DONE, and said so in the PR and on the card: a name of
   emoji (or other characters outside the BMP) past 80 UTF-16 units is still refused while the line says "asked the
   board", because bash cuts at 80 characters in a UTF-8 locale and an emoji is two units. The card scoped its fix to
   the likeliest refusal (control characters); a UTF-16 count in bash is code nobody asked for. Under a C locale the
   cut is by bytes, so it never exceeds 80 units.

Tests (tools/test-queued-heavy-4977.sh, 217 -> 222): the real folder named with a trailing slash announces; a symlink
to it announces; a tab, newline and escape are sent as spaces on one line; under a C locale a line separator, a direction mark and a
C1 control are too; and every BMP character normalizeLabel itself refuses or reads as a space comes out of
_qh_board_text as text it accepts, as exactly a space, in a C locale and the computer's UTF-8 one (the list is the board's,
so a missing entry reds; round 3 found the first version could not run in the harness and ran both passes in one
locale, and that U+3000 is the one entry [[:cntrl:]] never covers, so it proved little). Each must red when its fix is removed.
