---
pre_challenge: true
method: challenge-loop
branch: accounts-stubs-3972
diff_hash: be5553175765b294d5ae47e81aefd106c7653cd9259d8c4dab0bd5e0e7e9e241
subdir_audit: passed
timestamp: 2026-09-27T02:25:55Z
converged: true
---

## Challenge loop: #3972 render-accounts-openai reads real runner detection

#### Iteration 1 (blind, opus)
No issues found. NO NEW FINDINGS. What the reviewer checked, each verified by reading:
- Old pin: KOSMOS_BC_RUNNERS_ABSENT, KOSMOS_BC_RUNNERS_BOARD_ERROR and RUNNERS_ROUTE appear nowhere now; no stale
  "pins /api/runners" wording remains in docs or other checks.
- Detection: engine/runners.js returns present: isRunnable(env) as soon as the override is set (gemini 736-737,
  grok 765-766), before any managed or legacy lookup. On POSIX isRunnable needs only an executable regular file,
  which a chmod +x shell stub is; browser-checks.yml runs on macos-latest only, so the Windows PATHEXT rule never applies.
- Nothing spawns the fakes: runners.status() only resolves paths; /api/antigravity reads agy via engine/agystatus,
  not the gemini path; the grok subscription start route is never called by this check; the Gemini key save is stubbed.
- Earlier assertions unchanged: /api/accounts does not consult gemini/grok presence; keyedRunnerInfo is the page's
  only reader of that answer.
- Leaks: the overrides sit only on the P4 board, which only render-accounts-openai uses; the control env is read only
  in the new block.
- Meta-tests pass: tools.browser-checks-wired 9/9, fixture-discipline 20/20, browser-checks-selectors 4/4,
  browser-checks-reason-grep 5/5, tools.browser-checks-home-3675 6/6, tools.cut-home-2724 11/11,
  tools.mobile-shots-leak-718 8/8, tools.browser-checks-skills-3801 8/8, web.provider-groups-1393 8/8,
  render-talk-goldencard-2519 35/35, tools.every-test-runs + engine/status.config-root-guard 8/8.

## Evidence
- Harness, render-accounts-openai at 4abc358bc on a Mac WITH gemini/grok installed:
  normal: PASS "#3972 the board detects the gemini and grok tools" {gemini:true, grok:true}, all #3566 key-step PASS;
  control KOSMOS_BC_KEYED_STUBS_ABSENT=1: FAIL detection {gemini:false, grok:false} and FAIL the key step,
  though the real tools are installed (the override alone decides).
- Full suite at c720d1d18: exit 0, 10240 pass, 0 fail; #1720 and #2518 gates ran inside it.
