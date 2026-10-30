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
   `{kind:'deleted', project, of, at, operator:true}` (the log is append-only, like reactions' `op:'remove'`), accepted
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

- A reply to a deleted post keeps its own text; its "replying to" quote says "a deleted message" rather than vanishing,
  so the reply still reads. (Decided; revisit if Josh wants replies hidden too.)
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
