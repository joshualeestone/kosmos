# replykeep-9157: a reply being written is kept with its draft, so it no longer holds the Mac window's restart

Card: kosmos#9157 (follow-up to #9132, filed and claimed by Mona Lisa 11-26 14:0x).

## Done when

A reply picked on an agent's message (DM_REPLY) or a room post (PJ_REPLY), with words typed after it, is written to
localStorage beside its draft; after a reload, opening that chat or room shows the "Replying to" strip again and Send
posts the words as a reply to the original. A kept reply no longer makes updateNothingToLose() refuse the Mac window's
restart; a reply storage refused still does. Shown by a unit test lifting the page's own code and a browser check
with a control arm.

## Measured on origin/main first (the card is live)

DM_REPLY and PJ_REPLY are plain `{}` objects; updateNothingToLose returns false while any reply has words in its
box's draft (render-replykeep-9157 against main's page: 4 kept-reply assertions fail, control arm passes).

## The change (web/index.html)

- keptDrafts(kind, opts): optional `present(v)` (store this entry?) and `sig(v)` (what must match storage to count
  as kept). Defaults are the old words-based behaviour, so the four draft maps are unchanged. KEPT_DRAFT_SIG records
  each map's sig; keptDraftStored and draftsKept read it.
- KEPT_DM_REPLY_OPTS / KEPT_PJ_REPLY_OPTS: a reply is stored whenever it exists; its sig is [the message's `at` or
  the post's `id`, the @mention Reply put in the box]; `pair` names its draft map ('talk', 'room'). AS REBUILT IN
  ROUND 5 (it supersedes rounds 1 to 4's mechanism): saving the words on a page that holds the reply re-saves the
  reply (KEPT_DRAFT_FOLLOW), so a kept reply is never older than its words; a reload brings a reply back only when its
  words are stored, fresh, have text and are no newer than it (keptReplyComesBack); a load writes and removes nothing
  but entries past the 14-day age-out; draftsKept counts a reply as kept only if a reload would bring it back.
- DM_REPLY = keptDrafts('dmreply', KEPT_DM_REPLY_OPTS), PJ_REPLY = keptDrafts('pjreply', KEPT_PJ_REPLY_OPTS). Every
  existing set/delete site is seen by the wrapper. The two in-place `.mention =` writes in pjReplyMention now assign
  a new object, so the change reaches storage.
- Restore needs nothing new: paintTalk and openProject already paint the strip from DM_REPLY/PJ_REPLY, which are
  filled from storage on load.
- updateNothingToLose: the reply hold applies only when the reply map is not kept (draftsKept false).
- Forget: forgetAgentDrafts also forgets DM_REPLY; a project removal forgets PJ_REPLY; log out already clears every
  `kosmos.draft.` key.
- keptDraftHeard: another tab's reply change repaints the open chat's or room's strip.

## Decided

- Reused keptDrafts with two options rather than a second wrapper: one storage format, one age-out, one log-out path.
- The original message may be gone after a reload (deleted, pruned): the server already refuses a reply to a message
  not in the conversation, and the existing refusal line tells the person to press x. Not re-checked on restore.
- Keys share the `kosmos.draft.` prefix, so log out's forgetAllDrafts covers them with no change.

## Weakest premise

That a restored reply's `who` and `words` (taken at the click) are still right to show. The strip already prefers
the sender's current name (dmReplyPaint, pjReplyPaint, #4423); `words` is the click-time gist, as it was before a
reload.

## Verified (round 0)

- web.replykeep-9157.test.js (6 at round 0; 10 by round 3): all 6 failed on main's page; removing the `!keptMap(DM_REPLY)` guard fails exactly
  the test that names it.
- docs/browser-checks/render-replykeep-9157.js: real Chromium, real typing, a reload, Enter posts reply_to; control
  arm (round 1: storage refusing only the reply's key) holds the restart and shows no strip. Against main's page: the
  4 kept-reply assertions fail.
- web.keepdrafts-9132 (premise regex widened for `opts`) and every test lifting updateNothingToLose or keptDrafts
  (83), web.rename-followups-4423, fixture-discipline, no-brand-refs, no-name-refs (38), browser-checks-reason-grep
  (SITE_COUNTS line, sorted): pass.
- bc-pr-select: 53 checks. Surface gate: passes; its control (a fake s-nav change) fails as it should.

#### Iteration 1 (blind review, opus)

- [SHOULD-FIX] taken: a reply aged out before its words (the 14-day age-out runs per entry; a reply is written once at
  the click, its words on every keystroke), so a day-15 restart brought the words back plain. A reply now ages out
  with its paired draft (KEPT_DM_REPLY_OPTS.pair 'talk', KEPT_PJ_REPLY_OPTS.pair 'room'): kept while that draft is
  stored and fresh. Tested (15-day reply, 5-day words: kept; control: an old reply with no words goes); removing the
  pairing fails exactly that test.
- [NIT] taken: removing the open agent repaints its reply strip; the browser check's control refuses only the
  reply's key, so it isolates the reply hold (deleting the hold now fails it); the mention test changes only the
  mention; the in-place-write guard matches any field of either map and ignores ==/=== (checked on four samples).
- [NIT] recorded, not built: a reply picked with nothing typed is kept too, so an abandoned one comes back (the strip
  shows and x ends it; nothing goes out wrongly); a reload during a reply's send can bring back its strip (the
  automatic restart is held then anyway); another tab's room reply can bring a @mention not in this box (harmless);
  the browser check covers the chat, the room is unit-tested.

#### Iteration 2 (blind review of the whole branch, sonnet)

No BLOCKER, no SHOULD-FIX.
- [NIT] taken: a reply picked with nothing typed after it was kept and came back on every reload, so the next
  unrelated message could go out as a reply. A reply now comes back ONLY while its paired draft is stored, fresh and
  has words (as main: an abandoned pick does not survive a reload). Tested with a control (a reply with words comes
  back); removing the words requirement fails exactly that test.
- [NIT] taken: the refused-write test used two helper instances, so its restart assertion could not fail. Now one
  storage refusing only the reply's keys, with a control that the words are kept.
- [NIT] recorded, not built: a reload in the moment between a reply's send landing and its delete (the automatic
  restart is held then); the forget test pins the call sites' text rather than running forgetAgentDrafts (it lifts
  only the helper block); an aliased in-place write (const r = DM_REPLY[a]; r.x = y) is outside the guard's regex
  (none exists today); the browser check covers the chat, the room is unit-tested.
