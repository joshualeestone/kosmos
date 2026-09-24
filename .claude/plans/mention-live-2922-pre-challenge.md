---
pre_challenge: true
method: challenge-loop
branch: mention-live-2922
diff_hash: 632fa5c24fa06ec0d134b94594d7d6a939c3b5dfd4d5d1dac8ef5e997dc8250f
validation: passed
subdir_audit: passed
timestamp: 2026-09-24T09:38:56Z
iterations: 8
converged: true
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 8 (fresh blind reviewer each pass, model alternated sonnet/opus per kosmos#2032)
**Converged:** Yes (iteration 8, opus, found zero BLOCKER/WARNING/CONVENTION)
**Total findings:** 11 BLOCKER/WARNING/CONVENTION (all resolved or deferred) + 16 NITs
**Fixed:** 9 | **Deferred:** 2 | **Asked:** 0
**Self-generated (SELF origin acted on):** 0 across all iterations (the feature code predates the loop, so every finding is BRANCH)

Kosmos #2922 part 2: the live @-mention highlight in the project-room composer. `#pj-post` is backed
by a mirror div rendering the same text with recognized `@agent` mentions in `--pj-mention` blue; the
textarea text goes transparent while the caret stays inked. The recognized-name rule reuses the
posted-message classifier (pinned equal by a differential browser-check arm), and the key-set is
single-sourced through `pjMentionKeys`.

### Per-Iteration Breakdown

#### Iteration 1
**Reviewer model:** sonnet
**New findings:** 1 WARNING (double-paint), 1 WARNING (backend-boundary), 1 CONVENTION (em dashes), 2 NITs; plus the 6.0 initial-validation BLOCKER (surface gate)
**Self-generated:** 0
- [WARNING] web/index.html input listener -- direct `input`->pjMentionPaint binding double-painted per keystroke (grow already paints) --> FIXED (2ac019bcd)
- [WARNING] pjMentionHighlightHTML/pjRichSpans -- backend-boundary tokenization gap --> DEFERRED (part-1 parity, safe direction; follow-up card)
- [CONVENTION] plan file -- two em dashes --> FIXED (2ac019bcd)
- [NIT] render-mention-blue-2922.js -- plainColor captured but unasserted --> FIXED (2ac019bcd)
- [NIT] web/index.html -- mirror-inner looked up two ways --> FIXED (2ac019bcd)
- [BLOCKER] initial-validation: #2518 surface gate (the #pj-post surface changed; render-type-to-focus-3283.js + render-composer-stroke.js own that token) --> FIXED via per-check Browser-check-surface trailers, both verified passing (2ac019bcd)

#### Iteration 2
**Reviewer model:** opus
**New findings:** 1 CONVENTION (key-set drift), 2 NITs
**Self-generated:** 0
- [CONVENTION] pjRoomBody re-derived the agent key-set inline, pinned only by a comment (repo Convention #5) --> FIXED: pjRoomBody now derives from pjMentionKeys (single source), guarded by a unit source-pin test; render-mention-blue stays green, proving behaviour-identical (2a10ed4ad)

#### Iteration 3
**Reviewer model:** sonnet
**New findings:** 1 WARNING (attach-fill stale mirror), 1 CONVENTION (plan filename), 2 NITs; plus the 6g BLOCKER (links-everywhere)
**Self-generated:** 0
- [WARNING] pjPostSend attach-only filename fill set #pj-post.value directly without repainting -> stale/blank mirror over real text --> FIXED (e09015c27), reconciled with the send-ordering guard (3b703b8e3)
- [CONVENTION] plan file missing the `-<timestamp>` suffix (CLAUDE.md) --> FIXED (e09015c27)
- [BLOCKER] 6g: web.links-everywhere.test.js adjacency guard broken by the attach-fill insert --> FIXED by moving the repaint after the text capture (3b703b8e3); the paired engine/feedguard.test.js "content scan took too long" red was a contention flake (57/57 in isolation)

#### Iteration 4
**Reviewer model:** opus
**New findings:** 0 BLOCKER/WARNING/CONVENTION, 3 NITs
**Self-generated:** 0
- Clean review. NITs: markdown-link divergence (safe direction), metric-literal duplication (guarded), rect-overlay assertion is a file:// coverage boundary.

#### Iteration 5
**Reviewer model:** sonnet
**New findings:** 1 CONVENTION (tokenizer algorithm dup), 1 WARNING (plan overclaim), 2 NITs
**Self-generated:** 0
- [CONVENTION] the recognized-name ALGORITHM (not just the key-set) is duplicated between pjMentionHighlightHTML and pjRichSpans with no test pinning them equal --> FIXED: differential browser-check arm runs shared fixtures through both and asserts equal @key classification (9c2c6bba2)
- [WARNING] the plan asserted "mirror rect == textarea rect (dx=dy=dw=0)" as a committed check when it was a manual dev measurement --> FIXED: plan corrected to name the CSS-metric-parity proxy CI actually guards (9c2c6bba2)

#### Iteration 6
**Reviewer model:** opus
**New findings:** 1 WARNING (hidden-paint), 3 NITs
**Self-generated:** 0
- [WARNING] a project opened from the list restores its room draft into #pj-post BEFORE pjView un-hides the room, so pjMentionPaint ran while hidden (offsetWidth 0), sizing the mirror to 0 while .mention-live kept the text transparent -> the draft looked empty --> FIXED: pjMentionPaint is hidden-safe (bails when offsetWidth 0) + re-engage on show, pinned by a non-vacuous browser-check arm (a55716911)

#### Iteration 7
**Reviewer model:** sonnet
**New findings:** 1 WARNING (re-engage gap), 2 NITs
**Self-generated:** 0
- [WARNING] iter-6's re-engage only covered openProject; other room-show paths (showTab consolidated toggle, leaving task/docs detail, the docs back button) did not re-engage after the hidden-guard stripped .mention-live --> FIXED: re-engage centralised in pjView() for which==='one', covering every show path (782ec7775)
- [NIT] raw (live) vs escaped (posted) tokenization could in principle diverge on entity-adjacent mentions --> proven safe by adding entity-adjacent fixtures to the differential arm (all agree, because keys cannot contain &<>") (782ec7775)

#### Iteration 8
**Reviewer model:** opus
**New findings:** 0 BLOCKER/WARNING/CONVENTION, 2 NITs
**Self-generated:** 0
**Converged** -- no new actionable findings. NITs: the differential-arm comment is scoped to plain @word tokens (markdown-link tokens pjRichSpans pre-processes are out of the arm's scope, safe direction); the resize listener is unthrottled (acknowledged tradeoff). Five STRENGTHs confirmed alignment-by-construction, the single-source fix, complete paint coverage + correct hidden-safe guard, airtight escaping, and non-vacuous tests.

(Post-convergence: 10ea28842 reworded one comment so the #2518 surface gate stops false-firing on the literal `docs-back` id in a comment -- a comment-only change, no behaviour, render-subview-cleanup-3502.js verified 15/15.)

### Final Ledger

| # | Iter | Category | File | Origin | Description | Status | Resolution |
|---|------|----------|------|--------|-------------|--------|------------|
| 1 | 1 | WARNING | web/index.html | BRANCH | double-paint (direct input + grow) | FIXED | 2ac019bcd |
| 2 | 1 | WARNING | web/index.html | BRANCH | backend-boundary tokenization gap | DEFERRED | part-1 parity, safe direction, follow-up card |
| 3 | 1 | CONVENTION | plan | BRANCH | em dashes | FIXED | 2ac019bcd |
| 4 | 1 | BLOCKER | tools (surface gate) | BRANCH | #2518 pj-post surface | FIXED | 2ac019bcd (trailers) |
| 5 | 2 | CONVENTION | web/index.html | BRANCH | key-set drift (Convention #5) | FIXED | 2a10ed4ad |
| 6 | 3 | WARNING | web/index.html | BRANCH | attach-fill stale mirror | FIXED | e09015c27 / 3b703b8e3 |
| 7 | 3 | CONVENTION | plan | BRANCH | filename missing -timestamp | FIXED | e09015c27 |
| 8 | 3 | BLOCKER | web.links-everywhere.test.js | BRANCH | send-ordering adjacency broken | FIXED | 3b703b8e3 |
| 9 | 5 | CONVENTION | web/index.html | BRANCH | tokenizer algorithm duplicated | FIXED | 9c2c6bba2 (differential arm) |
| 10 | 5 | WARNING | plan | BRANCH | overclaimed rect==rect as a check | FIXED | 9c2c6bba2 |
| 11 | 6 | WARNING | web/index.html | BRANCH | draft-restore painted while hidden | FIXED | a55716911 |
| 12 | 7 | WARNING | web/index.html | BRANCH | re-engage gap on non-openProject show paths | FIXED | 782ec7775 |

### Outstanding questions (ASKED, still unresolved when the run ended)
None.

### Deferred (tracked for a follow-up card, not this PR)
- **Backend-boundary tokenization gap.** Both UI surfaces (live input and posted message) tokenize on
  whitespace, so an `@name` after a non-identifier char mid-token (`foo/@mona`, `)@mona`) is flagged
  by the backend but highlighted by neither. Safe direction (the UI under-signals, never falsely
  promises delivery), inherited unchanged from part 1 (#2954). The real invariant -- live == posted --
  holds and is pinned by the differential arm.
- **Markdown-link divergence.** `[@mona](url)` is stripped and highlighted in the posted message
  (pjRichSpans pre-processes markdown links) but shown raw+plain in the live input. Same safe
  direction; same follow-up card.

### NITs (non-blocking, across all iterations)
- resize listener is unthrottled (idempotent; acknowledged tradeoff) -- iters 3, 5, 8
- `.pj-mirror-in` metric literals duplicate `.cinput` (guarded by the browser-check metric-parity arm) -- iters 4, 5, 6, 7, 8
- text selection over the transparent textarea reads oddly (inherent to the overlay-mirror technique) -- iter 6
- the differential-arm comment is scoped to plain @word tokens -- iter 8

### Strengths (across all iterations)
- Recognized-name rule is a faithful, line-verified port of the posted-message tokenizer, now pinned equal by a differential arm across 25 fixtures incl. entity-adjacent inputs.
- pjRoomBody single-sourced through pjMentionKeys (Convention #5 addressed by construction + a pin test).
- Paint coverage complete: every programmatic #pj-post value-set routes through pjGrowComposer; pjView('one') re-engages on every show path; pjMentionPaint is hidden-safe.
- Alignment by construction (shared offsetParent, mirrored metrics, no border/scrollbar), verified by computed-style parity across both engines and themes.
- Escaping airtight; mirror is aria-hidden; both CI gates (#1720 coarse, #2518 surface) handled correctly.
