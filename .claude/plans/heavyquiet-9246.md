# kosmos#9246: round-8 follow-ups from the #9217 queued-heavy.sh caller

1. A caller that sets KOSMOS_RUN_MARKER_DIR to the real folder itself (a launchd job, a pinning wrapper) never
   announced. Decided: treat the real folder named explicitly as the real markers, so it announces as unset does;
   the folders are compared as physical paths (`CDPATH= cd -P`), so a trailing slash, `..` or a symlink does not matter;
   queued-heavy has already made the folder by then (line 407). Rejected: printing an
   "announce off" line whenever the markers are set, because every test points them at a private folder, so the line
   would print in every test's run and say nothing useful there; and naming it only in the plan, which leaves the
   real case silent. Weakest premise: the real folder is $HOME/.cache/kosmos-run-markers. A caller with a different
   HOME (a launchd job run as another user) is judged against its own HOME, which is also what queued-heavy uses. So a
   test with a sandbox HOME that names its own folder explicitly counts as real and announces (review round 1). Unset
   markers under a sandbox HOME already did, so this widens an existing exposure rather than opening one; tests keep
   QUEUED_HEAVY_ANNOUNCE=0 (run-tests.sh and this harness export it). Rejected: judging against the account's passwd
   home, which a test could then only reach through a test-only override.
2. A name holding control characters was reported as "asked the board" while the board refused it. Everything
   normalizeLabel refuses now becomes a space before the cut to 80: the C1 controls, U+2028/2029, the direction marks
   and the BOM, matched as UTF-8 bytes so a C locale strips them too (round 1 measured [[:cntrl:]] alone missing them
   there), then the ASCII controls. The board collapses runs of spaces. An emoji that pushes past 80 UTF-16 units can still be refused (noted in the
   comment, not fixed: the card asked for the likeliest refusal).

Tests (tools/test-queued-heavy-4977.sh, 217 -> 221): the real folder named with a trailing slash announces; a symlink
to it announces; a tab, newline and escape are sent as spaces on one line; under a C locale a line separator, a direction mark and a
C1 control are too. Each must red when its fix is removed.
