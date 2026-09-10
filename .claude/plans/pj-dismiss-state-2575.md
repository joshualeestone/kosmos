# #2575 (STATE half) - clear a stale needs_you from the Projects "Talk to one of them" area

## The split, and where this half sits
#2575 is "the auto-surfaced per-agent question area shows very often and cannot be dismissed" (Josh, live on 0.6.50). It was built in two halves:
- DISPLAY half (merged, PR #2585): a per-session "Hide" that collapses the area plus a safety breadcrumb that keeps the waiting signal visible and restores it. Hide is a "not now"; it resets on reload and, crucially, keeps the breadcrumb BECAUSE the agent is still genuinely waiting.
- ENGINE half (merged, PigeonPete, PR #2586): `POST /api/agent/<sessionName>/clear-selfreport`, which records `idle` over a waiting-on-a-person self-report so the flag stops surfacing at all.
- STATE half (this PR): the button that wires the UI to that route.

## Why a second control, not a change to Hide
Hide and Clear answer two different operator intents and must stay distinct:
- Hide = the agent IS waiting, I will answer later. Session collapse, breadcrumb stays (never a false calm).
- Clear = the agent is NOT actually waiting (it resumed work and never self-cleared the needs_you). This resolves the underlying state, so after it there is genuinely nothing waiting and nothing to keep a breadcrumb for. On reload it stays cleared, unlike Hide.

## The change (web/index.html only, no backend)
- Markup: a "Not waiting? Clear it" button (`#pj-question-clear`) plus a status line (`#pj-question-clear-msg`) INSIDE the `#pj-question` block. That block only renders when `body.asking` is true, so the control appears exactly when there is a waiting claim to clear.
- `PJ_QUESTION_AGENT`: paintThread captures the asking agent's `sessionName` (`= body.asking ? body.agent.sessionName || null : null`) and nulls it when not asking. The button reads THIS, not the picker, so a click always targets the exact agent whose flag is on screen, and can never clear a flag no longer painted.
- `pjClearState()` (named, so the test lifts and runs the real body): POSTs `/api/agent/<target>/clear-selfreport` with `{reason:'operator-dismissed'}`, same-origin cookie auth (mirrors pjSend, which sends no token header). On `res.ok && body.ok === true` it calls `loadThread()` so the next paint sees `asking:false` and takes the question off screen. On any other outcome it writes "We could not clear that just now. Try again." to the status line. The button is disabled for the round trip and re-enabled in `finally`.
- CSS: a quiet underlined text button matching `.pj-thread-hide`, plus the status line.

## Keyed on `cleared`, not `by` (Pete's contract)
The route returns `{ok, cleared, state, by}`. `cleared:true` means a real waiting flag was superseded; `cleared:false` is the documented idempotent no-op (already idle, or the agent self-cleared in a race). Both mean the agent is not-waiting now, so both refresh. `by` is provenance (can be 'auto' or null on the idempotent path) and is deliberately never consulted as a success signal - a test pins its absence from the function.

## Safety (the #370 / #2146 false-calm rule)
Clearing is a deliberate operator assertion that the flag is stale, and it actually resolves the state (engine records idle), so it introduces no false calm: after a successful clear there is nothing waiting. If the agent asks again later, a fresh needs_you re-surfaces normally. This is the opposite of Hide, which must keep the breadcrumb precisely because it does NOT resolve the state.

## Test
`web.pj-clear-state-2575.test.js` lifts the real `pjClearState` and runs it against stubs: success refreshes and POSTs the right route/body; `cleared:false` still refreshes (never keys on `by`); a rejected response and a thrown fetch both surface a message, do not refresh, and re-enable; a null target is a no-op. Plus source-pins: paintThread captures `PJ_QUESTION_AGENT` from `body.asking`, the function never reads `.by`, and the button ships inside the question block distinct from Hide. Node suite green locally (8/8); fold-boxes (the display-half source-eval) still green.

## Browser-check gates
- #1720 coarse gate: this bot cannot run a headed served browser (it is not claude-fe), so the served click-verify (a stale flag clears, the question comes off screen, a reload stays cleared) is routed to the claude-fe browser-remainder pass, and the change carries a `Browser-check:` commit trailer, same as #2585 (display) and #2574 shipped.
- #2518 surface gate: `render-thread.js` (which exercises the pj-question surface) declares no `Browser-check-surface:` tokens, so `bc-surface-map.sh covering` on this diff is empty - no per-check override is needed.

## Scope boundary
UI button only. No backend change (the route already merged). Does not touch Hide, the breadcrumb, or pjApplyEngMode. Does not touch the account-disconnect confirm copy (that is #2531, a separate branch).
