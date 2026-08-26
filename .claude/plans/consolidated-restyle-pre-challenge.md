---
pre_challenge: true
method: challenge-loop
branch: consolidated-restyle
diff_hash: 9e1873d08f070ead993f8c2c0307d193d58dc0fea653298f9446627bf533d0f1
subdir_audit: passed
timestamp: 2026-08-26T21:37:00Z
iterations: 15
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 15
**Converged:** No — stopped at a bound named in advance of round 14, not by a round finding nothing.
**Fixed:** every BLOCKER and WARNING below | **Deferred:** 1 (carded as #1017)

### Why this stopped where it did

The stopping rule was set before round 14 and stated publicly: round 14 decides,
round 15 is the hard stop, and if a majority of a round's findings were in code
the review itself created, stop immediately regardless.

Applied Angel's measurable test at that point — *if the last two rounds mostly
found problems in code that did not exist before the review started, the loop has
stopped reviewing the work and started reviewing itself*:

| round | findings on ORIGINAL code | findings on review's own fixes |
|---|---|---|
| 12 | 4 of 6 | 1 |
| 13 | 4 of 7 | 2 |

Still reviewing the work, but the self-referential share was rising, which is the
direction that rule watches. Rounds 14 and 15 each found a real BLOCKER on
original code, so the loop kept earning its keep to the end; the bound was
honoured anyway rather than extended because it kept paying.

### The five that mattered

**Round 10 — BLOCKER, dead CSS.** A paragraph appended after a comment's closing
delimiter left six lines of raw prose inside the body-grid declaration block. CSS
error recovery discards to the next semicolon — the one ending
`grid-template-rows` — so the entire row template was dead in every browser.
**All 11 tests passed against it**, because every pin in this branch is
`readFileSync` + regex and none can tell "the rule is written" from "the rule
takes effect". Shipped with `strayCommentTerminators`, the first guard here that
can distinguish the two.

**Round 12 — BLOCKER, the box that was the whole point.** The discussion column
still had a bounding box on three sides — the one thing the brief asked this pass
to remove. `.pjmid` is a `.pjcol`, which sets a border on all four sides; the
rule set `border-radius: 0` and a `border-right` and never reset the shorthand.
The tell was *in* the rule: re-declaring `border-right` only makes sense if you
believe there is no border there. Invisible to every text pin, because rule text
cannot see an inherited border.

**Round 13 — a page scrollbar in the state this branch removes.** The Members
card capped at `max-height: 100%`, which resolves against the grid *area*, while
carrying a 12px bottom margin — so at the cap its margin box was 12px taller than
its track and a full list spilled out to the body scroll. Not window-dependent.

**Round 14 — BLOCKER, unreachable controls.** Only the list inside the Members
card had a scroller; the card's four other children — add member, remove, the add
row with its confirm button, the aria-live result — sat outside it and were
clipped at the clamp. An inconsistency rather than a decision: the branch already
treats this exact failure as blocking for four sub-views and gave them a scroller.

**Round 15 — BLOCKER, cards covering each other.** With `align-self: start` a
card is sized by its content under the 38vh cap, never by its track; the two
`minmax(0, auto)` tracks have a base size of 0, so under pressure grid splits the
leftover equally and they land below their content. Track shrinks faster than
cap, they cross near 770px, and past that the opaque cards overflow and paint
over each other — the sticky Files label and `+ Add member` went under an opaque
card. **The body's escape hatch could not catch it**: the tracks *shrink*, so the
grid never exceeds the viewport and the page scroll never fires.

### Measurement, not derivation

Round 15's reviewer flagged that they had derived the overlap from track-sizing
rules and could not render it. Measured headless at 1280 wide, 14 rows per card:

| | 900px | 720px | 600px |
|---|---|---|---|
| `align-self: start` | clean | **overlap 8px** | **overlap 22px** |
| `align-self: stretch` | clean | clean | clean |

⚠️ The first version of that probe reported no overlap in **either** direction,
because `.pj3`'s `height: 100%` resolved against unconstrained ancestors and the
grid was never squeezed. It was only trusted after a planted overlap proved it
could see one. A clean result from an instrument not shown to fail is not a clean
result.

### Accessibility fixed rather than traded

- `.lstate` hidden with the visually-hidden clip rather than `display: none`, so
  every agent's state stays in the accessibility tree while leaving the screen —
  the ask was about the eye. `:has(.ansgo)` keeps the one row carrying an action.
- The open-project marker measured **1.13:1 / 1.16:1** light and **1.06:1 /
  1.35:1** dark against named grounds, under the 3:1 this file declares for
  itself. Replaced with an inset `--k-ink-2` bar clearing the floor on both
  adjacent grounds in both themes. Pinned by a **computed** test with an
  inverting control.
- Two controls on one screen both accessibly named "Settings", created by the
  copy trim. The door now shows "Settings" and is named "Project settings",
  which also stops it disagreeing with the page it opens.

### DEFERRED (1)

**Files/Members tab order vs visual order (WCAG 1.3.2 / 2.4.3).** Introduced by
the row swap. The durable fix — swapping the two children in markup, free
visually under `display: contents` — also reorders the **tab view**, a screen
nobody asked about and Josh has not seen. Reordering an unrequested screen inside
a styling pass is the worse of the two, so it is recorded in the rule **and
carded as #1017** so the choice reaches him as a decision. A comment is not a
card.

### NITs and guard repairs

Ten-plus stale `:NNNN` citations converted to grep anchors, because a citation
into a file still being edited rots by construction and a wrong one reads as
verified. A control that asserted a *paraphrase* of its guard rather than the
guard. A count pinned at `>= 4` against six real call sites. A helper declared
below its first use. A guard reddened by a correct explanation naming the slots
it protects.

### Strengths carried forward

`strayCommentTerminators` and the computed contrast pin are the only two guards
here that measure structure rather than text, both with controls in both
directions, both proven to fail on the real defect. The `pjMarkOpen(null)` fix in
`render-consolidated-layouts.js` stopped a browser check screenshotting a state
no person can reach and pinning it as correct.

### Unproven, stated rather than buried

Rendering was verified headless for the overlap geometry only. The full visual
pass — light and dark, folds, every sub-view — was run against a sandboxed
fixture server earlier in the branch, not after round 15's change. `align-self:
stretch` is pinned and measured for overlap; it has not been eyeballed.
