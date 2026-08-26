---
pre_challenge: true
method: pre-challenge
explicit_override: true
branch: firstrun-model-marks
diff_hash: 9e1c5812c8445f927f8a76bc5c733ccb03a0a6e85ab6c272989cfcf64d6a0c32
timestamp: 2026-08-26T03:30:00Z
iterations: 1
converged: true
---

# Pre-Challenge Proof: firstrun-model-marks

**Single pass, explicit override, labelled honestly.** /code-review has
been unavailable in this session all night. Self-reviewed instead.

## Iteration 1 (single pass, self)

[STRENGTH] **Did not treat "show all the models" as licence to also add
providers nobody asked for.** The design-pack artifact I sourced the
vendor marks from also specs a second tier (Kimi/DeepSeek/MiniMax) the
live app has never had. Josh's own list matched exactly the six already
in the codebase, so I built those six and left the extra tier alone
rather than expanding scope past what was actually approved.

[STRENGTH] **Kept #262's own measurement instead of treating the
reversal as proof it was wrong.** #262 measured something real (Continue
300px below the fold at three heights); Splinter's framing that this is
"solved by pinning, not disproved" is the one I built to, and I verified
against the exact same three heights (950/800/700) rather than picking
new numbers that would hide a regression #262 would have caught.

[STRENGTH] **Verified the sticky footer live, not just by reading the
CSS.** A flex-column-with-bounded-height layout is exactly the kind of
change that can look right in the rule and still fail at render time
(a `min-height: 0` omission, a `flex: 0 0 auto` that loses to a wider
selector). Ran real Playwright against the live server at all three
heights and asserted the Continue button's bounding box sits inside the
viewport, not just that the CSS properties are present in the page.

[JUDGMENT CALL, stated plainly] **The vendor SVGs were sourced from my
own earlier design-pack artifact, not re-verified against each vendor's
current brand guidelines tonight.** The artifact's own comments document
real sourcing discipline (monochrome-by-filter to preserve Qwen's white
counters, Josh's own redrawn Qwen mark, no asset fetched at runtime) —
I trusted that prior work rather than re-deriving it, since re-litigating
already-settled trademark/sourcing decisions was out of scope for
tonight's fix and the marks are inlined, not fetched, so there's no new
runtime dependency introduced.

[JUDGMENT CALL, stated plainly] **Did not re-confirm the exact tier
label wording or provider order with Josh before shipping**, since both
already existed verbatim in the codebase (the "Runs on this computer"
label, the Claude/Gemini/GPT/Llama/Qwen/Mistral order) and I only
un-hid them rather than inventing new copy.

## Verification

- `node --test web.firstrun-model.test.js`: 7/7 pass.
- `npm test` (full suite): 0 failures.
- Live Playwright verification at 950/800/700px (matching #262's own
  measured heights): six `.llm` rows, six real SVG marks, correct
  provider order, and Continue fully on-screen at every height.
  Screenshots confirm the visual match to the design pack.

### Final Ledger

0 BLOCKERs found. 0 findings remain open.
