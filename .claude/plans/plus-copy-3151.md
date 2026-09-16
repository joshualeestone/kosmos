# Plan: #3151 — delete the top "Kosmos Plus" heading + subcopy on the Plus page

Josh (2026-09-15, QA on the app): on Settings > Kosmos Plus, delete the top "Kosmos Plus" heading
and the "Use your Kosmos from anywhere." subcopy so the "Already have Kosmos+? Sign in" bar reflows
to the top. Everything below (the KOSMOS+ logo, "Your Kosmos, wherever you are", the marketing tiles)
stays. Prioritized; shipped as a fast standalone PR ahead of #3149 (which reworks the same page's
sign-in region on a future cut).

## Done-condition
- `web/index.html` #s-sec-plus no longer renders the `<h2>Kosmos Plus</h2>` or the
  `<p class="fhint">Use your Kosmos from anywhere.</p>`; the sign-in bar sits at the top.
- The section keeps `aria-label="Kosmos Plus"` (accessible name unchanged) and the Settings nav pill
  still reads "Kosmos Plus".

## Approach (chosen)
Delete the two lines (13009-13010), leaving an explanatory comment. Update the
`render-plus-gate-1615` browser-check (#1720): it asserted `#s-sec-plus h2` textContent === "Kosmos
Plus"; that heading is now gone, so re-point it to assert the removal (heading gone, subcopy gone)
plus the survivors (aria-label + nav pill). Non-vacuous — it would red on origin/main.

## Rejected
- Folding this into #3149: #3149 rides a future cut, this is prioritized — folding ships it too late.
- Hiding via CSS instead of deleting: Josh asked to delete the copy, and a reflow needs the DOM gone,
  not display:none (the bar must move up).

## Weakest premise
That no other test asserts the deleted strings. Checked: the only "Kosmos Plus" test match is the
sidebar nav button (unaffected); no test asserts "Use your Kosmos from anywhere". Full JS suite green
(7734, 0 fail) and the browser-check green headless in both themes confirm it.

## Verification
- `bash tools/run-tests.sh`: SUITE_EXIT=0 (JS 7734/0-fail + all shell tests).
- `render-plus-gate-1615` headless (both themes): heading removed, subcopy removed, aria-label + nav
  pill kept — all pass.
