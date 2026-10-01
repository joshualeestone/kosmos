# chatfirst-4822: the 0.7.15 cut blocker from #4822 (the top-left computer name on a phone)

Reported by Baron Draxum, 2026-10-01 00:28: the 0.7.15 staging cut stopped at step 3b on ONE browser check,
render-dm-chatfirst-718.js, deterministic (3 of 3 alone on Mortals, 2 FAIL / 407 PASS):
- [chromium 320x568 swarm] #4661: at 150% text the conversation keeps at least a line (threadH=4)
- [chromium 320x568 swarm] with notes showing too, the Swarm Settings pill stays on screen and the thread keeps room
  (threadH=35, needs 60)
Control: 409/409 on 0.7.14's tree (47133e513). Bisect: first bad commit 95e96357c (#4822, mine).

Finished looks like: the check passes on main, the top-left still names this computer (#4815), and nothing above
40rem changes.

Cause (read from the #4822 diff, then confirmed by the fix's result): #4822 shows the top-left name on every
one-Kosmos board (sw.hidden = false); before, a one-Kosmos board hid it, and the check's page is one. Below 720px
.headleft may wrap, so at 320 wide and 150% text the name took a second header row (about 30px).

Fix: on a phone (40rem) the name truncates on the K mark's row: the header's left column is minmax(0, 1fr) beside
the right-hand controls, .headleft may shrink, and .worldsw has flex basis 0 so it shrinks before it wraps. Notices in
the row still wrap onto their own row.
Rejected: hiding the name on a phone (it is #4815's point: which computer you are on); a fixed max-width (the right
column's width varies with the person's name).
Weakest premise: that a truncated name ("This comp...") on a 320-wide phone at 150% text is acceptable; the full name is
in the menu it opens when there is somewhere to go.

Validation (all on 89a0d27fc, run by Baron on Mortals, headless chromium): render-dm-chatfirst-718 409/0;
render-onekosmos-4815 56/56; render-tophead-stable-2624 OK; render-worldsw-lockout-3055 1/0; render-plus-bar-3837
19/0; render-worldsw-height-2350 0 FAIL; render-computers-4648 88 passed, no problems. web.* 2224/0 here.

Review R1 (opus) 0B 3W 0C 3N: a showing notice could squeeze the name (now takes its own row); the 220px cap was lost
(restored); no arm proved the name readable (added to render-dm-chatfirst-718). NITs taken: arrow room (2.25rem),
.headleft stretches to its column (WebKit).
Baron on Mortals at 674288bc7: six header checks green; render-dm-chatfirst-718 411/2, both fails my new arm's invented
"two characters" floor: the name measured 33px at 130% and 45px at 150% ("Th..."). Floor reset from the measurement to
1.25em (passes one letter plus the ellipsis, fails the ellipsis alone). Accepted cost: about two letters of the name on
a 320-wide phone at large text. Possible follow-up (not in a cut fix): hide the person's name beside their avatar on a
phone to give the computer name room.
Review R2 (sonnet) 0B 2W 0C 2N: a long person's name on the right could still push the computer name to a second row at
320 and 150% text; the 2.25rem floor leaves almost no letters (the new arm then fails, as intended). Both filed on #4847
(claimed: Mona Lisa) on Splinter's ruling (00:40): ship the conversation-height fix for the 0.7.15 cut, file the rest.
Final validation on 9f7402842 (Baron, Mortals): render-dm-chatfirst-718 413/0 twice; web/ unchanged since 674288bc7,
where render-onekosmos-4815 56/56, render-tophead-stable-2624 OK, render-worldsw-lockout-3055 1/0,
render-plus-bar-3837 19/0, render-worldsw-height-2350 0 FAIL, render-computers-4648 88/0.
