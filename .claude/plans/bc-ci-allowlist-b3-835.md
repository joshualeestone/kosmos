# bc-ci-allowlist-b3-835 - expand the per-PR browser-checks CI allowlist (batch 3)

## Source
#835 (cut-efficiency). Batch 3 of the incremental KOSMOS_BC_CI_ALLOWLIST expansion in
browser-checks.yml, so a break in more render checks fails at the PR, not at the cut.
Follows merged batch 1 (#2747) and batch 2 (#2753).

## The mechanism (unchanged)
KOSMOS_BC_CI_ALLOWLIST is a FILTER over checks the driver already invokes; all five added
here are in browser-checks.sh's no-board/no-arg loop (run bare, file:// or self-stubbed, no
board, no args), so this is a names-only change. Self-validating: this PR edits
browser-checks.yml (in the job's own path filter), so the expanded set runs on the runner in
THIS PR's CI, and the driver's never-ran guard hard-reds a misspelled/never-running name. A
wrong pick reds this PR before merge.

## Change
Add five verified DOM-state candidates (headers read; each reads rendered hidden/text/class/
focus/event state, not fragile geometry):
- **render-inline-field-errors-2606** - Create-agent/Create-project field-level validation
  errors render inline (the .ferr slots, message beside the field, focus). Drives the
  shipped pjFieldBad/pjFieldOk helper + the #pj-create empty-name gate, file://, no board.
  Reads class + text + focus state, AND a COARSE computed-borderColor check (isColored =
  non-transparent, and borderColor != a captured baseline) - not an exact or cross-element
  color value. This is headless-SAFE and distinct from the excluded render-openai-key-callout-2164
  below: getComputedStyle color is resolved by the CSS style engine, NOT the paint/compositor
  pipeline, so SwiftShader software rendering does not affect it (the fragile class is
  screenshots and exact-pixel geometry, which this does not do); and the check is coarse
  (changed/non-transparent), whereas 2164 asserts EXACT color-string equality between two
  different elements. 2164 is also excluded for a second, independent reason: it needs a live
  KOSMOS_URL/board and is NOT in the no-board loop. The same-PR CI is the definitive backstop
  for the computed-color question either way.
- **render-disconnect-stop-2570** - the Settings row's three-press confirm flow
  (arm -> refusal-with-names -> stop) and that the third press's request carries the flag.
  Button/confirm DOM state, no geometry.
- **render-plus-gate-1615** - the Kosmos Plus tab gates the on-switch on enrolment: an
  unenrolled machine shows state-1 with NO "Turn on" switch; an enrolled one shows the
  switch. Presence/absence of the switch, pure DOM.
- **render-remove-force-2651** - the untied-remove override affordance shows only in the
  untied-refusal state and NOT in any other removal state. Drives the real loadRemoval();
  presence/absence across states.
- **render-firstrun-connect-fires** - the first-run #fr-llm-connect button must actually
  FIRE the connect flow on click (the delegated-on-the-wrong-pane dead-button bug). Event
  wiring, no geometry.

## Excluded while shortlisting this batch
- render-openai-key-callout-2164 - excluded for a DECISIVE reason and a secondary one. Decisive:
  it needs a live KOSMOS_URL/board and is NOT in the no-board/no-arg loop, so it would be
  reported "never ran" = FAILED in the CI path regardless of the color question. Secondary: it
  asserts EXACT color-string equality of the computed `color` between two DIFFERENT elements
  (the OpenAI callout must match the Claude one's ink and not the muted grey .dhint) - a tighter
  computed-color assertion than 2606's coarse non-transparent/changed-from-baseline check. (Note:
  the coarse computed-color read in 2606 is kept and is headless-safe - see its entry above - so
  "computed color" alone is not the exclusion criterion; the needs-a-board fact is.)

## Verification
- This PR's own browser-checks CI runs the expanded allowlist on the runner. GREEN means all
  five run and pass headless; a RED naming one means drop it (with the driver's reason) and
  re-push. Merge only on green.
- Node unit suite unaffected (yaml-only change); test.yml stays green.

## Weakest premise
That all five run green headless on the runner. If one does not, this PR's own CI catches it
before merge and I drop that name - self-validating, so a wrong pick costs an iteration, never
a bad merge. (Three of the five drive confirm/DELETE/connect flows, but all are in the
no-board file:// loop, so no live board is touched; the shipped checks already run sandbox-safe
at the cut.)
