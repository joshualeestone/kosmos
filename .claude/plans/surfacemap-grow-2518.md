# surfacemap-grow-2518 — grow the browser-check surface map + guard it

## Context (kosmos#2518)
Cut-time-only browser checks (docs/browser-checks/, 131 of them) run at cut 3b and not in
full PR CI, so a product change (#2498, #2487) staled a check with no PR gate catching it.
PigeonPete's #2525 (merged) built the producer half: `browser-check-surface-gate.sh`, a
per-check gate — a check declares its surface tokens `// Browser-check-surface: <tokens>`,
and a web/index.html change touching a declared token without updating that check is refused.
It seeded 2 checks (render-alltasks, render-subprojects). My half (release/browser-check lane,
agreed with Splinter): grow the map + validate its correctness.

## Change
- **Map growth (+8 checks)**: added `// Browser-check-surface: <tokens>` to 8 checks, each token
  a DOM id the check asserts, VERIFIED whole-token-present in web/index.html (gate's exact
  boundary regex) and distinctive (low occurrence, feature-specific): render-build-marker-2066
  (buildmark), render-bubblepop-2407 (pjs-sound-toggle), render-emoji-mute-2357 (pj-emoji-btn),
  render-detail-ring-1915 (d-ring), render-busy-line (d-busy), render-conn-url (fr-conn-url),
  render-adopt-1531 (fr-fleet-title), render-createnav-2190 (create-msg).
  - Deliberately chose feature-specific low-count tokens and SKIPPED shared chrome
    (firstrun/grid/settings/panel-detail), which would over-fire and false-block unrelated PRs.
  - Incremental by design: unannotated checks keep Pete's coarse gate, so the map is never
    falsely complete. This is a first batch; the remaining ~121 are follow-on.
- **Validation guard** (`tools/test-browser-check-surface-map.sh`, wired into test:shell):
  every declared token must be present whole-token in web/index.html, or it is a DEAD annotation
  the gate can never fire on (a silent miss). Red-capable (planted absent token caught),
  non-vacuous (asserts the map is non-empty). This guard caught render-detail-openai-model's
  d-model-row/-msg as not-present, so they were left unannotated rather than added dead.

## Validation
- New test passes standalone (10 annotated checks validated incl the 2 seeds; red-capable control).
- Pete's test-browser-check-surface-gate.sh still passes (annotations do not break the gate).
- test-zsh-tied-names + test-grep-code clean; test wired into test:shell (every-test-runs).

## Scope / weakest premise
Check/test-infra only, no product code. Distinctiveness (a token not over-firing) is a judgment
per check; mitigated by choosing low-occurrence feature tokens + the present-verification guard +
blind review. Weakest premise: a token could be present + low-count yet still sit on a line that
changes for reasons unrelated to the check, causing an occasional over-fire (author resolves via
the per-check override trailer — friction, not a false-block that can't be cleared). The batch is
conservative to keep that risk low; the map grows check-by-check with the same verification.
