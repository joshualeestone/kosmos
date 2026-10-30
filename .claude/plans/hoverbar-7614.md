# hoverbar-7614: a compact message bar with "...", and Delete for the person's own messages

Card: kosmos#7614 (Josh 10-30 07:06). Delete's behaviour was decided on the card (comment 6522430955) and the phone side
agreed with Angel in Fleet Builders (m1743 to m1744): she builds the iPhone sheet (#7419) once this route is on main.

## Finished looks like

On the board, hovering a room post or a direct message shows one compact bar (three quick reactions, a divider, add
reaction, Reply, "..."); "..." opens Copy text, Copy message number, and, on the person's own message, Delete message.
Delete, after one confirm, removes the message from the conversation for everyone; a room post still held for an agent
is never delivered; an agent that was already given it gets a one-line "withdrawn" note. Light and dark shots are on the
card, and it ships in a staging build.

## Slices, in order (each its own commit, tests with it)

1. **Room delete, engine and route.** `engine/messages.js`: a `deletePost` that appends an event row
   `{kind:'post-deleted', project, of, at, operator:true}` (named 'deleted' in the first draft of this plan) (the log is append-only, like reactions' `op:'remove'`), accepted
   by `rowShaped`. Every room reader drops a post with such a row. Held copies are dropped (`roomhold.dropShown` for each
   name in `to`); long-post spill files are removed (`unspill`). Agents whose outcome was delivered get the note.
   Route: `POST /api/project/:id/room/:postId/delete`, the person only.
2. **DM delete, engine and route.** `engine/chat.js`: remove the person's row by its `at` under the thread lock
   (the `rewriteDmRow` pattern); a still-queued copy leaves `limitqueue` (`remove`); a delivered one earns the note.
   Route: `POST /api/agent/:name/thread/delete` with `{at}`.
3. **The board bar.** `rxnsInner` and its CSS: the compact bar; the "..." menu; the person's own DM rows get the bar
   (they have none today); the confirm, in the words agreed with Angel.
4. **Design shots** (light, dark, desktop, phone) on the card, then PR.

## Answers (the contract Angel builds against; posted on the card before the PR)

- 200 `{deleted:true, told:[names]}`: gone; `told` lists the agents sent the withdrawn note (empty when none had it).
- 403 `{error}`: not the person's own message.
- 404 `{error}`: no such message (or already deleted).
- Own-message marker: room rows `operator: true`; DM rows with no `from` and `kind` not `kosmos`/`question`
  (unchanged; both already read by the phone).

## Open questions decided here

- A reply to a deleted post keeps its own text, and its "replying to" header shows what it shows today for an original
  it cannot find ("Original message unavailable" in a DM, the room's own missing-original text). Changed in review
  round 1 from "a deleted message": that needs the row to know its original was deleted rather than pruned, which is
  more than this card needs; the reply still reads either way. Revisit if Josh wants the reason named or replies hidden.
- The note never repeats the deleted words.
- No time limit on deleting.

## Weakest premises

- That the note reaches an agent in time to matter. It cannot undo what the agent already did; the confirm says so.
- That every room reader goes through one place that can drop deleted posts. To be measured in slice 1 by listing every
  reader of `kind:'post'` rows, not assumed.

## As built (10-30 09:30 CDT, before review round 1)

- Slices 1 and 2 as planned (6/6, 7/7, 4/4 route and engine tests, mutation controls). Spill-file removal in
  deletePostAsync (unspillFor) has NO test of its own: a long post's spill file going is reasoned from the code only.
- Slice 3, the bar: quick reactions, `.rxn-div` (computer only; hidden at thumb size so the touch bar keeps #4409's
  seven buttons at its old width: at 412px the divider pushed an agent's open bar over the corner of the person's
  message below), add reaction, read aloud, Reply, then `.rxn-dots` ("..."). Copy message and Copy message id left the
  bar for the "..." menu (#msg-menu). Delete message (#msg-menu-del) is last, on rows with data-own="1": room rows
  `isOp && id && !archived`, the person's DM rows with an `at` (which now carry a bar holding "..." alone).
- Decided: on a phone, a tap on the person's own DM opens its bar ("..." alone). It used to open nothing, but a phone
  has no other way to reach Delete there. Its bar sits at the message's right end (`#d-dmthread .msg.you .rxn-quick`).
- Dialog #msgdel-modal: the agreed words, Keep it focused, Escape and the backdrop close it, an error shows in
  #msgdel-msg as a sentence and Delete can be pressed again; success toasts "Deleted." or "Deleted. Kosmos told X you
  withdrew it." and repaints: the room by loadRoom, a DM by paintTalk while that agent's page is still open.
- Two bugs the new browser check (render-msgdelete-7614) found and that are fixed, each with a control:
  the room's project came from PJS_HOOKS.projectId (the webhooks pane: null until opened, another project's after,
  where the same message id could name a different post), now PJ_CURRENT; and a DM delete called loadThread (a
  project's thread), now paintTalk.
- Checks: 8 older browser checks updated for the new bar; 19 more named by the surface gate ran and pass unchanged.
- Known and kept: like every touch bar, an open bar floats above its message and can cover the corner of the one above.

## After review round 1 (opus, 09:4x CDT)

Findings file: ~/.cache/monalisa-review/review-7614-round1.md. No blockers; 5 warnings, 6 nits.
- FIXED W1: both delete routes refuse an agent's token (header first, then the body), as Send now anyway does.
  Tests: room and DM, header and body, 403 and the message stays; control with the guards removed goes red.
- FIXED W2: a kept DM the sweep is typing at the moment of the delete is settled anyway (so a typing that fails leaves
  nothing to type again) and the withdrawn note waits for that typing to finish (DELETE_WAIT, 20 s cap). If that typing
  failed, the agent is told about a message it never saw: one line, misleads nobody. Tests for order and for the
  failed typing; controls (no settle, no wait) go red.
- FIXED W3: a held room post a flush took and could not type goes back on hold only if it is still in the room
  (restoreHeld, at all five restore sites). Test with control.
- FIXED W4: the sweep's kept row fix for a deleted DM row is dropped (limitqueue.forgetRow). Test with control.
- FIXED W5: the plan's reply-quote answer now says what was built (above).
- FIXED nits: a busy thread lock says so (held.because); a write failure answers 503 in a plain sentence, never the raw
  error with its path; a 404 (gone already, another tab) closes the dialog, says "That message was already gone." and
  repaints (browser check D10); stale CSS comments; rxnsInner's unused `mid` documented (kept for argument order).
- DEFERRED, the double-delete race: deletePostAsync reads and appends with no await between them (record() and
  appendLog are synchronous), and the route awaits nothing between its body and the call, so two requests cannot
  interleave there. Weakest premise: a future await added before appendLog would open it.
- DEFERRED, archived posts: the server deletes any of the person's posts, archived or not; the page leaves Delete out
  of the archive view because that view is a read-only record (#7365). An archived post reaches no member, so deleting
  one from the server is harmless. Revisit if Josh wants Delete in the archive view.

## After review round 2 (sonnet, 09:5x CDT)

Findings file: ~/.cache/monalisa-review/review-7614-round2.md. No blockers; 1 warning, 4 nits.
- FIXED W: unspillFor now has a test: a deleted long post's spill file goes from the Inbox Kosmos made; a folder
  without Kosmos's marker keeps its file; the Inbox stays. Control (no unspillFor call) goes red.
- FIXED nit: the person's rows from an earlier part of a DM (files kept as they were, the server answers 409) get no
  "..." and no Delete (DM_EARLIER_ATS). Browser check D11, with control.
- FIXED nits: the plan names the row kind 'post-deleted'; comments on the deletion row reserving no id, and on the
  'held' literal.
