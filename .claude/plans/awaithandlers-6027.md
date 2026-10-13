# awaithandlers-6027: browser-check handlers that wait before answering cannot crash at teardown

Card: kosmos#6027 (follow-up to #6022 / PR #6025). Stacked on teardownguard-6022: rebased onto main once #6025 merges.

## Finished looks like
No browser-check route handler can answer after the browser closed without that rejection being caught, whether it
fetched (#6022) or waited on a timer, a held promise or a gate (#6027); the guard refuses both shapes.

## What changes
- `browser-checks-teardown-guard-6022.test.js` (widened, same file as #6022): in ANY route handler, every answer
  (fulfill / continue / fallback / fetch) after the handler's first fetch or first await must be awaited inside a try
  with a catch, or chain its own `.catch(`; an abort must chain `.catch(`. An await whose operand IS the answer does
  not count as waiting (that answer is immediate). A handler's span is now its own `.route(` call, to the matching
  paren (literal contents blanked so a paren in a string or regex does not count), not "up to the next .route(".
- 23 checks: each flagged handler's body wrapped in `try { ... } catch { await r.abort().catch(() => {}); }`, every
  answer awaited; one-line handlers split across lines to wrap them (patterns identical); one 8 s one-liner uses the
  accepted `return await r.fulfill(...).catch(() => {})`.

## Decisions
- Same rule as #6022 (the try, not an unroute): measured there, a late answer after close crashes the bare handler and
  is caught by the try in every close order.
- Deliberate aborts that a check relies on (render-plus-signin-3478 verifyAbort, render-assistant-bubble-3034 B13,
  render-teamcreate-4557 drop) keep aborting while the page is open; only a rejection after close is silenced.
- A JSON.parse of a request body now inside the try aborts on a malformed body instead of crashing; every check sends
  valid JSON, so no check behaves differently.

## Weakest premise
Reasoned from #6022's measured mechanism, not measured per handler: whether each handler is ever still waiting when
its check closes depends on timing. The guard reads source text (its limits are listed in its header).

## Tests
- The guard: fixtures (5 new for #6027) pass; green on the whole folder.
- Every changed check run on this branch where it boots its own board; the rest in CI's browser-checks job.
