# Plan: bc-surface-map-2518 -- surface->check gate so a web change that stales a SPECIFIC browser-check is caught at PR time (#2518)

## The gap (measured)

The ~133 page-layer checks under `docs/browser-checks/` run at release cut step 3b, NOT in the PR
gate; `browser-checks.yml` runs only the 8-check headless-safe `KOSMOS_BC_CI_ALLOWLIST` in CI. And
the existing PR-time gate `tools/lib/browser-check-gate.sh` is COARSE: a `web/` change passes it if
ANY `docs/browser-checks/*.js` is touched OR a `Browser-check:` trailer is present. So a PR can change
the surface a SPECIFIC check asserts, update an UNRELATED check (or use the trailer to defer), pass
the gate, and stale that specific check -- surfacing only at the next cut. This cost 4 cut attempts on
the 0.6.49 cut (2026-09-08): #2498 scoped "view all tasks" and deferred its check "to the cut"
(render-alltasks stale); #2487 added an ancestry line and broke render-subprojects-1994's exact-match.

## Why NOT the naive option-2 (scheduled full-set CI run)

`browser-checks.yml`'s own header records that the first full-suite headless run FALSE-RED on the
timing/animation/paint checks (SwiftShader software rendering), which is why CI runs only the
headless-safe DOM-state subset. A scheduled full-set headless run would be a false-red machine, and
the viable expanded-allowlist form needs classifying which checks are headless-safe -- a browser task
an autonomous no-browser session cannot self-relaunch into. So the durable answer is the surface map,
which is precise AND fully no-browser. (Splinter approved the flip to option-1 on this evidence.)

## The fix (this branch) -- a precise, no-browser surface->check gate

1. Each browser-check declares the distinctive web tokens it asserts, co-located in the check as a
   machine-readable annotation:
   `// Browser-check-surface: <token> <token> ...`
   where each token is a DOM id/class/marker the check keys on AND that appears in `web/index.html`
   (so a diff touching it is detectable). Seeded here for the two checks that staled:
   - `render-alltasks.js`: `pj-alltasks pj-alltasks-view alltasks-count`
   - `render-subprojects-1994.js`: `pj-parent pjsub`
   The map is co-located + incremental: unannotated checks fall back to the existing coarse gate
   unchanged, so this never regresses and grows check-by-check.

2. `tools/lib/browser-check-surface-gate.sh`: collects the annotations, reads the CONTENT of the
   `web/index.html` diff (added/removed lines), and for each mapped check whose token appears in a
   changed web line WHILE that check file was NOT updated in the branch, REFUSES -- naming the check
   and the token. The only ways to pass: update that check, OR a PER-CHECK named override trailer
   `Browser-check-surface: <check-basename> <reason>` (non-empty reason).
   🛑 The blanket `Browser-check:` trailer does NOT excuse a surface-mapped staleness -- that blanket
   defer is exactly what let #2498 through. The override must NAME the check, so a deferral is
   deliberate and auditable per-check.
   Mirrors the existing gate's seams (KOSMOS_BCG_FILES / KOSMOS_BCG_MSGS / KOSMOS_BCG_BASE) plus
   KOSMOS_BCSG_WEBDIFF (the web/index.html content diff), and is fail-soft the same way (cannot diff
   -> return 0, repo-local, never breaks an unrelated run).

3. Wired into `tools/run-tests.sh` right after the existing coarse gate, and `tools/test-browser-check-surface-gate.sh` into `test:shell`.

## Test (tools/test-browser-check-surface-gate.sh)

- 🛑 RED: a web diff changing a mapped token (`pj-parent`) with NO render-subprojects update and NO
  named override -> REFUSED (the #2487 shape). Non-vacuous: passes if the gate is a no-op.
- PASS: same web change WITH the mapped check updated -> allowed.
- PASS: same web change WITH a per-check override `Browser-check-surface: render-subprojects-1994 <reason>` -> allowed.
- 🛑 The blanket `Browser-check:` trailer does NOT excuse it (proves the precision that catches #2498).
- PASS: a web change touching an UNMAPPED token -> allowed (no over-fire beyond the map; the coarse gate still guards it).
- Fail-soft: no diff base -> return 0.

## Ownership / scope

Producer (map + gate + test): PigeonPete. Validator (CI/release-flow integration + the false-red
history + growing the map to the full set): Baron Draxum (release/browser-check lane), when next
working -- flagged by Splinter, not blocked on. This branch delivers the mechanism + seeds the two
checks that bit; it is correct-and-incremental, never coarse-and-falsely-complete.

## Acceptance

A web change that stales a mapped check is refused at PR time naming that check; updating the check or
a per-check named override passes; unmapped surfaces keep the existing coarse-gate behavior;
validation green. Closes the #2518 durable half.
