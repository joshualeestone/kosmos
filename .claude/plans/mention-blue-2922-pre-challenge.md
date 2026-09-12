---
pre_challenge: true
method: challenge-loop
branch: mention-blue-2922
diff_hash: 6f53f83ebd8aaf9fa0f11cc6f50079317bf239bda596763963e94f0f3282e4f0
validation: passed
subdir_audit: passed
timestamp: 2026-09-12T19:34:18Z
iterations: 6
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 6
**Converged:** Yes (iteration 6's only finding is a documented DEFERRAL that needs backend work; no NEW actionable findings that are fixable in this web-only change)
**Total findings:** 2 BLOCKERs, 3 WARNINGs, 1 CONVENTION, several NITs
**Fixed:** the 2 BLOCKERs, 2 WARNINGs, the CONVENTION, and 2 NITs | **Deferred:** the removed-agent WARNING (backend-dependent, pre-existing) + 2 safe-direction boundary NITs | **Asked:** 0

The value of this loop was concentrated and real: it drove the highlight from a plausible-but-wrong
first cut to a precise mirror of the backend's actual mention-flag logic (engine/messages.js), which
is the feature's whole point -- the blue must mean "this will reach that agent," never a false
promise. Reviewer models were alternated (sonnet/opus across the six passes). Each round closed a
genuine parity or AA gap.

### Per-Iteration Breakdown
- **Iter 1 (sonnet):** [BLOCKER] `**@mona**` did not highlight (leading `**` stayed on the token) --> FIXED (leading peel). [BLOCKER] `--pj-mention` #0a64fa failed WCAG AA on the real message-bubble washes (4.18-4.30:1) --> FIXED (#0a58d8, worst 5.19:1, computed against the blended grounds). [CONVENTION] no browser-check --> FIXED (added the hermetic render-mention-blue-2922.js, which reds on exactly those two defects).
- **Iter 2 (opus):** [WARNING] `__@mona__` / `_@mona_` did not highlight --> FIXED at the time (trailing-underscore peel). [NIT] model aria... n/a. (This fix was later CORRECTED in iter 4.)
- **Iter 3 (sonnet):** [WARNING] the highlight under-promised vs the backend -- it stripped only `_`, but the backend tries the exact @-word then strips trailing `[._-]` --> FIXED (mirror engine/messages.js: exact-first, then strip trailing `[._-]`; `@mona-` now highlights, `@mona_bar` stays plain).
- **Iter 4 (opus):** [WARNING] the iter-2 underscore support was WRONG in the false-promise direction -- the backend's left boundary `(^|[^A-Za-z0-9._-])@` treats `_` as an identifier, so `_@mona_` is NOT flagged --> FIXED (dropped `_`/`__` from the leading peel; underscore-emphasised mentions now render plain, matching the backend; flipped the check arms).
- **Iter 5 (sonnet):** [WARNING] a self-mention rendered blue -- the backend removes the author from a non-operator post's recipients --> FIXED (pjRoomBody deletes m.from from agentNames when m.operator !== true; added self/other/operator arms).
- **Iter 6 (opus):** [WARNING] a REMOVED agent's @name renders blue but the backend drops removed agents (`_roomMembers`) --> DEFERRED (see below). Otherwise clean; strengths confirm the boundary/strip/self-mention parity, injection-safety, scoping, and AA are all correct.

### Deferred finding (documented, needs a follow-up)
- **[WARNING] `@removedAgent` highlights blue though the backend will not deliver to a removed
  agent.** The clean fix needs BACKEND help: `engine/projects.js` `describe` publishes
  `agents: project.agents` with no removed-filter and no `removed` flag on the member objects, so the
  front end cannot distinguish a removed member today. The gap is PRE-EXISTING and shared with the
  mention autocomplete (`mentionCandidates` reads the same `p.agents` and would already suggest a
  removed agent). A client-side workaround (cross-referencing paintRemoved's fetch) is racy. The
  right fix is a follow-up that publishes a `removed` flag on the member objects and deletes removed
  names from `agentNames` (same shape as the m.from delete), which fixes the autocomplete too. Filed
  as a follow-up on the card. Not fixed here because it is backend-dependent and out of scope for a
  web-only highlight.

### NITs (safe direction, deferred)
- A non-identifier char DIRECTLY touching the `@` that is not one of the peeled `* ~ (` (a quote,
  `[`, a second `@`) or a trailing non-identifier that is not `[._-]` (`@mona#`, `@mona/`): the
  backend flags but the render lacks the blue cue. Safe direction (a working mention merely missing
  the cue, never a false promise) and rare spellings; documented, not chased.

### Outstanding questions (ASKED)
None.

### Strengths
- The render now precisely mirrors engine/messages.js in the harmful (false-promise) direction:
  left-boundary identifier rule (so `_@mona_` stays plain), exact-then-strip-trailing-`[._-]`
  (so `@mona-` highlights, `@mona_bar` does not), and the operator-vs-author recipient filter (a
  self-mention does not blue). So the blue genuinely means "this will reach that agent."
- Injection-safe: `esc()` runs before the token pass; the inserted key is a substring of the escaped
  text gated on an exact Set match; a key with an HTML-special char fails the lookup and falls to
  plain escaped text.
- Scoped to the project room only (agentNames threaded solely from pjRoomBody); dialogue surfaces are
  byte-identical.
- AA measured against the REAL alpha-blended bubble grounds (--k-sunk / --usermsg-tint over --k-bg),
  worst 5.19:1 light / 6.51:1 dark; theme-aware token in :root + @media-dark + the generated
  data-theme twin (forced-theme parity holds). No em dashes.
- Hermetic 64-arm browser-check (chromium + webkit, light + dark), registered in browser-checks.sh
  and the README, reds on regressions of every tested arm.

## Scope note
This branch is PART 1 (posted-message highlight). PART 2 (the live-input textarea overlay Josh
emphasized) is deferred with a concrete plan (in the plan file + the card), to be built with focused
browser iteration.
