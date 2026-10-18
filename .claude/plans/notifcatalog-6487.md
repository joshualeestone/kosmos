# notifcatalog-6487 (kosmos#6487)

Josh, 2026-10-18 09:43: "We should configure a list of all of the message types we could send and document."

## Done means (this branch)
docs/phone-notifications.md lists every event that can reach a phone today and the proposed ones, with the exact
title and body, the switch and its default, how often it repeats, and shipped / built-not-on / proposed. The code side
(apns.rs, the coordinator's sw.js, web/sw.js sending exactly the "Wording" table, with drift tests) is Ice Cream
Kitty's, after #6488; this branch is the doc.

## Sources
engine/phonenotify.js (kinds, per-kind defaults, cooldowns); server.js call sites; kosmos-relay coordinator/src/apns.rs
`payload`; the push path's owner's table on #6487 (issuecomment-6251252270) and the email note (6251397328).

## Decided
- Plain templates now: title "<Agent> needs you|replied|posted|has work ready for you"; body "in <Project>" ("in", as
  Josh wrote it), and no body when there is no project (the old "in Kosmos" says nothing).
- Message words stay PROPOSED: they would put a message's text through the coordinator and Apple, which today never
  see it. Option 2 (the phone fetches the words from the computer itself, on iPhone, Android and the browser) is recommended; the call is Josh's.

## Weakest premise
That dropping the body when there is no project reads well on the lock screen (a title alone). If it reads bare, "in
Kosmos" can come back in one line of the table.
