# wnline-9132: the What's New line for #9132, which shipped in 0.8.26 without one

Asked by Baron 18:46 (Fleet Builders m7083): #9132 (PR #9150, the Mac app keeps chat and room drafts across a reload)
shipped in 0.8.26, now on prod, with no What's New line, as #9093 and #9094 did in 0.8.25 (a097779666).

## Done when

release/whats-new-pool.json holds one pending line for #9132 that the next cut's window can show, within the limits
(title 48, line 140), checked by `node tools/whats-new-pool.js build 0.8.27 --offline`.

## The change

One item, after the 0.8.25 lines owed the same way:
  title "Half-typed messages survive a reload" (36), line "Words you start typing to an agent or in a project room
  come back after a reload, and Kosmos can still update itself while they wait." (133), icon chat, rank 10.6
  (beside 10 and 10.5, the other owed lines), since 0.8.26, pending, no platforms.

## Decided

- No platform tag: the kept drafts are the page's, on every platform; only the self-restart is the Mac window's, and
  the line says "Kosmos can still update itself", true where it updates itself and harmless elsewhere.
- "Kosmos", never "this Mac" (the product voice; engine/machine.test.js guards it).
- since 0.8.26 and pending, as a097779666 set its lines (since the version that shipped them).

## Verified

- build 0.8.27 --offline lists it (3 highlights); the What's New tests (154) and test-whats-new-early-7349.sh pass.
