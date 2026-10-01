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
up from 33px and 45px with "You". Floor raised from 1.25em to 2.5em (52px at 130%, 60px at 150%).
Also closes #4848's round 2 warning: a long person's name can no longer push the computer name to a second row.
