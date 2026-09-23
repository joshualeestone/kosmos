# #3501: remove the unknown-memory word badge under agent names

## Problem
Josh (design channel, 3 screenshots) flagged a little badge under agents reading
"unknown" / "not yet read" / "not set yet". It means nothing to end users, and when it
populates it pushes the agent NAME down. Ask: remove the badge entirely.

Splinter routed it to me (agent-state/agent-report lane) with a DEDUP-FIRST instruction
against Homer's #3482. Investigation found the words split across three surfaces; Splinter
then pinned the target from Josh's screenshot: it is the MEMORY badge `.membadge.unk` (the
'Not yet read' pill sits under the avatar and pushes the name down), DISTINCT from #3482
(the instruction-staleness banner, Homer/Windows). No dedup conflict.

## Approach: remove ONLY `.membadge.unk` (the word badge), keep the near-full number
`.membadge` has two states in the card render: the `.unk` variant shows a WORD when memory
is unknown (`pct === null`), and the plain variant shows a NUMBER when memory is near-full
(`pct >= NEARLY_FULL`). Josh flagged the WORD states he sees often; the number is a rare,
measured reading he did not flag, and `server.test.js` explicitly guards "the reading has to
stay". Only `.membadge.unk` is bottom-anchored and forces the name-push reservation.

So the fix removes the `.unk` word badge and its name-push CSS, and keeps the number badge:
- Card render (`card()`): drop the `pct === null` unk branch; keep the near-full number.
- Detail header (`d-membadge`): show only the near-full number, never the unk word.
- CSS: remove `.membadge.unk` and the two `:has(.membadge.unk){margin-bottom:26px}` rules
  (the name-push); keep `.membadge`, `.dav-wrap .membadge`, the DM co-occurrence offset
  (now plain `.membadge`), and the dark-mode `.membadge`.

The unknown-memory fact still reaches sighted and screen-reader users through the ring
(dashed state + aria-label), the Memory box, and the list row -- four `memUnknown` surfaces
now, not five. `memUnknown` and `memPrint` stay (used by those surfaces + the number badge).

## Browser-checks
- `render-memory-words.js` measured the caption geometry; its subject is gone, so it is
  RETIRED (removed from the browser-checks.sh run list + README + deleted).
- `render-fields.js` drops its caption-vs-presence-dot probe (`.membadge.unk` gone).

## Tests / count guards updated deliberately
- `web.memory-words.test.js`: five surfaces -> four (card badge removed).
- `browser-checks-reason-grep.test.js` (#1864): finding-emit sites 126 -> 125 and
  catch/launch sites 90 -> 89 -- the deleted render-memory-words.js contributed exactly one
  SHAPE-1 finding-emit and one launch catch (MEASURED against the harness's reported count).
- `server.test.js`, `web.dm-badge-2863.test.js`, `web.detail-ring-1915.test.js`: the `.unk`
  word-badge assertions become removal guards; the number-badge + ring-aria assertions stay.

## What must NOT change
- The near-full memory NUMBER badge (measured, absolutely positioned, test-guarded).
- The ring, the Memory box, and the list-row memory surfaces (Splinter: leave others alone).
- The Instructions dot and `.pj-notyet` (Josh flagged only the under-avatar badge).
- #3482 (instruction-staleness banner) is Homer's; not touched here.

## Verification
- Full node suite green (8059 pass, 0 fail).
- render-fields.js verified by CI headless (no-Playwright session locally).
- Visual "name not pushed down / not-set agent shows no badge": the name-push CSS and the
  unk word render are removed at the source; confirmed by the removal of the margin rules
  and the `pct === null` branch. CI browser-checks exercise the live render.
