# agycache-4393: the Antigravity ring counts the cached prompt (1.4.2 + 1.4.5)

## Why (#4393, split from #4039)
Baron's post-promote two-turn live run (13:06 CDT, prod 0.7.05): Grok and Gemini rings grew; the Antigravity ring
fell 20,875 -> 2,292 on a LONGER second turn.

## Diagnosis, measured twice independently (Ice Cream Kitty on #4393; Renet on the real dbs)
In agy's gen_metadata usage message, 1.4.5 is the prompt served from cache (it appears once agy's cache is in
use) and 1.4.2 becomes only the uncached part. The prompt as sent is 1.4.2 + 1.4.5. Baron's 1302 conversation:
1.4.2 = 18372, 20875, 4756, 2292; 1.4.2 + 1.4.5 = 18372, 37214, 37424, 39039. Cross-check: 37214 is within 0.3% of
18372 plus generation 0's output (18744). The 12:58 run shows the same shape.

## The change (Ice Cream Kitty's commit da156bd53, taken as is)
- engine/agysession.js: CACHED_PROMPT_TOKENS = 5; `prompt` = 1.4.2 + (1.4.5 or 0); null when 1.4.2 is absent.
- test-support/agyfixture.js: `cached` writes 1.4.5.
- engine/agysession.test.js: the real four-generation series, asserting growth, plus a no-cache control.

## Checks
agysession 14/14; status.agy-ring-4039 + agytrust 22/22. Restoring `prompt = 1.4.2` reds the new test. On the REAL
1302 db (a read-only copy): origin/main's reader gives 2,292 (Baron's number), this branch gives 39,039.

## Class check
Codex (input_tokens) and the Gemini CLI (tokens.input) already include cached input, and both passed the same
live two-turn run. Grok's last-call bug was fixed earlier. So the split-cache shape is agy's alone.

## Not done here
A LIVE two-turn run on a board carrying this needs a release (the served board is 0.7.05). Then: two tool-free
turns on a fresh agy agent under a sandboxed label (#3011), and the ring must hold or grow.

## Weakest premise
That 1.4.5 is always the cached part of THIS request's prompt and never a cumulative counter. The per-generation
values rise with the conversation and sum to the expected prompt at every step, which a cumulative counter would
overshoot.

## Review 1
- WARNING proto3 leaves a zero field off the wire, so a turn served WHOLLY from cache has 1.4.5 but no 1.4.2; the
  reader then skipped that generation and fell back to an older, smaller one (the card's own failure, another
  way in) --> FIXED: an absent 1.4.2 beside a present 1.4.5 counts as 0 uncached; only both absent is no reading.
  The fixture's `prompt: null` leaves 1.4.2 off the wire. The new test pins the decode, the ring in a
  conversation, and the neither-field control. Reverting to the previous line reds it.
- NIT an old plan (.claude/plans/ring-providers-4039.md) says "prompt 1.4.2" --> NOTED (history, not shipped).
- Verified by the reviewer: status.js readAgySession is the only reader of agysession; win32agy.js and agystatus.js
  parse no token usage of their own, so there is no second, unfixed reader.