web.replykeep-9157 8 of 8, web.keepdrafts-9132 and the affected suites and guards (120) pass; render-replykeep-9157
passes both arms.

#### Iteration 3 (blind review of the whole branch, opus)

- [SHOULD-FIX] taken: round 2's load-time prune REMOVED a word-less reply, and a removal fires a storage event in
  every other open tab, whose listener deleted a reply the person had just picked there (nothing typed yet), so their
  next message went out plain. Measured by the reviewer in a two-tab simulation. Now a load marks it
  {v: null, pruned: true}: never loaded as a reply, left while fresh, removed once old; a tab that still holds the
  reply hears the marker and writes its reply back. Real ends (send, x, forget) still delete. Tested with two tabs on
  one storage (events delivered later, as a browser does): tab 2 loading leaves tab 1's reply, storage holds it, it
  counts as kept; control: x in tab 2 ends it in tab 1. Each of the two mutations (removal restored, write-back
  dropped) fails exactly that test. And the marker: never loaded, a fresh one left, an old one removed.
- [NIT] taken: the KEPT_REPLY comment says stored always, brought back only beside words; the plan's stale names.
- [NIT] recorded, not built: a reload during a reply's send with new words typed meanwhile pairs the old reply with
  them (as recorded in round 1); the forget call sites are pinned by text; the browser check covers the chat. From
  #9132, not new: a page left open 14 days with no keystroke may restart and age its words out, and its reply with
  them.

#### Iteration 4 (blind review of the whole branch, sonnet)

- [BLOCKER] taken: gated.txt had render-replykeep-9157 out of byte order (tools.browser-checks-wired.test.js red,
  measured: 10 pass 1 fail before, 11 pass after). Moved; LC_ALL=C sort -c passes. Every browser-checks-*.test.js
  and tools.browser-checks-*.test.js now runs too (121 pass).
- [SHOULD-FIX] taken: the marker's write-back re-adopted, in the pruning tab, the very word-less reply its load had
  just dropped (picked only in the other tab), so it showed there and came back on every reload. Each page now
  remembers what its own load pruned (key -> sig) and ignores that same reply written back; a different reply for the
  key, or this page writing the key itself, ends that. Tested: tab 2 does not adopt it, tab 1 keeps it; control: a
  new reply picked in tab 1 afterwards reaches tab 2, and x in tab 2 ends it in tab 1. Removing the ignore fails
  exactly that test.
