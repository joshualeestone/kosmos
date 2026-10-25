# needskey-7108: a question's dismiss key cut on a code-point boundary

**Done when:** a question whose 300th UTF-16 unit splits an emoji gives a needsYouKey that ends before it (no lone
surrogate in the projects answer), the shortened key still dismisses, and the board's fallback cuts the same way;
tested with a control; merged.

## Decisions
- Drop a trailing lead surrogate after slice(0, 300), in the engine (needsKeyWords) and the board's keyOf fallback.
  Cutting by code points instead would change the length rule dismissNeeds checks; dropping one unit keeps every
  existing key and only shortens the broken ones.
- A dismissal stored under an old broken key no longer matches: that row shows once more and can be dismissed again.
  Accepted (rare, recoverable, and the old key made the phone unable to read projects at all).
- web/index.html changes a pure key helper inside pjNeedsNotice, nothing drawn: a Browser-check trailer, with the
  board line pinned in the engine test.
- Weakest premise: the iPhone's refusal was measured on a minimal JSON string by the #7106 reviewer, not on a full
  /api/projects answer through the relay.

## Steps
1. Engine, board, test. DONE: engine/projects-needskey-7108.test.js 3/3 (control: the old cut fails test 1);
   projects-needsquiet-6341 green.
2. Review loop. 3. Validation, PR.
