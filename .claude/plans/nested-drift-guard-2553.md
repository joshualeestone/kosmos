# Plan: #2553 nested drift guard (COMPOSITION-AWARE)

## The gap (#2519 left it open, its own header names it)
render-talk's recorded fixture drives the reopen arm on quiet (agent-less) boxes.
The box-independent guard in render-talk-goldencard-2519.test.js compares only the
TOP-LEVEL key set against status.snapshot(). A rename INSIDE `context` leaves the
top-level set identical, yarn test green, and the recording driving a `context` shape
the producer no longer emits. render-talk.js:150-161 states this is checked by nothing.

## Why option 1 (page-derived, "unguarded reads") is the WRONG design (measured)
The card's option 1: derive the nested keys the PAGE reads and require the fixture carry
the UNGUARDED ones. Measured against web/index.html: EVERY card-context read is guarded
(pctOf uses `ctx && Number.isFinite(ctx.percent)`; memPrint/memUnknown/assumedCeilingNote
all `ctx && ctx.x`/`typeof ctx.because === 'string'`; overCeiling/neverRecorded/noCeiling/
notYet all `ctx && ctx.KEY === true`). There are ZERO unguarded context reads. So an
option-1 guard keyed on unguarded reads requires nothing: a vacuous guard, the exact
"branch that cannot fire" defect this tree obsesses over. Refuted my own scoping comment.

## The design built (option 2, producer-anchored, in the TEST file)
Derive the SET of distinct `context` key-sets status.js can emit (4 variants: notYet-family,
neverRecorded, measured, noCeiling), expanding ...NONE_BASE, and assert the recorded
fixture's `context` key-set matches one of them.
- COMPOSITION-AWARE by construction: any legitimate variant passes. The removed guard
  compared against ONE live card and fired on board composition (two profile shapes, four
  context shapes on an 18-agent board). This looks at NO board.
- Catches the real drift: a context rename/add in status.js changes all variant shapes; a
  stale (un-re-captured) fixture matches none and reds "re-capture".
- Lives in the unit test, NOT render-talk.js's release path: a false red costs a test run,
  not a cut. This is the same placement #2519 chose for the top-level anti-rot comparison
  (its stated reason: "a false red costs a test run rather than a release"), and the reason
  render-talk.js is left untouched (so the goldencard pin passes trivially, no cut exposure).

## Scope: context ONLY, not profile (deliberate, not a gap)
profile is free-form (the tree writes dir/displayName/role/reportsTo per operator), scrubbed
wholesale by the capture, and every page profile read is guarded (`a.profile && a.profile.role`).
So a missing profile key is COMPOSITION, never drift -- the exact crux the card names,
resolved for profile by exclusion rather than a guard that would false-red on every board.

## Weakest premise (named, per convention)
A PAGE-ONLY rename (page reads ctx.pct while status.js still emits percent and the fixture
still carries percent) is NOT caught by this producer-anchored guard: the fixture matches the
producer, green. Rationale it is acceptable: a page-only context rename breaks LIVE cards on a
populated box too (every board row reads context), so it is caught by board-level checks, not
specific to the quiet box. The quiet-box-SPECIFIC gap is recording-vs-producer divergence,
which is exactly what this catches. What would change my mind: evidence of a detail-panel-only
context read with no board equivalent.

## Mechanics
- Hoist a module-scope `contextShapes(statusSrc)` helper (the ...NONE_BASE-expanding scan),
  used by BOTH the existing "context key-set" arm and the new arm (ends the byte-copy).
- New arm: derive shapes, assert fixture.context matches one; CONTROL that a percent->pct
  rename matches none (the arm can red); pin the exact measuredResult shape today.
- Update render-talk.js:150-161 header to point at the new arm (it is no longer "checked by
  nothing"), carefully, without tripping the prose-cross-checking arms.
- Validate: full goldencard suite, gate/helper/meta-guard suites, full node suite. Challenge-loop
  (vary models), proof, 6j, PR, CI, merge, self-close.
