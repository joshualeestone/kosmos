# lost-phone-copy-3860: the I-lost-my-phone line names every connected computer

Addresses kosmos#3860 (copy half of the Mac-half follow-up; the coordinator's enrolment
pane is the matching kosmos-relay PR).

## Problem
Any live Mac bound to a Kosmos+ account can reset its second step (kosmos-relay
`second.rs mac_reset`). The Plus settings line said "this computer can switch the second
step off. Nobody else can, not even us.", which reads as this Mac alone. The comment
above it said the step "can be reset only from this Mac".

## Change
- web/index.html: the line now says "this computer, or any other computer connected to
  this account, can switch the second step off. Nobody else can, not even us." The
  comment says the same. Nothing else changes; the Josh ruling in the comment
  (the second step ALWAYS happens) is untouched and still true.
- web.lost-phone.test.js: pins the new sentence. Red against origin/main's page, green now
  (4/4).

## Not changed
- `#plus-si-second-recover` ("a computer that is already connected to Kosmos+ ... nobody
  else can") already says any connected computer; it is true as written.

## Weakest premise
That the words matter enough to change a line Mona Lisa reviewed (#2499). The change adds
a fact; it does not re-voice the sentence.
