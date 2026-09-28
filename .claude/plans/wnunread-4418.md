# wnunread-4418: the 0.7.07 What's New Reply tile stops promising the gold outline

Created: 2026-09-28 15:42 CDT (Baron Draxum)

## Why
Josh (#admin 15:23) wants the gold unread line on new agent messages removed; Mona's #4418 does it and is a required sha for 0.7.07 (Splinter 15:24). web/whats-new.json on main (0.7.07, #4388) has a Reply tile that says "an unread message has its gold outline again". Shipped with #4418, that line is false in the first window Josh reads after the update.

## Change
- web/whats-new.json: that tile's line becomes "Direct Messages have Reply, as project rooms do, and your answer shows which message it replies to." (true per #4256: the reply's header names the message it answers).
- Nothing else. Mona's #4418 owns web/index.html and the unread-edge browser check; she is told to stay out of whats-new.json.
- Release side (not in this repo): the 0.7.07 cut script refuses to freeze while whats-new.json says "gold outline".

## Validation
- web.whatsnew-3955.test.js + tools.whats-new-check-3955.test.js: 20/20.
- #1720 browser-check gate: passes via the Browser-check trailer (copy-only change). #2518 surface gate: passes.
- Full suite (yarn test).

## Status
- [x] edit + commit 9fbcf478d
- [x] full suite: yarn test EXIT 0, 11445 tests, 11279 pass, 166 skipped, 0 fail
- [ ] challenge loop, proof, PR, merge on green