- [NIT] recorded, not built: a word-less reply older than 14 days is removed, not marked, so it can reach a tab open
  over 14 days with that reply (the #9132 age-out class); the browser check covers the chat, not three tabs or a load
  during a send (traced by the reviewer, no defect).
web.replykeep-9157 10 of 10 and the affected suites and guards (133), the browser-check wiring tests (121), and
render-replykeep-9157 pass.

#### Iteration 5 (blind review of the whole branch, opus): the design rebuilt

- [SHOULD-FIX] taken: round 4's prunedHere hid a reply that storage still held: tab 1 picks a reply (nothing typed),
  tab 2 loads and ignores its write-back, tab 1 closes, tab 2 types an unrelated message, the restart is allowed, and
  the reload brings the old reply back beside it (Enter posts it as a reply). Reproduced by the reviewer with the
  page's own code. Round 2's very defect, reintroduced by round 4's patch.
- [SHOULD-FIX, design] taken: the pair, marker, write-back and prunedHere each patched the side effect of the round
  before. My model of the cross-tab behaviour was wrong, so the mechanism was REBUILT from one rule instead of patched
  again: a reply is the reply TO the words beside it. Saving words re-saves the reply held beside them; a reload brings
  a reply back only beside fresh words no newer than it; a load touches nothing but expired entries; draftsKept asks
  what a reload would bring back. The marker, write-back and prunedHere are gone (none remain in the page).
  Tests rewritten around the rule: re-saving (and its control, words with no reply re-save nothing); another tab's
  load writes nothing and leaves tab 1's reply; round 5's scenario (words typed where the reply is not never come back
  as it, and tab 1 then counts its reply as unkept so its restart waits); the control (words typed beside the reply
  bring it back in every tab, and x in one tab ends it in the other). Four mutations (no age order, no re-save, no
  kept check, no words requirement) each fail the tests that name them.
- [NIT] taken by the rebuild: the marker's setItem inside the load's try is gone (a load no longer writes).
- [NIT] recorded, not built: a reply adopted from another tab paints its strip over words this tab's box holds (shown,
  x ends it).
web.replykeep-9157 11 of 11, web.keepdrafts-9132 and the affected suites and guards (116), the browser-check wiring
tests (121), and render-replykeep-9157 pass.

#### Iteration 6 (blind review of the whole branch, sonnet)

No BLOCKER.
- [SHOULD-FIX] taken: nothing failed if a reply map's `pair` named the wrong draft kind (room replies would never
  come back, yet count as kept). The premise test now pins both pairs against the real draft kinds, and a room reply
  reload test (with the @mention Reply puts in the box, plus a control: another project's words bring nothing back).
  A mistyped pair ('rooms') fails both.
- [NIT] taken: the restart-hold comment names the current reasons; the design comment says a ROOM reply on an
  agent's post does come back with nothing typed (its @mention is words in the box).
- Found while running: the round-5 cross-tab test could land the other tab's words in the same millisecond as the
  reply (equal times count as beside, which the re-save needs). It now waits 5 ms, as a person always does; 8 of 8
  runs pass.
- [NIT] recorded, not built: draftsKept judges a reply map whole, so one unkept reply holds a restart for the others
  (as #9132's draft maps do, and only while a write is refused or a reload would drop one); words typed in a second
  tab can fill this tab's empty box under its reply strip (Send posts a reply a reload would not keep; the restart
  waits meanwhile); a clock stepped backwards with an orphan reply in storage; the in-place-write guard misses a
  one-step alias (none exists); keptDraftHeard's reply branches are untested (a repaint only).

#### Iteration 7 (blind review of the whole branch, opus)

No BLOCKER. The reviewer confirmed the restart is never held where main would not hold it, and the four old draft
maps are unchanged.
- [SHOULD-FIX] taken (recorded as a NIT in rounds 1 and 3, and rightly rated higher here): a reload during a reply's
  send could turn the next message into a second reply. Enter lets the words go but the reply stays until the send
  answers; words typed meanwhile re-saved that reply, so a reload paired them (measured by the reviewer). The re-save
  now skips a reply that is on its way (opts.sending: DM_REPLY_SENDING / PJ_REPLY_SENDING naming the same key and
  message). Tested: a reload during the send brings the next words back plain; control: once nothing is in flight
  (the send failed), the next keystroke re-saves the reply and it comes back. Removing the skip fails exactly that
  test.
- [NIT] taken: the README row describes the control arm as it is (only the reply's key refused).
- [NIT] recorded, not built: forgetDrafts removes only keys this page loaded, so a reply never loaded here stays in
  storage after its agent or project is removed (it can never come back by itself: every write is stamped now, and
  the server refuses a reply to a message not in the conversation); another tab's reply is taken without the load
  rule (consistent and shown); the in-place-write guard misses Object.assign on an entry (none exists); no room reload
  browser check; two storage writes per keystroke.
web.replykeep-9157 13 of 13 (5 runs clean), the affected suites, guards and browser-check wiring tests (239), and
render-replykeep-9157, render-keepdrafts-9132, render-room-reply-3745 (71), render-dm-send-clears-4944 (45) and
render-dm-reply-4256 (22) pass.
