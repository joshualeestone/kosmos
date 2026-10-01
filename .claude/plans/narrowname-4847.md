# narrowname-4847: the top-left computer name gets room on a phone

Card: kosmos#4847 (mine; follow-up from the 0.7.15 cut fix #4848).
Finished looks like: on a 320-wide phone at 130% and 150% text the top-left computer name shows a few letters (not
"Th..."), with a long person's name in the header too, and render-dm-chatfirst-718 asserts a floor for it.

Change: on a phone (40rem) the person's menu shows their face and the arrow; their name is hidden visually and stays
the button's accessible name. The computer's name takes that room.
Rejected: tightening the K-to-name gap (gains a few pixels, not letters); leaving it.
Weakest premise: that a person does not need their own name in the header on a phone; their face is there, and the
menu it opens says who is signed in.

Measured (Agent1s, 03:49, 02398c995, with a long person's name set): 62px at 320 wide (130% and 150%), 85px at 375,
up from 33px and 45px with "You". Floor first raised to 2.5em, then (round 1, CI) set to a fixed 40px: see below.
Also closes #4848's round 2 warning: a long person's name can no longer push the computer name to a second row.

URGENT, found by review round 1 (opus, 04:14): MAIN IS RED IN CI since #4848 (run 36821115449, head 052800f29, merged
on Mortals' path C results without waiting for CI). On CI's fonts, at 320x568 and 150% text, the computer name still
wrapped to a second row (sameRow false, w 64, conversation threadH 8): the 2.25rem floor plus the K mark did not fit
beside the right-hand controls. This branch now fixes main too: min-width 0 on the name (it can only shrink, never
force a wrap), plus the hidden person's name for room. The check's floor is a fixed 40px (the room is fixed pixels now;
a text-relative floor had 2px slack at 150%). Merge only on THIS branch's own green CI.
R1 (opus) 0B 2W 1C 3N: the 150% floor too tight for CI -> fixed 40px; "the menu still says who is signed in" was false
-> wording corrected (on a phone the name shows nowhere; the face is the sign); hand-written hidden rule -> .vh's full
pattern; NITs: injected name put back; #3051 comment; the .worldsw CSS floor (card item 2) is now 0, not raised, by
the CI finding.
R2 (sonnet) 0B 0W 0C 4N: CONVERGED at round 2. After convergence: the stale "room for its arrow" comment and this plan's
floor line corrected. Left: a chevron-inside assert; the put-back in a finally.
