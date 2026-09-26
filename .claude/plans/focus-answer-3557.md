# #3557: needs-you answer flow loses keyboard focus to body (detail -> back -> answer)

**Branch:** `focus-answer-3557` · **Card:** kosmos#3557.

## Symptom

After viewing one agent's detail panel and going back, answering a DIFFERENT agent's needs-you
card left keyboard focus on `<body>` instead of the answer composer (`#d-say`). A keyboard user
had to re-traverse the whole document to reach the composer they just chose to answer in. The
clean flow (navigate straight to an agent and answer) worked, so this was flow-dependent.

## Diagnosis (via the render-thread fixture harness, headless)

Ran `docs/browser-checks/render-thread.js` against the `thread-server.js` fixture with a temporary
focus tracer. The sequence in the failing flow:

1. Paint 1 focuses `#d-say` correctly (`ANSWER_WANTS_FOCUS` matches, presence on).
2. The answer button sits INSIDE a card that is torn down when the panel opens, so activating it
   removes the focused button from the DOM and focus falls to `<body>` (observed: button focusin,
   then focusout to body) AFTER paint 1.
3. The recovery paint (paint 2) skipped: `ANSWER_WANTS_FOCUS` had been consumed on paint 1, AND it
   read a STALE `say.disabled=true` (that flag is written ~120 lines below from the same
   `presence`, so at the top of a paint it reflects the PREVIOUS paint). So nothing re-applied
   focus, and it stayed on `<body>`.

## Fix (`web/index.html`, the `renderStale`-adjacent panel-paint focus block ~25792)

Re-apply focus across the one-paint teardown steal, but BOUND the intent's life BY TIME so it can
never yank focus later. The intent (`ANSWER_WANTS_FOCUS`) is time-bounded by `ANSWER_WANTS_FOCUS_AT`
(a monotonic `performance.now()` stamp) and `ANSWER_FOCUS_WINDOW_MS` (750ms):

1. The clock is stamped on the FIRST PAINT THAT OBSERVES the intent, NOT at the press. The press
   only starts an async thread fetch (`openDetail`); anchoring to the press would fold that variable
   network latency into the budget, so a slow read could expire the window before the panel ever
   paints (a silent, fail-safe no-op, and stricter than render-thread's own 10s waits). Measuring
   from the first observing paint decouples the window from the fetch: it only covers paint-1 -> the
   recovery paint (a few ms).
2. Within the window, on the intent's agent, composer open, and focus on `<body>`: enable the
   composer and focus it (recovers the first paint AND the teardown steal on the paint right after).
3. Decide focusability from the NEXT state (`body.presence`), not the stale `say.disabled`, and
   enable the composer before focusing (focusing a still-disabled element is a no-op). The
   authoritative `say.disabled = body.presence === 'off'` write later in the same paint re-derives
   the same value; this only pulls that decision earlier for this one paint.
4. Drop the intent (reset the clock) when the window has passed, when a DIFFERENT agent is open, or
   when the agent is off. Never re-grab focus that is already on a real element (only a `<body>`
   steal is recovered).

Why time and not "consume once focus settles": the teardown steal lands AFTER the first paint that
focuses the composer, so consuming on that paint loses focus to the steal (the original bug). An
intermediate fix that kept the intent until focus settled re-introduced a "lying in wait to yank
focus on a later visit" hazard - a pending intent surviving a leave/return (even to the SAME agent,
since `#detail-back` does not reset `CURRENT`) and re-firing where the user never pressed answer,
and a 5s poll re-grabbing focus a user had deliberately parked on `<body>`. Both were caught in the
challenge loop. A `<body>` from the teardown and a `<body>` from a deliberate blur are
indistinguishable by state; only their TIMING separates them, which is what the window uses: it
outlives the ~45ms steal (measured, from first observation) but is kept short (750ms) so it stays
far below both the 5s poll's cadence and a human blur reaction. The residual (a deliberate blur to
`<body>` AND a poll tick BOTH landing within 750ms of the press) is negligible and fails toward one
extra focus of the composer the person just chose to answer in; an earlier 2000ms window was
shrunk after the challenge loop noted its ~40% overlap with the poll.

### Clean-flow coverage (known gap, low risk)

render-thread.js's focus assertion exercises only the detail -> back -> answer flow. The CLEAN flow
(navigate straight to an agent, then answer) has no separate focus assertion. It is safe by
construction and by shared code path: pressing answer runs `openDetail`, which tears down the card
holding the pressed button, so focus drops to `<body>` before the first paint in BOTH flows, and
both go through the exact same focus block. A regression in the clean flow would therefore almost
certainly also break the covered detail-flow assertion. Adding a second harness flow was judged out
of scope for this fix (new fixture wiring, flakiness risk) and is left as a follow-up.

## Verification

`render-thread.js` (headless, thread-server fixture): the focus-to-composer assertion flips from
FAIL (`activeElement is (body)`) to PASS. Trace confirms the recovery: button blurs to body, then
`#d-say` is re-focused.

Note: `render-thread` is NOT in the CI browser-checks allowlist (`KOSMOS_BC_CI_ALLOWLIST`) - it
SENDS, so it runs only at the headed release cut (3b), not in CI. The local headless run is the
verification here; the assertion is a DOM-state `activeElement.id` check, which is headless-robust.
The two other render-thread failures ("says-line has no size", "verdict says what the agent was
doing") are pre-existing, timing/paint-class and headless-weak (they fail on unmodified origin
too), unrelated to this card.

## Coordination

The temporary focus SKIP on the `render-thread-3552` cut branch (which cites #3557 to unblock the
0.6.91 cut) can be dropped once this lands - the assertion is active on `main` and now passes. When
`render-thread-3552` rebases/merges, it should NOT re-introduce the skip.

## Weakest premise

That the two remaining render-thread failures are genuinely pre-existing/headless-weak and not
disturbed by this change. Checked: both fail identically on unmodified origin/main (ran before any
edit), and this fix touches only the answer-focus block, not layout geometry or the verdict line.
What would change my mind: either failing differently after the fix (they do not).
