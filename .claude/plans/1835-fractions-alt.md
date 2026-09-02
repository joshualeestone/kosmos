# kosmos#1835: frActions must render the alt when primary is null

## The problem
web/index.html `frActions(primary, alt)` discarded the `alt` whenever `primary`
was null. The `!primary` guard exists only for the agent-search interim screen,
which passes NEITHER button and must show nothing, but it also killed a
legitimate alt when one WAS passed with a null primary. Five first-run buttons
rode on `frActions(null, { alt })` and never painted:
- the four Cancels across the download, install and sign-in steps
  (`frActions(null, { label: 'Cancel', ... })`)
- the model step's "Skip connecting a model" quiet link
  (`frActions(null, { label: 'Skip connecting a model', ..., link: true })`)

Found by Angel, source-traced and confirmed exact by Mona Lisa.

## What was built
In the `!primary` branch, render the alt when one is present and hide both only
when the alt is also absent. The new alt block mirrors the existing
`primary && alt` block below it field-for-field: `hidden = false`,
`textContent = alt.label`, `onclick = alt.go`, `disabled = false`,
`classList.toggle('is-link', alt.link === true)`. The no-alt else path matches
the primary branch's else: `hidden = true`, `onclick = null`. Agent-search still
passes no alt, so it still shows nothing.

## Decisions (mine)
- Mirror the existing alt block exactly rather than factor out a shared helper.
  The two blocks are now identical, but a mid-fix refactor of a live first-run
  path is a larger, riskier change than the bug warranted; the smaller diff is
  the reversible choice, and a later extraction is a clean follow-up.
- `alt.link === true` kept as strict equality, matching the sibling block, so a
  truthy-but-non-boolean `link` does not silently draw a link.
- No change to the `next.onclick` handling on the hidden-primary path. It is
  pre-existing and harmless (the button is hidden), and touching it is out of
  scope for this fix. Recorded as a NIT in the challenge-loop proof.

## Changes (web/index.html only, plus one test file)
- web/index.html: the `!primary` branch of `frActions` now renders the alt when
  present, else hides both. Comment added explaining the five buttons that hit
  the bug and why the guard must not kill a legitimate alt.
- web.firstrun-fractions-1835.test.js: new runnable source coverage. It extracts
  the `frActions` body from web/index.html by brace-matching and drives it with a
  stub DOM (`fr-next` / `fr-alt`), the same pattern the sibling first-run tests
  use for frPaintSubscription / frPaintOpenai. Five arms: null+alt renders the
  alt (the bug), null+link-alt draws a quiet link (the model Skip), null+no-alt
  shows nothing (agent-search intent preserved), primary+no-alt shows only the
  primary, primary+alt shows both. Verified the arms RED on origin/main (null+alt
  left fr-alt hidden) and GREEN on the fix. All sibling first-run/connect tests
  stay green.

## Browser-check trailer (#1720 / #1769)
The commit carries a `Browser-check:` trailer because the fleet has no
browser-check runtime right now (kosmos#1769). The honest route is runnable node
source coverage plus Josh's live first-run walk, NOT a docs/browser-checks/*.js
file that nobody can execute. `tools/lib/browser-check-gate.sh`
(`kosmos_browser_check_gate`) accepts the override on that rationale and exits 0.
A rendered docs/browser-checks entry follows when #1769 unblocks.

## Not done (deliberately deferred)
- Extracting the now-duplicated alt-render block into a shared helper. A follow-up,
  out of scope for a targeted bugfix.
- A runnable docs/browser-checks/*.js entry. Blocked on #1769; the interim is the
  node source coverage above plus Josh's live walk.
