# sendwhy-5435: say why a published community post or comment is not going

**Branch:** `sendwhy-5435` · **Card:** kosmos#5435 (follow-up to #5431, its ask 3) · **Base:** tornsend-5431 (PR #5447),
rebased onto main once that merges, because both change engine/communitysend.js.

## The defect
With Community ON but a send record unreadable, `kosmos community post` and `comment` said "Kosmos is not sending to the
community right now", which reads as the switch being off. The routes passed only `sends: false`, so neither CLI could
tell the switch from a record, an address it does not send to, or an agent the community refused.

## The change
- engine/communitysend.js: `willSend` returns a reason with every "no": `off`, `address`, `records` (any record the
  pass needs is unreadable, or the period's start could not be written), `refused`. `NOT_SENDING` holds the words once,
  per kind: a comment that will not go is marked never to send, so its words say it will not go; a post can still go
  once the cause is fixed, so its words point at `kosmos community status`. `off` keeps the sentence the CLIs said
  before, which was right only for the switch. `notSendingWords(kind, why)` reads an unknown reason as the switch's.
- server.js: the post and service-comment routes return `notSending` (the sentence) only for a PUBLISHED item that
  will not go. A held post, and anything that goes, carry no reason. A throwing willSend reads as `records`.
- install/kosmos and tools/windows/kosmos-cli.js print the board's sentence on one line, and keep their old sentence
  for a board from before this change (no field).

## Decided
- The words live in the send layer and travel in the answer, as `kosmos accounts`' words live in one module (#5359):
  two CLIs with their own copies drift. Rejected: a reason code each CLI words itself (four copies of four sentences).
- `records` wording follows communitystatus's `unreadable` (#5431): not "shortly", and tell your person if it lasts.
- Weakest premise: that a post published while a record is unreadable goes once the record is repaired (the sweep sends
  posts made since the period's start). If it never does, the post words over-promise; status then says what it is.

## Verification
- engine/communitycomment-4373: each reason, a broken comment record stopping comments only (control: posts still
  go), four distinct sentences per kind, never the switch's for a record. Routes: server.community-comment-4373 (off,
  records, a sending comment has no reason) and server.community-sendsoon-4938 (records; a held post has no reason).
  CLIs: one new arm each in cli.community-post-4289, cli.community-comment-4373 and both Windows tests (the board's
  sentence, with a line break, printed on one line; the old arms keep the fallback). engine/communityretire-4994's
  exact shape now includes `why: 'refused'`. Every community test plus the repo guards: 934/934.
- Mutations: `records` reported as `off` reddens 2; each CLI ignoring the field reddens 2.

## Review 1
- FIXED: an unreadable switch file said the switch's words (the same mistake the card is about). willSend now reads the
  switch once (switchState: on, off, unreadable) and says `records`; every other reader still treats unreadable as off.
- FIXED: the period start that could not be WRITTEN was named an unreadable record; the words now say "read or write",
  and a read-only-folder test pins it (it skips on Windows; listed in tools/windows-tests.js).
- FIXED: the post words for `address` and `records` promised the post goes once fixed. Whether it does depends on
  whether the period's start was already recorded, which only `kosmos community status` can say, so the words promise
  nothing and send the agent there; `address` also tells it to tell its person (it cannot fix an address).
- FIXED: the Mac CLI trims the board's sentence, as the Windows one does.
- Left, and named: the kept `off` post sentence says "Do not post it again" while status's `before_on` says it can be
  posted again once Community is on. It predates this card; the agent is sent to status, which is right.

## Review 2
- FIXED: the contradiction moved one command later. `kosmos community status` read a torn switch file as "switched
  off" (`paused` / `before_on`) right after the post command said a record could not be read. Status now reads
  switchState too and says `unreadable` for an unsent item while the switch cannot be read (control: a switch the
  person turned off still says paused).
- FIXED: the words send the person to the log, so the log names the file: the switch file and a state file that could
  not be written are each logged once (again after a recovery), as an unreadable record already was.
- FIXED: the Mac trim is pinned (a trailing line break).
- Left, and named: a start that could not be written still reads `before_on` in status ("switched off before it went
  out"): status cannot tell that from a post made while off and then switched on before any sweep. It needs a disk
  write failure; the log names the file.
- Left: the routes' catch that reads a throwing willSend as `records` has no test (willSend catches internally).

## Review 3
- FIXED (the most serious finding so far): the sweep ended the ON period whenever switchOn() was false, including for a
  switch file it could not read. Every post made in that stretch was then lost for good (any later start is after it),
  while status and the post words told the agent to wait. The sweep now ends the period only when the person turned
  Community OFF (switchState 'off'); an unreadable switch sends nothing and keeps the period, so those posts go once it
  is repaired, as communitystatus's comment already said. Pinned with a control (switched off, the period ends).
- FIXED: read, vote, follow and agentCall said "switched off" for an unreadable switch: one `notOnWords()` now says
  which. Pinned with a control.
- FIXED: the comment `records` words said "Do not send it again", which only made the loss permanent: this copy is
  marked never to go, so a resend after the fix cannot double it. They now say so.
- FIXED: an unknown reason reads as `records`, never the switch; the start log resets on every successful read of a
  start, not only on this function's own write.
- Weakest premise of the sweep change: that an unreadable switch is never the person's way of turning Community off.
  It cannot be: Settings writes the file whole, and a torn file says nothing about what the person chose.
