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

Re-apply focus across the one-paint teardown steal, but BOUND the intent's life so it can never
yank focus later:

1. Keep the intent live ONLY while focus is on `<body>` (the transient steal window). On such a
   paint, enable the composer and focus it; the button-teardown steal on the paint after the first
   is then recovered.
2. Decide focusability from the NEXT state (`body.presence`), not the stale `say.disabled`, and
   enable the composer before focusing (focusing a still-disabled element is a no-op). Line 25951
   (`say.disabled = body.presence === 'off'`) re-derives the same value; this only pulls that
   decision earlier for this one paint.
3. Consume the intent the moment focus settles anywhere real - the composer we placed it in, OR a
   control the user moved to - so a routine poll repaint never yanks deliberately-placed focus.
   Also drop it when the agent is off (nothing to answer into), and when a DIFFERENT agent is
   opened (the mismatch arm) - without that last drop a pending intent for B would survive a
   navigation to C and re-fire on a later visit to B where the user never pressed answer (caught in
   the challenge loop as the "lying in wait to yank focus" hazard the old consume-on-first-paint
   had prevented).

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
