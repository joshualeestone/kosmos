# bc-ci-allowlist-b11-835 -- expand per-PR browser-checks CI allowlist, batch 11 (#835)

## What and why
#835 (cut-efficiency): render-check regressions should fail at the PR, not at the release
cut. `KOSMOS_BC_CI_ALLOWLIST` in `.github/workflows/browser-checks.yml` names the subset of
`docs/browser-checks/*.js` render checks the per-PR CI runs headless on every PR touching
`web/`. Batches 1-10 grew it 8 -> 40. This batch adds 3 more (40 -> 43).

Editing `browser-checks.yml` triggers its own path-filtered CI, which runs the expanded
allowlist, so this PR self-validates: the driver's never-ran guard hard-reds a misspelled or
never-running name, and any check that reds headless reds this PR before merge.

## The 3 checks added -- the getComputedStyle seam
Batch 10 exhausted the zero-signal, zero-getComputedStyle seam. This batch mines the next one:
checks whose only flagged signal is `getComputedStyle`, where the property read is a
RESOLVED-STYLE value, not layout geometry. A resolved-style read (`display`, `filter`,
`fontSize`) is computed from the CSS cascade and is identical headless vs headed -- unlike
`getBoundingClientRect`/`boundingBox`, which depend on the compositor and can false-red under
headless SwiftShader. So these are safe for the always-run subset. Each is file:// hermetic,
has zero fixed sleeps in the assertion path, and was RUN headless against current main
(origin/main @ the batch-10 merge) exiting 0.

- **render-tophead-consolidated-2282** -- file:// load of web/index.html. Asserts the single
  top-header model across views by reading `getComputedStyle(el).display` on the header
  controls and rail copies (flex vs none). Fully synchronous, no server, no fixed sleeps.
  PASS headless.
- **render-emoji-mute-2357** -- file:// load. Asserts the composer emoji glyph is muted by a
  grayscale `filter` on the glyph span (not the button) and keeps its accessible name, by
  reading `getComputedStyle(span).filter` (resolves even in a hidden pane, per the check's own
  note). `filter` is a resolved CSS value, deterministic. No server, no fixed sleeps. PASS
  headless.
- **render-workindicator-2146** -- file:// load. Asserts activeWhileWaiting paints the working
  glyph alongside needs_you/blocked additively, reading `.display` and `.fontSize` (13px vs
  10px in the consolidated view). Both are resolved-style, not layout geometry. No server, no
  fixed sleeps. PASS headless.

## Deliberately EXCLUDED this batch
- **render-firstrun-s6-2037** (3 fixed sleeps) and **render-subprojects-1994** (2 fixed
  sleeps) -- both file:// with discrete getComputedStyle reads, but settle with fixed sleeps,
  so deferred on the same reliability basis as batches 9-10 (fixed-sleep-only checks can
  intermittently red other PRs in the always-run subset).
- The batch-10 deferrals (render-create/detail-openai-model-2140, 40ms settles;
  render-addmem-flash-2429/render-bubblepop-2407, 1200ms server-boot settles; live-connect,
  a CLI check) remain out for the same reasons.

## Weakest premise in my own reasoning
That every property these 3 checks read via getComputedStyle is a resolved-style value
independent of the compositor. `fontSize` and `filter` and `display` are; a `marginLeft` or a
percentage length could in principle resolve against a laid-out parent. I read each
getComputedStyle call and confirmed the properties are display/filter/fontSize only (no
width/height/top/left/transform/getBoundingClientRect anywhere). Mitigation: each was run
headless on current main and passed, and the per-PR CI self-validation re-runs them on a clean
runner before merge; if any reds there I drop it. What would change my mind: a red or a
non-deterministic result in this PR's browser-checks job.

## Scope guard
Advisory allowlist only. Does NOT enable branch protection or make any check required (parked
for Josh's Pro/make-public money call). yaml + plan-md only; inert to the node unit suite.

## Steps
1. Append the 3 names to KOSMOS_BC_CI_ALLOWLIST in browser-checks.yml. [done]
2. challenge-loop to convergence; write the pre-challenge proof.
3. PR to joshualeestone/kosmos (literal cd for the gate; no --reviewer; no em dash).
4. Watch browser-checks CI; on green squash-merge; remove the worktree.
5. Append the batch-11 result to the daily note.
