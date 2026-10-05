# fedscreens-b-4649: slice B of the federation screens (#4649)

Card: joshualeestone/kosmos#4649. Spec: ~/work/workers/pigeonpete/Files/federation-screens-4649-spec.md (shots 07, 09,
10; Mona Lisa's design; her Q-M answers on the card). Slice B is stacked on slice A (fedscreens-4649, PR #5276) and
merges after it; slice C (fedscreens-c-4649) follows.

## What it adds
The project owner's "From outside" section in Members, in the tab view's Members card and in the consolidated rail:
joined, pending and expired outside invites, built from Kitty's GET /api/federation/members (#5266, merged).
- Remove (a joined member) through the shared #761 dialog; Withdraw (an unused code); "Make a new code" (an expired
  one, opening slice A's sheet with the label and kind filled in).
- An expired row goes once a NEWER code with its label is pending or joined.
- Unchecked answers (checked_at null) keep Remove and withhold Withdraw and Make a new code.

## Decisions
- Remove and Withdraw give up after FED_ACT_LIMIT_MS (60 s) and ask the list again; a Remove that Cancel did not stop
  says it went through beside the list (the shared #761 dialog's Cancel was not disabled, since local removes use it).
- The list starts over on every project entry, before the first paint; an answer from a previous visit is dropped by
  a generation counter (FED_GEN), and a members ask in flight by FED_MEMBERS_SEQ.
- Busy row buttons are aria-disabled (not disabled) so they keep focus; focus is never pulled out of an open dialog.
- Only a "hidden" gate reading closes an open outside Remove; nothing is removed under a passing "signup" reading.
- Remove and Withdraw use owner-list wording (pjFedMessage opts.change); other callers keep their own fallbacks.
- A key ahead of the slug is slice C's/#5150's matter, not this slice's.

## Known and stated, not changed
- The could-not-check line for an unchecked answer with no rows depends on the board's `shared` field (Kitty's
  follow-up after #5266; stated on #4649).
- The board's raw 502 text is the board's to fix (raised on #5266).

## Weakest premise
That the members answer keeps the shape on #5266 as merged (owner, self_shared, invites with invite_id, edge_id,
state, made_at, expires_at, joined_at, checked_at) as the coordinator side grows.

## Ledger
Review: 10 rounds before slice A's latest head was merged in (converged at 10), then 18 rounds on the merged branch
(converged at 18). Details in fedscreens-b-4649-pre-challenge.md and the commit messages.
Validation: clean at bc3fd8215a (15035 pass, 0 fail). Browser check render-federation-invite-4649.js passed at
bc3fd8215a (116 PASS, control on main rc 1).
