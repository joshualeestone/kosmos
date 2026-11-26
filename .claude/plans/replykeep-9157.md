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
- KEPT_REPLY_OPTS: a reply is stored whenever it exists; its sig is [the message's `at` or the post's `id`, the
  @mention Reply put in the box].
- DM_REPLY = keptDrafts('dmreply', KEPT_REPLY_OPTS), PJ_REPLY = keptDrafts('pjreply', KEPT_REPLY_OPTS). Every
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

- web.replykeep-9157.test.js (6): all 6 fail on main's page; removing the `!keptMap(DM_REPLY)` guard fails exactly
  the test that names it.
- docs/browser-checks/render-replykeep-9157.js: real Chromium, real typing, a reload, Enter posts reply_to; control
  arm (storage refusing writes) holds the restart and shows no strip. Against main's page: the 4 kept-reply
  assertions fail.
- web.keepdrafts-9132 (premise regex widened for `opts`) and every test lifting updateNothingToLose or keptDrafts
  (83), web.rename-followups-4423, fixture-discipline, no-brand-refs, no-name-refs (38), browser-checks-reason-grep
  (SITE_COUNTS line, sorted): pass.
- bc-pr-select: 53 checks. Surface gate: passes; its control (a fake s-nav change) fails as it should.
