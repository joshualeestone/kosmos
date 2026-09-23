# Plan: Gemini provider logo (#3422)

## Card premise vs reality (diligence, before building)
Card: "Gemini provider logo is missing in the UI, where other providers show theirs, Gemini shows
none." Josh sent an asset (~/.cache/claude-handoffs/Gemini-Logo-3422.svg).

MEASURED against origin/main (3b7db3bad): Gemini is NOT absent. It already has a `.pmark` SVG (a
multi-color radial-gradient spark, added by #2316 on 2026-09-05) in the first-run provider list
(web/index.html ~10828), and `PROVIDER_MARK_KEY` maps `google -> gemini` so `providerMarkNode`
CLONES it into the enhanceProviderSelect combobox (settings + create-agent pickers).

## Root cause (why Josh saw "none")
`providerMarkNode` CLONES the firstrun `[data-pmark="gemini"]` span into the combobox. The gemini
mark's fill was `url(#pmark-gemini-g)` -- a radialGradient defined INSIDE that SVG with a fixed id.
Cloned, the id duplicates and the reference depends on the gradient def living in the (hidden)
#firstrun; that is exactly the shape that renders BLANK in the cloned combobox mark, while the
monochrome `currentColor` marks (Claude, OpenAI, Qwen, ...) clone fine. So Gemini showed no mark in
the settings/create picker -- "where the other providers show theirs, Gemini shows none."

## Fix (uses Josh's verbatim asset)
Replace the gemini `[data-pmark="gemini"]` SVG with Josh's provided asset: a single `currentColor`
path (viewBox 0 0 300 300), no gradient/def. currentColor:
- clones into the combobox with no gradient-id dependency, so it always paints;
- dims/lives with `.pmark .dim/.live` like every other provider mark (the gradient did not);
- is the clean spark Josh sent, consistent with the other monochrome marks the card compares to.
Updates BOTH surfaces (first-run list + combobox) because the combobox clones this one source.
Verified no orphaned `url(#pmark-gemini-g)` reference remains (the only mention left is this file's
explanatory comment).

## Decision / weakest premise
- Rejected: blind-"add a mark" (the card premise) -- Gemini already had one; adding a second would
  be wrong. Rejected: keeping the color gradient -- it is the thing that clone-blanks and does not
  theme. Using Josh's monochrome asset both honors his send and fixes the clone-blank.
- Weakest premise: that Josh wants the monochrome spark (matching the other providers' monochrome
  marks) rather than a colored Gemini brand. His asset IS monochrome and the card says "like the
  other providers" (which are monochrome currentColor), so this reads correct. Reversible.

## Remaining (tail)
- Browser-check render-gemini-logo-3422.js: enhanceProviderSelect on a provider select, assert the
  gemini option's cloned mark renders a non-empty currentColor `<svg><path>` (NOT blank, NOT a
  gradient url), and that it is the 300-viewBox spark. Control: a monochrome sibling (claude) also
  renders. Wire runner + README + surface annotation (#1720: a web change needs a browser-check).
- Challenge-loop -> PR (Addresses #3422, non-closing) -> CI -> merge -> verify -> remove worktree.

Addresses #3422
