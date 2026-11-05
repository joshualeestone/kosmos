# blankopen-7420: a chat that never drew is blank after 2 s (kosmos#7420)

Finished means: Josh's next capture of this shape shows a rebuild within about 4 s of opening, or he stops seeing a blank that
lasts until something else happens. Simulator cannot show it: no blank on demand.

Measured, Josh's phone 11-05 12:57: chat shown, keyboard flip, three settled looks "within, nothing drawn", none acted; the
list drew 6.6 s later when the app came back to the front. Cause read from source: two holds on the settled look (a chat that never drew was exempt, and
endVisible starts true before any end is drawn, so !endVisible refused it too); diagCheck's own 2 s rule was held off by
!topVisible (top appeared at open, no line says it left). The app was in front at diagCheck's reads, 329.4 and 330.4.

Change: one rule, Board.endNeverShown, read by both, and Board.settledBlankActs for the look. A rebuild restarts the clock. New trace lines (the top leaving, what held a blank off) so a capture can test the weakest premise. Back in front with nothing drawn the
clock starts again, since iOS can draw it by itself on return. Rejected: a timer that keeps rebuilding (rebuildsMax already bounds it, and
this runs on the existing asks); removing the exemption (a normal open draws within 2 s and must not rebuild).

Weakest premise: that topVisible is what held diagCheck off. Reasoned: the capture has no diag line, and it is the guard
that fits; the top marker's going is not traced. And a rebuild can itself land blank, as at 12:56.

Scope, stated: the rule covers any list whose end never showed and has nothing on screen, including one that drew a row and lost
it. Left as they were, deliberately: the two delayed re-checks for a reader higher up, which still ask for the end and top markers.
A fresh open reads at the newest, so they should not be reached; if one is, its return writes nothing, so a capture would not show it. Rows drawn with no end shown waits blankConfirm first, so a reader moved by nothing else is not moved for an instant's blank. And coming back to
the front restarts the 2 s, so repeated interruptions can delay a rebuild; that only leaves things as they were.

Cost accepted: on a chat's first blank report, or at the newest, a reader at the top of a chat whose end has never shown, with the
list blank and no finger on it, is rebuilt and sent to the newest. A blank screen keeps no place worth holding. Off the newest, the
later checks still ask for the end and top markers, so those can stay as they were.
