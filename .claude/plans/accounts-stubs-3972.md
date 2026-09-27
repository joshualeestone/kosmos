# #3972: stub gemini/grok binaries in the harness instead of pinning /api/runners

## Finished looks like
render-accounts-openai passes on a Mac with and without the gemini/grok tools installed, with no
/api/runners route in the check, and a control arm (stub removed) still fails on the key step.

## Change
- tools/browser-checks.sh: the render-accounts-openai board gets AGENT_WORKFORCE_GEMINI_BIN and
  AGENT_WORKFORCE_GROK_BIN pointing at fake executables, so engine/runners.js's real detection reports
  both present. KOSMOS_BC_KEYED_STUBS_ABSENT=1 points them at a missing path (the control arm).
- render-accounts-openai.js: the /api/runners page.route pin and its two env control arms are gone; the
  check asserts the board's own /api/runners reports both present, by name, then drives the key step.
- README row follows.

## Decided
- The control arm lives in the harness (it removes the stubs), because the check no longer controls the
  answer. Rejected: keeping KOSMOS_BC_RUNNERS_BOARD_ERROR; with no route there is no pinned branch to
  exercise, and a board error on /api/runners fails the new named assertion.
- Measured, both ways, on a Mac that HAS gemini and grok installed (/opt/homebrew/bin): the normal run
  passes (detection {gemini:true, grok:true}, every #3566 key-step assertion PASS); the control arm
  (KOSMOS_BC_KEYED_STUBS_ABSENT=1) fails (detection {gemini:false, grok:false}, the key step FAIL) even
  though the real tools are installed. So the override alone decides, and a Mac without the tools (the
  nightly runner) gets the same answer.
- Weakest premise: the nightly runner itself was not run here; the claim that it now goes green for this
  check rests on the override being decisive, which the control arm measures.
- Coordinated with Baron (#3973, branch nightly-3973): no shared files.
