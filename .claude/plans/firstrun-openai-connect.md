# Plan: firstrun-openai-connect

Josh, #chaoskosmos-design 2026-08-26 06:09 CDT: "Since we support OpenAi now
shouldn't that be available on install too and not just Claude?"

Verified before answering: the first-run wizard's "Choose a model" step
(pane 3) still rendered OpenAI's row as static `class="llm off"` markup with
a "Coming soon" pill, left over from before Settings' OpenAI connect flow
existed (#540, and confirmed working live by Josh tonight). Splinter
independently found the same gap and named the sharper version of it: this
isn't an omission, it's an active false claim on the one screen a brand-new
user sees before deciding whether Kosmos does what they need -- and "coming
soon" labels can go false with no commit marking the day they did, since the
feature's own diff never touches the sentence denying it exists.

## Change

`web/index.html`, first-run pane 3 only:

- OpenAI's row moves from `class="llm off"` / `pmark dim` / "Coming soon" to
  `class="llm on"` / `pmark live` / a real `Connect` button
  (`#fr-openai-connect`), matching Claude's row shape. OpenAI's SVG mark is
  already solid black (`fill="black"`, not `currentColor`), so "live" for it
  just lifts the grayscale/opacity filter rather than changing a tint.
- Clicking Connect reveals `#fr-openai-flow`, a small key-entry form
  (password field and Add in one row; the Show/Hide toggle from the first
  build was removed at Josh's 2026-08-26 live call, commit 4e68f6f, so
  Settings keeps its pre-Add check and first-run trades it for a shorter
  row) adapted from Settings' `#acct-openai-flow`
  -- same warning copy, same "never shown again" promise, same endpoint, so a
  person who already did this once in Settings recognises it here. Not
  verbatim: two deliberate simplifications for the first-run context, called
  out here rather than left for a reviewer to find. (1) The optional
  account-name/label field is dropped; first-run only needs one OpenAI
  account to exist, naming it is a Settings-only nicety for telling several
  apart later. (2) Settings' own form stays open after a successful Add (so
  a person can add a second key right away); first-run's closes, because
  once the row shows Connected there's nothing left to do on this step.
- Submitting posts to `POST /api/accounts/openai`, the exact endpoint
  Settings already uses, with `{ key }` only (no `label`, per the
  simplification above). No backend change; confirmed with Angel this is
  the right call before starting (she owns that surface, has no uncommitted
  work there tonight).
- `frPaintOpenai()`, a new function parallel to `frPaintSubscription()` but
  independent of it: on pane-3 entry it checks `/api/accounts` for an
  existing OpenAI account (in case one was already added, e.g. resuming a
  partial run) and paints Connected if so; after a successful Add it is told
  directly (`known.justAdded`) rather than re-fetching, which also lets the
  message be action-descriptive ("Added…") only right after the action,
  state-descriptive ("An OpenAI account is connected…") otherwise -- caught
  in challenge-loop iteration 1: without the split, stepping back to pane 2
  and forward again would claim to have just "Added" an account this visit
  never touched. Fails silently ONLY on a read failure (honest-unknown, same
  contract #881 settled on for the Claude box -- never turn "we could not
  tell" into "no"); a successful read that finds no account is a real
  answer and does repaint back to Connect, the reverse transition
  `frPaintSubscription()`'s own tests already hold Claude's box to.
- Updated the pane's own stale doc comment ("Claude is the one that works
  today... the rest are Coming soon") to name both live providers and the
  four genuine Coming-soon ones.

## Deliberately not touched

`frPaintSubscription()`'s own messaging ("No Claude subscription is
connected yet... they need one before they can do anything") still centers
Claude alone and doesn't account for a person who connected OpenAI instead.
Continue is never actually blocked on either state (every arm offers a
Continue action), so this isn't a false gate, but the wording could read as
more alarming than warranted once OpenAI is connected. Leaving this for a
separate pass rather than widening tonight's diff -- the row's own visible
Connected state is the primary signal a person checks for "is OpenAI on",
and it is accurate now.

## Verification

- [x] `KOSMOS_REPO=<worktree> python3 Projects/kosmos-design/jargon.py` and
      `--engine`: 0 new hits (the 3 pre-existing 'delete' hits are
      unchanged, far from this area, confirmed identical on unmodified
      main).
- [x] `node --test web.firstrun-model.test.js`: 9/9 pass -- two existing
      tests updated for the coming-soon count (5 -> 4) and two providers now
      carrying live marks (was 1), one existing test title corrected
      ("the one choosable model" -> now two), two new tests added (OpenAI's
      markup, and `frPaintOpenai`'s four real paths: told directly,
      asked-and-found, asked-and-nothing-there, and a read failure, which
      must leave the row untouched rather than read as a "no").
- [x] `node --test` (full suite): 2198/2198 pass.
