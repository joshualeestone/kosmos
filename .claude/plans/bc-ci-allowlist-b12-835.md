# bc-ci-allowlist-b12-835 -- expand per-PR browser-checks CI allowlist, batch 12 (#835)

## What and why
#835 (cut-efficiency): render-check regressions should fail at the PR, not at the release
cut. `KOSMOS_BC_CI_ALLOWLIST` in `.github/workflows/browser-checks.yml` names the subset of
`docs/browser-checks/*.js` render checks the per-PR CI runs headless on every PR touching
`web/`. Batches 1-11 grew it 8 -> 43. This batch adds the last 2 clean picks (43 -> 45).

Editing `browser-checks.yml` triggers its own path-filtered CI, which runs the expanded
allowlist, so this PR self-validates: the driver's never-ran guard hard-reds a misspelled or
never-running name, and any check that reds headless reds this PR before merge.

## The 2 checks added -- and why this is the FINAL batch of the thread
A comment-stripped sweep of ALL 59 remaining no-board/no-arg candidates (stripping lines whose
only fragile-signal hit is inside a comment, e.g. the word "screenshot" in a doc header) leaves
exactly these two surviving the bright-line (file:// hermetic, zero fixed sleeps, zero real
geometry/screenshot/canvas/scroll/animation, getComputedStyle reads confined to resolved-style
properties). Every other remaining candidate has a real getBoundingClientRect/boundingBox read,
a fixed setTimeout/waitForTimeout settle, or an in-process server boot. Each of these two was RUN
headless against current main and exited 0.

- **render-build-marker-2066** -- file:// load of web/index.html. Asserts the build-marker paints
  a dim version in prod, a loud badge in staging, falls to prod for an absent channel, and hides
  when empty. Reads `.hidden`, className, textContent, title, and getComputedStyle `color` /
  `backgroundColor` / `borderTopColor` -- resolved COLOR values, deterministic from the CSS
  cascade and identical headless vs headed (colors do not depend on the compositor). Fully
  synchronous, no server, no fixed sleeps. PASS headless.
- **render-richtext-2067** -- file:// load. Renders the real pjRich markdown pipeline into a real
  bubble and asserts structure (bold/heading/list/code/quote/autolink/emoji via querySelector +
  innerHTML) AND the XSS control (an injected `<script>alert(1)</script>` is neither an executed
  element nor raw script text). getComputedStyle reads are `fontWeight` (heading) and
  `backgroundColor` (inline code) only -- resolved-style, not geometry. 120 assertions, no server,
  no fixed sleeps. PASS headless. (Bonus: this is an injection-safety check, valuable to run per-PR.)

## Why the getComputedStyle reads are safe (same basis as batch 11)
A resolved-style read -- `color`, `backgroundColor`, `borderTopColor`, `fontWeight` -- is computed
from the CSS cascade and returns the same value headless (SwiftShader) as headed (real
compositor). Only LAYOUT-geometry reads (`getBoundingClientRect`, `boundingBox`,
`offsetWidth/Height`, or getComputedStyle of `width/height/top/left/transform`) depend on the
rendered box and can false-red headless. Neither check reads any such property.

## Deliberately EXCLUDED (the rest of the seam, now fully mapped)
Every other no-board candidate is out for a stated reason: real geometry reads
(render-talk, render-settings-nav, render-workchip-zero-2157, render-worldsw-height-2350,
render-busy-line, render-reauth-reach-1918, ... 40+ checks); fixed-sleep-only settles
(render-firstrun-s6-2037, render-subprojects-1994, render-create/detail-openai-model-2140,
render-firstrun-openai-sub-2621, render-firstrun-wizard-flow); in-process server boots with a
boot sleep (render-addmem-flash-2429, render-bubblepop-2407, render-richtext-room-2239); and
live-connect (a CLI check, not a render check). After this batch the mineable allowlist seam is
exhausted -- a further batch would require either re-engineering a check's waits or accepting a
geometry read into the always-run subset, neither of which is a clean overnight pick.

## Weakest premise in my own reasoning
That the comment-stripping filter did not hide a REAL disqualifier by mistaking a code line for a
comment. Mitigation: for both survivors I read the actual assertion code and confirmed by eye the
only getComputedStyle properties are resolved-style and there is no geometry/sleep/server; and each
was run headless on current main and passed. The per-PR CI self-validation re-runs both on a clean
runner before merge; if either reds I drop it. What would change my mind: a red or a
non-deterministic result in this PR's browser-checks job.

## Scope guard
Advisory allowlist only. Does NOT enable branch protection or make any check required (parked for
Josh's Pro/make-public money call). yaml + plan-md only; inert to the node unit suite.

## Steps
1. Append the 2 names to KOSMOS_BC_CI_ALLOWLIST in browser-checks.yml. [done]
2. challenge-loop to convergence; write the pre-challenge proof.
3. PR to joshualeestone/kosmos (literal cd for the gate; no --reviewer; no em dash).
4. Watch browser-checks CI; on green squash-merge; remove the worktree.
5. Append the batch-12 result to the daily note and note the seam is exhausted.
