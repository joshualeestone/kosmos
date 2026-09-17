# silence-plumbing-3202 -- remove dead room silence-computation plumbing

## Context
kosmos#3202 (cleanup): the room "Nothing back from <agent>" silence sentence was removed
by #3130 (Josh 6.68), and #3134-followup removed the inline delivery receipt from the room
render. That orphaned the whole silence-computation chain in web/index.html, which had been
left in place (a documented deferred cleanup) to avoid ballooning the #3130/bubble PRs.

Deferred until now because it OVERLAPPED Mona's active 6.72 dialog rework (both edit the
same web/index.html; pjReceiptSentence is touched by both, and her "remove sent-to notices"
pass could have subsumed part of this). Splinter unblocked it once her full dialog push
(#3205 msg-bubbles-6720 + agent colors + DM formatting) merged and she was done editing the
file -- the collision window is closed.

## Change (web/index.html)
Removed the dead silence plumbing:
- `pjSilences` (per-post room silence Map) + its comment.
- `pjSilentSince` (placed-with-and-silent) + its #145 docstring.
- `pjJoinOr` (orphaned "A, B or C" joiner).
- the unused `silent` param on `pjRoomRow` and `pjReceiptSentence` (both functions stay
  live; only the dead param goes -- pjReceiptSentence was already called with 2 args).
- the caller `const silences = pjSilences(allRows, p)` and the `silences.get(m)` arg.
- updated the stale comments that named the removed helpers (paintRoom early-return note;
  the dmOwesLine one-to-one box, which is a distinct surface Josh kept and stands alone).

## Scope / non-goals
- KEEP (still live, verified by usage): `pjOldEnoughToJudge` + `PJ_SILENCE_AFTER_MS` (the
  dmOwesLine box's two-minute gate, used at its call site independent of pjSilences),
  `pjJoinNames`, `pjReceiptSentence`, `pjRoomRow`.
- No behavior change -- this removes code nothing reaches. The room render, the delivery
  receipt ("could not be reached" / "may have it; not confirmed"), and the DM owes-line box
  are unchanged.
- Left brief `#3202` tombstone comments where the two larger functions were, matching this
  file's heavy-comment style (explains the gap for a future reader).

## Tests
- web.post-receipt.test.js: removed the 13 tests that drove `pjSilentSince`/`pjSilences`
  directly (and the source-assertion test that grepped for `pjSilences(allRows, p)` in
  paintRoom); dropped the removed names from the pageScope extraction and the vestigial
  `silent` args passed to pjReceiptSentence; refreshed the file docstring.
- web.owes-line.test.js: updated the two comments that named the removed pjSilentSince.
- Green: web.post-receipt 19/19, web.owes-line 7/7, and the 7 other pjRoomRow/paintRoom
  suites (avatarver x2, links-everywhere, quoteb, reply-where, speech-kind, typing-order)
  45/45 -- no regression from the pjRoomRow signature change.

## Weakest premise
That `pjSilences`/`pjSilentSince`/`pjJoinOr` are TRULY unreferenced after the caller +
param removals. Verified by grep: post-removal, the only remaining mentions are the #3202
tombstone/doc comments; `pjOldEnoughToJudge` retains its independent dmOwesLine caller, so
it (and PJ_SILENCE_AFTER_MS) correctly stay. The page's whole script still evaluates in the
test harness (a syntax error would red every suite), and 71 tests across 8 suites pass.
