# wn-cards-0757: the What's New item for Josh's agent-card clean-up

0.7.56 was cut with no What's New line for the clean-up merged that day (#6413 for #6399, #6414 for #6398 and #6400;
Baron skipped it because of the CI queue). This adds the pool item so the 0.7.57 cut's build picks it up.

## The change
`release/whats-new-pool.json`, one item, since 0.7.56 (the version the change shipped in), rank 2:
- title "Simpler agent cards"
- line "Agent cards are simpler: Rate Limit shows as a status, the community post line is gone, and you click a card
  with a question to answer it." (Review 1: "a status, not a paragraph" read as a fourth list item; "a card" alone
  over-promised, since only a card with a question opens on the reply box, isAnswerable in web/index.html.)
- icon swarm (the item it partly undoes, "Agent cards show the last community post", 0.7.35, used swarm).
`web/whats-new.json` is not built here: the 0.7.57 cut builds it (`tools/whats-new-pool.js build 0.7.57`). A dry-run
build to a scratch file passed the tool's own checks and put this item third of five.

## Decided
- **It displaces "A team map for each project"** (rank 4, since 0.7.55) from 0.7.57's five: prod is still 0.7.54
  (the pool's lastProd), so the window shows 0.7.55's pairing pair, this item, "Quiet projects" and #6330's item.
  The team map is one view in one layout; the cards are what every person sees every day, and Josh asked for the
  clean-up himself. The team map stays pending and returns as soon as a promote marks the others shown.
- **Rank 2**: every person sees every agent card, and Josh asked for it, so it ranks above "Quiet projects" (2.5) and
  below the pairing pair (1, 1.6) that 0.7.55 shipped for.
- **"Simpler"**, not "Quieter": the next item is "Quiet projects stop flagging you", and Josh's own word on these cards
  was simplicity (2026-10-17 11:09).
- **#6402 (the Lost your phone? rule) left out**: a divider on one settings pane is not news to a person.

## Weakest premise
"you click a card with a question to answer it": true of a card in the needs-you state (isAnswerable); the pill's
Answer link is what went (#6400), so this tells them where answering moved. Asked for
as "statuses are one word", which is not true (Waiting for you, Connection lost, Rate Limit itself), so it is not said.
On a phone it is a tap; the pool says "click" once and "tap" never, so click it is.

## Tests
`node tools/whats-new-pool.js build 0.7.57 --out=<scratch> --offline` ran engine/whatsnew.js's checks (icon, title and
line length, platforms) and passed. tools.whats-new-pool-5711, -sync-5713, tools.whats-new-check-3955 and
web.whatsnew-3955 also run in CI.
