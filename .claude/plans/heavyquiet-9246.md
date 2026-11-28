# kosmos#9246: round-8 follow-ups from the #9217 queued-heavy.sh caller

1. A caller that sets KOSMOS_RUN_MARKER_DIR to the real folder itself (a launchd job, a pinning wrapper) never
   announced. Decided: treat the real folder named explicitly as the real markers, so it announces as unset does;
   the comparison drops trailing slashes and follows a symlink when both folders exist. Rejected: printing an
   "announce off" line whenever the markers are set, because every test points them at a private folder, so the line
   would print in every test's run and say nothing useful there; and naming it only in the plan, which leaves the
   real case silent. Weakest premise: the real folder is $HOME/.cache/kosmos-run-markers. A caller with a different
   HOME (a launchd job run as another user) is judged against its own HOME, which is also what queued-heavy uses.
2. A name holding control characters was reported as "asked the board" while the board refused it. Control
   characters (bash's [[:cntrl:]]) now become spaces before the cut to 80, so the label is sent on one line; the
   board collapses runs of spaces. An emoji that pushes past 80 UTF-16 units can still be refused (noted in the
   comment, not fixed: the card asked for the likeliest refusal).

Tests (tools/test-queued-heavy-4977.sh, 217 -> 220): the real folder named with a trailing slash announces; a symlink
to it announces; a tab, newline and escape are sent as spaces on one line. Each must red when its fix is removed.
