# #2840 — the Token Usage Value column, live (blended), per Josh's ruling

## What finished looks like
The usage-history list's **Value** column (Settings → Usage) shows a real per-row dollar
figure instead of the "pending" stub, computed by the approved `/design/token-value` math,
and that math is pinned by the node test + the browser-check. The output-only money box and
the four separate class cards are unchanged. No single blended "total tokens" figure is added.

## Decision (mine to make, per Josh's standing ruling) + what I rejected
- **The ruling:** Josh ruled to **KEEP THE BLENDED number** (the design's ~$135M
  "Approximate Human Cost"), relayed via Splinter. The stub comment itself said to drop the
  real math in once he decided. So the Value column goes live.
- **Formula = the approved design's, verbatim** (`chaoskosmos-site` origin/main
  `design/token-value.html:249`): `Value = usd( rowTotal / 100000 * 90 )` where `rowTotal`
  is the row's own 4-class token sum, `tokPerHr = 100000`, `blendedRate = 90`. Grand total
  lands on the design's ~$135M headline (control-checked in the test).
- **Format = the design's `usd()`**: `$X.XXB / $XM / $N,NNN / $N`, reusing the page's own
  `usageNum` for the thousands band so one number format drives the page.
- **Rejected — implementing the *whole* design.** The design also shows a blended
  **"150B Total Tokens"** hero. I deliberately did NOT add it: a single blended token total
  is exactly what Josh's **#2617 overrule refused** (cache_read ran ~440x output, so one
  "tokens used" figure is ~440x too large). The four classes stay shown separately and in
  full; only the *dollar* Value is blended, which is the piece Josh actually ruled on.
- **Rejected — changing the output-only money box.** `usageMoneyHtml` stays output-only and
  keeps naming its basis. The Value column and the money box are two labeled framings that
  coexist by design (the design page shows both a blended human-cost headline and separate
  figures).

## Weakest premise
That the money-box (output-only $) and the Value column (blended $) coexisting is not
confusing. Both are explicitly labeled and the design itself pairs them, and I own the
design lane on this card, so I'm treating it as settled. If Josh's in-app eyeball says the
two dollar framings read as contradictory, the fix is a one-line label tweak, not a rebuild.
What would change my mind: Josh saying he wants only one dollar figure, or wants the blended
"total tokens" hero after all (a new ruling that would revisit #2617).

## Changes
1. `web/index.html`
   - Retire `USAGE_VALUE_STUB`; add display-layer constants `USAGE_VALUE_TOKENS_PER_HOUR`
     (100000) + `USAGE_VALUE_BLENDED_RATE` (90), a pure `usageUsd()` formatter, and a pure
     `usageRowValue(total)`.
   - `usageHistoryHtml`: Value cell now renders `usageRowValue(total)`.
   - Update the section's stale copy ("Value is pending a pricing decision" → "Value
     estimates the human work each day represents") and the now-wrong stub comment.
   - Remove the orphaned `.uh-stub` CSS rule.
2. `web.token-usage-2617.test.js` — lift the new consts + `usageUsd`/`usageRowValue`; replace
   the "Value is STUBBED" test with tests pinning `$932,173` / `$856,775` (hand-computed from
   the fixture) + the `usd()` format bands + a ~$135M grand-total control.
3. `docs/browser-checks/render-token-usage-2617.js` — the covering browser-check: assert every
   Value cell shows a live blended `$` figure and "pending" is gone (was: asserts stubbed).

## Verify
- `node --test web.token-usage-2617.test.js` — 16/16 (math pinned, control on the $135M scale).
- `browser-checks-reason-grep.test.js`, `test-bc-surface-map.sh`, surface-gate — pass.
- Full `tools/run-tests.sh` node suite — green.
- Browser-check render (pw-runtime headless) after commit — the Value column shows live $.
- Staging-first; prod stays Josh-gated.
