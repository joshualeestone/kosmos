---
pre_challenge: true
method: challenge-loop
branch: restore-dircheck-2615
diff_hash: 7c78073d5a06ba407f31d7cedbb236b18242f25ef191ad93dcfb25d2444d7779
timestamp: 2026-09-10T14:15:29Z
iterations: 7
converged: true
---

# Challenge-loop proof: restore-dircheck-2615 (kosmos#2615)

Greys out the removed-list **Restore** control when the agent's account folder is
gone. Frontend-and-backend counterpart to #2609 (PR #2613), which made the ENGINE
refuse that restore; the person was still offered a live button and told no
afterwards.

**Not frontend-only, and that was the first finding.** `GET /api/removed` returned
only `name`, `shownAs`, `removedAt`, `stopped`, and a browser cannot stat a
filesystem. One predicate is exported from `engine/remove.js` and read by BOTH
the engine refusal and the route, rather than a second copy of a four-line test,
because a pre-click state whose whole job is to agree with a post-click refusal
is the last place two implementations belong.

Full design record, every iteration's findings, the seams checked and found
clean, and the accepted residuals are in
`.claude/plans/restore-dircheck-2615-20260910T0932.md`.

## Iterations: 7, converged

| round | found | kind |
|---|---|---|
| 1 | a test passing on `false === false`; a WCAG failure in the first control | product + instrument |
| 2 | the explain handler destroying an in-flight restore status | product |
| 3 | **the card greyed nothing out** | product |
| 4 | the same live-region fix written in one direction only | product |
| 5 | a CSS comment that invented its own cascade | prose |
| 6 | a source-shape guard judging comments, in both directions | instrument |
| 7 | **NO NEW ISSUES** | converged |

The convergence signal is the PROGRESSION rather than round 7's zero: the product
surface stopped yielding after round 4, and rounds 5 and 6 found defects in the
prose and the instrument.

**The most repeated defect was never in the code.** Four findings were confident
claims about neighbouring code that was never re-opened, three of them in prose.
No test could have caught any of those, which is the argument for the blind round.

## Verification at convergence

- `bash tools/run-tests.sh`: **exit 0, 5610 tests, 5610 pass, 0 fail, 0 skipped.**
- `render-restore-dircheck-2615.js` under real Playwright: **exit 0.**
- Browser-check controls, all MEASURED against an isolated copy, never asserted:

  | mutation | result |
  |---|---|
  | baseline | exit 0 |
  | never-disable (reproduces `origin/main`) | exit 1, 8 problems |
  | always-disable | exit 1, 4 problems |
  | delete the `.acts .btn[aria-disabled="true"]` rule | exit 1, the two style arms |
  | widen that rule to every `.acts .btn` | exit 1, the style negative arm |
  | widen the explain selector to `.acts button` | exit 1, the live-control arm |
  | never press the removed-list toggle | exit 1, "would run against display:none" |
  | hard `disabled` instead of `aria-disabled` | exit 1, the WCAG arm plus three |
  | re-assert a held explanation unconditionally | exit 1, ONLY the staleness arm |

- Contrast measured across all four theme arms: light **9.36:1**, dark
  **10.58:1**, both `prefers-contrast` arms the same, blocked-vs-live distinct in
  every one. `.5` was rejected with numbers (**3.39:1, fails AA**) because this
  control is focusable and therefore not exempt.
- Keyboard reality measured: expanded, the control is focusable, on screen, in
  the tab order, and **both Enter and Space announce the reason**.
- Em dash sweep over every added line: **0**, with the pattern proven able to
  fire against a planted dash and to ignore a hyphen.

## Accepted residuals, stated rather than hidden

- The arrival clears the whole `#removed-msg` region, so an explanation on screen
  goes with it. The explanation is re-obtainable by pressing the control again.
- A stale-but-inert explanation if the folder returns with no further press.
  Nothing re-asserts it; inertness is not reprinting.
- **Pre-existing and verified as such, not introduced here:** other
  `#removed-msg` writers that clobber each other (including the restore handler's
  `partial` branch), and the single-slot `RESTORE_WAITING` losing the first of two
  concurrent in-flight restores.
- **#2609's named, still-open follow-up:** a Windows agent whose account was
  deleted restores unchecked. The greyed state is deliberately no wider than what
  the engine actually refuses.
