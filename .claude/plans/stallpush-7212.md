# stallpush-7212: tell the person when an agent's messages have been stuck for half an hour (kosmos#7212, #7615 item 1)

## The gap
Main already finds the stall: deliverystreak marks an agent no message has been seen to reach for 30 minutes,
whatever the cause, the card reads "Messages stuck", and server.js sayStalls writes it to the board log once per
stall and again each day it lasts. Nothing reaches the person away from the board. A crash loop, a stuck terminal and
a helper that gave up each push needs_you to the person's phone (phonenotify.happened with their own id); a stall
does not. Josh's 0.7.75 report: an agent unreachable for 10 days, no warning.

## The change
- server.js sayStalls: for each stall it says (stallsToSay: once per stall, again each day), also
  phonenotify.happened({ kind: 'needs_you', id: 'stall:<session>:<since>', agent, session, project: null }).
- Windows' stuck turn (#7368, turnsToSay): the same, id 'turn:<session>:<since>'. turnsToSay takes an optional
  tell(sessionName, stall) callback, so its return value (log lines) is unchanged.
- The phone shows the plain needs-you for an id it cannot ask about (phonenotice idKind: unaskable), as for crashloop:.
  No coordinator or phone change. needs_you's per-agent cooldown still applies.

## Rejected
- Typing into the project manager's conversation (accountnotify's way): the manager is an agent; the ask is the person.
- Making the phone able to ask for the stall's words: a phone-side change, not needed to tell the person.

## Weakest premise
Streaks live in memory, so a board restart starts each again: a long stall is pushed again only after 30 more minutes
following each restart, at most once per restart, and never more often than needs_you's cooldown.

## Tests
engine/stallpush-7212.test.js: the push fires once per said stall with the stall id, not for a stall the card does not
show, not for a usage-limit-only streak, again after a day; the turn callback; and the wiring in sayStalls.

## Review rounds
- Round 1 (Sonnet): no BLOCKER. Each agent's stall is pushed at most once a day (deliverystreak.pushDue, kept in
  stall-pushes.json under the data root), so a board restart or a stall that ends and starts again does not push again.
  A stall's needs-you keeps its own cooldown class in phonenotify (the board-side `stall` flag, never sent), so it and a
  permission prompt's buzz do not swallow each other. The id ends with the stall's day, so each day is its own event.
  Left as it is: the session is the roster's sessionName, as the needs_you report path uses (crash loops use safeKey).
  Also found while testing: my first related-tests run named a file that does not exist (engine/phonenotify.test.js)
  and node --test said nothing; the run now asserts each file exists (14 files, 193 tests).
- Round 2 (Opus): no BLOCKER. The push is now driven by the card, not by the log's said rule: each minute every card
  carrying a stall is told if its agent is due (deliverystreak.tellStalls), and a push counts only when
  phonenotify.happened says it went out (happened now returns that). So a phone set up ten minutes after a stall is
  told then, not a day later, and a restart 23 hours after a push no longer stretches the gap toward two days. The
  record has an in-memory copy, so an unwritable file still holds it to once a day; it is an Object.create(null) map,
  so a session named __proto__ is gated; an entry from the future reads as nobody told. The id is
  `stall:<day>:<since>:<session>`, session last, so a long name cut to fit loses only its tail. turnsToSay is back to
  main's. storecheck names stall-pushes.json in the person's words. The module header says the file exists.
- Round 3 (Sonnet): no BLOCKER. The record is read once per sweep, not once per stalled card each minute while nothing
  can be sent (no phone set up, a demo install). A test pins that the board tells the stalls after it settles the
  cards and that nothing can return before it. Kept on purpose: one agent is told at most once a day even if its stall
  ends and a different one starts; that is what keeps a flapping stall from buzzing all day, and the card still shows
  every stall. Not reachable today: a project's mute level (a stall event names no project).
- Round 4 (Opus, whole branch, the final read): no BLOCKER. One push per sweep, whatever the count, so a cause many
  agents share (one signed-out account) is one buzz, naming the first "and N more"; every agent it covers counts as
  told. tellStalls now takes the board's whole roster and picks the cards carrying deliveryStall itself, so a test
  drives it with a healthy card beside stalled ones. Kept on purpose (W2): one agent is told at most once a day, even
  for a second stall that day; the card shows every stall.
