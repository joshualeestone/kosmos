# #2738: reset the room valve's dedup baselines at the reopen/operator-post mark

**Branch:** `valve-dedup-2738` · **Card:** kosmos#2738 (follow-up to #2710, my own lane)

## The defect

#2710 made a `reopen` marker (and, already, an operator post) reset the room valve's arrival
BUDGET: `countFrom = max(windowFrom, lastOperatorAt)`, and arrivals are counted from `countFrom`.
But the two dedup checks in the same refusal branch still keyed off the RAW window
(`now - lim.windowMs`):

- the valve-notice dedup (`prior`/`latest`) - so on a re-loop after a reopen within the same raw
  window, a pre-reopen `valve` row still satisfied `latest.stopped === lim.on` and NO fresh
  "stopped again" notice was appended;
- the per-sender `refused`-row dedup (`already`) - so a re-offending agent's new refusal was
  swallowed by its pre-reopen refused row.

The gating decision itself was always correct (the post IS refused, since arrivals recount from
`countFrom`). Only the operator-visible HISTORY of the re-loop went stale: the operator who
reopened got no signal it re-looped.

## The fix

Change both room dedup filters (engine/messages.js, the room branch only - NOT the pair valve at
~675/802/1047, which has no reopen concept) from `now - lim.windowMs` to `countFrom`.

Why this is safe and minimal:
- On the COMMON path (no reopen, no operator post), `lastOperatorAt = 0`, so
  `countFrom === windowFrom === now - lim.windowMs`. The filters are byte-for-byte equivalent there,
  so nothing changes for the ordinary loop.
- It only differs AFTER a reopen or an operator post, where resetting the dedup baseline to match
  the budget window is the correct behaviour: a re-loop after the operator intervened is a NEW event
  and should re-notify.

## The call, what I rejected

- **Chosen: key both dedups off `countFrom`.** One-line-each change that aligns the dedup window
  with the budget window that already exists.
- **Rejected: a reopen-specific carve-out** (e.g. only reset the dedup when the most recent
  operator-marker is a `reopen`). That would leave the operator-post path still stale and add a
  branch; using `countFrom` fixes both uniformly and is a no-op on the common path.
- **Rejected: widening it in #2710 itself.** It touches the shared operator-post dedup path with
  regression risk on the existing valve tests, so it was deferred to this card and given its own
  challenge-loop.

## Tests

`engine/messages.test.js` adds one discriminating test with two arms sharing an identical seed
except the reopen row:
- ARM A (fix): pre-reopen valve + refused rows in-window, a reopen mark, then a fresh full budget of
  agent posts after it -> the re-loop is refused AND a FRESH valve notice + fresh refused row are
  logged (counts go to 2).
- ARM B (control): same seed WITHOUT the reopen -> still refused (over budget on the raw window) but
  the pre-reopen rows correctly suppress the notice + refused row (counts stay 1), proving the change
  is a no-op on the common path and that arm A is the reopen's doing, not a valve that always
  re-notifies.
Perturbation-checked: reverting EITHER changed line to the raw window reds arm A - it asserts both
the valve-notice count (==2) and the per-agent refused count (==2), and the pre-reopen refused row
sits inside the raw window, so each line is independently guarded.

The existing valve tests ("the room valve closes ... once" and "once the person has spoken ...")
still pass: the first has no reopen/operator-post so countFrom===windowFrom, and the second asserts
only that the answer gets through, not a notice count.

## Weakest premise

That `countFrom` is the right baseline for the dedup in ALL cases, not just reopen. It also resets
the dedup at an ordinary operator POST (not only a reopen), because `lastOperatorAt` includes
operator posts. I judge that correct - a re-loop after the operator spoke is a new event that should
re-notify, same logic as the budget reset #2710 already applies to operator posts. If a product
decision says an operator post should reset the budget but NOT the notice dedup, this would need to
key only off reopen rows instead; I did not read such a decision anywhere, and aligning the two
windows is the simpler, more consistent behaviour.
