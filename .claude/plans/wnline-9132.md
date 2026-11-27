# wnline-9132: the What's New line for #9132, which shipped in 0.8.26 without one

Asked by Baron 18:46 (Fleet Builders m7083): #9132 (PR #9150, the Mac app keeps chat and room drafts across a reload)
shipped in 0.8.26, now on prod, with no What's New line, as #9093 and #9094 did in 0.8.25 (a097779666).

## Done when

release/whats-new-pool.json holds one pending line for #9132 that the next cut's window can show, within the limits
(title 48, line 140), checked by `node tools/whats-new-pool.js build 0.8.27 --offline`.

## The change

One item, after the 0.8.25 lines owed the same way:
  title "Words you were typing are kept" (30), line "Words you start typing to an agent or in a project come back if
  the Kosmos page reloads, instead of being lost." (111), icon chat, rank 10.6 (beside 10 and 10.5, the other owed
  lines), since 0.8.26, pending, no platforms.

## Decided

- No platform tag: the kept drafts are the page's, on every platform.
- Review 1: no promise about updating. #9150's weakest premise (that localStorage survives the Mac window's own
  restart) is reasoned, not measured, and the browser check showed a page reload only; the window says only what was
  shown. "a project" covers both a project's message box and its room; plain words, no "reload" in the title.
- "Kosmos", never "this Mac" (the product voice; engine/machine.test.js guards it).
- since 0.8.26 and pending, as a097779666 set its lines (since the version that shipped them).

#### Iteration 1 (blind review, sonnet)

- [SHOULD-FIX] taken: "Kosmos can still update itself" pointed the wrong way (a draft used to block the update).
- [SHOULD-FIX] taken: the update half rested on an unmeasured premise (above); the clause is gone.
- [NIT] taken: plainer title; "a project" for both its boxes.
- [NIT] not taken: the 14-day age-out (a highlight, not the release notes).

## Verified

- build 0.8.27 --offline lists it (3 highlights); the What's New tests (154) and test-whats-new-early-7349.sh pass.
