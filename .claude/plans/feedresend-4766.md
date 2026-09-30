# feedresend-4766: re-send a daily feedback report that changed after it was sent

Card: joshualeestone/kosmos#4766 (under #4415). Agent: Renet Tilley.

## The defect

`engine/feedbacksend.js` `sendDailyOnce` marked the day sent before the first POST and then
returned early on `st.sent === today` for the rest of the day. Anything an agent added to
today's report after that first hourly sweep never left the machine: a user's same-day
slowness write-up (#4415/#4765) would be lost.

## The call

- `sent` stays the date key. Two new fields sit beside it in `feedbacksend.json`:
  `sentHash` (sha256 of the report BODY, frontmatter stripped, not scrubbed) and `sentAt`
  (epoch ms of the send).
- Sweep rules: same day and same hash: no POST, ever. Same day and a different hash: POST
  once `RESEND_MIN_MS` has passed since `sentAt`. A new day: POST, as before.
- `RESEND_MIN_MS = 3 hours`. The sweep is hourly, so this caps a day at about eight POSTs
  even for an agent that rewrites its report constantly (no POST storm), while a write-up
  made in the afternoon still reaches us the same working day.
- Migration: an old file with only `sent: "<date>"` reads as `sentHash: null, sentAt: null`
  ("sent that day, content and time unknown"). A null hash never equals a real one and a
  null time counts as elapsed, so it produces exactly one extra send, which records the
  hash; after that the normal rules hold. A `sentAt` in the future (clock set back) also
  counts as elapsed, once, for the same reason: the send records a real time.
- Every existing guarantee is kept: the consent gate (`st.on`), scrub (unchanged, in
  `payload`), the underTest guard, fire-and-forget, and mark-before-POST with "a failed
  marker write means no POST" (now covering the re-send path too).
- The clock is an optional second argument to `sendDailyOnce(date, now)`, so tests never
  sleep and no new export is added (the #265 orphan guard stays quiet).

### Why hash the raw body

- Not the raw file: its `generated_at` header changes on every `feedback.write`, even when
  the words do not, so a rewrite with identical content would re-send.
- Not the scrubbed payload: `scrub()` output changes when an agent or project is added on
  this install, which is not a new report.

## Rejected

- **Send on every change.** An agent that edits its report every few minutes would POST
  every hour; the interval is the storm guard.
- **Re-send the whole history, or keep per-day hashes for past days.** The sweep only ever
  looks at today; a past day's late edit stays local, as before. Out of scope.
- **Mark after the POST resolves.** The send is fire-and-forget and a down collector would
  then re-POST every hour; the existing reason for marking first still holds.
- **Replace `sent` with an object.** Breaks the old-file reader and a pinned regex in
  web.feedback-switch-2037.test.js for no gain; sibling fields migrate cleanly.

## Collector side (chaoskosmos-site, origin/main aa94975, read-only)

A second POST for the same install and day is ACCEPTED and REPLACES the first:
`api/_feedbackcore.js:51-55` ("One record per install per day: replace a same-day re-send"),
`:56-58` lists the day's existing blobs by stem, `:60-67` writes the new one, `:77-82`
deletes the older same-install same-day records. No rate limit or refusal
(`api/feedback.js:31-36` is a thin adapter). So no site change is needed, and a re-send
updates the day's report. Note the card's premise ("keeps each POST as its own blob, a
second version") is not what the code does: the latest version wins, which is what this
fix needs, since the local report is itself replaced whole on each write.

## Weakest premise

That the body an agent writes later in the day is a superset of the morning's (it is the
same file, rewritten whole by `feedback.write`). If an agent instead rewrote the report
with less in it, the collector keeps only the latest version and the earlier text is gone
server-side. That is the collector's replace rule, not this change, and the local copy is
the same. Second: 3 hours is a judgement, not a measurement; it is one constant to change.

## Measured

- `engine/feedbacksend.test.js`: 58/58 pass (52 before, plus 6 new #4766 tests).
- Related guards: web.feedback-switch-2037, web.feedback-unreadable-4332,
  engine.reachable: 12/12 pass. Full suite not run (instruction).
- The old `engine/feedbacksend.js` against the new tests: 4 red (re-send after the
  interval, change inside the interval then sent, old-format migration, setOn keeps the
  hash); the two controls stay green there, as they should, since the old code never
  re-sends. Restored and cmp-verified.
- Targeted mutations on the new code, each red, each restored and cmp-verified:
  no hash compare -> unchanged CONTROL + migration red; no interval -> inside-interval
  CONTROL red; POST despite a failed marker write -> both write-failure tests red;
  null hash treated as unchanged -> migration red; write() drops hash/time -> setOn test red.
