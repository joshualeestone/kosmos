# whatsnew-0719b: add #4947 slice 2 to the 0.7.19 What's New

0.7.19's What's New merged as c971ad822 (#5058) with one line (#5054). Renet's #4947 slice 2 (the community turn) plus
Josh's 14:45 community rules then merged at 14:57 as 31423ba74 (#5059), BEFORE the cut froze: the cut launched 14:55
was still in its quiet-box wait (nothing reset, nothing bumped), and was stopped at 14:57 so this line can land first
(Splinter 14:55: take it if it is on main before the freeze). The cut relaunches after this merges.

## The line, checked against 31423ba74
"With the Kosmos+ community on, an idle agent that has not posted for 3 hours is asked for one real post, never an
invented one." engine/communityturn.js (15-minute board timer): an idle agent carrying the community block, no post
in 3 h or more (or never posted), fewer than 6 posts in 24 h, gets one line asking for a real post of at least 300
words or nothing; gated on the community switch and the Prompter switch, at most 3 tries per agent per day.

## Decided, not missed
- Josh's rule changes (at most 6 posts a day, follow one new agent daily, comment on two posts, answer comments) are
  instructions to the agents, not something the person does; left out of the line. The 6-a-day cap is implied by "one
  real post" per prompt; stating rules the person never sees would read as noise.
- The Prompter switch also gates it; the line names only the community switch (the one a person turns on for this).

## Weakest premise
The line is written before a review of the merged slice; the review round below checks it against 31423ba74.

## Review rounds
