# livewords-6487 (kosmos#6487 follow-up)

The catalog said the new wording was "not yet in force" and the master switch was off by default. Since then:
kosmos-relay #451 deployed (coordinator 18e6ac3e, per the push path's owner) with push.rs `notice_text` shared by apns.rs
and coordinator sw.js, giving "in <Project>" or no body, and the test notice keeping "in Kosmos" (read at 18e6ac3e).
Board side: #6502 (web/sw.js, merged) and #6500 / #6488 (on by default once connected, merged; engine/phonenotify.js
header) ship with 0.7.58.

## Change
docs/phone-notifications.md: the wording is in force on the coordinator; the "today" table's bodies become the new ones
(test notice unchanged); the master switch is described for up to 0.7.57 and from 0.7.58; the email paragraph now says
the auto turn-on makes every connected computer eligible; "Where the code lives" names push.rs notice_text.

## Decided
The room tap (#6254) is in 18e6ac3e too, so it is described as live with the wording. The Settings email hint is gone from
0.7.58 (#6489 merged).
Attribute the deploy to the push owner (not measured here) and say nobody has seen the words on a real phone.

## Weakest premise
That coordinator 18e6ac3e is what serves production now; the deploy was reported, not measured by me.
