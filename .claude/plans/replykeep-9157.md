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
  the post's `id`, the @mention Reply put in the box]; `pair` names its draft map ('talk', 'room'), and a reload brings
  it back only beside fresh words there (rounds 1 to 3).
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
